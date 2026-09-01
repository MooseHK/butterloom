/**
 * Variant labels are free text, and the database can only order them the way it
 * orders any text — which puts a size row on a product page in the order L, M,
 * S. Nobody reads a size row that way, so it is sorted here instead.
 *
 * ponytail: a fixed list of the sizes we actually sell, not an ordering column
 * on product_stock. Add the column when a product needs an order this list
 * cannot express — a run of numeric sizes, say, or a colour range with a
 * meaning of its own.
 */
const SIZE_ORDER = [
  'xxs',
  'xs',
  's',
  'small',
  'm',
  'md',
  'medium',
  'l',
  'large',
  'xl',
  'xxl',
  '2xl',
  'xxxl',
  '3xl',
  'free',
  'free size',
  'one size',
]

/** Where a label sits in the size run, or past the end of it if it is not a size. */
export function sizeRank(label: string): number {
  const found = SIZE_ORDER.indexOf(label.trim().toLowerCase())
  return found === -1 ? SIZE_ORDER.length : found
}

/**
 * Sizes in the order a person reads them, then everything else alphabetically.
 * Stable for labels that are not sizes, so a colour range keeps whatever order
 * the operator gave it in the admin.
 */
export function sortVariants<T extends { variantLabel: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const byRank = sizeRank(a.variantLabel) - sizeRank(b.variantLabel)
    if (byRank !== 0) return byRank
    return a.variantLabel.localeCompare(b.variantLabel)
  })
}
