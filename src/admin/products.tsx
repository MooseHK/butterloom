import { and, asc, count, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { config } from '../config.js'
import { db } from '../db/client.js'
import {
  categories,
  orders,
  pendingImages,
  productImages,
  productVariants,
  products,
  variantOptions,
} from '../db/schema.js'
import type { Category } from '../db/schema.js'
import { UploadError } from '../images/pipeline.js'
import {
  drainQueue,
  pendingByProduct,
  pendingForProduct,
  queueHasRoomFor,
  queueProductImage,
} from '../images/queue.js'
import { formatPaisa } from '../lib/money.js'
import {
  derivativesFor,
  facetsFor,
  listCategories,
  variantCounts,
  variantsForProduct,
} from '../storefront/queries.js'
import { AdminLayout } from '../views/layout.js'
import { Picture } from '../views/picture.js'
import { maxRows, parseRows, productSlug, uniqueSlug } from './bulkForm.js'
import type { DraftProduct } from './bulkForm.js'
import { slugify } from '../lib/slug.js'
import { maxVariantRows, optionsPerRow, parseStock, parseVariantRows } from './variantForm.js'

export const adminProducts = new Hono()

/**
 * Adding stock is a batch job, not a wizard. The old flow was one product per
 * form and then a second page per photograph, with the whole derivative ladder
 * cut inside each POST — twenty pieces meant forty page loads and twenty waits.
 * This page is the whole job: as many rows as there are products, photographs
 * attached to the row that owns them, one submit, and the encoding happens
 * behind the redirect (see images/queue.ts).
 */

/** Rows rendered without any script; enough for a normal restock. */
const initialRows = 1
/** The same, for the variants of one product: two sizes of one colour is typical. */
const initialVariantRows = 3
/**
 * A hundred products at four photographs each does not belong in one multipart
 * body — config.maxRequestBytes would refuse it long before this does, but this
 * is the limit that can say why in a sentence.
 */
const maxFilesPerSubmit = 40

const photoTypes = 'image/jpeg,image/png,image/webp,image/avif,image/tiff'

/**
 * `__i__` is the placeholder the add-row script substitutes, so the template in
 * the page and the rows rendered into it are the same markup rather than two
 * copies that drift.
 */
function Row(props: { i: number | string; categories: Category[] }) {
  const i = props.i
  return (
    <div class="row">
      <label>
        Title
        <input name={`title-${i}`} maxlength={200} placeholder="Indigo jamdani saree" />
      </label>
      <label>
        Price (BDT)
        <input name={`price-${i}`} type="number" min="1" step="0.01" inputmode="decimal" />
      </label>
      <label>
        Category
        <select name={`category-${i}`}>
          {/* Blank is unshelved, and it is the default: a product that has not
              been decided about yet is not a product on the wrong shelf. */}
          <option value="">Unshelved</option>
          {props.categories.map((category) => (
            <option value={category.id}>{category.name}</option>
          ))}
        </select>
      </label>
      <label class="span">
        Photographs
        <input type="file" name={`photos-${i}`} multiple accept={photoTypes} />
      </label>
      <label class="span">
        Description
        <textarea name={`desc-${i}`} rows={2}></textarea>
      </label>
    </div>
  )
}

/**
 * One row of the add-variants form. Stock is a number the operator keeps, not
 * one the storefront reads: ADR-0007 keeps availability out of edge-cached HTML
 * entirely, so nothing here ever reaches a customer's page.
 *
 * The label is not a field. It is joined from the values (see variantForm.ts),
 * because a typed label is a second place the same fact is written.
 */
function VariantRow(props: { i: number | string }) {
  const i = props.i
  return (
    <div class="row">
      <label>
        Stock
        <input name={`stock-${i}`} type="number" min="0" step="1" inputmode="numeric" placeholder="0" />
      </label>
      <p class="muted">Blank counts as none in stock.</p>
      {Array.from({ length: optionsPerRow }, (_, j) => (
        <>
          <label>
            Axis
            {/* The names already in use, offered rather than enforced — it is
                what keeps Colour and Color from becoming two axes, and it is
                enough discipline for one operator (schema.ts says the same). */}
            <input
              name={`oname-${i}-${j}`}
              list="option-names"
              maxlength={60}
              placeholder={j === 0 ? 'Colour' : ''}
            />
          </label>
          <label>
            Value
            <input name={`ovalue-${i}-${j}`} maxlength={60} placeholder={j === 0 ? 'Indigo' : ''} />
          </label>
        </>
      ))}
    </div>
  )
}

/**
 * ADR-0007 rules out a client framework, not five lines of DOM. Without them
 * the form still works — it just stops at the rows rendered above, which is why
 * there are three rather than one.
 *
 * Both bulk forms on this file's pages use it, so the counts are arguments: the
 * ids are the same because the two forms are never on the same page.
 */
function addRowScript(initial: number, max: number): string {
  return `
  var rows = document.getElementById('rows')
  var tpl = document.getElementById('row-template')
  var add = document.getElementById('add-row')
  var next = ${initial}
  add.hidden = false
  add.addEventListener('click', function () {
    rows.insertAdjacentHTML('beforeend', tpl.innerHTML.replaceAll('__i__', next++))
    var input = rows.lastElementChild.querySelector('input')
    if (input) input.focus()
    if (next >= ${max}) add.disabled = true
  })
`
}

adminProducts.get('/', (c) => {
  const rows = db.select().from(products).orderBy(asc(products.title)).all()
  const imageCounts = new Map(
    db
      .select({ productId: productImages.productId, n: count() })
      .from(productImages)
      .groupBy(productImages.productId)
      .all()
      .map((r) => [r.productId, r.n] as const),
  )
  const stockCounts = new Map(
    db
      .select({
        productId: productVariants.productId,
        total: sql<number>`coalesce(sum(${productVariants.stockQty}), 0)`,
        variantCount: count(),
      })
      .from(productVariants)
      .groupBy(productVariants.productId)
      .all()
      .map(
        (r) =>
          [r.productId, { total: Number(r.total), variantCount: Number(r.variantCount) }] as const,
      ),
  )
  const pending = pendingByProduct()
  const shelves = listCategories().map((c) => c.category)
  const shelfNames = new Map(shelves.map((c) => [c.id, c.name] as const))
  const variants = variantCounts(rows.map((p) => p.id))
  const error = c.req.query('error')
  const added = Number(c.req.query('added') ?? 0)
  const queued = Number(c.req.query('queued') ?? 0)

  return c.html(
    <AdminLayout title="Products" section="products">
      {error ? <p class="notice error">{error}</p> : null}
      {added > 0 ? (
        <p class="notice">
          Added {added} {added === 1 ? 'product' : 'products'}
          {queued > 0
            ? `. ${queued} ${queued === 1 ? 'photograph is' : 'photographs are'} encoding in the background — reload for progress.`
            : '.'}
        </p>
      ) : null}

      <form class="bulk" method="post" action="/admin/products" enctype="multipart/form-data">
        <div id="rows">
          {Array.from({ length: initialRows }, (_, i) => (
            <Row i={i} categories={shelves} />
          ))}
        </div>
        <template id="row-template">
          <Row i="__i__" categories={shelves} />
        </template>
        <p class="actions">
          {/* Shown only once the script has wired it up: a button that does
              nothing without JavaScript is worse than no button. */}
          <button type="button" id="add-row" hidden>
            Add another row
          </button>
          <button type="submit">Save products</button>
        </p>
        <p class="muted">
          Blank rows are ignored. The slug comes from the title. Photographs are accepted
          immediately and encoded in the background, so you never wait for the ladder.
        </p>
      </form>
      <script dangerouslySetInnerHTML={{ __html: addRowScript(initialRows, maxRows) }} />

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Slug</th>
              <th>Category</th>
              <th>Price</th>
              <th>Stock</th>
              <th>Images</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const tally = pending.get(p.id)
              const stock = stockCounts.get(p.id)
              return (
                <tr>
                  <td>
                    <a href={`/admin/products/${p.id}`}>{p.title}</a>
                  </td>
                  <td class="muted">{p.slug}</td>
                  <td>
                    {p.categoryId === null ? (
                      <span class="muted">Unshelved</span>
                    ) : (
                      (shelfNames.get(p.categoryId) ?? <span class="muted">Unshelved</span>)
                    )}
                  </td>
                  <td>{formatPaisa(p.pricePaisa)}</td>
                  <td>
                    {stock && stock.total > 0 ? (
                      <span>
                        {stock.total} in stock
                        {stock.variantCount > 1 ? (
                          <span class="muted"> ({stock.variantCount} variants)</span>
                        ) : null}
                      </span>
                    ) : (
                      <span class="fail">0 in stock</span>
                    )}
                  </td>
                  <td>
                    {imageCounts.get(p.id) ?? 0}
                    {tally?.queued ? <span class="muted"> · {tally.queued} encoding</span> : null}
                    {tally?.failed ? <span class="fail"> · {tally.failed} failed</span> : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <p class="muted">No products yet.</p> : null}
    </AdminLayout>,
  )
})

adminProducts.post('/', async (c) => {
  const back = '/admin/products'
  const fail = (message: string) => c.redirect(`${back}?error=${encodeURIComponent(message)}`, 303)

  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return fail('That submit was not readable. Check the photographs and try again.')
  }

  const { drafts, problems } = parseRows(form)
  if (drafts.length === 0) {
    return fail(problems.join(' · ') || 'Nothing to add — fill in at least one row.')
  }

  // The select was rendered from this table, but the request need not have come
  // from that page: a category id is checked against the database before it is
  // written, not trusted because the form behind it was behind auth.
  const shelves = new Set(
    db
      .select({ id: categories.id })
      .from(categories)
      .all()
      .map((r) => r.id),
  )
  const unknown = drafts.find((d) => d.categoryId !== null && !shelves.has(d.categoryId))
  if (unknown) {
    return fail(`Row ${unknown.row} (${unknown.title}): no such category. Nothing was saved.`)
  }

  const files = drafts.flatMap((d) => d.files)
  if (files.length > maxFilesPerSubmit) {
    return fail(`${files.length} photographs in one submit; the limit is ${maxFilesPerSubmit}.`)
  }
  const oversized = files.find((f) => f.size > config.maxUploadBytes)
  if (oversized) {
    const mb = Math.round(config.maxUploadBytes / (1024 * 1024))
    return fail(`"${oversized.name}" is larger than ${mb}MB. Nothing was saved.`)
  }
  if (!queueHasRoomFor(files.length)) {
    return fail(
      `The encoder is still working through ${config.maxPendingImages} photographs. Wait for it to catch up, then add these.`,
    )
  }

  // One transaction for the products: a bulk that half-applies is worse to
  // clean up than one that did not apply at all. The photographs follow after,
  // because writing blobs is not something to hold a SQLite write lock across.
  const taken = new Set(
    db
      .select({ slug: products.slug })
      .from(products)
      .all()
      .map((r) => r.slug),
  )
  let created: { id: number; draft: DraftProduct }[]
  try {
    created = db.transaction((tx) =>
      drafts.map((draft) => {
        const [row] = tx
          .insert(products)
          .values({
            title: draft.title,
            slug: uniqueSlug(productSlug(draft.title), taken),
            description: draft.description,
            pricePaisa: draft.pricePaisa,
            categoryId: draft.categoryId,
          })
          .returning({ id: products.id })
          .all()
        if (!row) throw new Error('insert returned no row')
        // Every product gets the one variant that makes it orderable at all —
        // an order line holds a variant, so a product with none cannot be put
        // in a cart. Zero, not main's ten: a product nobody has counted yet has
        // no stock, and inventing some is a claim the shop cannot honour.
        tx.insert(productVariants)
          .values({ productId: row.id, label: 'Standard', stockQty: 0 })
          .run()
        return { id: row.id, draft }
      }),
    )
  } catch (err) {
    console.error('[admin] bulk insert', err)
    return fail('Could not save these products. See the server log.')
  }


  let queued = 0
  for (const { id, draft } of created) {
    for (const file of draft.files) {
      try {
        await queueProductImage({
          productId: id,
          filename: file.name || 'upload',
          contentType: file.type,
          bytes: Buffer.from(await file.arrayBuffer()),
          // The photograph is of this product, so its title is a true
          // description of it. Per-image alt text is edited on the product page.
          altText: draft.title,
        })
        queued++
      } catch (err) {
        const message = err instanceof UploadError ? err.message : 'could not be accepted'
        if (!(err instanceof UploadError)) console.error('[admin] queue', err)
        problems.push(`${draft.title}: "${file.name}" ${message}`)
      }
    }
  }
  drainQueue()

  const query = new URLSearchParams({ added: String(created.length), queued: String(queued) })
  // Long enough to name a few bad rows, short enough to stay a URL.
  if (problems.length) query.set('error', problems.join(' · ').slice(0, 400))
  return c.redirect(`${back}?${query}`, 303)
})

const addVariantScript = `
  var toggleAdd = document.getElementById('toggle-add-variant-btn')
  var newVariantChip = document.getElementById('new-variant-chip')
  var cancelAdd = document.getElementById('cancel-add-variant-btn')
  var newOvalueInput = document.getElementById('new-ovalue-input')
  if (toggleAdd && newVariantChip) {
    toggleAdd.addEventListener('click', function () {
      toggleAdd.hidden = true
      newVariantChip.hidden = false
      if (newOvalueInput) newOvalueInput.focus()
    })
    if (cancelAdd) {
      cancelAdd.addEventListener('click', function () {
        newVariantChip.hidden = true
        toggleAdd.hidden = false
        if (newOvalueInput) newOvalueInput.value = ''
      })
    }
  }
`

adminProducts.get('/:id', (c) => {
  const id = Number(c.req.param('id'))
  const [product] = db.select().from(products).where(eq(products.id, id)).all()
  if (!product) return c.notFound()

  if (variantCounts([id]).get(id) === undefined) {
    db.insert(productVariants).values({ productId: id, label: 'Standard', stockQty: 0 }).run()
  }

  const images = db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, id))
    .orderBy(asc(productImages.position))
    .all()
  // The storefront's grouping helper, not a second copy of it: same query,
  // same shape, and it sorts each ladder by width where this page did not.
  const byImage = derivativesFor(images)
  const waiting = pendingForProduct(id)
  const shelves = listCategories().map((r) => r.category)
  const variants = variantsForProduct(id)
  // The axes already in use anywhere in the catalogue, not just on this product:
  // the point of the datalist is to offer the spelling that exists before a
  // second one is typed.
  const axisNames = facetsFor(null).map((f) => f.name)
  const totalStock = variants.reduce((acc, v) => acc + v.variant.stockQty, 0)

  const error = c.req.query('error')
  const uploaded = Number(c.req.query('uploaded') ?? 0)
  // Two names for one banner: this page was reached from routes on both sides
  // of a merge, and they do not agree on the parameter.
  const notice = c.req.query('notice') ?? c.req.query('saved')

  return c.html(
    <AdminLayout
      title={`Edit ${product.title}`}
      section="products"
      back={{ href: '/admin/products', label: 'All products' }}
      hideTitleHeading
    >
      <div class="product-editor">
        {error ? <p class="notice error">{error}</p> : null}
        {notice ? <p class="notice">{notice}</p> : null}
        {uploaded > 0 ? (
          <p class="notice">
            {uploaded} {uploaded === 1 ? 'photograph' : 'photographs'} accepted — encoding in the
            background. Reload for progress.
          </p>
        ) : null}

        {/* Gallery / Photographs section styled like customer product detail */}
        {images.length === 0 && waiting.length === 0 ? (
          <ul class="admin-gallery empty-gallery">
            <li class="gallery-add-item empty-add-item">
              <form
                method="post"
                action={`/admin/products/${id}/images`}
                enctype="multipart/form-data"
                class="gallery-upload-form"
              >
                <label class="gallery-add-card empty-add-card" title="Upload photographs">
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                  <span>Upload Photographs</span>
                  <input
                    type="file"
                    name="photos"
                    multiple
                    accept={photoTypes}
                    class="visually-hidden-file"
                    onchange="this.form.submit()"
                  />
                </label>
              </form>
            </li>
          </ul>
        ) : (
          <ul class="admin-gallery">
            {images.map((image) => {
              const list = byImage.get(image.id) ?? []
              return (
                <li class="gallery-item admin-photo-item">
                  <div class="photo-container">
                    <Picture
                      image={image}
                      derivatives={list}
                      sizes="(min-width: 640px) 510px, calc(85vw - 34px)"
                    />
                    <form
                      method="post"
                      action={`/admin/products/${id}/images/${image.id}/delete`}
                      class="photo-del-form"
                    >
                      <button
                        type="submit"
                        class="photo-del-btn"
                        title="Remove photograph"
                        onclick="return confirm('Remove this photograph?')"
                        aria-label="Remove photograph"
                      >
                        ×
                      </button>
                    </form>
                  </div>
                  <p class="muted photo-meta">
                    {image.width}×{image.height} · {list.length} derivatives
                  </p>
                </li>
              )
            })}

            {waiting.map((job) => (
              <li class="gallery-item admin-photo-item">
                <div class="photo-container photo-pending">
                  <span class="muted photo-meta">{job.originalFilename}</span>
                  <span class={job.error ? 'fail' : 'muted'} style="font-size: 13px;">
                    {job.error ? job.error : 'Encoding…'}
                  </span>
                  {job.error ? (
                    <form method="post" action={`/admin/products/${id}/pending/${job.id}/discard`}>
                      <button
                        type="submit"
                        class="secondary"
                        style="font-size: 12px; padding: 4px 8px;"
                      >
                        Discard
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}

            <li class="gallery-add-item">
              <form
                method="post"
                action={`/admin/products/${id}/images`}
                enctype="multipart/form-data"
                class="gallery-upload-form"
              >
                <label class="gallery-add-card" title="Add photograph">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                  <span>Add photo</span>
                  <input
                    type="file"
                    name="photos"
                    multiple
                    accept={photoTypes}
                    class="visually-hidden-file"
                    onchange="this.form.submit()"
                  />
                </label>
              </form>
            </li>
          </ul>
        )}

        {/* Product Details Section: Title, Category, Price, Description, Variants & Counts */}
        <div class="admin-detail">
          <form method="post" action={`/admin/products/${product.id}`} class="admin-detail-form">
            <div>
              <span class="field-label">Title</span>
              <input
                type="text"
                name="title"
                value={product.title}
                class="edit-title-input"
                placeholder="Product Title"
                required
                maxlength={200}
              />
            </div>

            <div class="edit-category-row">
              <span class="field-label">Category (Shelf)</span>
              <select name="categoryId">
                <option value="" selected={product.categoryId === null}>
                  Unshelved
                </option>
                {shelves.map((cat) => (
                  <option value={cat.id} selected={product.categoryId === cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span class="field-label">Price</span>
              <div class="edit-price-row">
                <span class="price-symbol">৳</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  name="price"
                  value={(product.pricePaisa / 100).toFixed(2)}
                  class="edit-price-input"
                  required
                />
                <span class="price-suffix">BDT</span>
              </div>
            </div>

            <div>
              <span class="field-label">Description</span>
              <textarea
                name="description"
                rows={4}
                class="edit-desc-input"
                placeholder="Product description..."
              >
                {product.description}
              </textarea>
            </div>

            <div class="variant-group">
              <div class="variant-header-row">
                <span class="variant-label">Variants & Stock Quantity</span>
                <span class="muted" style="font-size: 12px;">
                  {totalStock} in stock
                </span>
              </div>
              <div class="variant-options admin-variant-options" id="variant-list">
                {variants.map(({ variant, options }) => (
                  <div class="admin-variant-chip" key={variant.id}>
                    <span class="variant-chip-name">{variant.label}</span>
                    <span class="variant-divider">·</span>
                    <div class="variant-qty-wrapper">
                      <input
                        type="number"
                        name={`stock_${variant.id}`}
                        value={variant.stockQty}
                        min="0"
                        step="1"
                        inputmode="numeric"
                        class="variant-qty-input"
                        title="Stock count"
                        required
                      />
                      <span class="variant-qty-label">units</span>
                    </div>
                    {variants.length > 1 ? (
                      <button
                        type="submit"
                        formAction={`/admin/products/${product.id}/variants/${variant.id}/delete`}
                        formMethod="post"
                        class="variant-del-btn"
                        title="Delete variant"
                        onclick="return confirm('Delete this variant?')"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                ))}

                {/* + icon for add variant next to existing ones */}
                <button
                  type="button"
                  id="toggle-add-variant-btn"
                  class="add-variant-btn"
                  title="Add variant"
                >
                  <span>+</span>
                  <span>Add variant</span>
                </button>

                <div id="new-variant-chip" class="admin-variant-chip new-variant-chip" hidden>
                  <div class="new-variant-options-inputs">
                    <input
                      type="text"
                      name="new_oname_0"
                      placeholder="Axis (e.g. Size)"
                      list="option-names"
                      class="variant-axis-input"
                    />
                    <input
                      type="text"
                      name="new_ovalue_0"
                      id="new-ovalue-input"
                      placeholder="Value (e.g. M)"
                      class="variant-val-input"
                    />
                  </div>
                  <span class="variant-divider">·</span>
                  <div class="variant-qty-wrapper">
                    <input
                      type="number"
                      name="new_stock"
                      id="new-stock-input"
                      value="0"
                      min="0"
                      step="1"
                      inputmode="numeric"
                      class="variant-qty-input"
                    />
                    <span class="variant-qty-label">units</span>
                  </div>
                  <button
                    type="button"
                    id="cancel-add-variant-btn"
                    class="variant-del-btn"
                    title="Cancel"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>

            <datalist id="option-names">
              {axisNames.map((name) => (
                <option value={name} />
              ))}
            </datalist>

            <button type="submit" class="btn" style="margin-top: 10px;">
              Save Changes
            </button>

            <div class="admin-detail-footer">
              <span class="muted">
                Slug: <code>/p/{product.slug}</code>
              </span>
              <a href={`/p/${product.slug}`} target="_blank" rel="noopener">
                View on storefront ↗
              </a>
            </div>
          </form>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: addVariantScript }} />
      <noscript>
        <style
          dangerouslySetInnerHTML={{
            __html: `#new-variant-chip { display: inline-flex !important; } #toggle-add-variant-btn { display: none !important; }`,
          }}
        />
      </noscript>
    </AdminLayout>,
  )
})

adminProducts.post('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [product] = db.select().from(products).where(eq(products.id, id)).all()
  if (!product) return c.notFound()

  const back = `/admin/products/${id}`
  const fail = (message: string) => c.redirect(`${back}?error=${encodeURIComponent(message)}`, 303)

  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return fail('Form submission was not readable')
  }

  const title = String(form.get('title') ?? '').trim()
  if (!title) {
    return fail('Title cannot be blank')
  }

  const priceRaw = String(form.get('price') ?? '').trim()
  const priceFloat = parseFloat(priceRaw)
  if (isNaN(priceFloat) || priceFloat <= 0) {
    return fail('Price must be greater than zero')
  }
  const pricePaisa = Math.round(priceFloat * 100)
  const description = String(form.get('description') ?? '').trim()

  const rawCat = String(form.get('categoryId') ?? '').trim()
  const categoryId = rawCat ? Number(rawCat) : null
  if (categoryId !== null) {
    const [cat] = db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, categoryId))
      .all()
    if (!cat) return fail('No such category.')
  }

  try {
    db.update(products)
      .set({
        title,
        pricePaisa,
        description,
        categoryId,
      })
      .where(eq(products.id, id))
      .run()
  } catch (err) {
    console.error('[admin] update product error', err)
    return fail('Failed to update product details')
  }

  // Update existing variant stock counts
  const existingVariants = db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, id))
    .all()

  for (const v of existingVariants) {
    const rawStock = form.get(`stock_${v.id}`) ?? form.get(`variant_stock_${v.id}`)
    if (rawStock !== null) {
      const stockQty = parseStock(String(rawStock), 'reject')
      if (stockQty !== null) {
        try {
          db.update(productVariants)
            .set({ stockQty })
            .where(and(eq(productVariants.id, v.id), eq(productVariants.productId, id)))
            .run()
        } catch (err) {
          console.error(`[admin] failed to update variant stock ${v.id}`, err)
        }
      }
    }
  }

  // Handle new variant if submitted via inline fields
  const newAxisName = String(form.get('new_oname_0') ?? '').trim()
  const newAxisVal = String(form.get('new_ovalue_0') ?? form.get('new_variant_label') ?? '').trim()
  const newStockRaw = form.get('new_stock') ?? form.get('new_variant_qty')
  if (newAxisVal) {
    const newStock = parseStock(String(newStockRaw ?? '0'), 'zero') ?? 0
    const nextPos = existingVariants.reduce((n, v) => Math.max(n, v.position + 1), 0)
    const label = newAxisVal
    try {
      db.transaction((tx) => {
        const [row] = tx
          .insert(productVariants)
          .values({
            productId: id,
            label,
            stockQty: newStock,
            position: nextPos,
          })
          .returning({ id: productVariants.id })
          .all()
        if (row && newAxisName) {
          tx.insert(variantOptions)
            .values({
              variantId: row.id,
              name: newAxisName,
              nameSlug: slugify(newAxisName, 'option'),
              value: newAxisVal,
              valueSlug: slugify(newAxisVal, 'value'),
              position: 0,
            })
            .run()
        }
      })
    } catch (err) {
      console.error('[admin] failed to add new variant from main form', err)
    }
  }

  return c.redirect(`${back}?saved=${encodeURIComponent('Product updated.')}`, 303)
})

adminProducts.post('/:id/images', async (c) => {
  const id = Number(c.req.param('id'))
  const [product] = db.select().from(products).where(eq(products.id, id)).all()
  if (!product) return c.notFound()
  const back = `/admin/products/${id}`
  const fail = (message: string) => c.redirect(`${back}?error=${encodeURIComponent(message)}`, 303)

  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return fail('Upload was not readable')
  }
  const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length === 0) return fail('Choose at least one file')
  if (!queueHasRoomFor(files.length)) {
    return fail('The encoder is still working through the last batch. Try again shortly.')
  }

  const altText = String(form.get('altText') ?? '').trim()
  const problems: string[] = []
  let queued = 0
  for (const file of files) {
    try {
      await queueProductImage({
        productId: id,
        filename: file.name || 'upload',
        contentType: file.type,
        bytes: Buffer.from(await file.arrayBuffer()),
        altText: altText || product.title,
      })
      queued++
    } catch (err) {
      const message = err instanceof UploadError ? err.message : 'could not be accepted'
      if (!(err instanceof UploadError)) console.error('[admin] queue', err)
      problems.push(`"${file.name}" ${message}`)
    }
  }
  drainQueue()

  if (queued === 0) return fail(problems.join(' · ') || 'Nothing was accepted')
  const query = new URLSearchParams({ uploaded: String(queued) })
  if (problems.length) query.set('error', problems.join(' · ').slice(0, 400))
  return c.redirect(`${back}?${query}`, 303)
})

