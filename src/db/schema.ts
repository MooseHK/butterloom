import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const now = sql`(unixepoch())`

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
 * ADR-0007: derivatives are named by content hash and immutable, so they carry
 * far-future cache headers and there is no purge path to get wrong.
 */
export const imageDerivatives = sqliteTable(
  'image_derivatives',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    imageId: integer('image_id')
      .notNull()
      .references(() => productImages.id, { onDelete: 'cascade' }),
    format: text('format', { enum: ['avif', 'webp', 'jpeg'] }).notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    byteSize: integer('byte_size').notNull(),
    /** sha256 of the derivative bytes; also its storage key and its URL. */
    sha256: text('sha256').notNull(),
    storageKey: text('storage_key').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    index('image_derivatives_image_idx').on(t.imageId, t.format, t.width),
    uniqueIndex('image_derivatives_key_idx').on(t.storageKey),
  ],
)

export type Product = typeof products.$inferSelect
export type ProductImage = typeof productImages.$inferSelect
export type ImageDerivative = typeof imageDerivatives.$inferSelect
