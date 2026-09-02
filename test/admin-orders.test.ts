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

/**
 * The redirect after advancing has to be a place the operator can actually
 * land. It once wasn't: the tab was only appended on the delivered hop, so
 * every earlier hop redirected to `/admin/orders&notice=…` — an `&` where the
 * `?` belonged, which is a path rather than a query, and so a 404. Delivered
 * was the one state that worked, which is exactly what makes it worth
 * following the Location here rather than trusting the 303.
 */
test('every advance hop redirects to a page that exists, notice intact', async () => {
  const app = buildAdminApp()
  const { order } = createOrderWithItems('placed')

  for (const expected of ['Packed', 'Handed over', 'Delivered']) {
    const res = await app.request(`/admin/orders/${order.id}/advance`, { method: 'POST' })
    assert.equal(res.status, 303)

    const location = res.headers.get('Location') ?? ''
    const landed = await app.request(location)
    assert.equal(landed.status, 200, `advancing to ${expected} redirected to a 404: ${location}`)

    // The notice is the operator's confirmation that the click did something,
    // so it has to survive the round trip readably rather than as escaping.
    const body = await landed.text()
    assert.match(body, new RegExp(`<p class="notice">[^<]*advanced to ${expected}</p>`))
  }

  // Delivered leaves the active board, so it lands on the tab holding it now.
  const [delivered] = db.select().from(orders).where(eq(orders.id, order.id)).all()
  assert.equal(delivered?.fulfilmentState, 'delivered')
})

/**
 * The active board is receipts now, and everything an operator can do to an
 * order lives behind the pen rather than in a row of buttons under each card.
 * The status is on the receipt itself, because that is the fact they scan for.
 */
test('an active order renders as a receipt carrying its status, with a pen', async () => {
  const app = buildAdminApp()
  const { order } = createOrderWithItems('packed')

  const html = await (await app.request('/admin/orders?tab=active')).text()

  // The receipt, and the status printed on it.
  assert.match(html, /<article class="receipt"/)
  assert.match(html, /class="receipt-status"[\s\S]*?<span class="chip packed">Packed<\/span>/)
  // Order number, total and the payment line, in receipt form.
  assert.match(html, /class="receipt-no">BL-/)
  assert.match(html, /class="receipt-total"/)

  // The pen, opening this order's dialog.
  assert.match(
    html,
    new RegExp(`class="receipt-pen"[^>]*onclick="document\\.getElementById\\(&#39;dialog-${order.id}&#39;\\)\\.showModal\\(\\)"`),
  )
  // It has an accessible name: the icon is an aria-hidden svg, so without this
  // the only control on the receipt is a button announced as nothing at all.
  assert.match(html, /class="receipt-pen" aria-label="Order BL-\d+: details and actions"/)

  // And the button it replaced is gone.
  assert.doesNotMatch(html, /History &amp; Details|History & Details/)
})

/**
 * The actions moved into the dialog. All three have to be there — and only the
 * ones the state machine actually permits, so the dialog cannot offer a
 * transition the POST will refuse.
 */
test('the pen dialog holds the status actions the order actually allows', async () => {
  const app = buildAdminApp()
  const placed = createOrderWithItems('placed').order
  const handed = createOrderWithItems('handed_over').order
  const done = createOrderWithItems('delivered').order

  const active = await (await app.request('/admin/orders?tab=active')).text()

  // Placed: can be packed, can be cancelled, cannot be marked returned.
  const placedDialog = dialogFor(active, placed.id)
  assert.match(placedDialog, /Mark packed/)
  assert.match(placedDialog, /Cancel order/)
  assert.doesNotMatch(placedDialog, /Mark returned/)
  assert.match(placedDialog, new RegExp(`action="/admin/orders/${placed.id}/advance"`))

  // Handed over: can be delivered or marked returned, cannot be cancelled.
  const handedDialog = dialogFor(active, handed.id)
  assert.match(handedDialog, /Mark delivered/)
  assert.match(handedDialog, /Mark returned \(RTO\)/)
  assert.doesNotMatch(handedDialog, /Cancel order/)

  // Delivered is terminal: the section says so rather than standing empty.
  const previous = await (await app.request('/admin/orders?tab=previous')).text()
  const doneDialog = dialogFor(previous, done.id)
  assert.doesNotMatch(doneDialog, /Mark packed|Cancel order|Mark returned/)
  assert.match(doneDialog, /is where this order ends/)

  // The details the old History button used to show are all in there too.
  assert.match(placedDialog, /Fulfilment history/)
  assert.match(placedDialog, /Ayesha Rahman/)
  assert.match(placedDialog, /Dhanmondi/)
})

