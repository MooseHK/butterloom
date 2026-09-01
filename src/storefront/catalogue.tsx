import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Category } from '../db/schema.js'
import { formatPaisa } from '../lib/money.js'
import { Seal, StorefrontLayout } from '../views/storefront.js'
import { Picture } from '../views/picture.js'
import {
  allowedFrom,
  axesOf,
  facetsFor,
  findCategoryBySlug,
  findProductBySlug,
  findSiteImage,
  listCategories,
  listProducts,
  variantsForProduct,
} from './queries.js'
import type { Facet, ImageWithDerivatives, ProductListing } from './queries.js'
import {
  hasValue,
  isFiltered,
  listingHref,
  listingSearch,
  parseListingParams,
  sortLabels,
  sorts,
  toggleValue,
  withPage,
} from './listing.js'

export const storefront = new Hono()

/**
 * Sizes tell the browser how wide the image will render before any CSS has
 * been parsed, which is what lets it pick a rung of the ladder on the first
 * pass. They have to track the grid and the gallery in views/storefront.tsx,
 * and the percentages resolve against main's content box — 100vw − 40px of
 * padding, capped at 40rem — not against the viewport. Working from that:
 *
 * - Cards are auto-fill from a 150px minimum with a 14px gap, so two columns
 *   need 314px of content box: one column below a 354px viewport, two up to
 *   517px, three from 518px, and 190px once main hits its 640px cap.
 * - A gallery frame is 85% of that content box, i.e. 85vw − 34px, which is 510px
 *   at the cap. Claiming a bare 85vw overstates it by 11% on a phone and buys a
 *   whole extra rung of image for nothing.
 */
const cardSizes =
  '(min-width: 640px) 190px, (min-width: 518px) 30vw, (min-width: 354px) 45vw, calc(100vw - 40px)'
const shotSizes = '(min-width: 640px) 510px, calc(85vw - 34px)'

/** The front-page rail is a fixed-width scroll-snap row, so this is one number. */
const railSizes = '168px'

/**
 * The hero bleeds to the edge of main, which is the viewport on a phone and
 * capped at main's own 40rem above that — not the full window. Claiming 100vw
 * on a wide screen would buy a rung of image the page never paints.
 */
const heroSizes = '(min-width: 640px) 640px, 100vw'

