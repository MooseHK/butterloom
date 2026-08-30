# Variants use a generic option system, with a signature column for uniqueness

A Product declares its own option axes (`product_options`) and their values
(`product_option_values`), and a Variant is the combination it points at through a join
table. Size and colour are not special-cased, so a later axis — fabric, sleeve length,
set versus single piece — needs no migration.

## The problem this creates, and the fix

A join table cannot express "no two variants of a product may share the same combination
of option values" as a database constraint. That invariant would otherwise fall to
application logic, and application logic loses races: two concurrent admin submissions can
both pass a check-then-insert and produce duplicate variants that quietly split stock.

Each variant therefore carries an `option_signature`: a deterministic string built from its
option value IDs sorted ascending, written in the same transaction as the join rows, under
`unique(product_id, option_signature)`. This restores a genuine database-level guarantee.

It is derived data. If it ever disagrees with `variant_option_values`, the join table is
the truth and the signature is rebuilt from it.

## Considered Options

- **Explicit `size_label` and `colour_id` columns** — readable queries, a simple admin
  form, and uniqueness enforceable directly by the database with no signature machinery.
  This was the recommended option; it was not chosen, in favour of flexibility.

## Consequences

Queries that filter or group by a specific axis are markedly more complex than a column
comparison, and the admin UI must let an operator define axes before adding variants —
meaningfully more UI than two fixed fields. Accepted for the ability to add option axes
without schema changes. Any code path that mutates a variant's option values must
recompute the signature in the same transaction, or uniqueness silently rots.
