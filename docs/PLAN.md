# Butterloom Build Plan

Status: draft for review. Nothing in here is implemented yet.

This plan covers what to build, in what order, and which decisions are still open.
It assumes the decisions already recorded in `docs/adr/` and the vocabulary in
`CONTEXT.md`. Where this document and an ADR disagree, the ADR wins.

Companion documents: `docs/DATA-MODEL.md` (the schema), `docs/COMPLIANCE.md` (the
regulatory obligations that shape it — several are load-bearing, not paperwork) and
`docs/DEPLOYMENT.md` (how it runs in production).

---

## 1. What Butterloom must do

Two audiences, and the plan is organised around their jobs rather than around screens.

**A customer in Dhaka wants to:** browse a small, well-photographed collection; know
whether their size is actually in stock; understand the delivery charge and timeline
before committing; order without creating an account; pay cash when the parcel arrives;
and find out where their order is without phoning anyone.

**An operator (there are two) wants to:** see new orders the moment they arrive; confirm
they are real; know what to pick and pack; hand parcels to the courier and record which
consignment carries which order; adjust stock when reality diverges from the system;
and reconcile the cash the courier eventually remits against the orders it came from.

Everything below serves one of those. Anything that serves neither is out of scope for v1.

### Explicitly out of scope for v1

Customer accounts and order-history logins, wishlists, discount codes, multi-currency,
marketplace/multi-vendor, loyalty, and any analytics beyond basic traffic. Each is easy to
add later on the model below; none earns its complexity before the first hundred orders.

**Corrected after the compliance review:** *reviews* were listed here as out of scope and
are not — customer-visible reviews are required, and negative reviews may not be deleted.
So are a complaints workflow with a 72-hour resolution deadline, an invoice record, and a
delivery SLA timer. See `docs/COMPLIANCE.md`; they are modelled in `docs/DATA-MODEL.md` §6.
The storefront is **English only** (ADR 0006), with an optional operator-entered
alternative product name. Note that this does *not* remove two Bengali obligations: the
terms and return policy must be written in Bengali, and transactional SMS must be Bengali
with Latin OTP codes and numbers. Both are authored content, needing no i18n layer.

---

## 2. Money rules

Amounts are **whole Bangladeshi taka, stored as integers**. There is no poisha anywhere
in the system — not in storage, not in calculation, not in display.

This is a change from what is currently on disk: `src/lib/money.js` was written around
integer *minor units* (poisha) and asserts them. It must be rewritten to treat the
integer as taka, and its `formatMoney` must render without decimal places. Until that
happens, treat that file as stale.

**Rules that must hold:**

1. **No floating point in any money path.** Integer taka only.
2. **Multiplication before division.** Percentages (a COD fee, VAT, a discount) are
   applied as basis points using integer arithmetic, rounded once.
3. **Round half up, to the nearest taka, at the order level — not per line.** Line
   totals are exact (`unit price x quantity`, both integers, no rounding possible).
   Percentages apply to the order subtotal and round once. Rounding each line
   independently makes the displayed lines fail to sum to the displayed total, which
   customers notice and operators cannot explain.
4. **Every amount on an Order is a snapshot, written once at placement.** Unit prices,
   delivery charge and total are copied onto the Order and never recomputed from live
   Product data. A price change tomorrow must not alter what yesterday's customer owes.
   This is the single most important invariant in the system.
5. **Displayed price is the price charged.** Whatever VAT treatment is chosen (see open
   decisions), the number on the product card is the number the customer pays for the
   goods, with delivery shown separately and added visibly before confirmation.

**Amounts an Order carries:** goods subtotal, delivery charge, discount (zero in v1),
total, and amount to collect. For a pure COD order, `amount to collect` equals `total`;
for an order settled in advance it is zero. Keeping it a separate stored field rather
than deriving it means partial advance payments (a likely anti-COD-abuse measure) need
no schema change.

**Not customer-facing, but must be recorded:** the courier's delivery fee and COD
percentage are costs to Butterloom deducted at Settlement. They belong on the
Consignment, not the Order, and they are margin accounting — never shown to the customer.

---

## 3. Domain model

Entities, and the invariants that matter. Names follow `CONTEXT.md`.

### Catalog

