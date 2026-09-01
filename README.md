# Butterloom

Direct-to-consumer South Asian ethnic fashion, selling online in Bangladesh.

Implementation has started. The `index.html` at the root is a superseded static
prototype — a client-side cart and mock admin over four demo products — kept only
for reference. Nothing in it is being carried forward.

What runs today is the first slice: a product record and the image upload
pipeline behind it. See [Running the application](#running-the-application).

## Where the thinking lives

- **[CONTEXT.md](./CONTEXT.md)** — the glossary. What we mean by Payment Tier,
  Settlement State, RTO, Consignment and the rest. Start here.
- **[docs/adr/](./docs/adr/)** — decisions that are settled, and why.
- **[docs/open-decisions.md](./docs/open-decisions.md)** — decisions deliberately
  still open, each with the recommendation on the table.
- **[docs/launch-prerequisites.md](./docs/launch-prerequisites.md)** — external
  registrations and approvals with lead times we do not control. Several take
  longer than the build; they can all start now.

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
npm start                                # http://localhost:3000/admin/products
```

`npm run check` typechecks, `npm test` runs the unit tests.

### What is built

- **Products** — title, slug, description, price in integer paisa (ADR-0006),
  created and listed in the admin.
- **Image upload** — one photograph per upload, from which the whole derivative
  ladder is generated at upload time and never on a request path (ADR-0007).
  Derivatives are named by the sha256 of their own bytes, so they are immutable,
  carry far-future cache headers, and need no purge path. The original is kept
  too, so re-cutting the ladder does not mean asking the operator to re-upload.
- **`<picture>` rendering** — AVIF then WebP then a JPEG fallback, with `srcset`,
  `sizes` and intrinsic `width`/`height` so nothing shifts as images arrive.

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
