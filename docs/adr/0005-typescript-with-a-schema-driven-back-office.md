# TypeScript on Node, no meta-framework, with a schema-driven back-office

The codebase will be maintained by AI agents rather than by a team whose language
strength has to be accommodated, which removes the tiebreaker `docs/open-decisions.md`
placed above every other argument. It does not make the choice free: what replaces
human skill is *agent legibility* — training mass, docs that still match the idioms
in an agent's training data, and a fast local feedback loop. Weighing that against
a back-office that ADR-0002 says dwarfs the storefront, the stack is TypeScript on
Node LTS with Hono, Drizzle, drizzle-zod and server-rendered JSX, and an admin
generated from the schema rather than written screen by screen.

## Considered options

**Django and PostgreSQL with htmx**, the standing recommendation, was rejected on
its own headline argument. That argument — the admin refunds most of the back-office
cost — is denominated in code an agent no longer has to write, and writing code is
now cheap. What remains valuable is the *surface area* a generated admin avoids,
and that can be had in a typed language. Django is also the weakest of the
candidates at static checking, which is the feedback loop the agent-legibility
criterion actually asks for.

**Laravel with Filament** was the strongest alternative, because Filament is better
than any generated admin at the queue-shaped screens this back-office actually
needs. It was rejected because Filament is a fast-moving third-party dependency
with real major-version churn, which is precisely the risk the stability criterion
was introduced to avoid.

**Go** wins on the two things TypeScript concedes — the Go 1.x compatibility promise
is the strongest guarantee available that an agent's training data still matches
today's docs, and a single static binary suits the smallest instance ADR-0003 calls
for. It was rejected because a schema-driven admin in Go is struct tags plus
reflection, which is stringly-typed at exactly the boundary the compiler was
supposed to be watching.

**C#/.NET** was a genuine contender on typing, scaffolding and stability, and was
set aside on ecosystem culture rather than on any technical failing.

An objection raised against a generated admin does not survive scrutiny and is
recorded here so it is not raised again: ADR-0002 rejected WooCommerce for imposing
a single order-status field on the two-axis Fulfilment/Settlement model. A generated
admin does not do the same thing. WooCommerce imposed a *domain model*; an admin
generated from our own schema imposes only a *UI convention over fields we define*.
Two independent state fields are simply two fields.

## Consequences

- **Meta-frameworks are excluded by decision, not by omission.** No Next.js, Remix,
  Nuxt, SvelteKit or equivalent; no React, Vue or Svelte on the client. The
  ecosystem churn that makes TypeScript look unstable lives almost entirely in that
  layer, and the low-bandwidth constraints rule it out anyway. Reaching for one
  later reopens this ADR.
- **One schema definition is load-bearing.** A Drizzle table declaration yields row
  types, migrations, the runtime column metadata the generic admin iterates, and —
  through drizzle-zod — request validators. Anything that breaks that chain, such as
  hand-maintaining validators alongside the schema, gives back the property this
  decision was made for.
- **The admin is a small generic layer plus a short declarative config per model**,
  not one hand-written screen per model. Surface area stays near a generated
  admin's while the compiler still rejects a renamed column.
- **Three back-office screens are bespoke on purpose**: the TrxID verification
  queue, the Dispatch Batch CSV round-trip, and remittance reconciliation. These
  were never CRUD, no generated admin would have covered them, and they are the
  expensive half of the back-office rather than the cheap half.
- Node LTS is chosen over faster runtimes deliberately. Recovering deployment
  elegance by spending idiom stability is the wrong trade here.
