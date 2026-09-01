# Open decisions

Decisions deliberately not yet made. Each notes the recommendation on the table
and what it blocks, so none of them get settled by accident.

Settled since this list was written, and no longer open: the application stack
(ADR-0005), the database (ADR-0006), and delivery architecture and hosting
(ADR-0007). The stack recommendation recorded here — Django, PostgreSQL and htmx
— was not the decision reached; ADR-0005 and ADR-0006 record why.

## 1. Reporting specification

Revenue is recognised when goods are delivered, per CONTEXT.md; **Remitted** is a
cash-settlement event and not a revenue-recognition event. The reports themselves
are not specified. Candidates: RTO rate by area, remitted revenue by month, TrxID
rejection rate, days from Collected to Remitted, stock turn by product. Blocked on
nothing; needs a working session.

## 2. Reservation expiry window

How long stock is held for an unverified Manual bKash order before release.
**Recommendation:** 60–90 minutes. Too short strands honest customers mid-payment;
too long lets fake orders lock a catalogue where stock is frequently one.

## 3. OTP on Cash on Delivery orders

**Recommendation:** adopt it. Phone verification at checkout is the strongest
available suppressant of RTO, which is expected to be the largest cost line after
goods. Also establishes phone as customer identity, which BD commerce assumes
anyway, and enables a blocklist of repeat refusers.

## 4. Refund handling for Manual bKash

A refund is a manual send-money back with Butterloom absorbing the transfer fee.
Needs a policy and an audited screen; neither is drafted.

## 5. Image derivative ladder

ADR-0007 settles that derivatives are pre-generated at upload and content-addressed.
The ladder itself — which widths, which formats, what quality target, and the byte
budget for a listing page — is not chosen, and it is the number that decides page
weight. Blocked on nothing; wants a real photograph to measure against.

## 6. Restore drill

ADR-0006 gives up managed point-in-time recovery, and is only sound if restoring
from the replicated copy is rehearsed rather than assumed. The drill belongs in the
operator runbook ADR-0003 requires. Not a design decision, but tracked here because
forgetting it silently invalidates ADR-0006.
