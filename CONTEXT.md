# Butterloom

Direct-to-consumer South Asian ethnic fashion retail, selling online to customers
in Bangladesh only. This document is a glossary: it fixes the language we use to
talk about the business, not how anything is built.

## Language

### Payment

**Payment Tier**:
One of the distinct routes by which a customer can pay Butterloom. Tiers differ
in who must approve them before use, what they cost us, and how quickly money
reaches our bank.
_Avoid_: payment method, payment gateway (a gateway is one implementation of a tier)

**Merchant Approval**:
A commercial gateway or aggregator agreement a provider must grant Butterloom
before we may accept money through its integration. It is granted or withheld by
the provider, cannot be engineered around, and is distinct from the lighter Merchant Account approval required for Manual bKash.
_Avoid_: integration approval, API access

**Manual bKash**:
The Payment Tier in which a customer sends money to a Butterloom bKash number of
their own accord and submits the resulting TrxID at checkout, which staff later
verify against the bKash statement. Requires no Merchant Approval.
_Avoid_: offline bKash, personal bKash, send-money

**TrxID**:
The transaction identifier bKash issues to a customer on a completed send-money,
supplied by the customer as their claim of payment. A claim, not a proof, until
verified.
_Avoid_: transaction ID, reference number, payment ID

### Order lifecycle

**Fulfilment State**:
Where an order's goods are, independent of its money. Advances from placement
through packing and handover to the courier, ending delivered or returned.
_Avoid_: order status, shipping status

**Settlement State**:
Where an order's money is, independent of its goods. Advances from owed through
claimed and verified to collected and remitted, or ends written off.
_Avoid_: payment status, order status

**Collected**:
The Settlement State in which the customer has paid but the money is still held
by a third party — typically cash taken at the door by the courier. Operational
signal only; not revenue.

**Remitted**:
The Settlement State in which money has reached a Butterloom bank account, net of
whatever fees the collecting party deducted. **Revenue is recognised here and
nowhere else.**
_Avoid_: paid, settled, received

**RTO**:
An order the customer refused or could not be handed at the door, returned to
Butterloom. Fulfilment State returned, Settlement State written off, and the
return freight is a cost we bear.
_Avoid_: return, failed delivery, cancellation (a cancellation happens before dispatch)

### Fulfilment

**Consignment**:
A parcel handed to the courier for delivery, identified by the courier's own
tracking number. One Order becomes one Consignment; the two are distinct because
a Consignment can be returned, lost or re-attempted without the Order changing.
_Avoid_: shipment, parcel, delivery

**Dispatch Batch**:
The set of orders released to the courier together in a single daily run. The
unit in which Butterloom hands over goods, and the unit a courier upload
succeeds or fails as.
_Avoid_: shipment batch, daily orders

**Reservation**:
Stock held against an unpaid or unverified order so it cannot be sold twice,
expiring automatically if payment is never verified.
_Avoid_: hold, allocation, lock

### Payment (continued)

**Merchant Account**:
A bKash account authorised to receive business payments, identified by a till
number. Distinct from and much lighter than the Merchant Approval required for a
payment gateway, but still granted by bKash rather than assumed. Manual bKash
depends on one.
_Avoid_: merchant number, business account, till
