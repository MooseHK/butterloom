/**
 * One slugifier for everything that becomes a URL segment or a filter value:
 * product slugs, category slugs, and the name/value pair on a variant option.
 *
 * It lives here rather than in the admin because the storefront reads what the
 * admin writes — a filter link is built from a slug on one side and matched
 * against a slug on the other, and two implementations of "lowercase it and
 * hyphenate" is exactly how those two sides quietly stop agreeing.
 */
export function slugify(value: string, fallback: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '')
  return slug || fallback
}
