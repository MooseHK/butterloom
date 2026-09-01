import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client.js'
import { cartItems, orderEvents, orderItems, orders, productVariants } from '../db/schema.js'
import { formatPaisa } from '../lib/money.js'
import { StorefrontLayout } from '../views/storefront.js'
import { getCartItemsForSession } from './queries.js'
import { getCartItemCount, getSession, syncCartCountCookie } from './session.js'

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
          <nav class="crumbs" aria-label="Breadcrumb">
            <a href="/cart">Your cart</a>
          </nav>
          <h1>Checkout</h1>
          {/* The one thing a customer wants confirmed before typing an address:
              that nothing is being asked of them now. */}
          <p class="muted">Cash on delivery — nothing to pay until it arrives.</p>
        </div>

        {error ? <div class="notice-banner error">{error}</div> : null}

        <form method="post" action="/checkout">
          <div class="panel">
            <h2 class="panel-head">Where it goes</h2>

            <div class="form-group">
              <label class="form-label" for="customer_name">
                Name
              </label>
              <input
                id="customer_name"
                name="customer_name"
                class="form-input"
                required
                autocomplete="name"
                placeholder="Nusrat Jahan"
                maxlength={150}
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="customer_phone">
                Phone
              </label>
              {/*
                inputmode and autocomplete are the difference between a numeric
                keypad with the number already offered and a customer typing
                eleven digits on a QWERTY keyboard. type="tel" alone gets the
                keypad; the rest is what stops them typing at all.
              */}
              <input
                id="customer_phone"
                name="customer_phone"
                type="tel"
                inputmode="tel"
                autocomplete="tel"
                class="form-input"
                required
                placeholder="01712345678"
                maxlength={30}
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="delivery_address">
                Address
              </label>
              <textarea
                id="delivery_address"
                name="delivery_address"
                class="form-textarea"
                rows={3}
                required
                autocomplete="street-address"
                placeholder="House, road, area, district"
              ></textarea>
            </div>

            <div class="form-group">
              <label class="form-label" for="delivery_notes">
                Notes for the courier — optional
              </label>
              <textarea
                id="delivery_notes"
                name="delivery_notes"
                class="form-textarea"
                rows={2}
                placeholder="A landmark, or when to call"
              ></textarea>
            </div>
          </div>

          {/* Payment Tier is our word for it, not the customer's (CONTEXT.md).
              What they need to read is what they will be asked to do. */}
          <div class="panel">
            <h2 class="panel-head">What you are ordering</h2>
            <div class="lines">
              {items.map((item) => (
                <div class="line">
                  <span>
                    {item.product.title}
                    {item.variant.label === 'Standard' ? '' : ` — ${item.variant.label}`}
                    <span class="qty"> × {item.cartItem.quantity}</span>
                  </span>
                  <span class="amount">
                    {formatPaisa(item.product.pricePaisa * item.cartItem.quantity)}
                  </span>
                </div>
              ))}
            </div>
            <div class="cart-row grand">
              <span>Total</span>
              <span>{formatPaisa(totalPaisa)}</span>
            </div>
            <p class="muted note">Payable in cash to the courier at the door.</p>
          </div>

          <div class="actions">
            <button type="submit" class="btn">
              Place order
            </button>
          </div>
        </form>
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

  // The cart was emptied inside the transaction; the badge has to hear about it
  // before the confirmation page renders, or it keeps counting a cart that no
  // longer exists.
  syncCartCountCookie(c, null)
  return c.redirect(`/order/${orderId}`, 303)
})
