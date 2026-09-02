import { and, desc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client.js'
import { orderEvents, orderItems, orders, productVariants } from '../db/schema.js'
import type { FulfilmentState, Order, OrderEvent, OrderItem } from '../db/schema.js'
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

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

adminOrders.get('/', (c) => {
  const tab = c.req.query('tab') === 'previous' ? 'previous' : 'active'
  const notice = c.req.query('notice')
  const error = c.req.query('error')

  const activeStates: FulfilmentState[] = ['placed', 'packed', 'handed_over']
  const previousStates: FulfilmentState[] = ['delivered', 'returned', 'cancelled']

  const activeOrders = tab === 'active' ? fetchOrdersWithDetails(activeStates) : []
  const previousOrders = tab === 'previous' ? fetchOrdersWithDetails(previousStates) : []

  // Count active vs previous
  const placedList = activeOrders.filter((o) => o.order.fulfilmentState === 'placed')
  const packedList = activeOrders.filter((o) => o.order.fulfilmentState === 'packed')
  const handedOverList = activeOrders.filter((o) => o.order.fulfilmentState === 'handed_over')

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

      {tab === 'active' ? (
        <div>
          {activeOrders.length === 0 ? (
            <p class="muted">No active orders right now.</p>
          ) : (
            <>
              {/*
                An operator searching the active board is nearly always holding
                a phone call or a parcel: a customer's name, or the name of the
                thing in the box. Both are already on the card, so this filters
                what is in front of them rather than costing a round trip to be
                told the same thing.
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
              {placedList.length > 0 ? (
                <section class="order-group" style="margin-bottom: 32px;">
                  <h2>
                    Placed <span class="muted group-count">({placedList.length})</span>
                  </h2>
                  <p class="muted">New orders awaiting operator confirmation and packing.</p>
                  {placedList.map((o) => (
                    <ActiveOrderCard orderDetail={o} />
                  ))}
                </section>
              ) : null}

              {packedList.length > 0 ? (
                <section class="order-group" style="margin-bottom: 32px;">
                  <h2>
                    Packed <span class="muted group-count">({packedList.length})</span>
                  </h2>
                  <p class="muted">Orders packed and ready for courier handover.</p>
                  {packedList.map((o) => (
                    <ActiveOrderCard orderDetail={o} />
                  ))}
                </section>
              ) : null}

              {handedOverList.length > 0 ? (
                <section class="order-group" style="margin-bottom: 32px;">
                  <h2>
                    Handed Over <span class="muted group-count">({handedOverList.length})</span>
                  </h2>
                  <p class="muted">With courier for delivery across Bangladesh.</p>
                  {handedOverList.map((o) => (
                    <ActiveOrderCard orderDetail={o} />
                  ))}
                </section>
              ) : null}
              <script dangerouslySetInnerHTML={{ __html: filterActiveOrdersScript }} />
            </>
          )}
        </div>
      ) : (
        <div>
          <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; align-items: center;">
            <input
              id="prev-search"
              type="search"
              placeholder="ID, customer, phone or product…"
              style="max-width: 20rem;"
              oninput="filterPreviousOrders()"
            />
            <select id="prev-status-filter" style="max-width: 12rem;" onchange="filterPreviousOrders()">
              <option value="">All statuses</option>
              <option value="delivered">Delivered</option>
              <option value="returned">Returned (RTO)</option>
              <option value="cancelled">Cancelled</option>
            </select>
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
                      <td class="muted">{formatDate(o.order.createdAt)}</td>
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
                function filterPreviousOrders() {
                  var q = (document.getElementById('prev-search').value || '').toLowerCase().trim();
                  var terms = q ? q.split(/\\s+/) : [];
                  var st = document.getElementById('prev-status-filter').value;
                  var rows = document.querySelectorAll('#prev-table tbody tr');
                  var shown = 0;
                  for (var i = 0; i < rows.length; i++) {
                    var r = rows[i];
                    var hay = r.getAttribute('data-search') || '';
                    var matchText = true;
                    for (var t = 0; t < terms.length; t++) {
                      if (hay.indexOf(terms[t]) === -1) { matchText = false; break; }
                    }
                    var matchStatus = !st || (r.getAttribute('data-status') || '') === st;
                    var hit = matchText && matchStatus;
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
      var cards = groups[g].querySelectorAll('.order-card');
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

function ActiveOrderCard(props: { orderDetail: OrderWithDetails }) {
  const { order, items } = props.orderDetail
  const state = order.fulfilmentState
  const advanceLabel = getAdvanceActionLabel(state)

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
    <div class="order-card" data-search={haystack}>
      <div class="order-header">
        <div>
          <strong style="font-size: 17px;">{formatOrderId(order.id)}</strong>
          <span class={`chip ${state}`} style="margin-left: 8px;">
            {formatFulfilmentState(state)}
          </span>
        </div>
        <span class="order-meta">{formatDate(order.createdAt)}</span>
      </div>

      <div class="order-details">
        <p style="margin: 0 0 4px;">
          <strong>{order.customerName}</strong> · {order.customerPhone}
        </p>
        <p style="margin: 0 0 4px;" class="muted">
          {order.deliveryAddress}
        </p>
        {order.deliveryNotes ? (
          <p style="margin: 4px 0 0; font-size: 13px;" class="muted">
            <em>Notes: {order.deliveryNotes}</em>
          </p>
        ) : null}
      </div>

      <div style="margin: 12px 0; border-top: 1px solid #8882; padding-top: 10px;">
        <ul style="margin: 0; padding-left: 20px; font-size: 14px;">
          {items.map((item) => (
            <li>
              {item.productTitle}
              {item.variantLabel ? ` (${item.variantLabel})` : ''} × {item.quantity} —{' '}
              {formatPaisa(item.pricePaisa * item.quantity)}
            </li>
          ))}
        </ul>
        <p style="margin: 8px 0 0; font-weight: 600; font-size: 15px;">
          Total: {formatPaisa(order.totalPaisa)} <span class="muted">(Cash on Delivery)</span>
        </p>
      </div>

      <div class="order-actions">
        {advanceLabel ? (
          <form method="post" action={`/admin/orders/${order.id}/advance`}>
            <button type="submit">{advanceLabel}</button>
          </form>
        ) : null}

        {state === 'placed' || state === 'packed' ? (
          <form method="post" action={`/admin/orders/${order.id}/cancel`}>
            <button
              type="submit"
              class="danger"
              onclick="return confirm('Cancel this order and restock items?')"
            >
              Cancel Order
            </button>
          </form>
        ) : null}

        {state === 'handed_over' ? (
          <form method="post" action={`/admin/orders/${order.id}/return`}>
            <button
              type="submit"
              class="danger"
              onclick="return confirm('Mark this order as Returned (RTO) and restock items?')"
            >
              Mark Returned (RTO)
            </button>
          </form>
        ) : null}

        <button
          type="button"
          class="secondary"
          onclick={`document.getElementById('dialog-${order.id}').showModal()`}
        >
          History & Details
        </button>
      </div>

      <OrderDialog orderDetail={props.orderDetail} />
    </div>
  )
}

function OrderDialog(props: { orderDetail: OrderWithDetails }) {
  const { order, items, events } = props.orderDetail
  const dialogId = `dialog-${order.id}`

  return (
    <dialog id={dialogId}>
      <button
        type="button"
        class="dialog-close"
        onclick={`document.getElementById('${dialogId}').close()`}
      >
        ×
      </button>
      <h2 style="margin-top: 0;">Order {formatOrderId(order.id)}</h2>

      <p class="muted">
        Placed on {formatDate(order.createdAt)} · Payment: {order.paymentTier.toUpperCase()}
      </p>

      <div style="margin: 16px 0;">
        <h3 style="font-size: 15px; margin: 0 0 6px;">Customer Details</h3>
        <p style="margin: 0 0 4px;">
          <strong>{order.customerName}</strong>
        </p>
        <p style="margin: 0 0 4px;">{order.customerPhone}</p>
        <p style="margin: 0 0 4px; white-space: pre-wrap;">{order.deliveryAddress}</p>
        {order.deliveryNotes ? (
          <p style="margin: 6px 0 0;" class="muted">
            Instructions: {order.deliveryNotes}
          </p>
        ) : null}
      </div>

      <div style="margin: 16px 0;">
        <h3 style="font-size: 15px; margin: 0 0 6px;">Order Items</h3>
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
        <p style="text-align: right; font-weight: 600; margin: 8px 0 0;">
          Total: {formatPaisa(order.totalPaisa)}
        </p>
      </div>

      <div style="margin: 16px 0;">
        <h3 style="font-size: 15px; margin: 0 0 6px;">Fulfilment History</h3>
        <ul class="timeline">
          {events.map((ev) => (
            <li>
              <strong>{formatFulfilmentState(ev.toState)}</strong>
              {ev.fromState ? <span class="muted"> (from {formatFulfilmentState(ev.fromState)})</span> : null}
              <div class="muted">{formatDate(ev.createdAt)}</div>
            </li>
          ))}
        </ul>
      </div>
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
