import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatPaisa } from '../src/lib/money.js'

test('paisa render as taka', () => {
  assert.equal(formatPaisa(485000), '৳4,850')
  assert.equal(formatPaisa(219950), '৳2,199.50')
  assert.equal(formatPaisa(5), '৳0.05')
  assert.equal(formatPaisa(0), '৳0')
})
