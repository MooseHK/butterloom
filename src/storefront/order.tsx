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
        <div class="head" style="text-align: center; padding: 32px 0 24px;">
          <div class="order-confirm-badge">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <h1>Thank you for your order</h1>
          <p class="muted" style="margin-top: 6px; font-size: 15px;">
            Order reference: <strong>{formattedId}</strong>
          </p>
        </div>

        <div class="detail">
          <div class="order-summary-box">
            <h2 style="font-size: 16px; margin: 0 0 12px;">Delivery Information</h2>
            <p style="margin: 0 0 4px; font-weight: 500;">{order.customerName}</p>
            <p style="margin: 0 0 4px;" class="muted">{order.customerPhone}</p>
            <p style="margin: 0 0 4px; white-space: pre-wrap;">{order.deliveryAddress}</p>
            {order.deliveryNotes ? (
              <p style="margin: 8px 0 0; font-size: 13px;" class="muted">
                <strong>Instructions:</strong> {order.deliveryNotes}
              </p>
            ) : null}
          </div>

          <div class="order-summary-box">
            <h2 style="font-size: 16px; margin: 0 0 12px;">Order Status & Payment</h2>
            <div class="cart-row" style="margin-bottom: 8px;">
              <span class="muted">Fulfilment State</span>
              <strong>{formatFulfilmentState(order.fulfilmentState)}</strong>
            </div>
            <div class="cart-row">
              <span class="muted">Payment Tier</span>
              <span>Cash on Delivery (COD)</span>
            </div>
          </div>

          <div class="order-summary-box">
            <h2 style="font-size: 16px; margin: 0 0 12px;">Items Ordered</h2>
            {items.map((item) => (
              <div class="order-summary-item">
                <div>
                  <span>{item.productTitle}</span>
                  {item.variantLabel ? <span class="muted"> ({item.variantLabel})</span> : null}
                  <span class="muted"> × {item.quantity}</span>
                </div>
                <span>{formatPaisa(item.pricePaisa * item.quantity)}</span>
              </div>
            ))}
            <div
              class="cart-row grand"
              style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--hairline);"
            >
              <span>Total Amount</span>
              <span>{formatPaisa(order.totalPaisa)}</span>
            </div>
          </div>

          <div style="margin-top: 16px; text-align: center;">
            <p class="muted" style="margin-bottom: 20px;">
              Our team is preparing your package for courier dispatch.
            </p>
            <a href="/" class="btn secondary" style="display: inline-flex; width: auto;">
              ← Back to Collection
            </a>
          </div>
        </div>
      </main>
    </StorefrontLayout>,
  )
})
