import { count, inArray } from 'drizzle-orm'
import { raw } from 'hono/html'
import type { PropsWithChildren } from 'hono/jsx'
import { db } from '../db/client.js'
import { orders } from '../db/schema.js'

export function countActiveOrders(): number {
  try {
    const [row] = db
      .select({ n: count() })
      .from(orders)
      .where(inArray(orders.fulfilmentState, ['placed', 'packed', 'handed_over']))
      .all()
    return row?.n ?? 0
  } catch {
    return 0
  }
}

/**
 * ADR-0007: no client framework. The only stylesheet is inline because the
 * admin is behind auth and never edge-cached, so a second round trip for CSS
 * buys nothing.
 */
export function AdminLayout(
  props: PropsWithChildren<{
    title: string
    /** Which nav item is the current one. Omitted on pages that are in neither. */
    section?: 'home' | 'products' | 'site-images' | 'orders'
    /** A way back up one level, for pages reached from a list. */
    back?: { href: string; label: string }
  }>,
) {
  const activeOrders = countActiveOrders()

  return (
    <>
      {/* Same reason as the storefront: without it the page is in quirks mode. */}
      {raw('<!doctype html>')}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{props.title} — Butterloom admin</title>
          {/*
            This sheet has no quote, < or > in it, so rendering it as a child is
            harmless today — but it is the same trap the storefront fell into, so
            it is written the same way rather than left armed for whoever adds a
            quoted font name here.
          */}
          <style dangerouslySetInnerHTML={{ __html: css }} />
        </head>
        <body>
          {/*
            Every section reachable from every page. Before this the only link
            in the chrome was the wordmark, so moving between products and the
            site images — or back from the storefront — meant the browser's own
            back button, which is not navigation, it is the absence of it.
          */}
          <header>
            <a class="wm" href="/admin">
              Butterloom admin
            </a>
            <nav>
              <a href="/admin" aria-current={props.section === 'home' ? 'page' : undefined}>
                Overview
              </a>
              <a
                href="/admin/orders"
                aria-current={props.section === 'orders' ? 'page' : undefined}
              >
                Orders{activeOrders > 0 ? <span class="badge">{activeOrders}</span> : null}
              </a>
              <a
                href="/admin/products"
                aria-current={props.section === 'products' ? 'page' : undefined}
              >
                Products
              </a>
              <a
                href="/admin/site-images"
                aria-current={props.section === 'site-images' ? 'page' : undefined}
              >
                Site images
              </a>
              {/*
                A new tab on purpose: the storefront carries no admin chrome, so
                following it in this one is a one-way trip out of the admin.
              */}
              <a class="out" href="/" target="_blank" rel="noopener">
                Storefront ↗
              </a>
            </nav>
          </header>
          <main>
            {props.back ? (
              <a class="back" href={props.back.href}>
                ← {props.back.label}
              </a>
            ) : null}
            <h1>{props.title}</h1>
            {props.children}
          </main>
        </body>
      </html>
    </>
  )
}

