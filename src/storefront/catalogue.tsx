import { Hono } from 'hono'
import type { Context } from 'hono'
import { formatPaisa } from '../lib/money.js'
import { StorefrontLayout } from '../views/storefront.js'
import { Picture } from '../views/picture.js'
import { findProductBySlug, listCatalogue } from './queries.js'
import type { ImageWithDerivatives } from './queries.js'

export const storefront = new Hono()

/**
 * Sizes tell the browser how wide the image will render before any CSS has
 * been parsed, which is what lets it pick a rung of the ladder on the first
 * pass. They have to track the grid in views/storefront.tsx.
 */
const cardSizes = '(min-width: 820px) 240px, (min-width: 520px) 30vw, 45vw'
const shotSizes = '(min-width: 820px) 600px, 100vw'

storefront.get('/', (c) => {
  const listings = listCatalogue()
  return c.html(
    <StorefrontLayout
      title="Butterloom — South Asian ethnic fashion"
      description="Handwoven South Asian ethnic fashion, delivered across Bangladesh."
      canonicalPath="/"
    >
      <main>
        <h1>The collection</h1>
        {listings.length === 0 ? (
          <p class="muted">Nothing here yet. New pieces are on their way.</p>
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
  const { product, images } = detail

  return c.html(
    <StorefrontLayout
      title={`${product.title} — Butterloom`}
      description={summarise(product.description) || undefined}
      canonicalPath={`/p/${product.slug}`}
    >
      <main>
        <div class="product">
          <Shots images={images} />
          <div>
            <h1>{product.title}</h1>
            <p class="price">{formatPaisa(product.pricePaisa)}</p>
            {product.description ? <p class="description">{product.description}</p> : null}
            {/*
              No availability is rendered here, and none ever should be: this
              page is cached at the edge, and ADR-0007 keeps the promise that a
              stale page cannot assert something false about stock by having it
              assert nothing. Stock is resolved at placement, against Reservation.
            */}
            <p class="muted">Cash on delivery, or bKash. Delivered across Bangladesh.</p>
          </div>
        </div>
      </main>
    </StorefrontLayout>,
  )
})

function Shots(props: { images: ImageWithDerivatives[] }) {
  if (props.images.length === 0) {
    return <div class="placeholder">No photograph yet</div>
  }
  return (
    <ul class="shots">
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
    <StorefrontLayout title="Not found — Butterloom" canonicalPath={c.req.path}>
      <main>
        <h1>Not found</h1>
        <p class="muted">
          That page does not exist. <a href="/">Back to the collection</a>.
        </p>
      </main>
    </StorefrontLayout>,
    404,
  )
}
