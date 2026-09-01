/**
 * Reading the bulk product form. Split out from the page only so it can be
 * tested without opening a database or an encoder — the rules here are the ones
 * that decide what an operator's twenty rows of typing turn into, and they are
 * worth a test that runs in a millisecond.
 */

/** Ceiling on one submit, matched by the add-row script in products.tsx. */
export const maxRows = 20

export interface DraftProduct {
  /** Row number as the operator sees it, for error messages. */
  row: number
  title: string
  description: string
  pricePaisa: number
  files: File[]
}

/**
 * A row with nothing in it is not a mistake, it is an unused row; a row with a
 * title and no price is. Rejecting the whole submit over one typo would throw
 * away the other nineteen rows of typing, so bad rows are reported by number
 * and the rest are saved.
 */
export function parseRows(form: FormData): { drafts: DraftProduct[]; problems: string[] } {
  const drafts: DraftProduct[] = []
  const problems: string[] = []

  for (let i = 0; i < maxRows; i++) {
    const title = String(form.get(`title-${i}`) ?? '').trim()
    const price = String(form.get(`price-${i}`) ?? '').trim()
    const description = String(form.get(`desc-${i}`) ?? '').trim()
    const files = form.getAll(`photos-${i}`).filter((f): f is File => f instanceof File && f.size > 0)

    if (!title && !price && !description && files.length === 0) continue

    const label = `Row ${i + 1}`
    if (!title) {
      problems.push(`${label}: no title, skipped`)
      continue
    }
    const priceBdt = Number(price)
    if (!price || !Number.isFinite(priceBdt) || priceBdt <= 0) {
      problems.push(`${label} (${title}): price must be a number above 0, skipped`)
      continue
    }
    // Money is integer paisa everywhere (ADR-0006); round at the boundary, once.
    drafts.push({ row: i + 1, title, description, pricePaisa: Math.round(priceBdt * 100), files })
  }

  return { drafts, problems }
}

/**
 * The slug is derived rather than typed: it is a URL, it has one obviously
 * correct value, and asking for it twenty times is exactly the field a bulk
 * form exists to remove. A title with nothing ASCII in it — Bengali, say —
 * slugifies to nothing, so it falls back and uniqueSlug numbers it.
 */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '')
  return slug || 'product'
}

/**
 * First free slug of the form base, base-2, base-3 … `taken` carries both the
 * slugs already in the database and the ones earlier rows of this same submit
 * have just claimed, which is the collision the unique index would otherwise
 * catch halfway through a batch.
 */
export function uniqueSlug(base: string, taken: Set<string>): string {
  let slug = base
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`
  taken.add(slug)
  return slug
}
