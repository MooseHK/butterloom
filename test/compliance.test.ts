// First, and it has to stay first: this picks the database before
// src/db/client.ts opens one.
import './support/tempDb.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { adminOrders } from '../src/admin/orders.js'
import { adminProducts } from '../src/admin/products.js'
import { adminSettings } from '../src/admin/settings.js'
import { config } from '../src/config.js'
import { db } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import { invoices, orders, products, productVariants, sessions, cartItems } from '../src/db/schema.js'
import { calculateVat, getVatRateBp, setVatRateBp, findInvoiceByOrderId } from '../src/lib/settings.js'
import { exportRetentionData } from '../src/lib/retention.js'
import { orderPlacedSmsText, LoggingSmsProvider } from '../src/lib/sms.js'
import { cartRoutes } from '../src/storefront/cart.js'
import { storefront } from '../src/storefront/catalogue.js'
import { checkoutRoutes } from '../src/storefront/checkout.js'
import { orderRoutes } from '../src/storefront/order.js'
import { edgeCacheable } from '../src/storefront/cache.js'

runMigrations()

function buildApp() {
  const app = new Hono()
  app.route('/cart', cartRoutes)
  app.route('/checkout', checkoutRoutes)
  app.route('/order', orderRoutes)
  app.route('/admin/orders', adminOrders)
  app.route('/admin/products', adminProducts)
  app.route('/admin/settings', adminSettings)
  app.use('*', edgeCacheable)
  app.route('/', storefront)
  return app
}

let seedSeq = 0
function seedTestProduct(options: {
  title?: string
  stock?: number
  pricePaisa?: number
  origin?: string | null
  material?: string | null
  measurements?: string | null
  returnsPolicy?: string | null
}) {
  seedSeq += 1
  const [product] = db
    .insert(products)
    .values({
      slug: `compliance-test-${seedSeq}-${Date.now()}`,
      title: options.title ?? `Compliance Jamdani ${seedSeq}`,
      pricePaisa: options.pricePaisa ?? 500000,
      originCountry: options.origin !== undefined ? options.origin : 'Bangladesh',
      material: options.material !== undefined ? options.material : '100% Handloom Cotton',
      measurements: options.measurements !== undefined ? options.measurements : 'Length: 5.5m, Width: 1.15m',
      returnsPolicy: options.returnsPolicy !== undefined ? options.returnsPolicy : null,
    })
    .returning()
    .all()

  if (!product) throw new Error('Failed to create test product')

  const [variant] = db
    .insert(productVariants)
    .values({
      productId: product.id,
      label: 'Standard',
      stockQty: options.stock ?? 10,
    })
    .returning()
    .all()

  if (!variant) throw new Error('Failed to create test variant')

  return { product, variant }
}