- **Product** — the merchandising unit a customer browses: title, slug, description,
  fabric and care notes, collection, publication status. A Product is never itself
  purchasable.
- **Variant** — the purchasable unit: belongs to a Product, carries size, colour, SKU,
  **price**, and stock. Price lives here, not on Product, so a 3XL can cost more than an
  S without special-casing. Every add-to-cart references a Variant.
- **Media** — ordered images per Product, with alt text as a required field rather than
  an optional one.

> Clothing without variants is the mistake the legacy `index.html` makes — it has a
> single stock number per product, which cannot express "we have M and L but not S."

### Inventory

- **Variant stock** is held as two numbers: **on hand** (physically in the room) and
  **reserved** (promised to placed orders not yet dispatched). What the storefront shows
  as available is `on hand - reserved`.
- **Stock movement** — an append-only log of every change: delta, reason (order reserved,
  order dispatched, order returned, manual correction, restock), the order or operator
  responsible, and a timestamp. Current stock must be reconcilable from this log. When
  an operator asks "why does the system think we have four," the answer has to exist.

### Ordering

- **Customer** — identified by **phone number**, which is the real identity key in this
  market. Name required; email optional and not used for authentication.
- **Delivery Address** — recipient name, recipient phone, free-text street address, plus
  the **Delivery Area** triple (city / zone / area) the courier routes on. Both the IDs
  and the human-readable names are stored, because IDs are meaningless in a printed
  packing slip and names alone cannot be sent to the courier.
- **Order** — an immutable commercial record plus a mutable status. Carries an order
  number customers can quote, a snapshot of the customer and address, the money snapshot
  from section 2, payment method, and timestamps per state entered.
- **Order line** — variant reference plus **snapshots** of title, SKU and unit price, and
  the quantity. Snapshots so a renamed or deleted product cannot corrupt order history.
- **Payment** — method (cash on delivery, MFS, card), status, amount, and provider
  reference. Modelled from day one even though v1 only ever writes `cash on delivery`,
  because retrofitting a payment table under live orders is painful.
- **Consignment** — the courier's record: courier name, consignment ID, current courier
  status, delivery fee, amount to collect, settlement reference. One Order has at most
  one *active* Consignment, but may have several over time if a delivery fails and is
  re-attempted.

### Operations

- **Staff user** — email, password hash, role, active flag. Real credentials; see §6.
- **Audit event** — actor, action, subject, before/after values, timestamp. Every stock
  change, price change, order status change and refund is recorded. With two operators
  and cash moving through third parties, "who marked this delivered" must be answerable.

### Invariants to enforce in code, not by convention

1. Available stock never goes negative.
2. Order money fields are written once and never updated by catalog changes.
3. Status transitions follow the state machine in §4; no arbitrary status assignment.
4. Reserved stock across all open orders reconciles to the sum of undispatched lines.
5. Every stock change has a corresponding stock movement row.

---

## 4. Order lifecycle

The state machine, and who may advance it. COD makes this materially different from a
card-first store: **payment happens at the end, and a meaningful share of orders never
get paid at all.**

```
                    ┌─────────► cancelled ◄──────┐
                    │            (pre-dispatch)  │
                    │                            │
  [cart] ──► pending_confirmation ──► confirmed ──► packed ──► dispatched
                    │                                              │
                    │                                              ▼
                    │                                         in_transit
                    │                                              │
                    │                         ┌────────────────────┤
                    │                         ▼                    ▼
                    │                    delivered           delivery_failed
                    │                         │                    │
                    │                         ▼                    ▼
                    └──────────────────►  settled            returned
```

| State | Meaning | Stock effect |
|---|---|---|
| `pending_confirmation` | Received from the storefront, not yet verified | Reserve |
| `confirmed` | Operator (or OTP) verified the order is genuine | Hold reservation |
| `packed` | Picked and packed, awaiting courier | Hold reservation |
| `dispatched` | Handed to Courier, Consignment created | Reservation → on-hand decrement |
| `in_transit` | Courier has it | — |
| `delivered` | Customer received it, cash collected by Courier | — |
| `settled` | Cash remitted to Butterloom and reconciled | — |
| `delivery_failed` | Refused or undeliverable | — |
| `returned` | Parcel physically back | Restock on hand |
| `cancelled` | Killed before dispatch | Release reservation |

