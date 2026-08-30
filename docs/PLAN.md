# Butterloom Build Plan

Status: draft for review. Nothing in here is implemented yet.

This plan covers what to build, in what order, and which decisions are still open.
It assumes the decisions already recorded in `docs/adr/` and the vocabulary in
`CONTEXT.md`. Where this document and an ADR disagree, the ADR wins.

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

Customer accounts and order history logins, wishlists, reviews, discount codes, multi-
currency, multi-language (see open decisions), marketplace/multi-vendor, loyalty, and
any analytics beyond basic traffic. Each is easy to add later on the model below; none
earns its complexity before the first hundred orders.

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

The app needs a server runtime. Considerations specific to this project:

- **Latency to Dhaka.** Singapore or Mumbai regions are meaningfully closer than US or
  EU. This matters more than raw server specs at this scale.
- **A stable outbound IP may become mandatory.** ADR 0003 flags an unresolved question
  about whether bKash allowlists merchant IPs on production credentials. If they do,
  rotating-IP serverless platforms are disqualified for that integration. **Confirm this
  with bKash before committing to a host** — it is cheap to ask now and expensive to
  discover after building.
- A small VPS with a fixed IP sidesteps the risk entirely and is inexpensive; the cost
  is that patching and uptime become yours.

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
- **Bangla and Latin text must sit together comfortably.** Whatever typeface is chosen
  needs real Bangla coverage, or a properly paired Bangla face with matched metrics.
  This constrains the typographic choice more than anything else and should be settled
  before a typeface is picked, not after.
- **Photography is the actual design problem.** For a clothing brand, product imagery
  carries more of the visual identity than any typographic decision. The current catalog
  has no images at all. Consistent shot framing, background and colour treatment will do
  more for perceived quality than any amount of CSS.
- Mobile-first, and tested on real mid-range Android at throttled speeds — that is the
  actual customer device, and ADR 0002 exists precisely because of it.

---

## 9. Getting products into the system

An operator must be able to add a product without a developer. This is the workflow that
decides whether the business can run without you.

v1: admin CRUD for Products, Variants and stock, with image upload. Images resized on
upload and served in a modern format — an unoptimised phone photo is several megabytes
and would undo the page-weight advantage that decided ADR 0002.

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
Backups with a tested restore, error monitoring, rate limiting, the legal and content
pages, performance pass on real mid-range Android, and retiring `index.html`.
**Done when:** losing the server would cost no orders, and the legacy demo is gone.

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
| 1 | **Storefront language** — Bangla, English, or both? | English-first with Bangla product names, if your customers are the urban Dhaka segment that shops online in English. This decides the typeface and whether an i18n layer is needed at all — retrofitting one is disproportionately painful, so it is the most urgent question here. |
| 2 | **Delivery charge model** | Flat inside Dhaka, higher outside, free over a threshold. Confirm the actual figures you intend to charge — they belong in configuration, not code. |
| 3 | **Hosting and database** | A fixed-IP VPS in Singapore with Postgres, unless you would rather trade cost for not operating a server. Interacts with the unresolved bKash IP question. |
| 4 | **VAT treatment** | Pending the compliance research now running; the answer determines whether displayed prices are VAT-inclusive. |
| 5 | **Return and exchange policy** | Needed as customer-facing content and as an order state. Bangladeshi e-commerce regulation may mandate minimums — pending the same research. |
| 6 | **Anti-refusal measure** | Operator phone confirmation for v1; consider OTP verification, or partial advance for high-value orders, once you can see your actual refusal rate. |
| 7 | **Guest checkout only, or customer accounts?** | Guest only, with order lookup by phone plus order number. Accounts add auth surface and password-reset flows for little v1 benefit. |
| 8 | **Product photography** | The single largest quality lever and entirely outside code. Worth resolving in parallel with Phase 0–1 rather than after. |
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
