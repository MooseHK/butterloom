import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRows, slugify, uniqueSlug } from '../src/admin/bulkForm.js'

/**
 * The bulk form is twenty rows of an operator's typing arriving as one flat
 * FormData. Both failures worth holding shut are silent ones: a row quietly
 * dropped, and two products landing on the same slug — which is a UNIQUE error
 * halfway through a batch, or worse, one product overwriting another's URL.
 */

function row(form: FormData, i: number, title: string, price: string, desc = ''): void {
  form.set(`title-${i}`, title)
  form.set(`price-${i}`, price)
  form.set(`desc-${i}`, desc)
}

test('blank rows are ignored, filled ones are read', () => {
  const form = new FormData()
  row(form, 0, 'Indigo jamdani saree', '4500')
  // Row 1 left entirely empty: the form always renders more rows than are used.
  row(form, 2, '  Kantha stitch shawl  ', '1250.50', ' Hand quilted. ')

  const { drafts, problems } = parseRows(form)
  assert.deepEqual(problems, [])
  assert.equal(drafts.length, 2)
  assert.equal(drafts[0]?.title, 'Indigo jamdani saree')
  assert.equal(drafts[0]?.pricePaisa, 450000)
  assert.equal(drafts[1]?.title, 'Kantha stitch shawl')
  assert.equal(drafts[1]?.description, 'Hand quilted.')
  // Paisa, not float BDT (ADR-0006), rounded once at this boundary.
  assert.equal(drafts[1]?.pricePaisa, 125050)
  assert.equal(drafts[1]?.row, 3)
})

test('a bad row is skipped by number without taking the good ones with it', () => {
  const form = new FormData()
  row(form, 0, 'Good one', '900')
  row(form, 1, 'No price', '')
  row(form, 2, 'Free', '0')
  row(form, 3, '', '400')

  const { drafts, problems } = parseRows(form)
  assert.deepEqual(
    drafts.map((d) => d.title),
    ['Good one'],
  )
  assert.equal(problems.length, 3)
  assert.match(problems[0] ?? '', /^Row 2 \(No price\)/)
  assert.match(problems[1] ?? '', /^Row 3 \(Free\)/)
  assert.match(problems[2] ?? '', /^Row 4: no title/)
})

test('photographs stay attached to the row that owns them', () => {
  const form = new FormData()
  row(form, 0, 'Two shots', '100')
  row(form, 1, 'One shot', '200')
  form.append('photos-0', new File(['a'], 'front.jpg', { type: 'image/jpeg' }))
  form.append('photos-0', new File(['b'], 'back.jpg', { type: 'image/jpeg' }))
  form.append('photos-1', new File(['c'], 'only.jpg', { type: 'image/jpeg' }))
  // The browser sends an empty part for a file input nobody filled in.
  form.append('photos-2', new File([], '', { type: 'application/octet-stream' }))

  const { drafts } = parseRows(form)
  assert.deepEqual(
    drafts.map((d) => d.files.map((f) => f.name)),
    [['front.jpg', 'back.jpg'], ['only.jpg']],
  )
})

test('slugs are derived, and two of the same title do not collide', () => {
  assert.equal(slugify('Indigo Jamdani Saree'), 'indigo-jamdani-saree')
  assert.equal(slugify('  Kantha — "stitch", 2026!  '), 'kantha-stitch-2026')
  assert.equal(slugify('Café Crème'), 'cafe-creme')
  // Nothing ASCII survives, so the fallback carries it rather than an empty URL.
  assert.equal(slugify('শাড়ি'), 'product')

  const taken = new Set(['indigo-jamdani-saree'])
  assert.equal(uniqueSlug(slugify('Indigo Jamdani Saree'), taken), 'indigo-jamdani-saree-2')
  assert.equal(uniqueSlug(slugify('Indigo Jamdani Saree'), taken), 'indigo-jamdani-saree-3')
  // Within one submit too: uniqueSlug claims as it goes.
  assert.equal(uniqueSlug(slugify('শাড়ি'), taken), 'product')
  assert.equal(uniqueSlug(slugify('শাড়ি'), taken), 'product-2')
})
