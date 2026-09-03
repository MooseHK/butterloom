import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Category } from '../db/schema.js'
import { formatPaisa } from '../lib/money.js'
import { config } from '../config.js'
import { Seal, StorefrontLayout } from '../views/storefront.js'
import { Picture } from '../views/picture.js'
import {
  allowedFrom,
  facetsFor,
  findCategoryBySlug,
  findProductBySlug,
  findSiteImage,
  listCategories,
  listProducts,
  listProductsBySlugs,
} from './queries.js'
import type { Facet, ImageWithDerivatives, ProductListing } from './queries.js'
import {
  emptyParams,
  hasValue,
  isFiltered,
  isSearching,
  listingHref,
  listingSearch,
  parseListingParams,
  parseQuery,
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

/**
 * `q` is parsed by listing() itself, the same as it would be off `/shop` or
 * `/c/:slug` — this route exists to give search a memorable address and a
 * heading of its own, not because the term is handled any differently once
 * it arrives. A shopper who searches, then filters to Colour: Indigo, is
 * still on this one function.
 */
storefront.get('/search', (c) => listing(c, '/search', null))

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
  // Read before the facet whitelist is built, so a search's facets are scoped
  // to its results rather than to the whole catalogue — see facetsFor.
  const q = parseQuery(c.req.queries())
  const facets = facetsFor(scopeId, { q })
  const requested = parseListingParams(c.req.queries(), allowedFrom(facets))
  const results = listProducts({ categoryId: scopeId, params: requested, q: requested.q })
  // parseListingParams cannot clamp the page — it has counted nothing — so page
  // nine of a three-page shelf becomes page three here. Folding the clamp into
  // the canonical URL rather than only into the query is what makes those two
  // one cache entry instead of two URLs serving byte-identical HTML.
  const params = withPage(requested, results.page)
  const search = listingSearch(params)

  // Every distinct query string is a distinct entry in the CDN's cache, so this
  // listing gets exactly one URL and everything else is sent to it: ?sort=newest,
  // ?page=1, re-ordered filters, junk parameters, `?q=` however a shopper's
  // browser padded it with whitespace. The target parses back to these same
  // params, which is what keeps this off a redirect loop.
  if (new URL(c.req.url).search !== search) return c.redirect(basePath + search, 301)

  const searching = basePath === '/search'
  const filtered = isFiltered(params)
  const applied = params.filters.reduce((n, f) => n + f.valueSlugs.length, 0)
  // /shop and /c/:slug keep their own heading regardless of a `?q=` a shopper
  // could still hand-add to either — only /search's own address speaks about
  // the search itself.
  const heading = searching
    ? isSearching(params)
      ? `Results for “${params.q}”`
      : 'Search'
    : category
      ? category.name
      : 'All items'
  // A search result is a page nobody should be sent to from a search engine —
  // every distinct `?q=` a visitor can type is a junk URL in Google's index,
  // and Google says so outright. `follow`, not `nofollow`: the products linked
  // from it are exactly as worth crawling as ever.
  const noindex = searching && isSearching(params)
  // The bare /search landing has nothing to list yet, so it offers a way in
  // rather than an empty grid — the same tiles the front page draws.
  const landing = searching && !isSearching(params)
  const shelves = landing ? listCategories().filter((shelf) => shelf.productCount > 0) : []

  return c.html(
    <StorefrontLayout
      title={`${heading} — butterloom`}
      canonicalPath={basePath + search}
      noindex={noindex}
    >
      <main>
        <SearchForm q={params.q} />
        <div class="head">
          {category ? (
            <nav class="crumbs" aria-label="Breadcrumb">
              <a href="/shop">All items</a>
              <i class="dot" />
              <b aria-current="page">{category.name}</b>
            </nav>
          ) : null}
          <h1>{heading}</h1>
          {landing ? null : <span>{pieces(results.total)}</span>}
        </div>

        {landing ? (
          shelves.length > 0 ? (
            <section class="sec">
              <h2>Shop by piece</h2>
              <ul class="tiles">
                {shelves.map(({ category: shelf, productCount }) => (
                  <li>
                    <a href={`/c/${shelf.slug}`}>
                      <b>{shelf.name}</b>
                      <span>{pieces(productCount)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null
        ) : (
          <>
            {results.total > 0 || filtered ? (
              <details class="controls">
                <summary>{applied > 0 ? `Filter and sort (${applied})` : 'Filter and sort'}</summary>
                {/*
                  No page input: applying always lands on page one, because page four
                  of an unfiltered listing is rarely page four of a filtered one.
                */}
                <form method="get" action={basePath}>
                  {/* A search's own scope travels with the form as a hidden field
                      rather than an input a shopper could clear by accident:
                      applying a filter must narrow the search, never drop it. */}
                  {params.q ? <input type="hidden" name="q" value={params.q} /> : null}
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
                  {/* Preserves `q`: clearing a colour inside a search must not
                      throw the search away along with it. */}
                  <a class="clear" href={listingHref(basePath, { ...emptyParams, q: params.q })}>
                    Clear all
                  </a>
                </li>
              </ul>
            ) : null}

            {results.listings.length === 0 ? (
              <div class="detail">
                <p class="muted">
                  {isSearching(params) ? (
                    <>
                      Nothing matches “{params.q}”. <a href="/shop">All items</a>.
                    </>
                  ) : filtered ? (
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
          </>
        )}
      </main>
    </StorefrontLayout>,
  )
}

/**
 * A GET form landing on `/search?q=…` — an edge-cacheable URL, per ADR-0007 —
 * rather than fetch and a results panel. Autocomplete and instant results are
 * where most storefronts spend their whole JavaScript budget. Ours is no longer
 * the pinch it was — ADR-0007 now allows 200KB — but the byte count was never
 * the reason this is a form: a typed URL is a page that caches, is shareable and
 * can be crawled, and the version below is the one that still works on the
 * networks the ADR was written for, before a single byte of script would have
 * had the chance to run.
 */
function SearchForm(props: { q: string }) {
  return (
    <form class="search" method="get" action="/search">
      <input
        type="search"
        name="q"
        value={props.q}
        placeholder="Search the collection"
        aria-label="Search the collection"
        autocomplete="off"
      />
      <button class="btn" type="submit">
        Search
      </button>
    </form>
  )
}

/** The shape slugify() produces — never anything a visitor's browser typed. */
const slugPattern = /^[a-z0-9-]{1,80}$/

/**
 * The recently-viewed rail's own data, as an edge-cacheable fragment rather
 * than a route the CDN sees a fresh URL for on every visit. `?p=` is sorted
 * before it reaches here, so a visitor who saw A then B and one who saw B
 * then A share one cache entry; the client script (below) restores whichever
 * order that visitor actually saw them in. There is deliberately no 301 here
 * to a canonical form the way `listing()` above has one — the only caller is
 * our own script, which already sorts, dedupes and caps the list, so a
 * redirect would just add a round trip for traffic that does not exist. The
 * four-item cap is applied before the query runs, not after, so `?p=` cannot
 * be used to build an arbitrarily large `IN` clause.
 *
 * Nothing here echoes the query string back: the only thing rendered is rows
 * `listProductsBySlugs` returned from the database, which Hono JSX escapes
 * like any other child, and `p` itself never reaches a query except filtered
 * through the slug whitelist and packed into a parameterised `inArray`.
 */
storefront.get('/recently-viewed', (c) => {
  const slugs = [...new Set((c.req.query('p') ?? '').split(',').map((s) => s.trim()))]
    .filter((s) => s.length > 0 && slugPattern.test(s))
    .sort()
    .slice(0, 4)

  const listings = listProductsBySlugs(slugs)

  // Always 200, even with nothing to show: edgeCacheable only marks a 200
  // cacheable, and an empty rail for a set of slugs that all left the
  // catalogue is exactly the answer worth caching rather than re-deriving.
  return c.html(<>{listings.map((entry) => <Card listing={entry} sizes={railSizes} eager={false} />)}</>)
})

export const defaultBanglaReturnPolicy =
  'পণ্য হাতে পাওয়ার পর কোনো ত্রুটি, ক্ষতি বা অমিল দেখা দিলে ৭ দিনের মধ্যে আমাদের সাথে যোগাযোগ করুন। অক্ষত অবস্থায় পণ্য ফেরত দিয়ে সম্পূর্ণ মূল্য ফেরত অথবা পণ্য পরিবর্তন করা যাবে। ডেলিভারি ব্যর্থতার ক্ষেত্রে ১০ দিনের মধ্যে সম্পূর্ণ অর্থ যে মাধ্যমে পরিশোধ করা হয়েছিল সে মাধ্যমেই ফেরত দেওয়া হবে।'

function PolicyPage(props: {
  title: string
  canonicalPath: string
  heading: string
  children: any
}) {
  return (
    <StorefrontLayout title={`${props.title} — butterloom`} canonicalPath={props.canonicalPath}>
      <main>
        <nav class="crumbs" aria-label="Breadcrumb">
          <a href="/">The collection</a>
          <i class="dot" />
          <b aria-current="page">{props.heading}</b>
        </nav>
        <div class="head" style="margin-bottom: 24px;">
          <h1>{props.heading}</h1>
        </div>
        <article class="detail" style="font-size: 15px; line-height: 1.8; color: var(--secondary);">
          {props.children}
        </article>
      </main>
    </StorefrontLayout>
  )
}

storefront.get('/terms', (c) => {
  return c.html(
    <PolicyPage title="ব্যবহারের শর্তাবলী" canonicalPath="/terms" heading="ব্যবহারের শর্তাবলী">
      <h2 style="font-size: 16px; margin: 18px 0 8px; color: var(--ink);">১. ভূমিকা</h2>
      <p>বাটারলুম (Butterloom)-এ আপনাকে স্বাগতম। এই ওয়েবসাইটে পণ্য ব্রাউজ এবং অর্ডার করার মাধ্যমে আপনি এই ব্যবহারের শর্তাবলীর সাথে সম্মত হচ্ছেন।</p>
      <h2 style="font-size: 16px; margin: 18px 0 8px; color: var(--ink);">২. মূল্য ও ভ্যাট</h2>
      <p>ওয়েবসাইটে প্রদর্শিত সকল পণ্যের মূল্য বাংলাদেশ সরকারের বিধি মোতাবেক মূল্য সংযোজন কর (ভ্যাট) সহ অন্তর্ভুক্ত। ভোক্তা অধিকার সংরক্ষণ আইন ২০০৯ এর ধারা ৪০ অনুযায়ী প্রদর্শিত মূল্যের অতিরিক্ত কোনো অর্থ দাবি করা হবে না।</p>
      <h2 style="font-size: 16px; margin: 18px 0 8px; color: var(--ink);">৩. অর্ডার ও পেমেন্ট</h2>
      <p>আমরা বর্তমানে ক্যাশ অন ডেলিভারি (Cash on Delivery) পদ্ধতিতে সমগ্র বাংলাদেশে পণ্য সরবরাহ করি। পণ্য হাতে পাওয়ার পর কুরিয়ার প্রতিনিধিকে নির্ধারিত মূল্য পরিশোধ করতে হবে।</p>
      <h2 style="font-size: 16px; margin: 18px 0 8px; color: var(--ink);">৪. ডেলিভারি সময়সীমা</h2>
      <p>ডিজিটাল কমার্স পরিচালনা নির্দেশিকা ২০২১ অনুযায়ী, একই শহরের ভিতরে সর্বোচ্চ ৫ ক্যালেন্ডার দিন এবং অন্যান্য অঞ্চলে সর্বোচ্চ ১০ ক্যালেন্ডার দিনের মধ্যে পণ্য ডেলিভারি সম্পন্ন করা হবে। অর্ডার নিশ্চিতের ৪৮ ঘণ্টার মধ্যে পণ্য কুরিয়ারে হস্তান্তর করা হয়।</p>
      <h2 style="font-size: 16px; margin: 18px 0 8px; color: var(--ink);">৫. বুদ্ধিবৃত্তিক সম্পদ</h2>
      <p>এই ওয়েবসাইটে ব্যবহৃত সকল ছবি, লোগো, টেকস্ট এবং ডিজাইন বাটারলুমের নিজস্ব সম্পত্তি। অনুমতি ব্যতীত এগুলো ব্যবহার আইনত দণ্ডনীয়।</p>
    </PolicyPage>,
  )
})

storefront.get('/returns', (c) => {
  return c.html(
    <PolicyPage title="রিটার্ন ও রিফান্ড নীতিমালা" canonicalPath="/returns" heading="রিটার্ন ও রিফান্ড নীতি">
      <h2 style="font-size: 16px; margin: 18px 0 8px; color: var(--ink);">১. রিটার্ন অধিকার</h2>
      <p>ডিজিটাল কমার্স পরিচালনা নির্দেশিকা ২০২১ অনুযায়ী, গ্রাহক পণ্য গ্রহণের পর ত্রুটি, ছেঁড়া, ক্ষতিগ্রস্ত বা ভুল পণ্য পাওয়ার ক্ষেত্রে ৭ ক্যালেন্ডার দিনের মধ্যে রিটার্নের আবেদন করতে পারবেন।</p>
      <h2 style="font-size: 16px; margin: 18px 0 8px; color: var(--ink);">২. পণ্যের অবস্থা</h2>
      <p>পণ্যটি অব্যবহৃত এবং অক্ষত মূল ট্যাগ ও প্যাকেজিংসহ ফেরত দিতে হবে।</p>
      <h2 style="font-size: 16px; margin: 18px 0 8px; color: var(--ink);">৩. রিফান্ডের সময়সীমা ও মাধ্যম</h2>
      <p>ডেলিভারি ব্যর্থ হলে বা বৈধ রিটার্ন নিশ্চিত হলে ১০ ক্যালেন্ডার দিনের মধ্যে গ্রাহকের মূল পরিশোধিত মাধ্যমে অর্থ ফেরত দেওয়া হবে। ক্যাশ অন ডেলিভারির ক্ষেত্রে গ্রাহকের নিজস্ব বিকাশ বা ব্যাংক অ্যাকাউন্টে রিফান্ড পাঠানো হবে।</p>
      <h2 style="font-size: 16px; margin: 18px 0 8px; color: var(--ink);">৪. রিফান্ড চার্জ</h2>
      <p>রিফান্ড প্রেরণের যাবতীয় ট্রানজেকশন ফি বাটারলুম বহন করবে; গ্রাহকের প্রাপ্য অর্থ থেকে কোনো চার্জ কর্তন করা হবে না।</p>
      <h2 style="font-size: 16px; margin: 18px 0 8px; color: var(--ink);">৫. বলপ্রয়োগ বা অনিবার্য পরিস্থিতি (Force Majeure)</h2>
      <p>অনিবার্য কারণে পণ্য সরবরাহে অপারগ হলে ৪৮ ঘণ্টার মধ্যে গ্রাহককে অবহিত করা হবে এবং ৭২ ঘণ্টার মধ্যে সম্পূর্ণ অর্থ ফেরত প্রদান করা হবে।</p>
    </PolicyPage>,
  )
})

storefront.get('/privacy', (c) => {
  return c.html(
    <PolicyPage title="গোপনীয়তা নীতি" canonicalPath="/privacy" heading="গোপনীয়তা নীতি">
      <h2 style="font-size: 16px; margin: 18px 0 8px; color: var(--ink);">১. তথ্যের সংগ্রহ ও উদ্দেশ্য</h2>
      <p>ব্যক্তিগত উপাত্ত সুরক্ষা আইন ২০২৬ (PDPA 2026) এর অধীনে আমরা গ্রাহকের নাম, ফোন নম্বর, এবং ডেলিভারি ঠিকানা সংগ্রহ করি শুধুমাত্র অর্ডার প্রক্রিয়াকরণ, কুরিয়ার ডেলিভারি ও ভ্যাট ইনভয়েস ইস্যু করার উদ্দেশ্যে।</p>
      <h2 style="font-size: 16px; margin: 18px 0 8px; color: var(--ink);">২. সম্মতি</h2>
      <p>অর্ডার প্রদানের সময় গ্রাহক এই গোপনীয়তা নীতি পাঠ করে স্পষ্ট সম্মতি প্রদান করেন। প্রতিটি সম্মতি সময় ও সংস্করণের রেকর্ডসহ সংরক্ষণ করা হয়।</p>
      <h2 style="font-size: 16px; margin: 18px 0 8px; color: var(--ink);">৩. তথ্য সংশোধনের অধিকার</h2>
      <p>গ্রাহক চাইলে ৩০ দিনের মধ্যে তাঁর প্রদত্ত নাম, ফোন নম্বর বা ঠিকানায় কোনো ভুল থাকলে তা সংশোধনের আবেদন করতে পারেন।</p>
      <h2 style="font-size: 16px; margin: 18px 0 8px; color: var(--ink);">৪. তথ্য মুছে ফেলা ও সংবিধিবদ্ধ সংরক্ষণ</h2>
      <p>ভ্যাট আইন ও ডিজিটাল কমার্স নির্দেশিকা অনুযায়ী ব্যবসায়িক লেনদেন ও ট্যাক্স রেকর্ড ন্যূনতম ৬ বছর সংরক্ষণ বাধ্যতামূলক। আইনানুগ মেয়াদের বাইরে থাকা ব্যক্তিগত তথ্য গ্রাহকের অনুরোধে মুছে ফেলা (Redaction) হবে।</p>
      <h2 style="font-size: 16px; margin: 18px 0 8px; color: var(--ink);">৫. তথ্য নিরাপত্তা</h2>
      <p>আমরা গ্রাহকের ব্যক্তিগত তথ্য কোনো তৃতীয় পক্ষের কাছে বিক্রয় বা বাণিজ্যিক উদ্দেশ্যে হস্তান্তর করি না।</p>
    </PolicyPage>,
  )
})

storefront.get('/contact', (c) => {
  return c.html(
    <PolicyPage title="যোগাযোগ ও অভিযোগ নিষ্পত্তি" canonicalPath="/contact" heading="যোগাযোগ ও অভিযোগ">
      <h2 style="font-size: 16px; margin: 18px 0 8px; color: var(--ink);">আমাদের সাথে যোগাযোগ</h2>
      <p>যেকোনো প্রশ্ন, পণ্যের বিবরণ বা সহযোগিতার জন্য আমাদের সাথে যোগাযোগ করুন:</p>
      <ul style="margin: 0 0 16px 20px; padding: 0;">
        <li><b>ইমেইল:</b> {config.complianceOfficerEmail}</li>
        <li><b>ফোন:</b> {config.complianceOfficerPhone}</li>
      </ul>
      <h2 style="font-size: 16px; margin: 18px 0 8px; color: var(--ink);">অভিযোগ নিষ্পত্তি কর্মকর্তা (Compliance Officer)</h2>
      <p>ডিজিটাল কমার্স পরিচালনা নির্দেশিকা ২০২১ অনুযায়ী আমাদের নির্ধারিত কমপ্লায়েন্স কর্মকর্তা:</p>
      <p>
        <b>নাম:</b> {config.complianceOfficerName}<br />
        <b>পদবি:</b> কমপ্লায়েন্স ও অভিযোগ নিষ্পত্তি কর্মকর্তা<br />
        <b>ফোন:</b> {config.complianceOfficerPhone}<br />
        <b>ইমেইল:</b> {config.complianceOfficerEmail}
      </p>
      <h2 style="font-size: 16px; margin: 18px 0 8px; color: var(--ink);">অভিযোগ নিষ্পত্তির সময়সীমা</h2>
      <p>যেকোনো অভিযোগ প্রাপ্তির সর্বোচ্চ ৭২ ঘণ্টার মধ্যে তা তদন্তপূর্বক নিষ্পত্তির আইনি বাধ্যবাধকতা আমরা মেনে চলি।</p>
    </PolicyPage>,
  )
})

storefront.get('/stock/:slug', (c) => {
  c.header('Cache-Control', 'private, no-store')
  const detail = findProductBySlug(c.req.param('slug'))
  if (!detail) return c.notFound()

  const variants: Record<string, number> = {}
  let totalStock = 0
  for (const v of detail.variants) {
    variants[String(v.variant.id)] = v.variant.stockQty
    totalStock += v.variant.stockQty
  }

  return c.json({
    slug: detail.product.slug,
    inStock: totalStock > 0,
    totalStock,
    variants,
  })
})

function stockScript(slug: string, defaultVariantId: number | null): string {
  return `
    (function() {
      var slug = ${JSON.stringify(slug)};
      var defaultVarId = ${JSON.stringify(defaultVariantId)};
      fetch('/stock/' + encodeURIComponent(slug))
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (!data) return;
          var indicator = document.getElementById('stock-indicator');
          var btn = document.getElementById('add-to-cart-btn');
          var form = document.getElementById('add-to-cart-form');
          if (!data.inStock) {
            if (indicator) {
              indicator.textContent = 'Out of stock';
              indicator.className = 'stock-indicator out-of-stock';
            }
            if (btn) {
              btn.disabled = true;
              btn.textContent = 'Sold out';
            }
            return;
          }
          function updateStock() {
            var checked = form ? form.querySelector('input[name="variant_id"]:checked') : null;
            var vId = checked ? checked.value : defaultVarId;
            var count = (data.variants && vId !== null && vId !== undefined) ? data.variants[vId] : data.totalStock;
            if (indicator) {
              if (count === undefined || count <= 0) {
                indicator.textContent = 'This selection is out of stock';
                indicator.className = 'stock-indicator out-of-stock';
                if (btn) { btn.disabled = true; btn.textContent = 'Sold out'; }
              } else if (count === 1) {
                indicator.textContent = 'Only 1 left in stock';
                indicator.className = 'stock-indicator low-stock';
                if (btn) { btn.disabled = false; btn.textContent = 'Add to cart'; }
              } else {
                indicator.textContent = count + ' in stock';
                indicator.className = 'stock-indicator in-stock';
                if (btn) { btn.disabled = false; btn.textContent = 'Add to cart'; }
              }
            }
          }
          var radios = form ? form.querySelectorAll('input[name="variant_id"]') : [];
          for (var i = 0; i < radios.length; i++) {
            var r = radios[i];
            var q = data.variants ? data.variants[r.value] : 0;
            var chip = r.nextElementSibling;
            if (chip && (q === undefined || q <= 0)) {
              chip.classList.add('disabled');
              chip.title = 'Sold out';
            }
            r.addEventListener('change', updateStock);
          }
          updateStock();
        })
        .catch(function() {});
    })();
  `
}

storefront.get('/p/:slug', (c) => {
  const detail = findProductBySlug(c.req.param('slug'))
  if (!detail) return c.notFound()
  const { product, images, variants, category } = detail

  // Main's rule, on the variant table rather than the stock table it was
  // written against: a lone unnamed configuration is not a choice to offer.
  const hasVariants =
    variants.length > 1 || (variants.length === 1 && variants[0]?.variant.label !== 'Standard')

  return c.html(
    <StorefrontLayout
      title={`${product.title} — butterloom`}
      description={summarise(product.description) || undefined}
      canonicalPath={`/p/${product.slug}`}
    >
      <main>
        {/* The wordmark goes home, but it reads as a logo. This says it in
            words, at the top of the one page a visitor arrives on from a
            search result with no idea what is above it.

            The shelf is the second step, and the one that matters most on this
            page: somebody who landed here from a search and likes what they
            see wants the other sarees, and until now the only way up was the
            whole collection. Same shape as the crumbs on a listing page, so
            the two read as one trail. Omitted for an unshelved product rather
            than shown dead — there is no page for "no shelf". */}
        <nav class="crumbs" aria-label="Breadcrumb">
          <a href="/">The collection</a>
          {category ? (
            <>
              <i class="dot" />
              <a href={`/c/${category.slug}`}>{category.name}</a>
            </>
          ) : null}
        </nav>
        <Shots images={images} />
        <div class="detail">
          <h1>{product.title}</h1>
          <p class="price">{formatPaisa(product.pricePaisa)}</p>
          {product.description ? <p class="description">{product.description}</p> : null}

          <form id="add-to-cart-form" class="buy" method="post" action="/cart/add">
            <input type="hidden" name="product_id" value={product.id} />

            {hasVariants ? (
              <fieldset class="variant-group">
                {/* Not "choose a size": a label is the axes joined, so it can
                    read "Indigo / M" as easily as "M". This heading has to be
                    true of whatever the operator configured. */}
                <legend class="variant-label">Choose one</legend>
                <div class="variant-options">
                  {variants.map(({ variant }, idx) => (
                    <label>
                      <input
                        type="radio"
                        name="variant_id"
                        value={variant.id}
                        class="variant-radio"
                        checked={idx === 0}
                        required
                      />
                      {/*
                        The label is already the option values joined — "Indigo
                        / M" — so the chip says what the axes would have said,
                        and says it as the thing you can actually pick.
                      */}
                      <span class="variant-chip">{variant.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : variants[0] ? (
              <input type="hidden" name="variant_id" value={variants[0].variant.id} />
            ) : null}

            <button type="submit" class="btn" id="add-to-cart-btn">
              Add to cart
            </button>
            {/*
              Empty in the bytes the CDN caches, and it has to stay that way for
              the same reason the recently-viewed rail below does: this document
              is served from the Dhaka PoP, so anything rendered here would be
              handed to the next shopper. The script above fills it from the
              reply to its own POST, which is per-shopper and uncached — which is
              precisely how a page that may not assert availability can still
              tell one person that this piece is sold out.
            */}
            <p class="buy-msg" id="add-to-cart-msg" role="alert" hidden />
          </form>

          {/* Live stock count indicator (Option A uncached stock fragment per DCOG 2021) */}
          <div id="stock-indicator" class="stock-indicator" aria-live="polite"></div>

          {/* DCOG 2021 compliance disclosures: mobile first & mobile only dropdowns */}
          <div class="acc">
            <details>
              <summary>
                <span>Measurements</span>
                <span class="acc-icon" aria-hidden="true">+</span>
              </summary>
              <div class="acc-body">
                <p>{product.measurements || 'Standard'}</p>
              </div>
            </details>

            <details>
              <summary>
                <span>Origin & Material</span>
                <span class="acc-icon" aria-hidden="true">+</span>
              </summary>
              <div class="acc-body">
                <p><b>Country of Origin:</b> {product.originCountry || 'Bangladesh'}</p>
                <p><b>Material:</b> {product.material || 'Cotton'}</p>
              </div>
            </details>

            <details>
              <summary>
                <span>Returns & Refunds (রিটার্ন ও রিফান্ড নীতি)</span>
                <span class="acc-icon" aria-hidden="true">+</span>
              </summary>
              <div class="acc-body">
                <p>{product.returnsPolicy || defaultBanglaReturnPolicy}</p>
                <p style="margin-top: 8px; font-size: 13.5px;">
                  বিস্তারিত তথ্যের জন্য আমাদের <a href="/returns">রিটার্ন ও রিফান্ড নীতি</a> পাতা দেখুন।
                </p>
              </div>
            </details>

            <details>
              <summary>
                <span>Delivery & Timeline</span>
                <span class="acc-icon" aria-hidden="true">+</span>
              </summary>
              <div class="acc-body">
                <p>
                  সারা বাংলাদেশে ডেলিভারি চার্জ ৳৮০ (ফ্ল্যাট রেট)। ঢাকায় ৫ ক্যালেন্ডার দিন এবং ঢাকার বাইরে ১০ ক্যালেন্ডার দিনের মধ্যে ডেলিভারি সম্পন্ন হয়।
                </p>
              </div>
            </details>
          </div>
        </div>
        {/*
          Empty and hidden in the bytes the CDN caches, and it has to stay that
          way: this page is served from the Dhaka PoP, so one visitor's rail
          rendered here would be handed to the next. It is filled by script
          from the /recently-viewed fragment below, or never — a visitor with
          script disabled or nothing in localStorage simply never sees it.
          data-slug carries this page's own slug to that script without a
          second lookup; the script strips it from the list before recording
          the view so a product's own page never appears in its own rail.
        */}
        <section class="sec" id="recent" hidden data-slug={product.slug}>
          <h2>Recently viewed</h2>
          <ul class="rail" id="recent-rail" />
        </section>
      </main>
      <script
        dangerouslySetInnerHTML={{
          __html: `
            var form = document.getElementById('add-to-cart-form');
            var btn = document.getElementById('add-to-cart-btn');
            var say = document.getElementById('add-to-cart-msg');
            if (form && btn) {
              form.addEventListener('submit', function(e) {
                e.preventDefault();
                var prevText = btn.textContent;
                btn.disabled = true;
                btn.textContent = 'Adding…';
                if (say) { say.hidden = true; say.textContent = ''; }
                fetch('/cart/add', {
                  method: 'POST',
                  body: new FormData(form),
                  headers: { 'Accept': 'application/json' }
                })
                /* The body is read whatever the status is: a refusal carries
                   the reason to print, and it is the only place that reason
                   exists — this page is edge-cached and cannot say a word
                   about stock on its own. */
                .then(function(r) { return r.json(); })
                .then(function(data) {
                  if (!data || data.ok !== true) {
                    /* Not "Added to cart ✓". The old script said that on
                       every reply it got, including the ones that were a
                       refusal, which is how adding a sold-out piece came to
                       look like it had worked. */
                    if (say) {
                      say.textContent = (data && data.error) || 'Could not add this to your cart.';
                      say.hidden = false;
                    }
                    btn.disabled = false;
                    btn.textContent = prevText;
                    return;
                  }
                  btn.textContent = 'Added to cart ✓';
                  var badge = document.getElementById('cart-badge');
                  if (badge && data.count) {
                    badge.textContent = data.count;
                    badge.hidden = false;
                  }
                  setTimeout(function() {
                    btn.disabled = false;
                    btn.textContent = prevText;
                  }, 1400);
                })
                .catch(function() {
                  form.submit();
                });
              });
            }
          `,
        }}
      />
      <script dangerouslySetInnerHTML={{ __html: stockScript(product.slug, variants[0]?.variant.id ?? null) }} />
      <script dangerouslySetInnerHTML={{ __html: recentlyViewedScript }} />
    </StorefrontLayout>,
  )
})

function Card(props: { listing: ProductListing; sizes: string; eager: boolean }) {
  const { product, cover } = props.listing
  return (
    // data-slug is only read by the recently-viewed fragment (its script
    // re-orders cards by it) but is cheap enough to emit on every card
    // rather than forking this component for one caller.
    <li class="card" data-slug={product.slug}>
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
          <p class="muted">This page does not exist, or the piece is no longer listed.</p>
          {/* A dead end wants a way out that a thumb can hit, not a word in a
              sentence. */}
          <div class="actions">
            <a class="btn secondary" href="/">
              The collection
            </a>
          </div>
        </div>
      </main>
    </StorefrontLayout>,
    404,
  )
}

/**
 * Records this page's own product into localStorage and, if there is anything
 * left to show, fills the #recent section from the /recently-viewed fragment.
 * ADR-0007's edge cache is why this exists at all: a product page never sees
 * most of its own GETs at the origin, so a view cannot be recorded there, and
 * a per-visitor rail cannot be rendered into HTML every visitor shares.
 *
 * Only slugs are kept, never title/price/image: a stale price sitting in a
 * visitor's browser is a promise about money, and a deleted product would
 * become a dead link. Slugs are generated once at creation and never edited,
 * so they are a stable key to keep. localStorage rather than a cookie: a
 * cookie rides every request including CDN image requests, and this has no
 * need to be readable before paint.
 *
 * 8 slugs are kept but only 4 shown, so dropping this page's own product still
 * leaves a full rail rather than three. Every localStorage call is wrapped —
 * Safari private mode throws on setItem, and some Android WebViews block
 * storage outright — so a visitor either sees the feature or sees nothing,
 * never a broken page. The view is recorded synchronously on load, but the
 * fetch itself waits for the window 'load' event, so the fragment never
 * competes with the product gallery for bandwidth on a slow connection —
 * nothing above the fold depends on it. Anything read back that is not a
 * slug is dropped immediately: that keeps a junk value out of both the
 * request to /recently-viewed and the querySelector call below it, where a
 * malformed selector would throw and take the whole handler down with it.
 *
 * The fragment always comes back with its slugs sorted, per the comment on
 * the route itself, so recency order is something this script restores
 * itself rather than something the cache entry can vary on.
 */
const recentlyViewedScript = `
  (function () {
    var sec = document.getElementById('recent');
    if (!sec || !window.localStorage) return;
    var slug = sec.dataset.slug, KEY = 'bl_recent', ok = /^[a-z0-9-]{1,80}$/;
    var list = [];
    try { list = JSON.parse(localStorage.getItem(KEY)) || [] } catch (e) {}
    var keep = (Array.isArray(list) ? list : []).filter(function (s) {
      return typeof s === 'string' && s !== slug && ok.test(s);
    });
    try { localStorage.setItem(KEY, JSON.stringify([slug].concat(keep).slice(0, 8))) } catch (e) {}

    var show = keep.slice(0, 4);
    if (!show.length) return;
    addEventListener('load', function () {
      fetch('/recently-viewed?p=' + show.slice().sort().join(','))
        .then(function (r) { return r.ok ? r.text() : '' })
        .then(function (html) {
          if (!html.trim()) return;
          var rail = document.getElementById('recent-rail');
          rail.innerHTML = html;
          for (var i = show.length - 1; i >= 0; i--) {
            var el = rail.querySelector('[data-slug="' + show[i] + '"]');
            if (el) rail.insertBefore(el, rail.firstChild);
          }
          if (rail.children.length) sec.hidden = false;
        })
        .catch(function () {});
    });
  })();
`
