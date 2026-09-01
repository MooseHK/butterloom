// First, and it has to stay first: this picks the database before
// src/db/client.ts opens one. See the file for why.
import './support/tempDb.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Hono } from 'hono'
import { db } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import { products, productVariants, variantOptions } from '../src/db/schema.js'
import { edgeCacheable } from '../src/storefront/cache.js'
import { storefront } from '../src/storefront/catalogue.js'
import { facetsFor, listProducts } from '../src/storefront/queries.js'

runMigrations()

/** Mounted the same way src/server.tsx mounts it, edgeCacheable included. */
function buildTestApp() {
  const app = new Hono()
  app.use('*', edgeCacheable)
  app.route('/', storefront)
  return app
}

let n = 0
function seedProduct(title: string, description = '', pricePaisa = 100000) {
  const slug = `search-${Date.now()}-${n++}`
  const [p] = db.insert(products).values({ slug, title, description, pricePaisa }).returning().all()
  if (!p) throw new Error('Product not created')
  return p
}

function seedVariant(
  productId: number,
  label: string,
  axes: { name: string; nameSlug: string; value: string; valueSlug: string }[],
) {
  const [v] = db
    .insert(productVariants)
    .values({ productId, label, stockQty: 5 })
    .returning()
    .all()
  if (!v) throw new Error('Variant not created')
  axes.forEach((axis, i) => {
    db.insert(variantOptions)
      .values({ variantId: v.id, position: i, ...axis })
      .run()
  })
  return v
}

/**
 * The one property this whole feature stands or falls on: every term a
 * shopper types has to be present, somewhere in title or description, before
 * a row counts as a match — a title with one of the two words is not a
 * result, it is a coincidence. Word order does not matter, because a search
 * box is not a phrase search.
 */
test('multi-term search requires every term, matching title or description, in any order', () => {
  const both = seedProduct('Indigo saree with zari border')
  const onlyIndigo = seedProduct('Indigo kurti, plain')
  const onlySaree = seedProduct('Saree in ecru cotton')
  const neither = seedProduct('Wool shawl')
  // The second term lives in the description, not the title — a match still
  // has to count, because a shopper does not know which field carries which
  // word before they read the page.
  const splitAcrossFields = seedProduct('Casual wear', 'Made from soft indigo denim')

  const forward = listProducts({ q: 'indigo saree' }).listings.map((l) => l.product.id)
  const reversed = listProducts({ q: 'saree indigo' }).listings.map((l) => l.product.id)

  assert.deepEqual(new Set(forward), new Set([both.id]))
  assert.deepEqual(new Set(forward), new Set(reversed))
  assert.ok(!forward.includes(onlyIndigo.id))
  assert.ok(!forward.includes(onlySaree.id))
  assert.ok(!forward.includes(neither.id))
  void splitAcrossFields

  const denim = listProducts({ q: 'indigo denim' }).listings.map((l) => l.product.id)
  assert.deepEqual(denim, [splitAcrossFields.id])
})

/**
 * The important one: `%` and `_` are LIKE wildcards, not ordinary characters,
 * so a term containing either has to be escaped before it reaches the query.
 * Get this wrong and a shopper who types a stray `%` is handed the entire
 * catalogue instead of nothing — a silent, maximally wrong answer that no
 * smoke test would ever catch.
 */
test('a term containing % or _ matches literally, never the whole catalogue', () => {
  const withPercent = seedProduct('Get 20% off today')
  const withoutPercent = seedProduct('Plain cotton scarf')
  const withoutPercent2 = seedProduct('Fifty percent scarf')

  const percentResults = listProducts({ q: '%' }).listings.map((l) => l.product.id)
  assert.deepEqual(percentResults, [withPercent.id])
  assert.ok(!percentResults.includes(withoutPercent.id))
  assert.ok(!percentResults.includes(withoutPercent2.id))

  const withUnderscore = seedProduct('limited_edition scarf')
  const withoutUnderscore = seedProduct('limited edition scarf')

  const underscoreResults = listProducts({ q: '_' }).listings.map((l) => l.product.id)
  assert.deepEqual(underscoreResults, [withUnderscore.id])
  assert.ok(!underscoreResults.includes(withoutUnderscore.id))
})

test('search is case-insensitive for ASCII', () => {
  const shouted = seedProduct('INDIGO SAREE, all caps')
  const lower = seedProduct('quiet indigo saree, all lower')

  // A lower-case query finds the upper-case title, and an upper-case query
  // finds the lower-case one.
  const lowerQuery = listProducts({ q: 'indigo saree' }).listings.map((l) => l.product.id)
  assert.ok(lowerQuery.includes(shouted.id))
  assert.ok(lowerQuery.includes(lower.id))

  const upperQuery = listProducts({ q: 'INDIGO SAREE' }).listings.map((l) => l.product.id)
  assert.ok(upperQuery.includes(shouted.id))
  assert.ok(upperQuery.includes(lower.id))
})

