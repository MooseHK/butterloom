# Butterloom Data Model

Status: **revised after review.** Not implemented.

Conventions: every table has `id`, `created_at`, `updated_at` unless stated. Money is
`integer` whole taka — no poisha. Locales are `en` (default) and `bn`. Requirements marked
**[C]** are compliance-driven; see `docs/COMPLIANCE.md` for the source and tier.

Settled in review: the storefront is **English only**, with an optional operator-entered
alternative product name; variants use a **generic option system**; and the cart lives in
the **browser**.

---

## 1. Language

**The storefront is English.** There is no localisation layer: no locale column, no
per-locale tables, no translation fallback, no i18n library.

Operators may enter an **optional alternative name** on a Product (`title_alt`) — typically
the Bangla name — displayed alongside the English one. It is a single nullable column of
authored text, not a translation system, and it carries no expectation that anything else
on the page is translated.

### Two Bengali requirements survive this, independently **[C]**

Dropping bilingual UI does not drop these, because neither depends on the storefront's
language:

1. **Terms, and the return/refund/exchange policy, must be written in Bengali.** Other
   languages are permitted in addition, but Bengali is required. These are two authored
   documents, not a translated interface.
2. **Transactional SMS must be in Bengali**, with OTP codes, numbers and URLs left in
   Latin script — a BTRC directive in force since March 2022, and unrelated to what
   language the website is in.

Both are hand-authored artefacts: a static policy page and a set of SMS templates. Neither
needs locale machinery. The consequence for design is narrow but real — **the chosen
typeface must still carry Bangla coverage**, for those policy pages and for alternative
product names.

---

## 2. Catalog

### `collections`
`slug` (unique), `title`, `description`, `status` (`draft｜active｜archived`), `position`

### `products`
| Column | Notes |
|---|---|
| `slug` | unique, ASCII, locale-neutral URL identity |
| `collection_id` | fk nullable |
| `title` | |
| `title_alt` | nullable — operator-entered alternative name, typically Bangla |
| `subtitle` | |
| `description` | |
| `material` | **[C]** mandatory pre-purchase disclosure |
| `measurements` | **[C]** mandatory |
| `country_of_origin` | **[C]** mandatory; ISO code |
| `care` | |
| `status` | `draft｜active｜archived` — never hard-delete an ordered product |
| `position`, `published_at` | |

A Product is **not purchasable**. It is the merchandising unit a customer browses.

### Variant options — generic axes

Sizes and colours are not special-cased. A Product declares its own axes, so fabric,
sleeve length or set-versus-piece can be added later without a migration.

```
products
  └─ product_options            (Size, Colour, Fabric …)   position
       └─ product_option_values (M, Maroon, Silk …)        position
              ▲
              │  variant_option_values  (join)
              ▼
         variants
```

**`product_options`** — `product_id`, `name`, `position`

**`product_option_values`** — `option_id`, `value`, `hex` (nullable, for colour swatches),
`position`

**`variant_option_values`** — PK (`variant_id`, `option_value_id`)

### `variants`
| Column | Notes |
|---|---|
| `product_id` | |
| `sku` | unique, operator-facing, appears on packing slips |
| `option_signature` | **see below** |
| `price_taka` | int — price lives here, so a 3XL can cost more than an S |
| `compare_at_taka` | int nullable |
| `weight_grams` | int, required — the courier quotes on weight |
| `on_hand` | int, physically present |
| `reserved` | int, promised to placed but undispatched orders |
| `status` | `active｜archived` |

Constraints: `on_hand >= 0`, `reserved >= 0`, `reserved <= on_hand`,
**`unique(product_id, option_signature)`**.

**`option_signature` is the price of choosing generic options.** A join table cannot express
"no two variants of a product may share the same combination of option values" as a database
constraint, so duplicates become an application-logic problem — and application logic loses
races. The signature is a deterministic string built from the variant's option value IDs
sorted ascending (e.g. `12-47`), written in the same transaction as the join rows. That
restores a real uniqueness guarantee at the database level.

It must be recomputed whenever a variant's option values change, and it is derived data —
if it ever disagrees with `variant_option_values`, the join table is the truth.

Available stock, everywhere, is `on_hand - reserved`.

### `media`
`product_id`, `variant_id` (nullable — a shot may be specific to one colour), `path`,
`width`, `height`, `position`, `is_primary`, `alt_text`

Alt text is authored content and required, not optional.

---

## 3. Inventory

### `stock_movements`
Append-only. Current stock must be reconcilable from this log; where the counters on
`variants` disagree with the sum here, the log is right.

