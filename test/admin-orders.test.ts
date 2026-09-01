// First, and it has to stay first: this picks the database before
// src/db/client.ts opens one. See the file for why.
import './support/tempDb.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { and, asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { adminOrders } from '../src/admin/orders.js'
import { adminProducts } from '../src/admin/products.js'
import { db } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import {
  orderEvents,
  orderItems,
  orders,
  products,
  productVariants,
  variantOptions,
} from '../src/db/schema.js'

runMigrations()

function buildAdminApp() {
  const app = new Hono()
  app.route('/admin/orders', adminOrders)
  app.route('/admin/products', adminProducts)
  return app
}

function createOrderWithItems(
  state: 'placed' | 'packed' | 'handed_over' | 'delivered' | 'returned' | 'cancelled',
  itemQty = 2,
  initialStock = 10,
) {
  const [p] = db
    .insert(products)
    .values({ slug: `admin-test-${Date.now()}-${Math.random()}`, title: 'Admin Test Item', pricePaisa: 50000 })
    .returning()
    .all()
  if (!p) throw new Error('Product not created')

  const [s] = db
    .insert(productVariants)
    .values({ productId: p.id, label: 'M', stockQty: initialStock })
    .returning()
    .all()
  if (!s) throw new Error('Stock not created')

  const [o] = db
    .insert(orders)
    .values({
      customerName: 'Ayesha Rahman',
      customerPhone: '01700000000',
      deliveryAddress: 'Dhanmondi 27, Dhaka',
      totalPaisa: 50000 * itemQty,
      fulfilmentState: state,
      paymentTier: 'cod',
    })
    .returning()
    .all()
  if (!o) throw new Error('Order not created')

  db.insert(orderItems)
    .values({
      orderId: o.id,
      productId: p.id,
      productTitle: p.title,
      variantLabel: 'M',
      pricePaisa: 50000,
      quantity: itemQty,
    })
    .run()

  db.insert(orderEvents)
    .values({
      orderId: o.id,
      fromState: null,
      toState: state,
    })
    .run()

  return { product: p, stock: s, order: o }
}

test('admin can advance order through placed -> packed -> handed_over -> delivered', async () => {
  const app = buildAdminApp()
  const { order } = createOrderWithItems('placed')

  // 1. Advance placed -> packed
  const res1 = await app.request(`/admin/orders/${order.id}/advance`, { method: 'POST' })
  assert.equal(res1.status, 303)

  const [orderAfter1] = db.select().from(orders).where(eq(orders.id, order.id)).all()
  assert.equal(orderAfter1?.fulfilmentState, 'packed')

  // 2. Advance packed -> handed_over
  const res2 = await app.request(`/admin/orders/${order.id}/advance`, { method: 'POST' })
  assert.equal(res2.status, 303)

  const [orderAfter2] = db.select().from(orders).where(eq(orders.id, order.id)).all()
  assert.equal(orderAfter2?.fulfilmentState, 'handed_over')

  // 3. Advance handed_over -> delivered
  const res3 = await app.request(`/admin/orders/${order.id}/advance`, { method: 'POST' })
  assert.equal(res3.status, 303)
  assert.match(res3.headers.get('Location') ?? '', /tab=previous/)

  const [orderAfter3] = db.select().from(orders).where(eq(orders.id, order.id)).all()
  assert.equal(orderAfter3?.fulfilmentState, 'delivered')

  // Verify audit events
  const events = db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id)).all()
  assert.equal(events.length, 4) // initial + 3 advances
})

test('admin can cancel order from placed or packed and restock inventory', async () => {
  const app = buildAdminApp()
  const itemQty = 3
  const initialStock = 7
  const { stock, order } = createOrderWithItems('placed', itemQty, initialStock)

  const cancelRes = await app.request(`/admin/orders/${order.id}/cancel`, { method: 'POST' })
  assert.equal(cancelRes.status, 303)

  const [updatedOrder] = db.select().from(orders).where(eq(orders.id, order.id)).all()
  assert.equal(updatedOrder?.fulfilmentState, 'cancelled')

  // Verify stock was restored
  const [updatedStock] = db.select().from(productVariants).where(eq(productVariants.id, stock.id)).all()
  assert.equal(updatedStock?.stockQty, initialStock + itemQty)

  // Verify audit event
  const events = db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id)).all()
  const lastEvent = events.at(-1)
  assert.equal(lastEvent?.fromState, 'placed')
  assert.equal(lastEvent?.toState, 'cancelled')
})

test('admin can mark handed_over order as returned (RTO) and restock inventory', async () => {
  const app = buildAdminApp()
  const itemQty = 2
  const initialStock = 4
  const { stock, order } = createOrderWithItems('handed_over', itemQty, initialStock)

  const returnRes = await app.request(`/admin/orders/${order.id}/return`, { method: 'POST' })
  assert.equal(returnRes.status, 303)
  assert.match(returnRes.headers.get('Location') ?? '', /tab=previous/)

  const [updatedOrder] = db.select().from(orders).where(eq(orders.id, order.id)).all()
  assert.equal(updatedOrder?.fulfilmentState, 'returned')

  // Verify stock was restored
  const [updatedStock] = db.select().from(productVariants).where(eq(productVariants.id, stock.id)).all()
  assert.equal(updatedStock?.stockQty, initialStock + itemQty)
})

