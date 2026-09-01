import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Hono } from 'hono'
import { edgeCacheable } from '../src/storefront/cache.js'

function appThatSets(headers: Record<string, string>) {
  const app = new Hono()
  app.use('*', edgeCacheable)
  app.get('/', (c) => {
    for (const [k, v] of Object.entries(headers)) c.header(k, v)
    return c.text('ok')
  })
  app.post('/', (c) => c.text('ok'))
  return app
}

test('catalogue GETs are cacheable at the edge', async () => {
  const res = await appThatSets({}).request('/')
  assert.match(res.headers.get('Cache-Control') ?? '', /public/)
  assert.match(res.headers.get('Cache-Control') ?? '', /s-maxage=600/)
})

test('a response that sets a cookie is never marked cacheable', async () => {
  // ADR-0007: a CDN silently refuses to cache a Set-Cookie response, which
  // disables edge caching with no error. Making it uncacheable on purpose is
  // the visible version of what would otherwise happen invisibly.
  const res = await appThatSets({ 'Set-Cookie': 'cart=abc; Path=/' }).request('/')
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store')
})

test('non-GET responses are never cacheable', async () => {
  const res = await appThatSets({}).request('/', { method: 'POST' })
  assert.equal(res.headers.get('Cache-Control'), 'no-store')
})

test('non-200 responses are never cacheable', async () => {
  const app = new Hono()
  app.use('*', edgeCacheable)
  app.get('/', (c) => c.text('nope', 404))
  const res = await app.request('/')
  assert.equal(res.headers.get('Cache-Control'), 'no-store')
})
