# Expire a Manual bKash Reservation after 90 minutes, and expire stock only

A Reservation exists so an unverified Manual bKash order cannot sell the same
piece twice, and the window has to cover the slow path a genuine customer
actually takes: opening bKash, finding no balance, walking to an agent to cash
in, and coming back to submit the TrxID. That is routinely more than an hour, so
the window is 90 minutes rather than the 60 the range also allowed. The cost of
the longer window is small in a catalogue where stock is frequently one and
volume is roughly 30 orders a day — it is the chance that a second customer
wanted that exact piece inside that exact hour and a half — and the cost of the
shorter one is stranding paying customers mid-payment, which is worse and
invisible.

The expiry releases the Reservation. It does not cancel the order and does not
reject a late TrxID. A customer who sends money at minute 100 has sent real
money, and destroying their claim because a timer fired would manufacture a
refund out of a stock decision. Expiry is about stock; verification is about
money; the two axes stay independent, as everywhere else in this model.

## Consequences

- An expiry sweep runs as a scheduled task (ADR-0003, ADR-0005). It must be
  idempotent and must release stock only while the Settlement State is still
  unverified, so that a sweep racing a staff verification cannot release stock
  from under an order that was just confirmed.
- An expired order whose TrxID is later verified is fulfilled if the stock is
  still available and handled as an out-of-stock refund if it is not. That refund
  path is the one described in the still-open refund decision, which now has a
  second caller.
- Checkout states the deadline plainly and the customer is told when the hold
  lapses. Silent expiry produces a support conversation for every occurrence,
  which at one operator is the expensive outcome.
- Staff can release a Reservation early from the verification screen. A manual
  override is cheaper than getting the number exactly right and makes an obvious
  abandonment recoverable in seconds.
- 90 minutes is a configured value, not a constant in the code. It is expected to
  move once there is evidence of how long real customers take.
