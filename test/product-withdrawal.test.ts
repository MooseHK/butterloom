// First, and it has to stay first: this picks the database before
// src/db/client.ts opens one. See the file for why.
import './support/tempDb.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { adminProducts } from '../src/admin/products.js'
import { db } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import { products, productVariants } from '../src/db/schema.js'
import { cartRoutes } from '../src/storefront/cart.js'
import { storefront } from '../src/storefront/catalogue.js'
import { listCategories } from '../src/storefront/queries.js'
import { categories } from '../src/db/schema.js'

runMigrations()

/**
 * Taking a product off the storefront has to hold on every path a customer can
 * reach it by, not just the listing an operator happens to check afterwards.
 * A product that has left the shop but is still turnable up by search, still
 * sitting in someone's recently-viewed rail, or still POSTable to /cart/add is
 * a product the shop will still take money for.
 *
 * Note this is a different state from the `category_id is null` one the schema
 * calls "unshelved", which stays on the storefront under All items. Both exist
 * and the admin prints both, so there is a test below holding them apart.
 */
function buildApp() {
  const app = new Hono()
  app.route('/cart', cartRoutes)
  app.route('/admin/products', adminProducts)
  app.route('/', storefront)
  return app
}

let seq = 0
function seedProduct(title: string, stock = 5) {
  seq += 1
  const [product] = db
    .insert(products)
    .values({ slug: `withdraw-${seq}-${Date.now()}`, title, pricePaisa: 50000 })
    .returning()
    .all()
  if (!product) throw new Error('Product not created')
  const [variant] = db
    .insert(productVariants)
    .values({ productId: product.id, label: 'Standard', stockQty: stock })
    .returning()
    .all()
  if (!variant) throw new Error('Variant not created')
  return { product, variant }
}

async function setStorefront(app: Hono, productId: number, on: 'yes' | 'no') {
  const form = new FormData()
  form.set('on_storefront', on)
  const res = await app.request(`/admin/products/${productId}/storefront`, {
    method: 'POST',
    body: form,
  })
  assert.equal(res.status, 303)
  return res
}

test('a withdrawn product is gone from every storefront path, and comes back intact', async () => {
  const app = buildApp()
  const { product, variant } = seedProduct('Withdrawable Indigo Saree')

  // On the storefront to begin with, so the assertions below are about the
  // withdrawal rather than about a product that was never listed.
  assert.equal((await app.request(`/p/${product.slug}`)).status, 200)
  assert.match(await (await app.request('/shop')).text(), /Withdrawable Indigo Saree/)

  await setStorefront(app, product.id, 'no')

  // Its own URL. A 404 rather than a page that renders without a buy button:
  // the address should stop resolving, or the link keeps circulating.
  assert.equal((await app.request(`/p/${product.slug}`)).status, 404)

  // Every listing.
  assert.doesNotMatch(await (await app.request('/shop')).text(), /Withdrawable Indigo Saree/)
  assert.doesNotMatch(await (await app.request('/')).text(), /Withdrawable Indigo Saree/)

  // Search. Asserted on the card's own attribute, not on the title: /search
  // echoes the term back into its heading and its hidden field, so the title
  // string appears in the page whether or not anything matched.
  const searched = await (await app.request('/search?q=Withdrawable+Indigo')).text()
  assert.doesNotMatch(searched, new RegExp(`data-slug="${product.slug}"`))
  assert.match(searched, /Nothing matches/)

  // The visitor's own recently-viewed list, which names products by slug and
  // so would otherwise resurrect one the shop has taken down.
  const rail = await (await app.request(`/recently-viewed?p=${product.slug}`)).text()
  assert.doesNotMatch(rail, new RegExp(`data-slug="${product.slug}"`))

  // And it cannot be bought by posting the form off a page the CDN is still
  // serving from before the withdrawal.
  const form = new FormData()
  form.set('product_id', String(product.id))
  form.set('variant_id', String(variant.id))
  const add = await app.request('/cart/add', {
    method: 'POST',
    body: form,
    headers: { Accept: 'application/json' },
  })
  assert.equal(add.status, 404)
  assert.deepEqual(await add.json(), {
    ok: false,
    error: 'Sorry — this piece is no longer available.',
  })

  // Nothing was deleted: the row, its stock and its variant are all still there.
  const [stillThere] = db.select().from(products).where(eq(products.id, product.id)).all()
  assert.equal(stillThere?.title, 'Withdrawable Indigo Saree')
  const [stockRow] = db
    .select()
    .from(productVariants)
    .where(eq(productVariants.id, variant.id))
    .all()
  assert.equal(stockRow?.stockQty, 5)

  // Putting it back needs no second decision.
  await setStorefront(app, product.id, 'yes')
  assert.equal((await app.request(`/p/${product.slug}`)).status, 200)
  assert.match(await (await app.request('/shop')).text(), /Withdrawable Indigo Saree/)
})

