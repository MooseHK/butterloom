import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client.js'
import { cartItems, orderEvents, orderItems, orders, productVariants } from '../db/schema.js'
import {
  addressLimits,
  composeAddress,
  missingAddressParts,
  readAddressParts,
} from '../lib/address.js'
import { formatPaisa } from '../lib/money.js'
import { StorefrontLayout } from '../views/storefront.js'
import { allocateInvoice, calculateVat, getVatRateBp } from '../lib/settings.js'
import { orderPlacedSmsText, sms } from '../lib/sms.js'
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
                placeholder="Korom Ali"
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

            {/*
              Four fields rather than one textarea. Each says what it wants, so
              the address arrives in the shape a courier reads it in instead of
              whatever order the customer thought of; the required ones cannot
              be skipped; and every one carries the autocomplete token a phone
              has actually saved, where the textarea had only street-address
              and so was usually filled in by hand.

              Stored as one composed address — see lib/address.ts for why the
              parts are not kept in columns of their own.
            */}
            <div class="form-group">
              <label class="form-label" for="address_line">
                House and road
              </label>
              <input
                id="address_line"
                name="address_line"
                class="form-input"
                required
                autocomplete="address-line1"
                placeholder="House 42, Road 12"
                maxlength={addressLimits.line}
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="address_area">
                Area or thana
              </label>
              <input
                id="address_area"
                name="address_area"
                class="form-input"
                required
                autocomplete="address-line2"
                placeholder="Dhanmondi"
                maxlength={addressLimits.area}
              />
            </div>

            {/*
              City and postcode share a line: they are one line on the parcel,
              the postcode is four characters, and on a phone this is the pair
              that would otherwise leave two nearly empty rows.
            */}
            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="address_city">
                  City or district
                </label>
                <input
                  id="address_city"
                  name="address_city"
                  class="form-input"
                  required
                  autocomplete="address-level2"
                  placeholder="Dhaka"
                  maxlength={addressLimits.city}
                />
              </div>
              <div class="form-group form-group-narrow">
                <label class="form-label" for="address_postcode">
                  Postcode — optional
                </label>
                {/*
                  inputmode, not type="number": a postcode is four digits but it
                  is not a quantity, and a number input brings spinners, drops
                  a leading zero and lets the wheel change it by scrolling.
                */}
                <input
                  id="address_postcode"
                  name="address_postcode"
                  class="form-input"
                  inputmode="numeric"
                  autocomplete="postal-code"
                  placeholder="1209"
                  maxlength={addressLimits.postcode}
                />
              </div>
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
            <p class="muted note">
              Payable in cash to the courier at the door. Prices include VAT (Mushak 6.3 invoice itemised upon order).
            </p>
          </div>

          <div class="form-group" style="margin: 20px 0 16px;">
            <label style="display: flex; align-items: flex-start; gap: 10px; font-size: 13.5px; line-height: 1.5; cursor: pointer;">
              <input
                type="checkbox"
                name="consent"
                value="pdpa_2026_v1"
                required
                style="margin-top: 3px; accent-color: var(--ink);"
              />
              <span>
                আমি বাটারলুমের <a href="/terms" target="_blank" style="color: var(--ink); text-decoration: underline;">ব্যবহারের শর্তাবলী</a> এবং <a href="/privacy" target="_blank" style="color: var(--ink); text-decoration: underline;">গোপনীয়তা নীতি</a> পড়েছি এবং আমার ব্যক্তিগত তথ্য অর্ডার সরবরাহ ও কর ইনভয়েসের জন্য ব্যবহারে সম্মতি দিচ্ছি। (PDPA 2026)
              </span>
            </label>
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
  const deliveryNotes = String(form.get('delivery_notes') ?? '').trim()

  const addressParts = readAddressParts(form)
  const deliveryAddress = composeAddress(addressParts)

  // Named, not counted. "Please fill in all required fields" sends a customer
  // back to hunt for which one, and the browser's own `required` has already
  // caught every case except a hand-posted form or a field holding only
  // spaces — so the one time this message is read is the one time it has to
  // be specific.
  const missing = [
    ...(customerName ? [] : ['your name']),
    ...(customerPhone ? [] : ['a phone number']),
    ...missingAddressParts(addressParts),
  ]
  if (missing.length > 0) {
    const list =
      missing.length === 1
        ? missing[0]
        : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`
    return c.redirect(`/checkout?error=${encodeURIComponent(`Please add ${list}.`)}`, 303)
  }

  let result: { orderId: number; totalPaisa: number }
  try {
    result = db.transaction((tx) => {
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

      const vatRateBp = getVatRateBp()
      const { vatPaisa } = calculateVat(totalPaisa, vatRateBp)

      // Create order
      const [order] = tx
        .insert(orders)
        .values({
          customerName,
          customerPhone,
          deliveryAddress,
          deliveryNotes,
          totalPaisa,
          vatRateBp,
          vatPaisa,
          consentVersion: String(form.get('consent') ?? 'pdpa_2026_v1'),
          consentGrantedAt: Math.floor(Date.now() / 1000),
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

      // Monotonic gapless Mushak 6.3 invoice allocation
      allocateInvoice(tx, {
        orderId: order.id,
        totalPaisa,
        vatRateBp,
        vatPaisa,
        customerName,
        customerPhone,
        customerAddress: deliveryAddress,
      })

      // Clear the visitor's cart
      tx.delete(cartItems).where(eq(cartItems.sessionId, session.id)).run()

      return { orderId: order.id, totalPaisa }
    })
  } catch (err: any) {
    const msg = encodeURIComponent(err?.message || 'Could not place order. Please try again.')
    return c.redirect(`/checkout?error=${msg}`, 303)
  }

  // Send Bengali SMS notification (BTRC compliant)
  sms.send({
    to: customerPhone,
    text: orderPlacedSmsText(`BL-${result.orderId}`, Math.round(result.totalPaisa / 100)),
    transactional: true,
  }).catch((err) => console.error('[checkout] failed to send SMS', err))

  // The cart was emptied inside the transaction; the badge has to hear about it
  // before the confirmation page renders, or it keeps counting a cart that no
  // longer exists.
  syncCartCountCookie(c, null)
  return c.redirect(`/order/${result.orderId}`, 303)
})
