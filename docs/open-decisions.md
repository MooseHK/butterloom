# Open decisions

Decisions deliberately not yet made. Each notes the recommendation on the table
and what it blocks, so none of them get settled by accident.

Four decisions that were on this list have been settled and moved to
[docs/adr/](./adr/): the application stack (ADR-0005), hosting (ADR-0006), the
Reservation expiry window (ADR-0007), and OTP on Cash on Delivery (ADR-0008).

## 1. Reporting specification

Revenue recognition is settled (at delivery, per CONTEXT.md) but the reports
themselves are not. Candidates: RTO rate by area, remitted revenue by month,
TrxID rejection rate, days from Collected to Remitted, stock turn by product.
Blocked on nothing; needs a working session.

## 2. Refund handling for Manual bKash

A refund is a manual send-money back with Butterloom absorbing the transfer fee.
Needs a policy and an audited screen; neither is drafted. ADR-0007 added a second
caller for it — an order whose payment is verified after its Reservation lapsed
and whose stock is gone — so this is no longer only an edge case of customer
cancellation.
