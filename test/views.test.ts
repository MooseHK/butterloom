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

test('an empty cart badge is hidden, not printed as a zero', () => {
  // `hidden` is display:none in the UA sheet at the lowest specificity there
  // is, and `.cart-badge { display: flex }` beats it. Without the override the
  // header carries a literal 0 on every page a visitor has no cart on.
  assert.match(shell, /<span class="cart-badge" id="cart-badge" hidden="">/)
  assert.match(shell, /\.cart-badge\[hidden\] \{ display: none; \}/)
})

test('the cart count is read from a cookie, never rendered into a cached page', () => {
  // ADR-0007: / and /p/:slug are edge-cached, so their bytes have to be the
  // same for every visitor. A count in the HTML would hand one shopper's cart
  // to the next one served from the Dhaka PoP.
  const empty = String(
    StorefrontLayout({ title: 'x', canonicalPath: '/', cartCount: 0, children: null }),
  )
  assert.match(empty, /bl_cart_count/)
  assert.match(empty, /<span class="cart-badge" id="cart-badge" hidden="">/)
})

test('only the cacheable route shapes are prefetched', () => {
  // Prefetching /cart, /checkout or /order would spend a visitor's mobile data
  // on no-store, per-visitor pages.
  assert.match(shell, /<script type="speculationrules">/)
  assert.match(shell, /"href_matches":"\/p\/\*"/)
  assert.doesNotMatch(shell, /"href_matches":"\/(cart|checkout|order)/)
  assert.match(shell, /"eagerness":"moderate"/)
})
