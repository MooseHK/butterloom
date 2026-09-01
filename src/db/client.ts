import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { config } from '../config.js'
import * as schema from './schema.js'

fs.mkdirSync(path.dirname(config.databaseUrl), { recursive: true })

export const sqlite = new Database(config.databaseUrl)
// ADR-0006: every connection sets a busy_timeout. Serialised writes are the
// property the last-item-in-stock case relies on.
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('busy_timeout = 5000')
sqlite.pragma('foreign_keys = ON')
sqlite.pragma('synchronous = NORMAL')

export const db = drizzle(sqlite, { schema })
export { schema }
