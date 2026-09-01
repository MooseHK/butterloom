import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ladderWidths, widthsFor } from '../src/images/ladder.js'
import { shardedKey } from '../src/images/storage.js'

test('the ladder never upscales', () => {
  assert.deepEqual(widthsFor(700), [320, 480, 640])
  assert.deepEqual(widthsFor(4000), [...ladderWidths])
})

test('an original smaller than the narrowest rung still gets one derivative', () => {
  assert.deepEqual(widthsFor(200), [200])
})

test('storage keys shard by content hash', () => {
  const sha = 'a'.repeat(64)
  assert.equal(shardedKey(sha, 'webp'), `aa/aa/${sha}.webp`)
})
