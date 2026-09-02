// First, and it has to stay first: this picks the database before
// src/db/client.ts opens one. See the file for why.
import './support/tempDb.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Hono } from 'hono'
import { adminOrders } from '../src/admin/orders.js'
import { adminProducts } from '../src/admin/products.js'
import { db } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import type { FulfilmentState } from '../src/db/schema.js'
import { categories, orderItems, orders, products, productVariants } from '../src/db/schema.js'

runMigrations()

/**
 * The admin's search runs in the browser, over rows the page already holds —
 * the admin is behind auth and never edge-cached, so there is no URL to protect
 * and no round trip worth spending. That makes the whole feature two things the
 * server is responsible for: a `data-search` attribute carrying everything the
 * box is meant to match, and a script that is actually valid JavaScript.
 *
 * Both fail silently in a browser. A missing field in the haystack is a search
 * that quietly never finds a customer; a mis-escaped regex is a filter that
 * throws on the first keystroke and leaves the operator typing into a box that
 * does nothing. Neither shows up in a type check, so they are asserted here.
 */

function buildAdminApp() {
  const app = new Hono()
  app.route('/admin/orders', adminOrders)
  app.route('/admin/products', adminProducts)
  return app
}

let n = 0
function seedProduct(title: string, categoryName: string | null) {
  let categoryId: number | null = null
  if (categoryName !== null) {
    const [cat] = db
      .insert(categories)
      .values({ slug: `shelf-${n}`, name: categoryName })
      .returning()
      .all()
    categoryId = cat?.id ?? null
  }
  const [p] = db
    .insert(products)
    .values({ slug: `admin-search-${n++}`, title, pricePaisa: 250000, categoryId })
    .returning()
    .all()
  if (!p) throw new Error('Product not created')
  db.insert(productVariants).values({ productId: p.id, label: 'M', stockQty: 4 }).run()
  return p
}

function seedOrder(state: FulfilmentState, customerName: string, productTitle: string) {
  const [o] = db
    .insert(orders)
    .values({
      customerName,
      customerPhone: '01711000000',
      deliveryAddress: 'Dhaka',
      totalPaisa: 250000,
      fulfilmentState: state,
    })
    .returning()
    .all()
  if (!o) throw new Error('Order not created')
  db.insert(orderItems)
    .values({ orderId: o.id, productTitle, variantLabel: 'M', pricePaisa: 250000, quantity: 1 })
    .run()
  return o
}

/** Every `data-search` value on a page, which is what the box matches against. */
function haystacks(html: string): string[] {
  return [...html.matchAll(/data-search="([^"]*)"/g)].map((m) => m[1] ?? '')
}

/**
 * The filter functions, pulled back out of the rendered page and compiled.
 * `new Function` throws on a syntax error, which is the whole point: a script
 * assembled inside a template literal is one stray backslash away from being
 * inert, and nothing else in the build would say so.
 */
function filterScripts(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1] ?? '')
    .filter((body) => /function filter/.test(body))
}

test('a product row carries its title, slug and shelf to the search box', async () => {
  const app = buildAdminApp()
  seedProduct('Indigo Jamdani Saree', 'Sarees')
  const html = await (await app.request('/admin/products')).text()

  const row = haystacks(html).find((h) => h.includes('indigo jamdani saree'))
  assert.ok(row, 'the product row should carry a data-search attribute')
  assert.match(row, /sarees/, 'searching a category name must find the products on that shelf')
  assert.ok(row === row.toLowerCase(), 'the haystack is lowercased once here, not per keystroke')
})

test('an unshelved product is findable by the word the row prints', async () => {
  // The cell says "Unshelved", so the box has to agree with it — otherwise
  // typing what is on screen is the one search guaranteed to return nothing.
  const app = buildAdminApp()
  seedProduct('Ecru Cotton Kurta', null)
  const html = await (await app.request('/admin/products')).text()

  const row = haystacks(html).find((h) => h.includes('ecru cotton kurta'))
  assert.ok(row)
  assert.match(row, /unshelved/)
})

test('an active order is findable by customer and by what is in the parcel', async () => {
  const app = buildAdminApp()
  seedOrder('placed', 'Rahim Uddin', 'Indigo Jamdani Saree')
  const html = await (await app.request('/admin/orders?tab=active')).text()

  const card = haystacks(html).find((h) => h.includes('rahim uddin'))
  assert.ok(card, 'the order card should carry a data-search attribute')
  // The product title is the snapshot on the order item, not a join to the
  // catalogue: a product renamed after despatch must still be findable by what
  // the customer was told they were buying.
  assert.match(card, /indigo jamdani saree/)
  assert.match(card, /01711000000/)
})

test('a previous order is searchable on product names too, not just id and phone', async () => {
  // The box predates this and only reached id, customer and phone. An operator
  // chasing "who ordered the ecru kurta" got nothing back.
  const app = buildAdminApp()
  seedOrder('delivered', 'Karim Ahmed', 'Ecru Cotton Kurta')
  const html = await (await app.request('/admin/orders?tab=previous')).text()

  const row = haystacks(html).find((h) => h.includes('karim ahmed'))
  assert.ok(row)
  assert.match(row, /ecru cotton kurta/)
  assert.match(html, /data-status="delivered"/, 'the status filter still has its own attribute')
})

test('every filter script the admin ships is valid JavaScript', async () => {
  const app = buildAdminApp()
  seedProduct('Script Check Saree', 'Sarees')
  seedOrder('placed', 'Script Check', 'Script Check Saree')
  seedOrder('delivered', 'Script Check', 'Script Check Saree')

  for (const path of ['/admin/products', '/admin/orders?tab=active', '/admin/orders?tab=previous']) {
    const scripts = filterScripts(await (await app.request(path)).text())
    assert.equal(scripts.length, 1, `${path} should ship exactly one filter script`)
    assert.doesNotThrow(() => new Function(scripts[0] ?? ''), `${path} filter script must parse`)
  }
})

test('the term splitter survives the template literal it is written inside', async () => {
  // `\s` inside a template literal resolves to a bare `s` unless it is escaped
  // twice, which turns "split on whitespace" into "split on the letter s" — a
  // filter that still runs, still looks fine, and matches the wrong rows.
  const app = buildAdminApp()
  seedProduct('Split Check Saree', 'Sarees')
  seedOrder('delivered', 'Split Check', 'Split Check Saree')

  for (const path of ['/admin/products', '/admin/orders?tab=previous']) {
    const [script] = filterScripts(await (await app.request(path)).text())
    const expression = script?.match(/q\.split\([^)]*\)/)?.[0]
    assert.ok(expression, `${path} should split the query into terms`)
    const split = new Function('q', `return ${expression}`) as (q: string) => string[]
    assert.deepEqual(split('indigo saree'), ['indigo', 'saree'], `${path} must split on whitespace`)
  }
})
