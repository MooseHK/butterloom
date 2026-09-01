import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client.js'
import { cartItems, orderEvents, orderItems, orders, productVariants } from '../db/schema.js'
import { formatPaisa } from '../lib/money.js'
import { StorefrontLayout } from '../views/storefront.js'
import { getCartItemsForSession } from './queries.js'
import { getCartItemCount, getSession } from './session.js'

export const checkoutRoutes = new Hono()

checkoutRoutes.get('/', (c) => {
  c.header('Cache-Control', 'no-store')
  const session = getSession(c)
  if (!session) return c.redirect('/cart', 303)

  const items = getCartItemsForSession(session.id)
  if (items.length === 0) return c.redirect('/cart', 303)

  const cartCount = getCartItemCount(c)
  const totalPaisa = items.reduce(
    (sum, item) => sum + item.product.pricePaisa * item.cartItem.quantity,
    0,
  )
  const error = c.req.query('error')

  return c.html(
    <StorefrontLayout title="Checkout — butterloom" canonicalPath="/checkout" cartCount={cartCount}>
      <main>
        <div class="head">
          <h1>Checkout</h1>
        </div>

        {error ? <div class="notice-banner error">{error}</div> : null}

        <div class="checkout-grid">
          <form method="post" action="/checkout">
            <h2 style="font-size: 18px; margin: 0 0 16px;">Delivery Details</h2>

            <div class="form-group">
              <label class="form-label" for="customer_name">
                Full Name
              </label>
              <input
                id="customer_name"
                name="customer_name"
                class="form-input"
                required
                placeholder="Nusrat Jahan"
                maxlength={150}
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="customer_phone">
                Phone Number
              </label>
              <input
                id="customer_phone"
                name="customer_phone"
                type="tel"
                class="form-input"
                required
                placeholder="01712345678"
                maxlength={30}
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="delivery_address">
                Delivery Address
              </label>
              <textarea
                id="delivery_address"
                name="delivery_address"
                class="form-textarea"
                rows={3}
                required
                placeholder="House, Road, Area, District"
              ></textarea>
            </div>

            <div class="form-group">
              <label class="form-label" for="delivery_notes">
                Delivery Notes (Optional)
              </label>
              <textarea
                id="delivery_notes"
                name="delivery_notes"
                class="form-textarea"
                rows={2}
                placeholder="Any special instructions for courier"
              ></textarea>
            </div>

            <div class="order-summary-box" style="margin: 20px 0;">
              <h3 style="font-size: 15px; margin: 0 0 10px;">Payment Tier</h3>
              <p style="margin: 0; font-size: 14px;">
                <strong>Cash on Delivery (COD)</strong>
              </p>
              <p class="muted" style="margin: 4px 0 0; font-size: 13px;">
                Pay in cash when your order is delivered to your doorstep.
              </p>
            </div>

            <div class="order-summary-box" style="margin: 20px 0;">
              <h3 style="font-size: 15px; margin: 0 0 12px;">Order Summary</h3>
              {items.map((item) => (
                <div class="order-summary-item">
                  <div>
                    <span>
                      {item.product.title}
                      {item.variant.label === 'Standard' ? '' : ` (${item.variant.label})`}
                    </span>
                    <span class="muted"> × {item.cartItem.quantity}</span>
                  </div>
                  <span>{formatPaisa(item.product.pricePaisa * item.cartItem.quantity)}</span>
                </div>
              ))}
              <div
                class="cart-row grand"
                style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--hairline);"
              >
                <span>Total Amount</span>
                <span>{formatPaisa(totalPaisa)}</span>
              </div>
            </div>

            <button type="submit" class="btn" style="margin-top: 8px;">
              Place Order (Cash on Delivery)
            </button>
            <p class="muted" style="text-align: center; margin-top: 12px; font-size: 13px;">
              By placing this order, you confirm you will receive and pay for the parcel upon delivery.
            </p>
          </form>
        </div>
      </main>
    </StorefrontLayout>,
  )
})

checkoutRoutes.post('/', async (c) => {
  c.header('Cache-Control', 'no-store')
  const session = getSession(c)
  if (!session) return c.redirect('/cart', 303)

  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.redirect('/checkout?error=Invalid+form+data', 303)
  }

  const customerName = String(form.get('customer_name') ?? '').trim()
  const customerPhone = String(form.get('customer_phone') ?? '').trim()
  const deliveryAddress = String(form.get('delivery_address') ?? '').trim()
  const deliveryNotes = String(form.get('delivery_notes') ?? '').trim()

  if (!customerName || !customerPhone || !deliveryAddress) {
    return c.redirect('/checkout?error=Please+fill+in+all+required+fields', 303)
  }

  let orderId: number
  try {
    orderId = db.transaction((tx) => {
      const items = getCartItemsForSession(session.id)
      if (items.length === 0) {
        throw new Error('Your cart is empty')
      }

      // Check stock availability
      for (const item of items) {
        if (item.variant.stockQty < item.cartItem.quantity) {
          const variantTxt = item.variant.label === 'Standard' ? '' : ` (${item.variant.label})`
          throw new Error(
            `Insufficient stock for "${item.product.title}"${variantTxt}. Only ${item.variant.stockQty} available.`,
          )
        }
      }

      // Atomically decrement stock
      for (const item of items) {
        tx.update(productVariants)
          .set({ stockQty: item.variant.stockQty - item.cartItem.quantity })
          .where(eq(productVariants.id, item.variant.id))
          .run()
      }

      const totalPaisa = items.reduce(
        (sum, item) => sum + item.product.pricePaisa * item.cartItem.quantity,
        0,
      )

      // Create order
      const [order] = tx
        .insert(orders)
        .values({
          customerName,
          customerPhone,
          deliveryAddress,
          deliveryNotes,
          totalPaisa,
          fulfilmentState: 'placed',
          paymentTier: 'cod',
        })
        .returning({ id: orders.id })
        .all()

      if (!order) throw new Error('Failed to create order')

      // Record ordered items snapshot
      for (const item of items) {
        tx.insert(orderItems)
          .values({
            orderId: order.id,
            productId: item.product.id,
            productTitle: item.product.title,
            // The label, not the id: an order line has to keep reading correctly
            // after the variant behind it is renamed or deleted.
            variantLabel: item.variant.label,
            pricePaisa: item.product.pricePaisa,
            quantity: item.cartItem.quantity,
          })
          .run()
      }

      // Record initial audit event
      tx.insert(orderEvents)
        .values({
          orderId: order.id,
          fromState: null,
          toState: 'placed',
        })
        .run()

      // Clear the visitor's cart
      tx.delete(cartItems).where(eq(cartItems.sessionId, session.id)).run()

      return order.id
    })
  } catch (err: any) {
    const msg = encodeURIComponent(err?.message || 'Could not place order. Please try again.')
    return c.redirect(`/checkout?error=${msg}`, 303)
  }

  return c.redirect(`/order/${orderId}`, 303)
})
