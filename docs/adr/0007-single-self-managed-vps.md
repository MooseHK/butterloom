# Deploy on a single self-managed VPS

Butterloom deploys to one small VPS with a fixed IPv4 address, running the application,
PostgreSQL and a reverse proxy, rather than to a managed application platform with managed
Postgres.

## Why, given that a managed platform is less work

Three project-specific reasons outweigh the convenience:

**A stable outbound IP — hedging an unverified risk, not satisfying a known requirement.**
ADR 0003 leaves open whether bKash allowlists merchant IPs on production credentials. A
later review found no authoritative bKash documentation requiring it; the IP-allowlist
references that do exist concern verifying *inbound* IPN source addresses, not allowlisting
a merchant's outbound one. So this is a cheap hedge against a risk that may not exist,
and it should not be read as the decisive reason. **Confirm with bKash onboarding**; if
they do not allowlist, this argument falls away entirely and the managed-platform option
below becomes materially more attractive.

**A single owner for the bKash token.** The Grant Token API is capped at two calls per
hour, so the token must be cached in storage shared across every worker. Whichever runtime
owns bKash must own it *exclusively* — two independent caches racing that limit would lock
the merchant out of their own gateway. One server makes that trivially true.

**Transactional stock control.** Overselling is prevented by row-level locking during
order placement. Postgres on the same host, reached over a local socket, keeps that path
short and predictable, with no connection-pooler behaviour between the app and its locks.

**Cost proportionality.** Under $40 a month against roughly $50–100 for platform plus
managed database at equivalent capacity. Not decisive on its own, but it compounds for a
business whose first-year volume is unknown.

## Considered Options

- **Managed platform (Fly, Railway, Render) with managed Postgres** — less operational
  work, backups and patching handled, easy rollbacks. Rejected on the IP question and
  cost, not on capability. This is the option to revisit first if operator time becomes
  the binding constraint.
- **Serverless plus managed database** — rejected outright: rotating IPs, and cold starts
  on a latency-sensitive market.

## Consequences

**Operating the server is now our job**: security patching, uptime, disk, and Postgres
administration. Two mitigations are load-bearing rather than optional, and this decision
is only sound if both actually exist — a **tested restore** from offsite backups, and a
**provisioning script in the repository** so a lost machine is a documented rebuild rather
than an improvisation.

The server is a single point of failure. Accepted at this scale, on the reasoning that a
second machine adds more operational surface than it removes risk for a two-operator
business, and that recovery speed matters more than uptime percentage when the failure
mode is rare.

Reversing this is comparatively cheap while the app stays a standard containerised
SvelteKit process against Postgres — which is a reason to keep it that way and avoid
depending on anything specific to the host.