/**
 * A photograph the encoder could not read stays visible until someone deals
 * with it — but "deal with it" has to mean something, so it can be thrown away.
 * Re-uploading a fixed file is the retry.
 */
adminProducts.post('/:id/pending/:pendingId/discard', (c) => {
  const id = Number(c.req.param('id'))
  // Matched on both halves of the path, so a stale form cannot discard another
  // product's queue row on a mistyped id.
  db.delete(pendingImages)
    .where(
      and(eq(pendingImages.id, Number(c.req.param('pendingId'))), eq(pendingImages.productId, id)),
    )
    .run()
  return c.redirect(`/admin/products/${id}`, 303)
})

/**
 * The shelf this product stands on, or none. A POST of its own rather than a
 * field on a larger form because it is the only thing on this page that is not
 * an image or a variant, and a one-field form has one way to go wrong.
 */
adminProducts.post('/:id/category', async (c) => {
  const id = Number(c.req.param('id'))
  const [product] = db.select().from(products).where(eq(products.id, id)).all()
  if (!product) return c.notFound()
  const back = `/admin/products/${id}`
  const fail = (message: string) => c.redirect(`${back}?error=${encodeURIComponent(message)}`, 303)

  const form = await c.req.formData().catch(() => null)
  if (!form) return fail('That submit was not readable.')

  const raw = String(form.get('categoryId') ?? '').trim()
  const categoryId = raw ? Number(raw) : null
  if (categoryId !== null) {
    // Looked up rather than trusted: the select was rendered from this table,
    // but the request need not have come from that page, and a number that is
    // not a category would write a dangling id.
    const [category] = db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, categoryId))
      .all()
    if (!category) return fail('No such category. Nothing was changed.')
  }
  db.update(products).set({ categoryId }).where(eq(products.id, id)).run()
  const message = categoryId === null ? 'Unshelved.' : 'Category saved.'
  return c.redirect(`${back}?saved=${encodeURIComponent(message)}`, 303)
})

