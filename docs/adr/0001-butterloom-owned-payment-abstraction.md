# Butterloom owns the payment abstraction; gateways are swappable adapters behind it

Accepting bKash, Nagad or card money in Bangladesh requires Merchant Approval,
which providers grant on their own schedule and may withhold — a commercial
dependency no architecture removes, and one that is identical whether we build
custom or on WooCommerce. Rather than let it gate launch, checkout is written
against a Butterloom-owned payment interface with four tiers behind it: Cash on
Delivery and Manual bKash (neither needs anyone's approval), plus bKash PGW and
a payment aggregator (both do). We launch on the first two and treat the latter
two as margin-and-UX upgrades that land whenever approval arrives.

## Consequences

- Approval delay or refusal costs us fee margin and checkout polish, never the
  ability to trade.
- Official vendor plugins become one implementation behind our interface, so an
  abandoned or broken plugin is an adapter swap rather than a checkout rewrite.
- We carry the cost of a tier that stock WooCommerce has no concept of: Manual
  bKash needs TrxID capture, duplicate-TrxID rejection, and a staff
  reconciliation queue.
