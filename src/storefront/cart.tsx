import { and, asc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { db } from '../db/client.js'
import { cartItems, productVariants, products } from '../db/schema.js'
import { formatPaisa } from '../lib/money.js'
import { Picture } from '../views/picture.js'
import { StorefrontLayout } from '../views/storefront.js'
import { getCartItemsForSession } from './queries.js'
import {
  getCartItemCount,
  getOrCreateSession,
  getSession,
  syncCartCountCookie,
} from './session.js'

export const cartRoutes = new Hono()

const thumbSizes = '72px'

cartRoutes.get('/', (c) => {
  c.header('Cache-Control', 'no-store')
  const session = getSession(c)
  const items = session ? getCartItemsForSession(session.id) : []
  const cartCount = session ? getCartItemCount(c) : 0
  // Where a no-script add-to-cart puts its refusal. Capped and rendered as a
  // child rather than raw, so the query string cannot write markup into the
  // page — it is echoed back to whoever typed it, which is the definition of
  // reflected XSS if it were ever trusted.
  const error = (c.req.query('error') ?? '').slice(0, 200)

  const totalPaisa = items.reduce(
    (sum, item) => sum + item.product.pricePaisa * item.cartItem.quantity,
    0,
  )

  return c.html(
    <StorefrontLayout title="Your cart — butterloom" canonicalPath="/cart" cartCount={cartCount}>
      <main>
        {error ? (
          <p class="cart-error" role="alert">
            {error}
          </p>
        ) : null}

        <div class="head">
          <nav class="crumbs" aria-label="Breadcrumb">
            <a href="/">Keep looking</a>
          </nav>
          <h1>Your cart</h1>
          {items.length > 0 ? (
            <span>
              {cartCount} {cartCount === 1 ? 'item' : 'items'}
            </span>
          ) : null}
        </div>

        {items.length === 0 ? (
          <div class="detail centre">
            <p class="muted">Nothing in it yet.</p>
            <div class="actions">
              <a class="btn secondary" href="/">
                The collection
              </a>
            </div>
          </div>
        ) : (
          <>
            <ul class="cart-list">
              {items.map((item) => {
                const lineTotal = item.product.pricePaisa * item.cartItem.quantity
                return (
                  <li class="cart-item">
                    <div class="cart-thumb">
                      {item.cover ? (
                        <Picture
                          image={item.cover.image}
                          derivatives={item.cover.derivatives}
                          sizes={thumbSizes}
                        />
                      ) : (
                        <div class="placeholder" style="width: 100%; height: 100%;">
                          —
                        </div>
                      )}
                    </div>
                    <div class="cart-info">
                      <h2 class="cart-title">
                        <a href={`/p/${item.product.slug}`}>{item.product.title}</a>
                      </h2>
                      {item.variant.label !== 'Standard' ? (
                        <p class="cart-variant">{item.variant.label}</p>
                      ) : null}
                      <p class="cart-price">{formatPaisa(item.product.pricePaisa)} each</p>
                      <div class="cart-controls">
                        <form method="post" action="/cart/update">
                          <input type="hidden" name="cart_item_id" value={item.cartItem.id} />
                          {/* A native select, so the phone opens its own wheel
                              rather than the page growing a stepper. It submits
                              on change where there is script and on the button
                              below where there is not. */}
                          <label class="cart-qty-label">
                            Qty
                            <select
                              name="quantity"
                              class="cart-qty-select"
                              aria-label={`Quantity of ${item.product.title}`}
                              onchange="this.form.submit()"
                            >
                              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((q) => (
                                <option value={q} selected={q === item.cartItem.quantity}>
                                  {q}
                                </option>
                              ))}
                            </select>
                          </label>
                          <noscript>
                            <button type="submit" class="cart-remove-btn">
                              Update
                            </button>
                          </noscript>
                        </form>
                        <form method="post" action="/cart/remove">
                          <input type="hidden" name="cart_item_id" value={item.cartItem.id} />
                          <button
                            type="submit"
                            class="cart-remove-btn"
                            aria-label={`Remove ${item.product.title}`}
                          >
                            Remove
                          </button>
                        </form>
                      </div>
                    </div>
                    <div class="cart-line">{formatPaisa(lineTotal)}</div>
                  </li>
                )
              })}
            </ul>

            {/* Subtotal and total were the same number printed twice, which is
                what a delivery charge line will make untrue — and until there
                is one, saying it twice is only more ink. */}
            <div class="panel">
              <div class="cart-row">
                <span class="lab">Payment</span>
                <span>Cash on delivery</span>
              </div>
              <div class="cart-row grand">
                <span>Total</span>
                <span>{formatPaisa(totalPaisa)}</span>
              </div>
            </div>

            <div class="actions">
              <a href="/checkout" class="btn">
                Checkout
              </a>
              <a href="/" class="btn secondary">
                Keep looking
              </a>
            </div>
          </>
        )}
      </main>
    </StorefrontLayout>,
  )
})

