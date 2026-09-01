import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { bodyLimit } from 'hono/body-limit'
import { logger } from 'hono/logger'
import { adminCategories } from './admin/categories.js'
import { adminHome } from './admin/home.js'
import { adminOrders } from './admin/orders.js'
import { adminProducts } from './admin/products.js'
import { adminSiteImages } from './admin/siteImages.js'
import { config } from './config.js'
import { runMigrations } from './db/migrate.js'
import { resolveEncoderSupport } from './images/pipeline.js'
import { drainQueue } from './images/queue.js'
import { brandRoutes, mediaRoutes } from './media.js'
import { cartRoutes } from './storefront/cart.js'
import { notFound, storefront } from './storefront/catalogue.js'
import { checkoutRoutes } from './storefront/checkout.js'
import { edgeCacheable } from './storefront/cache.js'
import { orderRoutes } from './storefront/order.js'

runMigrations()

const app = new Hono()
app.use('*', logger())

/**
 * ADR-0007 requires admin paths to be excluded from cache rules explicitly, and
 * says the exclusion is security-relevant. Belt and braces: the origin also
 * marks them private, so a misconfigured CDN rule cannot cache a logged-in page.
 */
// Both paths: `/admin/*` does not match the bare `/admin`, and the index page
// is as private as the pages under it.
const adminPaths = ['/admin', '/admin/*']
for (const path of adminPaths) {
  app.use(path, async (c, next) => {
    await next()
    c.header('Cache-Control', 'private, no-store')
  })
}

const adminUser = process.env.BUTTERLOOM_ADMIN_USER
const adminPassword = process.env.BUTTERLOOM_ADMIN_PASSWORD
if (adminUser && adminPassword) {
  const auth = basicAuth({ username: adminUser, password: adminPassword })
  for (const path of adminPaths) app.use(path, auth)
} else {
  console.warn(
    '[admin] BUTTERLOOM_ADMIN_USER / BUTTERLOOM_ADMIN_PASSWORD are unset — the admin is UNAUTHENTICATED. Local development only.',
  )
}

/**
 * A bulk submit is one multipart body the server has to buffer whole before it
 * can count anything inside it, so the only guard that runs before the memory
 * is spent is this one, on Content-Length. The per-file and per-queue limits in
 * the admin are what shape a legitimate batch; this is what stops an illegitimate
 * one from being read at all.
 */
app.use(
  '/admin/*',
  bodyLimit({
    maxSize: config.maxRequestBytes,
    onError: (c) =>
      c.text(
        `That submit is larger than ${Math.round(config.maxRequestBytes / (1024 * 1024))}MB. ` +
          'Nothing was saved — add the products in smaller batches.',
        413,
      ),
  }),
)

app.route('/admin/orders', adminOrders)
app.route('/admin/products', adminProducts)
app.route('/admin/categories', adminCategories)
app.route('/admin/site-images', adminSiteImages)
app.route('/admin', adminHome)
app.route('/media', mediaRoutes)
app.route('/brand', brandRoutes)
app.route('/cart', cartRoutes)
app.route('/checkout', checkoutRoutes)
app.route('/order', orderRoutes)

// Catalogue HTML is the cacheable half of the origin (ADR-0007). Registered
// last so the admin, media, brand, cart, checkout and order prefixes are matched first.
app.use('*', edgeCacheable)
app.route('/', storefront)

app.notFound(notFound)

const support = await resolveEncoderSupport()
console.log(`[images] encoder formats available: ${[...support].join(', ') || 'none'}`)
if (!support.has('avif')) {
  console.warn(
    '[images] this libvips build cannot write AVIF (no AV1 encoder). Pages will serve WebP and JPEG only.',
  )
}

// Anything left in the queue by the last shutdown, picked up now: the whole
// point of the table is that a restart mid-bulk resumes rather than loses.
drainQueue()

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[http] http://localhost:${info.port}/admin`)
})
