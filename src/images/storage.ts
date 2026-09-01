import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'

/**
 * Content-addressed blob store. ADR-0007 puts these bytes in object storage
 * behind a CDN; until a bucket exists the filesystem driver writes the same
 * keys, so swapping in an S3-compatible driver is this interface only.
 */
export interface BlobStore {
  put(key: string, bytes: Buffer): Promise<void>
  read(key: string): Promise<Buffer>
  exists(key: string): Promise<boolean>
  delete(key: string): Promise<void>
}

function resolve(key: string): string {
  const full = path.resolve(config.mediaDir, key)
  const base = path.resolve(config.mediaDir)
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error(`storage key escapes media dir: ${key}`)
  }
  return full
}

export const fileStore: BlobStore = {
  async put(key, bytes) {
    const full = resolve(key)
    await fs.mkdir(path.dirname(full), { recursive: true })
    // Derivatives are immutable and keyed by content hash: an existing key
    // already holds these exact bytes, so writing again is pointless.
    const tmp = `${full}.${process.pid}.tmp`
    await fs.writeFile(tmp, bytes)
    await fs.rename(tmp, full)
  },
  async read(key) {
    return fs.readFile(resolve(key))
  },
  async exists(key) {
    try {
      await fs.access(resolve(key))
      return true
    } catch {
      return false
    }
  },
  async delete(key) {
    await fs.rm(resolve(key), { force: true })
  },
}

/** Fan a hash out over two levels of directory, as a bucket layout would. */
export function shardedKey(sha256: string, ext: string): string {
  return `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.${ext}`
}
