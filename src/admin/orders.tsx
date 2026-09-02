import { and, count, desc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client.js'
import { orderEvents, orderItems, orders, productVariants } from '../db/schema.js'
import type { FulfilmentState, Order, OrderEvent, OrderItem } from '../db/schema.js'
import { formatDateTime } from '../lib/date.js'
import { formatPaisa } from '../lib/money.js'
import {
  formatFulfilmentState,
  formatOrderId,
  getAdvanceActionLabel,
  getNextFulfilmentState,
  isValidStateTransition,
  parseOrderId,
} from '../lib/order.js'
import { AdminLayout } from '../views/layout.js'

export const adminOrders = new Hono()

interface OrderWithDetails {
  order: Order
  items: OrderItem[]
  events: OrderEvent[]
}

function fetchOrdersWithDetails(filterStates: FulfilmentState[]): OrderWithDetails[] {
  const orderList = db
    .select()
    .from(orders)
    .where(inArray(orders.fulfilmentState, filterStates))
    .orderBy(desc(orders.createdAt))
    .all()

  if (orderList.length === 0) return []

  const orderIds = orderList.map((o) => o.id)
  const items = db
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds))
    .all()

  const events = db
    .select()
    .from(orderEvents)
    .where(inArray(orderEvents.orderId, orderIds))
    .orderBy(desc(orderEvents.createdAt))
    .all()

  const itemMap = new Map<number, OrderItem[]>()
  for (const it of items) {
    itemMap.set(it.orderId, [...(itemMap.get(it.orderId) ?? []), it])
  }

  const eventMap = new Map<number, OrderEvent[]>()
  for (const ev of events) {
    eventMap.set(ev.orderId, [...(eventMap.get(ev.orderId) ?? []), ev])
  }

  return orderList.map((order) => ({
    order,
    items: itemMap.get(order.id) ?? [],
    events: eventMap.get(order.id) ?? [],
  }))
}

/**
 * How many orders sit in each state, for the numbers on the filter tabs.
 *
 * Counted over every order rather than over the rows on screen, because that
 * is what the tabs have to say: a tab reading "Packed" wants to tell the
 * operator how many are packed, not how many are packed *and* match the filter
 * already applied — which would be the tab's own number, and always its own
 * number, and so no information at all.
 */
function countsByState(): Map<FulfilmentState, number> {
  return new Map(
    db
      .select({ state: orders.fulfilmentState, n: count() })
      .from(orders)
      .groupBy(orders.fulfilmentState)
      .all()
      .map((r) => [r.state, r.n] as const),
  )
}

/** The two boards, and the states each one holds, in the order they happen. */
const boards = {
  active: ['placed', 'packed', 'handed_over'],
  previous: ['delivered', 'returned', 'cancelled'],
} as const satisfies Record<string, readonly FulfilmentState[]>

type BoardName = keyof typeof boards

/** What each group of the active board says about itself under its heading. */
const stateBlurbs: Record<FulfilmentState, string> = {
  placed: 'New orders awaiting operator confirmation and packing.',
  packed: 'Orders packed and ready for courier handover.',
  handed_over: 'With courier for delivery across Bangladesh.',
  delivered: 'Delivered to the customer.',
  returned: 'Came back from the courier undelivered.',
  cancelled: 'Cancelled before despatch; stock was put back.',
}

/**
 * A link to this board with one status picked, or to the whole board. Built
 * with URLSearchParams rather than concatenated — the same trap that put a
 * `&` where a `?` belonged on the advance redirect and 404'd every hop but
 * one.
 */
function boardHref(board: BoardName, status: FulfilmentState | null): string {
  const params = new URLSearchParams({ tab: board })
  if (status) params.set('status', status)
  return `/admin/orders?${params}`
}

/**
 * The status filter, as tabs across the top of whichever board is open.
 *
 * Real links carrying `?status=`, not a select the page filters in script: an
 * operator who has filtered to "Packed" and then advances one of them is
 * redirected back here, and only a URL can bring the filter back with them. It
 * is also the one thing on this page worth being able to bookmark — "the
 * parcels still to hand over" is a screen somebody stands in front of daily.
 */
