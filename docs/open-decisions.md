# Open decisions

Decisions deliberately not yet made. Each notes the recommendation on the table
and what it blocks, so none of them get settled by accident.

## 1. Application stack — blocks everything

**Recommendation:** Django and PostgreSQL, server-rendered templates with htmx,
no single-page application.

The case: Django's admin refunds most of the back-office cost that ADR-0002 put
on us, giving product, inventory, customer and order management from the model
definitions, leaving only the verification, dispatch and reconciliation screens
to build by hand. Server-rendered HTML also suits customers who are overwhelmingly
on mobile networks, where a bundle-then-hydrate-then-fetch sequence costs three
round trips before the first product image appears. Reporting over the two-axis
model is then plain SQL.

The alternative worth taking seriously is Next.js with PostgreSQL, if a bespoke
animated storefront matters more than the free admin, or if React skills are
materially stronger than Python ones on the team that will maintain this. That
trade is real; team language strength should outweigh every argument above.

## 2. Reporting specification

Revenue recognition is settled (at **Remitted**, per CONTEXT.md) but the reports
themselves are not. Candidates: RTO rate by area, remitted revenue by month,
TrxID rejection rate, days from Collected to Remitted, stock turn by product.
Blocked on nothing; needs a working session.

## 3. Reservation expiry window

How long stock is held for an unverified Manual bKash order before release.
**Recommendation:** 60–90 minutes. Too short strands honest customers mid-payment;
too long lets fake orders lock a catalogue where stock is frequently one.

## 4. OTP on Cash on Delivery orders

**Recommendation:** adopt it. Phone verification at checkout is the strongest
available suppressant of RTO, which is expected to be the largest cost line after
goods. Also establishes phone as customer identity, which BD commerce assumes
anyway, and enables a blocklist of repeat refusers.

## 5. Hosting

Singapore region, provider open. Specifics — provider, instance shape, database,
backup and restore arrangements, CDN — are unresolved and partly depend on
decision 1.

## 6. Refund handling for Manual bKash

A refund is a manual send-money back with Butterloom absorbing the transfer fee.
Needs a policy and an audited screen; neither is drafted.
