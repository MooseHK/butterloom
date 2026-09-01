import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from './client.js'

const migrationsFolder = path.join(fileURLToPath(new URL('../../', import.meta.url)), 'drizzle')

export function runMigrations(): void {
  if (!fs.existsSync(migrationsFolder)) {
    throw new Error(`No migrations at ${migrationsFolder}. Run: npm run db:generate`)
  }
  migrate(db, { migrationsFolder })
}
