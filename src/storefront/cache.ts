import type { Context, Next } from 'hono'

/**
 * Catalogue HTML is served from a Dhaka edge PoP (ADR-0007). Two properties
 * this middleware is responsible for:
 *
 * 1. A short browser TTL with a long shared TTL: the CDN answers from Dhaka,
 *    and a stale-while-revalidate window means a catalogue edit is never a
 *    cliff for the customer who arrives during it.
 * 2. No cacheable response may carry `Set-Cookie`. A CDN silently declines to
 *    cache such a response — no error, no obvious symptom, just an
 *    architecture that quietly stopped working. Rather than let that pass, a
 *    response that sets a cookie is marked uncacheable here and logged loudly,
 *    so the failure is visible in a log rather than in a latency graph a month
 *    later. Carts are created lazily on the add-to-cart POST for this reason.
 */
export async function edgeCacheable(c: Context, next: Next): Promise<void> {
  await next()

  if (c.res.status !== 200 || (c.req.method !== 'GET' && c.req.method !== 'HEAD')) {
    c.header('Cache-Control', 'no-store')
    return
  }

  const existingCc = c.res.headers.get('Cache-Control')
  if (existingCc && (existingCc.includes('no-store') || existingCc.includes('private'))) {
    return
  }

  if (c.res.headers.has('Set-Cookie')) {
    console.error(
      `[cache] ${c.req.path} set a cookie on a cacheable path; edge caching disabled for this response. See ADR-0007.`,
    )
    c.header('Cache-Control', 'private, no-store')
    return
  }

  c.header('Cache-Control', 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400')
  c.header('Vary', 'Accept-Encoding')
}
