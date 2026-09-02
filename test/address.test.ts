import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addressLimits,
  composeAddress,
  missingAddressParts,
  readAddressParts,
} from '../src/lib/address.js'

function form(fields: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

const full = {
  address_line: 'House 42, Road 12',
  address_area: 'Dhanmondi',
  address_city: 'Dhaka',
  address_postcode: '1209',
}

test('the parts compose into the three lines that go on the parcel', () => {
  const parts = readAddressParts(form(full))
  assert.deepEqual(parts, {
    line: 'House 42, Road 12',
    area: 'Dhanmondi',
    city: 'Dhaka',
    postcode: '1209',
  })
  // Street, area, then city with the postcode after it — not a fourth line.
  assert.equal(composeAddress(parts), 'House 42, Road 12\nDhanmondi\nDhaka 1209')
})

test('the postcode is optional, and its absence leaves no trailing space', () => {
  const parts = readAddressParts(form({ ...full, address_postcode: '' }))
  assert.equal(missingAddressParts(parts).length, 0)
  assert.equal(composeAddress(parts), 'House 42, Road 12\nDhanmondi\nDhaka')
})

test('an empty part drops out rather than leaving a blank line', () => {
  // Not reachable through the form, which marks all three required — but a
  // blank line in a stored address is an operator wondering what is missing.
  const parts = readAddressParts(form({ ...full, address_area: '' }))
  assert.equal(composeAddress(parts), 'House 42, Road 12\nDhaka 1209')
  assert.doesNotMatch(composeAddress(parts), /\n\n/)
})

/**
 * These land on a courier's label, where a customer cannot see or fix a
 * double space. Interior whitespace is collapsed, not just trimmed.
 */
test('whitespace is collapsed, not merely trimmed', () => {
  const parts = readAddressParts(
    form({
      address_line: '  House   42,\tRoad  12  ',
      address_area: ' Dhanmondi ',
      address_city: '  Dhaka',
      address_postcode: ' 1209 ',
    }),
  )
  assert.equal(parts.line, 'House 42, Road 12')
  assert.equal(parts.area, 'Dhanmondi')
  assert.equal(parts.city, 'Dhaka')
  assert.equal(parts.postcode, '1209')
})

/**
 * A field holding only spaces is the case the browser's own `required` lets
 * through, so it has to count as missing here rather than composing into an
 * address with a blank line where the area should be.
 */
test('a field of only spaces counts as missing', () => {
  const parts = readAddressParts(form({ ...full, address_area: '   ' }))
  assert.deepEqual(missingAddressParts(parts), ['area or thana'])
})

test('missing parts are named, in the order the form asks for them', () => {
  const none = readAddressParts(form({}))
  assert.deepEqual(missingAddressParts(none), [
    'house and road',
    'area or thana',
    'city or district',
  ])

  const partial = readAddressParts(form({ address_line: 'House 42, Road 12' }))
  assert.deepEqual(missingAddressParts(partial), ['area or thana', 'city or district'])
})

test('each part is capped, so one field cannot carry a whole essay', () => {
  const parts = readAddressParts(
    form({
      address_line: 'x'.repeat(500),
      address_area: 'y'.repeat(500),
      address_city: 'z'.repeat(500),
      address_postcode: '9'.repeat(500),
    }),
  )
  assert.equal(parts.line.length, addressLimits.line)
  assert.equal(parts.area.length, addressLimits.area)
  assert.equal(parts.city.length, addressLimits.city)
  assert.equal(parts.postcode.length, addressLimits.postcode)
})
