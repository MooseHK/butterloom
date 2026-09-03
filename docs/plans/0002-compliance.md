# Implementing the regulatory obligations

Turns `docs/COMPLIANCE.md` into work. That document is the research; this one is the
sequence, and it only covers obligations that **live in software**. The registrations
themselves — DBID, trade licence, BIN, TIN, the bKash Merchant Account, the BTRC-enlisted
SMS aggregator — are in `docs/launch-prerequisites.md` and have lead times nothing here
can shorten.

Nothing below is built. Read `docs/COMPLIANCE.md` first; the tiers (**[LAW]**,
**[GUIDELINE]**) matter for what gets cut if something has to be.

---

## 1. Settle the stock-count collision first — this is a decision, not code

DCOG 2021 requires a **live stock count** stated on the product page before purchase.
ADR-0007 makes that page edge-cacheable *precisely* by asserting nothing about stock, and
says so as a promise: a stale page can never assert something false about stock because it
asserts nothing. Both cannot stand.

Nothing else in this plan should be built until this is answered, because the answer
decides whether the product page stays cacheable — and if it does not, the architecture
ADR-0007 bought stops paying for itself on the page that matters most.

**Three ways out:**

| Option | What it costs |
|---|---|
| **A. Uncached stock fragment.** The page stays cached and asserts nothing; a small client fetch fills in a live count from an uncached endpoint. | One more of the four JS interactions, and a page that briefly shows no count. The 200KB budget has room. The fragment pattern already exists twice (Pathao cascade, recently viewed). |
| **B. Uncache the product page.** Serve `/p/:slug` from the origin with the count rendered in. | Concedes ~250ms from Dhaka on the highest-intent page in the catalogue, on every view, for every visitor. This is the cost ADR-0007 exists to avoid. |
| **C. Coarse availability, cached.** "In stock" / "Only a few left" / "Sold out", baked into the cached page and purged on change. | Adds the purge path ADR-0007 rejected, which must never silently fail — and it is not a *count*, so it may not satisfy the guideline at all. |

**Recommended: A.** It keeps every property ADR-0007 was built for, spends budget that is
now demonstrably available, and degrades to today's behaviour if the script never runs.
The one thing to get right is that the fragment endpoint must be `private, no-store` and
must never set a cookie, or it takes the page's cacheability down with it — the existing
`Set-Cookie` middleware in `src/storefront/cache.ts` is the guard.

Whichever is chosen, it wants an ADR: it modifies a consequence ADR-0007 states as a
promise, and a future reader must not find the promise and the code disagreeing.

**Related, and cheaper:** checkout must be blocked when stock is zero. `0001-reservation.md`
already does this — placement refuses a short line inside the transaction. Note it here so
the row in `docs/COMPLIANCE.md` can be ticked against that plan rather than built twice.

---

## 2. Product page disclosures **[GUIDELINE]**

Country of origin, material, measurements, delivery charge and delivery timeline, all
before purchase.

Today a Product carries a title, a description, a price and a category. Origin, material
and measurements are per-product facts an operator types; delivery charge and timeline are
per-order facts derived from the address.

- **Schema:** `products.origin_country`, `products.material`, `products.measurements`
  (free text — a saree and a kurta do not share a measurement shape, and inventing a
  structured one before there are two garment types to compare is the wrong order).
  Nullable on arrival, then backfilled, then required for publication — expand-contract
  (`docs/DEPLOYMENT.md` §5).
- **Admin:** three fields on the product editor. They are disclosure obligations, so the
  storefront-visibility toggle should refuse to publish a product missing any of them.
  That refusal is the whole mechanism; a field that is optional in practice is not a
  compliance control.
- **Storefront:** rendered on `/p/:slug` in the existing `<details>` accordions.
- **Delivery charge and timeline** are §5.

## 3. Policy pages, in Bengali **[GUIDELINE]**

Terms, and the return/refund/exchange policy, **written in Bengali**. Plus trade licence,
DBID, BIN and TIN displayed on the site.

- **Routes:** `/terms`, `/returns`, `/privacy`, `/contact` — static, server-rendered,
  edge-cacheable, no JavaScript, no cookie. They are the cheapest pages in the catalogue
  and among the first things a gateway reviewer opens.
- **Bengali is the obligation**, and the storefront is English-only by a decision taken in
  the superseded ADR set. An English translation may sit alongside for the operator's own
  use, but the Bengali text is the one that satisfies the guideline, so the page must not
  be built English-first with translation deferred.