`variant_id`, `on_hand_delta` (signed, default 0), `reserved_delta` (signed, default 0),
`reason` (`initial｜reserve｜release｜dispatch｜restock｜correction｜return`),
`order_id` (nullable), `staff_user_id` (nullable), `note` (required for `correction`)

Two delta columns rather than one, because reserving stock and shipping it move different
counters and a single `delta` cannot express both.

| Event | `on_hand_delta` | `reserved_delta` |
|---|---|---|
| Order placed | 0 | `+qty` |
| Order cancelled | 0 | `-qty` |
| Order dispatched | `-qty` | `-qty` |
| Parcel returned | `+qty` | 0 |

**[C]** Live stock must be shown on the product page, and checkout must be blocked at zero.

---

## 4. Customers, addresses and consent

### `customers`
`phone` (unique, normalised), `name`, `email` (nullable),
`blocked` (bool), `blocked_reason`, `internal_note`

**Phone is the identity key**, not email. Guest checkout still matches or creates a
customer row by phone, which is what makes repeat recognition and COD-abuse blocking
possible without a later migration. Normalise: `01712345678`, `+8801712345678` and
`8801712345678` are one customer.

### `addresses`
`customer_id`, `recipient_name`, `recipient_phone`, `street_address` (verbatim),
`landmark` (nullable — genuinely used for navigation in Dhaka), `courier_namespace`,
`city_id` / `zone_id` / `area_id`, `city_name` / `zone_name` / `area_name`

IDs are what the courier API accepts; names are what a packing slip and a human need.
`courier_namespace` exists because those IDs are one courier's numbering — switching
couriers invalidates them, and silently reusing them would misroute parcels.

### `consents` **[C]**
`customer_id` (nullable — consent may precede a customer record), `purpose`,
`policy_version`, `granted` (bool), `granted_at`, `withdrawn_at`, `ip`, `user_agent`

Consent must be timestamped and **versioned against the policy text in force at the time**.
A boolean column on `customers` cannot answer "what exactly did they agree to, and when",
which is the question the regulator asks. Append-only; withdrawal writes a new row.

**[C]** Rectification requests must be satisfiable within 30 days. Erasure applies only to
data outside the six-year mandated set, so deletion is implemented as **scoped redaction,
never `DELETE`** — see §8.

---

## 5. Orders

### `orders`
| Column | Notes |
|---|---|
| `order_number` | unique, human-quotable, e.g. `BL-26-0042` |
| `customer_id` | fk |
| `status` | see `docs/PLAN.md` §4 |
| `payment_method` | `cod｜bkash｜card` |
| `subtotal_taka`, `delivery_charge_taka`, `discount_taka`, `total_taka` | int |
| `vat_rate_bp`, `vat_amount_taka` | **[C]** rate stored per order — it has changed twice in a year |
| `amount_to_collect_taka` | equals `total` for pure COD, `0` if prepaid |
| customer snapshot | `customer_name`, `customer_phone`, `customer_email` |
| address snapshot | every field from `addresses`, copied |
| `sla_due_at` | **[C]** placement + 5 days inside the city, 10 outside |
| `handover_due_at` | **[C]** payment + 48h, for prepaid orders |
| `sla_breached` | bool, set by a scheduled check |
| `return_policy_version` | **[C]** which published policy governs this order |
| `customer_note`, `internal_note`, `cancellation_reason` | |

**Everything commercial is a snapshot, written once.** Money, VAT rate, customer details
and address are copied at placement and never recomputed. A price change tomorrow, or a
customer editing a saved address, must not alter a placed order.

`vat_rate_bp` is stored per order rather than read from settings at render time for the
same reason — reprinting an old invoice must reproduce the original tax treatment.

### `order_lines`
`order_id`, `variant_id` (fk, `ON DELETE SET NULL` — the reference is a convenience, the
snapshot is the truth), `sku`, `title`, `title_alt`, `options_label`, `unit_price_taka`,
`quantity`, `line_total_taka`

`options_label` is the flattened option combination (`M · Maroon`) at time of order, so a
renamed option value cannot alter order history. `title_alt` is snapshotted alongside
`title` because it is displayed to the customer and therefore part of what they bought.

### `order_events`
Append-only: `order_id`, `from_status`, `to_status`, `actor_type` (`staff｜system｜customer`),
`actor_id`, `note`. The authoritative history; denormalised `confirmed_at` /
`dispatched_at` / `delivered_at` on `orders` are query conveniences derived from it.

### `payments`
`order_id`, `method`, `status` (`pending｜paid｜failed｜refunded`), `amount_taka`,
`provider`, `provider_reference`, `paid_at`, `raw_payload` (jsonb)

