# Butterloom Data Model

Status: **for review.** Not implemented. Proposed schema for verification.

Conventions: every table has `id`, `created_at`, `updated_at` unless stated. Money is
`integer` whole taka (no poisha) — see `docs/PLAN.md` §2. Locale is an enum `('en','bn')`,
with `en` the default. Decisions marked **[VERIFY]** need your confirmation.

---

## 1. How bilingual content is stored

Content splits into three kinds, and only the first is translated:

| Kind | Examples | Treatment |
|---|---|---|
| Authored content | product title, description, care notes, collection name, colour name, image alt text | **Translated** — one row per locale |
| Locale-neutral data | SKU, price, stock, phone, size label (`S`, `M`, `40`), slug | **Not translated** — single column |
| Customer-entered text | street address, order notes | **Not translated** — stored verbatim in whatever script the customer typed |

**Proposed pattern: side tables, one row per locale.** [VERIFY]

```
products                       product_translations
  id                             product_id   ─┐ composite
  slug          ◄────────────    locale       ─┘ primary key
  status                         title
  ...                            subtitle
                                 description
                                 care_notes
```

Rejected alternative — `title_en` / `title_bn` column pairs, or a `jsonb` blob per field.
Both are simpler to query, but adding a third locale means a migration on every content
table, and neither can express "this product is published in English but its Bangla copy
is still being written." The side table gets partial translation for free: a missing row
is a missing translation, and the app falls back to `en`.

**Fallback rule:** if a `bn` row is absent, render `en`. Never render an empty string.
This means Bangla can be filled in progressively rather than blocking a product launch.

---

## 2. Catalog

### `collections`
`id`, `slug` (unique), `status` (`draft|active|archived`), `position`

### `collection_translations`
PK (`collection_id`, `locale`) · `title`, `description`

### `products`
| Column | Type | Notes |
|---|---|---|
| `slug` | text unique | URL identity, ASCII, locale-neutral |
| `collection_id` | fk nullable | |
| `status` | enum | `draft` / `active` / `archived` — never hard-delete a product that has been ordered |
| `position` | int | manual merchandising order |
| `published_at` | timestamptz null | |

A Product is **not purchasable**. It is the merchandising unit a customer browses.

### `product_translations`
PK (`product_id`, `locale`) · `title`, `subtitle`, `description`, `care_notes`

### `variants`
The purchasable unit. Every add-to-cart references a Variant.

| Column | Type | Notes |
|---|---|---|
| `product_id` | fk | |
| `sku` | text unique | operator-facing, locale-neutral, appears on packing slips |
| `size_label` | text | `S`, `M`, `40` — script-neutral, deliberately not translated |
| `colour_id` | fk nullable | → `colours` |
| `price_taka` | int | **price lives here**, so a 3XL can cost more than an S |
| `compare_at_taka` | int null | for strikethrough pricing |
| `weight_grams` | int | **required** — the courier quotes on weight |
| `on_hand` | int | physically in the room |
| `reserved` | int | promised to placed, undispatched orders |
| `status` | enum | `active` / `archived` |

Constraints: `unique(product_id, size_label, colour_id)`; `on_hand >= 0`;
`reserved >= 0`; `reserved <= on_hand`.

Available stock, everywhere in the app, is `on_hand - reserved`.

### `colours`
`id`, `hex`, `position` — a shared palette rather than free text per variant, so "Maroon"
is spelled and translated once.

### `colour_translations`
PK (`colour_id`, `locale`) · `name`

### `media`
`product_id`, `variant_id` (nullable — a shot may be colour-specific), `path`, `width`,
`height`, `position`, `is_primary`

### `media_translations`
PK (`media_id`, `locale`) · `alt_text` — alt text is authored content and required, not optional.

---

## 3. Inventory

### `stock_movements`
Append-only. Current stock must be reconcilable from this log; if the counters on
`variants` ever disagree with the sum here, the log is right.

| Column | Notes |
|---|---|
| `variant_id` | |
| `on_hand_delta` | signed int, default 0 |
| `reserved_delta` | signed int, default 0 |
| `reason` | `initial` / `reserve` / `release` / `dispatch` / `restock` / `correction` / `return` |
| `order_id` | nullable — set for order-driven movements |
| `staff_user_id` | nullable — set for manual corrections |
| `note` | free text, required for `correction` |

Two delta columns rather than one, because reserving stock and shipping it move different
counters and a single `delta` cannot express both.

Movement pattern across an order's life:

| Event | `on_hand_delta` | `reserved_delta` |
|---|---|---|
| Order placed | 0 | `+qty` |
| Order cancelled | 0 | `-qty` |
| Order dispatched | `-qty` | `-qty` |
| Parcel returned | `+qty` | 0 |

---

## 4. Customers and addresses

### `customers`
`phone` (unique, normalised), `name`, `email` (nullable), `default_locale`, `blocked`
(bool), `blocked_reason`, `internal_note`

**Phone is the identity key**, not email — that is how this market works. Guest checkout
still creates or matches a customer row by phone, which is what makes repeat-customer
recognition and COD-abuse blocking possible later without a migration.

Normalisation matters: `01712345678`, `+8801712345678` and `8801712345678` are one
customer. Store one canonical form.

