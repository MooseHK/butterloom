# Open decisions

Decisions deliberately not yet made. Each notes the recommendation on the table
and what it blocks, so none of them get settled by accident.

Four decisions that were on this list have been settled and moved to
[docs/adr/](./adr/): the application stack (ADR-0005), hosting (ADR-0006), the
Reservation expiry window (ADR-0007), and OTP on Cash on Delivery (ADR-0008).

## 1. How the back-office gets built

New, and created by ADR-0005: choosing SvelteKit gave up the free admin, so
product, inventory, customer and order administration are now ours. The question
is whether they are hand-built screens or generated from the schema by a CRUD
library, and it is worth answering deliberately rather than by writing the first
one by hand and continuing.

**Recommendation:** generate the record-keeping screens from the schema and
hand-build only the three that carry business logic — TrxID verification,
Dispatch Batch assembly, remittance reconciliation. Those three are the operator's
actual job and are where a generic CRUD shape actively gets in the way.

Blocks nothing yet; wants deciding before the second admin screen is written.

## 2. Reporting specification

Revenue recognition is settled (at delivery, per CONTEXT.md) but the reports
themselves are not. Candidates: RTO rate by area, remitted revenue by month,
TrxID rejection rate, days from Collected to Remitted, stock turn by product.
Blocked on nothing; needs a working session.

## 3. Refund handling for Manual bKash

**Deferred deliberately, and safe to defer.** A refund is a manual send-money
back with Butterloom absorbing the transfer fee. What launch actually requires is
the *published policy* — already a trading prerequisite, since gateways inspect
the live site — and somewhere to record that a refund happened against the order,
so the money is auditable. Both are small.

The audited refund *screen* is what waits. At this volume the honest path is that
the operator performs the send-money and records it, which is what a first
version of the screen would have automated anyway. Build it once there is enough
refund traffic to know what it needs to show.

ADR-0007 added a second caller — an order whose payment is verified after its
Reservation lapsed and whose stock is gone — so this is no longer only an edge
case of customer cancellation. That raises how often the path is walked; it does
not change that the manual path is adequate at launch.
