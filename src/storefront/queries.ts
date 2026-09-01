import { and, asc, count, desc, eq, exists, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { db } from '../db/client.js'
import {
  cartItems,
  categories,
  imageDerivatives,
  productImages,
  productVariants,
  products,
  siteImages,
  variantOptions,
} from '../db/schema.js'
import type {
  CartItem,
  Category,
  ImageDerivative,
  Product,
  ProductImage,
  ProductVariant,
  SiteImage,
  SiteImageSlot,
  VariantOption,
} from '../db/schema.js'
import { emptyParams, perPage } from './listing.js'
import type { Allowed, ListingParams, OptionFilter } from './listing.js'

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

export function attachCovers(rows: Product[]): ProductListing[] {
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

/**
 * A product matches a filter when *one of its variants* satisfies every axis at
 * once — an indigo M, not an indigo something and a something M. Within an axis
 * the values are alternatives, so `?colour=indigo,ecru&size=m` asks for a
 * variant that is medium and is one of those two colours.
 *
 * Nothing here looks at stock, and nothing here ever should: ADR-0007 keeps
 * availability out of cached HTML, and a filter that hid sold-out variants
 * would be exactly the stale assertion that promise exists to prevent.
 */
function matchesFilters(filters: OptionFilter[]) {
  if (filters.length === 0) return undefined
  const variant = alias(productVariants, 'filter_variant')
  const axes = filters.map((filter, i) => {
    const option = alias(variantOptions, `filter_option_${i}`)
    return exists(
      db
        .select({ one: sql`1` })
        .from(option)
        .where(
          and(
            eq(option.variantId, variant.id),
            eq(option.nameSlug, filter.nameSlug),
            inArray(option.valueSlug, filter.valueSlugs),
          ),
        ),
    )
  })
  return exists(
    db
      .select({ one: sql`1` })
      .from(variant)
      .where(and(eq(variant.productId, products.id), ...axes)),
  )
}

/**
 * Every sort ends in a unique column. Without that tiebreaker two products of
 * the same price sort in whatever order SQLite happens to produce, which is
 * stable within one query and not across two — so page two could repeat a
 * product page one already showed, or skip one entirely.
 */
const orderings = {
  newest: [desc(products.createdAt), desc(products.id)],
  'price-asc': [asc(products.pricePaisa), asc(products.id)],
  'price-desc': [desc(products.pricePaisa), asc(products.id)],
} as const

export interface ListingPage {
  listings: ProductListing[]
  /** Products matching the scope and filters, before paging. */
  total: number
  page: number
  pageCount: number
}

/**
 * The catalogue listing, scoped to a category or to everything. Deliberately
 * says nothing about stock: ADR-0007 keeps availability out of cached HTML
 * entirely, so a stale page cannot assert something false. Availability is
 * resolved at order placement, where Reservation lives.
 */
export function listProducts(options: {
  /** Null lists the whole catalogue; a number lists one shelf. */
  categoryId?: number | null
  params?: ListingParams
  /** The front page wants a short rail of the newest, not a page of results. */
  limit?: number
} = {}): ListingPage {
  const params = options.params ?? emptyParams
  const categoryId = options.categoryId ?? null
  const where = and(
    categoryId === null ? undefined : eq(products.categoryId, categoryId),
    matchesFilters(params.filters),
  )

  const [tally] = db.select({ n: count() }).from(products).where(where).all()
  const total = tally?.n ?? 0

  const size = options.limit ?? perPage
  const pageCount = Math.max(1, Math.ceil(total / size))
  // Asking for page nine of a three-page listing gets page three rather than a
  // blank one: the number came off a URL, and a URL outlives the catalogue it
  // was copied from.
  const page = options.limit ? 1 : Math.min(params.page, pageCount)

  const rows = db
    .select()
    .from(products)
    .where(where)
    .orderBy(...orderings[params.sort])
    .limit(size)
    .offset((page - 1) * size)
    .all()

  return { listings: attachCovers(rows), total, page, pageCount }
}

export interface CategoryListing {
  category: Category
  productCount: number
}

/**
 * The shelves, in the order the operator put them in, each with how much is on
 * it. Empty ones are included: the admin needs to see a shelf it has just made,
 * and the storefront decides for itself whether to draw a tile for it.
 */
export function listCategories(): CategoryListing[] {
  const counts = new Map(
    db
      .select({ categoryId: products.categoryId, n: count() })
      .from(products)
      .groupBy(products.categoryId)
      .all()
      .map((r) => [r.categoryId, r.n] as const),
  )
  return db
    .select()
    .from(categories)
    .orderBy(asc(categories.position), asc(categories.name))
    .all()
    .map((category) => ({ category, productCount: counts.get(category.id) ?? 0 }))
}

export function findCategoryBySlug(slug: string): Category | null {
  const [category] = db.select().from(categories).where(eq(categories.slug, slug)).all()
  return category ?? null
}

export interface FacetValue {
  value: string
  valueSlug: string
}

export interface Facet {
  name: string
  nameSlug: string
  values: FacetValue[]
}

/**
 * The axes and values that exist in one scope — Colour: Indigo, Ecru; Size: S,
 * M, L — which is both what the filter form offers and the whitelist a URL is
 * validated against.
 *
 * Scope, not selection: these are the values present in the category being
 * listed, and they do not narrow as filters are applied. A count beside each
 * one would have to be recomputed per axis against the *other* axes' filters to
 * be true, so rather than show a number that is subtly wrong, this shows none.
 *
 * ponytail: values are ordered by when they were first entered, which puts S, M,
 * L in size order for an operator who types them in that order and is wrong for
 * one who does not. A real ordering is a position column on a value the day
 * anybody minds.
 */
export function facetsFor(categoryId: number | null): Facet[] {
  const rows = db
    .select({
      name: sql<string>`min(${variantOptions.name})`,
      nameSlug: variantOptions.nameSlug,
      value: sql<string>`min(${variantOptions.value})`,
      valueSlug: variantOptions.valueSlug,
      axisAt: sql<number>`min(${variantOptions.position})`,
      firstSeen: sql<number>`min(${variantOptions.id})`,
    })
    .from(variantOptions)
    .innerJoin(productVariants, eq(productVariants.id, variantOptions.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(categoryId === null ? undefined : eq(products.categoryId, categoryId))
    .groupBy(variantOptions.nameSlug, variantOptions.valueSlug)
    .all()

  const axes = new Map<string, Facet & { axisAt: number; firstSeen: number }>()
  for (const row of rows.sort((a, b) => a.firstSeen - b.firstSeen)) {
    const axis = axes.get(row.nameSlug)
    if (axis) {
      axis.values.push({ value: row.value, valueSlug: row.valueSlug })
      axis.axisAt = Math.min(axis.axisAt, row.axisAt)
    } else {
      axes.set(row.nameSlug, {
        name: row.name,
        nameSlug: row.nameSlug,
        values: [{ value: row.value, valueSlug: row.valueSlug }],
        axisAt: row.axisAt,
        firstSeen: row.firstSeen,
      })
    }
  }

  return [...axes.values()]
    .sort((a, b) => a.axisAt - b.axisAt || a.firstSeen - b.firstSeen)
    .map(({ name, nameSlug, values }) => ({ name, nameSlug, values }))
}

/** The whitelist form of a facet list, for parseListingParams. */
export function allowedFrom(facets: Facet[]): Allowed {
  return new Map(facets.map((f) => [f.nameSlug, new Set(f.values.map((v) => v.valueSlug))]))
}

export interface VariantWithOptions {
  variant: ProductVariant
  options: VariantOption[]
}

/** Every configuration of one product, each with its axes in display order. */
export function variantsForProduct(productId: number): VariantWithOptions[] {
  const variants = db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.position), asc(productVariants.id))
    .all()
  if (variants.length === 0) return []

  const options = db
    .select()
    .from(variantOptions)
    .where(
      inArray(
        variantOptions.variantId,
        variants.map((v) => v.id),
      ),
    )
    .orderBy(asc(variantOptions.position), asc(variantOptions.id))
    .all()

  const byVariant = new Map<number, VariantOption[]>()
  for (const option of options) {
    byVariant.set(option.variantId, [...(byVariant.get(option.variantId) ?? []), option])
  }
  return variants.map((variant) => ({ variant, options: byVariant.get(variant.id) ?? [] }))
}

/**
 * The variants of one product collapsed into the axes a customer chooses along
 * — three variants of two colours and two sizes read as "Colour: Indigo, Ecru"
 * and "Size: M, L" rather than as three labels.
 */
export function axesOf(variants: VariantWithOptions[]): Facet[] {
  const axes = new Map<string, Facet>()
  const seen = new Set<string>()
  for (const { options } of variants) {
    for (const option of options) {
      const axis = axes.get(option.nameSlug) ?? { name: option.name, nameSlug: option.nameSlug, values: [] }
      const key = `${option.nameSlug}/${option.valueSlug}`
      if (!seen.has(key)) {
        seen.add(key)
        axis.values.push({ value: option.value, valueSlug: option.valueSlug })
      }
      axes.set(option.nameSlug, axis)
    }
  }
  return [...axes.values()]
}

/** How many variants each of these products has, for the admin list. */
export function variantCounts(productIds: number[]): Map<number, number> {
  if (productIds.length === 0) return new Map()
  return new Map(
    db
      .select({ productId: productVariants.productId, n: count() })
      .from(productVariants)
      .where(inArray(productVariants.productId, productIds))
      .groupBy(productVariants.productId)
      .all()
      .map((r) => [r.productId, r.n] as const),
  )
}

export interface ProductDetail {
  product: Product
  images: ImageWithDerivatives[]
  /**
   * Every configuration of this product, each with its axes. The product page
   * needs both readings: the axes collapsed into "Colour: Indigo, Ecru" as
   * type, and the variants themselves as the things add-to-cart can name.
   */
  variants: VariantWithOptions[]
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
    // Position order, not alphabetical: the operator decided S came before M.
    variants: variantsForProduct(product.id),
  }
}

export interface CartItemWithDetails {
  cartItem: CartItem
  product: Product
  variant: ProductVariant
  cover: ImageWithDerivatives | null
}

export function getCartItemsForSession(sessionId: number): CartItemWithDetails[] {
  const items = db
    .select({
      cartItem: cartItems,
      product: products,
      variant: productVariants,
    })
    .from(cartItems)
    .innerJoin(products, eq(cartItems.productId, products.id))
    .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
    .where(eq(cartItems.sessionId, sessionId))
    .orderBy(asc(cartItems.createdAt))
    .all()

  if (items.length === 0) return []

  const productIds = items.map((i) => i.product.id)
  const images = db
    .select()
    .from(productImages)
    .where(inArray(productImages.productId, productIds))
    .orderBy(asc(productImages.position))
    .all()

  const covers = new Map<number, ProductImage>()
  for (const img of images) {
    if (!covers.has(img.productId)) covers.set(img.productId, img)
  }
  const derivatives = derivativesFor([...covers.values()])

  return items.map((row) => {
    const img = covers.get(row.product.id)
    return {
      cartItem: row.cartItem,
      product: row.product,
      variant: row.variant,
      cover: img ? { image: img, derivatives: derivatives.get(img.id) ?? [] } : null,
    }
  })
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