/**
 * Why every failure below answers rather than redirecting to /cart.
 *
 * This endpoint used to send every refusal to /cart with no message, so the one
 * case a shopper actually hits — adding something that is sold out — looked
 * exactly like success: the page changed to the cart, and the cart did not have
 * the thing in it. A shopper cannot tell "sold out" from "the button is broken"
 * from that, and neither could the operator they then telephoned.
 *
 * The product page posts this with `Accept: application/json` and stays put, so
 * the honest answer for that path is a status and a reason it can print next to
 * the button. The no-script path gets the same reason as a notice on /cart,
 * because there is nowhere else to put it: the product page is edge-cached
 * (ADR-0007) and cannot be re-rendered with a per-shopper message on it.
 */
function refuse(c: Context, status: 400 | 404 | 409, reason: string) {
  const wantsJson =
    c.req.header('accept')?.includes('application/json') ||
    c.req.header('x-requested-with') === 'XMLHttpRequest'
  if (wantsJson) return c.json({ ok: false, error: reason }, status)
  return c.redirect(`/cart?error=${encodeURIComponent(reason)}`, 303)
}

cartRoutes.post('/add', async (c) => {
  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return refuse(c, 400, 'That did not come through. Please try again.')
  }

  const productId = Number(form.get('product_id'))
  const requestedVariant = Number(form.get('variant_id'))
  const quantity = Math.max(1, Math.min(10, Number(form.get('quantity') ?? 1)))

  if (!productId || Number.isNaN(productId)) {
    return refuse(c, 400, 'That did not come through. Please try again.')
  }

  // Checked before the variant, and checked here rather than trusted to the
  // page the form came off: that page is edge-cached, so it can be served from
  // the Dhaka PoP for as long as its TTL runs after the product was withdrawn.
  // The cached page is allowed to be stale; the order it produces is not.
  const [onSale] = db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), isNull(products.hiddenAt)))
    .all()
  if (!onSale) {
    return refuse(c, 404, 'Sorry — this piece is no longer available.')
  }

  // The variant is looked up rather than trusted, and looked up *within this
  // product*: both ids arrive on the same hand-postable form, and without the
  // second condition a line could pair one product's title with another
  // product's variant — which is a wrong label on a real order, not a display
  // bug. A product page with one variant posts no variant_id at all, so the
  // fallback is the product's first, not a row invented here: a cart may not
  // conjure stock that nobody has counted.
  const [variant] = db
    .select()
    .from(productVariants)
    .where(
      requestedVariant && !Number.isNaN(requestedVariant)
        ? and(eq(productVariants.id, requestedVariant), eq(productVariants.productId, productId))
        : eq(productVariants.productId, productId),
    )
    .orderBy(asc(productVariants.position), asc(productVariants.id))
    .limit(1)
    .all()

  if (!variant) {
    return refuse(c, 404, 'Sorry — this piece is no longer available.')
  }
  const variantId = variant.id

  // The check this endpoint never had. ADR-0007 keeps availability off the
  // cached product page and resolves it "at placement", and checkout does hold
  // that line — but letting a sold-out piece into the cart only moves the
  // refusal to the end of the checkout form, after the shopper has typed their
  // address. Saying it at the button is the same promise kept earlier.
  //
  // Not a reservation: two shoppers can both pass this on the last one, and
  // checkout's transaction is still what decides. This is a courtesy, and the
  // wording keeps it one — it says what is true now, not what will be true when
  // they check out.
  if (variant.stockQty < 1) {
    const which = variant.label === 'Standard' ? 'This piece' : `“${variant.label}”`
    return refuse(c, 409, `${which} is out of stock.`)
  }

  const session = getOrCreateSession(c)

  const [existing] = db
    .select()
    .from(cartItems)
    .where(and(eq(cartItems.sessionId, session.id), eq(cartItems.variantId, variantId)))
    .all()

  if (existing) {
    // Capped at what is actually on the shelf as well as at ten, so adding the
    // same piece four times cannot build a line the checkout will refuse.
    const newQty = Math.min(10, variant.stockQty, existing.quantity + quantity)
    if (newQty === existing.quantity) {
      return refuse(
        c,
        409,
        `Only ${variant.stockQty} of ${variant.label === 'Standard' ? 'this piece' : `“${variant.label}”`} ${variant.stockQty === 1 ? 'is' : 'are'} available, and ${variant.stockQty === 1 ? 'it is' : 'they are'} already in your cart.`,
      )
    }
    db.update(cartItems)
      .set({ quantity: newQty })
      .where(eq(cartItems.id, existing.id))
      .run()
  } else {
    db.insert(cartItems)
      .values({
        sessionId: session.id,
        productId,
        variantId,
        // Same cap as the branch above: a hand-posted quantity of ten against
        // three in stock is a line checkout would only refuse later.
        quantity: Math.min(quantity, variant.stockQty),
      })
      .run()
  }

  syncCartCountCookie(c, session)

  const isJson =
    c.req.header('accept')?.includes('application/json') ||
    c.req.header('x-requested-with') === 'XMLHttpRequest'

  if (isJson) {
    const totalCount = getCartItemCount(c, session)
    return c.json({ ok: true, count: totalCount })
  }

  return c.redirect('/cart', 303)
})

