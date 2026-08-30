# Store bilingual content as per-locale column pairs

Butterloom ships in English and Bengali, English by default. Translatable fields are
stored as column pairs on the content table itself — `title_en` / `title_bn` — rather than
in per-locale side tables or JSON. `_en` is required; `_bn` is nullable and falls back to
English when absent, so a product can be published before its Bangla copy exists.

## Considered Options

- **Per-locale side tables** (`product_translations` keyed by product and locale) — adding
  a third language would need no migration, and partial translation comes for free. This
  was the recommended option; it was not chosen.
- **A `jsonb` column per field** — no joins and no migration to add a locale, but the
  database cannot constrain or index it well and a mistyped locale key fails silently.

## Consequences

Adding a third locale requires a migration across every content table — `products`,
`collections`, `product_options`, `product_option_values`, `media`, and the policy
documents. With two locales settled and no third planned, this is accepted in exchange for
simpler queries, no joins on content reads, and an admin form that maps directly onto
columns.

Two constraints follow and must be enforced rather than assumed. A missing translation has
to be `NULL`, never `''`, or the fallback silently renders empty — worth a `CHECK`
constraint on every `_bn` column. And the fallback does not apply to the terms and the
return/refund policy, which Bangladeshi e-commerce guidelines require to exist in Bengali:
for those, `_bn` is required.
