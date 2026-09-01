import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'

/**
 * 0002 rebuilds image_derivatives — SQLite cannot relax a NOT NULL in place, so
 * the table is copied into a new one and renamed. That is the one migration
 * shape that can silently lose rows or quietly drop a constraint, and neither
 * failure is visible from the application afterwards: the pages still render,
 * just against fewer derivatives or with nothing stopping a bad write.
 *
 * So this runs the real chain against seeded data rather than trusting the
 * generator. drizzle-kit in fact emitted an INSERT that selected site_image_id
 * out of the pre-0002 table, which has no such column; that is corrected in the
 * migration and this test is what holds it corrected.
 */
const migrationsDir = path.join(import.meta.dirname, '..', 'drizzle')

const journal = JSON.parse(
  fs.readFileSync(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
) as { entries: { tag: string }[] }

function applyMigration(sqlite: Database.Database, tag: string): void {
  const sql = fs.readFileSync(path.join(migrationsDir, `${tag}.sql`), 'utf8')
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) sqlite.exec(statement)
  }
}

function freshDb(): Database.Database {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'butterloom-migrate-'))
  const sqlite = new Database(path.join(dir, 'test.db'))
  // The same pragma the application connects with, so the cascades below are
  // actually enforced rather than silently ignored as they are by default.
  sqlite.pragma('foreign_keys = ON')
  return sqlite
}

function countDerivatives(sqlite: Database.Database): number {
  const rows = sqlite.prepare('SELECT count(*) AS n FROM image_derivatives').all() as { n: number }[]
  return rows[0]?.n ?? -1
}

/** Every migration up to but not including `stopBefore`. */
function migrateTo(sqlite: Database.Database, stopBefore?: string): void {
  for (const { tag } of journal.entries) {
    if (tag === stopBefore) return
    applyMigration(sqlite, tag)
  }
}

const site = journal.entries.at(-1)?.tag as string

function seedProductImage(sqlite: Database.Database): void {
  sqlite.exec(`
    INSERT INTO products (id, slug, title, price_paisa) VALUES (1, 'tee', 'Costa Rica Tee', 250000);
    INSERT INTO product_images (id, product_id, position, alt_text, original_filename, original_sha256, width, height)
      VALUES (1, 1, 0, 'a tee', 'a.jpg', 'deadbeef', 1200, 1500);
    INSERT INTO image_derivatives (id, image_id, format, width, height, byte_size, sha256, storage_key)
      VALUES (1, 1, 'jpeg', 320, 400, 1000, 'aa', 'ab/cd/aa.jpg'),
             (2, 1, 'webp', 320, 400, 900, 'bb', 'ab/cd/bb.webp');
  `)
}

test('the rebuild in 0002 carries every existing derivative across', () => {
  const sqlite = freshDb()
  migrateTo(sqlite, site)
  seedProductImage(sqlite)

  applyMigration(sqlite, site)

  const rows = sqlite
    .prepare('SELECT id, image_id, site_image_id, format, storage_key FROM image_derivatives ORDER BY id')
    .all() as { id: number; image_id: number | null; site_image_id: number | null; format: string; storage_key: string }[]

  assert.equal(rows.length, 2, 'both derivatives must survive the table rebuild')
  assert.deepEqual(
    rows.map((r) => [r.id, r.image_id, r.site_image_id, r.format, r.storage_key]),
    [
      [1, 1, null, 'jpeg', 'ab/cd/aa.jpg'],
      [2, 1, null, 'webp', 'ab/cd/bb.webp'],
    ],
    'ids, owners and storage keys must all come across unchanged',
  )
})

test('the one-owner check survives the rename and is enforced', () => {
  const sqlite = freshDb()
  migrateTo(sqlite)
  sqlite.exec(`INSERT INTO site_images (id, slot, original_filename, original_sha256, width, height)
    VALUES (1, 'hero', 'h.jpg', 'cafe', 2000, 1200);`)

  // A CHECK written against the temporary __new_ table name is only useful if
  // SQLite rewrote it during ALTER TABLE ... RENAME. If it did not, both of
  // these would be accepted.
  assert.throws(
    () =>
      sqlite.exec(`INSERT INTO image_derivatives (format, width, height, byte_size, sha256, storage_key)
        VALUES ('jpeg', 320, 400, 10, 'cc', 'k')`),
    /CHECK constraint failed/,
    'a derivative owned by nothing is unreachable and must be rejected',
  )
  assert.throws(
    () =>
      sqlite.exec(`INSERT INTO image_derivatives (image_id, site_image_id, format, width, height, byte_size, sha256, storage_key)
        VALUES (1, 1, 'jpeg', 320, 400, 10, 'cc', 'k')`),
    /CHECK constraint failed/,
    'a derivative owned twice would be cascade-deleted twice and must be rejected',
  )
})

test('deleting a site image takes its ladder with it', () => {
  const sqlite = freshDb()
  migrateTo(sqlite)
  sqlite.exec(`
    INSERT INTO site_images (id, slot, original_filename, original_sha256, width, height)
      VALUES (1, 'hero', 'h.jpg', 'cafe', 2000, 1200);
    INSERT INTO image_derivatives (image_id, site_image_id, format, width, height, byte_size, sha256, storage_key)
      VALUES (NULL, 1, 'jpeg', 320, 400, 10, 'cc', 'ab/cd/cc.jpg');
  `)
  sqlite.exec('DELETE FROM site_images WHERE id = 1')
  assert.equal(countDerivatives(sqlite), 0, 'replacing a slot must not leave its old ladder behind')
})

test('a slot holds at most one image', () => {
  const sqlite = freshDb()
  migrateTo(sqlite)
  const insert = `INSERT INTO site_images (slot, original_filename, original_sha256, width, height)
    VALUES ('hero', 'h.jpg', 'cafe', 2000, 1200)`
  sqlite.exec(insert)
  assert.throws(() => sqlite.exec(insert), /UNIQUE constraint failed/)
})

test('two product ladders do not collide, and nulls do not collide either', () => {
  const sqlite = freshDb()
  migrateTo(sqlite)
  sqlite.exec(`
    INSERT INTO products (id, slug, title, price_paisa) VALUES (1, 'a', 'A', 1), (2, 'b', 'B', 1);
    INSERT INTO product_images (id, product_id, original_filename, original_sha256, width, height)
      VALUES (1, 1, 'a.jpg', 'aa', 10, 10), (2, 2, 'b.jpg', 'bb', 10, 10);
    INSERT INTO site_images (id, slot, original_filename, original_sha256, width, height)
      VALUES (1, 'hero', 'h.jpg', 'cafe', 10, 10);
  `)
  // The same rung for two different owners: three rows, no unique violation.
  // Both site rows carry a null image_id, which the product index must tolerate.
  sqlite.exec(`INSERT INTO image_derivatives (image_id, site_image_id, format, width, height, byte_size, sha256, storage_key)
    VALUES (1, NULL, 'jpeg', 320, 400, 10, 'x', 'k1'),
           (2, NULL, 'jpeg', 320, 400, 10, 'x', 'k1'),
           (NULL, 1, 'jpeg', 320, 400, 10, 'x', 'k1')`)
  assert.equal(countDerivatives(sqlite), 3)

  // But the same rung twice for one owner is still refused.
  assert.throws(
    () =>
      sqlite.exec(`INSERT INTO image_derivatives (image_id, format, width, height, byte_size, sha256, storage_key)
        VALUES (1, 'jpeg', 320, 400, 10, 'y', 'k2')`),
    /UNIQUE constraint failed/,
  )
})
