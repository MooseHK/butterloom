import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AdminLayout } from '../src/views/layout.js'
import { StorefrontLayout } from '../src/views/storefront.js'

/**
 * These two assertions exist because both failures are invisible: the page still
 * renders, just with the wrong font and the wrong box model, and nothing in the
 * build or the browser console says so.
 */
const shell = String(StorefrontLayout({ title: 'x', canonicalPath: '/', children: null }))
const admin = String(AdminLayout({ title: 'x', children: null }))

test('the stylesheet reaches the browser unescaped', () => {
  // <style> is a raw-text element, so a &quot; here is a literal six characters
  // to the CSS parser, which then drops the whole declaration. That is what put
  // the storefront in the UA default serif at 1.2 line-height.
  assert.match(shell, /font: 400 15\.5px\/1\.7 ui-serif, Georgia, "Times New Roman", serif/)
  assert.doesNotMatch(shell, /&quot;/)
  assert.match(shell, /main > \.placeholder/)
  assert.doesNotMatch(shell, /&gt;/)
})

test('both shells declare a doctype, so neither renders in quirks mode', () => {
  assert.ok(shell.startsWith('<!doctype html>'), 'storefront shell must open with a doctype')
  assert.ok(admin.startsWith('<!doctype html>'), 'admin shell must open with a doctype')
})

test('the brand mark carries intrinsic dimensions', () => {
  // ADR-0007: an image without width/height shifts the layout under it while it
  // arrives, on exactly the networks this architecture is built around.
  assert.match(shell, /<img src="\/brand\/[0-9a-f]{64}\.png" width="460" height="460"/)
})
