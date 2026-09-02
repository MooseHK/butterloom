import { count, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client.js'
import { categories, products } from '../db/schema.js'
import { slugify } from '../lib/slug.js'
import { listCategories } from '../storefront/queries.js'
import { AdminLayout } from '../views/layout.js'
import { uniqueSlug } from './bulkForm.js'

export const adminCategories = new Hono()

/**
 * The shelves. A category is a page with a URL, an order on the front page, and
 * a name — and those are edited in three different ways, which is why this
 * screen is one form per shelf rather than a table of text.
 */

/** A shelf name is a tile caption, not a description. */
const maxNameLength = 60

adminCategories.get('/', (c) => {
  // Everything standing on the shelf, withdrawn products included: this is the
  // screen for managing the shelf, not the storefront's tile.
  const rows = listCategories({ includeHidden: true })
  const error = c.req.query('error')
  const saved = c.req.query('saved')

  return c.html(
    <AdminLayout title="Categories" section="categories">
      {error ? <p class="notice error">{error}</p> : null}
      {saved ? <p class="notice">{saved}</p> : null}

      <form method="post" action="/admin/categories">
        <label>
          Name
          <input name="name" maxlength={maxNameLength} placeholder="Sarees" required />
        </label>
        <p class="actions">
          <button type="submit">Add category</button>
        </p>
        <p class="muted">
          The URL comes from the name — Sarees becomes /c/sarees — and keeps it from then on.
        </p>
      </form>

      {rows.map(({ category, productCount }) => (
        <form class="row" method="post" action={`/admin/categories/${category.id}`}>
          <label>
            Name
            <input name="name" maxlength={maxNameLength} value={category.name} required />
          </label>
          <label>
            Position
            <input
              name="position"
              type="number"
              step="1"
              inputmode="numeric"
              value={String(category.position)}
            />
          </label>
          <p class="span muted">
            /c/{category.slug} · {productCount} {productCount === 1 ? 'product' : 'products'} ·
            renaming keeps the URL; deleting unshelves the products rather than deleting them.
          </p>
          <p class="span actions">
            <button type="submit">Save</button>
            <button type="submit" formaction={`/admin/categories/${category.id}/delete`}>
              Delete
            </button>
          </p>
        </form>
      ))}
      {rows.length === 0 ? <p class="muted">No categories yet.</p> : null}
    </AdminLayout>,
  )
})

const back = '/admin/categories'
const fail = (message: string) => `${back}?error=${encodeURIComponent(message)}`
const done = (message: string) => `${back}?saved=${encodeURIComponent(message)}`

/** The name as it will be stored, or null when there is nothing usable in it. */
function readName(form: FormData): string | null {
  const name = String(form.get('name') ?? '').trim().slice(0, maxNameLength)
  return name || null
}

adminCategories.post('/', async (c) => {
  const form = await c.req.formData().catch(() => null)
  const name = form && readName(form)
  if (!name) return c.redirect(fail('A category needs a name.'), 303)

  const taken = new Set(
    db
      .select({ slug: categories.slug })
      .from(categories)
      .all()
      .map((r) => r.slug),
  )
  // Same derivation and the same collision loop as a product slug: two shelves
  // called Sarees become sarees and sarees-2 rather than a UNIQUE error in the
  // operator's face. New shelves start at position 0 and therefore sort by name
  // until somebody gives them an order.
  db.insert(categories).values({ name, slug: uniqueSlug(slugify(name, 'category'), taken) }).run()
  return c.redirect(done(`Added ${name}.`), 303)
})

adminCategories.post('/:id', async (c) => {
  const [category] = db
    .select()
    .from(categories)
    .where(eq(categories.id, Number(c.req.param('id'))))
    .all()
  if (!category) return c.notFound()

  const form = await c.req.formData().catch(() => null)
  const name = form && readName(form)
  if (!form || !name) return c.redirect(fail('A category needs a name.'), 303)

  const position = Number(String(form.get('position') ?? '').trim() || 0)
  if (!Number.isSafeInteger(position)) {
    return c.redirect(fail('Position must be a whole number.'), 303)
  }

  // The slug is deliberately not re-derived. It is a live URL — /c/sarees is in
  // people's history and in whatever they have shared it in — and a rename is a
  // change of caption, not a change of shelf. Correcting a slug means deleting
  // the category and making it again, which is honest about what that costs.
  db.update(categories).set({ name, position }).where(eq(categories.id, category.id)).run()
  return c.redirect(done(`Saved ${name}.`), 303)
})

adminCategories.post('/:id/delete', (c) => {
  const [category] = db
    .select()
    .from(categories)
    .where(eq(categories.id, Number(c.req.param('id'))))
    .all()
  if (!category) return c.notFound()

  // products.category_id is ON DELETE set null (schema.ts): what was standing
  // on the shelf is unshelved, still at its own URL and still under All items.
  const [tally] = db
    .select({ n: count() })
    .from(products)
    .where(eq(products.categoryId, category.id))
    .all()
  db.delete(categories).where(eq(categories.id, category.id)).run()

  const unshelved = tally?.n ?? 0
  return c.redirect(
    done(
      unshelved === 0
        ? `Deleted ${category.name}.`
        : `Deleted ${category.name}. ${unshelved} ${unshelved === 1 ? 'product is' : 'products are'} now unshelved.`,
    ),
    303,
  )
})
