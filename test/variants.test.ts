import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sortVariants } from '../src/lib/variants.js'

const labels = (rows: { variantLabel: string }[]) => rows.map((r) => r.variantLabel)
const rows = (...variantLabels: string[]) => variantLabels.map((variantLabel) => ({ variantLabel }))

test('sizes come out in the order a person reads them, not alphabetically', () => {
  // The bug this exists for: ORDER BY variant_label put L before M before S on
  // every product page with sizes on it.
  assert.deepEqual(labels(sortVariants(rows('L', 'S', 'XL', 'M'))), ['S', 'M', 'L', 'XL'])
  assert.deepEqual(labels(sortVariants(rows('xl', 'xs', 'm'))), ['xs', 'm', 'xl'])
})

test('labels that are not sizes sort after the sizes, alphabetically', () => {
  assert.deepEqual(labels(sortVariants(rows('Indigo', 'M', 'Ecru', 'S'))), [
    'S',
    'M',
    'Ecru',
    'Indigo',
  ])
})

test('one unlabelled variant survives the sort', () => {
  // A product with no variants carries a single row with an empty label; it has
  // to come back, not be sorted away.
  assert.deepEqual(labels(sortVariants(rows(''))), [''])
  assert.deepEqual(labels(sortVariants([])), [])
})

test('sorting does not mutate the caller’s array', () => {
  const original = rows('L', 'S')
  sortVariants(original)
  assert.deepEqual(labels(original), ['L', 'S'])
})