**Why `delivered` and `settled` are separate states:** the customer has the goods days or
weeks before the courier remits the cash, and reconciliation is manual because the courier
exposes no settlement API (ADR 0003). Collapsing these two hides exactly the gap where
money goes missing.

**Why `pending_confirmation` exists:** COD order refusal is the defining operational risk
of this market. A confirmation step — an operator call, or an OTP — before committing
stock and courier cost is standard practice and the cheapest possible mitigation.

---

## 5. Architecture

A single SvelteKit application containing storefront, admin and server routes, deployed
with a server runtime (ADR 0003). One codebase, one deploy, one place secrets live.

```
src/
  lib/
    server/          ← never reaches the browser (SvelteKit enforces this at build time)
      db/            schema, migrations, queries
      auth/          staff sessions
      orders/        placement, state machine, stock movements
      integrations/  courier and payment adapters (§7)
    domain/          pure logic: money, pricing, state machine  ← the tested core
    ui/              presentational components
  routes/
    (shop)/          storefront — prerendered where content allows
    admin/           operator dashboard — always server-rendered, auth-gated
    api/             endpoints the storefront calls; later, courier webhooks
```

Two structural properties worth stating because they are the reason this layout is
chosen and not just taste:

**`$lib/server` is a build-time guarantee, not a naming convention.** SvelteKit refuses
to bundle anything under it into client code. Every credential and every third-party call
lives there, so the class of bug where an API key leaks into a JS bundle is prevented by
the toolchain rather than by review discipline.

**`lib/domain` has no imports from SvelteKit, the database, or the network.** Money
arithmetic, pricing, and the order state machine are pure functions over plain data. They
are the parts where a bug costs money, and purity is what makes them exhaustively
testable without a running app.

### Recommended libraries

"Custom" means our composition, not our reimplementation of solved problems.

| Need | Choice | Why |
|---|---|---|
| Database access | **Drizzle ORM** | SQL-shaped, TypeScript types from schema, migrations included, no hidden query magic |
| Validation | **Valibot** | Same idea as Zod, far smaller bundle — matters given ADR 0002 |
| Forms | **sveltekit-superforms** | Server-validated progressive-enhancement forms; removes the largest slice of hand-written checkout plumbing |
| Staff auth | **Better Auth** | Actively maintained, sessions and password hashing done correctly |
| Components | **Bits UI** / shadcn-svelte | Headless and accessible; keyboard and focus handling we should not write |
| Styling | **Tailwind CSS v4** | Its `@theme` compiles to CSS custom properties, which is exactly the token indirection §8 needs |
| Unit tests | **Vitest** | Fast, native to Vite |
| E2E | **Playwright** | Already available in this environment |

Deliberately *not* adopted: a headless commerce SDK. Having rejected the platforms in
ADR 0001, adding one back as a dependency would import their product model through the
side door.

---

## 6. Storage, hosting and staff access

### Database

**Recommendation: PostgreSQL.** Not because the volume demands it — it will not for a
long time — but because the two operations most likely to corrupt this business are
concurrent stock decrements and order placement, and both want real transactions with
row-level locking. Postgres also makes the eventual COD reconciliation reporting
straightforward.

SQLite (via Turso or a local file with Litestream replication) is a legitimate
alternative and genuinely simpler to operate and back up. It is a reasonable choice if
hosting is a single VPS and write concurrency stays low. The decision is recorded as
open in §12 because it depends on the hosting answer.

Whichever is chosen: **migrations are checked into the repo from the first table**, and
**automated restore-tested backups exist before the first real order.** An untested
backup is not a backup, and the entire order history is the business.

### Hosting

**Settled: a single self-managed VPS with a fixed IP, running the app, Postgres and a
reverse proxy** — ADR 0007, with the full topology, deploy pipeline, migration discipline,
backup strategy and server baseline in `docs/DEPLOYMENT.md`.

The fixed IP is the load-bearing part rather than the cost saving: ADR 0003 leaves open
whether bKash allowlists merchant IPs on production credentials, and a fixed address
removes that risk instead of betting on the answer.

