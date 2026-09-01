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

  const error = c.req.query('error')
  const uploaded = Number(c.req.query('uploaded') ?? 0)
  // Two names for one banner: this page was reached from routes on both sides
  // of a merge, and they do not agree on the parameter.
  const notice = c.req.query('notice') ?? c.req.query('saved')

  return c.html(
    <AdminLayout
      title={product.title}
      section="products"
      back={{ href: '/admin/products', label: 'All products' }}
    >
      <p class="muted">
        {formatPaisa(product.pricePaisa)} ·{' '}
        <a href={`/p/${product.slug}`} target="_blank" rel="noopener">
          view on the storefront ↗
        </a>
      </p>
      {error ? <p class="notice error">{error}</p> : null}
      {notice ? <p class="notice">{notice}</p> : null}
      {uploaded > 0 ? (
        <p class="notice">
          {uploaded} {uploaded === 1 ? 'photograph' : 'photographs'} accepted — encoding in the
          background. Reload for progress.
        </p>
      ) : null}

      <form method="post" action={`/admin/products/${product.id}/category`}>
        <label>
          Category
          <select name="categoryId">
            <option value="" selected={product.categoryId === null}>
              Unshelved
            </option>
            {shelves.map((category) => (
              <option value={category.id} selected={product.categoryId === category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <p class="actions">
          <button type="submit">Save category</button>
        </p>
      </form>

      <h2>Variants</h2>
      {variants.map(({ variant, options }) => (
        <form
          class="row"
          method="post"
          action={`/admin/products/${product.id}/variants/${variant.id}`}
        >
          <p class="span">
            <strong>{variant.label}</strong>
            {options.length > 0 ? (
              <span class="muted"> · {options.map((o) => `${o.name}: ${o.value}`).join(' · ')}</span>
            ) : null}
          </p>
          <label>
            Stock
            <input
              name="stock"
              type="number"
              min="0"
              step="1"
              inputmode="numeric"
              value={String(variant.stockQty)}
            />
          </label>
          <p class="span actions">
            <button type="submit">Save stock</button>
            <button
              type="submit"
              formaction={`/admin/products/${product.id}/variants/${variant.id}/delete`}
            >
              Delete
            </button>
          </p>
        </form>
      ))}
      {variants.length === 0 ? (
        <p class="muted">
          None yet. A product with one configuration still wants one variant — that is what an
          order will eventually hold.
        </p>
      ) : null}

      <form class="bulk" method="post" action={`/admin/products/${product.id}/variants`}>
        <div id="rows">
          {Array.from({ length: initialVariantRows }, (_, i) => (
            <VariantRow i={i} />
          ))}
        </div>
        <template id="row-template">
          <VariantRow i="__i__" />
        </template>
        <p class="actions">
          <button type="button" id="add-row" hidden>
            Add another row
          </button>
          <button type="submit">Add variants</button>
        </p>
        <p class="muted">
          Blank rows are ignored. The label is the values joined — Indigo / M — so two rows with
          the same options are one variant entered twice, and the second is refused rather than
          saved. Stock stays in the back office: nothing on the storefront reads it (ADR-0007).
        </p>
      </form>
      {/* Shared by every row, including the ones the script clones. */}
      <datalist id="option-names">
        {axisNames.map((name) => (
          <option value={name} />
        ))}
      </datalist>
      <script
        dangerouslySetInnerHTML={{ __html: addRowScript(initialVariantRows, maxVariantRows) }}
      />

      <h2>Photographs</h2>
      <form method="post" action={`/admin/products/${product.id}/images`} enctype="multipart/form-data">
        <label>
          Photographs
          <input type="file" name="photos" required multiple accept={photoTypes} />
        </label>
        <label>
          Alt text
          <input name="altText" maxlength={200} placeholder="Indigo jamdani saree, full length" />
        </label>
        <button type="submit">Upload</button>
        <p class="muted">
          The whole derivative ladder is generated ahead of the request, never on one (ADR-0007) —
          now on a background worker, so the upload returns as soon as the bytes are safe.
        </p>
      </form>

      {waiting.length > 0 ? (
        <ul class="queue">
          {waiting.map((job) => (
            <li>
              <span class={job.error ? 'fail' : 'muted'}>
                {job.originalFilename} — {job.error ? job.error : 'encoding…'}
              </span>
              {job.error ? (
                <form method="post" action={`/admin/products/${id}/pending/${job.id}/discard`}>
                  <button type="submit">Discard</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <ul class="gallery">
        {images.map((image) => {
          const list = byImage.get(image.id) ?? []
          return (
            <li>
              <Picture image={image} derivatives={list} sizes="180px" />
              <p class="muted">
                {image.width}×{image.height} · {list.length} derivatives ·{' '}
                {Math.round(list.reduce((n, d) => n + d.byteSize, 0) / 1024)} KB total
              </p>
              <form method="post" action={`/admin/products/${id}/images/${image.id}/delete`}>
                <button type="submit" onclick="return confirm('Remove this image?')">
                  Remove
                </button>
              </form>
            </li>
          )
        })}
      </ul>
      {images.length === 0 && waiting.length === 0 ? <p class="muted">No images yet.</p> : null}
    </AdminLayout>,
  )
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


