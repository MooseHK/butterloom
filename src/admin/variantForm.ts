import { slugify } from '../lib/slug.js'

/**
 * Reading the add-variants form on the product page. Split out from the page
 * for the same reason bulkForm.ts is: these rules decide what an operator's
 * typing turns into, and they are worth a test that runs in a millisecond
 * rather than one that needs a database and an encoder to say anything.
 */

/** Ceiling on one submit, matched by the add-row script on the product page. */
export const maxVariantRows = 12

/**
 * Three axes fits a phone-width row and is more than anything in the catalogue
 * has needed — colour, size, and one for the garment that surprises us. A
 * fourth is this number, not a migration: variant_options is free text.
 */
export const optionsPerRow = 3

/** Long enough for "Blouse fabric included", short enough not to be a sentence. */
const maxOptionLength = 60

export interface DraftOption {
  name: string
  nameSlug: string
  value: string
  valueSlug: string
  position: number
}

export interface DraftVariant {
  /** Row number as the operator sees it, for error messages. */
  row: number
  label: string
  stockQty: number
  options: DraftOption[]
}

/**
 * The label is joined from the values rather than typed, because a typed label
 * is a second place the same fact is written and the first one to fall out of
 * step with the options beside it. "Indigo / M".
 *
 * A variant with no options at all is the single configuration of a product
 * that only has one. It still needs a word: the column is NOT NULL, and what a
 * customer eventually picks should not be an empty button.
 */
export function deriveLabel(options: { value: string }[]): string {
  return options.map((o) => o.value).join(' / ') || 'Standard'
}

/**
 * Null means "that is not a stock count" — the caller turns it into a message,
 * never into a silent number.
 *
 * What a blank field means depends entirely on how it was rendered, which is
 * why the caller has to say so rather than inherit a default. The add rows
 * below render empty, so blank there is an untouched row and reads as zero. The
 * edit form on the product page renders pre-filled with the figure it is about
 * to replace, so blank there means the operator cleared the box — and writing a
 * silent 0 over a live stock figure, under a "Stock saved" notice, is the one
 * mistake on that page nobody would catch until a picker went looking for goods
 * the shop believed it did not have.
 *
 * Nothing on the storefront reads what this returns: ADR-0007 keeps
 * availability out of edge-cached HTML, so stock is an operator's number until
 * Reservation reads it.
 */
export function parseStock(raw: string, blank: 'zero' | 'reject'): number | null {
  const value = raw.trim()
  if (!value) return blank === 'zero' ? 0 : null
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}

/**
 * The name/value pairs of one row. Slugified here and only here — the
 * storefront's filter URLs are matched against these exact slugs (see
 * lib/slug.ts), so "Colour", "colour" and " COLOUR " have to arrive at the same
 * axis or the two sides quietly stop agreeing.
 */
function readOptions(form: FormData, i: number): { options: DraftOption[]; problem?: string } {
  const options: DraftOption[] = []
  for (let j = 0; j < optionsPerRow; j++) {
    const name = String(form.get(`oname-${i}-${j}`) ?? '').trim().slice(0, maxOptionLength)
    const value = String(form.get(`ovalue-${i}-${j}`) ?? '').trim().slice(0, maxOptionLength)
    if (!name && !value) continue
    if (!name || !value) {
      return { options, problem: `"${name || value}" needs both an axis and a value` }
    }
    const nameSlug = slugify(name, 'option')
    if (options.some((o) => o.nameSlug === nameSlug)) {
      // Rejected here rather than left to the unique index, which would take
      // the whole transaction — and the other rows — down with it.
      return { options, problem: `${name} is given twice; a variant has one value per axis` }
    }
    options.push({ name, nameSlug, value, valueSlug: slugify(value, 'value'), position: options.length })
  }
  return { options }
}

/**
 * A row with nothing in it is an unused row, not a mistake; the form always
 * renders more than are needed. A row that is half filled in is a mistake, and
 * is reported by number so the other rows of typing still land.
 *
 * `taken` carries the labels this product already has and gains each one this
 * submit derives, which is the same trick uniqueSlug plays and catches the same
 * collision: two rows with the same options are one variant entered twice.
 */
export function parseVariantRows(
  form: FormData,
  taken: Set<string>,
): { drafts: DraftVariant[]; problems: string[] } {
  const drafts: DraftVariant[] = []
  const problems: string[] = []

  for (let i = 0; i < maxVariantRows; i++) {
    const stockRaw = String(form.get(`stock-${i}`) ?? '')
    const { options, problem } = readOptions(form, i)
    if (!stockRaw.trim() && options.length === 0 && !problem) continue

    const row = `Row ${i + 1}`
    if (problem) {
      problems.push(`${row}: ${problem}`)
      continue
    }
    const stockQty = parseStock(stockRaw, 'zero')
    if (stockQty === null) {
      problems.push(`${row}: stock must be a whole number, 0 or more`)
      continue
    }
    const label = deriveLabel(options)
    if (taken.has(label)) {
      problems.push(`${row}: "${label}" is already a variant of this product`)
      continue
    }
    taken.add(label)
    drafts.push({ row: i + 1, label, stockQty, options })
  }

  return { drafts, problems }
}