const css = `
  :root { color-scheme: light dark; }
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; min-width: 0; }
  header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 22px;
    padding: 12px 20px; border-bottom: 1px solid #8883; }
  header a { text-decoration: none; color: inherit; }
  header .wm { font-weight: 600; }
  header nav { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; }
  header nav a { padding-bottom: 2px; border-bottom: 2px solid transparent; color: #8889; }
  header nav a:hover { color: inherit; }
  /* The current section, named for assistive tech and shown to everyone else.
     Colour alone would not carry it. */
  header nav a[aria-current="page"] { color: inherit; font-weight: 600;
    border-bottom-color: currentColor; }
  header nav a.out { margin-left: auto; }
  .back { display: inline-block; margin: 4px 0 -4px; font-size: 13px; color: #8889;
    text-decoration: none; }
  .back:hover { color: inherit; }
  main { max-width: 60rem; margin: 0 auto; padding: 20px; min-width: 0; }
  h1 { font-size: 1.4rem; }
  form { display: grid; gap: 12px; max-width: 34rem; margin: 16px 0 28px; width: 100%; }
  label { display: grid; gap: 4px; font-weight: 600; min-width: 0; }
  input, textarea, select, button { font: inherit; padding: 8px; border: 1px solid #8886; border-radius: 6px; background: transparent; color: inherit; max-width: 100%; box-sizing: border-box; }
  input, textarea, select { width: 100%; min-width: 0; }
  button { cursor: pointer; font-weight: 600; }
  button.secondary { border-color: #8886; }
  button.danger { border-color: #d33; color: #d33; }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 100%; margin: 16px 0; }
  table { border-collapse: collapse; width: 100%; min-width: 480px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #8883; }
  .gallery { display: flex; flex-wrap: wrap; gap: 14px; list-style: none; padding: 0; }
  .gallery img { width: 180px; max-width: 100%; height: auto; border-radius: 6px; display: block; }
  /* The bulk form is a table of rows, not a single column of fields, so it
     takes the whole measure rather than the 34rem a one-product form wants. */
  form.bulk { max-width: none; width: 100%; }
  .row { display: grid; grid-template-columns: 2fr 1fr; gap: 10px 14px;
    padding: 12px; border: 1px solid #8883; border-radius: 8px; min-width: 0; }
  .row + .row { margin-top: 10px; }
  .row .span { grid-column: 1 / -1; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 0; }
  .queue { display: grid; gap: 8px; margin: 0 0 20px; padding: 0; list-style: none; }
  .queue li { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; word-break: break-word; }
  .queue form { margin: 0; }
  .cards { display: grid; gap: 14px; padding: 0; list-style: none;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); }
  .cards li { padding: 14px 16px; border: 1px solid #8883; border-radius: 8px; }
  .cards h2 { margin: 0 0 4px; font-size: 1.1rem; }
  .cards p { margin: 0 0 6px; }
  .fail { color: #d33; }
  .notice { padding: 10px 12px; border-radius: 6px; border: 1px solid #8886; overflow-wrap: anywhere; word-break: break-word; }
  .notice.error { border-color: #d33; }
  .muted { color: #8889; }
  .badge { font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 999px; background: #8883; vertical-align: middle; margin-left: 6px; }
  .tabs { display: flex; gap: 12px; border-bottom: 1px solid #8883; margin: 16px 0 24px; }
  .tab { padding: 8px 14px; text-decoration: none; color: #8889; border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .tab:hover { color: inherit; }
  .tab.active, .tab[aria-current="true"] { color: inherit; font-weight: 600; border-bottom-color: currentColor; }
  .order-card { border: 1px solid #8883; border-radius: 8px; padding: 16px; margin: 14px 0; }
  .order-header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 8px; }
  .order-meta { font-size: 13px; color: #8889; margin: 0 0 10px; }
  .order-details { margin: 12px 0; font-size: 14px; }
  .order-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .order-actions form { margin: 0; display: inline-block; max-width: none; width: auto; }
  .chip { display: inline-block; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 4px; }
  .chip.placed { background: #e8a83833; color: #d97706; }
  .chip.packed { background: #3b82f633; color: #2563eb; }
  .chip.handed_over { background: #8b5cf633; color: #7c3aed; }
  .chip.delivered { background: #22c55e33; color: #16a34a; }
  .chip.returned { background: #ef444433; color: #dc2626; }
  .chip.cancelled { background: #6b728033; color: #4b5563; }
  dialog { border: 1px solid #8886; border-radius: 8px; padding: 20px; max-width: 36rem; width: 90%; background: #fff; color: #111; }
  @media (prefers-color-scheme: dark) { dialog { background: #1c1c1c; color: #eee; } }
  dialog::backdrop { background: rgba(0, 0, 0, 0.5); }
  .dialog-close { float: right; margin-top: -6px; font-size: 20px; border: none; background: none; cursor: pointer; color: inherit; }
  .timeline { list-style: none; padding: 0; margin: 12px 0; }
  .timeline li { padding: 6px 0; border-bottom: 1px solid #8882; font-size: 13px; }
  .inline-form { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 6px 0; }
  .inline-form input { width: auto; }

  @media (max-width: 640px) {
    main { padding: 16px 14px; }
    header { padding: 12px 14px; }
    .row { grid-template-columns: 1fr; }
    .row .span { grid-column: auto; }
  }
`