function StatusTabs(props: {
  board: BoardName
  selected: FulfilmentState | null
  counts: Map<FulfilmentState, number>
}) {
  const states = boards[props.board]
  const total = states.reduce((n, state) => n + (props.counts.get(state) ?? 0), 0)
  return (
    <nav class="status-tabs" aria-label="Filter by status">
      <a
        class={`status-tab ${props.selected === null ? 'active' : ''}`}
        href={boardHref(props.board, null)}
        aria-current={props.selected === null ? 'true' : undefined}
      >
        All<span class="status-tab-n">{total}</span>
      </a>
      {states.map((state) => (
        <a
          class={`status-tab ${props.selected === state ? 'active' : ''}`}
          href={boardHref(props.board, state)}
          aria-current={props.selected === state ? 'true' : undefined}
        >
          {formatFulfilmentState(state)}
          <span class="status-tab-n">{props.counts.get(state) ?? 0}</span>
        </a>
      ))}
    </nav>
  )
}

adminOrders.get('/', (c) => {
  const tab = c.req.query('tab') === 'previous' ? 'previous' : 'active'
  const notice = c.req.query('notice')
  const error = c.req.query('error')

  // A `?status=` naming a state that is not on this board is dropped rather
  // than obeyed: `?tab=active&status=delivered` would otherwise fetch nothing
  // and read as an empty board. The tab wins, the stray parameter is ignored.
  const boardStates: readonly FulfilmentState[] = boards[tab]
  const requested = c.req.query('status')
  const status = boardStates.find((state) => state === requested) ?? null
  const shownStates = status ? [status] : boardStates
  const counts = countsByState()

  const board = fetchOrdersWithDetails([...shownStates])
  const activeOrders = tab === 'active' ? board : []
  const previousOrders = tab === 'previous' ? board : []

  return c.html(
    <AdminLayout title="Orders" section="orders">
      {error ? <p class="notice error">{error}</p> : null}
      {notice ? <p class="notice">{notice}</p> : null}

      <div class="tabs">
        <a
          href="/admin/orders?tab=active"
          class={`tab ${tab === 'active' ? 'active' : ''}`}
          aria-current={tab === 'active' ? 'true' : undefined}
        >
          Active Orders
        </a>
        <a
          href="/admin/orders?tab=previous"
          class={`tab ${tab === 'previous' ? 'active' : ''}`}
          aria-current={tab === 'previous' ? 'true' : undefined}
        >
          Previous Orders
        </a>
      </div>

      <StatusTabs board={tab} selected={status} counts={counts} />

      {tab === 'active' ? (
        <div>
          {activeOrders.length === 0 ? (
            <p class="muted">
              {status === null
                ? 'No active orders right now.'
                : `Nothing is ${formatFulfilmentState(status).toLowerCase()} right now.`}
            </p>
          ) : (
            <>
              {/*
                An operator searching the active board is nearly always holding
                a phone call or a parcel: a customer's name, or the name of the
                thing in the box. Both are already on the receipt, so this
                filters what is in front of them rather than costing a round
                trip to be told the same thing.
              */}
              <div class="search-bar">
                <label class="label" for="active-search">
                  Find an order
                </label>
                <input
                  id="active-search"
                  type="search"
                  placeholder="Customer or product…"
                  autocomplete="off"
                  oninput="filterActiveOrders()"
                />
              </div>
              <p class="muted" id="active-none" hidden>
                No active order matches that.
              </p>
              {/*
                One loop over the states on this board rather than three copies
                of the same block. When a status tab is picked, `shownStates`
                is that one state and this renders a single group — the heading
                stays, because it carries the count and the line saying what
                the state means.
              */}
              {shownStates.map((state) => {
                const group = activeOrders.filter((o) => o.order.fulfilmentState === state)
                if (group.length === 0) return null
                return (
                  <section class="order-group">
                    <h2>
                      {formatFulfilmentState(state)}{' '}
                      <span class="muted group-count">({group.length})</span>
                    </h2>
                    <p class="muted">{stateBlurbs[state]}</p>
                    <div class="receipts">
                      {group.map((o) => (
                        <Receipt orderDetail={o} />
                      ))}
                    </div>
                  </section>
                )
              })}
              <script dangerouslySetInnerHTML={{ __html: filterActiveOrdersScript }} />
            </>
          )}
        </div>
      ) : (
        <div>
          {/*
            The status select that used to sit beside this box is gone: the
            tabs above do that job now, for both boards and with counts on
            them, and two controls for one filter is one of them being out of
            step with the URL.
          */}
          <div class="search-bar">
            <label class="label" for="prev-search">
              Find an order
            </label>
            <input
              id="prev-search"
              type="search"
              placeholder="ID, customer, phone or product…"
              autocomplete="off"
              oninput="filterPreviousOrders()"
            />
          </div>

          <div class="table-wrap">
            <table id="prev-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {previousOrders.map((o) => {
                  const state = o.order.fulfilmentState
                  // The same four fields the active board searches, collapsed
                  // into one attribute so both tabs answer the same question.
                  const haystack = [
                    formatOrderId(o.order.id),
                    o.order.customerName,
                    o.order.customerPhone,
                    ...o.items.map((item) => `${item.productTitle} ${item.variantLabel}`),
                  ]
                    .join(' ')
                    .toLowerCase()
                  return (
                    <tr data-search={haystack} data-status={state}>
                      <td>
                        <strong>{formatOrderId(o.order.id)}</strong>
                      </td>
                      <td class="muted">{formatDateTime(o.order.createdAt)}</td>
                      <td>{o.order.customerName}</td>
                      <td class="muted">{o.order.customerPhone}</td>
                      <td>{formatPaisa(o.order.totalPaisa)}</td>
                      <td>
                        <span class={`chip ${state}`}>{formatFulfilmentState(state)}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          class="secondary"
                          style="padding: 4px 8px; font-size: 13px;"
                          onclick={`document.getElementById('dialog-${o.order.id}').showModal()`}
                        >
                          View
                        </button>
                        <OrderDialog orderDetail={o} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {previousOrders.length === 0 ? <p class="muted">No previous orders found.</p> : null}
          <p class="muted" id="prev-none" hidden>
            No previous order matches that.
          </p>

          <script
            dangerouslySetInnerHTML={{
              __html: `
                /* Text only. The status half of this went to the tabs above,
                   which filter on the server and so survive a reload and an
                   order being advanced out from under the page. */
                function filterPreviousOrders() {
                  var q = (document.getElementById('prev-search').value || '').toLowerCase().trim();
                  var terms = q ? q.split(/\\s+/) : [];
                  var rows = document.querySelectorAll('#prev-table tbody tr');
                  var shown = 0;
                  for (var i = 0; i < rows.length; i++) {
                    var r = rows[i];
                    var hay = r.getAttribute('data-search') || '';
                    var hit = true;
                    for (var t = 0; t < terms.length; t++) {
                      if (hay.indexOf(terms[t]) === -1) { hit = false; break; }
                    }
                    r.style.display = hit ? '' : 'none';
                    if (hit) shown++;
                  }
                  var none = document.getElementById('prev-none');
                  if (none) none.hidden = shown > 0 || rows.length === 0;
                }
              `,
            }}
          />
        </div>
      )}
    </AdminLayout>,
  )
})

/**
 * Hides the cards that do not match and re-counts each state heading as it
 * goes, because "Placed (7)" over three visible cards is a worse answer than
 * no count at all. A group with nothing left in it goes away entirely rather
 * than sitting there as a heading over a gap.
 */
const filterActiveOrdersScript = `
  function filterActiveOrders() {
    var q = (document.getElementById('active-search').value || '').toLowerCase().trim();
    var terms = q ? q.split(/\\s+/) : [];
    var groups = document.querySelectorAll('.order-group');
    var shown = 0;
    for (var g = 0; g < groups.length; g++) {
      var cards = groups[g].querySelectorAll('.receipt');
      var visible = 0;
      for (var i = 0; i < cards.length; i++) {
        var hay = cards[i].getAttribute('data-search') || '';
        var hit = true;
        for (var t = 0; t < terms.length; t++) {
          if (hay.indexOf(terms[t]) === -1) { hit = false; break; }
        }
        cards[i].style.display = hit ? '' : 'none';
        if (hit) visible++;
      }
      groups[g].style.display = visible > 0 ? '' : 'none';
      var count = groups[g].querySelector('.group-count');
      if (count) count.textContent = '(' + visible + ')';
      shown += visible;
    }
    var none = document.getElementById('active-none');
    if (none) none.hidden = shown > 0;
  }
`

/**
 * The pen. An outline stroke rather than a glyph like ✎, because the glyph is
 * a font's emoji on one platform and a hairline dingbat on the next, and this
 * one has to read as "edit this" at 16px on a phone in a stockroom.
 */
function PenIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

/**
 * One active order, as the receipt that came in the parcel.
 *
 * The point is not decoration. An operator works this board with a stack of
 * real printed receipts in one hand, and a card that reads in the same order
 * as the paper — who, what, how much, total at the foot — is a card they can
 * check against the thing they are holding without translating between two
 * layouts. Hence monospace, hence the amounts in a column on the right, hence
 * the total under a rule.
 *
 * Low fidelity on purpose: the outline and the formatting, no paper texture,
 * no drop shadows, no curled corners. It should look like a receipt at a
 * glance and like an admin panel when you actually read it.
 *
 * Every action lives behind the pen. Four buttons under each of a dozen
 * receipts is a wall of buttons to mis-tap; the pen is one target, and what it
 * opens can afford to spell out what each action will do.
 */
function Receipt(props: { orderDetail: OrderWithDetails }) {
  const { order, items } = props.orderDetail
  const state = order.fulfilmentState

  // Order id, customer, phone and the titles of what is in the parcel — the
  // four things an operator holding a call actually has to search on. The
  // titles are the snapshot on the order item, not a join to the catalogue: a
  // product renamed after despatch must still be findable by what the customer
  // was told they were buying.
  const haystack = [
    formatOrderId(order.id),
    order.customerName,
    order.customerPhone,
    ...items.map((item) => `${item.productTitle} ${item.variantLabel}`),
  ]
    .join(' ')
    .toLowerCase()

  return (
    <article class="receipt" data-search={haystack}>
      <button
        type="button"
        class="receipt-pen"
        aria-label={`Order ${formatOrderId(order.id)}: details and actions`}
        title="Details and actions"
        onclick={`document.getElementById('dialog-${order.id}').showModal()`}
      >
        <PenIcon />
      </button>

      <header class="receipt-head">
        <p class="receipt-shop">Butterloom</p>
        <p class="receipt-no">{formatOrderId(order.id)}</p>
        <p class="receipt-when">{formatDateTime(order.createdAt)}</p>
      </header>

      {/*
        The status, on the receipt. It is the one fact that is not printed on
        the paper version and the one an operator is looking for when they scan
        the board, so it sits on its own line under the header rather than
        being tucked beside the order number.
      */}
      <p class="receipt-status">
        <span class="receipt-k">Status</span>
        <span class={`chip ${state}`}>{formatFulfilmentState(state)}</span>
      </p>

      <div class="receipt-who">
        <p class="receipt-name">{order.customerName}</p>
        <p>{order.customerPhone}</p>
        <p class="receipt-addr">{order.deliveryAddress}</p>
        {order.deliveryNotes ? <p class="receipt-note">↳ {order.deliveryNotes}</p> : null}
      </div>

      <ul class="receipt-lines">
        {items.map((item) => (
          <li>
            <span class="receipt-qty">{item.quantity}×</span>
            <span class="receipt-what">
              {item.productTitle}
              {item.variantLabel && item.variantLabel !== 'Standard' ? (
                <span class="receipt-variant"> {item.variantLabel}</span>
              ) : null}
            </span>
            <span class="receipt-amt">{formatPaisa(item.pricePaisa * item.quantity)}</span>
          </li>
        ))}
      </ul>

      <p class="receipt-total">
        <span>Total</span>
        <span class="receipt-amt">{formatPaisa(order.totalPaisa)}</span>
      </p>
      <p class="receipt-pay">Cash on delivery</p>

      <OrderDialog orderDetail={props.orderDetail} />
    </article>
  )
}

/**
 * What the pen opens: everything about one order, and everything that can be
 * done to it.
 *
 * This absorbed the old "History & Details" button. That button and the row of
 * action buttons beside it were two ways into the same order sitting on the
 * same card, and the details were the half an operator needed *before*
 * deciding which action to press — so they are now one dialog, details first,
 * actions at the foot where a decision belongs.
 *
 * The previous-orders table opens this same dialog from its View button. A
 * settled order has no legal transition left, so the actions section renders
 * empty there and says so, rather than being a second component to keep in
 * step with this one.
 */
function OrderDialog(props: { orderDetail: OrderWithDetails }) {
  const { order, items, events } = props.orderDetail
  const dialogId = `dialog-${order.id}`
  const state = order.fulfilmentState
  const advanceLabel = getAdvanceActionLabel(state)
  const canCancel = isValidStateTransition(state, 'cancelled')
  const canReturn = isValidStateTransition(state, 'returned')
  const hasActions = advanceLabel !== null || canCancel || canReturn

  return (
    <dialog id={dialogId} class="order-dialog">
      {/*
        The close control sits in the title row rather than floated above it.
        Floated, it took a line of its own out of the flow and left a blank
        band across the top of every dialog.
      */}
      <div class="dialog-top">
        <div>
          <h2 class="dialog-title">
            Order {formatOrderId(order.id)}
            <span class={`chip ${state}`}>{formatFulfilmentState(state)}</span>
          </h2>
          <p class="muted">
            Placed {formatDateTime(order.createdAt)} · {order.paymentTier.toUpperCase()}
          </p>
        </div>
        {/* method="dialog" closes it with no script at all, which the previous
            close button needed — and Escape and the backdrop still work. */}
        <form method="dialog" class="dialog-dismiss">
          <button type="submit" class="dialog-close" aria-label="Close">
            ×
          </button>
        </form>
      </div>

      {/*
        Actions immediately under the title, because doing one of them is what
        the pen was pressed for. The details below are the context for choosing
        between them, and are read on the way past rather than scrolled back to.
      */}
      <section>
        <h3>Change status</h3>
        {hasActions ? (
          <div class="order-actions">
            {advanceLabel ? (
              <form method="post" action={`/admin/orders/${order.id}/advance`}>
                <button type="submit">{advanceLabel}</button>
              </form>
            ) : null}

            {canCancel ? (
              <form method="post" action={`/admin/orders/${order.id}/cancel`}>
                <button
                  type="submit"
                  class="danger"
                  onclick="return confirm('Cancel this order and put the stock back?')"
                >
                  Cancel order
                </button>
              </form>
            ) : null}

            {canReturn ? (
              <form method="post" action={`/admin/orders/${order.id}/return`}>
                <button
                  type="submit"
                  class="danger"
                  onclick="return confirm('Mark this order returned (RTO) and put the stock back?')"
                >
                  Mark returned (RTO)
                </button>
              </form>
            ) : null}
          </div>
        ) : (
          // A settled order. Saying so beats an empty heading, and beats
          // hiding the section so the operator wonders where it went.
          <p class="muted">
            {formatFulfilmentState(state)} is where this order ends. Nothing further to set.
          </p>
        )}
      </section>

      <section>
        <h3>Customer</h3>
        <p class="dialog-name">{order.customerName}</p>
        <p>{order.customerPhone}</p>
        <p class="dialog-addr">{order.deliveryAddress}</p>
        {order.deliveryNotes ? <p class="muted">Instructions: {order.deliveryNotes}</p> : null}
      </section>

      <section>
        <h3>Items</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Variant</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr>
                  <td>{it.productTitle}</td>
                  <td class="muted">{it.variantLabel || '—'}</td>
                  <td>{it.quantity}</td>
                  <td>{formatPaisa(it.pricePaisa)}</td>
                  <td>{formatPaisa(it.pricePaisa * it.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p class="dialog-total">Total: {formatPaisa(order.totalPaisa)}</p>
      </section>

      <section>
        <h3>Fulfilment history</h3>
        <ul class="timeline">
          {events.map((ev) => (
            <li>
              <strong>{formatFulfilmentState(ev.toState)}</strong>
              {ev.fromState ? (
                <span class="muted"> (from {formatFulfilmentState(ev.fromState)})</span>
              ) : null}
              <div class="muted">{formatDateTime(ev.createdAt)}</div>
            </li>
          ))}
        </ul>
      </section>
    </dialog>
  )
}

adminOrders.post('/:id/advance', (c) => {
  const id = parseOrderId(c.req.param('id'))
  if (!id) return c.notFound()

  const [order] = db.select().from(orders).where(eq(orders.id, id)).all()
  if (!order) return c.notFound()

  const nextState = getNextFulfilmentState(order.fulfilmentState)
  if (!nextState || !isValidStateTransition(order.fulfilmentState, nextState)) {
    return c.redirect(
      `/admin/orders?error=${encodeURIComponent(`Cannot advance order from ${order.fulfilmentState}`)}`,
      303,
    )
  }

  db.transaction((tx) => {
    tx.update(orders)
      .set({ fulfilmentState: nextState })
      .where(eq(orders.id, id))
      .run()

    tx.insert(orderEvents)
      .values({
        orderId: id,
        fromState: order.fulfilmentState,
        toState: nextState,
      })
      .run()
  })

  // Built as params rather than spliced together, because the tab is only
  // present on the delivered hop: concatenating a conditional `?tab=…` with a
  // fixed `&notice=…` produced `/admin/orders&notice=…` on every other hop —
  // a path, not a query, and so a 404.
  const params = new URLSearchParams()
  // Delivered leaves the active board, so the operator is sent to the tab the
  // order just landed on rather than to the one it disappeared from.
  if (nextState === 'delivered') params.set('tab', 'previous')
  params.set('notice', `Order ${formatOrderId(id)} advanced to ${formatFulfilmentState(nextState)}`)
  return c.redirect(`/admin/orders?${params}`, 303)
})

adminOrders.post('/:id/cancel', (c) => {
  const id = parseOrderId(c.req.param('id'))
  if (!id) return c.notFound()

  const [order] = db.select().from(orders).where(eq(orders.id, id)).all()
  if (!order) return c.notFound()

  if (!isValidStateTransition(order.fulfilmentState, 'cancelled')) {
    return c.redirect(
      `/admin/orders?error=${encodeURIComponent(`Cannot cancel order in ${order.fulfilmentState} state`)}`,
      303,
    )
  }

  db.transaction((tx) => {
    // Restock items
    const items = tx.select().from(orderItems).where(eq(orderItems.orderId, id)).all()
    for (const it of items) {
      if (it.productId) {
        // The order line records the label rather than the variant id, so that
        // an order still reads correctly after the variant is renamed or
        // deleted. Restocking has to find its way back from that label, and
        // simply does nothing when the variant is gone — there is no longer a
        // shelf to put the goods back on, and inventing one would put stock
        // against a configuration the shop no longer sells.
        const [variant] = tx
          .select()
          .from(productVariants)
          .where(
            and(
              eq(productVariants.productId, it.productId),
              eq(productVariants.label, it.variantLabel),
            ),
          )
          .all()
        if (variant) {
          tx.update(productVariants)
            .set({ stockQty: variant.stockQty + it.quantity })
            .where(eq(productVariants.id, variant.id))
            .run()
        }
      }
    }

    tx.update(orders)
      .set({ fulfilmentState: 'cancelled' })
      .where(eq(orders.id, id))
      .run()

    tx.insert(orderEvents)
      .values({
        orderId: id,
        fromState: order.fulfilmentState,
        toState: 'cancelled',
      })
      .run()
  })

  return c.redirect(
    `/admin/orders?notice=${encodeURIComponent(`Order ${formatOrderId(id)} cancelled and stock restocked`)}`,
    303,
  )
})

adminOrders.post('/:id/return', (c) => {
  const id = parseOrderId(c.req.param('id'))
  if (!id) return c.notFound()

  const [order] = db.select().from(orders).where(eq(orders.id, id)).all()
  if (!order) return c.notFound()

  if (!isValidStateTransition(order.fulfilmentState, 'returned')) {
    return c.redirect(
      `/admin/orders?error=${encodeURIComponent(`Cannot mark order as returned from ${order.fulfilmentState} state`)}`,
      303,
    )
  }

  db.transaction((tx) => {
    // Restock items
    const items = tx.select().from(orderItems).where(eq(orderItems.orderId, id)).all()
    for (const it of items) {
      if (it.productId) {
        // Same find-by-label as the return path above, and the same silence
        // when the variant has since gone.
        const [variant] = tx
          .select()
          .from(productVariants)
          .where(
            and(
              eq(productVariants.productId, it.productId),
              eq(productVariants.label, it.variantLabel),
            ),
          )
          .all()
        if (variant) {
          tx.update(productVariants)
            .set({ stockQty: variant.stockQty + it.quantity })
            .where(eq(productVariants.id, variant.id))
            .run()
        }
      }
    }

    tx.update(orders)
      .set({ fulfilmentState: 'returned' })
      .where(eq(orders.id, id))
      .run()

    tx.insert(orderEvents)
      .values({
        orderId: id,
        fromState: order.fulfilmentState,
        toState: 'returned',
      })
      .run()
  })

  return c.redirect(
    `/admin/orders?tab=previous&notice=${encodeURIComponent(`Order ${formatOrderId(id)} marked as returned (RTO) and restocked`)}`,
    303,
  )
})
