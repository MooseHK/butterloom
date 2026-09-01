import { Hono } from 'hono'
import { config } from '../config.js'
import { siteImageSlots } from '../db/schema.js'
import type { SiteImageSlot } from '../db/schema.js'
import { EncoderError, UploadError, ingestSiteImage } from '../images/pipeline.js'
import { findSiteImage } from '../storefront/queries.js'
import { AdminLayout } from '../views/layout.js'
import { Picture } from '../views/picture.js'

export const adminSiteImages = new Hono()

/**
 * Editorial photography that belongs to the site rather than to a product. One
 * screen listing every slot, because the whole point of a slot is that it is a
 * fixed position someone has to be able to find and fill — a slot nobody can
 * see is a slot that stays empty.
 */
const slotDescriptions: Record<SiteImageSlot, { title: string; where: string }> = {
  hero: {
    title: 'Front page hero',
    where: 'The full-bleed photograph at the top of the front page.',
  },
}

function isSlot(value: string): value is SiteImageSlot {
  return (siteImageSlots as readonly string[]).includes(value)
}

adminSiteImages.get('/', (c) => {
  const error = c.req.query('error')
  const uploaded = c.req.query('uploaded')

  return c.html(
    <AdminLayout title="Site images" section="site-images">
      {error ? <p class="notice error">{error}</p> : null}
      {uploaded ? <p class="notice">Generated {uploaded} derivatives.</p> : null}
      <p class="muted">
        A slot holds one photograph. Uploading to a filled slot replaces what is there.
      </p>

      {siteImageSlots.map((slot) => {
        const current = findSiteImage(slot)
        const meta = slotDescriptions[slot]
        return (
          <section>
            <h2>{meta.title}</h2>
            <p class="muted">{meta.where}</p>

            {current ? (
              <ul class="gallery">
                <li>
                  <Picture image={current.image} derivatives={current.derivatives} sizes="180px" />
                  <p class="muted">
                    {current.image.width}×{current.image.height} · {current.derivatives.length}{' '}
                    derivatives ·{' '}
                    {Math.round(
                      current.derivatives.reduce((n, d) => n + d.byteSize, 0) / 1024,
                    )}{' '}
                    KB total
                  </p>
                </li>
              </ul>
            ) : (
              <p class="muted">Empty. The front page falls back to the logo block until this is filled.</p>
            )}

            <form
              method="post"
              action={`/admin/site-images/${slot}`}
              enctype="multipart/form-data"
            >
              <label>
                Photograph
                <input
                  type="file"
                  name="file"
                  required
                  accept="image/jpeg,image/png,image/webp,image/avif,image/tiff"
                />
              </label>
              <label>
                Alt text
                <input
                  name="altText"
                  maxlength={200}
                  placeholder="Indigo jamdani draped over a loom"
                />
              </label>
              <button type="submit">{current ? 'Replace' : 'Upload'}</button>
            </form>
          </section>
        )
      })}
    </AdminLayout>,
  )
})

adminSiteImages.post('/:slot', async (c) => {
  const slot = c.req.param('slot')
  if (!isSlot(slot)) return c.notFound()
  const back = '/admin/site-images'

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
    const result = await ingestSiteImage({
      slot,
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
