# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm start                 # tsx src/server.tsx — http://localhost:3000/admin
npm run dev               # same, with watch
npm run check             # tsc --noEmit; there is no separate build or linter
npm test                  # node --test over test/*.test.ts (128 tests today)
npx tsx --test test/order.test.ts                      # one file
npx tsx --test --test-name-pattern='stock' test/*.test.ts   # one test by name
npm run db:generate       # only after editing src/db/schema.ts — see Migrations
```

Migrations run automatically at server start (`runMigrations()` in `src/server.tsx`), and
each test file calls `runMigrations()` itself.

libvips (`vips`, `vipsheader`) is an optional runtime dependency: the encoder subprocesses
that cut image derivatives. The suite passes without it; uploading a photograph does not.
Install with `sudo apt-get install -y libvips-tools`.

## Where the decisions live, and which ones are binding

Read these before changing anything structural — several of the constraints below look
arbitrary until you find the ADR that bought them.

- **`CONTEXT.md`** is a glossary and it is normative for naming. It fixes what Variant,
  Consignment, Settlement State, Collected, Remitted and RTO mean, and lists the words to
  avoid for each. Do not introduce a synonym it rejects.
- **`docs/adr/`** — settled decisions. ADR-0003 (one small instance, one operator, no job
  queue), ADR-0005 (stack, and the exclusion of meta-frameworks), ADR-0006 (SQLite,
  integer paisa), ADR-0007 (edge-cached HTML, upload-time derivatives) and ADR-0009
  (uncached stock fragment) are the ones most code touches.
- **`docs/plans/`** — decided but unbuilt work, in order. `docs/plans/README.md` carries
  the queue and its statuses. A plan is deleted when its work ships.
- **`docs/open-decisions.md`** — deliberately unsettled. Entries are cited by number from
  `src/config.ts` and from the plans, so a settled entry stays in place marked settled and
  **the numbers never move**.
- **`docs/COMPLIANCE.md`** — the Bangladeshi regulation that shapes the schema, tiered by
  how binding each item is.

## Architecture

TypeScript on Node with Hono, Drizzle over better-sqlite3, and server-rendered JSX via
`hono/jsx`. ADR-0005 excludes meta-frameworks and client frameworks **by decision, not by
omission**: no Next/Remix/Nuxt, no React/Vue/Svelte. Reaching for one reopens the ADR.
Client-side JavaScript exists only where an ADR calls for it (today: the sub-1KB stock
fragment of ADR-0009).

### The cache seam is the thing most likely to be broken by accident

ADR-0007 serves catalogue HTML from a Dhaka edge PoP, and that promise is enforced by
`src/storefront/cache.ts` plus the mount order in `src/server.tsx`:

- `edgeCacheable` is registered on `*` **last**, after `/admin`, `/media`, `/brand`,
  `/cart`, `/checkout` and `/order`, so only catalogue routes get public cache headers.
  Adding an uncacheable route means mounting it before that line.
- **A cacheable response may not carry `Set-Cookie`.** A CDN silently declines to cache
  one, so the middleware downgrades the response to `private, no-store` and logs loudly.
  This is why sessions are created lazily on `POST /cart/add` rather than on any GET.
- The cart badge rides a script-readable `bl_cart_count` cookie precisely so cached HTML
  stays byte-identical for every visitor (`src/storefront/session.ts`).
- **No storefront page renders stock into cached HTML.** Availability is fetched from
  `GET /stock/:slug` (`private, no-store`, never sets a cookie), per ADR-0009. Server-side
  checks in `/cart/add` and checkout are the non-JS fallback.
- Everything under `/admin` is `private, no-store` at the origin as well as excluded from
  CDN rules, applied to both `/admin` and `/admin/*` (the wildcard misses the bare path).

### One URL per listing

`/shop`, `/c/:slug` and `/search` are the same document with a different scope.
`src/storefront/listing.ts` parses, validates and canonicalises the query string: unknown
axes and values are dropped, survivors are sorted into one canonical order, and any other
spelling 301-redirects to it. Every distinct query string is its own CDN cache entry, so
an unvalidated parameter is an unbounded number of them.

### Orders: two independent axes

CONTEXT.md models an order as **Fulfilment State** (where the goods are) and **Settlement
State** (where the money is), moving independently. Only the first exists in `src` today —
`orders.fulfilment_state` with transitions in `src/lib/order.ts` and an append-only
`order_events` trail. Settlement State, refunds, complaints and reviews are
`docs/plans/0003-refunds.md`, which is the next plan in the queue. Do not collapse
delivered into paid.

Order lines snapshot what was bought: `order_items` keeps `product_title` and
`variant_label` as text, so an order still reads correctly after the variant behind it is
renamed or deleted.

Money is **integer paisa** everywhere (ADR-0006). `formatPaisa` in `src/lib/money.ts` is
the only place it becomes a decimal.

### Catalogue shape

`categories` (a shelf, with its own URL and tile order) → `products` (one title, price,
page) → `product_variants` (the buyable configuration, and **where stock is counted**) →
`variant_options` (free-text axes, each stored as typed and as a slug; the slug is what a
filter URL carries). A product carries at least one variant; the single-configuration case
is one row labelled `Standard`.

Two distinct ways a product leaves view, and the schema comments explain why one word
would not do: a null `category_id` is *unshelved* (still listed, still reachable), while
`hidden_at` is *withdrawn* (gone from listings, search and facets; 404 at its own URL).

### Images

`POST` stores the original bytes and returns; a row lands on `pending_images` and a
**single** background worker (`src/images/queue.ts`) cuts the derivative ladder off it, so
an operator never waits on an encode and a restart mid-batch resumes. Derivatives are
named by the sha256 of their own bytes — immutable, far-future cacheable, no purge path.
`src/images/storage.ts` is a filesystem driver writing exactly the keys a bucket would
hold; production is a driver swap plus `BUTTERLOOM_MEDIA_BASE_URL`.

### Admin

One Hono sub-app per section under `src/admin/`, mounted in `src/server.tsx`, all rendered
through `AdminLayout` (`src/views/layout.tsx`) with a `section` prop for the nav. Mutations
are `POST` then redirect. The admin runs **unauthenticated** when `BUTTERLOOM_ADMIN_USER`
and `BUTTERLOOM_ADMIN_PASSWORD` are unset, and warns at boot.

## Conventions that will bite

**Migrations are hand-corrected, and `drizzle-kit generate` will undo the corrections.**
`drizzle/meta/_journal.json` has hand-added entries and several `.sql` files carry edits
the generator does not produce — the `ON DELETE set null` on `products.category_id`, and a
fixed `INSERT` in the `0002` table rebuild. `test/migrations.test.ts` replays the real
chain against seeded data to hold those corrections shut; read it before regenerating, and
re-run it after. Migrations are additive and must leave existing rows intact.

**`import './support/tempDb.js'` must be the first import in every test that touches the
database.** ESM initialises dependencies in source order, and that module picks a
per-process temp database before `src/db/client.ts` opens one. Without it, test files race
each other's migrations against the developer's own `var/butterloom.db`.

**Comments explain why, not what.** The existing prose is long-form and argues the case —
match that register rather than adding `// increment counter`. A `ponytail:` marker names a
deliberate simplification together with the one-line escape hatch out of it; keep the form
if you add one.

`tsconfig.json` runs `strict` with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`:
indexed reads are possibly-undefined, and type-only imports need `import type`. Relative
imports carry the `.js` extension (NodeNext).

## Environment

Everything configurable is read once in `src/config.ts` and referenced from there;
`.env.example` lists the variables. The derivative ladder itself (widths, formats,
quality) lives in `src/images/ladder.ts` and is a working default, not a decision — it is
open decision #5.