cartRoutes.post('/update', async (c) => {
  const session = getSession(c)
  if (!session) return c.redirect('/cart', 303)

  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.redirect('/cart', 303)
  }

  const cartItemId = Number(form.get('cart_item_id'))
  const quantity = Number(form.get('quantity'))

  if (!cartItemId || Number.isNaN(cartItemId)) {
    return c.redirect('/cart', 303)
  }

  if (quantity <= 0) {
    db.delete(cartItems)
      .where(and(eq(cartItems.id, cartItemId), eq(cartItems.sessionId, session.id)))
      .run()
  } else {
    const clamped = Math.min(10, Math.max(1, quantity))
    db.update(cartItems)
      .set({ quantity: clamped })
      .where(and(eq(cartItems.id, cartItemId), eq(cartItems.sessionId, session.id)))
      .run()
  }

  syncCartCountCookie(c, session)
  return c.redirect('/cart', 303)
})

cartRoutes.post('/remove', async (c) => {
  const session = getSession(c)
  if (!session) return c.redirect('/cart', 303)

  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.redirect('/cart', 303)
  }

  const cartItemId = Number(form.get('cart_item_id'))
  if (cartItemId && !Number.isNaN(cartItemId)) {
    db.delete(cartItems)
      .where(and(eq(cartItems.id, cartItemId), eq(cartItems.sessionId, session.id)))
      .run()
  }

  syncCartCountCookie(c, session)
  return c.redirect('/cart', 303)
})
