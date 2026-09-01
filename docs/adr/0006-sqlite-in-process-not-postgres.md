# SQLite in-process, replicated to object storage, rather than PostgreSQL

ADR-0003 sets deliberate ceilings — 30 orders a day, one operator, no concurrency —
and states that building past them is the main way this project could fail.
ADR-0007 then moves catalogue HTML to the edge, leaving the origin serving only
checkout, Reservation and the back-office. Tested against those two constraints
rather than as part of the Django package it was recommended with, PostgreSQL no
longer earns its place: the database runs in-process as SQLite, with continuous
replication to the same object storage that holds image derivatives. This
overturns the recommendation in `docs/open-decisions.md` §1.

## Consequences

- **A network round trip disappears from checkout**, which after ADR-0007 is one of
  the few paths never served from cache.
- **A service the single operator would have to patch, secure and back up
  disappears entirely.** ADR-0003 names that operator as a single point of failure
  in a role that will change hands; removing a moving part matters more here than
  it would elsewhere.
- **SQLite's single writer is an asset, not a limitation, for this domain.** Stock
  is frequently one, so the sharpest correctness question in the system is two
  customers claiming the last item at the same moment. Serialised writes make that
  trivially correct with no advisory locks, no `SELECT FOR UPDATE`, and no
  isolation-level reasoning. Every connection must set a `busy_timeout`.
- **One always-on instance with a persistent volume, permanently.** Serverless and
  edge-function hosting are ruled out, and horizontal scale is unavailable without
  a migration. This is a restatement of ADR-0003's ceilings, not a new limit.
- **Money is stored as integer paisa**, because SQLite has no native decimal type.
  Remittance-net-of-fees arithmetic must respect that convention everywhere.
- **Restore is a rehearsed procedure, not an assumption.** There is no managed
  point-in-time recovery to fall back on. ADR-0003 already requires the operator's
  workflow to be a written runbook; a tested restore drill belongs in it, and the
  decision is only sound if that drill is actually performed.
- Replication targets object storage that already exists for images, so backup
  introduces no new vendor.
