import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import {
  cartItems,
  orderEvents,
  orderItems,
  orders,
  products,
  productStock,
  sessions,
} from '../src/db/schema.js'
import { cartRoutes } from '../src/storefront/cart.js'
import { checkoutRoutes } from '../src/storefront/checkout.js'
import { orderRoutes } from '../src/storefront/order.js'

runMigrations()

function buildTestApp() {
  const app = new Hono()
  app.route('/cart', cartRoutes)
  app.route('/checkout', checkoutRoutes)
  app.route('/order', orderRoutes)
  return app
}

function seedProduct(slug: string, title: string, pricePaisa: number, quantity = 10) {
  const [p] = db
    .insert(products)
    .values({ slug, title, pricePaisa })
    .returning()
    .all()
  if (!p) throw new Error('Product not created')

  const [s] = db
    .insert(productStock)
    .values({ productId: p.id, variantLabel: '', quantity })
    .returning()
    .all()
  if (!s) throw new Error('Stock not created')

  return { product: p, stock: s }
}

test('cart add sets cookie and creates cart item', async () => {
  const app = buildTestApp()
  const { product, stock } = seedProduct(`tee-${Date.now()}`, 'Test Tee', 150000, 5)

  const form = new FormData()
  form.set('product_id', String(product.id))
  form.set('stock_id', String(stock.id))
  form.set('quantity', '2')

  const res = await app.request('/cart/add', {
    method: 'POST',
    body: form,
  })

  assert.equal(res.status, 303)
  assert.equal(res.headers.get('Location'), '/cart')

  const setCookie = res.headers.get('Set-Cookie')
  assert.ok(setCookie, 'Should set session cookie')
  assert.match(setCookie, /bl_session=[0-9a-f]{32}/)

  const tokenMatch = /bl_session=([0-9a-f]{32})/.exec(setCookie)
  assert.ok(tokenMatch && tokenMatch[1])
  const token = tokenMatch[1]

  const [sessionRow] = db.select().from(sessions).where(eq(sessions.token, token)).all()
  assert.ok(sessionRow, 'Session record should exist in DB')

  const cartRows = db
    .select()
    .from(cartItems)
    .where(eq(cartItems.sessionId, sessionRow.id))
    .all()
  assert.equal(cartRows.length, 1)
  assert.equal(cartRows[0]?.quantity, 2)
  assert.equal(cartRows[0]?.stockId, stock.id)
})

test('cart add via json request returns json with updated count', async () => {
  const app = buildTestApp()
  const { product, stock } = seedProduct(`saree-${Date.now()}`, 'Silk Saree', 350000, 5)

  const form = new FormData()
  form.set('product_id', String(product.id))
  form.set('stock_id', String(stock.id))
  form.set('quantity', '1')

  const res = await app.request('/cart/add', {
    method: 'POST',
    body: form,
    headers: { Accept: 'application/json' },
  })

  assert.equal(res.status, 200)
  const json = (await res.json()) as { ok: boolean; count: number }
  assert.equal(json.ok, true)
  assert.ok(json.count >= 1)
})

test('cart update and remove modify quantities', async () => {
  const app = buildTestApp()
  const { product, stock } = seedProduct(`kurti-${Date.now()}`, 'Cotton Kurti', 120000, 10)

  // 1. Add item to cart
  const addForm = new FormData()
  addForm.set('product_id', String(product.id))
  addForm.set('stock_id', String(stock.id))
  addForm.set('quantity', '1')

  const addRes = await app.request('/cart/add', { method: 'POST', body: addForm })
  const cookie = addRes.headers.get('Set-Cookie')!
  const tokenMatch = /bl_session=([0-9a-f]{32})/.exec(cookie)
  assert.ok(tokenMatch && tokenMatch[1])
  const token = tokenMatch[1]
  const [session] = db.select().from(sessions).where(eq(sessions.token, token)).all()
  assert.ok(session)

  const [cartItem] = db.select().from(cartItems).where(eq(cartItems.sessionId, session.id)).all()
  assert.ok(cartItem)

  // 2. Update quantity to 4
  const updateForm = new FormData()
  updateForm.set('cart_item_id', String(cartItem.id))
  updateForm.set('quantity', '4')

  const updateRes = await app.request('/cart/update', {
    method: 'POST',
    body: updateForm,
    headers: { Cookie: `bl_session=${token}` },
  })
  assert.equal(updateRes.status, 303)

  const [updatedItem] = db.select().from(cartItems).where(eq(cartItems.id, cartItem.id)).all()
  assert.equal(updatedItem?.quantity, 4)

  // 3. Remove item from cart
  const removeForm = new FormData()
  removeForm.set('cart_item_id', String(cartItem.id))

  const removeRes = await app.request('/cart/remove', {
    method: 'POST',
    body: removeForm,
    headers: { Cookie: `bl_session=${token}` },
  })
  assert.equal(removeRes.status, 303)

  const remaining = db.select().from(cartItems).where(eq(cartItems.id, cartItem.id)).all()
  assert.equal(remaining.length, 0)
})