/**
 * Facets are "scope, not selection" per CONTEXT.md — the axes a search result
 * page offers have to be the ones present in those results, not the whole
 * catalogue. Offering a colour that exists only outside the search would
 * hand a shopper a filter that leads straight to an empty page.
 */
test('facets on a search result page are scoped to the matching products, not the whole catalogue', () => {
  const matching = seedProduct('Indigo saree for facets test')
  seedVariant(matching.id, 'Indigo / M', [
    { name: 'Colour', nameSlug: 'colour', value: 'Indigo', valueSlug: 'indigo' },
    { name: 'Size', nameSlug: 'size', value: 'M', valueSlug: 'm' },
  ])

  const other = seedProduct('Ecru kurti, unrelated to the search term')
  seedVariant(other.id, 'Ecru / L', [
    { name: 'Colour', nameSlug: 'colour', value: 'Ecru', valueSlug: 'ecru' },
    { name: 'Size', nameSlug: 'size', value: 'L', valueSlug: 'l' },
  ])

  const facets = facetsFor(null, { q: 'saree for facets test' })
  const colour = facets.find((f) => f.nameSlug === 'colour')
  assert.ok(colour)
  assert.deepEqual(
    colour.values.map((v) => v.valueSlug),
    ['indigo'],
  )
  const size = facets.find((f) => f.nameSlug === 'size')
  assert.deepEqual(size?.values.map((v) => v.valueSlug), ['m'])
})

test('GET /search renders matching product cards, and a non-matching query says so', async () => {
  const app = buildTestApp()
  const findable = seedProduct('Unique Muslin Jamdani Piece')

  const res = await app.request('/search?q=Muslin+Jamdani')
  assert.equal(res.status, 200)
  const html = await res.text()
  assert.match(html, /Unique Muslin Jamdani Piece/)
  assert.match(html, new RegExp(`data-slug="${findable.slug}"`))
  assert.match(html, /<li class="card"/)
})

test('a query matching nothing renders the "Nothing matches" copy with a link to /shop', async () => {
  const app = buildTestApp()
  const res = await app.request('/search?q=zzznosuchproductzzz')
  assert.equal(res.status, 200)
  const html = await res.text()
  assert.match(html, /Nothing matches “zzznosuchproductzzz”/)
  assert.match(html, /href="\/shop"/)
  assert.match(html, /All items/)
})

/**
 * `?q=++indigo++saree++` is what a hand-edited or copy-pasted search box
 * looks like. It has to land on the same collapsed URL every time — one
 * cache entry, not one per way of padding the same two words — and the
 * canonical target it redirects to must not redirect again, or a shopper's
 * back button and the CDN both loop.
 */
test('a padded query 301-redirects to its canonical collapsed form, which does not redirect again', async () => {
  const app = buildTestApp()
  const res = await app.request('/search?q=++indigo++saree++')
  assert.equal(res.status, 301)
  const location = res.headers.get('Location') ?? ''
  assert.equal(location, '/search?q=indigo+saree')

  const again = await app.request(location)
  assert.equal(again.status, 200)
})

test('a search results page carries noindex,follow; /shop does not', async () => {
  const app = buildTestApp()
  seedProduct('Robots Meta Test Saree')

  const searchRes = await app.request('/search?q=Robots+Meta+Test')
  const searchHtml = await searchRes.text()
  assert.match(searchHtml, /<meta name="robots" content="noindex,follow"\/>/)

  const shopRes = await app.request('/shop')
  const shopHtml = await shopRes.text()
  assert.doesNotMatch(shopHtml, /name="robots"/)
})

/**
 * Applying a filter is a GET on the same `/search` action, so `q` has to
 * travel with it as a hidden field — otherwise ticking one colour checkbox
 * silently throws the search itself away.
 */
test('the filter form carries the current search as a hidden field', async () => {
  const app = buildTestApp()
  const product = seedProduct('Hidden Field Saree Test')
  seedVariant(product.id, 'Indigo', [
    { name: 'Colour', nameSlug: 'colour', value: 'Indigo', valueSlug: 'indigo' },
  ])

  const res = await app.request('/search?q=Hidden+Field+Saree')
  const html = await res.text()
  assert.match(html, /<input type="hidden" name="q" value="Hidden Field Saree"\/>/)
})
