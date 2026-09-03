# Butterloom

Direct-to-consumer South Asian ethnic fashion, selling online in Bangladesh.

Implementation has started. What runs today: the product record with its
categories and variants, the image upload pipeline behind it, and the
customer-facing catalogue, category and product pages. See
[Running the application](#running-the-application).

## Where the thinking lives

- **[CONTEXT.md](./CONTEXT.md)** — the glossary. What we mean by Payment Tier,
  Settlement State, RTO, Consignment and the rest. Start here.
- **[docs/adr/](./docs/adr/)** — decisions that are settled, and why.
- **[docs/open-decisions.md](./docs/open-decisions.md)** — decisions deliberately
  still open, each with the recommendation on the table.
- **[docs/launch-prerequisites.md](./docs/launch-prerequisites.md)** — external
  registrations and approvals with lead times we do not control. Several take
  longer than the build; they can all start now.
- **[docs/COMPLIANCE.md](./docs/COMPLIANCE.md)** — the Bangladeshi regulation that
  shapes the schema and the workflow, not just the policy pages, with each item
  tiered by how binding it is. Not legal advice; three items need a consultant.
- **[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)** — how this runs in production:
  topology, migrations, secrets, backups, monitoring. Partly built, nothing
  provisioned.
- **[docs/plans/](./docs/plans/)** — work that is decided but not built, in the
  order it should happen. Reservation first.

## The shape of it so far

Butterloom sells only within Bangladesh. Launch runs on two Payment Tiers that
need no gateway — Cash on Delivery, and Manual bKash where a customer submits a
TrxID that staff verify — behind an interface that lets bKash PGW and an
aggregator land later without a checkout rewrite. Orders advance along two
independent axes, one for where the goods are and one for where the money is, so
that cash a courier is still holding is never counted as revenue. Dispatch is a
single daily CSV batch into Pathao's merchant panel.

The application is TypeScript on Node with Hono, Drizzle and server-rendered JSX,
no meta-framework and no client-side framework, over SQLite running in-process and
replicated to object storage. Catalogue HTML and images are served from a CDN edge
close to Dhaka; a single small instance in Singapore handles checkout, Reservation
and the back-office. The reasoning is in ADR-0005 through ADR-0007, and it is
driven by three constraints: customers on mobile networks where round trips and
JavaScript execution cost more than bytes, a catalogue where images are roughly
97% of page weight, and a codebase maintained by AI agents rather than by a team
whose language strength has to be accommodated.

## Running the application

Requires Node 22+ and libvips' command line tools, which are the encoder
subprocesses ADR-0007 calls for:

```bash
sudo apt-get install -y libvips-tools    # provides vips and vipsheader
npm install
cp .env.example .env
npm run db:generate                      # only after changing src/db/schema.ts
npm start                                # http://localhost:3000/admin
```

`npm run check` typechecks, `npm test` runs the unit tests.

### What is built

- **Admin index** — `/admin` lists what there is to edit and how much of it
  there is. Everything under `/admin` is `private, no-store` at the origin as
  well as excluded from the cache rules (ADR-0007).
- **Products** — title, description, price in integer paisa (ADR-0006), and the
  shelf it stands on. Added in bulk: one form of rows, photographs attached to
  the row that owns them, one submit. The slug is derived from the title and
  numbered on collision, so it is not a field anyone types twenty times.
- **Categories** — `/admin/categories`, one form per shelf: a name and a position
  in the order of the front-page tiles. The slug is derived from the name once
  and then kept, because `/c/sarees` is a live URL and a rename is a change of
  caption rather than of shelf. Deleting a shelf unshelves what stood on it
  rather than deleting it (ADR-0008).
- **Variants** — the buyable configurations of one product, edited on its page: a
  row is a stock count and up to three free-text option pairs, Colour: Indigo and
  Size: M, with the label joined from the values rather than typed. A product
  that comes one way carries one row. Stock lives here because that is what
  Reservation will hold, and no storefront page reads it (ADR-0008).
- **Image upload** — many photographs per submit. The bytes are stored and the
  POST returns; a single background worker cuts each derivative ladder off a
  `pending_images` queue, so an operator never waits for an encode and a restart
  mid-batch resumes rather than losing it. The ladder is still generated ahead
  of any request and never on one (ADR-0007).
  Derivatives are named by the sha256 of their own bytes, so they are immutable,
  carry far-future cache headers, and need no purge path. The original is kept
  too, so re-cutting the ladder does not mean asking the operator to re-upload.
  A photograph the encoder cannot read is parked on the queue with its error
  shown against the product, where it can be discarded and re-uploaded.
- **Upload limits** — one worker (libvips already takes a core per encode), a
  ceiling on photographs waiting on it (`BUTTERLOOM_MAX_PENDING_IMAGES`), and a
  ceiling on one admin submit (`BUTTERLOOM_MAX_REQUEST_BYTES`, checked before
  the body is read). A bulk that would exceed them is refused whole, with a
  sentence saying why, rather than half-applied.
- **`<picture>` rendering** — AVIF then WebP then a JPEG fallback, with `srcset`,
  `sizes` and intrinsic `width`/`height` so nothing shifts as images arrive.
- **Storefront** — `/` is the front page: the hero slot, a tile for every shelf
  with something standing on it, and a rail of the newest pieces. `/shop` lists
  the whole catalogue and `/c/:slug` lists one shelf, which are the same document
  with a different scope — a sort, checkboxes over the variant options present in
  that scope, a removable chip per applied value, and paging. `/p/:slug` is the
  product, and says which colours and sizes it comes in. All server-rendered, no
  client JavaScript, marked `public` with a short browser TTL and a longer shared
  one so the Dhaka PoP answers. No page renders availability, and none ever
  should: ADR-0007 keeps the promise that a stale page cannot assert something
  false about stock by having it assert nothing at all. A middleware refuses to
  mark any response cacheable if it carries `Set-Cookie` and logs it, because a
  CDN would otherwise decline to cache it with no error and no symptom.
- **One URL per listing** — filter and sort are GET parameters, so a filtered view
  is a page that can be cached, shared and crawled. Unknown axes and values are
  dropped, what survives is sorted into one canonical order, and any other
  spelling of the same listing is 301-redirected to it. Every distinct query
  string is its own CDN cache entry, so an unvalidated parameter is an unbounded
  number of them (ADR-0008).

The product page's variant list is a picker rather than type: it posts a
`variant_id` to the cart, and that POST is the one response on the storefront
allowed to issue a cookie, which is why every page above it can be cached. A
cart line and an order line both hold a Variant — an order line keeps the
variant's *label* rather than its id, so an order still reads correctly after
the variant behind it is renamed or deleted.

Two things to know about the current environment. AVIF is in the ladder but this
machine's libvips has no AV1 encoder, so uploads produce WebP and JPEG only; the
format set is probed at startup by attempting a real encode, and the server logs
what it can write. And the derivative bytes are written to `var/media` by a
filesystem driver standing in for object storage — the keys are exactly the ones
a bucket would hold, so pointing at a real bucket and CDN is a driver swap plus
`BUTTERLOOM_MEDIA_BASE_URL`.

The ladder itself — widths 320/480/640/960/1280/1600, quality 50/72/78 — is a
working default, not a decision. Open decision #5 wants a real photograph to
measure against, and everything about it lives in `src/images/ladder.ts`.

## Running the old prototype

```bash
python -m http.server 8000
```