Modelled from day one although v1 only ever writes `cod`; retrofitting under live orders
is materially harder than carrying an almost-empty table.

### `refunds` **[C]**
`order_id`, `payment_id` (nullable), `amount_taka`, `basis`, `reason`, `channel`,
`status`, `due_at`, `initiated_at`, `completed_at`, `transaction_charge_taka`

Refunds must go back through **the same channel** the customer paid by, within **10 days**
of a failed delivery, or **72 hours** in force-majeure cases after a 48-hour notification.
`due_at` makes the deadline queryable rather than remembered. The seller bears the
transaction charge, which is why it is recorded separately.

`basis` records *why* a refund was owed — `failed_delivery`, `defective` or `wrong_item`.
**Butterloom's policy is exchange only, on every payment method**, so a cash refund is
always a compelled one; there is no `change_of_mind` basis. A size or colour return
produces an exchange, which is a new fulfilment against the same order rather than a
`refunds` row.

Two consequences follow:

- **A refund's terms come from `orders.return_policy_version`, not from the policy in
  force today.** Published terms change; what a customer was promised at purchase is what
  they are owed. Same reasoning as the money snapshot in §5. This matters even under a
  narrow policy, because the exchange window is part of those terms.
- **"Same channel" has no clean meaning for cash.** A COD customer paid cash to a Courier,
  so refunding a defective item realistically means an MFS transfer or bank deposit.
  `channel` therefore records what was actually used and may legitimately differ from how
  the order was paid. Worth confirming the acceptable treatment with a local consultant,
  since the regulatory wording assumes an electronic original.

### `consignments`
`order_id`, `courier`, `consignment_ref`, `status`, `delivery_fee_taka`, `cod_fee_taka`,
`amount_to_collect_taka`, `idempotency_key`, `settlement_ref`, `settled_at`,
`raw_payload` (jsonb)

An Order may have several Consignments over time if delivery fails and is re-attempted,
but only one active. `idempotency_key` derives from the order number: ADR 0003 established
that a courier request can succeed on their side while appearing to fail on ours, so a
blind retry must not create a second parcel.

`delivery_fee_taka` and `cod_fee_taka` are **Butterloom's costs**, not customer-facing.
They live here rather than on the order because they are margin accounting.

---

## 6. Compliance surfaces that are also features

These were originally scoped out of v1 as "nice to have". They are not optional — each is
required by the Digital Commerce Operation Guidelines.

### `invoices` **[C]**
`order_id`, `serial` (unique, **monotonic**), `issued_at`, `supplier_name`,
`supplier_address`, `supplier_bin` (nullable), `buyer_name`, `buyer_address`,
`buyer_bin` (nullable), `line_snapshot` (jsonb), `subtotal_taka`, `vat_rate_bp`,
`vat_amount_taka`, `total_taka`, `authorised_by`

A receipt itemising VAT and other charges is required **regardless of VAT registration**.
The nine fields Mushak 6.3 mandates are carried from day one and lie dormant until a BIN
exists, so registering for VAT later is a configuration change rather than a rebuild.

The serial must be **monotonic and gapless** — that is a statutory property, so it cannot
be a random ID or a database sequence that rolls back with a failed transaction. Allocate
it in a dedicated counter row at issue time, not at order placement.

### `complaints` **[C]**
`order_id` (nullable), `customer_id`, `channel`, `subject`, `body`, `status`,
`opened_at`, `due_at` (opened + 72h), `assigned_staff_id`, `resolved_at`, `resolution_note`

Complaints must be acknowledged and resolved **within 72 hours**, with a named compliance
officer contactable on the site. `due_at` is stored so the queue can be sorted by urgency
and breaches alerted on, rather than discovered.

### `reviews` **[C]**
`product_id`, `customer_id`, `order_id` (nullable — verifies purchase), `rating`,
`body`, `status`, `removed_reason`, `removed_by`, `published_at`

**Negative reviews may not be deleted**, and nobody connected to the vendor may post one.
`status` is therefore deliberately narrow: `published`, or `removed_for_policy` with a
mandatory reason and actor recorded. There is no `hidden` state and no hard delete — the
schema should make suppressing bad feedback visibly auditable rather than convenient.

### `notifications` **[C]**
`order_id`, `customer_id`, `channel` (`sms｜email｜call`), `template_key`,
`to_address`, `body`, `provider`, `provider_ref`, `status`, `sent_at`, `failed_reason`