adminProducts.post('/:id/variants', async (c) => {
  const id = Number(c.req.param('id'))
  const [product] = db.select().from(products).where(eq(products.id, id)).all()
  if (!product) return c.notFound()
  const back = `/admin/products/${id}`
  const fail = (message: string) => c.redirect(`${back}?error=${encodeURIComponent(message)}`, 303)

  const form = await c.req.formData().catch(() => null)
  if (!form) return fail('That submit was not readable.')

  const existing = db
    .select({ label: productVariants.label, position: productVariants.position })
    .from(productVariants)
    .where(eq(productVariants.productId, id))
    .all()
  // The labels this product already carries go in with the ones this submit
  // derives, so a repeat is a sentence rather than a UNIQUE error thrown
  // halfway through the batch.
  const { drafts, problems } = parseVariantRows(form, new Set(existing.map((v) => v.label)))
  if (drafts.length === 0) {
    return fail(problems.join(' · ') || 'Nothing to add — fill in at least one row.')
  }

  // New variants go after the ones already there; the operator reorders by
  // deleting and re-adding, which is cheap while a product has three of them.
  let position = existing.reduce((n, v) => Math.max(n, v.position + 1), 0)
  try {
    // A variant without its options is a label nobody can filter on, so the two
    // inserts are one transaction or neither.
    db.transaction((tx) => {
      for (const draft of drafts) {
        const [row] = tx
          .insert(productVariants)
          .values({
            productId: id,
            label: draft.label,
            stockQty: draft.stockQty,
            position: position++,
          })
          .returning({ id: productVariants.id })
          .all()
        if (!row) throw new Error('insert returned no row')
        if (draft.options.length > 0) {
          tx.insert(variantOptions)
            .values(draft.options.map((option) => ({ variantId: row.id, ...option })))
            .run()
        }
      }
    })
  } catch (err) {
    console.error('[admin] variants', err)
    // The label check above is read-then-write, so a second tab can still slip
    // between them. The index is what actually holds it shut; this is what
    // turns that into something an operator can read.
    return fail(
      String(err).includes('UNIQUE')
        ? 'Two variants of one product cannot have the same options. Nothing was saved.'
        : 'Could not save these variants. See the server log.',
    )
  }

  const query = new URLSearchParams({
    saved: `Added ${drafts.length} ${drafts.length === 1 ? 'variant' : 'variants'}.`,
  })
  if (problems.length) query.set('error', problems.join(' · ').slice(0, 400))
  return c.redirect(`${back}?${query}`, 303)
})

