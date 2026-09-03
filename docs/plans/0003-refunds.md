# Refunds, and the Settlement State they need

Settles the mechanism half of **open decision #4**. The policy half — what Butterloom will
actually refund, and when — is a business decision this plan cannot make, and §5 says what
it needs.

Build after `0001-reservation.md`. A refund has to know what an order consumed before it
can decide what goes back on the shelf.

## Refunds cannot be built first, because there is nothing to refund from

CONTEXT.md defines **Settlement State** as a first-class idea: where an order's money is,
independent of its goods, advancing from owed through claimed and verified to collected and
remitted, or ending written off. The word does not appear anywhere in `src`. Orders carry
`fulfilment_state` and a `payment_tier` column that is always `'cod'`.

So today "delivered" and "paid" are the same event, which is exactly the collapse that
hides the gap where COD money goes missing: under COD the customer has the goods days or
weeks before the courier remits the cash, and the reconciliation is manual. A refund system
built on top of that has nothing to reverse — it would be a button that emits a note.

**Settlement State comes first, in the same plan, because refunds are a transition within
it and not a feature beside it.**

## Part 1 — Settlement State

```
orders.settlement_state  'owed' | 'claimed' | 'verified' | 'collected' | 'remitted' | 'written_off'
orders.settled_at        integer null
settlement_events        id, order_id, from_state, to_state, note, actor, created_at
```

`settlement_events` mirrors the existing `order_events` table exactly — same shape, same
append-only discipline, separate table because the two clocks are independent and a single
audit trail interleaving them reads as neither.

**The two paths through it:**

| Tier | Path |
|---|---|
| **COD** | `owed` at placement → `collected` when the courier takes cash at the door → `remitted` when the money reaches the bank, net of the courier's fee. RTO ends at `written_off`. |
| **Manual bKash** *(tier not built)* | `owed` → `claimed` when the customer submits a TrxID → `verified` when staff match it against the bKash statement → `collected` (the money is already ours at verification) → `remitted`. |

Two things to hold onto, both from CONTEXT.md and both easy to lose in implementation:

- **Collected is not revenue.** It means the customer paid and a third party is holding the
  money. **Remitted** is a cash-settlement event, not a revenue-recognition event either —
  sales are recognised when goods are delivered.
- **Remitted is net of fees.** The courier deducts before remitting, so a remittance carries
  two integers: what arrived and what was deducted. Recording only what arrived makes the
  order look short-paid forever. Integer paisa throughout (ADR-0006).

**Fulfilment and settlement move independently and must not be wired to each other.** The
one place they touch is RTO: an order that comes back is `returned` on the goods side and
`written_off` on the money side, and even there the write-off is an action an operator takes,
not a trigger the state machine fires.

## Part 2 — Refunds

```
refunds
  id                integer primary key
  order_id          → orders.id
  amount_paisa      integer        what the customer gets back
  fee_paisa         integer        the transfer charge Butterloom absorbs
  channel           text           'bkash' — the channel the money originally came in by
  reason            text
  state             'due' | 'sent' | 'failed'
  due_at            integer        when the clock runs out (§4)
  reference         text null      the TrxID of the outgoing send-money
  actor             text           who sent it
  created_at, sent_at
refund_events       id, refund_id, from_state, to_state, note, actor, created_at
```

**A refund is a manual bKash send-money back, with Butterloom absorbing the transfer fee**
— that is the mechanism open decision #4 already recorded, and this plan does not reopen
it. What it adds is that the fee is *recorded* rather than merely absorbed: `fee_paisa` is a
cost line, and a refund process whose cost is invisible is one nobody can price.

**Refunds apply to money we actually received.** Under COD an undelivered order is a
write-off, not a refund — the customer never paid, and the loss is the return freight.
Refunds are therefore a Manual bKash concern first, plus the one COD case that does arise:
a delivered, collected order returned afterwards under the returns policy. That case is
what §5 has to answer.

## Part 3 — The audited screen

Open decision #4 asks for an audited screen and this is the whole of it:

- **Every action writes an event** — created, sent, failed, amended. `refund_events` is
  append-only and nothing in the refund path is ever hard-deleted, because six-year
  retention applies to payment records (`docs/COMPLIANCE.md`).
- **Two steps to send.** The screen shows the order, the amount, the channel and the
  destination number, and the operator confirms against what is in front of them. This is a
  manual send-money to a phone number typed by a customer; a one-click refund is a one-click
  mistake.
- **The outgoing TrxID is required to mark it sent.** No reference, no `sent` state. It is
  the only evidence the refund happened.
- **Nothing here is automated.** ADR-0003 gives the system one operator and no job queue,
  and money leaving the business on a timer is not the place to make an exception.
- Lives at `/admin/refunds` with a queue ordered by `due_at`, overdue first — the same board
  pattern `src/admin/orders.tsx` already uses.

## Part 4 — The clocks, from `docs/COMPLIANCE.md`

- **10 days** to refund after a delivery failure, **through the same channel the customer
  paid by**. `due_at` is set from the delivery-failure event, and the queue sorts by it.
- **Seller bears the transaction charges** — which is why `fee_paisa` exists and why the
  customer's `amount_paisa` is never reduced by it.
- **Force majeure: notify in 48 hours, refund in 72.** A shorter clock on the same field;
  it does not need its own state, only a different `due_at`.
- The refund policy shown to customers must be **in Bengali** (`0002-compliance.md` §3), and
  `/returns` cannot be written until §5 below is answered.

## Part 5 — What this plan needs from the business

The policy, which is not an engineering artefact and is the reason open decision #4 has
stayed open:

1. **What is refundable, and for how long after delivery?** Change of mind, or fault only?
2. **Does a delivered-and-collected COD order get cash back**, and by what channel — bKash
   to the number that placed the order?
3. **Who bears return freight** on a customer-initiated return, as distinct from an RTO?
4. **What happens to the goods** — this is the same question `0001-reservation.md` leaves
   open about whether a returned garment goes back on the shelf, and it should get one
   answer, not two.

## What changes, file by file

| File | Change |
|---|---|
| `src/db/schema.ts` | `settlement_state` + `settled_at` on `orders`; `settlement_events`, `refunds`, `refund_events` |
| `drizzle/00NN_settlement.sql`, `00NN_refunds.sql` | Two migrations, both additive. `settlement_state` arrives defaulted to `'owed'`, which is true of every existing order |
| `src/lib/settlement.ts` *(new)* | The permitted transitions, in one place, as data — not scattered across route handlers |
| `src/admin/orders.tsx` | Settlement shown beside fulfilment on the board and in the order dialog; the transitions an operator drives |
| `src/admin/refunds.tsx` *(new)* | The queue and the two-step send |
| `src/storefront/checkout.tsx` | Placement writes `settlement_state: 'owed'` and its first settlement event |

## Done when

- Every existing order reads `owed` after the migration, with no event invented for a
  transition that never happened.
- Fulfilment and settlement can be advanced independently, and an order can be `delivered`
  and still `owed` — which is the normal COD state and the thing today's model cannot say.
- A remittance records what arrived and what was deducted, and the two sum to what was
  collected.
- A refund cannot reach `sent` without a reference, and a refund that failed can be retried
  without losing the first attempt.
- Nothing in the refund or settlement path can be deleted through the admin.
- `npm run check` and `npm test` pass.

## Deliberately not in this plan

The Manual bKash tier itself — TrxID capture at checkout and the staff verification screen
— which is the natural next plan and the thing that makes `claimed` and `verified` reachable.
Reporting on any of this (open decision #1). Automated remittance reconciliation against a
courier statement, which wants a real statement to read before anybody designs a parser for
it.
