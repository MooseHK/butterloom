# Implementing the regulatory obligations

Turns `docs/COMPLIANCE.md` into work. That document is the research; this one is the
sequence, and it only covers obligations that **live in software**. The registrations
themselves — DBID, trade licence, BIN, TIN, the bKash Merchant Account, the BTRC-enlisted
SMS aggregator — are in `docs/launch-prerequisites.md` and have lead times nothing here
can shorten.

> **Note on Reservation:** Reservation (0001) is deferred as an overkill concept for now:
> it only blocks manual bKash (which may not be implemented). For COD-primary checkout,
> placement commits stock atomically inside the transaction. This plan is unblocked and implemented.

---

## 1. Settle the stock-count collision — DECIDED: Option A

DCOG 2021 requires a **live stock count** stated on the product page before purchase.
ADR-0007 makes that page edge-cacheable *precisely* by asserting nothing about stock.

**Decided: Option A (Uncached stock fragment).**
The product page stays edge-cached and asserts no stock in its static HTML; a small client fetch
calls `/stock/:slug` (an uncached endpoint with `Cache-Control: private, no-store` that never sets cookies)
to populate live stock availability and update variant chips/buttons.

Checkout is blocked when stock is zero via atomic stock check and guarded relative decrement
inside `db.transaction()`. Recorded in `docs/adr/0009-uncached-stock-fragment-for-compliance.md`.

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
- **Schema:** `products.origin_country`, `products.material`, `products.measurements`, `products.returns_policy`.
- **Admin:** fields on product creation (bulk) and the product editor. The storefront-visibility toggle refuses to publish a product missing mandatory disclosure fields (origin, material, measurements).
- **Storefront:** rendered on `/p/:slug` in dropdown `<details>` accordions (Measurement, Origin & Material, Returns & Refunds Policy in Bangla, Delivery). Built mobile-first and mobile-only, consistent with existing quiet typography and paper/ink styling.

## 3. Policy pages, in Bengali **[GUIDELINE]**

Terms, and the return/refund/exchange policy, **written in Bengali**. Plus trade licence,
DBID, BIN and TIN displayed on the site.

- **Routes:** `/terms`, `/returns`, `/privacy`, `/contact` — static, server-rendered,
  edge-cacheable, no JavaScript, no cookie.
- **Bengali is the obligation**, so policy texts are authored in Bengali.
- **Statutory identifiers** (DBID, Trade Licence, BIN, TIN) displayed in the footer across all storefront pages, read from configuration.

## 4. Invoice, VAT and the Mushak 6.3 serial **[LAW once registered]**

The hardest correctness requirement here, and the one most easily got wrong quietly.

- **VAT rate is 10% by default (`vat_rate_bp = 1000`) and configurable on the admin panel** (`/admin/settings`).
- **Snapshot it onto the order at placement** in `orders.vat_rate_bp` and `orders.vat_paisa`.
- **Prices are VAT-inclusive on display and itemised on the invoice.** CRPA s.40:
  `vat_paisa = round(total_paisa × rate_bp / (10000 + rate_bp))`.
- **Round once, at the order, never per line.**
- **The serial is monotonic and gapless.** Allocated from single-row counter `invoice_sequence` inside the same placement `db.transaction()` as the order insert.
- Invoices recorded in `invoices` table and viewable/printable at `/order/:id/invoice`.

## 5. Delivery SLA, stored per order **[GUIDELINE]**

> **Moved to 0003_refunds plan.** Not implemented in this plan.

## 6. Complaints **[GUIDELINE]**

> **Moved to 0003_refunds plan.** Not implemented in this plan.

## 7. Reviews **[GUIDELINE]**

> **Moved to 0003_refunds plan.** Not implemented in this plan.

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

| Order | Work | Status |
|---|---|---|
| 0 | **§1 decision: Option A** | Settled & built: live stock fragment on `/stock/:slug`, checkout blocked on 0 stock. |
| 1 | **§2 product disclosures** | Settled & built: Origin, material, measurements, and Bengali returns policy as dropdowns; admin entry & publication gate. |
| 2 | **§3 policy pages in Bengali** | Settled & built: `/terms`, `/returns`, `/privacy`, `/contact` and footer statutory identifiers. |
| 3 | **§4 invoice, VAT and serial** | Settled & built: 10% default VAT, admin configuration, gapless monotonic Mushak 6.3 serial, and invoice view. |
| 4 | **§8 consent & redaction, §9 retention** | Settled & built: PDPA checkout consent, admin rectification audit trail, deletion as redaction, retention export. |
| 5 | **§10 SMS interface** | Built: Internal interface with Bengali copy and logging no-op provider. |
| - | **§5 delivery SLA, §6 complaints, §7 reviews** | Moved to `0003-refunds.md` (deferred). |

## Before any of this is relied on

The three items in `docs/COMPLIANCE.md` needing a local consultant — the current VAT rate,
whether the 5/10-day clock binds pure-COD orders, and whether the PDPA mandates breach
notification — are not engineering questions and are not answerable from here. §4 in
particular should not ship against a guessed rate.
