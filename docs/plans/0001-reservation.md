# Reservation, with a 90-minute window

**First, before everything else.** Every other plan in this directory assumes the stock
model this one builds.

This settles **open decision #2** at the recommendation that was on the table: a
Reservation expires **90 minutes** after it is taken, configurable, so the number can move
without a code change.

## What exists today, and what is actually missing

Placement already resolves stock. `src/storefront/checkout.tsx` opens a `db.transaction()`,
re-reads each cart line's variant, refuses the order if any line is short, decrements
`productVariants.stockQty`, and writes the order, its item snapshot and its first
`orderEvents` row — all or nothing. `src/storefront/cart.tsx:252` adds a courtesy check at
the add-to-cart button and says in its own comment that it is *not* a reservation, because
two shoppers can both pass it on the last piece and checkout's transaction is what decides.

That is correct as far as it goes, and it is not Reservation. What is missing is the
**hold with a clock**: stock held on a specific Variant against an order whose payment has
not been verified, released automatically if the window passes (CONTEXT.md).

**One sequencing fact to be clear about.** CONTEXT.md defines Reservation against an
*unverified Manual bKash order*, and Manual bKash is not built — `checkout.tsx:300`
hardcodes `paymentTier: 'cod'`. Under COD-only checkout nothing will actually sit held for
90 minutes, because a COD order commits its stock the moment it is placed. Building this
first is still right: it is the model the Manual bKash tier, the refund path and the
compliance work all need, and the alternative is building stock accounting twice. But the
timer earns its keep on the day a second Payment Tier lands, not on the day this ships.
The plan therefore wires COD through the new machinery in its degenerate form — reserve
and consume in the same transaction — so the net effect for COD is exactly what it is
today, and adding Manual bKash later is a new branch rather than a re-plumb.

## The model

A `reservations` row is a claim on a quantity of one Variant by one Order, with an expiry.

```
reservations
  id            integer primary key
  order_id      → orders.id            (cascade: an order's holds die with it)
  variant_id    → product_variants.id  (cascade: see "deleting a variant" below)
  quantity      integer
  state         'held' | 'consumed' | 'released'
  expires_at    integer (unix seconds)
  created_at    integer
  settled_at    integer null           when it stopped being held
  release_reason 'expired' | 'cancelled' | 'admin' | null
```

Indexes on `(variant_id, state)`, `(state, expires_at)` and `(order_id)`.

**Availability is derived, never stored:**

```
available(variant) = stock_qty − Σ quantity where state = 'held' and expires_at > now
```

`stock_qty` keeps meaning exactly what it means now: **the physical count an operator can
walk to a shelf and verify.** Holds subtract from availability without touching it, and
consumption is what decrements it.

This is the load-bearing choice in the plan, so the alternative is worth naming: the other
model decrements `stock_qty` at placement and adds it back on release. It is simpler by one
join and it is wrong in the way that costs real money — a release that never runs leaks a
unit of stock permanently, and the failure is silent and cumulative. In the derived model,
a hold whose release never ran simply stops counting the second it expires. Correctness
survives the sweeper failing entirely, which is the property worth paying a join for.

## The window

`BUTTERLOOM_RESERVATION_WINDOW_MINUTES`, default **90**, in `src/config.ts` beside the
other ceilings. 60–90 minutes was the range recorded in open decision #2: shorter strands
honest customers mid-payment, longer lets a fake order lock a catalogue where stock is
frequently one. 90 takes the safe end for the customer, on the reasoning that a Manual
bKash sender may have to leave the house to reach an agent.

## Expiry: lazy first, swept second

**Lazy is the mechanism.** Every availability read filters `expires_at > now`, so a hold
stops counting at its expiry instant whether or not any timer ran. Nothing about
correctness depends on a background task.

**The sweep is bookkeeping.** A scheduled task marks expired holds `released` with reason
`expired`, stamps `settled_at`, and writes an `orderEvents` row so the admin board shows an
order that lost its hold instead of one that silently still looks fine. It runs in-process
on an interval — ADR-0003 rules out a job queue and explicitly allows a scheduled task, and
the image worker in `src/images/queue.ts` is the existing precedent for the shape.

Because it is bookkeeping rather than enforcement, the sweep is free to be idempotent,
skippable and late. Running it twice must do nothing the second time.

## Concurrency

