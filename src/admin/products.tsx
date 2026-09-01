import { and, asc, count, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { pendingImages, productImages, products } from '../db/schema.js'
import { UploadError } from '../images/pipeline.js'
import {
  drainQueue,
  pendingByProduct,
  pendingForProduct,
  queueHasRoomFor,
  queueProductImage,
} from '../images/queue.js'
import { formatPaisa } from '../lib/money.js'
import { derivativesFor } from '../storefront/queries.js'
import { AdminLayout } from '../views/layout.js'
import { Picture } from '../views/picture.js'
import { maxRows, parseRows, slugify, uniqueSlug } from './bulkForm.js'
import type { DraftProduct } from './bulkForm.js'

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
const initialRows = 3
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
function Row(props: { i: number | string }) {
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
 * ADR-0007 rules out a client framework, not five lines of DOM. Without them
 * the form still works — it just stops at the rows rendered above, which is why
 * there are three rather than one.
 */
const addRowScript = `
  var rows = document.getElementById('rows')
  var tpl = document.getElementById('row-template')
  var add = document.getElementById('add-row')
  var next = ${initialRows}
  add.hidden = false
  add.addEventListener('click', function () {
    rows.insertAdjacentHTML('beforeend', tpl.innerHTML.replaceAll('__i__', next++))
    var input = rows.lastElementChild.querySelector('input')
    if (input) input.focus()
    if (next >= ${maxRows}) add.disabled = true
  })
`

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
  const pending = pendingByProduct()
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
            <Row i={i} />
          ))}
        </div>
        <template id="row-template">
          <Row i="__i__" />
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
      <script dangerouslySetInnerHTML={{ __html: addRowScript }} />

      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Slug</th>
            <th>Price</th>
            <th>Images</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const tally = pending.get(p.id)
            return (
              <tr>
                <td>
                  <a href={`/admin/products/${p.id}`}>{p.title}</a>
                </td>
                <td class="muted">{p.slug}</td>
                <td>{formatPaisa(p.pricePaisa)}</td>
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
            slug: uniqueSlug(slugify(draft.title), taken),
            description: draft.description,
            pricePaisa: draft.pricePaisa,
          })
          .returning({ id: products.id })
          .all()
        if (!row) throw new Error('insert returned no row')
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

  const error = c.req.query('error')
  const uploaded = Number(c.req.query('uploaded') ?? 0)

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
      {uploaded > 0 ? (
        <p class="notice">
          {uploaded} {uploaded === 1 ? 'photograph' : 'photographs'} accepted — encoding in the
          background. Reload for progress.
        </p>
      ) : null}

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