/** The dialog markup for one order, so the assertions above cannot match
 *  another order's dialog further down the same page. */
function dialogFor(html: string, orderId: number): string {
  const start = html.indexOf(`<dialog id="dialog-${orderId}"`)
  assert.notEqual(start, -1, `no dialog for order ${orderId}`)
  const end = html.indexOf('</dialog>', start)
  return html.slice(start, end)
}

/**
 * The status tabs filter on the server, so the filter survives a reload and
 * survives an order being advanced out from under the page — which is exactly
 * what happens, since advancing redirects back here.
 */
test('status tabs filter the board, and count every order in each state', async () => {
  const app = buildAdminApp()
  // Earlier tests in this file leave their own active orders behind, so every
  // assertion here is about *these* orders rather than about a total.
  const firstPlaced = createOrderWithItems('placed').order
  const packed = createOrderWithItems('packed').order
  const handed = createOrderWithItems('handed_over').order

  const has = (html: string, id: number) => html.includes(`dialog-${id}`)

  const all = await (await app.request('/admin/orders?tab=active')).text()
  assert.ok(has(all, firstPlaced.id) && has(all, packed.id) && has(all, handed.id))
  assert.match(all, /class="status-tab active"[^>]*aria-current="true"[^>]*>All/)

  const onlyPacked = await (await app.request('/admin/orders?tab=active&status=packed')).text()
  assert.ok(has(onlyPacked, packed.id), 'the packed order is on the packed board')
  assert.ok(!has(onlyPacked, firstPlaced.id), 'the placed one is not')
  assert.ok(!has(onlyPacked, handed.id), 'nor the handed-over one')
  assert.match(onlyPacked, /class="status-tab active"[^>]*aria-current="true"[^>]*>Packed/)

  // The counts on the tabs are of every order in that state, not of the rows
  // left after filtering — otherwise each tab would only ever show its own
  // number. Taken from the database so this does not depend on what earlier
  // tests left lying around.
  const placedTotal = db
    .select()
    .from(orders)
    .where(eq(orders.fulfilmentState, 'placed'))
    .all().length
  assert.match(onlyPacked, new RegExp(`Placed<span class="status-tab-n">${placedTotal}</span>`))

  // A status belonging to the other board is ignored rather than obeyed, which
  // would fetch nothing and read as an empty active board.
  const stray = await (await app.request('/admin/orders?tab=active&status=delivered')).text()
  assert.ok(has(stray, firstPlaced.id) && has(stray, packed.id) && has(stray, handed.id))
  assert.match(stray, /class="status-tab active"[^>]*aria-current="true"[^>]*>All/)

  // Nonsense is ignored the same way, rather than reaching a query.
  const junk = await (await app.request('/admin/orders?tab=active&status=../etc/passwd')).text()
  assert.ok(has(junk, firstPlaced.id) && has(junk, packed.id))
})

test('the previous board filters by status through the same tabs', async () => {
  const app = buildAdminApp()
  createOrderWithItems('delivered')
  createOrderWithItems('cancelled')

  const all = await (await app.request('/admin/orders?tab=previous')).text()
  assert.match(all, /<span class="chip delivered">/)
  assert.match(all, /<span class="chip cancelled">/)
  // The select this replaced is gone, so there is one control for one filter.
  assert.doesNotMatch(all, /prev-status-filter/)

  const onlyCancelled = await (
    await app.request('/admin/orders?tab=previous&status=cancelled')
  ).text()
  assert.doesNotMatch(onlyCancelled, /<span class="chip delivered">/)
  assert.match(onlyCancelled, /<span class="chip cancelled">/)
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

