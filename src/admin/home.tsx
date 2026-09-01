import { count, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client.js'
import { orders, productImages, products, siteImageSlots, siteImages } from '../db/schema.js'
import { countPending } from '../images/queue.js'
import { AdminLayout } from '../views/layout.js'

export const adminHome = new Hono()

/**
 * /admin was a 404: every link into the back office pointed at
 * /admin/products, and anyone who typed the bare path was told the shop had no
 * such page. This is the index — what there is to edit, how much of it there
 * is, and where it is. New sections are added here as they are built, so the
 * list stays the answer to "what can I change?".
 */
adminHome.get('/', (c) => {
  const [productCount] = db.select({ n: count() }).from(products).all()
  const [imageCount] = db.select({ n: count() }).from(productImages).all()
  const [filledSlots] = db.select({ n: count() }).from(siteImages).all()
  const [activeOrders] = db
    .select({ n: count() })
    .from(orders)
    .where(inArray(orders.fulfilmentState, ['placed', 'packed', 'handed_over']))
    .all()
  const [placedCount] = db
    .select({ n: count() })
    .from(orders)
    .where(eq(orders.fulfilmentState, 'placed'))
    .all()
  const queued = countPending()

  return c.html(
    <AdminLayout title="Butterloom admin" section="home">
      <ul class="cards">
        <li>
          <h2>
            <a href="/admin/orders">Orders</a>
          </h2>
          <p class="muted">
            {activeOrders?.n ?? 0} active · {placedCount?.n ?? 0} awaiting packing
          </p>
          <p>Process placed orders through packing and courier handover to delivery or return.</p>
        </li>
        <li>
          <h2>
            <a href="/admin/products">Products</a>
          </h2>
          <p class="muted">
            {productCount?.n ?? 0} in the catalogue · {imageCount?.n ?? 0} photographs
            {queued > 0 ? ` · ${queued} encoding` : ''}
          </p>
          <p>Title, price, stock inventory, description and photographs. Add a batch of them in one form.</p>
        </li>
        <li>
          <h2>
            <a href="/admin/site-images">Site images</a>
          </h2>
          <p class="muted">
            {filledSlots?.n ?? 0} of {siteImageSlots.length} slots filled
          </p>
          <p>Editorial photography that belongs to the site rather than to a product.</p>
        </li>
      </ul>
    </AdminLayout>,
  )
})

