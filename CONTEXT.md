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
A commercial agreement a payment provider must grant Butterloom before we may
accept money through them. It is granted or withheld by the provider, cannot be
engineered around, and is unrelated to whether we wrote the integration code.
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
