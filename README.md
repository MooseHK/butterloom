# Butterloom

Direct-to-consumer South Asian ethnic fashion, selling online in Bangladesh.

This repository is currently a **design record**, not an application. The
`index.html` at the root is a superseded static prototype — a client-side cart
and mock admin over four demo products — kept only for reference. Nothing in it
is being carried forward.

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

## Running the old prototype

```bash
python -m http.server 8000
```
