import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const now = sql`(unixepoch())`

/**
 * The fixed positions on the site that carry an editorial photograph. Adding
 * one means adding the markup that reads it, so the list lives here rather
 * than being free text an operator can typo into a slot nothing renders.
 */
export const siteImageSlots = ['hero'] as const
export type SiteImageSlot = (typeof siteImageSlots)[number]

/**
 * Money is integer paisa everywhere (ADR-0006). 1 BDT = 100 paisa.
 */
export const products = sqliteTable(
  'products',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    pricePaisa: integer('price_paisa').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [uniqueIndex('products_slug_idx').on(t.slug)],
)

/**
 * One uploaded photograph. The upload itself is not served to customers; every
 * customer-facing byte is a derivative row below.
 */
export const productImages = sqliteTable(
  'product_images',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** Ordering within the product gallery; 0 is the primary image. */
    position: integer('position').notNull().default(0),
    altText: text('alt_text').notNull().default(''),
    originalFilename: text('original_filename').notNull(),
    /** sha256 of the uploaded bytes, so re-uploading the same file is detectable. */
    originalSha256: text('original_sha256').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('product_images_product_idx').on(t.productId, t.position)],
)

/**
 * Editorial photography that belongs to the site rather than to any one product
 * — the front-page hero is the first. Separate from product_images because the
 * lifecycles differ: a product image dies with its product, whereas a slot is a
 * fixed position on the site that outlives every file that has ever filled it.
 *
 * One row per slot, enforced below. Uploading to an occupied slot replaces what
 * is there rather than appending, which is why there is no position column.
 */
export const siteImages = sqliteTable(
  'site_images',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    slot: text('slot', { enum: siteImageSlots }).notNull(),
    altText: text('alt_text').notNull().default(''),
    originalFilename: text('original_filename').notNull(),
    originalSha256: text('original_sha256').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [uniqueIndex('site_images_slot_idx').on(t.slot)],
)

/**
 * ADR-0007: derivatives are named by content hash and immutable, so they carry
 * far-future cache headers and there is no purge path to get wrong.
 */
export const imageDerivatives = sqliteTable(
  'image_derivatives',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /**
     * Exactly one of these is set, enforced by the check below: a derivative
     * belongs either to a product photograph or to a site slot. A single table
     * rather than two because the rows are identical and content-addressed —
     * the same photograph used as a hero and as a product cover encodes to the
     * same bytes, and the blob is shared whichever owns it.
     */
    imageId: integer('image_id').references(() => productImages.id, { onDelete: 'cascade' }),
    siteImageId: integer('site_image_id').references(() => siteImages.id, { onDelete: 'cascade' }),
    format: text('format', { enum: ['avif', 'webp', 'jpeg'] }).notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    byteSize: integer('byte_size').notNull(),
    /**
     * sha256 of the derivative bytes; also its storage key and its URL. Two
     * images can legitimately share one — the same photograph uploaded against
     * two products encodes to the same bytes — so the blob is shared and the
     * key is not unique across rows.
     */
    sha256: text('sha256').notNull(),
    storageKey: text('storage_key').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    // One rung per owner, format and width; the ladder is regenerated as a
    // whole, never appended to. Two indexes rather than one over both owner
    // columns because SQLite treats NULLs as distinct in a UNIQUE index: every
    // site row has a null image_id and so cannot collide in the first, and
    // every product row has a null site_image_id and cannot collide in the
    // second. Each index therefore constrains only the rows it owns.
    uniqueIndex('image_derivatives_rung_idx').on(t.imageId, t.format, t.width),
    uniqueIndex('image_derivatives_site_rung_idx').on(t.siteImageId, t.format, t.width),
    index('image_derivatives_key_idx').on(t.storageKey),
    // A derivative with neither owner is unreachable; one with both would be
    // deleted twice over by the cascades. Neither is reachable through the
    // ingest path, so this is here to keep a future writer honest.
    check(
      'image_derivatives_one_owner',
      sql`(${t.imageId} is null) <> (${t.siteImageId} is null)`,
    ),
  ],
)

export type Product = typeof products.$inferSelect
export type ProductImage = typeof productImages.$inferSelect
export type ImageDerivative = typeof imageDerivatives.$inferSelect
export type SiteImage = typeof siteImages.$inferSelect