One sub-decision remains open — **the region**. Mumbai is geographically closer to Dhaka
than Singapore, but Bangladeshi international traffic routes over submarine cables that
often favour Singapore. Measure both from an actual Dhaka connection rather than choosing
from a map.

### Staff access

Two operators, both trusted at admin level, no row-level security (per your answer) — so
authorisation stays simple: authenticated staff can do staff things. But **simple is not
the same as absent.** The legacy dropdown-with-no-password must not survive into a system
holding customer addresses and phone numbers.

Minimum viable and sufficient: email plus password, properly hashed, server-side sessions
in httpOnly cookies, rate-limited login, and an audit trail attributing every action to a
named person. Roles can stay a single `admin` value; the column should exist so a packer
or a part-time helper can be added later without a migration under live data.

---

## 7. Integrations: deferred, but shaped now

bKash and Pathao are out of scope for this session. The plan still fixes *where they
attach*, because retrofitting an integration boundary is expensive and designing one
against known requirements is nearly free.

Both sit behind a port in `lib/server/integrations`, with the domain talking only to the
port:

**Courier port** — `quoteDelivery(area, weight)`, `createConsignment(order)`,
`getStatus(consignmentId)`, and an inbound `handleStatusWebhook(payload)`. Implementations:
a manual adapter for v1 (an operator types the consignment number from the courier's own
dashboard), Pathao later. The manual adapter is not a stub — it is how the business will
genuinely run for the first weeks, and it keeps the Consignment record populated so the
Pathao adapter later changes only *how* it gets filled.

**Payment port** — `methods()`, `initiate(order)`, `confirm(reference)`, `refund(payment)`.
Implementations: cash on delivery for v1, bKash later.

Constraints already known from ADR 0003 that the design must respect when those land:

- The bKash token is a **shared, server-held, cached resource** with a hard limit of two
  grant calls per hour. It must be a single cached instance with refresh scheduled well
  before expiry — never minted per request, per user, or per server instance without
  coordination. A naive implementation locks the merchant out of their payment gateway.
- Courier order creation must be **idempotent on our order number**. Pathao's CORS
  behaviour proved that a request can succeed on their side while appearing to fail on
  ours; a blind retry would create a second consignment for the same parcel. Every
  create must carry our order reference and check for an existing consignment first.
- Webhook receivers need signature verification and must respond within the courier's
  timeout, so they acknowledge first and process afterwards.

Building the manual adapter first is therefore not a compromise. It exercises the same
port the real one will use.

---

## 8. Design system, before there is a design

No logo, typeface or palette exists. That is fine, and it does not block structure —
provided nothing hardcodes a design decision.

**The rule: components reference tokens, never literal values.** Every colour, spacing
step, radius, shadow and type size resolves through a named CSS custom property. Adopting
a real identity later is then a matter of redefining tokens in one file, not editing
components.

Token groundwork worth doing before any visual direction is chosen, because it is true
regardless of the eventual look:

- A type scale and a spacing scale, both as tokens.
- Semantic colour roles (`surface`, `ink`, `accent`, `danger`, `success`) rather than
  literal names, so a palette swap does not require renaming anything.
- **Bangla coverage is still required**, despite the English-only storefront: the terms
  and return policy must be published in Bengali, and operators may enter Bangla
  alternative product names. Either the chosen typeface covers Bangla, or a properly
  paired Bangla face with matched metrics does. Settle this before picking a typeface.
- **Photography is the actual design problem.** For a clothing brand, product imagery
  carries more of the visual identity than any typographic decision. The current catalog
  has no images at all. Consistent shot framing, background and colour treatment will do
  more for perceived quality than any amount of CSS.
- Mobile-first, and tested on real mid-range Android at throttled speeds — that is the
  actual customer device, and ADR 0002 exists precisely because of it.

---

## 9. Getting products into the system

An operator must be able to add a product, photograph it and put it live without a
developer. This is the workflow that decides whether the business can run without you,
and it is worth more care than a generic CRUD screen.

**Content is not deployed.** Products, photographs, prices and stock are live data. Adding
a product or swapping an image takes effect immediately on save — there is no build, no
release and no waiting. The only thing a deploy carries is code.

### Image handling — the part operators touch most

- **Drag-and-drop, multiple files at once**, with visible per-file progress. Uploads
  happen over Dhaka mobile connections; a silent upload that may or may not be working is
  the single most frustrating thing in an admin.
