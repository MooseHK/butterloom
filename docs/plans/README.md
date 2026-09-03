# Plans

Work that is decided but not built. A plan lives here from the moment it is agreed until
the last of it ships, and then it goes — the ADRs keep the decision, the code keeps the
result, and a plan that outlives its work is just a document that lies.

Each plan says what it changes, in what order, what has to be true before it is done, and
what it deliberately leaves alone.

## The order

**Reservation is first, before everything else.** It is the stock model the rest sits on:
refunds need to know what an order consumed, the compliance work needs a truthful
availability answer at checkout, and neither can be built twice.

| # | Plan | Status | Blocked on |
|---|---|---|---|
| [0001](./0001-reservation.md) | Reservation, 90-minute window | Ready to build | Nothing |
| [0002](./0002-compliance.md) | Regulatory obligations that live in software | Ready to start §1 | §1 is a decision, not code; three items need a local consultant |
| [0003](./0003-refunds.md) | Refunds, and the Settlement State they need | Ready to build after 0001 | Refund policy is not written (open decision #4) |
| [0004](./0004-point-in-time-restore.md) | Point-in-time restore, and the drill | Ready to build, independent | An object-storage bucket that does not exist yet |

0002, 0003 and 0004 do not depend on each other and can run in any order once 0001 lands.
0004 is the only one that needs no application code and can start today in parallel.

## What these plans are not

They do not reopen settled decisions. Where a plan collides with an ADR — and
`0002-compliance.md` §1 does, squarely — it says so and puts the choice in front of
somebody rather than quietly picking a side.