- **Statutory identifiers** go in the footer on every page — a small component reading four
  values from config, not typed into a template. They change rarely and must never
  disagree between two pages.
- The text itself is not an engineering deliverable. It needs the refund policy from
  `0003-refunds.md` to exist first, because a returns page that contradicts what the refund
  screen actually does is worse than no page.

## 4. Invoice, VAT and the Mushak 6.3 serial **[LAW once registered]**

The hardest correctness requirement here, and the one most easily got wrong quietly.

**A receipt itemising VAT is required regardless of VAT registration.** The full Mushak
6.3 invoice record becomes a legal obligation once registered (turnover threshold Tk 50
lakh). Build the record now; registration then changes a flag, not a schema.

- **VAT rate is configuration, never a constant.** It moved 7.5% → 15% → 10% inside one
  month in 2025. Store it in basis points (`vat_rate_bp`) to stay in integers, and
  **snapshot it onto the order at placement** — an invoice reprinted next year must show
  the rate that was charged, not the rate in force when it was reprinted. This is the same
  invariant as the price snapshot in `order_items`.
- **Prices are VAT-inclusive on display and itemised on the invoice.** CRPA s.40 makes
  charging above the displayed price an offence, so VAT is never a line added at checkout.
  The invoice derives the VAT component out of the inclusive total:
  `vat_paisa = round(total_paisa × rate_bp / (10000 + rate_bp))`.
- **Round once, at the order, never per line.** Rounding lines independently makes the
  displayed lines fail to sum to the displayed total, which is a customer-visible
  discrepancy on a document that is also a tax record.
- **The serial must be monotonic and gapless.** Three things it must not be: an
  autoincrement rowid (which skips on rollback), a random id, or anything allocated
  outside the transaction that writes the invoice. Allocate it from a single-row counter
  table inside the same `db.transaction()` as the insert — SQLite's single writer
  (ADR-0006) makes that trivially correct, which is one of the places this stack is a
  better fit than the one originally planned.
- **The nine fields must be transcribed from the NBR Mushak 6.3 form itself.** They are
  not reproduced in `docs/COMPLIANCE.md` and are not guessed at here; getting them from a
  secondary source is how you end up with an invoice that looks right and is not one. This
  is a fill-in before the table is designed, and it belongs with consultant item 1.
- **Never deleted, never renumbered.** A cancelled invoice is a recorded cancellation with
  its serial intact.

## 5. Delivery SLA, stored per order **[GUIDELINE]**

**5 calendar days** same city, **10 calendar days** elsewhere. Goods to the courier within
**48 hours** of full payment, with the customer notified.

- **Snapshot the promise onto the order** at placement — `delivery_promise_days` and the
  resulting `delivery_due_at` — computed from the address. Derived at read time it would
  change if the rule changed, and what matters is what was promised on the day.
- **Calendar days, everywhere, including the storefront copy.** The market quotes business
  days; "5–8 business days" is 7–11 calendar days and breaches the same-city SLA on its
  face. This is a copy decision with legal consequences, so it belongs in the same commit
  as the field.
- **The admin orders board already has the shape for this** — it groups by Fulfilment
  State. An order past its `delivery_due_at`, or placed more than 48 hours ago and not yet
  handed over, should be visibly late on that board. A deadline nobody can see is not a
  control.
- Consultant item 2 asks whether the 5/10-day clock binds pure-COD orders at all. Treat it
  as binding regardless; that is the cheap side of the uncertainty.

## 6. Complaints **[GUIDELINE]**

An intake channel, a named compliance officer, resolution within **72 hours**.

- **Schema:** `complaints` — order id (nullable; not every complaint has one), customer
  name and phone, the complaint text, `received_at`, `due_at` (= received + 72h),
  `resolved_at`, resolution text, and an append-only `complaint_events` trail beside it.
- **Intake:** a public form at `/contact` that writes a row. Not an email address — an
  email inbox has no clock, no record and nothing to audit, and the obligation is a
  deadline.
- **Admin:** a queue ordered by `due_at`, overdue first, on the same board pattern the
  orders queues already use.
- **The named officer** is a config value shown on `/contact`, not a hardcoded name.
- **Six-year retention applies to complaint records** — so nothing here is ever deleted,
  only resolved (§8).

## 7. Reviews **[GUIDELINE]**

Customer-visible reviews, **negative reviews may not be deleted**, no vendor-connected
reviews.

- **Model with no `hidden` flag and no `approved` boolean.** This is the whole design: a
  schema that cannot express "quietly suppressed" cannot be used to quietly suppress. If
  a review must come down — abuse, personal data, obvious fraud — it is a `takedown` row
  with a reason and an actor, which is auditable by construction.