test('Option A: /stock/:slug returns live stock counts, private no-store, and no cookies', async () => {
  const app = buildApp()
  const { product, variant } = seedTestProduct({ stock: 7 })

  const res = await app.request(`/stock/${product.slug}`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(res.headers.get('Set-Cookie'), null)

  const body = (await res.json()) as any
  assert.equal(body.slug, product.slug)
  assert.equal(body.inStock, true)
  assert.equal(body.totalStock, 7)
  assert.equal(body.variants[String(variant.id)], 7)
})

test('Task 2: product detail page displays disclosures as dropdown accordions', async () => {
  const app = buildApp()
  const { product } = seedTestProduct({
    origin: 'Rupganj, Bangladesh',
    material: 'Muslin Silk',
    measurements: 'Length 6 yards, Blouse piece included',
  })

  const res = await app.request(`/p/${product.slug}`)
  assert.equal(res.status, 200)
  const html = await res.text()

  // Dropdown accordions
  assert.match(html, /<details>/)
  assert.match(html, /Measurements/)
  assert.match(html, /Length 6 yards, Blouse piece included/)
  assert.match(html, /Origin &amp; Material/)
  assert.match(html, /Rupganj, Bangladesh/)
  assert.match(html, /Muslin Silk/)
  assert.match(html, /Returns &amp; Refunds \(রিটার্ন ও রিফান্ড নীতি\)/)
  assert.match(html, /৭ দিনের মধ্যে আমাদের সাথে যোগাযোগ করুন/)
  assert.match(html, /Delivery &amp; Timeline/)
  assert.match(html, /id="stock-indicator"/)
})

test('Task 2: publishing a product to storefront is refused if mandatory disclosures are missing', async () => {
  const app = buildApp()
  // Product missing origin, material, measurements
  const { product } = seedTestProduct({
    origin: '',
    material: '',
    measurements: '',
  })

  const form = new FormData()
  form.set('on_storefront', 'yes')

  const res = await app.request(`/admin/products/${product.id}/storefront`, {
    method: 'POST',
    body: form,
  })

  assert.equal(res.status, 303)
  const loc = decodeURIComponent(res.headers.get('Location') ?? '')
  assert.match(loc, /Cannot publish to storefront/)
  assert.match(loc, /mandatory disclosures/)
})

test('Task 3: policy pages in Bengali exist, are edge-cacheable, and contain statutory identifiers in footer', async () => {
  const app = buildApp()

  const routes = ['/terms', '/returns', '/privacy', '/contact']
  for (const route of routes) {
    const res = await app.request(route)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('Cache-Control') ?? '', /public/)
    assert.equal(res.headers.get('Set-Cookie'), null)

    const html = await res.text()
    // Bengali text
    assert.match(html, /শর্তাবলী|রিটার্ন|গোপনীয়তা|যোগাযোগ/)
    // Statutory identifiers in footer
    assert.match(html, new RegExp(config.dbid))
    assert.match(html, new RegExp(config.bin))
    assert.match(html, new RegExp(config.tin))
    assert.match(html, new RegExp(config.tradeLicence))
  }

  // Home page footlinks omit "The collection" and "Your cart"
  const homeRes = await app.request('/')
  assert.equal(homeRes.status, 200)
  const homeHtml = await homeRes.text()
  assert.doesNotMatch(homeHtml, /<nav class="footlinks">[\s\S]*?The collection[\s\S]*?<\/nav>/)
  assert.doesNotMatch(homeHtml, /<nav class="footlinks">[\s\S]*?Your cart[\s\S]*?<\/nav>/)
  assert.match(homeHtml, /<nav class="footlinks">[\s\S]*?শর্তাবলী[\s\S]*?<\/nav>/)

  // Subpage footlinks include "The collection" and "Your cart"
  const termsRes = await app.request('/terms')
  const termsHtml = await termsRes.text()
  assert.match(termsHtml, /<nav class="footlinks">[\s\S]*?The collection[\s\S]*?<\/nav>/)
  assert.match(termsHtml, /<nav class="footlinks">[\s\S]*?Your cart[\s\S]*?<\/nav>/)
})

test('Task 4: VAT calculation adheres to CRPA s.40 and NBR Mushak 6.3 formula', () => {
  // Default is 10% (1000 bp)
  assert.equal(getVatRateBp(), 1000)

  // Formula: vat_paisa = round(total_paisa * rate_bp / (10000 + rate_bp))
  // For total 1100 BDT (110000 paisa) at 10%:
  // vat = round(110000 * 1000 / 11000) = 10000 paisa (100 BDT)
  // net = 100000 paisa (1000 BDT)
  const calc = calculateVat(110000, 1000)
  assert.equal(calc.vatPaisa, 10000)
  assert.equal(calc.netPaisa, 100000)
  assert.equal(calc.vatPaisa + calc.netPaisa, 110000)

  // Admin dynamic rate configuration
  setVatRateBp(1500) // 15%
  assert.equal(getVatRateBp(), 1500)

  // Reset back to default 10%
  setVatRateBp(1000)
  assert.equal(getVatRateBp(), 1000)
})

test('Task 4: order placement creates gapless Mushak 6.3 invoice and snapshots VAT', async () => {
  const app = buildApp()
  const { product, variant } = seedTestProduct({ pricePaisa: 55000, stock: 5 })

  // Add to cart
  const addForm = new FormData()
  addForm.set('product_id', String(product.id))
  addForm.set('variant_id', String(variant.id))
  addForm.set('quantity', '2')
  const addRes = await app.request('/cart/add', { method: 'POST', body: addForm })
  const cookie = addRes.headers.get('Set-Cookie')!

  // Checkout with consent
  const checkoutForm = new FormData()
  checkoutForm.set('customer_name', 'Rafiqul Islam')
  checkoutForm.set('customer_phone', '01712345678')
  checkoutForm.set('address_line', 'Flat 4B, Road 27')
  checkoutForm.set('address_area', 'Banani')
  checkoutForm.set('address_city', 'Dhaka')
  checkoutForm.set('consent', 'pdpa_2026_v1')

  const res = await app.request('/checkout', {
    method: 'POST',
    body: checkoutForm,
    headers: { Cookie: cookie },
  })

  assert.equal(res.status, 303)
  const orderUrl = res.headers.get('Location') ?? ''
  const orderId = Number(orderUrl.replace('/order/', ''))
  assert.ok(orderId > 0)

  const [order] = db.select().from(orders).where(eq(orders.id, orderId)).all()
  assert.ok(order)
  assert.equal(order.vatRateBp, 1000)
  // Total paisa: 55000 * 2 = 110000 paisa (1100 BDT)
  // VAT paisa at 10%: round(110000 * 1000 / 11000) = 10000 paisa (100 BDT)
  assert.equal(order.totalPaisa, 110000)
  assert.equal(order.vatPaisa, 10000)
  assert.equal(order.consentVersion, 'pdpa_2026_v1')
  assert.ok(order.consentGrantedAt! > 0)

  // Gapless Mushak 6.3 invoice
  const invoice = findInvoiceByOrderId(order.id)
  assert.ok(invoice)
  assert.match(invoice.mushakNumber, /^BL-6\.3-\d{6}$/)
  assert.equal(invoice.totalPaisa, 110000)
  assert.equal(invoice.vatPaisa, 10000)
  assert.equal(invoice.netPaisa, 100000)

  // Invoice view route
  const invoiceRes = await app.request(`/order/${order.id}/invoice`)
  assert.equal(invoiceRes.status, 200)
  const invoiceHtml = await invoiceRes.text()
  assert.match(invoiceHtml, /কর চালানপত্র \(মূসক-৬\.৩\)/)
  assert.match(invoiceHtml, new RegExp(invoice.mushakNumber))
  assert.match(invoiceHtml, /Rafiqul Islam/)
})

