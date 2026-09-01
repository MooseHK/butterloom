/**
 * Reading and writing the listing's query string.
 *
 * Filter and sort are GET parameters rather than script state because ADR-0007
 * makes every catalogue page an edge-cached document: a filtered view has to be
 * its own URL or it cannot be cached, shared, or crawled at all.
 *
 * That same property is why this file is strict about what a URL may say. Every
 * distinct query string is a distinct entry in the CDN's cache, so a parameter
 * nobody validates is an unbounded number of cache entries anyone can mint by
 * appending junk. So: unknown axes and unknown values are dropped, the rest is
 * sorted into one canonical order, and the route redirects anything that is not
 * already in that order. `?size=m&colour=indigo` and `?colour=indigo&size=m`
 * are one page and one cache entry.
 *
 * No database here on purpose — the caller passes in what the catalogue
 * actually offers, so the rules that decide what a URL means are testable
 * without opening one.
 */

export const sorts = ['newest', 'price-asc', 'price-desc'] as const
export type Sort = (typeof sorts)[number]

export const defaultSort: Sort = 'newest'

export const sortLabels: Record<Sort, string> = {
  newest: 'Newest',
  'price-asc': 'Price, low to high',
  'price-desc': 'Price, high to low',
}

/** Products per listing page. */
export const perPage = 24

/** Reserved query parameters, so no variant axis can collide with one. */
export const reservedParams = new Set(['sort', 'page', 'q'])

/** The longest a search term is allowed to be, for the reason given on `q` below. */
const maxQueryLength = 80

export interface OptionFilter {
  nameSlug: string
  /** Sorted and de-duplicated; within one axis these are alternatives, not a conjunction. */
  valueSlugs: string[]
}

export interface ListingParams {
  sort: Sort
  filters: OptionFilter[]
  page: number
  /** Free-text search, scope rather than a filter — see isSearching below. */
  q: string
}

export const emptyParams: ListingParams = { sort: defaultSort, filters: [], page: 1, q: '' }

/**
 * What the catalogue offers to filter on, in the scope being listed: axis slug
 * to the set of value slugs that exist. Anything outside it is not a filter,
 * it is a typo or a probe, and is dropped rather than turned into an empty
 * page with its own cache entry.
 */
export type Allowed = Map<string, Set<string>>

/**
 * Hono hands over repeated parameters as arrays and single ones as strings;
 * `?colour=indigo&colour=ecru` and `?colour=indigo,ecru` mean the same thing
 * and both have to arrive here as two values.
 */
export type RawQuery = Record<string, string | string[] | undefined>

function values(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return []
  const list = Array.isArray(raw) ? raw : [raw]
  return list.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean)
}

/**
 * The search box's own text, read straight off the query rather than through
 * `values()` above: that helper splits on commas because a filter's values are
 * a set, and a search term is prose that may itself contain one. Exported so
 * the route can read `q` before it has built the facet whitelist parsing the
 * rest of the params needs — facetsFor has to be scoped to this same term.
 *
 * Trimmed, collapsed and capped for the reason the file's header gives for
 * every other parameter here: an unvalidated string is an unbounded number of
 * CDN cache entries, and whitespace runs and length are the two unbounded
 * things a search box invites. Two spaces and one space must be one cache
 * entry, and there is no shopper for whom the 81st character of a search term
 * carries a query the 80th did not already.
 */
export function parseQuery(query: RawQuery): string {
  const raw = query.q
  const first = Array.isArray(raw) ? raw[0] : raw
  return (first ?? '').trim().replace(/\s+/g, ' ').slice(0, maxQueryLength)
}

export function parseListingParams(query: RawQuery, allowed: Allowed): ListingParams {
  const q = parseQuery(query)

  const sortRaw = values(query.sort)[0]
  const sort = (sorts as readonly string[]).includes(sortRaw ?? '') ? (sortRaw as Sort) : defaultSort

  const pageRaw = Number(values(query.page)[0] ?? 1)
  // A page number is a positive integer and nothing else. The upper bound is
  // the listing's own page count, which this file cannot know; the route clamps
  // it once it has counted, and Number.isSafeInteger keeps the arithmetic in
  // between from being handed 1e309.
  const page = Number.isSafeInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1

  const filters: OptionFilter[] = []
  for (const [key, raw] of Object.entries(query)) {
    if (reservedParams.has(key)) continue
    const permitted = allowed.get(key)
    if (!permitted) continue
    const valueSlugs = [...new Set(values(raw).filter((v) => permitted.has(v)))].sort()
    if (valueSlugs.length > 0) filters.push({ nameSlug: key, valueSlugs })
  }
  // Axes sorted too: the canonical URL must not depend on the order the browser
  // happened to serialise the filter form in.
  filters.sort((a, b) => a.nameSlug.localeCompare(b.nameSlug))

  return { sort, filters, page, q }
}

/**
 * The canonical query string for a set of params — empty when everything is at
 * its default, so the unfiltered listing is the bare path rather than
 * `?sort=newest&page=1`.
 */
export function listingSearch(params: ListingParams): string {
  const search = new URLSearchParams()
  // First, when present, so the canonical URL reads as a sentence — what is
  // being searched for, then what it is narrowed by — and so `?q=` and
  // `?colour=` never trade places and mint a second cache entry for one page.
  if (params.q) search.set('q', params.q)
  for (const filter of params.filters) search.set(filter.nameSlug, filter.valueSlugs.join(','))
  if (params.sort !== defaultSort) search.set('sort', params.sort)
  if (params.page > 1) search.set('page', String(params.page))
  const query = search.toString()
  return query ? `?${query}` : ''
}

export function listingHref(basePath: string, params: ListingParams): string {
  return `${basePath}${listingSearch(params)}`
}

/**
 * The same listing with one filter value toggled on or off, always back at page
 * one — page four of an unfiltered listing is rarely page four of a filtered
 * one, and landing on an empty page is a worse answer than landing on the first.
 */
export function toggleValue(params: ListingParams, nameSlug: string, valueSlug: string): ListingParams {
  const filters: OptionFilter[] = []
  let matched = false
  for (const filter of params.filters) {
    if (filter.nameSlug !== nameSlug) {
      filters.push(filter)
      continue
    }
    matched = true
    const valueSlugs = filter.valueSlugs.includes(valueSlug)
      ? filter.valueSlugs.filter((v) => v !== valueSlug)
      : [...filter.valueSlugs, valueSlug].sort()
    if (valueSlugs.length > 0) filters.push({ nameSlug, valueSlugs })
  }
  if (!matched) filters.push({ nameSlug, valueSlugs: [valueSlug] })
  filters.sort((a, b) => a.nameSlug.localeCompare(b.nameSlug))
  return { ...params, filters, page: 1 }
}

export function withSort(params: ListingParams, sort: Sort): ListingParams {
  return { ...params, sort, page: 1 }
}

export function withPage(params: ListingParams, page: number): ListingParams {
  return { ...params, page }
}

export function isFiltered(params: ListingParams): boolean {
  return params.filters.length > 0
}

/**
 * A search is a scope, per CONTEXT.md's Facet entry, not a refinement — the
 * same shape as being on a Category rather than All items. Kept separate from
 * isFiltered so a route can tell "narrowed by colour" from "narrowed to this
 * search" and word an empty state accordingly.
 */
export function isSearching(params: ListingParams): boolean {
  return params.q.length > 0
}

export function hasValue(params: ListingParams, nameSlug: string, valueSlug: string): boolean {
  return params.filters.some((f) => f.nameSlug === nameSlug && f.valueSlugs.includes(valueSlug))
}
