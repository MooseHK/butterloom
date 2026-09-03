# Plans

Work that is decided but not built. A plan lives here from the moment it is agreed until
the last of it ships, and then it goes — the ADRs keep the decision, the code keeps the
result, and a plan that outlives its work is just a document that lies.

Each plan says what it changes, in what order, what has to be true before it is done, and
what it deliberately leaves alone.

## The order

**Reservation is deferred as overkill for now.** It only blocks manual bKash, which may not be implemented. Under COD checkout, inventory commits directly at placement without requiring 90-minute hold machinery. Compliance (0002) is unblocked and implemented directly.

| # | Plan | Status | Blocked on |
|---|---|---|---|
| [0001](./0001-reservation.md) | Reservation, 90-minute window | Shelved / overkill for now | Only blocks manual bKash (unimplemented) |
| [0002](./0002-compliance.md) | Regulatory obligations that live in software | Implemented (§1–4, 8–11; §5–7 moved to 0003) | Done |
| [0003](./0003-refunds.md) | Refunds, Settlement State, Delivery SLA, Complaints & Reviews | Ready to build | Refund policy & settlement design |
| [0004](./0004-point-in-time-restore.md) | Point-in-time restore, and the drill | Ready to build, independent | An object-storage bucket that does not exist yet |

0002 is active without depending on 0001. Delivery SLA, Complaints, and Reviews (§5, §6, §7 of 0002) have been moved into 0003.
0004 is the only one that needs no application code and can start today in parallel.

## What these plans are not

They do not reopen settled decisions. Where a plan collides with an ADR — and
`0002-compliance.md` §1 does, squarely — it says so and puts the choice in front of
somebody rather than quietly picking a side.
