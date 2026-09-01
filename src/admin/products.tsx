import { asc, count, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { imageDerivatives, productImages, products } from '../db/schema.js'
import type { ImageDerivative } from '../db/schema.js'
import { EncoderError, UploadError, ingestProductImage } from '../images/pipeline.js'
import { formatPaisa } from '../lib/money.js'
import { AdminLayout } from '../views/layout.js'
import { Picture } from '../views/picture.js'

export const adminProducts = new Hono()

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
  const error = c.req.query('error')
  return c.html(
    <AdminLayout title="Products">
      {error ? <p class="notice error">{error}</p> : null}
      <form method="post" action="/admin/products">
        <label>
          Title
          <input name="title" required maxlength={200} />
        </label>
        <label>
          Slug
          <input name="slug" required pattern="[a-z0-9\-]+" placeholder="jamdani-saree-indigo" />
        </label>
        <label>
          Price (BDT)
          <input name="priceBdt" required type="number" min="1" step="0.01" />
        </label>
        <label>
          Description
          <textarea name="description" rows={3}></textarea>
        </label>
        <button type="submit">Add product</button>
      </form>
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
          {rows.map((p) => (
            <tr>
              <td>
                <a href={`/admin/products/${p.id}`}>{p.title}</a>
              </td>
              <td class="muted">{p.slug}</td>
              <td>{formatPaisa(p.pricePaisa)}</td>
              <td>{imageCounts.get(p.id) ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <p class="muted">No products yet.</p> : null}
    </AdminLayout>,
  )
})

adminProducts.post('/', async (c) => {
  const form = await c.req.formData()
  const title = String(form.get('title') ?? '').trim()
  const slug = String(form.get('slug') ?? '').trim()
  const description = String(form.get('description') ?? '').trim()
  const priceBdt = Number(form.get('priceBdt'))

  if (!title || !/^[a-z0-9-]+$/.test(slug) || !Number.isFinite(priceBdt) || priceBdt <= 0) {
    return c.redirect('/admin/products?error=' + encodeURIComponent('Check title, slug and price'), 303)
  }
  // Money is integer paisa everywhere (ADR-0006); round at the boundary, once.
  const pricePaisa = Math.round(priceBdt * 100)

  try {
    const [row] = db
      .insert(products)
      .values({ title, slug, description, pricePaisa })
      .returning({ id: products.id })
      .all()
    return c.redirect(`/admin/products/${row?.id}`, 303)
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    const message = raw.includes('UNIQUE') ? `Slug "${slug}" is already taken` : raw
    return c.redirect('/admin/products?error=' + encodeURIComponent(message), 303)
  }
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
  const derivatives = images.length
    ? db
        .select()
        .from(imageDerivatives)
        .where(inArray(imageDerivatives.imageId, images.map((i) => i.id)))
        .all()
    : []
  const byImage = new Map<number, ImageDerivative[]>()
  for (const d of derivatives) byImage.set(d.imageId, [...(byImage.get(d.imageId) ?? []), d])

  const error = c.req.query('error')
  const uploaded = c.req.query('uploaded')

  return c.html(
    <AdminLayout title={product.title}>
      <p class="muted">
        {formatPaisa(product.pricePaisa)} · <a href={`/p/${product.slug}`}>view on the storefront</a>
      </p>
      {error ? <p class="notice error">{error}</p> : null}
      {uploaded ? <p class="notice">Generated {uploaded} derivatives.</p> : null}

      <form method="post" action={`/admin/products/${product.id}/images`} enctype="multipart/form-data">
        <label>
          Photograph
          <input type="file" name="file" required accept="image/jpeg,image/png,image/webp,image/avif,image/tiff" />
        </label>
        <label>
          Alt text
          <input name="altText" maxlength={200} placeholder="Indigo jamdani saree, full length" />
        </label>
        <button type="submit">Upload</button>
        <p class="muted">
          The whole derivative ladder is generated now, at upload, and never on a request (ADR-0007).
        </p>
      </form>

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
      {images.length === 0 ? <p class="muted">No images yet.</p> : null}
    </AdminLayout>,
  )
})

adminProducts.post('/:id/images', async (c) => {
  const id = Number(c.req.param('id'))
  const [product] = db.select().from(products).where(eq(products.id, id)).all()
  if (!product) return c.notFound()
  const back = `/admin/products/${id}`

  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.redirect(`${back}?error=${encodeURIComponent('Upload was not readable')}`, 303)
  }
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return c.redirect(`${back}?error=${encodeURIComponent('Choose a file')}`, 303)
  }
  if (file.size > config.maxUploadBytes) {
    const mb = Math.round(config.maxUploadBytes / (1024 * 1024))
    return c.redirect(`${back}?error=${encodeURIComponent(`File is larger than ${mb}MB`)}`, 303)
  }

  try {
    const result = await ingestProductImage({
      productId: id,
      filename: file.name || 'upload',
      contentType: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
      altText: String(form.get('altText') ?? '').trim(),
    })
    return c.redirect(`${back}?uploaded=${result.derivatives}`, 303)
  } catch (err) {
    const message =
      err instanceof UploadError || err instanceof EncoderError
        ? err.message
        : 'Upload failed. See the server log.'
    if (!(err instanceof UploadError)) console.error('[upload]', err)
    return c.redirect(`${back}?error=${encodeURIComponent(message)}`, 303)
  }
})
