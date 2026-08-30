# Deployment

Status: **plan, not yet built.** Nothing here is provisioned.

Butterloom deploys to a **single self-managed VPS** (ADR 0007) running the SvelteKit app,
PostgreSQL and a TLS-terminating reverse proxy. The shape is deliberately boring: one
server, one database, one deploy command, no orchestration.

---

## 1. Topology

```
                      Internet
                          │
                    ┌─────▼─────┐
                    │   Caddy   │  :80 → :443, automatic Let's Encrypt
                    └─────┬─────┘
                          │  (docker network, not published)
                    ┌─────▼─────┐
                    │ SvelteKit │  adapter-node, :3000
                    │  (app)    │
                    └─────┬─────┘
                          │  (docker network, not published)
                    ┌─────▼─────┐
                    │ Postgres  │  bound to the docker network only
                    └─────┬─────┘
                          │
                   nightly dump + WAL
                          │
                    ┌─────▼─────────────────┐
                    │ offsite object storage │  different provider
                    └───────────────────────┘
```

Only ports 80, 443 and SSH are open to the internet. **Postgres is never published to a
host port** — an exposed database with a weak password is the most common way small
deployments are lost.

## 2. Provider and region

A 2–4 GB VPS with a **fixed IPv4 address**. Candidates with Singapore or Mumbai presence:
DigitalOcean, Vultr, Linode, Hetzner (Singapore only via their newer regions — verify).

**Do not choose the region from a map.** Mumbai is geographically closer to Dhaka, but
Bangladesh's international traffic runs over submarine cable paths that often route via
Singapore, so the shorter distance is not reliably the lower latency. **Measure both from
an actual Dhaka connection before committing** — a few `mtr` runs on a mobile network and
a broadband line settle it in an afternoon and cannot be reasoned about from here.

## 3. Environments

| Environment | Where | Data |
|---|---|---|
| Local development | developer machine, Docker Compose | seed fixtures from the repo |
| CI | GitHub Actions, ephemeral Postgres service | fixtures |
| Production | the VPS | real |

**There is no staging server**, deliberately — a second always-on environment for two
operators costs more in drift and maintenance than it returns. What replaces it is a
**Migration rehearsal:** before any release carrying a schema change, restore the latest
production backup only into an access-controlled ephemeral environment that meets the
production security baseline, run the migration, and destroy it. Local rehearsals must use
sanitised fixtures; never copy production customer data to a developer machine.

## 4. Deploy pipeline

Triggered by a push to `main` after CI passes. Nothing deploys from a developer machine.

```
push to main
   └─ CI: typecheck · unit tests · build            ← must pass
        └─ build container image, tag with the commit SHA
             └─ push to GitHub Container Registry
                  └─ SSH to the VPS
                       ├─ pull the new image
                       ├─ run migrations (expand phase only — see §5)
                       ├─ start the new container alongside the old
                       ├─ health check the new container
                       ├─ switch Caddy upstream to it
                       └─ stop the old container (keep the image)
```

**Rollback is redeploying the previous image tag.** It works without a database restore
precisely because migrations follow the expand-contract discipline below — the previous
application version still runs correctly against the newer schema.

Images are tagged by commit SHA, never `latest`, so what is running is always traceable
to a commit.

## 5. Migrations

Checked into the repo from the first table, applied by the deploy, forward-only.

**Expand-contract, always, and never both halves in one release:**

1. **Expand** — add the new column or table, nullable or defaulted. Old code ignores it.
2. **Backfill** — populate it, in batches if the table is large.
3. **Switch** — new code reads and writes the new shape. *Deploy here.*
4. **Contract** — drop the old column, in a **later** release, once the previous version
   is no longer a rollback target.

The rule this enforces: **at every moment, the schema is compatible with both the running
version and the one before it.** A migration that drops a column in the same release that
stops using it makes rollback impossible without a restore, which is exactly the moment
you least want to be restoring.

Destructive operations — `DROP COLUMN`, `DROP TABLE`, type narrowing — go in their own
release with nothing else in it.

## 6. Secrets

Held in an environment file on the server, readable only by root, injected into the
container at start. Never in the repository, never in the image, never in a build
argument (they persist in image layers).

