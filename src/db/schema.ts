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
 * A shelf on the storefront — "Sarees", "Kurtas". A product sits in exactly one
 * of them, or in none while it is being set up.
 *
 * A table rather than a text column on products because a category is a page
 * with a URL, an order on the front-page tiles, and a name an operator renames
 * without breaking that URL. A free-text column gives none of those and forks
 * into "Saree" and "Sarees" the first time somebody types quickly.
 *
 * ponytail: one category per product. A garment that genuinely belongs on two
 * shelves wants a join table; none does yet, and the nullable FK is one line to
 * migrate away from when one does.
 */
export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** Order of the front-page tiles; ties fall back to name. */
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [uniqueIndex('categories_slug_idx').on(t.slug), index('categories_position_idx').on(t.position)],
)

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
    /**
     * Null while a product is unshelved: it is still reachable at its own URL
     * and still listed under All items, it just appears under no category. Set
     * null rather than cascade on delete, because deleting a shelf must not
     * delete what was standing on it.
     */
    categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('products_slug_idx').on(t.slug),
    index('products_category_idx').on(t.categoryId),
    // Both listing sorts read this: price ascending and descending are the same
    // index walked in either direction.
    index('products_price_idx').on(t.pricePaisa),
  ],
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

/**
 * An uploaded photograph whose derivative ladder has not been cut yet. Cutting
 * one is seconds of CPU, and a bulk of twenty products is minutes of it —
 * ADR-0007 still puts that work at upload time rather than on a request, but
 * the *operator* should not be the one holding it: the bytes land in the blob
 * store under `original_sha256`, this row records what they belong to, and one
 * worker drains the table behind the redirect.
 *
 * A table rather than an in-memory list, for two reasons: a restart mid-bulk
 * resumes instead of dropping the upload, and the admin can say what is still
 * cooking without asking the encoder.
 */
export const pendingImages = sqliteTable(
  'pending_images',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    altText: text('alt_text').notNull().default(''),
    originalFilename: text('original_filename').notNull(),
    contentType: text('content_type').notNull(),
    /** Key of the uploaded bytes in the blob store; the worker reads them back. */
    originalSha256: text('original_sha256').notNull(),
    /**
     * Null while the row is waiting or being worked. Set when encoding failed,
     * which both parks the row — the worker only claims null-error rows — and
     * gives the operator something to read.
     */
    error: text('error'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('pending_images_product_idx').on(t.productId)],
)

/**
 * One buyable configuration of a product — the medium in indigo, the large in
 * ecru. A product carries as many as it needs, and the ones that come in a
 * single configuration carry exactly one.
 *
 * Stock lives here rather than on the product because that is where it is true:
 * Reservation (CONTEXT.md) holds a specific variant, and ADR-0006 leans on
 * SQLite's single writer precisely for the last-one-in-stock case. Nothing on
 * the storefront renders this column — ADR-0007 keeps availability out of
 * cached HTML entirely — so it is an operator's number until Reservation reads
 * it.
 *
 * ponytail: no per-variant price. Every variant of a product costs what the
 * product costs; the day one does not, this takes a nullable
 * price_paisa_override and the listing reads a min() as its "from" price.
 */
export const productVariants = sqliteTable(
  'product_variants',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /**
     * What the customer is picking, in one string — "Indigo / M", or "Standard"
     * for the product that comes one way. Always joined from the option values
     * below and never typed: a typed label is a second place the same fact is
     * written, and the first one to fall out of step with the options beside it.
     *
     * Stored rather than computed so that ordering and the unique index below
     * have something to hold on to.
     */
    label: text('label').notNull(),
    stockQty: integer('stock_qty').notNull().default(0),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    index('product_variants_product_idx').on(t.productId, t.position),
    // Two variants of one product with the same label are one variant entered
    // twice; the second is a data-entry slip, not a configuration.
    uniqueIndex('product_variants_label_idx').on(t.productId, t.label),
  ],
)

