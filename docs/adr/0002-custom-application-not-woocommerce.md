# Build a custom application rather than adopt WooCommerce

The case for WooCommerce was the officially maintained bKash and Pathao plugins,
which spare us writing and owning those integrations. Scoping the launch removed
both: the launch Payment Tiers are Cash on Delivery and Manual bKash, neither of
which calls a payment gateway, and Pathao consignments are managed by hand in the
merchant panel rather than over the API. With its integrations out of scope,
WooCommerce contributes no advantage while still imposing its single order-status
field on the two-axis Fulfilment State / Settlement State model we require, which
it cannot express without being bent out of shape.

The branch this work lands on is named for a WooCommerce migration. That name is
historical; this ADR is the decision that superseded it.

## Consequences

- We own the back-office outright — product and inventory management, order
  administration, customer records, transactional email. This is the substantial
  cost of the decision and dwarfs the storefront.
- Reporting becomes queries against a schema we designed for the two-axis model,
  rather than a fight with an analytics module built on a revenue-at-checkout
  assumption that is wrong under Cash on Delivery.
- Handling no card data keeps us out of meaningful PCI scope.
- If bKash PGW or an aggregator is approved later, we write those adapters
  ourselves. ADR-0001 already placed that cost on us, so nothing changes.
