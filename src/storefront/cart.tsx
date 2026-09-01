import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client.js'
import { cartItems, products, productStock } from '../db/schema.js'
import { formatPaisa } from '../lib/money.js'
import { Picture } from '../views/picture.js'
import { Crumb, StorefrontLayout } from '../views/storefront.js'
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

  const totalPaisa = items.reduce(
    (sum, item) => sum + item.product.pricePaisa * item.cartItem.quantity,
    0,
  )

  return c.html(
    <StorefrontLayout title="Your cart — butterloom" canonicalPath="/cart" cartCount={cartCount}>
      <main>
        <Crumb href="/" label="Keep looking" />
        <div class="head">
          <h1>Your cart</h1>
          {items.length > 0 ? (
            <p class="muted">
              {cartCount} {cartCount === 1 ? 'item' : 'items'}
            </p>
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
                      {item.stock.variantLabel ? (
                        <p class="cart-variant">{item.stock.variantLabel}</p>
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

cartRoutes.post('/add', async (c) => {
  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.redirect('/cart', 303)
  }

  const productId = Number(form.get('product_id'))
  let stockId = Number(form.get('stock_id'))
  const quantity = Math.max(1, Math.min(10, Number(form.get('quantity') ?? 1)))

  if (!productId || Number.isNaN(productId)) {
    return c.redirect('/cart', 303)
  }

  // If no stock_id provided, look up default/first stock row for this product
  if (!stockId || Number.isNaN(stockId)) {
    const [found] = db
      .select()
      .from(productStock)
      .where(eq(productStock.productId, productId))
      .limit(1)
      .all()
    if (found) {
      stockId = found.id
    } else {
      // Auto-create default stock row if none exists
      const [created] = db
        .insert(productStock)
        .values({ productId, variantLabel: '', quantity: 10 })
        .returning()
        .all()
      if (created) stockId = created.id
    }
  }

  if (!stockId) {
    return c.redirect('/cart', 303)
  }

  const session = getOrCreateSession(c)

  const [existing] = db
    .select()
    .from(cartItems)
    .where(and(eq(cartItems.sessionId, session.id), eq(cartItems.stockId, stockId)))
    .all()

  if (existing) {
    const newQty = Math.min(10, existing.quantity + quantity)
    db.update(cartItems)
      .set({ quantity: newQty })
      .where(eq(cartItems.id, existing.id))
      .run()
  } else {
    db.insert(cartItems)
      .values({
        sessionId: session.id,
        productId,
        stockId,
        quantity,
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
