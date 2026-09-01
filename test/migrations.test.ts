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

/**
 * Pinned by name, not taken as the last entry in the journal. It was the last
 * entry when this file was written, and the test below quietly stopped
 * exercising the rebuild the moment a later migration was added — it still
 * passed, against a migration that does not touch the table at all.
 */
const site = '0002_site_images'

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

/**
 * 0004 adds categories and variants. Two things in it are worth holding shut.
 *
 * The first is a correction: drizzle-kit emitted the products.category_id
 * foreign key without the ON DELETE the schema declares, which would make
 * deleting a category a constraint error instead of the unshelving it is
 * documented to be. The clause is added by hand in the .sql, and a regenerated
 * migration would silently drop it again.
 *
 * The second is that ADD COLUMN has to leave the products already in the table
 * alone. A catalogue that is live when this runs must come out the other side
 * with every product still in it, simply belonging to no category yet.
 */
const categoriesAndVariants = '0005_categories_and_variants'

test('deleting a category unshelves its products rather than refusing', () => {
  const sqlite = freshDb()
  migrateTo(sqlite)
  sqlite.exec(`
    INSERT INTO categories (id, slug, name) VALUES (1, 'sarees', 'Sarees');
    INSERT INTO products (id, slug, title, price_paisa, category_id)
      VALUES (1, 'a', 'A', 100, 1), (2, 'b', 'B', 200, 1);
  `)

  // Without ON DELETE set null this raises FOREIGN KEY constraint failed, and
  // an operator can never delete a shelf that has ever held anything.
  sqlite.exec('DELETE FROM categories WHERE id = 1')

  const rows = sqlite
    .prepare('SELECT id, category_id FROM products ORDER BY id')
    .all() as { id: number; category_id: number | null }[]
  assert.deepEqual(
    rows,
    [
      { id: 1, category_id: null },
      { id: 2, category_id: null },
    ],
    'deleting a shelf must unshelve what stood on it, not delete it',
  )
})

test('products that predate the category column survive it', () => {
  const sqlite = freshDb()
  migrateTo(sqlite, categoriesAndVariants)
  sqlite.exec(`INSERT INTO products (id, slug, title, price_paisa) VALUES (1, 'tee', 'Tee', 250000)`)

  applyMigration(sqlite, categoriesAndVariants)

  const rows = sqlite
    .prepare('SELECT id, slug, price_paisa, category_id FROM products')
    .all() as { id: number; slug: string; price_paisa: number; category_id: number | null }[]
  assert.deepEqual(rows, [{ id: 1, slug: 'tee', price_paisa: 250000, category_id: null }])
})

test('deleting a product takes its variants and their options with it', () => {
  const sqlite = freshDb()
  migrateTo(sqlite)
  sqlite.exec(`
    INSERT INTO products (id, slug, title, price_paisa) VALUES (1, 'a', 'A', 100);
    INSERT INTO product_variants (id, product_id, label) VALUES (1, 1, 'Indigo / M');
    INSERT INTO variant_options (variant_id, name, name_slug, value, value_slug)
      VALUES (1, 'Colour', 'colour', 'Indigo', 'indigo'), (1, 'Size', 'size', 'M', 'm');
  `)

  sqlite.exec('DELETE FROM products WHERE id = 1')

  // The options cascade through the variant, which is two hops — the thing that
  // silently does not happen when foreign_keys is left off.
  const variants = sqlite.prepare('SELECT count(*) AS n FROM product_variants').get() as { n: number }
  const options = sqlite.prepare('SELECT count(*) AS n FROM variant_options').get() as { n: number }
  assert.equal(variants.n, 0)
  assert.equal(options.n, 0, 'an option row orphaned here would be invisible and unreachable')
})

