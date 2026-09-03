# Deployment

Status: **plan, partly built.** The container, the compose file and the reverse proxy are
in the repository and run locally. Nothing is provisioned: there is no server, no object
storage bucket, no CDN and no backup target yet.

Carried over from PR #4 and rewritten against what was actually built. The original
described a SvelteKit application in front of PostgreSQL on a self-managed VPS. This
project runs a Hono application with **SQLite in process** (ADR-0006) behind an **edge
CDN** (ADR-0007), so the topology, the migration mechanics and — most of all — the backup
story are different enough that carrying the original over unchanged would have been
worse than not carrying it at all. What survives unchanged is the discipline:
expand-contract migrations, secrets that never enter an image, backups split by purpose,
and a restore that is only real once rehearsed.

---

## 1. Topology

```
                         Customers in Bangladesh
                                    │
                          ┌─────────▼─────────┐
                          │   CDN, Dhaka PoP  │  catalogue HTML + /media
                          └─────────┬─────────┘   (admin paths excluded)
                                    │  misses only
                              ┌─────▼─────┐
                              │   Caddy   │  :80 → :443, automatic Let's Encrypt
                              └─────┬─────┘
                                    │  (docker network, not published)
                              ┌─────▼─────┐
                              │ butterloom│  Hono on Node 22, :3000
                              │           │  SQLite in-process, libvips subprocess
                              └─────┬─────┘
                                    │
                        /app/var  (persistent volume)
                        ├── butterloom.db      ← the database
                        └── media/             ← derivatives, until the bucket exists
                                    │
                       continuous replication + archive
                                    │
                          ┌─────────▼──────────┐
                          │ object storage      │  derivatives, DB replica,
                          │ (+ offsite copy)    │  six-year business archive
                          └─────────────────────┘
```

Only 80, 443 and SSH are open. **There is no database port to expose** — the largest
single class of small-deployment loss is simply absent here, which is one of the things
ADR-0006 bought. What replaces it as the thing to protect is the volume: `/app/var` holds
both the database and, for now, every image derivative.

The application container is the only writer of that volume, and per ADR-0003 there is
exactly one of it. Two application containers against one SQLite file is not a
configuration this design supports — it is the horizontal scale ADR-0006 explicitly gives
up.

## 2. Provider and region

**Singapore, settled by ADR-0007**, which measured a cold Dhaka→Singapore connection at
roughly three round trips (~250ms) against a Dhaka PoP answering in 10–20ms and put the
catalogue at the edge because of it. Mumbai is geographically closer to Dhaka but
Bangladeshi international traffic routes over cable paths that often favour Singapore, so
the region is not a decision to take off a map.

That leaves one thing to do rather than decide: **confirm it from an actual Dhaka
connection before launch** — a few `mtr` runs on a mobile network and on a broadband line.
The purpose is to catch a wrong assumption cheaply, not to reopen the choice.

The smallest instance the host offers is the correct size (ADR-0003), with one caveat that
is specific to this build: **derivative encoding is a libvips subprocess and takes a core
while it runs.** A single-core instance will serve requests slowly during an admin bulk
upload. Two cores with a fixed IPv4 address is the shape to buy.

## 3. Environments

| Environment | Where | Data |
|---|---|---|
| Local development | developer machine, `npm run dev` or Docker Compose | whatever the developer seeded |
| CI | GitHub Actions | `BUTTERLOOM_DB=:memory:`, which is what `npm test` already does |
| Production | the Singapore instance | real |

**There is no staging server**, deliberately — a second always-on environment for one
operator costs more in drift and maintenance than it returns. What replaces it is a
**migration rehearsal**: before any release carrying a schema change, restore the latest
production replica into an access-controlled ephemeral environment that meets the
production security baseline, run the migration, and destroy it. This is the same restore
exercise the drill in `docs/plans/0004-point-in-time-restore.md` requires, run for a
different reason, and doing both from one script is the point.

Local rehearsals use fixtures. Never copy production customer data to a developer machine
— under PDPA 2026 that is a transfer, and `docs/COMPLIANCE.md` is the reason it is not a
convenience call.

## 4. Deploy pipeline

Triggered by a push to `main` after CI passes. Nothing deploys from a developer machine.

