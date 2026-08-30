# Butterloom

Butterloom is an online-first ethnic clothing brand selling to customers in and
around Dhaka, Bangladesh.

## Language

**Order**:
A customer's committed request for specific items at agreed prices, placed
through the storefront. An Order exists only once Butterloom has received it —
a cart held in a customer's browser is not an Order.
_Avoid_: purchase, transaction, sale

**Cash on Delivery (COD)**:
Settlement where the Courier collects the order total in cash from the customer
at handover and remits it to Butterloom afterwards. Butterloom's primary means
of being paid.
_Avoid_: cash payment, pay-on-delivery

**Mobile Financial Service (MFS)**:
The category of phone-number-based payment accounts used in Bangladesh, of which
bKash is the one Butterloom will support first. Use "MFS" for the category and
name the specific provider only when the distinction matters.
_Avoid_: mobile wallet, mobile banking, e-wallet

**Courier**:
The third party that carries an Order to the customer and, under COD, collects
the cash on Butterloom's behalf. Distinct from Butterloom's own fulfilment work
of picking and packing.
_Avoid_: delivery partner, shipper, logistics provider

**Delivery Area**:
The smallest destination the Courier routes to, identified by a city / zone /
area triple drawn from the Courier's own hierarchy rather than by a street
address or postcode. A customer's typed address is not a Delivery Area until it
has been mapped onto that triple.
_Avoid_: postcode, zip, region, location

**Consignment**:
The Courier's identifier for a parcel once an Order has been handed over to
them. One Order becomes one Consignment; the two are tracked separately because
an Order can exist long before, and outlive, its Consignment.
_Avoid_: tracking number, shipment, parcel ID

**Amount to Collect**:
The cash the Courier must take from the customer at handover. Equal to the Order
total when nothing has been prepaid, and zero for an Order already settled by
MFS or card.
_Avoid_: COD amount, balance due, outstanding

**Settlement**:
The Courier's periodic transfer to Butterloom of collected COD cash, net of
delivery and COD fees. Reconciling Settlements against Orders is a manual task —
the Courier exposes no API for it.
_Avoid_: payout, remittance, disbursement
