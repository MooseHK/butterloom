import { Hono } from 'hono'
import type { Context } from 'hono'
import { formatPaisa } from '../lib/money.js'
import { Crumb, Seal, StorefrontLayout } from '../views/storefront.js'
import { Picture } from '../views/picture.js'
import { findProductBySlug, findSiteImage, listCatalogue } from './queries.js'
import type { ImageWithDerivatives } from './queries.js'

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

/**
 * The hero bleeds to the edge of main, which is the viewport on a phone and
 * capped at main's own 40rem above that — not the full window. Claiming 100vw
 * on a wide screen would buy a rung of image the page never paints.
 */
const heroSizes = '(min-width: 640px) 640px, 100vw'

storefront.get('/', (c) => {
  const listings = listCatalogue()
  const hero = findSiteImage('hero')
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
          {/* How much there is to scroll, before the scrolling starts. One
              short line, and the only number the page needs. */}
          {listings.length > 0 ? (
            <p class="muted">
              {listings.length} {listings.length === 1 ? 'piece' : 'pieces'}
            </p>
          ) : null}
        </div>
        {listings.length === 0 ? (
          <div class="detail">
            <p class="muted">Nothing here yet. New pieces are on their way.</p>
          </div>
        ) : (
          <ul class="grid">
            {listings.map(({ product, cover }, index) => (
              <li class="card">
                <a href={`/p/${product.slug}`}>
                  {cover ? (
                    <Picture
                      image={cover.image}
                      derivatives={cover.derivatives}
                      sizes={cardSizes}
                      // The first row is above the fold on a phone; lazy-loading
                      // it would delay the largest paint on the slow networks
                      // this whole architecture is built around.
                      loading={index < 2 ? 'eager' : 'lazy'}
                    />
                  ) : (
                    <div class="placeholder">No photograph yet</div>
                  )}
                  <h2>{product.title}</h2>
                  <p>{formatPaisa(product.pricePaisa)}</p>
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </StorefrontLayout>,
  )
})

storefront.get('/p/:slug', (c) => {
  const detail = findProductBySlug(c.req.param('slug'))
  if (!detail) return c.notFound()
  const { product, images, stocks } = detail

  const hasVariants = stocks.length > 1 || (stocks.length === 1 && Boolean(stocks[0]?.variantLabel))

  return c.html(
    <StorefrontLayout
      title={`${product.title} — butterloom`}
      description={summarise(product.description) || undefined}
      canonicalPath={`/p/${product.slug}`}
    >
      <main>
        {/* The wordmark goes home, but it reads as a logo. This says it in
            words, at the top of the one page a visitor arrives on from a
            search result with no idea what is above it. */}
        <Crumb href="/" label="The collection" />
        <Shots images={images} />
        <div class="detail">
          <h1>{product.title}</h1>
          <p class="price">{formatPaisa(product.pricePaisa)}</p>
          {product.description ? <p class="description">{product.description}</p> : null}

          <form id="add-to-cart-form" class="buy" method="post" action="/cart/add">
            <input type="hidden" name="product_id" value={product.id} />

            {hasVariants ? (
              <fieldset class="variant-group">
                <legend class="variant-label">Choose a size</legend>
                <div class="variant-options">
                  {stocks.map((s, idx) => (
                    <label>
                      <input
                        type="radio"
                        name="stock_id"
                        value={s.id}
                        class="variant-radio"
                        checked={idx === 0}
                        required
                      />
                      <span class="variant-chip">{s.variantLabel || 'One size'}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : stocks[0] ? (
              <input type="hidden" name="stock_id" value={stocks[0].id} />
            ) : null}

            <button type="submit" class="btn" id="add-to-cart-btn">
              Add to cart
            </button>
          </form>

          {/*
            No availability is rendered here, and none ever should be: this
            page is cached at the edge, and ADR-0007 keeps the promise that a
            stale page cannot assert something false about stock by having it
            assert nothing. Stock is resolved at placement, against Reservation.
          */}
          {/* The strip above says we take cash on delivery and the footer says
              where we deliver. What is left to say at the point of decision is
              what cash on delivery actually asks of the customer. */}
          <p class="muted">Nothing to pay now — you pay the courier at the door.</p>
        </div>
      </main>
      <script
        dangerouslySetInnerHTML={{
          __html: `
            var form = document.getElementById('add-to-cart-form');
            var btn = document.getElementById('add-to-cart-btn');
            if (form && btn) {
              form.addEventListener('submit', function(e) {
                e.preventDefault();
                var prevText = btn.textContent;
                btn.disabled = true;
                btn.textContent = 'Adding…';
                fetch('/cart/add', {
                  method: 'POST',
                  body: new FormData(form),
                  headers: { 'Accept': 'application/json' }
                })
                .then(function(r) { return r.json(); })
                .then(function(data) {
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
    </StorefrontLayout>,
  )
})


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
