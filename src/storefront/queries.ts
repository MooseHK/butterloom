import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { imageDerivatives, productImages, products, siteImages } from '../db/schema.js'
import type { ImageDerivative, Product, ProductImage, SiteImage, SiteImageSlot } from '../db/schema.js'

export interface ImageWithDerivatives {
  image: ProductImage
  derivatives: ImageDerivative[]
}

export interface ProductListing {
  product: Product
  cover: ImageWithDerivatives | null
}

/** Derivatives for a set of product images, grouped by image and ordered by width. */
export function derivativesFor(images: ProductImage[]): Map<number, ImageDerivative[]> {
  const grouped = new Map<number, ImageDerivative[]>()
  if (images.length === 0) return grouped
  const rows = db
    .select()
    .from(imageDerivatives)
    .where(
      inArray(
        imageDerivatives.imageId,
        images.map((i) => i.id),
      ),
    )
    .all()
  for (const row of rows) {
    // The query filters on image_id, so every row here has one. The column is
    // nullable because a site-slot derivative carries site_image_id instead.
    if (row.imageId === null) continue
    grouped.set(row.imageId, [...(grouped.get(row.imageId) ?? []), row])
  }
  for (const list of grouped.values()) list.sort((a, b) => a.width - b.width)
  return grouped
}

/**
 * The catalogue listing. Deliberately says nothing about stock: ADR-0007 keeps
 * availability out of cached HTML entirely, so a stale page cannot assert
 * something false. Availability is resolved at order placement, where
 * Reservation lives.
 */
export function listCatalogue(): ProductListing[] {
  const rows = db.select().from(products).orderBy(asc(products.title)).all()
  if (rows.length === 0) return []

  const images = db
    .select()
    .from(productImages)
    .where(
      inArray(
        productImages.productId,
        rows.map((p) => p.id),
      ),
    )
    .orderBy(asc(productImages.position))
    .all()

  // Position 0 is the primary image; the ordered query means first wins.
  const covers = new Map<number, ProductImage>()
  for (const image of images) {
    if (!covers.has(image.productId)) covers.set(image.productId, image)
  }
  const derivatives = derivativesFor([...covers.values()])

  return rows.map((product) => {
    const image = covers.get(product.id)
    return {
      product,
      cover: image ? { image, derivatives: derivatives.get(image.id) ?? [] } : null,
    }
  })
}

export interface ProductDetail {
  product: Product
  images: ImageWithDerivatives[]
}

export function findProductBySlug(slug: string): ProductDetail | null {
  const [product] = db.select().from(products).where(eq(products.slug, slug)).all()
  if (!product) return null

  const images = db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, product.id))
    .orderBy(asc(productImages.position))
    .all()
  const derivatives = derivativesFor(images)

  return {
    product,
    images: images.map((image) => ({ image, derivatives: derivatives.get(image.id) ?? [] })),
  }
}

export interface SiteImageWithDerivatives {
  image: SiteImage
  derivatives: ImageDerivative[]
}

/**
 * The photograph filling one editorial slot, or null while the slot is empty.
 * Every page that reads a slot has to render without it: the storefront ships
 * before any of these are filled, and an operator can leave one empty for as
 * long as they like.
 */
export function findSiteImage(slot: SiteImageSlot): SiteImageWithDerivatives | null {
  const [image] = db.select().from(siteImages).where(eq(siteImages.slot, slot)).all()
  if (!image) return null
  const derivatives = db
    .select()
    .from(imageDerivatives)
    .where(eq(imageDerivatives.siteImageId, image.id))
    .all()
  derivatives.sort((a, b) => a.width - b.width)
  return { image, derivatives }
}