storefront.get('/', (c) => {
  const hero = findSiteImage('hero')
  // A tile onto an empty shelf is a dead end, so the front page draws only the
  // shelves with something standing on them — the admin still needs to see the
  // rest, which is why listCategories returns them all.
  const shelves = listCategories().filter((shelf) => shelf.productCount > 0)
  const newest = listProducts({ limit: 6 }).listings

  return c.html(
    <StorefrontLayout title="butterloom" canonicalPath="/">
      <main>
        {/*
          The hero slot is empty until an operator fills it, and the front page
          has to stand up either way — so the seal block is not a placeholder
          for the photograph, it is what the page is without one.
        */}
        {hero ? (
          <section class="hero">
            <Picture
              image={hero.image}
              derivatives={hero.derivatives}
              sizes={heroSizes}
              // The largest paint on the page and the first thing above the
              // fold: lazy-loading it would defer exactly the byte the whole
              // edge-cached architecture exists to deliver quickly.
              loading="eager"
              className="hero-shot"
            />
          </section>
        ) : (
          <div class="brand">
            <Seal alt="Butterloom — woven in comfort" />
          </div>
        )}
        <div class="head">
          <h1>The collection</h1>
        </div>
        {shelves.length > 0 ? (
          <section class="sec">
            <h2>Shop by piece</h2>
            <ul class="tiles">
              {shelves.map(({ category, productCount }) => (
                <li>
                  <a href={`/c/${category.slug}`}>
                    <b>{category.name}</b>
                    <span>{pieces(productCount)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {newest.length === 0 ? (
          <div class="detail">
            <p class="muted">Nothing here yet. New pieces are on their way.</p>
          </div>
        ) : (
          <section class="sec">
            <h2>New arrivals</h2>
            <ul class="rail">
              {newest.map((entry, index) => (
                <Card listing={entry} sizes={railSizes} eager={index < 2} />
              ))}
            </ul>
            <a class="btn" href="/shop">
              Shop all pieces
            </a>
          </section>
        )}
      </main>
    </StorefrontLayout>,
  )
})

storefront.get('/shop', (c) => listing(c, '/shop', null))

storefront.get('/c/:slug', (c) => {
  const category = findCategoryBySlug(c.req.param('slug'))
  if (!category) return c.notFound()
  return listing(c, `/c/${category.slug}`, category)
})

/**
 * All items and one shelf are the same document with a different scope, so they
 * are one function.
 *
 * Every control on it is a link or a GET form, which is not restraint for its
 * own sake: ADR-0007 makes this page an edge-cached document, and a filtered
 * view held in script state would have no URL to cache, share or crawl.
 */
function listing(c: Context, basePath: string, category: Category | null) {
  const scopeId = category?.id ?? null
  const facets = facetsFor(scopeId)
  const requested = parseListingParams(c.req.queries(), allowedFrom(facets))
  const results = listProducts({ categoryId: scopeId, params: requested })
  // parseListingParams cannot clamp the page — it has counted nothing — so page
  // nine of a three-page shelf becomes page three here. Folding the clamp into
  // the canonical URL rather than only into the query is what makes those two
  // one cache entry instead of two URLs serving byte-identical HTML.
  const params = withPage(requested, results.page)
  const search = listingSearch(params)

  // Every distinct query string is a distinct entry in the CDN's cache, so this
  // listing gets exactly one URL and everything else is sent to it: ?sort=newest,
  // ?page=1, re-ordered filters, junk parameters. The target parses back to
  // these same params, which is what keeps this off a redirect loop.
  if (new URL(c.req.url).search !== search) return c.redirect(basePath + search, 301)

  const heading = category ? category.name : 'All items'
  const filtered = isFiltered(params)
  const applied = params.filters.reduce((n, f) => n + f.valueSlugs.length, 0)

  return c.html(
    <StorefrontLayout title={`${heading} — butterloom`} canonicalPath={basePath + search}>
      <main>
        <div class="head">
          {category ? (
            <nav class="crumbs" aria-label="Breadcrumb">
              <a href="/shop">All items</a>
              <i class="dot" />
              <b aria-current="page">{category.name}</b>
            </nav>
          ) : null}
          <h1>{heading}</h1>
          <span>{pieces(results.total)}</span>
        </div>

        {results.total > 0 || filtered ? (
          <details class="controls">
            <summary>{applied > 0 ? `Filter and sort (${applied})` : 'Filter and sort'}</summary>
            {/*
              No page input: applying always lands on page one, because page four
              of an unfiltered listing is rarely page four of a filtered one.
            */}
            <form method="get" action={basePath}>
              <div>
                <label class="label" for="sort">
                  Sort
                </label>
                <select id="sort" name="sort">
                  {sorts.map((sort) => (
                    <option value={sort} selected={sort === params.sort}>
                      {sortLabels[sort]}
                    </option>
                  ))}
                </select>
              </div>
              {/*
                The axes offered are the ones present in this scope, and they do
                not narrow to what is in stock: ADR-0007 keeps availability out
                of cached HTML, and a filter that hid sold-out variants would be
                exactly the stale assertion that promise exists to prevent.
              */}
              {facets.map((facet) => (
                <fieldset>
                  <legend>{facet.name}</legend>
                  <div class="values">
                    {facet.values.map((value) => (
                      <label for={`${facet.nameSlug}-${value.valueSlug}`}>
                        <input
                          type="checkbox"
                          id={`${facet.nameSlug}-${value.valueSlug}`}
                          name={facet.nameSlug}
                          value={value.valueSlug}
                          checked={hasValue(params, facet.nameSlug, value.valueSlug)}
                        />
                        {value.value}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <button class="btn" type="submit">
                Apply
              </button>
            </form>
          </details>
        ) : null}

        {filtered ? (
          <ul class="chips">
            {params.filters.flatMap((filter) =>
              filter.valueSlugs.map((valueSlug) => {
                const label = describe(facets, filter.nameSlug, valueSlug)
                return (
                  <li>
                    {/* The axis name travels with the value: "Indigo" on its own
                        stops reading as a colour once three axes are applied. */}
                    <a
                      class="chip"
                      href={listingHref(basePath, toggleValue(params, filter.nameSlug, valueSlug))}
                      aria-label={`Remove ${label}`}
                    >
                      {label}
                      <span aria-hidden="true">×</span>
                    </a>
                  </li>
                )
              }),
            )}
            <li>
              <a class="clear" href={basePath}>
                Clear all
              </a>
            </li>
          </ul>
        ) : null}

        {results.listings.length === 0 ? (
          <div class="detail">
            <p class="muted">
              {filtered ? (
                <>
                  Nothing matches those filters. <a href={basePath}>Clear all</a>.
                </>
              ) : (
                'Nothing here yet. New pieces are on their way.'
              )}
            </p>
          </div>
        ) : (
          <ul class="grid">
            {results.listings.map((entry, index) => (
              <Card listing={entry} sizes={cardSizes} eager={index < 2} />
            ))}
          </ul>
        )}

        {results.pageCount > 1 ? (
          <nav class="pages" aria-label="Pagination">
            {params.page > 1 ? (
              <a
                class="prev"
                rel="prev"
                href={listingHref(basePath, withPage(params, params.page - 1))}
              >
                Previous
              </a>
            ) : null}
            <span aria-current="page">
              Page {params.page} of {results.pageCount}
            </span>
            {params.page < results.pageCount ? (
              <a
                class="next"
                rel="next"
                href={listingHref(basePath, withPage(params, params.page + 1))}
              >
                Next
              </a>
            ) : null}
          </nav>
        ) : null}
      </main>
    </StorefrontLayout>,
  )
}

storefront.get('/p/:slug', (c) => {
  const detail = findProductBySlug(c.req.param('slug'))
  if (!detail) return c.notFound()
  const { product, images } = detail
  // Collapsed to axes and read for nothing else: a variant row carries a
  // stock_qty, and this is the page where rendering it would be most tempting
  // and least honest.
  const axes = axesOf(variantsForProduct(product.id))

  return c.html(
    <StorefrontLayout
      title={`${product.title} — butterloom`}
      description={summarise(product.description) || undefined}
      canonicalPath={`/p/${product.slug}`}
    >
      <main>
        <Shots images={images} />
        <div class="detail">
          <h1>{product.title}</h1>
          <p class="price">{formatPaisa(product.pricePaisa)}</p>
          {product.description ? <p class="description">{product.description}</p> : null}
          {/*
            No availability is rendered here, and none ever should be: this
            page is cached at the edge, and ADR-0007 keeps the promise that a
            stale page cannot assert something false about stock by having it
            assert nothing. Stock is resolved at placement, against Reservation.
            So the axes below say what this piece comes in, never what is left
            of it, and they are type rather than a picker — there is no cart to
            pick into yet.
          */}
          {axes.length > 0 ? (
            <dl class="axes">
              {axes.map((axis) => (
                <>
                  <dt>{axis.name}</dt>
                  <dd>
                    {axis.values.map((value) => (
                      <span class="chip">{value.value}</span>
                    ))}
                  </dd>
                </>
              ))}
            </dl>
          ) : null}
          {/* The strip above and the footer below already say where we deliver;
              what belongs at the point of decision is how you can pay. */}
          <p class="muted">Cash on delivery, or bKash.</p>
        </div>
      </main>
    </StorefrontLayout>,
  )
})

function Card(props: { listing: ProductListing; sizes: string; eager: boolean }) {
  const { product, cover } = props.listing
  return (
    <li class="card">
      <a href={`/p/${product.slug}`}>
        {cover ? (
          <Picture
            image={cover.image}
            derivatives={cover.derivatives}
            sizes={props.sizes}
            // The first row is above the fold on a phone; lazy-loading it would
            // delay the largest paint on the slow networks this whole
            // architecture is built around.
            loading={props.eager ? 'eager' : 'lazy'}
          />
        ) : (
          <div class="placeholder">No photograph yet</div>
        )}
        <h2>{product.title}</h2>
        <p>{formatPaisa(product.pricePaisa)}</p>
      </a>
    </li>
  )
}

/**
 * A horizontal scroll-snap row, not a stack. Stacking put the price a screen
 * and a half below the fold on a phone, which was the finding of the design
 * pass; snapping is CSS, so the fix costs no script.
 */
function Shots(props: { images: ImageWithDerivatives[] }) {
  if (props.images.length === 0) {
    return <div class="placeholder">No photograph yet</div>
  }
  return (
    <ul class="gallery">
      {props.images.map(({ image, derivatives }, index) => (
        <li>
          <Picture
            image={image}
            derivatives={derivatives}
            sizes={shotSizes}
            loading={index === 0 ? 'eager' : 'lazy'}
          />
        </li>
      ))}
    </ul>
  )
}

function pieces(n: number): string {
  return `${n} ${n === 1 ? 'piece' : 'pieces'}`
}

/** "Colour: Indigo", falling back to the slugs if a value left the catalogue mid-request. */
function describe(facets: Facet[], nameSlug: string, valueSlug: string): string {
  const facet = facets.find((f) => f.nameSlug === nameSlug)
  const value = facet?.values.find((v) => v.valueSlug === valueSlug)
  return `${facet?.name ?? nameSlug}: ${value?.value ?? valueSlug}`
}

/** A meta description is one line; the field is free text over many. */
function summarise(description: string): string {
  const flattened = description.replace(/\s+/g, ' ').trim()
  return flattened.length > 155 ? `${flattened.slice(0, 152).trimEnd()}…` : flattened
}

/** Shared 404 page, so a mistyped slug still looks like the shop. */
export function notFound(c: Context) {
  return c.html(
    <StorefrontLayout title="butterloom" canonicalPath={c.req.path}>
      <main>
        <div class="head">
          <h1>Not found</h1>
        </div>
        <div class="detail">
          <p class="muted">
            That page does not exist. <a href="/">Back to the collection</a>.
          </p>
        </div>
      </main>
    </StorefrontLayout>,
    404,
  )
}
