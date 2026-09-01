import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { logger } from 'hono/logger'
import { adminProducts } from './admin/products.js'
import { adminSiteImages } from './admin/siteImages.js'
import { config } from './config.js'
import { runMigrations } from './db/migrate.js'
import { resolveEncoderSupport } from './images/pipeline.js'
import { brandRoutes, mediaRoutes } from './media.js'
import { notFound, storefront } from './storefront/catalogue.js'
import { edgeCacheable } from './storefront/cache.js'

runMigrations()

const app = new Hono()
app.use('*', logger())

/**
 * ADR-0007 requires admin paths to be excluded from cache rules explicitly, and
 * says the exclusion is security-relevant. Belt and braces: the origin also
 * marks them private, so a misconfigured CDN rule cannot cache a logged-in page.
 */
app.use('/admin/*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'private, no-store')
})

const adminUser = process.env.BUTTERLOOM_ADMIN_USER
const adminPassword = process.env.BUTTERLOOM_ADMIN_PASSWORD
if (adminUser && adminPassword) {
  app.use('/admin/*', basicAuth({ username: adminUser, password: adminPassword }))
} else {
  console.warn(
    '[admin] BUTTERLOOM_ADMIN_USER / BUTTERLOOM_ADMIN_PASSWORD are unset — the admin is UNAUTHENTICATED. Local development only.',
  )
}

app.route('/admin/products', adminProducts)
app.route('/admin/site-images', adminSiteImages)
app.route('/media', mediaRoutes)
app.route('/brand', brandRoutes)

// Catalogue HTML is the cacheable half of the origin (ADR-0007). Registered
// last so the admin, media and brand prefixes are matched first — those already
// carry an immutable cache header, and edgeCacheable would overwrite it.
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

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[http] http://localhost:${info.port}/admin/products`)
})
