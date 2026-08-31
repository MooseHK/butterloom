# Verify the customer's phone by OTP before accepting a Cash on Delivery order

RTO is expected to be the largest cost line after goods, and Butterloom pays
freight in both directions on every one. A phone that answers an OTP at checkout
is the strongest suppressant available to us: it removes the casual fake order
outright, and it establishes the phone number as customer identity, which is what
Bangladeshi commerce assumes anyway and what a blocklist of repeat refusers has
to be keyed on. The friction is real and some conversion is lost. That is the
trade, made deliberately, because a refused parcel costs both legs of freight and
the conversion it protects was disproportionately the order that was going to be
refused.

Cash on Delivery only. A Manual bKash customer has already sent money and
supplied a TrxID, which is a far costlier signal of good faith than answering an
SMS, and putting an OTP in front of it would tax the tier we would rather people
used.

## Consequences

- **An SMS outage stops Cash on Delivery orders.** OTP sits in the critical path
  of placing an order, so the provider becomes a launch dependency in a way the
  prerequisites list did not assume. Unmasked SMS remains a working fallback,
  a second provider is worth having configured, and staff must be able to place
  an order without an OTP for the customer who phones in.
- Sending is rate limited per phone number and per session before launch, not
  after. Without it, the endpoint spends our money and delivers our messages to
  a stranger's handset on demand.
- The phone number becomes the customer key: deduplication, order history and the
  refuser blocklist all hang off it, and it is stored with the timestamp of the
  verification that earned it.
- A number that already has a delivered order is not re-verified on later Cash on
  Delivery orders. It removes the friction for exactly the customers who have
  proven they are real, and removes the SMS cost with it.
- The blocklist is a policy instrument, so it needs a written rule for how many
  RTOs put a number on it and how a number comes off. Undocumented, it becomes
  one person's judgement and turns away paying customers.
