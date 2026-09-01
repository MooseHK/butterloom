import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  emptyParams,
  listingHref,
  listingSearch,
  parseListingParams,
  toggleValue,
  withPage,
  withSort,
} from '../src/storefront/listing.js'
import type { Allowed, RawQuery } from '../src/storefront/listing.js'

/**
 * ADR-0007 makes every distinct query string a distinct entry in the CDN's
 * cache, so the failures worth holding shut here are the quiet ones: two URLs
 * that mean the same listing and get cached twice, and a parameter nobody
 * validated that lets anyone mint cache entries by appending junk. Neither
 * shows up as a broken page — only as a cache that stops working.
 */

const allowed: Allowed = new Map([
  ['colour', new Set(['indigo', 'ecru'])],
  ['size', new Set(['s', 'm', 'l'])],
])

/** Parse and canonicalise in one step: what the route would redirect to. */
function canonical(query: RawQuery): string {
  return listingSearch(parseListingParams(query, allowed))
}

test('unknown axes, unknown values and junk are dropped', () => {
  assert.equal(canonical({ utm_source: 'facebook' }), '')
  assert.equal(canonical({ fabric: 'muslin' }), '')
  assert.equal(canonical({ colour: 'chartreuse' }), '')
  assert.equal(canonical({ sort: 'cheapest' }), '')
  // A known axis survives its neighbours being nonsense.
  assert.equal(canonical({ colour: ['indigo', 'chartreuse'], fabric: 'muslin' }), '?colour=indigo')
})

test('the defaults are the bare path, never spelled out', () => {
  assert.equal(canonical({}), '')
  assert.equal(canonical({ sort: 'newest' }), '')
  assert.equal(canonical({ page: '1' }), '')
  assert.equal(canonical({ sort: 'newest', page: '1' }), '')
  assert.equal(listingHref('/shop', emptyParams), '/shop')
})

test('one listing has one query string however the browser spelled it', () => {
  const forms: RawQuery[] = [
    { colour: 'indigo,ecru', size: 'm' },
    { size: 'm', colour: 'ecru,indigo' },
    { colour: ['indigo', 'ecru'], size: ['m'] },
    { colour: ['ecru', 'indigo', 'ecru'], size: 'm' },
    // Whitespace and empties are what a hand-edited URL looks like.
    { colour: ' indigo , ecru ,', size: 'm' },
  ]
  const canonicals = new Set(forms.map(canonical))
  // Values sorted, not in the order they arrived, so the set is what matters.
  assert.deepEqual([...canonicals], ['?colour=ecru%2Cindigo&size=m'])
})

test('sort and page sit after the filters, in that order', () => {
  assert.equal(
    canonical({ page: '3', sort: 'price-desc', size: 'l' }),
    '?size=l&sort=price-desc&page=3',
  )
})

test('a page number that is not a page number falls back to one', () => {
  for (const page of ['0', '-2', '1.5', 'two', '', '1e309', String(Number.MAX_VALUE)]) {
    assert.equal(parseListingParams({ page }, allowed).page, 1, `page=${page}`)
  }
  // A plausible one is kept as-is; the route clamps it once it has counted.
  assert.equal(parseListingParams({ page: '7' }, allowed).page, 7)
})

test('toggling a value adds it, removes it, and takes the axis with the last one', () => {
  const none = parseListingParams({}, allowed)
  const one = toggleValue(none, 'colour', 'indigo')
  assert.equal(listingSearch(one), '?colour=indigo')

  const two = toggleValue(one, 'colour', 'ecru')
  assert.equal(listingSearch(two), '?colour=ecru%2Cindigo')

  const back = toggleValue(two, 'colour', 'ecru')
  assert.equal(listingSearch(back), '?colour=indigo')

  // The last value off an axis drops the axis rather than leaving `?colour=`.
  assert.equal(listingSearch(toggleValue(back, 'colour', 'indigo')), '')
})

test('toggling one axis leaves the others alone', () => {
  const both = parseListingParams({ colour: 'indigo', size: 'm,l' }, allowed)
  assert.equal(listingSearch(toggleValue(both, 'size', 'm')), '?colour=indigo&size=l')
})

test('changing the filters or the sort lands back on page one', () => {
  const deep = parseListingParams({ page: '4', colour: 'indigo', sort: 'price-asc' }, allowed)
  // Page four of one listing is rarely page four of another, and an empty page
  // four is a worse answer than the first page of what was asked for.
  assert.equal(listingSearch(toggleValue(deep, 'size', 'm')), '?colour=indigo&size=m&sort=price-asc')
  assert.equal(listingSearch(withSort(deep, 'price-desc')), '?colour=indigo&sort=price-desc')
})

test('the canonical string parses back to itself, so the redirect cannot loop', () => {
  const query = { colour: ['ecru', 'indigo'], size: 'm', sort: 'price-asc', page: '2' }
  const once = canonical(query)
  const again = listingSearch(
    parseListingParams(Object.fromEntries(new URLSearchParams(once)), allowed),
  )
  assert.equal(again, once)
})

/**
 * `q` gets the same treatment as every other parameter this file validates: a
 * hand-edited or copy-pasted search box is where whitespace runs and absurd
 * lengths actually come from, and each one left unbounded is a fresh CDN
 * cache entry for a page that reads identically to one already cached.
 */
test('q is trimmed, its internal whitespace collapsed, and capped at 80 characters', () => {
  assert.equal(parseListingParams({ q: '  indigo   saree  ' }, allowed).q, 'indigo saree')
  assert.equal(parseListingParams({ q: '' }, allowed).q, '')
  assert.equal(parseListingParams({}, allowed).q, '')

  const long = 'a'.repeat(200)
  assert.equal(parseListingParams({ q: long }, allowed).q.length, 80)
  assert.equal(parseListingParams({ q: long }, allowed).q, 'a'.repeat(80))
})

test('q survives withPage, withSort and toggleValue', () => {
  const searched = parseListingParams({ q: 'saree' }, allowed)
  assert.equal(withPage(searched, 3).q, 'saree')
  assert.equal(withSort(searched, 'price-asc').q, 'saree')
  assert.equal(toggleValue(searched, 'colour', 'indigo').q, 'saree')
})

test('listingSearch puts q first and omits it entirely when empty', () => {
  assert.equal(canonical({ q: 'indigo saree', colour: 'indigo' }), '?q=indigo+saree&colour=indigo')
  assert.equal(canonical({ q: '', colour: 'indigo' }), '?colour=indigo')
  assert.equal(canonical({ colour: 'indigo' }), '?colour=indigo')
})

test('a variant axis literally named q cannot be parsed as a filter — it is reserved', () => {
  const qAsAxis: typeof allowed = new Map([...allowed, ['q', new Set(['odd-value'])]])
  const params = parseListingParams({ q: 'odd-value' }, qAsAxis)
  // Read as the search term, never as a filter on a same-named axis.
  assert.equal(params.q, 'odd-value')
  assert.deepEqual(params.filters, [])
})