CI holds only what it needs to deploy: the registry token and the SSH deploy key, as
GitHub Actions secrets.

Rotation is manual and expected to be rare. The set to plan for: database password,
session signing key, SMS aggregator credentials, and later the bKash app key/secret and
Pathao client credentials — all of which live server-side and never reach the browser,
which is what `$lib/server` enforces at build time.

## 7. Backups

**Two distinct things, often conflated, with different retention:**

**Operational backups** — for recovering from failure. Nightly `pg_dump`, plus continuous
WAL archiving for point-in-time recovery. Retained **30–90 days**. Encrypted, pushed to
object storage **at a different provider** — a backup on the same provider as the server
does not survive an account suspension.

**The mandated business record** — orders, order lines, payments, invoices, consignments
and complaints must be retained **six years** (see `docs/COMPLIANCE.md`). This does *not*
mean six years of nightly snapshots. It means a periodic archival export of those tables,
retained six years, encrypted.

Separating them matters for a second reason: a customer exercising erasure has their
details redacted in the live database, but redaction cannot reach into historic backups.
Operational backups ageing out within 90 days bounds that exposure, while the long-term
archive holds only the business record the law requires you to keep.

**A restore is only real once rehearsed.** Restore into a scratch database quarterly, and
before launch, and record how long it took. The `docs/PLAN.md` Phase 4 gate —
*losing the server would cost no orders* — is met by a tested restore, not by a backup job
that exits zero.

## 8. DNS and TLS

Caddy obtains and renews Let's Encrypt certificates automatically; there is no manual
certificate step and no expiry to forget. HTTPS is redirected from HTTP and HSTS is set
once the domain is stable.

Webhooks require a publicly reachable HTTPS endpoint — bKash IPN and Pathao's signed
callback, the latter with a 10-second response requirement (ADR 0003). This topology
provides that; it is one of the reasons a static host cannot be the production target.

## 9. Monitoring

Minimum viable, because unmonitored is indistinguishable from broken:

- **External uptime check** every minute against a health endpoint that touches the
  database, alerting to phone. Checking from outside catches the case where the whole
  server is gone.
- **Error tracking** in the app, so exceptions surface without reading logs.
- **Disk space alerting.** A full disk on a single-server deployment stops Postgres, and
  it is the most common self-inflicted outage.
- **Backup success alerting** — specifically, alert on the *absence* of a successful
  backup, not just on failures. A cron job that silently stopped running produces no
  failure to alert on.

## 10. Server baseline

SSH by key only, root login disabled, unattended security upgrades enabled, a firewall
allowing only 80/443/SSH, and the application container running as a non-root user.

**Provisioning is a script in the repository, not a remembered sequence.** This is the
real mitigation for single-server risk: the answer to a lost machine is a documented
rebuild measured in tens of minutes, not an improvisation under pressure. Anything done
by hand on the server that is not in that script is a step that will be forgotten.

## 11. Data residency

Customer names, phone numbers and addresses on a foreign-hosted VPS appear to be
acceptable under the Personal Data Protection Act 2026, which restricts large-scale
transfer of *sensitive identifiers* — NID, passport, biometric, genetic data. The
practical safeguard is simply **not to collect any of those**, which the data model does
not; see `docs/DATA-MODEL.md`. If NID collection is ever contemplated, this decision needs
legal advice first, not after.

## 12. Rough running cost

| Item | Indicative |
|---|---|
| VPS, 2–4 GB, fixed IP | $12–24 / month |
| Offsite object storage | ~$5 / month |
| Domain | ~$15 / year |
| Uptime + error monitoring | free tiers are adequate at this scale |

Under $40 a month, which is a fraction of what the equivalent managed platform plus
managed Postgres would cost — but see ADR 0007 for what that saving is actually buying
and what it costs in operator time.

## 13. Deliberately not done yet

No load balancing, no read replica, no autoscaling, no blue-green infrastructure beyond
the container swap in §4, no CDN. Each is addable, and none is justified before there is
traffic to justify it. The single genuine gap this leaves is that **the server is a single
point of failure**; it is answered by tested backups and a provisioning script rather than
by a second machine.