```
push to main
   └─ CI: npm run check · npm test                  ← must pass
        └─ build the image, tag with the commit SHA
             └─ push to the registry
                  └─ SSH to the instance
                       ├─ pull the new image
                       ├─ start it alongside the old one
                       │    (migrations run at boot — see §5)
                       ├─ health check it
                       ├─ switch the Caddy upstream
                       └─ stop the old container, keep the image
```

Images are tagged by commit SHA, never `latest`, so what is running is always traceable to
a commit.

**Rollback is redeploying the previous image tag**, and it works without a restore only
because migrations follow the expand-contract discipline below.

One wrinkle SQLite adds to the container swap: for the moments both containers are up,
**two processes have the same database file open.** WAL mode and the `busy_timeout` set in
`src/db/client.ts` make that safe for readers, but the old container must be stopped
promptly rather than left running, and a release carrying a migration should overlap for
as little time as possible. If the swap ever needs to be strictly serial, that is the
correct trade to make here: a few seconds of 502 at Dhaka midnight costs less than two
writers.

## 5. Migrations

Drizzle SQL files, checked into `drizzle/` from the first table, forward-only. They are
applied by `runMigrations()` at boot (`src/server.tsx:22`), before the server listens —
so a migration that fails takes the container down at start rather than half-applying
itself into a serving process. Generate with `npm run db:generate`; never edit an applied
file.

**Expand-contract, always, and never both halves in one release:**

1. **Expand** — add the new column or table, nullable or defaulted. Old code ignores it.
2. **Backfill** — populate it, in batches if the table is large.
3. **Switch** — new code reads and writes the new shape. *Deploy here.*
4. **Contract** — drop the old column, in a **later** release, once the previous version
   is no longer a rollback target.

The rule this enforces: **at every moment the schema is compatible with both the running
version and the one before it.** A migration that drops a column in the same release that
stops using it makes rollback impossible without a restore, which is exactly the moment
you least want to be restoring.

Destructive operations — `DROP COLUMN`, `DROP TABLE`, type narrowing — go in their own
release with nothing else in it. SQLite sharpens this: it rewrites the whole table for
most `ALTER`s, so a destructive migration is also the one most likely to be slow and the
one you least want sharing a release.

## 6. Secrets

Held in `.env` on the server, readable only by root, injected by Compose at container
start (`env_file:` in `docker-compose.yml`). Never in the repository, never in the image,
never in a build argument — build arguments persist in image layers.

CI holds only what it needs to deploy: the registry token and the SSH deploy key, as
GitHub Actions secrets.

Rotation is manual and expected to be rare. The set to plan for: the object-storage
credentials, the session signing key, the SMS aggregator credentials, and later the bKash
app key/secret and Pathao client credentials. None of them reaches the browser, which in
this architecture is not a build-time guarantee but a structural one — there is no client
bundle to leak into (ADR-0007 puts client JavaScript at four hand-written interactions).

## 7. Backups

**Two distinct things, often conflated, with different retention:**

**Operational backups** — for recovering from failure. SQLite in WAL mode supports
continuous replication of the WAL to object storage, which is what gives point-in-time
recovery here; there is no managed PITR to fall back on, and ADR-0006 says so in as many
words. Retain **30–90 days**, encrypted, pushed to a bucket at a **different provider**
from the primary so an account suspension is survivable. The mechanism, the restore
procedure and the drill are `docs/plans/0004-point-in-time-restore.md`.

**The mandated business record** — orders, order lines, payments, invoices, consignments
and complaints must be retained **six years** (`docs/COMPLIANCE.md`). This does *not* mean
six years of nightly snapshots. It means a periodic archival export of those tables,
retained six years, encrypted.

Separating them matters for a second reason: a customer exercising erasure has their
details redacted in the live database, and redaction cannot reach into historic backups.
Operational backups ageing out within 90 days bounds that exposure, while the long-term
archive holds only the business record the law requires you to keep.

**Media is a second, separate restore problem.** Derivatives are content-addressed and
immutable, so they need no versioning — but they are not in the database, and today they
are on the same volume as it. A restore that brings back the database without the images
brings back a catalogue of broken `<img>` tags. Until derivatives live in the bucket
(`BUTTERLOOM_MEDIA_BASE_URL` is the switch), the volume needs its own copy.