Customers must be notified when goods are handed to the courier. A log is what proves the
notification happened. It also carries the SMS constraints: templates are **Bengali**, with
OTP codes, numbers and URLs left in Latin script, sent through a **BTRC-enlisted local
aggregator** with a registered sender ID of at most 11 characters. International routing
is prohibited, so a global provider is not a compliant path.

### `cod_risk_checks`
`order_id`, `phone`, `provider`, `score`, `raw_payload` (jsonb), `decision`
(`accept｜require_prepayment｜decline`), `decided_by`, `checked_at`

The pre-dispatch fraud gate. Courier fraud-check services score a phone number against its
historical success and cancellation ratio across couriers. This runs **before dispatch, not
at checkout** — gating checkout costs conversions in a market where COD is the default.

Note the legal ceiling on the mitigation: advance payment above **10%** of price is not
permitted for goods that cannot be handed to a courier within 48 hours, absent a
Bangladesh Bank–approved escrow. Fine for in-stock inventory; not available for pre-orders.

---

## 7. Operations

### `staff_users`
`email` (unique), `password_hash`, `name`, `role` (`admin` for now), `active`,
`last_login_at`. The role column exists from the start so a packer can be added later
without a migration under live data.

### `audit_events`
`actor_type`, `actor_id`, `action`, `subject_type`, `subject_id`, `before` (jsonb),
`after` (jsonb), `ip`

Every stock change, price change, status transition, review removal and refund. With two
operators and cash moving through a third party, "who marked this delivered" must be
answerable.

### `settings`
`key` (unique), `value` (jsonb), `updated_by`

Holds delivery charges, free-delivery threshold, COD limits, **the VAT rate**, SLA day
counts, the compliance officer's contact details, and the business identifiers the site
must display: **trade licence, DBID, BIN and TIN** **[C]**.

The VAT rate belongs here and never in code — it moved 7.5% → 15% → 10% for own-brand
clothing retail within January 2025 alone.

### `delivery_rates`
`courier_namespace`, `band` (`inside_dhaka｜suburb｜outside_dhaka`), `city_id` (nullable),
`zone_id` (nullable), `rate_taka`, `free_over_taka`, `sla_days`, `active`

**A city-level key is not enough.** Courier pricing has a distinct suburb tier — Savar,
Keraniganj, Dohar, Tongi, Gazipur, Narayanganj — that sits between "inside Dhaka" and
"outside Dhaka" and is priced roughly 40 taka above the city rate. Those areas resolve at
*zone* granularity, not city, so matching on `city_id` alone would silently charge suburb
deliveries at the city rate and lose the difference on every parcel.

Resolution is most specific first: `zone_id`, then `city_id`, then the `band` default.

`sla_days` lives with the rate because the statutory delivery window differs by
destination — 5 days inside the city, 10 outside — and both derive from the same
geography.

---

## 8. Retention, deletion and the six-year rule **[C]**

Transactions, customer data and complaint records must be retained **six years**. Data
protection law simultaneously grants erasure rights. Retention wins for anything inside
the mandated set, so:

- **Nothing in the order path is ever hard-deleted.** No `DELETE` on orders, order lines,
  payments, invoices, consignments, complaints or audit events.
- **Erasure is scoped redaction.** A customer exercising erasure has their contact details
  and address redacted in place, with the redaction recorded as an audit event. Order
  totals, dates, line items and invoice records survive, because those are the mandated
  business record.
- **Products and variants are archived, never deleted**, so historic orders stay resolvable.
- **Rectification** — correcting a name or phone — must be possible within 30 days, and
  changes an *address record*, never an order's address snapshot.

This is why §5 snapshots so aggressively: it is what lets customer records be redacted
without destroying the commercial history that must survive.

---

## 9. The cart

**The cart lives in the browser**, holding `variant_id` and `quantity` only — **never a
price**. Prices resolve server-side at checkout, every time.

This is a correctness rule, not an optimisation: a cart carrying its own prices is a cart
the customer can edit. It also means a price change between adding and checking out is
handled visibly rather than by honouring a stale number, which matters because CRPA s.40
makes charging anything other than the displayed price an offence.

Cost: no abandoned-cart analytics, no cross-device carts. Both are addable later as a
`carts` table without touching anything above.

---

## 10. Deliberately absent

- **No customer passwords or sessions.** Guest checkout, order lookup by phone plus order
  number. Accounts later need a `customer_credentials` table and nothing else.
- **No discount tables.** `discount_taka` exists on the order so promotions can arrive
  without touching order history.
- **No `product.price`.** Price is a Variant property; a Product-level price becomes a lie
  the moment two sizes differ.
- **No soft-delete flags.** Archival status instead — see §8.
