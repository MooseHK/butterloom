# The storefront is English only, with an optional alternative product name

Butterloom's storefront is in English. There is no localisation layer — no locale column,
no per-locale tables, no translation fallback, no i18n library. Operators may enter a
single optional alternative name per Product (`title_alt`), typically the Bangla name,
displayed alongside the English one.

This supersedes ADR 0004, which chose per-locale column pairs for a bilingual storefront.

## Consequences

The saving is larger than it appears from the schema alone. Removed along with the locale
columns: an i18n runtime and its bundle cost, a language switcher, locale routing and
`hreflang`, translated admin forms with per-locale validation, a `locale` field on orders,
reviews and notifications, and the operational burden of keeping two sets of copy in step
for every product, collection and option value.

**Two Bengali obligations survive and are unaffected by this decision**, because neither
depends on the storefront's language:

- Terms and the return/refund/exchange policy must be **written in Bengali**.
- Transactional SMS must be **in Bengali**, with OTP codes, numbers and URLs left in Latin
  script (BTRC directive, in force since March 2022).

Both are hand-authored artefacts — a policy page and a set of SMS templates — and neither
requires locale machinery to satisfy. **The typeface must still carry Bangla coverage**,
for those pages and for alternative product names, so this decision does not relax the
typographic constraint.

Reversing this is a schema migration plus an i18n layer, and gets more expensive as content
accumulates. ADR 0004 records the analysis to start from if that becomes necessary.
