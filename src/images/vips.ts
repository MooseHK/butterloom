import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { config } from '../config.js'

const run = promisify(execFile)

/**
 * ADR-0007: the encoder is a subprocess, not a language binding, so encoder
 * choice stays independent of the application stack. Derivative generation
 * happens a handful of times a day inside an admin form; process spawn cost is
 * irrelevant at that rate.
 */
export class EncoderError extends Error {}

async function vips(args: string[]): Promise<string> {
  return exec(config.vipsBin, args)
}

async function exec(bin: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run(bin, args, {
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    })
    return stdout
  } catch (err) {
    const e = err as { stderr?: string; message?: string; code?: string }
    if (e.code === 'ENOENT') {
      throw new EncoderError(
        `Image encoder not found: '${bin}'. Install libvips-tools, or set BUTTERLOOM_VIPS_BIN.`,
      )
    }
    throw new EncoderError((e.stderr || e.message || 'vips failed').trim())
  }
}

export interface Dimensions {
  width: number
  height: number
}

/** Reads header only — this never decodes the image body. */
export async function probe(file: string): Promise<Dimensions> {
  const [width, height] = await Promise.all([
    exec(config.vipsHeaderBin, ['-f', 'width', file]),
    exec(config.vipsHeaderBin, ['-f', 'height', file]),
  ])
  const w = Number(width.trim())
  const h = Number(height.trim())
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
    throw new EncoderError('Could not read image dimensions')
  }
  return { width: w, height: h }
}

export type DerivativeFormat = 'avif' | 'webp' | 'jpeg'

/** The extension selects the libvips saver, so it is defined with the encoder. */
export const fileExtensions: Record<DerivativeFormat, string> = {
  avif: 'avif',
  webp: 'webp',
  jpeg: 'jpg',
}

/**
 * Save options appended to the output path. The path itself carries the
 * extension that selects the saver, so `out` must already end in .avif, .webp
 * or .jpg — see `fileExtensions` in ladder.ts.
 */
const saveOptions: Record<DerivativeFormat, (quality: number) => string> = {
  // AVIF is written through libvips' HEIF saver.
  avif: (q) => `[Q=${q},compression=av1,effort=6,subsample-mode=on]`,
  webp: (q) => `[Q=${q},effort=6,smart-subsample]`,
  jpeg: (q) => `[Q=${q},optimize-coding,strip,interlace]`,
}

/**
 * Resize to `width` and encode, writing to `out`. The ladder is indexed by
 * width because that is what `srcset`'s `w` descriptor means, so height is left
 * effectively unbounded — `vips thumbnail` otherwise reads a single size as a
 * bounding box and a portrait photograph comes out narrower than asked for.
 * `--size down` never upscales, so a small original keeps its own dimensions.
 */
export async function encodeDerivative(
  source: string,
  out: string,
  format: DerivativeFormat,
  width: number,
  quality: number,
): Promise<void> {
  await vips([
    'thumbnail',
    source,
    `${out}${saveOptions[format](quality)}`,
    String(width),
    '--height',
    '100000',
    '--size',
    'down',
    // Photographs are sRGB on the storefront; strip whatever the camera set.
    '--intent',
    'perceptual',
  ])
}

/**
 * Which of the ladder's formats this libvips build can actually write. Probed
 * by encoding a one-pixel image rather than by reading the class listing: this
 * build advertises the HEIF saver but has no AV1 encoder behind it, and the
 * only honest test is an encode.
 */
export async function supportedFormats(): Promise<Set<DerivativeFormat>> {
  const supported = new Set<DerivativeFormat>()
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'butterloom-probe-'))
  try {
    const probeFile = path.join(dir, 'probe.png')
    await vips(['black', probeFile, '8', '8'])
    for (const format of ['avif', 'webp', 'jpeg'] as const) {
      const out = path.join(dir, `probe.${fileExtensions[format]}`)
      try {
        await encodeDerivative(probeFile, out, format, 8, 50)
        const { size } = await fs.stat(out)
        if (size > 0) supported.add(format)
      } catch {
        // Format unavailable in this build; the ladder skips it.
      }
    }
  } catch {
    return supported
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
  return supported
}
