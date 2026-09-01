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
