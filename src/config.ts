import path from 'node:path'

const root = process.cwd()

/**
 * The derivative ladder is open decision #5 in docs/open-decisions.md — widths,
 * formats and quality are not settled. These are working defaults, kept in one
 * place so measuring against a real photograph changes only this list.
 */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.BUTTERLOOM_DB ?? path.join(root, 'var', 'butterloom.db'),
  /**
   * Local object-storage stand-in. ADR-0007 puts derivatives in object storage
   * behind a CDN; nothing is provisioned yet, so the filesystem driver writes
   * the same content-addressed keys a bucket would hold.
   */
  mediaDir: process.env.BUTTERLOOM_MEDIA_DIR ?? path.join(root, 'var', 'media'),
  /** Public base for derivative URLs. Becomes the CDN hostname once one exists. */
  mediaBaseUrl: process.env.BUTTERLOOM_MEDIA_BASE_URL ?? '/media',
  /** ADR-0007: the encoder is a subprocess, not a language binding. */
  vipsBin: process.env.BUTTERLOOM_VIPS_BIN ?? 'vips',
  /** libvips ships header reading as its own binary. */
  vipsHeaderBin: process.env.BUTTERLOOM_VIPSHEADER_BIN ?? 'vipsheader',
  maxUploadBytes: Number(process.env.BUTTERLOOM_MAX_UPLOAD_BYTES ?? 20 * 1024 * 1024),
} as const