test('checkout validates required fields and blocks invalid submit', async () => {
  const app = buildTestApp()
  const { product, stock } = seedProduct(`shawl-${Date.now()}`, 'Wool Shawl', 200000, 5)

  // Add item to cart
  const addForm = new FormData()
  addForm.set('product_id', String(product.id))
  addForm.set('stock_id', String(stock.id))
  addForm.set('quantity', '1')
  const addRes = await app.request('/cart/add', { method: 'POST', body: addForm })
  const cookie = addRes.headers.get('Set-Cookie')!

  // Submit checkout missing required address
  const badForm = new FormData()
  badForm.set('customer_name', 'Tasnim Ali')
  badForm.set('customer_phone', '01812345678')
  badForm.set('delivery_address', '') // empty

  const res = await app.request('/checkout', {
    method: 'POST',
    body: badForm,
    headers: { Cookie: cookie },
  })

  assert.equal(res.status, 303)
  assert.match(res.headers.get('Location') ?? '', /\/checkout\?error=/)
})

test('checkout verifies stock, decrements atomically, creates order and clears cart', async () => {
  const app = buildTestApp()
  const initialStock = 5
  const { product, stock } = seedProduct(`panjabi-${Date.now()}`, 'Silk Panjabi', 400000, initialStock)

  // Add 3 to cart
  const addForm = new FormData()
  addForm.set('product_id', String(product.id))
  addForm.set('stock_id', String(stock.id))
  addForm.set('quantity', '3')
  const addRes = await app.request('/cart/add', { method: 'POST', body: addForm })
  const cookie = addRes.headers.get('Set-Cookie')!
  const tokenMatch = /bl_session=([0-9a-f]{32})/.exec(cookie)
  assert.ok(tokenMatch && tokenMatch[1])
  const token = tokenMatch[1]
  const [session] = db.select().from(sessions).where(eq(sessions.token, token)).all()
  assert.ok(session)

  // Place order
  const checkoutForm = new FormData()
  checkoutForm.set('customer_name', 'Maksuda Begum')
  checkoutForm.set('customer_phone', '01912345678')
  checkoutForm.set('delivery_address', 'Flat 4B, Road 12, Banani, Dhaka')
  checkoutForm.set('delivery_notes', 'Call before arrival')

  const res = await app.request('/checkout', {
    method: 'POST',
    body: checkoutForm,
    headers: { Cookie: cookie },
  })

  assert.equal(res.status, 303)
  const location = res.headers.get('Location') ?? ''
  assert.match(location, /\/order\/\d+/)
  const orderId = Number(location.replace('/order/', ''))

  // 1. Check order record
  const [order] = db.select().from(orders).where(eq(orders.id, orderId)).all()
  assert.ok(order)
  assert.equal(order.customerName, 'Maksuda Begum')
  assert.equal(order.customerPhone, '01912345678')
  assert.equal(order.deliveryAddress, 'Flat 4B, Road 12, Banani, Dhaka')
  assert.equal(order.deliveryNotes, 'Call before arrival')
  assert.equal(order.totalPaisa, 400000 * 3)
  assert.equal(order.fulfilmentState, 'placed')
  assert.equal(order.paymentTier, 'cod')

  // 2. Check order_items snapshot
  const items = db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).all()
  assert.equal(items.length, 1)
  assert.equal(items[0]?.productTitle, 'Silk Panjabi')
  assert.equal(items[0]?.pricePaisa, 400000)
  assert.equal(items[0]?.quantity, 3)

  // 3. Check order_events initial record
  const events = db.select().from(orderEvents).where(eq(orderEvents.orderId, orderId)).all()
  assert.equal(events.length, 1)
  assert.equal(events[0]?.fromState, null)
  assert.equal(events[0]?.toState, 'placed')

  // 4. Check stock was decremented from 5 to 2
  const [updatedStock] = db.select().from(productStock).where(eq(productStock.id, stock.id)).all()
  assert.ok(updatedStock)
  assert.equal(updatedStock.quantity, initialStock - 3)

  // 5. Check cart was cleared
  const remainingCart = db
    .select()
    .from(cartItems)
    .where(eq(cartItems.sessionId, session.id))
    .all()
  assert.equal(remainingCart.length, 0)

  // 6. Confirmation page renders
  const orderPageRes = await app.request(`/order/${orderId}`)
  assert.equal(orderPageRes.status, 200)
  const html = await orderPageRes.text()
  assert.match(html, /Thank you for your order/)
  assert.match(html, /Maksuda Begum/)
  assert.match(html, /Silk Panjabi/)
})
