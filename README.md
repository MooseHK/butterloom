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
  still open, each with the recommendation on the table. Three remain, and none
  of them blocks starting the build.
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

It is built as a SvelteKit and PostgreSQL application — server-rendered, working
before hydration, chosen because browsing is the product on a fashion storefront
and the customers are on mobile data. It runs on a managed platform in Singapore
whose database backups and restores are not ours to run. Cash on Delivery orders
are gated by an SMS OTP, because refused parcels are the largest cost after
goods; a Manual bKash order holds its stock for 90 minutes while the customer
pays.

## Running the old prototype

```bash
python -m http.server 8000
```