test('a product cannot carry the same variant twice, but two products can', () => {
  const sqlite = freshDb()
  migrateTo(sqlite)
  sqlite.exec(`
    INSERT INTO products (id, slug, title, price_paisa) VALUES (1, 'a', 'A', 100), (2, 'b', 'B', 100);
    INSERT INTO product_variants (product_id, label) VALUES (1, 'Indigo / M');
  `)

  assert.throws(
    () => sqlite.exec(`INSERT INTO product_variants (product_id, label) VALUES (1, 'Indigo / M')`),
    /UNIQUE constraint failed/,
    'the same configuration entered twice is one variant, not two',
  )
  // Every product has its own medium; the index is scoped to the product.
  sqlite.exec(`INSERT INTO product_variants (product_id, label) VALUES (2, 'Indigo / M')`)
})

test('a variant holds one value per axis', () => {
  const sqlite = freshDb()
  migrateTo(sqlite)
  sqlite.exec(`
    INSERT INTO products (id, slug, title, price_paisa) VALUES (1, 'a', 'A', 100);
    INSERT INTO product_variants (id, product_id, label) VALUES (1, 1, 'Indigo / M');
    INSERT INTO variant_options (variant_id, name, name_slug, value, value_slug)
      VALUES (1, 'Colour', 'colour', 'Indigo', 'indigo');
  `)

  assert.throws(
    () =>
      sqlite.exec(`INSERT INTO variant_options (variant_id, name, name_slug, value, value_slug)
        VALUES (1, 'Colour', 'colour', 'Ecru', 'ecru')`),
    /UNIQUE constraint failed/,
    'a variant is not both indigo and ecru',
  )
  // A second axis on the same variant is the normal case and must still fit.
  sqlite.exec(`INSERT INTO variant_options (variant_id, name, name_slug, value, value_slug)
    VALUES (1, 'Size', 'size', 'M', 'm')`)
})

/**
 * 0006 retires product_stock into product_variants and repoints the cart at it.
 *
 * This is the migration shape the whole file exists for, twice over: it rebuilds
 * cart_items to change a foreign key, and it moves rows between two tables that
 * mean the same thing. Both failures are silent from the application afterwards
 * — the cart page still renders, just emptier than the customer left it, or
 * against stock figures that came out of nowhere.
 */
const cartHoldsAVariant = '0006_cart_holds_a_variant'
const stockTable = '0004_daffy_stryfe'

function seedStockAndCart(sqlite: Database.Database): void {
  sqlite.exec(`
    INSERT INTO products (id, slug, title, price_paisa) VALUES (1, 'a', 'Saree', 100), (2, 'b', 'Kurta', 200);
    INSERT INTO product_stock (id, product_id, variant_label, quantity)
      VALUES (10, 1, 'Indigo / M', 3), (11, 1, '', 5), (12, 2, 'Ecru / L', 0);
    INSERT INTO sessions (id, token) VALUES (1, 'tok');
    INSERT INTO cart_items (id, session_id, product_id, stock_id, quantity)
      VALUES (100, 1, 1, 10, 2), (101, 1, 1, 11, 1);
  `)
}

test('every stock row becomes a variant, keeping its count', () => {
  const sqlite = freshDb()
  migrateTo(sqlite, cartHoldsAVariant)
  seedStockAndCart(sqlite)

  applyMigration(sqlite, cartHoldsAVariant)

  const rows = sqlite
    .prepare('SELECT id, product_id, label, stock_qty FROM product_variants ORDER BY id')
    .all() as { id: number; product_id: number; label: string; stock_qty: number }[]
  assert.deepEqual(rows, [
    { id: 10, product_id: 1, label: 'Indigo / M', stock_qty: 3 },
    // product_stock spelled "comes one way" as an empty label; the column here
    // is what a customer is shown, so it takes the word the admin uses.
    { id: 11, product_id: 1, label: 'Standard', stock_qty: 5 },
    { id: 12, product_id: 2, label: 'Ecru / L', stock_qty: 0 },
  ])
  const left = sqlite
    .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='product_stock'")
    .get() as { n: number }
  assert.equal(left.n, 0, 'two tables for one fact is one of them being wrong')
})