adminProducts.post('/:id/variants/:variantId', async (c) => {
  const id = Number(c.req.param('id'))
  const back = `/admin/products/${id}`

  const form = await c.req.formData().catch(() => null)
  // 'reject', not 'zero': this field is rendered pre-filled with the figure it
  // is about to replace, so an empty one is a cleared box rather than a count
  // of none. The add form below renders its rows empty and asks for the other
  // reading.
  const stockQty = parseStock(String(form?.get('stock') ?? ''), 'reject')
  if (stockQty === null) {
    const message = 'Stock must be a whole number, 0 or more. Nothing was changed.'
    return c.redirect(`${back}?error=${encodeURIComponent(message)}`, 303)
  }

  // Matched on both halves of the path, like the discard above: a stale form
  // cannot re-stock another product's variant on a mistyped id. Nothing matching
  // is reported rather than answered with "saved" — a stock figure is the one
  // number here somebody will later act on.
  const updated = db
    .update(productVariants)
    .set({ stockQty })
    .where(
      and(
        eq(productVariants.id, Number(c.req.param('variantId'))),
        eq(productVariants.productId, id),
      ),
    )
    .run()
  const message = updated.changes === 0 ? 'No such variant.' : 'Stock saved.'
  return c.redirect(`${back}?${updated.changes === 0 ? 'error' : 'saved'}=${encodeURIComponent(message)}`, 303)
})