- **Resilient to flaky connections.** A dropped upload retries or resumes rather than
  losing the batch and making the operator start again.
- **Resized and converted on upload**, to a set of derivatives plus a preserved original.
  An unmodified phone photo is several megabytes and would undo the page-weight advantage
  that decided ADR 0002. The operator should never have to think about file size, format
  or dimensions.
- **Reorder by dragging**, and set which image is primary. Order is merchandising, so it
  belongs to the operator, not to upload sequence.
- **Alt text prompted at upload**, not buried in a secondary screen — it is required
  content **[C]**, and it is only ever written if the interface asks at the moment the
  image arrives.
- **Replace an image in place**, keeping its position, so a better shot of the same
  garment does not mean rebuilding the gallery.

### Preview before publishing

A Product is `draft` until published. A draft is viewable at its real product URL by an
authenticated operator — **the actual page, not an admin approximation** — so what is
checked is what customers will see. Publishing is a status change on that same record.

The same applies to edits on a live product: an operator should be able to see a change
before it is visible to customers. The simplest form that genuinely works is an explicit
save, with the draft preview available up to that point.

### Everything else

Bulk stock adjustment matters more than it sounds — after a stocktake, correcting twenty
variants one form at a time is how stock records stop being maintained.

Seed data lives in the repo as a fixture so a fresh environment is immediately useful for
development and testing.

---

## 10. Testing

There are no tests today. Given money and stock, three areas are non-negotiable, and all
three are pure functions in `lib/domain` — cheap to test precisely because of §5.

1. **Money arithmetic.** Rounding at boundaries, percentage application, totals summing
   to displayed lines, snapshot immutability.
2. **The order state machine.** Every legal transition, and explicit assertions that
   illegal ones are rejected — particularly cancelling after dispatch and double-delivery.
3. **Stock.** Reserve, release, dispatch and restock paths; concurrent placement against
   the last unit must not oversell. This one needs a real database and a concurrency
   test, not a unit test.

Then a small set of Playwright journeys: browse → add to cart → checkout → order appears
in admin; and an out-of-stock path. Enough to catch a broken checkout before a customer
does, without a suite that resists change.

CI runs unit tests and typechecking on every push. This repo currently has no CI at all.

---

## 11. Sequencing

Phases are ordered so that each one ends somewhere usable, and so the riskiest
assumptions are tested earliest. Every phase ends with something demonstrable, not with
a layer.

### Phase 0 — Foundations
SvelteKit app scaffolded alongside the legacy `index.html` rather than replacing it;
database, schema and migrations; design tokens; CI running tests and typecheck; the
rewrite of `money.js` to whole taka with tests.
**Done when:** an empty but deployed app builds, migrates and passes CI.

### Phase 1 — Catalog
Product and Variant model, admin CRUD with image upload, storefront listing and product
detail with size selection and real stock display.
**Done when:** an operator can add a product with three sizes and photographs, and see it
correctly on the storefront, without developer help.

### Phase 2 — Ordering
Cart, checkout with the Delivery Area address model, COD order placement, stock
reservation, order confirmation page, order number.
**Done when:** a real order placed on a phone appears in the database with correct
snapshotted money and a reserved stock line. **This is the first phase that could take a
real customer.**

### Phase 3 — Operations
Admin order queue, the state machine wired to operator actions, manual courier adapter,
stock adjustment with movements, audit log.
**Done when:** both operators can run a day's orders end to end — confirm, pack, dispatch,
mark delivered — without touching the database.

### Phase 4 — Launch readiness
Backups with a tested restore, the provisioning script, error monitoring and alerting,
rate limiting, the legal and content pages, performance pass on real mid-range Android,
and retiring `index.html`. See `docs/DEPLOYMENT.md` §7 and §10.
**Done when:** losing the server would cost no orders — proven by an actual restore, not
by a backup job exiting zero — and the legacy demo is gone.

### Phase 5 — Integrations
Pathao adapter behind the existing courier port; then bKash behind the payment port,
gated on merchant onboarding, which has its own multi-week lead time and should be
**started early since it blocks nothing else.**

