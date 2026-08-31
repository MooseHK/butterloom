# Build on Django and PostgreSQL, server-rendered with htmx

Butterloom is built and maintained by one person working with an AI assistant, so
the argument the open decision reserved for team language strength resolves
differently here than it would for a team: fluency is not the scarce resource,
and neither Python nor TypeScript would be written from a standing start. What is
scarce is attention, and the volume of code that has to be understood well enough
to repair under pressure by the only person who can repair it. That favours the
stack that writes the least of it. ADR-0002 put the entire back-office on us, and
Django's admin hands most of it back — product, inventory, customer and order
records generated from the model definitions — leaving only the screens that
carry business logic to build by hand. Server-rendered HTML is also the right
payload for customers who are overwhelmingly on mobile networks, where
bundle-then-hydrate-then-fetch spends three round trips before the first product
image appears, and htmx covers the interactivity this storefront actually needs,
including the cascading city/zone/area selection ADR-0004 made load-bearing. One
language, one deployable, one dependency tree.

Next.js with PostgreSQL was the alternative on the table, and it remains the
better answer for a bespoke animated storefront. It is the worse answer here: it
buys interaction polish with the admin ADR-0002 was counting on, and pays for it
in a second runtime, a second dependency tree, and a build nobody is minding.

## Consequences

- **The admin is for records, not for workflow.** Catalogue, stock, customer and
  order records come free and are good enough for one operator at this volume.
  The three screens that carry the business — Manual bKash TrxID verification,
  Dispatch Batch assembly, and remittance reconciliation — are purpose-built.
  Bending the admin into them is the specific failure mode to avoid, and the
  runbook ADR-0003 requires describes the purpose-built screens, not the admin.
- PostgreSQL earns its place on constraints rather than scale. Duplicate-TrxID
  rejection (ADR-0001) becomes a unique constraint, and the independence of
  Fulfilment State and Settlement State can be enforced in the schema instead of
  trusted to application code. SQLite would carry 30 orders a day comfortably;
  it is declined because it makes the backup and restore story ours to invent,
  which ADR-0006 deliberately gives away.
- No API and no separate frontend. A mobile app or a partner integration later
  means writing an API then, against a schema that will exist. That cost is
  accepted, not overlooked.
- The storefront's interaction ceiling is lower than a React storefront's. If
  presentation later becomes the differentiator, the answer is progressive
  enhancement on specific pages, not revisiting this.
- Off-request work stays scheduled tasks, per ADR-0003. Two already exist: the
  Reservation expiry sweep (ADR-0007) and the periodic refresh of Pathao's
  location list (ADR-0004). Both are management commands on a timer, not a queue.
- The Python dependency set moves slowly enough to survive months of inattention,
  which matters more than it would with someone minding the build daily.