adminProducts.post('/:id/variants/:variantId/delete', (c) => {
  const id = Number(c.req.param('id'))
  // variant_options cascades (schema.ts), so the axes go with the variant.
  const deleted = db
    .delete(productVariants)
    .where(
      and(
        eq(productVariants.id, Number(c.req.param('variantId'))),
        eq(productVariants.productId, id),
      ),
    )
    .run()
  const message = deleted.changes === 0 ? 'No such variant.' : 'Variant deleted.'
  return c.redirect(
    `/admin/products/${id}?${deleted.changes === 0 ? 'error' : 'saved'}=${encodeURIComponent(message)}`,
    303,
  )
})

/**
 * Remove a finished image from a product's gallery. The cascade on
 * image_derivatives handles the DB side; the derivative blobs stay in storage
 * because they are content-addressed and immutable (ADR-0007) — a URL that has
 * been served keeps resolving, and the same bytes may belong to another image.
 */
adminProducts.post('/:id/images/:imageId/delete', (c) => {
  const id = Number(c.req.param('id'))
  const imageId = Number(c.req.param('imageId'))
  db.delete(productImages)
    .where(and(eq(productImages.id, imageId), eq(productImages.productId, id)))
    .run()
  return c.redirect(`/admin/products/${id}`, 303)
})


