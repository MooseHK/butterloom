# Open decisions

Decisions deliberately not yet made. Each notes the recommendation on the table
and what it blocks, so none of them get settled by accident.

Settled since this list was written, and no longer open: the application stack
(ADR-0005), the database (ADR-0006), and delivery architecture and hosting
(ADR-0007). The stack recommendation recorded here — Django, PostgreSQL and htmx
— was not the decision reached; ADR-0005 and ADR-0006 record why.

Those were removed from the list and the rest renumbered, which is why ADR-0006
points at a "§1" that is now a different decision entirely. So the convention has
changed: **a settled entry stays where it is, marked settled, and the numbers never
move.** `src/config.ts` and the plans in `docs/plans/` both cite these numbers.

## 1. Reporting specification

Revenue is recognised when goods are delivered, per CONTEXT.md; **Remitted** is a
cash-settlement event and not a revenue-recognition event. The reports themselves
are not specified. Candidates: RTO rate by area, remitted revenue by month, TrxID
rejection rate, days from Collected to Remitted, stock turn by product. Blocked on
nothing; needs a working session.

## 2. Reservation expiry window — **SETTLED: 90 minutes**

How long stock is held for an unverified Manual bKash order before release.
~~**Recommendation:** 60–90 minutes.~~ Too short strands honest customers mid-payment;
too long lets fake orders lock a catalogue where stock is frequently one.

Settled at **90 minutes**, the customer-safe end of the range, on the reasoning that a
Manual bKash sender may have to leave the house to reach an agent. Configurable via
`BUTTERLOOM_RESERVATION_WINDOW_MINUTES` so the number can move without a code change.
`docs/plans/0001-reservation.md` is the plan; the window is not built yet.

## 3. OTP on Cash on Delivery orders

**Recommendation:** adopt it. Phone verification at checkout is the strongest
available suppressant of RTO, which is expected to be the largest cost line after
goods. Also establishes phone as customer identity, which BD commerce assumes
anyway, and enables a blocklist of repeat refusers.

## 4. Refund handling for Manual bKash

A refund is a manual send-money back with Butterloom absorbing the transfer fee.
Needs a policy and an audited screen; neither is drafted.

The screen is now planned — `docs/plans/0003-refunds.md`, along with the Settlement
State it needs, since there is nothing to refund from without it. **The policy is
still the open half**, and the plan's §5 lists the four questions it has to answer.
One of them — whether a returned garment goes back on the shelf — is the same
question `0001-reservation.md` leaves open, and wants one answer rather than two.

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

`docs/plans/0004-point-in-time-restore.md` is the plan, and it can start today — it
needs no application code and depends on nothing else. This entry closes when a
restore to a chosen timestamp has actually been performed and timed, not when the
replication is switched on.

## 7. Facet value ordering

Filter values are listed in the order they were first entered, so S, M, L come
out in size order only for an operator who happened to type them in that order.
ADR-0008 records it as a known ceiling rather than a property. **Recommendation:**
leave it until somebody minds. The fix is a position column on the option value
and a control to set it, which is more admin than the problem is worth while one
person enters every option.

## 8. Per-variant pricing

ADR-0008 gives every variant of a product the product's price. Whether a
Butterloom garment ever prices one size or one colour differently is a
merchandising question nobody has answered. **Recommendation:** stay with one
price until a real product needs two. The upgrade is a nullable override on the
variant plus a `min()` "from" price in the listing; what is expensive is teaching
the listing to show a price range before anything needs one.

## 9. Whether a product may sit on two shelves

One category per product today (ADR-0008). The case that breaks it is a saree
that is also a wedding piece, and there is no wedding shelf yet.
**Recommendation:** stay with one until the second shelf exists as an editorial
idea rather than as a hypothetical. Migrating to a join table is mechanical; the
cost is that every "which shelf is this on" answer becomes a list, including the
front-page tile counts, which today add up to the catalogue.
