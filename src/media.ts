import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { fileStore } from './images/storage.js'
import { mimeTypes } from './images/ladder.js'

/**
 * Development stand-in for the CDN in ADR-0007. In production these bytes are
 * served from object storage behind an edge PoP and never touch this process.
 * Derivatives are content-addressed and immutable, which is what makes the
 * far-future cache header safe and leaves no purge path to maintain.
 */
export const mediaRoutes = new Hono()

const contentTypes: Record<string, string> = {
  avif: mimeTypes.avif,
  webp: mimeTypes.webp,
  jpg: mimeTypes.jpeg,
}

mediaRoutes.get('/:a/:b/:name', async (c) => {
  const { a, b, name } = c.req.param()
  if (!/^[0-9a-f]{2}$/.test(a) || !/^[0-9a-f]{2}$/.test(b)) return c.notFound()
  const match = /^([0-9a-f]{64})\.(avif|webp|jpg)$/.exec(name)
  if (!match) return c.notFound()

  try {
    const bytes = await fileStore.read(`${a}/${b}/${name}`)
    return c.body(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 200, {
      'Content-Type': contentTypes[match[2] as string] as string,
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
  } catch {
    return c.notFound()
  }
})

/**
 * The brand mark is committed rather than uploaded, but it is served the way
 * every other immutable byte here is: read once at startup, named by its own
 * content hash, far-future cache header, no purge path. One hash resolves and
 * nothing is interpolated into a filesystem path, so there is nothing to
 * traverse.
 */
const markBytes = readFileSync(path.join(import.meta.dirname, '..', 'assets', 'butterloom-mark.png'))
const markName = `${createHash('sha256').update(markBytes).digest('hex')}.png`
const markBody = markBytes.buffer.slice(
  markBytes.byteOffset,
  markBytes.byteOffset + markBytes.byteLength,
) as ArrayBuffer

/** Content-addressed URL of the 460 × 460 logo lockup. */
export const brandMarkUrl = `/brand/${markName}`

export const brandRoutes = new Hono()

brandRoutes.get('/:name', (c) => {
  // A bare 404, not the storefront's: a broken <img> has no use for 6KB of HTML,
  // and a wrong hash here is a bug rather than a page a CDN should hold on to.
  if (c.req.param('name') !== markName) return c.body(null, 404, { 'Cache-Control': 'no-store' })
  return c.body(markBody, 200, {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=31536000, immutable',
  })
})