test('Task 8: admin can rectify and redact customer data under PDPA 2026', async () => {
  const app = buildApp()
  const { product, variant } = seedTestProduct({ pricePaisa: 10000, stock: 5 })

  // Place an order directly
  const addForm = new FormData()
  addForm.set('product_id', String(product.id))
  addForm.set('variant_id', String(variant.id))
  addForm.set('quantity', '1')
  const addRes = await app.request('/cart/add', { method: 'POST', body: addForm })
  const cookie = addRes.headers.get('Set-Cookie')!

  const checkoutForm = new FormData()
  checkoutForm.set('customer_name', 'Mahiya Mahi')
  checkoutForm.set('customer_phone', '01999999999')
  checkoutForm.set('address_line', 'House 1, Road 2')
  checkoutForm.set('address_area', 'Mirpur')
  checkoutForm.set('address_city', 'Dhaka')
  checkoutForm.set('consent', 'pdpa_2026_v1')

  const res = await app.request('/checkout', {
    method: 'POST',
    body: checkoutForm,
    headers: { Cookie: cookie },
  })
  const orderId = Number((res.headers.get('Location') ?? '').replace('/order/', ''))

  // 1. Rectification
  const rectifyForm = new FormData()
  rectifyForm.set('customer_name', 'Mahiya Rahman')
  rectifyForm.set('customer_phone', '01988888888')
  rectifyForm.set('delivery_address', 'House 1, Road 2, Mirpur 10, Dhaka')

  const rectifyRes = await app.request(`/admin/orders/${orderId}/rectify`, {
    method: 'POST',
    body: rectifyForm,
  })
  assert.equal(rectifyRes.status, 303)

  const [rectified] = db.select().from(orders).where(eq(orders.id, orderId)).all()
  assert.equal(rectified?.customerName, 'Mahiya Rahman')
  assert.equal(rectified?.customerPhone, '01988888888')
  assert.equal(rectified?.deliveryAddress, 'House 1, Road 2, Mirpur 10, Dhaka')

  // 2. Redaction (right to erasure while retaining business/tax record)
  const redactRes = await app.request(`/admin/orders/${orderId}/redact`, {
    method: 'POST',
  })
  assert.equal(redactRes.status, 303)

  const [redacted] = db.select().from(orders).where(eq(orders.id, orderId)).all()
  assert.equal(redacted?.customerName, '[REDACTED]')
  assert.equal(redacted?.customerPhone, '[REDACTED]')
  assert.equal(redacted?.deliveryAddress, '[REDACTED]')
  assert.ok(redacted?.redactedAt! > 0)
  // Financial totals and items remain intact for statutory retention
  assert.equal(redacted?.totalPaisa, 10000)
})

test('Task 9: retention export gathers 6-year business records', () => {
  const exportData = exportRetentionData()
  assert.ok(exportData.exportedAt)
  assert.ok(Array.isArray(exportData.records.orders))
  assert.ok(Array.isArray(exportData.records.orderItems))
  assert.ok(Array.isArray(exportData.records.orderEvents))
  assert.ok(Array.isArray(exportData.records.invoices))
  assert.ok(exportData.records.orders.length > 0)
})

test('Task 10: SMS notification enforces BTRC sender ID constraint and Bengali copy', () => {
  assert.throws(
    () => new LoggingSmsProvider('VeryLongSenderIdExceedingEleven'),
    /BTRC regulation: sender ID must be <= 11 characters/,
  )

  const text = orderPlacedSmsText('BL-100', 1500)
  assert.match(text, /বাটারলুম/)
  assert.match(text, /BL-100/)
  assert.match(text, /৳1500/)
})
