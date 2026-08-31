# Build on SvelteKit and PostgreSQL

Almost none of this code will be written by hand; an AI assistant writes it and
the maintainer reviews it. That removes language fluency as a criterion in either
direction — neither Python nor TypeScript would be typed from memory — and it
sharply lowers the price of code a framework does not give us for free. What it
does not lower is what the customer experiences, and Butterloom sells clothes,
where browsing *is* the product. So the decision is made on the storefront:
speed and usability first.

SvelteKit serves that better than server-rendered templates do. It renders on the
server by default and its form actions work before any JavaScript has loaded, so
it keeps the first-paint property that matters on Bangladeshi mobile data, and
then adds client-side navigation, filtering and cart interaction once loaded.
Svelte compiles the framework away rather than shipping it, which makes that
second half unusually cheap on the connections our customers are actually on.
One language covers storefront, operator screens and server, in one deployable.

Django was the earlier recommendation and lost on exactly one thing: its admin.
That admin was what paid the back-office bill ADR-0002 handed us, and choosing
SvelteKit takes that bill back in full. This decision is therefore a purchase —
storefront quality bought with back-office labour — and it rests on the
assumption that AI assistance makes generating that back-office cheap enough to
be worth it. That assumption is the thing to revisit if this goes wrong.

## Consequences

- **The entire back-office is ours to build.** Product, inventory, customer and
  order administration, on top of the verification, Dispatch Batch and
  reconciliation screens that were always going to be bespoke. This is the
  substantial, deliberate cost of the decision.
- PostgreSQL, with the model's invariants in the schema rather than in
  application code: a unique constraint rejects a duplicate TrxID (ADR-0001), and
  Fulfilment State and Settlement State are constrained independently so the two
  axes cannot drift into one field. Access is through a typed query layer with
  versioned migrations — Drizzle or Prisma, chosen when the schema is — never
  ad-hoc SQL strings.
- Server rendering and progressive enhancement are a rule, not a default we
  inherit. Checkout and the cascading city/zone/area selection ADR-0004 requires
  must work before hydration. A checkout that needs JavaScript to submit loses
  precisely the slowest customers, who are the ones this stack was chosen for.
- **Framework choice is a smaller speed lever than image discipline.** Product
  photography is the payload on a fashion storefront and dwarfs any bundle. The
  speed goal is met first by the image pipeline and CDN of ADR-0006 — sized
  variants, modern formats, lazy loading below the fold — and only then by the
  framework.
- Authentication is ours; SvelteKit ships none. Session-based auth for staff, and
  the phone-based customer identity ADR-0008 establishes. Small, and the wrong
  place to improvise.
- The npm dependency tree is large and moves fast, which is the real cost of
  leaving Python. Lockfiles are committed, updates are a scheduled habit rather
  than a reaction, and the dependency count is something to argue down.
- Scheduled work has no framework home here. The Reservation expiry sweep
  (ADR-0007) and the Pathao location refresh (ADR-0004) run as scripts on the
  platform's scheduler — still not a job queue, per ADR-0003.
