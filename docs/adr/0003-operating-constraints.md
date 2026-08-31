# Design for 30 orders a day, one operator, and batched dispatch

Butterloom expects at most 30 orders a day, has at most one person working the
back-office at any time, and ships in a single daily Dispatch Batch rather than
continuously. These are deliberate ceilings, not estimates awaiting revision: at
this volume the system is around 900 orders a month and a five-figure row count
after a year, so throughput, concurrency and horizontal scale are non-problems
and building for them would be the main way this project could fail.

## Consequences

- No locking or claim semantics on the back-office queues. A second concurrent
  operator is out of scope, and adding one later means revisiting this.
- No job queue, worker pool, or asynchronous processing for ordinary order flow.
  Work that must happen off-request can be a scheduled task.
- The smallest instance a host offers is the correct size. Capacity planning is
  not a live concern.
- Dispatch is a once-daily operation, so a courier handover that takes minutes
  for the whole batch is acceptable where a per-order cost of the same size
  would not be.
- The operator's workflow is a shipped deliverable — a written runbook, not
  tribal knowledge — because the single operator is a single point of failure
  and the role will change hands.
