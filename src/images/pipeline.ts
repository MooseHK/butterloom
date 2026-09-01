import { createHash } from 'node:crypto'
import { eq, max } from 'drizzle-orm'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { db } from '../db/client.js'
import { imageDerivatives, productImages } from '../db/schema.js'
import { fileExtensions, formatOrder, quality, widthsFor } from './ladder.js'
import { fileStore, shardedKey } from './storage.js'
import { EncoderError, encodeDerivative, probe, supportedFormats } from './vips.js'

export { EncoderError }
import type { DerivativeFormat } from './vips.js'

/**
 * Formats this deployment can actually produce, resolved once at startup. The
 * ladder asks for AVIF; a libvips build without an AV1 encoder simply serves a
 * shorter <picture>, which is a page-weight regression and not a failure.
 */
let available: Set<DerivativeFormat> | null = null

export async function resolveEncoderSupport(): Promise<Set<DerivativeFormat>> {
  available ??= await supportedFormats()
  return available
}

const acceptedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/tiff'])

export interface UploadResult {
  imageId: number
  derivatives: number
  skippedFormats: DerivativeFormat[]
}

export class UploadError extends Error {}

/**
 * Take one uploaded photograph, generate the whole derivative ladder, and
 * record it. ADR-0007 puts this work at upload time precisely so that no
 * request path ever encodes an image.
 *
 * The original is written to storage too — not to be served, but because
 * re-cutting the ladder (open decision #5 is still open) must not require
 * asking the operator to re-upload.
 */
export async function ingestProductImage(input: {
  productId: number
  filename: string
  contentType: string
  bytes: Buffer
  altText: string
}): Promise<UploadResult> {
  if (!acceptedTypes.has(input.contentType)) {
    throw new UploadError(`Unsupported image type: ${input.contentType || 'unknown'}`)
  }
  if (input.bytes.byteLength === 0) {
    throw new UploadError('Empty upload')
  }

  const formats = await resolveEncoderSupport()
  if (formats.size === 0) {
    throw new EncoderError(
      'No usable image encoder. Install libvips-tools (vips) on this host, or set BUTTERLOOM_VIPS_BIN.',
    )
  }

  const originalSha = createHash('sha256').update(input.bytes).digest('hex')
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'butterloom-upload-'))
  try {
    const sourceExt = path.extname(input.filename).replace(/[^a-zA-Z0-9.]/g, '') || '.bin'
    const source = path.join(work, `source${sourceExt}`)
    await fs.writeFile(source, input.bytes)

    // Reads the header only; an upload that is not really an image fails here,
    // before anything is stored. The encoder's own message names a temporary
    // path the operator has no use for, so it is logged rather than shown.
    let dimensions
    try {
      dimensions = await probe(source)
    } catch (err) {
      console.error('[upload] unreadable image', input.filename, err)
      throw new UploadError('That file is not a readable image')
    }

    const widths = widthsFor(dimensions.width)
    const rows: (typeof imageDerivatives.$inferInsert)[] = []

    for (const format of formatOrder) {
      if (!formats.has(format)) continue
      for (const width of widths) {
        const out = path.join(work, `${width}.${fileExtensions[format]}`)
        await encodeDerivative(source, out, format, width, quality[format])
        const bytes = await fs.readFile(out)
        if (bytes.byteLength === 0) continue
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        const storageKey = shardedKey(sha256, fileExtensions[format])
        if (!(await fileStore.exists(storageKey))) {
          await fileStore.put(storageKey, bytes)
        }
        const actual = await probe(out)
        rows.push({
          imageId: 0, // replaced once the parent row exists
          format,
          width: actual.width,
          height: actual.height,
          byteSize: bytes.byteLength,
          sha256,
          storageKey,
        })
      }
    }

    if (rows.length === 0) {
      throw new EncoderError('Encoder produced no derivatives')
    }

    await fileStore.put(shardedKey(originalSha, 'original'), input.bytes)

    // One transaction: an image row without its ladder would render a broken
    // <picture>, and SQLite's single writer (ADR-0006) makes this trivial.
    const imageId = db.transaction((tx) => {
      const [row] = tx
        .insert(productImages)
        .values({
          productId: input.productId,
          altText: input.altText,
          originalFilename: path.basename(input.filename).slice(0, 200),
          originalSha256: originalSha,
          width: dimensions.width,
          height: dimensions.height,
          position: nextPosition(tx, input.productId),
        })
        .returning({ id: productImages.id })
        .all()
      if (!row) throw new Error('insert returned no row')
      tx.insert(imageDerivatives)
        .values(rows.map((r) => ({ ...r, imageId: row.id })))
        .run()
      return row.id
    })

    return {
      imageId,
      derivatives: rows.length,
      skippedFormats: formatOrder.filter((f) => !formats.has(f)),
    }
  } finally {
    await fs.rm(work, { recursive: true, force: true })
  }
}

function nextPosition(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  productId: number,
): number {
  const [row] = tx
    .select({ highest: max(productImages.position) })
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .all()
  return row?.highest == null ? 0 : row.highest + 1
}
