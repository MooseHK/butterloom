import { config } from '../config.js'
import type { ImageDerivative, ProductImage } from '../db/schema.js'
import { formatOrder, mimeTypes } from '../images/ladder.js'

export function derivativeUrl(d: Pick<ImageDerivative, 'storageKey'>): string {
  return `${config.mediaBaseUrl}/${d.storageKey}`
}

/**
 * The <picture> the storefront and the admin both render. Sources go widest
 * format support last: a browser takes the first type it understands, so AVIF
 * precedes WebP precedes the JPEG fallback in <img>.
 *
 * width/height are always set. On the mobile networks ADR-0007 targets, layout
 * shift while images arrive is the visible cost of omitting them.
 */
export function Picture(props: {
  image: ProductImage
  derivatives: ImageDerivative[]
  sizes: string
  loading?: 'lazy' | 'eager'
  className?: string
}) {
  const byFormat = new Map<string, ImageDerivative[]>()
  for (const d of props.derivatives) {
    const list = byFormat.get(d.format) ?? []
    list.push(d)
    byFormat.set(d.format, list)
  }
  for (const list of byFormat.values()) list.sort((a, b) => a.width - b.width)

  const jpegs = byFormat.get('jpeg') ?? []
  const fallback = jpegs.at(-1) ?? props.derivatives.at(-1)
  if (!fallback) return null

  return (
    <picture class={props.className}>
      {formatOrder
        .filter((f) => f !== 'jpeg' && (byFormat.get(f)?.length ?? 0) > 0)
        .map((f) => (
          <source
            type={mimeTypes[f]}
            sizes={props.sizes}
            srcset={srcset(byFormat.get(f) ?? [])}
          />
        ))}
      <img
        src={derivativeUrl(fallback)}
        srcset={jpegs.length > 1 ? srcset(jpegs) : undefined}
        sizes={jpegs.length > 1 ? props.sizes : undefined}
        width={fallback.width}
        height={fallback.height}
        alt={props.image.altText}
        loading={props.loading ?? 'lazy'}
        decoding="async"
      />
    </picture>
  )
}

function srcset(list: ImageDerivative[]): string {
  return list.map((d) => `${derivativeUrl(d)} ${d.width}w`).join(', ')
}
