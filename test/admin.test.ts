import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRows, productSlug, uniqueSlug } from '../src/admin/bulkForm.js'
import { parseStock, parseVariantRows } from '../src/admin/variantForm.js'

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
  form.set('category-0', '3')
  // Row 1 left entirely empty: the form always renders more rows than are used.
  row(form, 2, '  Kantha stitch shawl  ', '1250.50', ' Hand quilted. ')

  const { drafts, problems } = parseRows(form)
  assert.deepEqual(problems, [])
  assert.equal(drafts.length, 2)
  assert.equal(drafts[0]?.title, 'Indigo jamdani saree')
  assert.equal(drafts[0]?.pricePaisa, 450000)
  assert.equal(drafts[0]?.categoryId, 3)
  // A row that names no shelf is unshelved, which is a normal state for a
  // product being set up rather than a mistake.
  assert.equal(drafts[1]?.categoryId, null)
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
  assert.equal(productSlug('Indigo Jamdani Saree'), 'indigo-jamdani-saree')
  assert.equal(productSlug('  Kantha — "stitch", 2026!  '), 'kantha-stitch-2026')
  assert.equal(productSlug('Café Crème'), 'cafe-creme')
  // Nothing ASCII survives, so the fallback carries it rather than an empty URL.
  assert.equal(productSlug('শাড়ি'), 'product')

  const taken = new Set(['indigo-jamdani-saree'])
  assert.equal(uniqueSlug(productSlug('Indigo Jamdani Saree'), taken), 'indigo-jamdani-saree-2')
  assert.equal(uniqueSlug(productSlug('Indigo Jamdani Saree'), taken), 'indigo-jamdani-saree-3')
  // Within one submit too: uniqueSlug claims as it goes.
  assert.equal(uniqueSlug(productSlug('শাড়ি'), taken), 'product')
  assert.equal(uniqueSlug(productSlug('শাড়ি'), taken), 'product-2')
})

/**
 * The variant form is the same shape of problem one level down — rows of typing
 * arriving flat — with two extra failures worth holding shut. A label that is
 * derived rather than typed can silently duplicate an existing variant, and an
 * axis slug that disagrees with the storefront's is a filter link that matches
 * nothing at all.
 */

function variantRow(form: FormData, i: number, stock: string, ...options: [string, string][]): void {
  form.set(`stock-${i}`, stock)
  options.forEach(([name, value], j) => {
    form.set(`oname-${i}-${j}`, name)
    form.set(`ovalue-${i}-${j}`, value)
  })
}

test('a variant with no options is the one configuration, and still gets a label', () => {
  const form = new FormData()
  variantRow(form, 0, '4')

  const { drafts, problems } = parseVariantRows(form, new Set())
  assert.deepEqual(problems, [])
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0]?.label, 'Standard')
  assert.equal(drafts[0]?.stockQty, 4)
  assert.deepEqual(drafts[0]?.options, [])
})

test('the label is the values joined, in the order they were typed', () => {
  const form = new FormData()
  variantRow(form, 0, '', ['Colour', 'Indigo'], ['Size', 'M'])

  const { drafts, problems } = parseVariantRows(form, new Set())
  assert.deepEqual(problems, [])
  assert.equal(drafts[0]?.label, 'Indigo / M')
  // Blank is none in stock, so an operator who only knows the configuration can
  // enter it and count later.
  assert.equal(drafts[0]?.stockQty, 0)
  assert.deepEqual(
    drafts[0]?.options.map((o) => [o.nameSlug, o.valueSlug, o.position]),
    [
      ['colour', 'indigo', 0],
      ['size', 'm', 1],
    ],
  )
})

test('however the axis was typed, it is one axis', () => {
  for (const typed of ['Colour', 'colour', '  COLOUR ']) {
    const form = new FormData()
    variantRow(form, 0, '1', [typed, 'Indigo'])
    const [draft] = parseVariantRows(form, new Set()).drafts
    assert.equal(draft?.options[0]?.nameSlug, 'colour')
    // The slug is normalised; what the operator typed is what the admin shows.
    assert.equal(draft?.options[0]?.name, typed.trim())
  }
})

test('the same axis twice in one row is a slip, not two values', () => {
  const form = new FormData()
  variantRow(form, 0, '2', ['Colour', 'Indigo'], ['colour', 'Ecru'])

  const { drafts, problems } = parseVariantRows(form, new Set())
  assert.deepEqual(drafts, [])
  assert.match(problems[0] ?? '', /^Row 1: colour is given twice/)
})

test('blank variant rows are ignored, half-filled ones are reported by number', () => {
  const form = new FormData()
  variantRow(form, 0, '', ['Colour', 'Indigo'])
  // Row 2 untouched; row 3 has an axis with nothing on it.
  variantRow(form, 2, '', ['Size', ''])

  const { drafts, problems } = parseVariantRows(form, new Set())
  assert.deepEqual(
    drafts.map((d) => d.label),
    ['Indigo'],
  )
  assert.equal(problems.length, 1)
  assert.match(problems[0] ?? '', /^Row 3: "Size" needs both/)
})

test('stock is a whole number of things, 0 or more', () => {
  for (const bad of ['-1', '2.5', 'lots', '1e400']) {
    const form = new FormData()
    variantRow(form, 0, bad, ['Size', 'M'])
    const { drafts, problems } = parseVariantRows(form, new Set())
    assert.deepEqual(drafts, [])
    assert.match(problems[0] ?? '', /^Row 1: stock must be a whole number/)
  }
  assert.equal(parseStock('  7 ', 'zero'), 7)
  assert.equal(parseStock('-3', 'zero'), null)
})

/**
 * The two readings of an empty box, which is not a style choice: the add rows
 * render empty, so blank there is an untouched row; the edit form on the
 * product page renders pre-filled, so blank there is a cleared box. Taking the
 * first reading in the second place writes a silent 0 over a live stock figure
 * and reports it as saved, which nobody finds until a picker goes looking for
 * goods the shop believes it does not have.
 */
test('what a blank stock field means depends on how it was rendered', () => {
  assert.equal(parseStock('', 'zero'), 0)
  assert.equal(parseStock('   ', 'zero'), 0)
  assert.equal(parseStock('', 'reject'), null)
  assert.equal(parseStock('   ', 'reject'), null)
  // Everything else reads the same either way, including a real zero, which
  // has to stay distinguishable from the blank the edit form refuses.
  for (const blank of ['zero', 'reject'] as const) {
    assert.equal(parseStock('0', blank), 0)
    assert.equal(parseStock('12', blank), 12)
    assert.equal(parseStock('1.5', blank), null)
    assert.equal(parseStock('abc', blank), null)
    assert.equal(parseStock('-1', blank), null)
    assert.equal(parseStock('1e400', blank), null)
  }
})

test('two rows with the same options are one variant entered twice', () => {
  const form = new FormData()
  variantRow(form, 0, '1', ['Colour', 'Indigo'], ['Size', 'M'])
  variantRow(form, 1, '2', ['Colour', 'Indigo'], ['Size', 'M'])

  const { drafts, problems } = parseVariantRows(form, new Set())
  assert.deepEqual(
    drafts.map((d) => d.label),
    ['Indigo / M'],
  )
  assert.match(problems[0] ?? '', /^Row 2: "Indigo \/ M" is already a variant/)
})

test('and so is a row repeating a variant the product already has', () => {
  const form = new FormData()
  variantRow(form, 0, '1', ['Size', 'M'])

  const { drafts, problems } = parseVariantRows(form, new Set(['M']))
  assert.deepEqual(drafts, [])
  assert.equal(problems.length, 1)
})
