# Host on a managed platform in Singapore, with a managed PostgreSQL we do not administer

Singapore is the nearest region with real provider choice, and the latency to
Dhaka is unremarkable for a server-rendered site. The open question was the
provider and the shape. The shape is settled first, because it is what matters:
the smallest instance the provider offers (ADR-0003), a **managed** PostgreSQL
with automated backups and point-in-time restore, product images on object
storage behind a CDN, and no server we log into to administer. The reasoning is
the same one that chose the stack — there is one person here, and the task that
must go correctly at three in the morning with no second pair of hands is a
restore. Buying that from someone whose job it is costs less per month than the
first hour of getting it wrong. A self-run VPS with Postgres on the box is
cheaper and is the wrong trade.

Within that shape the default is DigitalOcean — App Platform plus Managed
PostgreSQL, both in the Singapore region — with Render and Fly.io as
equivalent-shaped alternatives. Confirm current Singapore availability and
pricing with the provider before committing; this is the reversible half of the
decision, and swapping providers later costs a weekend, where the shape and
ADR-0005 would cost a rewrite.

## Consequences

- **Paying the provider is a real dependency, not an afterthought.** Monthly
  billing in foreign currency from Bangladesh needs a card that is actually
  endorsed for international payment, and a declined renewal takes the site down
  as effectively as any outage. Arrange the billing instrument alongside the
  items in the launch prerequisites, and keep a second one on file.
- Product images live on object storage from the first upload, never on the
  application instance. Photography is already the critical path, images are the
  bulk of what a customer on a mobile network downloads, and moving image URLs
  after launch is the kind of migration that breaks a catalogue quietly.
- Restore is a rehearsed procedure, not a feature we assume works. Restoring to a
  scratch database and confirming the last Dispatch Batch and its settlement
  records survive belongs in the operator runbook, and is done once before
  launch.
- Transactional email goes through an email provider with an authenticated
  sending domain. Mail sent directly from the instance is filtered, and an order
  confirmation that silently fails to arrive reads to the customer as a failed
  order.
- No staging environment initially — not because the volume is low, which is not
  what decides it, but because a staging tier nobody keeps current is worse than
  none: it grows its own schema and its own bugs and then certifies releases
  against neither production's data nor its own. The arrangement is one
  production environment plus a local development database restored from a recent
  backup, which is also how the restore gets rehearsed.
- Nothing here depends on the provider's proprietary services. Managed Postgres,
  object storage and a container are the portable subset on purpose.