**A restore is only real once rehearsed.** Quarterly, and before launch, and record how
long it took.

## 8. DNS and TLS

Caddy obtains and renews Let's Encrypt certificates automatically; there is no manual
certificate step and no expiry to forget. HTTP redirects to HTTPS and HSTS goes on once
the domain is stable. The Caddyfile in the repository names `butterloombd.com` and proxies
to the application container.

Once the CDN is in front, TLS terminates at the edge as well, and the origin certificate
stays exactly as it is. Two rules travel with that change: **admin paths must be excluded
from cache rules explicitly** (ADR-0007 calls the exclusion security-relevant, not a
performance detail), and no cacheable path may set a cookie — there is already a
middleware that refuses to mark a response cacheable if it carries `Set-Cookie`, and it
logs when it does.

Webhooks need a publicly reachable HTTPS endpoint: bKash IPN and Pathao's signed callback,
the latter with a 10-second response requirement. This topology provides that; neither is
built yet.

## 9. Monitoring

Minimum viable, because unmonitored is indistinguishable from broken:

- **External uptime check** every minute against a health endpoint that touches the
  database, alerting to a phone. Checking from outside catches the case where the whole
  instance is gone.
- **Error tracking** in the application, so exceptions surface without reading logs.
- **Disk space alerting.** On this deployment the volume holds the database *and* the
  image derivatives *and* the originals kept for re-cutting the ladder, so it fills from
  the admin side long before it fills from traffic. A full disk stops writes to SQLite.
- **Replication lag and backup-success alerting** — specifically, alert on the *absence*
  of a successful replication, not only on failures. A replication process that silently
  stopped produces no failure to alert on.
- **Pending-image queue depth.** `BUTTERLOOM_MAX_PENDING_IMAGES` refuses new work at 200;
  hitting that ceiling means the encoder has stalled, and the symptom an operator sees is
  an admin form rejecting a bulk upload for no visible reason.

## 10. Server baseline

SSH by key only, root login disabled, unattended security upgrades enabled, a firewall
allowing only 80/443/SSH, and the application container running as a non-root user.

**Provisioning is a script in the repository, not a remembered sequence.** This is the real
mitigation for single-instance risk: the answer to a lost machine is a documented rebuild
measured in tens of minutes, not an improvisation under pressure. Anything done by hand on
the server that is not in that script is a step that will be forgotten. ADR-0003 already
requires the operator's workflow to be a written runbook; this is the same argument
applied to the machine.

## 11. Data residency

Customer names, phone numbers and addresses on a foreign-hosted instance appear to be
acceptable under the Personal Data Protection Act 2026, which restricts large-scale
transfer of *sensitive identifiers* — NID, passport, biometric, genetic data. The
practical safeguard is simply **not to collect any of those**, which the schema does not.
If NID collection is ever contemplated — a courier fraud-check integration is the likely
route in — this needs legal advice first, not after.

## 12. Rough running cost

| Item | Indicative |
|---|---|
| Instance, 2 cores, fixed IP, Singapore | $12–24 / month |
| Object storage, primary + offsite copy | ~$5–10 / month |
| CDN | free tier is adequate at this volume; egress is the number to watch |
| Domain | ~$15 / year |
| Uptime + error monitoring | free tiers are adequate at this scale |

Under $50 a month. ADR-0007 notes that egress, not compute, is the largest infrastructure
cost at scale, because every image byte is served to Bangladesh — which is why object
storage was chosen for zero egress fees and why the derivative ladder (open decision #5)
is the number that decides this table, not the instance size.

## 13. Deliberately not done yet

No load balancing, no read replica, no autoscaling, no blue-green beyond the container
swap in §4. Each is addable; none is justified before there is traffic to justify it, and
ADR-0006 gives up horizontal scale on purpose.

The single genuine gap this leaves is that **the instance is a single point of failure.**
It is answered by tested backups and a provisioning script rather than by a second
machine. ADR-0007 notes the related risk it declines to design around: an
international-bandwidth disruption in Bangladesh leaves cached catalogue pages serving
from the Dhaka PoP while checkout, being uncached, stops.
