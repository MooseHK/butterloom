import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client.js'
import { orderItems, orders } from '../db/schema.js'
import { formatPaisa } from '../lib/money.js'
import { formatFulfilmentState, formatOrderId, parseOrderId } from '../lib/order.js'
import { StorefrontLayout } from '../views/storefront.js'

export const orderRoutes = new Hono()

orderRoutes.get('/:id', (c) => {
  c.header('Cache-Control', 'no-store')
  const rawId = c.req.param('id')
  const orderId = parseOrderId(rawId)
  if (!orderId) return c.notFound()

  const [order] = db.select().from(orders).where(eq(orders.id, orderId)).all()
  if (!order) return c.notFound()

  const items = db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.id))
    .all()

  const formattedId = formatOrderId(order.id)

  return c.html(
    <StorefrontLayout
      title={`Order ${formattedId} Confirmed — butterloom`}
      canonicalPath={`/order/${rawId}`}
    >
      <main>
        <div class="confirm">
          <div class="confirm-badge" aria-hidden="true">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <h1>Thank you for your order</h1>
          <p class="muted">Reference {formattedId}</p>
        </div>

        <div class="panel">
          <h2 class="panel-head">Where it is going</h2>
          <p>{order.customerName}</p>
          <p class="muted">{order.customerPhone}</p>
          <p class="address">{order.deliveryAddress}</p>
          {order.deliveryNotes ? <p class="muted note">{order.deliveryNotes}</p> : null}
        </div>

        <div class="panel">
          <h2 class="panel-head">What you ordered</h2>
          <div class="lines">
            {items.map((item) => (
              <div class="line">
                <span>
                  {item.productTitle}
                  {item.variantLabel ? ` — ${item.variantLabel}` : ''}
                  <span class="qty"> × {item.quantity}</span>
                </span>
                <span class="amount">{formatPaisa(item.pricePaisa * item.quantity)}</span>
              </div>
            ))}
          </div>
          <div class="cart-row grand">
            <span>To pay on delivery</span>
            <span>{formatPaisa(order.totalPaisa)}</span>
          </div>
        </div>

        {/* Fulfilment State is our word (CONTEXT.md); the customer is being
            told where their parcel is, which is the same fact in their
            language. */}
        <div class="panel">
          <h2 class="panel-head">Where it has got to</h2>
          <div class="cart-row">
            <span class="lab">Status</span>
            <span>{formatFulfilmentState(order.fulfilmentState)}</span>
          </div>
          {/* Only while it is true. A confirmation page is bookmarked and
              revisited, and a parcel already delivered should not still be
              claiming it is being packed. */}
          {order.fulfilmentState === 'placed' ? (
            <p class="muted note">
              We are packing it now. It goes out on the next morning's courier run.
            </p>
          ) : null}
        </div>

        <div class="actions">
          <a href="/" class="btn secondary">
            Keep looking
          </a>
        </div>
      </main>
    </StorefrontLayout>,
  )
})