test('a live cart survives being repointed at the variant table', () => {
  const sqlite = freshDb()
  migrateTo(sqlite, cartHoldsAVariant)
  seedStockAndCart(sqlite)

  applyMigration(sqlite, cartHoldsAVariant)

  const lines = sqlite
    .prepare(
      'SELECT ci.id, ci.quantity, pv.label FROM cart_items ci JOIN product_variants pv ON pv.id = ci.variant_id ORDER BY ci.id',
    )
    .all() as { id: number; quantity: number; label: string }[]
  assert.deepEqual(lines, [
    { id: 100, quantity: 2, label: 'Indigo / M' },
    { id: 101, quantity: 1, label: 'Standard' },
  ])
})

test('the rebuilt cart still refuses a variant that does not exist', () => {
  const sqlite = freshDb()
  migrateTo(sqlite)
  sqlite.exec(`
    INSERT INTO products (id, slug, title, price_paisa) VALUES (1, 'a', 'A', 100);
    INSERT INTO sessions (id, token) VALUES (1, 'tok');
    INSERT INTO product_variants (id, product_id, label) VALUES (5, 1, 'Indigo / M');
  `)

  // A rebuild that loses a foreign key loses it silently: the page still works
  // and the rows are still wrong.
  assert.throws(
    () =>
      sqlite.exec(
        'INSERT INTO cart_items (session_id, product_id, variant_id, quantity) VALUES (1, 1, 9999, 1)',
      ),
    /FOREIGN KEY constraint failed/,
  )

  sqlite.exec('INSERT INTO cart_items (session_id, product_id, variant_id, quantity) VALUES (1, 1, 5, 1)')
  sqlite.exec('DELETE FROM product_variants WHERE id = 5')
  const left = sqlite.prepare('SELECT count(*) AS n FROM cart_items').get() as { n: number }
  assert.equal(left.n, 0, 'deleting a variant must take the cart lines holding it')
})

test('one session cannot hold the same variant on two lines', () => {
  const sqlite = freshDb()
  migrateTo(sqlite)
  sqlite.exec(`
    INSERT INTO products (id, slug, title, price_paisa) VALUES (1, 'a', 'A', 100);
    INSERT INTO sessions (id, token) VALUES (1, 'tok');
    INSERT INTO product_variants (id, product_id, label) VALUES (5, 1, 'Indigo / M');
    INSERT INTO cart_items (session_id, product_id, variant_id, quantity) VALUES (1, 1, 5, 1);
  `)
  // The unique index has to survive the rebuild, or adding the same variant
  // twice quietly makes a second line instead of raising the quantity.
  assert.throws(
    () =>
      sqlite.exec(
        'INSERT INTO cart_items (session_id, product_id, variant_id, quantity) VALUES (1, 1, 5, 1)',
      ),
    /UNIQUE constraint failed/,
  )
})

test('a product whose stock row is already labelled Standard does not collide', () => {
  const sqlite = freshDb()
  migrateTo(sqlite, cartHoldsAVariant)
  sqlite.exec(`
    INSERT INTO products (id, slug, title, price_paisa) VALUES (1, 'a', 'A', 100);
    INSERT INTO product_stock (id, product_id, variant_label, quantity)
      VALUES (20, 1, '', 2), (21, 1, 'Standard', 4);
  `)

  // Both want the name "Standard", and product_variants_label_idx would take
  // the whole migration down rather than just this row.
  applyMigration(sqlite, cartHoldsAVariant)

  const labels = (
    sqlite.prepare('SELECT label FROM product_variants ORDER BY id').all() as { label: string }[]
  ).map((r) => r.label)
  assert.equal(labels.length, 2)
  assert.equal(new Set(labels).size, 2, 'both rows must survive under distinct labels')
  assert.ok(labels.includes('Standard'))
})