### `addresses`
| Column | Notes |
|---|---|
| `customer_id` | |
| `recipient_name`, `recipient_phone` | may differ from the customer — gifts are common |
| `street_address` | free text, customer's own script |
| `landmark` | nullable — genuinely used for navigation in Dhaka |
| `courier_namespace` | e.g. `pathao` — **the area IDs below belong to one courier's numbering** |
| `city_id`, `zone_id`, `area_id` | int — the Delivery Area triple |
| `city_name`, `zone_name`, `area_name` | text snapshots |

Both IDs and names are stored: IDs are what the courier API accepts, names are what a
printed packing slip and a human need. `courier_namespace` exists because those IDs are
Pathao's numbering, not universal — switching couriers invalidates them, and silently
reusing them would misroute parcels.

---

## 5. Orders

### `orders`
| Column | Notes |
|---|---|
| `order_number` | text unique — human-quotable, e.g. `BL-26-0042` |
| `customer_id` | fk |
| `locale` | the language the order was placed in |
| `status` | enum, see `docs/PLAN.md` §4 |
| `payment_method` | `cod` / `bkash` / `card` |
| `subtotal_taka` | int | 
| `delivery_charge_taka` | int |
| `discount_taka` | int, `0` in v1 |
| `total_taka` | int |
| `amount_to_collect_taka` | int — equals `total` for pure COD, `0` if prepaid |
| customer snapshot | `customer_name`, `customer_phone`, `customer_email` |
| address snapshot | every field from `addresses`, copied |
| `customer_note` | what the customer typed |
| `internal_note` | operator-only |
| `cancellation_reason` | nullable |

**Everything commercial is a snapshot, written once.** Money, customer details and
address are copied onto the order at placement and never recomputed. Editing a product
price, or a customer editing their saved address, must not change a placed order.

### `order_lines`
`order_id`, `variant_id` (fk, `ON DELETE SET NULL` — the reference is a convenience, the
snapshot is the truth), `sku`, `title_en`, `title_bn`, `size_label`, `colour_name_en`,
`colour_name_bn`, `unit_price_taka`, `quantity`, `line_total_taka`

**Titles snapshot in both languages** [VERIFY], not just the order's locale. Two short
strings, and it removes an ambiguity that would otherwise bite: a customer orders in
Bangla, an operator picks and packs reading English. Storing only the order locale forces
a live lookup that defeats the point of snapshotting.

### `order_events`
Append-only: `order_id`, `from_status`, `to_status`, `actor_type` (`staff|system|customer`),
`actor_id`, `note`, `created_at`. The authoritative history. Denormalised
`confirmed_at` / `dispatched_at` / `delivered_at` columns on `orders` are permitted as
query conveniences, derived from this.

### `payments`
`order_id`, `method`, `status` (`pending|paid|failed|refunded`), `amount_taka`,
`provider`, `provider_reference`, `paid_at`, `raw_payload` (jsonb)

Modelled from day one although v1 only ever writes `cod`. Retrofitting a payments table
under live orders is materially harder than carrying an almost-empty one.

### `consignments`
`order_id`, `courier`, `consignment_ref` (the courier's ID), `status`,
`delivery_fee_taka`, `cod_fee_taka`, `amount_to_collect_taka`, `idempotency_key`,
`settlement_ref`, `settled_at`, `raw_payload` (jsonb)

An Order may have several Consignments over time if a delivery fails and is re-attempted,
but only one active. `idempotency_key` derives from the order number: ADR 0003 showed a
courier request can succeed on their side while appearing to fail on ours, so a blind
retry must not create a second parcel.

`delivery_fee_taka` and `cod_fee_taka` are **Butterloom's costs**, not customer-facing.
They live here, not on the order, because they are margin accounting.

---

## 6. Operations

### `staff_users`
`email` unique, `password_hash`, `name`, `role` (`admin` for now), `active`, `last_login_at`

The role column exists from the start even with one value, so a packer can be added later
without a migration under live data.

### `audit_events`
`actor_type`, `actor_id`, `action`, `subject_type`, `subject_id`, `before` (jsonb),
`after` (jsonb), `ip`, `created_at`

Every stock change, price change, status transition and refund. With two operators and
cash moving through a third party, "who marked this delivered" must be answerable.

### `settings`
`key` unique, `value` (jsonb), `updated_by`, `updated_at`

Delivery charges, free-delivery threshold and COD limits live here rather than in code,
so an operator can change them without a deploy.

### `delivery_rates`
`courier_namespace`, `city_id` (nullable — null means "everywhere else"), `rate_taka`,
`free_over_taka`, `active`

A small table rather than a config constant, because inside-Dhaka versus outside-Dhaka
pricing is the standard local model and the figures will be tuned repeatedly.

---

## 7. The cart

**Proposed: the cart lives in the browser, not the database.** [VERIFY]

It stores only `variant_id` and `quantity` — **never a price**. Prices are resolved
server-side at checkout, every time.

This is a correctness rule, not an optimisation: a cart that carries its own prices is a
cart a customer can edit. It also means a price change between adding to cart and
checking out is handled correctly and visibly, rather than honouring a stale number.

The cost is no abandoned-cart analytics and no cross-device carts. Both are addable later
as a `carts` table without changing anything above.

---

## 8. What is deliberately absent

- **No customer passwords or sessions.** Guest checkout with order lookup by phone plus
  order number. Adding accounts later needs a `customer_credentials` table and nothing else.
- **No discount or promotion tables.** v1 has none; `discount_taka` exists on the order
  so adding them does not touch order history.
- **No `product.price`.** Price is a Variant property. A Product-level price would be a
  lie the moment two sizes differ.
- **No soft-delete flags.** Archival status instead, so ordered products stay resolvable.
