// First, and it has to stay first: this picks the database before
// src/db/client.ts opens one. See the file for why.
import './support/tempDb.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import { categories, products, productVariants } from '../src/db/schema.js'
import { edgeCacheable } from '../src/storefront/cache.js'
import { storefront } from '../src/storefront/catalogue.js'
import { findProductBySlug } from '../src/storefront/queries.js'

runMigrations()

/** Mounted the same way src/server.tsx mounts it, edgeCacheable included. */
function buildApp() {
  const app = new Hono()
  app.use('*', edgeCacheable)
  app.route('/', storefront)
  return app
}

let seq = 0
function seedProduct(title: string, categoryId: number | null = null) {
  seq += 1
  const [product] = db
    .insert(products)
    .values({ slug: `crumb-${seq}-${Date.now()}`, title, pricePaisa: 450000, categoryId })
    .returning()
    .all()
  if (!product) throw new Error('Product not created')
  db.insert(productVariants)
    .values({ productId: product.id, label: 'Standard', stockQty: 3 })
    .run()
  return product
}

function seedShelf(name: string, slug: string) {
  const [category] = db.insert(categories).values({ slug, name }).returning().all()
  if (!category) throw new Error('Category not created')
  return category
}

function crumbsOf(html: string): string {
  const m = /<nav class="crumbs"[^>]*>([\s\S]*?)<\/nav>/.exec(html)
  assert.ok(m, 'no breadcrumb on the page')
  return m[1] ?? ''
}

/**
 * Somebody who lands on a product page from a search and likes what they see
 * wants the rest of that shelf. Before this the only way up was the whole
 * collection, which on a catalogue of any size is not the same offer.
 */
test('a product page links to the shelf it stands on', async () => {
  const app = buildApp()
  const shelf = seedShelf('Sarees', `sarees-${Date.now()}`)
  const product = seedProduct('Indigo Jamdani Saree', shelf.id)

  const html = await (await app.request(`/p/${product.slug}`)).text()
  const crumbs = crumbsOf(html)

  assert.match(crumbs, /href="\/">The collection<\/a>/)
  assert.match(crumbs, new RegExp(`href="/c/${shelf.slug}">Sarees</a>`))

  // The link is not decoration: it resolves, and the product is on the page
  // it leads to.
  const shelfPage = await app.request(`/c/${shelf.slug}`)
  assert.equal(shelfPage.status, 200)
  assert.match(await shelfPage.text(), /Indigo Jamdani Saree/)
})

/**
 * Unshelved is the state every product starts in, so this is not an edge case
 * — it is the default. There is no page for "no shelf", so the crumb is
 * omitted rather than rendered as a link to nowhere.
 */
test('an unshelved product shows the collection crumb and no shelf crumb', async () => {
  const app = buildApp()
  const product = seedProduct('Unshelved Cotton Kurta', null)

  const crumbs = crumbsOf(await (await app.request(`/p/${product.slug}`)).text())
  assert.match(crumbs, /href="\/">The collection<\/a>/)
  assert.doesNotMatch(crumbs, /href="\/c\//)
})

/**
 * Deleting a shelf sets its products' category_id to null rather than deleting
 * them (schema.ts: "deleting a shelf must not delete what was standing on
 * it"), so a product can outlive its category. The page has to render, not
 * throw, and must not print a crumb to the shelf that has gone.
 */
test('a product whose shelf was deleted still renders, without a shelf crumb', async () => {
  const app = buildApp()
  const shelf = seedShelf('Doomed Shelf', `doomed-${Date.now()}`)
  const product = seedProduct('Outlived Its Shelf Saree', shelf.id)

  db.delete(categories).where(eq(categories.id, shelf.id)).run()

  const res = await app.request(`/p/${product.slug}`)
  assert.equal(res.status, 200)
  const crumbs = crumbsOf(await res.text())
  assert.doesNotMatch(crumbs, /href="\/c\//)

  // The query agrees: the shelf is gone, so there is nothing to link to.
  assert.equal(findProductBySlug(product.slug)?.category, null)
})

/**
 * ADR-0007 makes this page edge-cached, so the crumb has to be a property of
 * the product rather than of the visitor. It is — but this holds the promise
 * that adding it did not make the page uncacheable.
 */
test('the shelf crumb does not cost the product page its cacheability', async () => {
  const app = buildApp()
  const shelf = seedShelf('Cacheable Shelf', `cacheable-${Date.now()}`)
  const product = seedProduct('Cacheable Saree', shelf.id)

  const res = await app.request(`/p/${product.slug}`)
  assert.equal(res.status, 200)
  const cacheControl = res.headers.get('Cache-Control') ?? ''
  assert.doesNotMatch(cacheControl, /no-store|private/)

  // Two requests, byte-identical: nothing per-visitor crept into the crumb.
  const first = await (await app.request(`/p/${product.slug}`)).text()
  const second = await (await app.request(`/p/${product.slug}`)).text()
  assert.equal(first, second)
})
