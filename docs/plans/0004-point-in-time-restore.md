# Point-in-time restore, and the drill that makes it real

Closes **open decision #6**, which is not a design decision but is tracked because
forgetting it silently invalidates ADR-0006.

Needs no application code and depends on no other plan. It can start today, in parallel
with `0001-reservation.md`, and it is the only item here that gets worse the longer it
waits — every day without it is a day of orders that a lost instance takes with it.

## Where this actually stands

**There are no backups.** Not "backups that need improving" — none. The database is one
file on one Docker volume on one instance that does not exist yet, and when it does exist,
losing it loses every order, every product, every image and every derivative.

ADR-0006 chose SQLite in-process over PostgreSQL and listed the cost plainly: *"Restore is
a rehearsed procedure, not an assumption. There is no managed point-in-time recovery to
fall back on... the decision is only sound if that drill is actually performed."* This plan
is the other half of that ADR. Until it lands, ADR-0006 is a decision whose stated
precondition is unmet.

Two things are already in place and worth knowing, because they decide the mechanism:
`src/db/client.ts` puts the database in **WAL mode** (which is what makes continuous
replication possible at all) and sets `busy_timeout`, and `docker-compose.yml` keeps the
database on a named volume at `/app/var` rather than inside the container.

## Mechanism

**Continuous WAL replication to object storage** — the standard answer for SQLite, and the
one ADR-0006 already describes as "continuous replication to the same object storage that
holds image derivatives". A replication sidecar reads the WAL and ships it; restoring means
fetching the last snapshot plus the WAL segments up to a chosen instant.

The alternative worth naming and rejecting: periodic `VACUUM INTO` snapshots on a cron. It
is simpler and it has no continuous component, so the recovery point is the last snapshot —
an hourly cron means losing up to an hour of orders. At 30 orders a day that is a small
number of orders and every one of them is a real person expecting a parcel. Continuous
replication brings the exposure to seconds for roughly the same operational surface.

**Targets:**

| | Target | Why this number |
|---|---|---|
| **RPO** — data lost | seconds | The replication interval, not the backup interval |
| **RTO** — time to serving again | under an hour | Provision from the script (`docs/DEPLOYMENT.md` §10) + restore + boot. This is a *measured* number after the first drill, not a promise before it |

**Two buckets, two providers.** The primary holds the replica; a periodic copy goes to a
bucket at a different provider, because an account suspension that takes the instance can
take a bucket in the same account with it. Both encrypted; credentials live in the
root-readable `.env` and nowhere else.

## One thing to change before replicating

`src/db/client.ts` sets `synchronous = NORMAL`. In WAL mode that is durable across a
process crash but **can lose recently committed transactions on a power loss or host
crash** — the commit is in the OS cache, not on the platter. The instance is a single
machine and its host is somebody else's hardware.

Recommendation: **`synchronous = FULL` in production.** The cost is an fsync per commit,
which at ADR-0003's thirty orders a day is not a number anybody will ever notice, and the
benefit is that "committed" means committed at the moment the customer sees their order
confirmed. Leave `NORMAL` for local development and tests, where the write volume is
artificial and the durability is worthless.

Replicating a database that can lose its own last commits is backing up a lie about the
recovery point, which is why this belongs here rather than in a tidy-up later.

## Media is a second restore problem

The database is not the whole of it. `/app/var/media` holds every derivative *and* the
originals kept so the ladder can be re-cut — and a restore that brings back the database
without them brings back a catalogue of broken images.

Derivatives are content-addressed and immutable (ADR-0007), so they need no versioning and
no purge, only a copy. Once `BUTTERLOOM_MEDIA_BASE_URL` points at a real bucket the problem
mostly solves itself, because the bucket *is* the storage rather than a copy of it. Until
then the volume needs its own sync, and the restore procedure has to fetch both halves or
it is not a restore.

## Retention, split by purpose

Straight from `docs/DEPLOYMENT.md` §7, restated because the split is the part people
collapse:

- **Operational** — 30–90 days, for recovering from failure. Ages out deliberately: it is
  also what bounds how long a redacted customer's details survive after an erasure request
  (`0002-compliance.md` §8), since redaction cannot reach into historic snapshots.
- **The mandated business record** — six years, encrypted, and *not* six years of nightly
  snapshots. A periodic archival export of the business-record tables only. The table list
  belongs to `0002-compliance.md` §9; this plan owns the export and its storage.

## Monitoring

**Alert on the absence of a successful replication, not on failure.** A replication process
that silently stopped produces no failure to alert on, and this is the single most common
way a backup system is discovered to have been dead for months.

The cheap version, which is adequate here: the external uptime monitor already required by
`docs/DEPLOYMENT.md` §9 checks that the replica's most recent generation timestamp is
within a few minutes of now. Add disk-space alerting beside it — a full volume stops SQLite
writes and stops replication, and on this deployment the volume fills from the admin's
image uploads long before it fills from traffic.

## The drill — this is the deliverable, not the replication

A backup job that exits zero is not a restore. The drill is what turns ADR-0006 from a
decision into a sound one.

**Cadence:** before launch, quarterly thereafter, and before any release carrying a schema
change — where it doubles as the migration rehearsal `docs/DEPLOYMENT.md` §3 requires
instead of a staging server. One script, two reasons to run it.

**The procedure, which lives as a script in the repository and not as a memory:**

1. Provision a scratch environment that meets the production security baseline. **Not a
   developer laptop** — a restore contains real customer names, phone numbers and
   addresses, and moving those to a personal machine is a transfer under PDPA 2026
   (`docs/COMPLIANCE.md`).
2. Restore the database **to a chosen timestamp**, not merely to "latest". Restoring to a
   point is the capability being tested; if the drill only ever restores the newest state,
   the point-in-time part is untested and will be first attempted during an incident.
3. Fetch the matching media.
4. Run `PRAGMA integrity_check` and `PRAGMA foreign_key_check`. Both must come back clean.
5. Boot the application against it. Migrations run at start (`src/server.tsx:22`), so a
   successful boot also proves the restored schema is one this release can open.
6. Verify against known facts: the last order placed before the target timestamp is present
   and the first one after it is absent; a product page renders with its images.
7. **Record the wall-clock time it took**, in the operator runbook ADR-0003 requires. An
   untimed drill does not give you an RTO, and the number is the whole point of running it.
8. Destroy the environment.

**A drill that fails is the plan working.** It is worth saying because the temptation on a
quarterly checklist is to record success and move on; the failure found in a drill is the
one that did not happen during an outage.

## Sequence

| Order | Work | Depends on |
|---|---|---|
| 1 | Provision two buckets at two providers; credentials into `.env` | Nothing — can start today |
| 2 | `synchronous = FULL` in production config | Nothing |
| 3 | Replication sidecar in `docker-compose.yml`, plus its config file | 1 |
| 4 | `scripts/restore.sh` in the repository, taking a target timestamp | 3 |
| 5 | Media sync, or the move of derivatives into the bucket | 1 |
| 6 | Replication-freshness and disk-space alerting | 3 |
| 7 | **First drill, timed, before launch** | 4, 5 |
| 8 | Quarterly cadence written into the runbook | 7 |
| 9 | Six-year archival export | `0002-compliance.md` §9 fixing the table list |

## Done when

- A restore to a timestamp of somebody's choosing has actually been performed, by following
  the script and nothing else, and the wall-clock time is written down.
- The alert fires when replication is stopped deliberately, and is seen by the person it is
  meant to reach.
- Open decision #6 is closed in `docs/open-decisions.md`, and ADR-0006's stated
  precondition is met rather than assumed.

## Deliberately not in this plan

A second instance, a read replica, or any form of automatic failover. ADR-0007 accepts a
single origin, and the answer to a lost machine here is a documented rebuild plus a tested
restore — which is only an acceptable answer once the restore is genuinely tested, which is
what this plan is for.
