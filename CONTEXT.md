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
whatever fees the collecting party deducted. A cash-settlement event, not a
revenue-recognition event; sales are recognised when goods are delivered, subject
to the applicable accounting policy. Remittances and fees are tracked separately.
_Avoid_: paid, settled, received

**RTO**:
An order the customer refused or could not be handed at the door, returned to
Butterloom. Fulfilment State returned; COD settlement is written off, while prepaid
settlement follows the refund policy. The return freight is a cost we bear.
_Avoid_: return, failed delivery, cancellation (a cancellation happens before dispatch)

**Cart**:
The set of items a visitor intends to buy, before an Order exists. An item is a
Variant and a quantity, not a Product — a cart holds the medium in indigo. It
holds no stock; availability is resolved at placement, not when an item is
added.
_Avoid_: basket, bag

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
Stock held on a specific Variant against an unverified Manual bKash order so it
cannot be sold twice, expiring automatically if payment is not verified within
the configured window.
_Avoid_: hold, allocation, lock

### Payment (continued)

**Merchant Account**:
A bKash account authorised to receive business payments, identified by a till
number. Distinct from and much lighter than the Merchant Approval required for a
payment gateway, but still granted by bKash rather than assumed. Manual bKash
depends on one.
_Avoid_: merchant number, business account, till

### Catalogue

**Product**:
The garment as it is described, photographed and priced — one title, one
description, one price, one page. It is what a customer browses; what they
actually buy is always a Variant of it.
_Avoid_: SKU, style, line

**Category**:
A shelf on the storefront — Sarees, Kurtas. It has its own page, its own place
in the order of the front-page tiles, and a name an operator can change without
changing the address of that page. A Product sits on one shelf, or on none while
it is being set up; deleting a shelf unshelves what stood on it rather than
deleting it.
_Avoid_: collection (the front page calls the whole catalogue that), tag, department

**Variant**:
One buyable configuration of a Product — the medium in indigo, the large in ecru.
It is where stock is counted, what a Cart line holds and what a Reservation is
taken against. A Product carries as many Variants as it has configurations, and
one that comes in a single configuration carries exactly one.
_Avoid_: SKU (we hold no stock-keeping unit), option, size, product

**Variant Option**:
One axis of one Variant and the value it takes on that axis — Colour: Indigo,
Size: M. Names and values are whatever the operator types; there is no fixed list
of permitted axes, so a new one costs nothing to start using.
_Avoid_: attribute, property, spec, variation

**Facet**:
An axis a customer can filter a listing by, together with the values that exist
somewhere in the part of the catalogue being listed. Scope, not selection: the
values do not narrow as filters are applied, and none of them carries a count.
_Avoid_: filter (a filter is what a customer picks from a facet), refinement

**Search**:
A scope over the catalogue formed from words a customer typed, which Facets then
refine within — the same shape as a Category, not a mode of its own. A Product
matches when every word appears somewhere in its title or its description; it
reads nothing else, and it says nothing about stock. The scope has its own
address, so a search a customer narrows by colour is still one page they can
send to somebody.
_Avoid_: query, keyword search, filter (a filter narrows a search, it is not one)

**Recently Viewed**: The last few Products whose pages a visitor has opened, held
in that visitor's own browser and never on the server. Products, not Variants —
a visitor opens a page, not a configuration.
_Avoid_: browsing history, view history