- Publication is immediate; moderation is after the fact and on the record.
- Reviews are per Product (not per Variant) and carry the order they came from, which is
  also how "no vendor-connected reviews" is enforced: no order, no review.
- **This changes the cacheability of the product page**, because a review posted must
  appear. Same three options as §1 and it should take the same answer — if reviews arrive
  in an uncached fragment, they arrive on the same mechanism the stock count uses.

## 8. Consent, rectification, and deletion that is redaction **[LAW]**

PDPA 2026 is in force. Penalties reach Tk 25 lakh with no small-business exemption.

- **Consent is timestamped and versioned at collection**, and states purpose and storage.
  `consents` — subject phone, `policy_version`, `purpose`, `granted_at`, the exact text
  hash. Versioned means: when the privacy text changes, existing consents are not
  retroactively "to" the new text.
- **Rectification within 30 days.** In practice: the admin can correct a customer's name,
  phone or address on an order — with the correction recorded as an event, never as a
  silent overwrite, because the order is also a tax record.
- **Erasure is scoped redaction, never `DELETE`.** Six-year retention wins over the erasure
  right, so the mandated business record survives and the personal detail inside it is
  replaced. Nothing in the order path is ever hard-deleted. A `redacted_at` stamp plus
  overwritten name/phone/address fields; order lines, amounts, invoice and serial untouched.
- Consultant item 3 asks whether breach notification is mandated. Log breaches regardless.

## 9. Six-year retention **[GUIDELINE]**

Transactions, customer data and complaint records for six years.

This is **not** six years of nightly snapshots. It is a periodic archival export of the
business-record tables — orders, order lines, payments, invoices, consignments, complaints
— encrypted, retained six years, and kept separate from operational backups.
`docs/DEPLOYMENT.md` §7 and `0004-point-in-time-restore.md` own the mechanism; this plan
owns the list of tables that go into it.

The separation also bounds the erasure problem in §8: a redacted customer's details survive
in operational backups only until those age out at 30–90 days, while the long-term archive
holds only what the law requires be kept.

## 10. SMS **[REGULATORY]**

Bengali text (OTP codes, numbers and URLs may stay Latin), a BTRC-enlisted local
aggregator, a registered sender ID of **11 characters or fewer**, transactional traffic
flagged separately.

- **International routing is prohibited**, which rules out Twilio and every global provider
  by name. The aggregator choice is a launch prerequisite with real lead time.
- Build against a small internal interface with a logging no-op implementation, so the
  order flow can be finished and tested before the aggregator contract exists. That is not
  a stub for its own sake: the 48-hour dispatch notification in §5 is an obligation, and it
  should not be blocked on a signature.

## 11. The 10% advance cap **[GUIDELINE]**

Advance payment is capped at **10%** of price for goods not handed to a courier within 48
hours, absent a Bangladesh Bank–approved escrow.

Nothing to build today — checkout is COD-only. It is recorded here because it is a
constraint on a design somebody will otherwise propose: "take a partial advance to deter
COD abuse" is only available for in-stock, ships-in-48h inventory, and never for pre-orders.
The pre-dispatch risk gate in `docs/COMPLIANCE.md` is the mitigation that *is* available.

---

## Sequence

| Order | Work | Why here |
|---|---|---|
| 0 | **§1 decision** | Decides whether the product page stays cached. Blocks §2 and §7. |
| 1 | §2 product disclosures, §3 policy pages | Cheapest, and a gateway reviewer opens them first. §3 needs `0003-refunds.md`'s policy to exist. |
| 2 | §5 delivery SLA, §6 complaints | Both are deadline clocks; both belong on the admin board that already exists. |
| 3 | §4 invoice, VAT and serial | Needs consultant item 1 (the rate) and the transcribed Mushak fields. Hardest to change later — the serial is append-only forever. |
| 4 | §8 consent and redaction, §9 retention export | Needs the table list to be stable, so it follows §4. |
| 5 | §7 reviews | Needs orders to exist in volume to be worth anything. |
| 6 | §10 SMS | Gated on the aggregator contract, not on code. |

## Before any of this is relied on

The three items in `docs/COMPLIANCE.md` needing a local consultant — the current VAT rate,
whether the 5/10-day clock binds pure-COD orders, and whether the PDPA mandates breach
notification — are not engineering questions and are not answerable from here. §4 in
particular should not ship against a guessed rate.
