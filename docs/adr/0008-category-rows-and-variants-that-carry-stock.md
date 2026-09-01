# A category table, and variants that carry the stock

The catalogue was one flat list of products, each with one price and one implied
thing to buy. Both halves of that are wrong for a shop selling garments: a
customer arrives wanting sarees rather than wanting everything, and an operator
restocking needs to say that the medium in indigo has three left while the large
in ecru has none. The product model therefore gains two shapes. A `categories`
row is a shelf with its own page, and `products.category_id` points at one of
them. A `product_variants` row is one buyable configuration of a product, it is
where `stock_qty` lives, and its axes are free-text name/value pairs in
`variant_options`. The listing filters and sorts over those options through GET
parameters normalised to a single canonical URL, because ADR-0007 makes every
distinct query string a distinct entry in the CDN's cache.

## Considered options

**A text column on products** is the cheaper way to have a category and gives
none of what a category is for. A shelf is a page, so it needs a URL; the front
page draws tiles, so it needs an order; and an operator has to be able to rename
"Saris" to "Sarees" without breaking a link somebody has already shared. A
free-text column forks into "Saree" and "Sarees" the first time somebody types
quickly, and nothing notices that it has.

**A join table, so one product can sit on two shelves**, was deferred rather than
rejected. Nothing in the catalogue needs two shelves yet, and a second place to
record where a product lives is a second place for the answer to disagree with
itself.

**Stock on the product** was rejected because it is not true there. A count of
"this saree" is a count of nothing anyone can be sent; what a picker takes off a
rail, a Cart line holds and a Reservation is taken against is one configuration.

**Filtering as script state** rather than as URLs was rejected on ADR-0007: a
filtered view that is not its own URL cannot be cached at the edge, shared or
crawled, which is most of what a category page is for.

## Consequences

- **Deleting a shelf unshelves what stood on it.** `products.category_id` is
  nullable with `ON DELETE set null`, so an unshelved product keeps its own URL
  and its place in the full listing and simply appears under no category.
  drizzle-kit emitted this foreign key *without* the `ON DELETE` clause the schema
  declares, which would make deleting a category a constraint error instead. It is
  corrected by hand in `drizzle/0004_categories_and_variants.sql`, a regenerated
  migration will drop the correction again in silence, and
  `test/migrations.test.ts` is what holds it corrected.
- **One category per product.** The upgrade is a join table, and the nullable
  foreign key is one migration away from one; until a garment genuinely belongs
  on two shelves, the second table only buys ways to be inconsistent.
- **Stock lives on the variant, which is why variants had to exist before
  Reservation could.** Reservation holds a specific variant per CONTEXT.md, and
  ADR-0006 leans on SQLite's single writer precisely for two customers claiming
  the last one at the same moment. Neither is expressible against a product-level
  count.
- **Nothing about stock reaches the storefront.** ADR-0007 keeps availability out
  of edge-cached HTML, so `stock_qty` is an operator's number until Reservation
  reads it at placement. The filters deliberately do not hide sold-out variants: a
  cached page saying a colour is gone is exactly the stale assertion ADR-0007
  exists to prevent.
- **A new axis costs no migration, and nothing polices the vocabulary.** Options
  are free text, stored as the operator typed them and again slugified — `Colour`
  and `colour`, `Indigo` and `indigo` — so adding Fabric is a matter of typing it.
  There is no registry of permitted axes: the admin offers the names already in
  use as a datalist, which is enough discipline for one operator and is a table to
  add the day a second one disagrees. Until then "Colour" and "Color" are two
  facets and only the operator can see that they should not be.
- **No per-variant price.** Every variant of a product costs what the product
  costs, so the listing has one number to sort on and the product page has one to
  print. The day a size costs more, this becomes a nullable override column on the
  variant and a `min()` "from" price in the listing; nothing else moves.
- **A filter matches a product when one single variant satisfies every axis at
  once** — an indigo M, not an indigo something and a something M. Within one axis
  the values are alternatives, so `?colour=indigo,ecru&size=m` asks for a medium
  in either colour. That is the meaning customers assume and the one that costs a
  correlated subquery per axis, which at ADR-0003's catalogue size is free.
- **Every filter combination is its own cache entry, so the query string is a
  whitelist rather than input.** Unknown axes and values are dropped, what
  survives is sorted into one canonical order, and a URL not already in that order
  is redirected to the one that is — so the two orderings of the same two filters
  are one page. Without that rule an unvalidated parameter is an unbounded number
  of cache entries anyone can mint by appending junk.
- **Facets are scope-wide and carry no counts.** The values offered are those
  present in the category being listed, and they do not narrow as filters are
  applied, so a customer can select their way to an empty result. A count beside
  each value would have to be recomputed per axis against the *other* axes'
  filters to be true, and a number that is subtly wrong is worse than no number.
- **Facet values are ordered by when they were first entered**, which puts S, M, L
  in size order for an operator who enters them in that order and in the wrong
  order for one who does not. A real ordering is a position column on the value,
  and it is open decision #7 rather than a thing to add now.
- **A variant's label is joined from its option values** — "Indigo / M", or
  "Standard" for the product that comes one way — and stored, so that ordering and
  the uniqueness rule have something to hold. Two variants of one product may not
  share a label: that is one variant entered twice.

## Addendum: product_stock, and what happened to it

The cart, checkout and order flow landed on `main` in parallel with this work,
and brought a `product_stock` table of its own: a product id, a variant label
and a quantity, unique on the first two. That is `product_variants` under
another name, minus the `position` column and minus the `variant_options` rows
the storefront filters on. Two tables holding one fact is one of them being
wrong, and the one that could not express a filterable axis was the one to go.

So `product_stock` is retired into `product_variants` by
`drizzle/0006_cart_holds_a_variant.sql`, and `cart_items` now holds a
`variant_id`. Worth knowing about that migration:

- **It is written by hand.** drizzle-kit sees a table dropped beside a table
  created, asks whether that is a rename, and cannot be answered without a
  terminal. It is not a rename: the ids in `cart_items` have to be remapped, not
  relabelled.
- **The new variant rows take the old stock rows' ids**, which is free because
  `product_variants` was created empty one migration earlier, and which makes
  the cart remap an identity rather than a join that re-derives which variant a
  label meant.
- **An empty `variant_label` becomes "Standard"**, because the label is what a
  customer is shown and the column is NOT NULL. The product that somehow holds
  both an empty label and a literal "Standard" gets the id appended to the
  second, rather than colliding on `product_variants_label_idx` and taking the
  whole migration down.
- **A cart line whose variant has gone is dropped rather than carried.** It
  points at nothing that can be priced or picked, and a cart is recoverable in a
  way an order is not.

Two consequences follow for the order flow, and both are deliberate:

- **An order line stores the variant's label, not its id.** That is main's shape
  and it is the right one: an order is a record of what was sold, and it has to
  keep reading correctly after the variant behind it is renamed or deleted. The
  cost is that restocking a returned or cancelled order finds its way back by
  label, and does nothing when no variant answers to it — there is no longer a
  shelf to put the goods back on, and inventing one would put stock against a
  configuration the shop no longer sells.
- **A new product starts with one "Standard" variant holding zero stock.** An
  order line holds a variant, so a product with none cannot be put in a cart at
  all. Zero rather than the ten `product_stock` defaulted to: a product nobody
  has counted yet has no stock, and inventing some is a claim the shop cannot
  honour at the door.