/**
 * The state is named in the form, not toggled from whatever the row happens to
 * hold. A double submit — a fat thumb, a back button, two operators on two
 * phones — has to land on the state the button said, not flip past it.
 */
test('withdrawing is idempotent, and so is restoring', async () => {
  const app = buildApp()
  const { product } = seedProduct('Twice Withdrawn Kurta')

  await setStorefront(app, product.id, 'no')
  const [first] = db.select().from(products).where(eq(products.id, product.id)).all()
  assert.notEqual(first?.hiddenAt, null)

  await setStorefront(app, product.id, 'no')
  const [second] = db.select().from(products).where(eq(products.id, product.id)).all()
  assert.notEqual(second?.hiddenAt, null, 'a second withdraw must not put it back')
  assert.equal((await app.request(`/p/${product.slug}`)).status, 404)

  await setStorefront(app, product.id, 'yes')
  await setStorefront(app, product.id, 'yes')
  const [restored] = db.select().from(products).where(eq(products.id, product.id)).all()
  assert.equal(restored?.hiddenAt, null)
  assert.equal((await app.request(`/p/${product.slug}`)).status, 200)
})

/**
 * The two states the word "shelf" could mean, held apart. `category_id is
 * null` is what the schema calls unshelved and it stays for sale; `hidden_at`
 * set is off the storefront entirely. Collapsing them would either put
 * withdrawn stock back on sale or hide every product an operator has not
 * categorised yet — and the second one is the default for a new product.
 */
test('unshelved (no category) still sells; withdrawn does not', async () => {
  const app = buildApp()
  const { product } = seedProduct('Unshelved But Buyable Saree')

  // Seeded with no category at all, which is the state a new product starts in.
  const [row] = db.select().from(products).where(eq(products.id, product.id)).all()
  assert.equal(row?.categoryId, null)
  assert.equal(row?.hiddenAt, null)

  assert.equal((await app.request(`/p/${product.slug}`)).status, 200)
  assert.match(await (await app.request('/shop')).text(), /Unshelved But Buyable Saree/)
})

/**
 * The storefront draws a shelf tile from this count, so a shelf holding
 * nothing but withdrawn products must count zero — otherwise the tile is a
 * link to an empty page. The admin's own screen asks for the other number.
 */
test('shelf counts exclude withdrawn products, unless the admin asks for them', async () => {
  const app = buildApp()
  const [shelf] = db
    .insert(categories)
    .values({ slug: `counted-${Date.now()}`, name: 'Counted Shelf' })
    .returning()
    .all()
  if (!shelf) throw new Error('Category not created')

  const { product } = seedProduct('Only Thing On The Shelf')
  db.update(products).set({ categoryId: shelf.id }).where(eq(products.id, product.id)).run()

  const before = listCategories().find((r) => r.category.id === shelf.id)
  assert.equal(before?.productCount, 1)

  await setStorefront(app, product.id, 'no')

  const storefrontView = listCategories().find((r) => r.category.id === shelf.id)
  assert.equal(storefrontView?.productCount, 0, 'the tile would lead to an empty page')

  const adminView = listCategories({ includeHidden: true }).find((r) => r.category.id === shelf.id)
  assert.equal(adminView?.productCount, 1, 'the operator still has one product on this shelf')
})
