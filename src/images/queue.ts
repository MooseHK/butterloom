import { createHash } from 'node:crypto'
import { asc, count, eq, isNull } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { pendingImages } from '../db/schema.js'
import type { PendingImage } from '../db/schema.js'
import { EncoderError, UploadError, acceptedTypes, ingestProductImage } from './pipeline.js'
import { fileStore, shardedKey } from './storage.js'

/**
 * The upload queue. Accepting a photograph is a hash and one write; cutting its
 * ladder is seconds of libvips. Doing the second one inside the POST is what
 * made adding twenty products a twenty-minute stare at a spinner, so the POST
 * now does the first and returns, and this drains the rest.
 *
 * One worker, deliberately. libvips already saturates a core per encode, so N
 * workers on a single-box deployment (ADR-0003) would not finish a bulk of a
 * hundred any sooner — they would just make the storefront slow while it ran.
 * ponytail: serial worker; give it a small pool if a bigger box ever justifies
 * one, and move the claim to an UPDATE ... RETURNING if a second process does.
 */

/** Rejected before anything is stored, so the operator hears about it at once. */
function assertAcceptable(contentType: string, byteLength: number): void {
  if (!acceptedTypes.has(contentType)) {
    throw new UploadError(`Unsupported image type: ${contentType || 'unknown'}`)
  }
  if (byteLength === 0) throw new UploadError('Empty upload')
  if (byteLength > config.maxUploadBytes) {
    const mb = Math.round(config.maxUploadBytes / (1024 * 1024))
    throw new UploadError(`File is larger than ${mb}MB`)
  }
}

/**
 * Take the bytes off the operator's hands. The original goes to the blob store
 * under its own hash — where ADR-0007 wants it anyway, so re-cutting the ladder
 * never means re-uploading — and the row below is the only thing the worker
 * needs to find it again.
 */
export async function queueProductImage(input: {
  productId: number
  filename: string
  contentType: string
  bytes: Buffer
  altText: string
}): Promise<void> {
  assertAcceptable(input.contentType, input.bytes.byteLength)

  const originalSha = createHash('sha256').update(input.bytes).digest('hex')
  await fileStore.put(shardedKey(originalSha, 'original'), input.bytes)

  db.insert(pendingImages)
    .values({
      productId: input.productId,
      altText: input.altText,
      originalFilename: input.filename.slice(0, 200),
      contentType: input.contentType,
      originalSha256: originalSha,
    })
    .run()
}

let draining = false

/**
 * Kick the worker. Safe to call on every upload and at startup: the flag means
 * a second call joins the run already in progress rather than starting a
 * second one. Returns immediately — nothing awaits the encoding.
 */
export function drainQueue(): void {
  if (draining) return
  draining = true
  void (async () => {
    try {
      for (;;) {
        const [job] = db
          .select()
          .from(pendingImages)
          .where(isNull(pendingImages.error))
          .orderBy(asc(pendingImages.id))
          .limit(1)
          .all()
        if (!job) return
        await encodeOne(job)
      }
    } catch (err) {
      // Only reached if the database itself is unhappy; the per-job failure
      // path is inside encodeOne. Stopping is correct — the next upload or
      // restart tries again.
      console.error('[queue] worker stopped', err)
    } finally {
      draining = false
    }
  })()
}

async function encodeOne(job: PendingImage): Promise<void> {
  try {
    const bytes = await fileStore.read(shardedKey(job.originalSha256, 'original'))
    await ingestProductImage({
      productId: job.productId,
      filename: job.originalFilename,
      contentType: job.contentType,
      bytes,
      altText: job.altText,
    })
    // The blob stays: it is the original, content-addressed and immutable, and
    // ingestProductImage has just recorded its hash against the image row.
    db.delete(pendingImages).where(eq(pendingImages.id, job.id)).run()
  } catch (err) {
    const message =
      err instanceof UploadError || err instanceof EncoderError
        ? err.message
        : 'Encoding failed. See the server log.'
    if (!(err instanceof UploadError)) console.error('[queue]', job.originalFilename, err)
    // Parks the row: the worker claims null-error rows only, so a file that
    // cannot be encoded stops the queue for exactly one attempt rather than
    // for good.
    db.update(pendingImages)
      .set({ error: message.slice(0, 200) })
      .where(eq(pendingImages.id, job.id))
      .run()
  }
}

export interface PendingTally {
  queued: number
  failed: number
}

/** How much work is outstanding, per product. Bounded by config.maxPendingImages. */
export function pendingByProduct(): Map<number, PendingTally> {
  const tally = new Map<number, PendingTally>()
  for (const row of db.select().from(pendingImages).all()) {
    const entry = tally.get(row.productId) ?? { queued: 0, failed: 0 }
    if (row.error) entry.failed += 1
    else entry.queued += 1
    tally.set(row.productId, entry)
  }
  return tally
}

/** Rows still waiting, or parked with an error, for one product. */
export function pendingForProduct(productId: number): PendingImage[] {
  return db
    .select()
    .from(pendingImages)
    .where(eq(pendingImages.productId, productId))
    .orderBy(asc(pendingImages.id))
    .all()
}

/**
 * The backpressure. A hundred products at four photographs each is four hundred
 * encodes; the queue survives that, but there is no point letting an operator
 * pile on a thousand more while it works — the disk fills with originals nobody
 * has looked at yet. Refusing the submit is honest and costs nothing.
 */
export function queueHasRoomFor(files: number): boolean {
  return countPending() + files <= config.maxPendingImages
}

export function countPending(): number {
  const [row] = db.select({ n: count() }).from(pendingImages).all()
  return row?.n ?? 0
}
