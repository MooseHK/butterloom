// First, and it has to stay first: this picks the database before
// src/db/client.ts opens one. See the file for why.
import './support/tempDb.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Hono } from 'hono'
import { db } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import { products } from '../src/db/schema.js'
import { edgeCacheable } from '../src/storefront/cache.js'
import { storefront } from '../src/storefront/catalogue.js'
import { listProductsBySlugs } from '../src/storefront/queries.js'

runMigrations()

function seedProduct(slug: string, title: string, pricePaisa: number) {
  const [p] = db.insert(products).values({ slug, title, pricePaisa }).returning().all()
  if (!p) throw new Error('Product not created')
  return p
}

/** Mounted the same way src/server.tsx mounts it, edgeCacheable included. */
function buildTestApp() {
  const app = new Hono()
  app.use('*', edgeCacheable)
  app.route('/', storefront)
  return app
}

test('listProductsBySlugs orders by the input list, drops unknown slugs, dedupes', () => {
  const a = seedProduct(`a-${Date.now()}`, 'A Kurti', 100000)
  const b = seedProduct(`b-${Date.now()}`, 'B Saree', 200000)

  const result = listProductsBySlugs([b.slug, 'no-such-product', a.slug, b.slug])
  assert.deepEqual(
    result.map((r) => r.product.slug),
    [b.slug, a.slug],
  )
})

test('listProductsBySlugs touches nothing on an empty input', () => {
  assert.deepEqual(listProductsBySlugs([]), [])
})

test('GET /recently-viewed renders a card per known slug, carrying data-slug', async () => {
  const app = buildTestApp()
  const a = seedProduct(`shawl-${Date.now()}`, 'Wool Shawl', 150000)
  const b = seedProduct(`saree-${Date.now()}`, 'Silk Saree', 350000)

  const res = await app.request(`/recently-viewed?p=${a.slug},${b.slug}`)
  assert.equal(res.status, 200)
  const html = await res.text()

  const cards = html.match(/<li class="card"/g) ?? []
  assert.equal(cards.length, 2)
  assert.match(html, new RegExp(`data-slug="${a.slug}"`))
  assert.match(html, new RegExp(`data-slug="${b.slug}"`))
  // The prices are formatted the same way the grid renders them, not raw paisa.
  assert.match(html, /৳|Tk|1,500|3,500/)
})

test('all-unknown slugs answer 200 with an empty body, never a 500', async () => {
  const app = buildTestApp()
  const res = await app.request('/recently-viewed?p=ghost-one,ghost-two')
  assert.equal(res.status, 200)
  assert.equal((await res.text()).trim(), '')
})

test('the fragment never renders more than four cards, however many slugs are asked for', async () => {
  const app = buildTestApp()
  const slugs = Array.from({ length: 6 }, (_, i) => seedProduct(`six-${Date.now()}-${i}`, `Six ${i}`, 90000).slug)

  const res = await app.request(`/recently-viewed?p=${slugs.join(',')}`)
  const html = await res.text()
  const cards = html.match(/<li class="card"/g) ?? []
  assert.ok(cards.length <= 4, `expected at most 4 cards, got ${cards.length}`)
})

test('junk in ?p= is dropped rather than thrown on', async () => {
  const app = buildTestApp()
  const junk = ['../../etc/passwd', 'a'.repeat(5000), '%00', 'UPPER-CASE'].join(',')
  const res = await app.request(`/recently-viewed?p=${encodeURIComponent(junk)}`)
  assert.equal(res.status, 200)
  const html = await res.text()
  assert.doesNotMatch(html, /<li class="card"/)
})

test('the recently-viewed fragment is edge-cacheable, holding ADR-0007 shut', async () => {
  // The whole feature depends on this route answering from the CDN rather
  // than the origin; a Set-Cookie or a missing s-maxage here would silently
  // turn every visit into an origin hit with no obvious symptom.
  const app = buildTestApp()
  const res = await app.request('/recently-viewed?p=nothing-here')
  assert.match(res.headers.get('Cache-Control') ?? '', /s-maxage=600/)
  assert.equal(res.headers.get('Set-Cookie'), null)
})

test('/p/:slug ships the recently-viewed section empty and hidden, with no trace of another product', async () => {
  const app = buildTestApp()
  const a = seedProduct(`hidden-a-${Date.now()}`, 'Product Alpha Only I Should Appear', 120000)
  const b = seedProduct(`hidden-b-${Date.now()}`, 'Product Bravo Should Never Appear Here', 130000)
  void b

  const res = await app.request(`/p/${a.slug}`)
  assert.equal(res.status, 200)
  const html = await res.text()

  assert.match(html, /id="recent" hidden=""/)
  assert.match(html, /<ul class="rail" id="recent-rail"><\/ul>/)
  assert.doesNotMatch(html, /Product Bravo Should Never Appear Here/)
})