/**
 * One axis of one variant: Colour = Indigo, Size = M. Name and value are free
 * text so a new axis costs no migration, and each is stored twice — once as the
 * operator typed it, once slugified. The slug is what a filter URL carries and
 * what the index below is walked on, which is also what keeps "Indigo" and
 * "indigo" from becoming two chips in the filter.
 *
 * ponytail: no registry of permitted axes. The admin offers the names already
 * in use as a datalist, which is enough discipline for one operator; a
 * controlled vocabulary is a table to add the day a second one disagrees.
 */
export const variantOptions = sqliteTable(
  'variant_options',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    variantId: integer('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    nameSlug: text('name_slug').notNull(),
    value: text('value').notNull(),
    valueSlug: text('value_slug').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    // One value per axis per variant: a variant is not both indigo and ecru.
    uniqueIndex('variant_options_axis_idx').on(t.variantId, t.nameSlug),
    // The listing filter starts here — every query narrows on the pair before
    // it touches a variant or a product row.
    index('variant_options_facet_idx').on(t.nameSlug, t.valueSlug),
  ],
)

export type Product = typeof products.$inferSelect
export type ProductImage = typeof productImages.$inferSelect
export type ImageDerivative = typeof imageDerivatives.$inferSelect
export type SiteImage = typeof siteImages.$inferSelect
export type PendingImage = typeof pendingImages.$inferSelect
export type Category = typeof categories.$inferSelect
export type ProductVariant = typeof productVariants.$inferSelect
export type VariantOption = typeof variantOptions.$inferSelect

/**
 * Anonymous browser sessions for cart persistence.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    token: text('token').notNull(),
    createdAt: integer('created_at').notNull().default(now),
    lastSeenAt: integer('last_seen_at').notNull().default(now),
  },
  (t) => [uniqueIndex('sessions_token_idx').on(t.token)],
)


/**
 * Items in a session's cart.
 *
 * A line holds a variant, not a product: "one of these" is not orderable when a
 * product comes in three sizes, and CONTEXT.md has said a Cart line is a Variant
 * and a quantity since before there was a cart. The product id rides along
 * because every read of this table wants the title beside the label, and paying
 * for that with a second join on a page that is already uncached is worse than
 * carrying the column.
 */
export const cartItems = sqliteTable(
  'cart_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: integer('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: integer('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(1),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    // One line per variant per session: adding the same variant twice raises the
    // quantity on the line that is there rather than making a second one.
    uniqueIndex('cart_items_session_variant_idx').on(t.sessionId, t.variantId),
  ],
)

export const fulfilmentStates = [
  'placed',
  'packed',
  'handed_over',
  'delivered',
  'returned',
  'cancelled',
] as const
export type FulfilmentState = (typeof fulfilmentStates)[number]

/**
 * The core order record.
 */
export const orders = sqliteTable(
  'orders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone').notNull(),
    deliveryAddress: text('delivery_address').notNull(),
    deliveryNotes: text('delivery_notes').notNull().default(''),
    totalPaisa: integer('total_paisa').notNull(),
    fulfilmentState: text('fulfilment_state', { enum: fulfilmentStates })
      .notNull()
      .default('placed'),
    paymentTier: text('payment_tier').notNull().default('cod'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
)

/**
 * Snapshot of what was ordered (decoupled from product changes).
 */
export const orderItems = sqliteTable(
  'order_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
    productTitle: text('product_title').notNull(),
    variantLabel: text('variant_label').notNull().default(''),
    pricePaisa: integer('price_paisa').notNull(),
    quantity: integer('quantity').notNull().default(1),
  },
  (t) => [index('order_items_order_idx').on(t.orderId)],
)

/**
 * Audit trail of every state change.
 */
export const orderEvents = sqliteTable(
  'order_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fromState: text('from_state', { enum: fulfilmentStates }),
    toState: text('to_state', { enum: fulfilmentStates }).notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('order_events_order_idx').on(t.orderId)],
)

export type Session = typeof sessions.$inferSelect
export type CartItem = typeof cartItems.$inferSelect
export type Order = typeof orders.$inferSelect
export type OrderItem = typeof orderItems.$inferSelect
export type OrderEvent = typeof orderEvents.$inferSelect
