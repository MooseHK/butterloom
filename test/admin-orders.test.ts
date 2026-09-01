import assert from 'node:assert/strict'
import { test } from 'node:test'
import { and, eq } from 'drizzle-orm'
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
  productStock,
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
    .insert(productStock)
    .values({ productId: p.id, variantLabel: 'M', quantity: initialStock })
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
  const [updatedStock] = db.select().from(productStock).where(eq(productStock.id, stock.id)).all()
  assert.equal(updatedStock?.quantity, initialStock + itemQty)

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
  const [updatedStock] = db.select().from(productStock).where(eq(productStock.id, stock.id)).all()
  assert.equal(updatedStock?.quantity, initialStock + itemQty)
})

test('admin stock endpoints allow adding, updating and deleting variants', async () => {
  const app = buildAdminApp()
  const [p] = db
    .insert(products)
    .values({ slug: `variant-test-${Date.now()}`, title: 'Variant Saree', pricePaisa: 80000 })
    .returning()
    .all()
  if (!p) throw new Error('Product not created')

  // 1. Add variant "L" with quantity 15
  const addForm = new FormData()
  addForm.set('variantLabel', 'L')
  addForm.set('quantity', '15')

  const addRes = await app.request(`/admin/products/${p.id}/stock`, {
    method: 'POST',
    body: addForm,
  })
  assert.equal(addRes.status, 303)

  const [lStock] = db
    .select()
    .from(productStock)
    .where(eq(productStock.productId, p.id))
    .all()
  assert.ok(lStock)
  assert.equal(lStock.variantLabel, 'L')
  assert.equal(lStock.quantity, 15)

  // 2. Update stock of variant "L" to 25
  const updateForm = new FormData()
  updateForm.set('quantity', '25')

  const updateRes = await app.request(`/admin/products/${p.id}/stock/${lStock.id}/update`, {
    method: 'POST',
    body: updateForm,
  })
  assert.equal(updateRes.status, 303)

  const [updatedStock] = db
    .select()
    .from(productStock)
    .where(eq(productStock.id, lStock.id))
    .all()
  assert.equal(updatedStock?.quantity, 25)

  // 3. Delete variant "L"
  const deleteRes = await app.request(`/admin/products/${p.id}/stock/${lStock.id}/delete`, {
    method: 'POST',
  })
  assert.equal(deleteRes.status, 303)

  const remaining = db.select().from(productStock).where(eq(productStock.id, lStock.id)).all()
  assert.equal(remaining.length, 0)
})
