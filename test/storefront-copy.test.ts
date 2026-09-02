// First, and it has to stay first: this picks the database before
// src/db/client.ts opens one. See the file for why.
import './support/tempDb.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { db } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import { products, productVariants } from '../src/db/schema.js'
import { storefront } from '../src/storefront/catalogue.js'

runMigrations()

/**
 * Promises the storefront is not in a position to make.
 *
 * Cash on delivery, a daily despatch run and nationwide coverage were written
 * into the chrome from the wireframes, where they were illustration. On a live
 * page they read as terms: a first-time visitor takes "Dispatched daily" as a
 * commitment about when their parcel leaves, and there is nothing behind it
 * yet. They are cheap to re-add the day they are true and expensive to leave
 * standing while they are not, so this holds them out of the shared chrome and
 * off the point of decision.
 *
 * Deliberately not covered here: /cart and /checkout still say the order is
 * paid in cash to the courier. That is not a promise about service, it is the
 * only payment tier the checkout implements, and a customer who is not told it
 * does not know how to pay.
 */
const unguaranteed = [
  'Cash on delivery',
  'Dispatched daily',
  'Delivered across Bangladesh',
  'courier at the door',
  'Nothing to pay now',
]

const [product] = db
  .insert(products)
  .values({ slug: 'copy-check-saree', title: 'Copy Check Saree', pricePaisa: 250000 })
  .returning()
  .all()
if (!product) throw new Error('Product not created')
db.insert(productVariants).values({ productId: product.id, label: 'Standard', stockQty: 3 }).run()

for (const path of ['/', '/shop', '/search?q=copy', `/p/${product.slug}`]) {
  test(`${path} makes no promise the shop cannot keep`, async () => {
    const html = await (await storefront.request(path)).text()
    for (const claim of unguaranteed) {
      assert.ok(!html.includes(claim), `${path} still says "${claim}"`)
    }
  })
}

test('the header carries navigation and nothing that reads as terms', async () => {
  // The strip above the wordmark was the one place these claims reached every
  // page at once, so its absence is worth asserting rather than assuming.
  const html = await (await storefront.request('/')).text()
  const header = html.slice(html.indexOf('<body>'), html.indexOf('</header>'))
  assert.doesNotMatch(header, /class="promo"/, 'the promo strip must not come back')
  assert.match(header, /class="wm"/)
  assert.match(header, /aria-label="Cart"/)
  assert.match(header, /aria-label="Search"/)
})

test('nothing styles a strip that is no longer rendered', async () => {
  // --strip and --strip-ink existed only for that band. Left behind they read
  // as part of the palette to whoever picks colours next.
  const html = await (await storefront.request('/')).text()
  assert.doesNotMatch(html, /--strip/)
  assert.doesNotMatch(html, /\.promo\s*\{/)
})