The honest sequencing note: **Phase 2 is the first point of real value and Phase 3 is the
first point of real usability.** Phases 0 and 1 are unavoidable but produce nothing
sellable, which is the cost of the ADR 0001 decision to build custom.

---

## 12. Open decisions

These need your answer. Each is listed with what I would choose and why, so a
non-response can default sensibly rather than block.

| # | Decision | Recommendation |
|---|---|---|
| 1 | ~~Storefront language~~ | **Settled: English only** (ADR 0006), with an optional alternative product name operators can enter. The typeface must still carry Bangla coverage — for the mandatory Bengali policy pages and for those alternative names. |
| 2 | **Delivery charge model** | Flat inside Dhaka, higher outside, free over a threshold. Confirm the actual figures you intend to charge — they belong in configuration, not code. |
| 3 | ~~Hosting and database~~ | **Settled: a single self-managed VPS with Postgres** (ADR 0007); see `docs/DEPLOYMENT.md`. Region still needs measuring from a Dhaka connection — Mumbai is closer on a map but cable routing often favours Singapore. |
| 4 | ~~VAT treatment~~ | **Settled: display VAT-inclusive, itemise on the invoice.** Charging above the displayed price is an offence (CRPA s.40). The *rate* remains open and must be configurable — it moved 7.5% → 15% → 10% within January 2025; confirm the current figure with a VAT consultant. |
| 5 | ~~Return and exchange policy~~ | **Settled: exchange only, on every payment method.** Size or colour exchange within a stated window; cash refunds only where regulation compels them — failed delivery, defective, wrong item — within **10 days** via the same channel paid, plus 48h-notify / 72h-refund for force majeure. Policy **must be published in Bengali**. Two sub-items still open: the exchange **window in days**, and **who pays return shipping** — both pending the market research. |
| 6 | **Anti-refusal measure** | Operator phone confirmation for v1, plus a pre-dispatch courier fraud-check gate (`cod_risk_checks`). Note the legal ceiling: advance payment above **10%** is not permitted for goods not shippable within 48h, so partial-advance is available only for in-stock inventory. |
| 7 | ~~Guest checkout or accounts~~ | **Settled: guest only**, with order lookup by phone plus order number. A Customer record is still created keyed on phone, so repeat recognition and COD blocking work without anyone signing in. Accounts later need one credentials table. |
| 8 | ~~Product photography~~ | **Out of scope as a project decision** — how photographs get made is Butterloom's own call. What this project owes is that managing them is easy: drag-and-drop upload with progress, automatic resizing, drag reordering, alt text prompted at upload, in-place replacement, and draft preview at the real product URL before publishing. See §9. |
| 9 | **Operator roles** | Who are the two people, and does either need restricting later? Affects nothing now if the role column exists from the start. |

---

## 13. Risks

**COD refusal rate.** The defining risk. Every refused order costs two courier legs plus
tied-up stock, and it is not recoverable in software — only mitigated by confirmation
discipline. Instrument it from day one so the real rate is known rather than guessed.

**Overselling.** Two customers buying the last piece is a guaranteed bad experience and a
manual apology. Mitigated by transactional reservation, and it is why Postgres is
recommended in §6.

**Data loss.** The order history *is* the business, including money owed but not yet
settled. Untested backups are the most common way small operations lose everything.

**Bus factor.** Two operators and one technical person. The plan mitigates this by
insisting operators can do their jobs through the admin UI rather than through you.

**bKash onboarding lead time.** Weeks, and it needs a trade licence. It gates Phase 5
only, so start it now and let it run in the background.

**Scope drift into platform territory.** ADR 0001 chose to build custom. Each "small"
addition — discount codes, wishlists, loyalty — is a feature a platform gives free. Ship
the phases above before entertaining any of them.

---

## 14. Repository changes this plan implies

- **`src/lib/money.js` is stale.** Written for integer minor units; must become whole
  taka. Do not build on it as-is.
- **`index.html`** remains the only running thing and stays until Phase 4, per the
  working style in `CLAUDE.md`.
- **`.nojekyll`** exists only for GitHub Pages previews. Harmless to keep; irrelevant
  once the app deploys to a server runtime.
- **No CI exists.** Phase 0 adds it.
- **`README.md`** still describes the legacy static demo and will mislead; rewrite in
  Phase 0.