test('admin stock endpoints allow adding, updating and deleting variants', async () => {
  const app = buildAdminApp()
  const [p] = db
    .insert(products)
    .values({ slug: `variant-test-${Date.now()}`, title: 'Variant Saree', pricePaisa: 80000 })
    .returning()
    .all()
  if (!p) throw new Error('Product not created')

  // 1. Add the large in indigo, with fifteen of them
  const addForm = new FormData()
  addForm.set('stock-0', '15')
  addForm.set('oname-0-0', 'Colour')
  addForm.set('ovalue-0-0', 'Indigo')
  addForm.set('oname-0-1', 'Size')
  addForm.set('ovalue-0-1', 'L')

  const addRes = await app.request(`/admin/products/${p.id}/variants`, {
    method: 'POST',
    body: addForm,
  })
  assert.equal(addRes.status, 303)

  const [lStock] = db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, p.id))
    .all()
  assert.ok(lStock)
  // The label is joined from the values rather than typed.
  assert.equal(lStock.label, 'Indigo / L')
  assert.equal(lStock.stockQty, 15)

  // The axes are what the storefront filters on, so they have to be there.
  const axes = db
    .select()
    .from(variantOptions)
    .where(eq(variantOptions.variantId, lStock.id))
    .all()
  assert.deepEqual(
    axes.map((a) => [a.nameSlug, a.valueSlug]).sort(),
    [['colour', 'indigo'], ['size', 'l']],
  )

  // 2. Restock it to 25
  const updateForm = new FormData()
  updateForm.set('stock', '25')

  const updateRes = await app.request(`/admin/products/${p.id}/variants/${lStock.id}`, {
    method: 'POST',
    body: updateForm,
  })
  assert.equal(updateRes.status, 303)

  const [updatedStock] = db
    .select()
    .from(productVariants)
    .where(eq(productVariants.id, lStock.id))
    .all()
  assert.equal(updatedStock?.stockQty, 25)

  // 3. Delete it
  const deleteRes = await app.request(`/admin/products/${p.id}/variants/${lStock.id}/delete`, {
    method: 'POST',
  })
  assert.equal(deleteRes.status, 303)

  const remaining = db.select().from(productVariants).where(eq(productVariants.id, lStock.id)).all()
  assert.equal(remaining.length, 0)
})

test('admin product detail renders editable UI with customer layout structure', async () => {
  const app = buildAdminApp()
  const [p] = db
    .insert(products)
    .values({
      slug: `detail-ui-test-${Date.now()}`,
      title: 'Silk Khadi Kurta',
      pricePaisa: 350000,
      description: 'Handspun silk and cotton blend.',
    })
    .returning()
    .all()
  if (!p) throw new Error('Product not created')

  db.insert(productVariants)
    .values({ productId: p.id, label: 'Medium', stockQty: 12 })
    .run()

  const res = await app.request(`/admin/products/${p.id}`)
  assert.equal(res.status, 200)
  const html = await res.text()

  // Verifies editable inputs instead of static display
  assert.match(html, /<input[^>]+name="title"[^>]+value="Silk Khadi Kurta"/)
  assert.match(html, /<input[^>]+name="price"[^>]+value="3500\.00"/)
  assert.match(html, /Handspun silk and cotton blend\./)
  assert.match(html, /<input[^>]+name="stock_\d+"[^>]+value="12"/)
  assert.match(html, /id="toggle-add-variant-btn"/)
  assert.match(html, /class="[^"]*gallery-add-card/)
})

test('admin can update product details, variants and add new variant in one submit', async () => {
  const app = buildAdminApp()
  const [p] = db
    .insert(products)
    .values({
      slug: `edit-test-${Date.now()}`,
      title: 'Original Title',
      pricePaisa: 100000,
      description: 'Old description',
    })
    .returning()
    .all()
  if (!p) throw new Error('Product not created')

  const [v1] = db
    .insert(productVariants)
    .values({ productId: p.id, label: 'Small', stockQty: 5 })
    .returning()
    .all()
  if (!v1) throw new Error('Variant not created')

  const form = new FormData()
  form.set('title', 'Updated Silk Kurta')
  form.set('price', '2450.50')
  form.set('description', 'Updated rich texture and handloom weave.')
  form.set(`stock_${v1.id}`, '18')
  form.set('new_oname_0', 'Size')
  form.set('new_ovalue_0', 'Medium')
  form.set('new_stock', '22')

  const res = await app.request(`/admin/products/${p.id}`, {
    method: 'POST',
    body: form,
  })
  assert.equal(res.status, 303)

  // Verify product table was updated
  const [updatedProduct] = db.select().from(products).where(eq(products.id, p.id)).all()
  assert.equal(updatedProduct?.title, 'Updated Silk Kurta')
  assert.equal(updatedProduct?.pricePaisa, 245050)
  assert.equal(updatedProduct?.description, 'Updated rich texture and handloom weave.')

  // Verify variant table was updated and new variant inserted
  const allVariants = db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, p.id))
    .orderBy(asc(productVariants.label))
    .all()
  assert.equal(allVariants.length, 2)
  assert.equal(allVariants[0]?.label, 'Medium')
  assert.equal(allVariants[0]?.stockQty, 22)
  assert.equal(allVariants[1]?.label, 'Small')
  assert.equal(allVariants[1]?.stockQty, 18)

  // Verify variant options inserted for the new variant
  const mediumVariant = allVariants[0]!
  const options = db
    .select()
    .from(variantOptions)
    .where(eq(variantOptions.variantId, mediumVariant.id))
    .all()
  assert.equal(options.length, 1)
  assert.equal(options[0]?.name, 'Size')
  assert.equal(options[0]?.value, 'Medium')
})

