import type { DerivativeFormat } from './vips.js'

export { fileExtensions } from './vips.js'

/**
 * Open decision #5 (docs/open-decisions.md): the ladder is not settled and
 * wants a real photograph to measure against. These are working defaults.
 *
 * Widths are chosen against the storefront's two layouts — a listing grid card
 * and a product page hero — at 1x and 2x on the phones ADR-0003 targets. JPEG
 * is the floor every browser can read; WebP and AVIF are offered ahead of it in
 * a <picture> and are skipped silently where the encoder cannot write them.
 */
export const ladderWidths = [320, 480, 640, 960, 1280, 1600] as const

export const formatOrder: readonly DerivativeFormat[] = ['avif', 'webp', 'jpeg']

export const quality: Record<DerivativeFormat, number> = {
  avif: 50,
  webp: 72,
  jpeg: 78,
}

export const mimeTypes: Record<DerivativeFormat, string> = {
  avif: 'image/avif',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
}

/** Never upscale: a 700px original gets 320 and 480 and nothing above it. */
export function widthsFor(originalWidth: number): number[] {
  const fitting = ladderWidths.filter((w) => w <= originalWidth)
  return fitting.length > 0 ? [...fitting] : [originalWidth]
}