ADR-0006 makes this easy and the plan should not squander it: SQLite has a single writer,
better-sqlite3 is synchronous, and the application is one process (ADR-0003, and §1 of
`docs/DEPLOYMENT.md` — two application containers against one database file is not a
supported configuration). So check-then-insert is atomic **provided the availability read
happens inside the same `db.transaction()` as the insert.** That is the rule to state in
the code, because it is the one a future reader will break by hoisting the read out for
tidiness.

One hardening while in there: today's decrement is a read-modify-write —
`stockQty: item.variant.stockQty - qty`, computed in JavaScript from a value read earlier
in the transaction. It is safe today for the reasons above. Write it as a relative update
guarded by the invariant anyway:

```sql
UPDATE product_variants SET stock_qty = stock_qty - ?
 WHERE id = ? AND stock_qty >= ?
```

Zero rows affected then means "someone got there first" and the transaction rolls back on
a statement rather than on an assumption about the process model. It costs nothing and it
is the line of defence that survives a change to any of the three premises above.

## Order lifecycle

| Transition | What happens to stock |
|---|---|
| Placed, COD | Reserve and consume in one transaction. `stock_qty` drops. Net effect identical to today. |
| Placed, Manual bKash *(not built)* | Reserve, `expires_at = now + 90m`. `stock_qty` untouched. |
| Payment verified *(not built)* | Consume the hold: `stock_qty` drops, state → `consumed`. |
| Window passes without verification | Sweep releases with reason `expired`; availability already recovered at the instant of expiry. |
| Cancelled before dispatch | Release a `held` hold. If already `consumed`, restore `stock_qty` — the goods never left. |
| Returned (RTO) | **No automatic restock.** See below. |

**RTO does not restock automatically, and that is a recommendation rather than a
certainty.** A garment that came back from a failed delivery may be resellable or may not,
and only the operator who opens the parcel knows. Auto-restocking on `returned` puts a
piece back on the storefront that nobody has looked at; not restocking loses a real unit
until someone acts. The recommendation is to leave `returned` alone and give the admin an
explicit "back on the shelf" action, because a wrong count that an operator caused
deliberately is recoverable and a wrong count the system invented is not. **This is the one
open question in this plan** — it needs the operator's answer, not an engineer's.

**Deleting a variant** cascades its reservations away, which means deleting a variant
releases whatever it was holding. That is the correct behaviour for a catalogue where an
operator withdraws a piece, and it is worth a comment at the foreign key so the next reader
knows it was chosen rather than defaulted.

## What changes, file by file

| File | Change |
|---|---|
| `src/db/schema.ts` | The `reservations` table, its indexes, its types |
| `drizzle/00NN_reservations.sql` | Generated by `npm run db:generate`. Purely additive — expand only, no contract phase |
| `src/lib/reservation.ts` *(new)* | `availableQty()`, `reserve()`, `consume()`, `release()`, `sweepExpired()`. Every one of them takes a transaction handle so callers cannot accidentally read outside the transaction they write in |
| `src/storefront/checkout.tsx` | Placement goes through `reserve()` + `consume()` instead of decrementing directly; the decrement becomes the guarded relative update |
| `src/storefront/cart.tsx` | The courtesy check reads `availableQty()` rather than `stockQty`, so the last piece being held stops it being offered. Still a courtesy, still says so |
| `src/admin/orders.tsx` | Cancel releases or restores; the order dialog shows a live hold and its expiry |
| `src/config.ts` | `reservationWindowMinutes` (default 90), `reservationSweepMs` (default 60000) |
| `src/server.tsx` | Start the sweep after migrations, stop it on shutdown |

Nothing on the storefront's cached pages changes. ADR-0007 keeps availability off them
entirely, and this plan does not touch that promise: the only paths that read availability
are `POST /cart` and checkout, both uncached.

## Done when

- Two placements racing the last piece: one succeeds, one is refused, `stock_qty` never
  goes negative.
- A hold stops counting against availability at its expiry instant **with the sweep
  disabled entirely** — this is the property that proves the lazy filter is the mechanism.
- The sweep run twice over the same expired hold produces one release and one order event.
- A COD placement moves `stock_qty` by exactly what it moves today, and leaves a
  `consumed` reservation behind as the record of why.
- Cancelling an order returns its units to availability; cancelling it twice does not
  return them twice.
- `npm run check` and `npm test` pass.

## Deliberately not in this plan

The Manual bKash tier itself, TrxID capture and staff verification; OTP on COD (open
decision #3); Settlement State, which `0003-refunds.md` introduces; RTO write-off, which
needs Settlement State first. This plan builds the shelf, not what goes on it.
