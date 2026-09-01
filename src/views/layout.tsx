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
    section?: 'home' | 'products' | 'categories' | 'site-images' | 'orders'
    /** A way back up one level, for pages reached from a list. */
    back?: { href: string; label: string }
    /** Hide the default top h1 (useful when the page provides its own editable title) */
    hideTitleHeading?: boolean
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
                href="/admin/categories"
                aria-current={props.section === 'categories' ? 'page' : undefined}
              >
                Categories
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
            {!props.hideTitleHeading ? <h1>{props.title}</h1> : null}
            {props.children}
          </main>
        </body>
      </html>
    </>
  )
}

const css = `
  :root {
    color-scheme: light dark;
    --paper: #f2eee6;
    --gridline: #eee9e1;
    --ink: #33383a;
    --secondary: #62635c;
    --tertiary: #6c6b64;
    --hairline: #e2ddd1;
    --dot: #a3a194;
    --shot: #eae5db;
    --strip: #33383a;
    --strip-ink: #eee9e1;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #201e1b;
      --gridline: #292724;
      --ink: #f2eee6;
      --secondary: #b8b2a6;
      --tertiary: #918b80;
      --hairline: #35312d;
      --dot: #83827b;
      --shot: #2c2926;
      --strip: #2b2825;
      --strip-ink: #cdc6b9;
    }
  }
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; min-width: 0; background: var(--paper); color: var(--ink); }
  header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 22px;
    padding: 12px 20px; border-bottom: 1px solid var(--hairline); }
  header a { text-decoration: none; color: inherit; }
  header .wm { font-weight: 600; }
  header nav { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; }
  header nav a { padding-bottom: 2px; border-bottom: 2px solid transparent; color: var(--secondary); }
  header nav a:hover { color: inherit; }
  /* The current section, named for assistive tech and shown to everyone else.
     Colour alone would not carry it. */
  header nav a[aria-current="page"] { color: inherit; font-weight: 600;
    border-bottom-color: currentColor; }
  header nav a.out { margin-left: auto; }
  .back { display: inline-block; margin: 4px 0 -4px; font-size: 13px; color: var(--secondary);
    text-decoration: none; }
  .back:hover { color: inherit; }
  main { max-width: 60rem; margin: 0 auto; padding: 20px; min-width: 0; }
  h1 { font-size: 1.4rem; }
  form { display: grid; gap: 12px; max-width: 34rem; margin: 16px 0 28px; width: 100%; }
  label { display: grid; gap: 4px; font-weight: 600; min-width: 0; }
  input, textarea, select, button { font: inherit; padding: 8px; border: 1px solid var(--hairline); border-radius: 6px; background: transparent; color: inherit; max-width: 100%; box-sizing: border-box; }
  input, textarea, select { width: 100%; min-width: 0; }
  button { cursor: pointer; font-weight: 600; }
  button.secondary { border-color: var(--hairline); }
  button.danger { border-color: #d33; color: #d33; }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 100%; margin: 16px 0; }
  table { border-collapse: collapse; width: 100%; min-width: 480px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--hairline); }
  .gallery { display: flex; flex-wrap: wrap; gap: 14px; list-style: none; padding: 0; }
  .gallery img { width: 180px; max-width: 100%; height: auto; border-radius: 6px; display: block; }
  /* The bulk form is a table of rows, not a single column of fields, so it
     takes the whole measure rather than the 34rem a one-product form wants. */
  form.bulk { max-width: none; width: 100%; }
  .row { display: grid; grid-template-columns: 2fr 1fr; gap: 10px 14px;
    padding: 12px; border: 1px solid var(--hairline); border-radius: 8px; min-width: 0; }
  .row + .row { margin-top: 10px; }
  .row .span { grid-column: 1 / -1; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 0; }
  .queue { display: grid; gap: 8px; margin: 0 0 20px; padding: 0; list-style: none; }
  .queue li { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; word-break: break-word; }
  .queue form { margin: 0; }
  .cards { display: grid; gap: 14px; padding: 0; list-style: none;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); }
  .cards li { padding: 14px 16px; border: 1px solid var(--hairline); border-radius: 8px; }
  .cards h2 { margin: 0 0 4px; font-size: 1.1rem; }
  .cards p { margin: 0 0 6px; }
  .fail { color: #d33; }
  .notice { padding: 10px 12px; border-radius: 6px; border: 1px solid var(--hairline); overflow-wrap: anywhere; word-break: break-word; background: var(--shot); }
  .notice.error { border-color: #d33; color: #d33; }
  .muted { color: var(--secondary); font-size: 13px; }
  .badge { font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 999px; background: var(--hairline); vertical-align: middle; margin-left: 6px; }
  .tabs { display: flex; gap: 12px; border-bottom: 1px solid var(--hairline); margin: 16px 0 24px; }
  .tab { padding: 8px 14px; text-decoration: none; color: var(--secondary); border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .tab:hover { color: inherit; }
  .tab.active, .tab[aria-current="true"] { color: inherit; font-weight: 600; border-bottom-color: currentColor; }
  .order-card { border: 1px solid var(--hairline); border-radius: 8px; padding: 16px; margin: 14px 0; }
  .order-header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 8px; }
  .order-meta { font-size: 13px; color: var(--secondary); margin: 0 0 10px; }
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
  dialog { border: 1px solid var(--hairline); border-radius: 8px; padding: 20px; max-width: 36rem; width: 90%; background: var(--paper); color: var(--ink); }
  dialog::backdrop { background: rgba(0, 0, 0, 0.5); }
  .dialog-close { float: right; margin-top: -6px; font-size: 20px; border: none; background: none; cursor: pointer; color: inherit; }
  .timeline { list-style: none; padding: 0; margin: 12px 0; }
  .timeline li { padding: 6px 0; border-bottom: 1px solid var(--hairline); font-size: 13px; }
  .inline-form { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 6px 0; }
  .inline-form input { width: auto; }

  /* Product Detail Editor (aligned with storefront product UI) */
  .product-editor { max-width: 40rem; margin: 0 auto; padding: 10px 0 40px; }
  .admin-gallery { display: flex; gap: 10px; margin: 16px 0; padding: 0; list-style: none;
    overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory; }
  .admin-gallery .gallery-item { flex: 0 0 85%; max-width: 380px; scroll-snap-align: center; position: relative; }
  @media (min-width: 600px) {
    .admin-gallery .gallery-item { flex: 0 0 300px; }
  }
  .admin-gallery img { display: block; width: 100%; height: auto; border-radius: 2px; background: var(--shot); }
  .photo-container { position: relative; width: 100%; border-radius: 2px; overflow: hidden; background: var(--shot); }
  .photo-del-form { position: absolute; top: 8px; right: 8px; margin: 0; z-index: 5; }
  .photo-del-btn { width: 28px; height: 28px; border-radius: 50%; background: rgba(0, 0, 0, 0.65);
    color: #fff; border: 1px solid rgba(255, 255, 255, 0.4); display: flex; align-items: center;
    justify-content: center; cursor: pointer; padding: 0; font-size: 18px; line-height: 1; transition: all 0.15s ease; }
  .photo-del-btn:hover { background: #d33; border-color: #d33; transform: scale(1.1); }
  .gallery-add-item { flex: 0 0 160px; scroll-snap-align: center; display: flex; }
  .gallery-add-card { display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; width: 100%; aspect-ratio: 4 / 5; border: 2px dashed var(--hairline); border-radius: 2px;
    background: var(--shot); color: var(--secondary); cursor: pointer; font: 500 12px/1 system-ui, sans-serif;
    letter-spacing: 0.08em; text-transform: uppercase; transition: all 0.15s ease; box-sizing: border-box; }
  .gallery-add-card:hover { border-color: var(--ink); color: var(--ink); }
  .empty-gallery .empty-add-item { flex: 1 1 100%; max-width: 100%; }
  .empty-add-card { min-height: 220px; }
  .photo-meta { font-size: 12px; margin: 4px 0 0; }
  .photo-pending { display: flex; flex-direction: column; align-items: center; justify-content: center;
    aspect-ratio: 4 / 5; padding: 14px; text-align: center; gap: 8px; }
  .visually-hidden-file { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); border: 0; }

  .admin-detail { display: flex; flex-direction: column; gap: 16px; padding: 16px 0 0; }
  .admin-detail-form { display: flex; flex-direction: column; gap: 16px; max-width: none; margin: 0; width: 100%; }
  .field-label { font: 500 11.5px/1 system-ui, sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: var(--secondary); margin-bottom: 4px; display: block; }
  
  .edit-title-input { font: 400 28px/1.2 ui-serif, Georgia, "Times New Roman", serif;
    color: var(--ink); background: transparent; border: 1px solid transparent;
    border-bottom: 1px dashed var(--hairline); border-radius: 0; padding: 4px 0; width: 100%; transition: all 0.15s ease; }
  .edit-title-input:hover, .edit-title-input:focus { border-color: var(--hairline);
    border-bottom: 1px solid var(--ink); outline: none; background: var(--shot); border-radius: 2px; padding: 4px 8px; }
  
  .edit-category-row select { padding: 6px 10px; border: 1px solid var(--hairline); border-radius: 2px;
    background: var(--paper); color: var(--ink); font-size: 14px; }

  .edit-price-row { display: flex; align-items: baseline; gap: 6px; padding-bottom: 16px;
    border-bottom: 1px solid var(--hairline); font: 400 18px/1 ui-serif, Georgia, "Times New Roman", serif; }
  .price-symbol { font: 400 20px/1 ui-serif, Georgia, "Times New Roman", serif; color: var(--ink); }
  .edit-price-input { font: 400 18px/1 ui-serif, Georgia, "Times New Roman", serif;
    color: var(--ink); background: transparent; border: 1px solid transparent;
    border-bottom: 1px dashed var(--hairline); border-radius: 0; padding: 2px 6px; width: 140px; transition: all 0.15s ease; }
  .edit-price-input:hover, .edit-price-input:focus { border-color: var(--hairline);
    border-bottom: 1px solid var(--ink); outline: none; background: var(--shot); border-radius: 2px; }
  .price-suffix { font: 400 12px/1 system-ui, sans-serif; color: var(--secondary); }

  .edit-desc-input { font: 400 15px/1.75 ui-serif, Georgia, "Times New Roman", serif;
    color: var(--secondary); background: transparent; border: 1px dashed var(--hairline);
    border-radius: 2px; padding: 8px 10px; width: 100%; min-height: 90px; resize: vertical;
    box-sizing: border-box; transition: all 0.15s ease; }
  .edit-desc-input:hover, .edit-desc-input:focus { border-color: var(--ink); color: var(--ink);
    background: var(--shot); outline: none; }

  .variant-group { display: flex; flex-direction: column; gap: 8px; margin: 4px 0 12px; }
  .variant-header-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
  .variant-label { font: 500 11.5px/1 system-ui, sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: var(--secondary); }
  .variant-options { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .variant-chip { display: inline-flex; align-items: center; justify-content: center; padding: 8px 14px;
    border: 1px solid var(--hairline); border-radius: 2px; font-size: 13.5px; user-select: none;
    transition: border-color 0.15s, background 0.15s; }
  .admin-variant-chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px;
    border: 1px solid var(--hairline); border-radius: 2px; background: transparent; }
  .admin-variant-chip:hover, .admin-variant-chip:focus-within { border-color: var(--ink); }
  .variant-chip-name { font: 500 13.5px/1 system-ui, sans-serif; color: var(--ink); }
  .variant-axis-input, .variant-val-input { font: 500 13px/1 system-ui, sans-serif; color: var(--ink);
    background: transparent; border: 1px solid var(--hairline); border-radius: 2px; padding: 2px 6px; width: 75px; }
  .variant-axis-input:focus, .variant-val-input:focus { outline: none; border-color: var(--ink); background: var(--shot); }
  .variant-divider { color: var(--dot); font-weight: bold; }
  .variant-qty-wrapper { display: inline-flex; align-items: center; gap: 4px; }
  .variant-qty-input { font: 500 13px/1 system-ui, sans-serif; color: var(--ink); background: transparent;
    border: 1px solid var(--hairline); border-radius: 2px; padding: 2px 6px; width: 50px; text-align: center; }
  .variant-qty-input:focus { outline: none; border-color: var(--ink); background: var(--shot); }
  .variant-qty-label { font: 400 11px/1 system-ui, sans-serif; color: var(--secondary); text-transform: uppercase; }
  .variant-del-btn { background: none; border: none; color: var(--tertiary); font-size: 16px; line-height: 1;
    cursor: pointer; padding: 0 2px; margin-left: 2px; transition: color 0.15s; }
  .variant-del-btn:hover { color: #d33; }
  
  .add-variant-btn { display: inline-flex; align-items: center; gap: 4px; padding: 8px 14px;
    border: 1px dashed var(--hairline); border-radius: 2px; background: transparent; color: var(--secondary);
    font: 500 13px/1 system-ui, sans-serif; cursor: pointer; transition: all 0.15s ease; }
  .add-variant-btn:hover { border-color: var(--ink); color: var(--ink); background: var(--shot); }
  .new-variant-chip { border-style: dashed; border-color: var(--ink); background: var(--shot); }
  .new-variant-options-inputs { display: inline-flex; align-items: center; gap: 4px; }

  .btn { display: inline-flex; align-items: center; justify-content: center; padding: 14px 24px;
    background: var(--ink); color: var(--paper); border: 1px solid var(--ink); border-radius: 2px;
    font: 500 13px/1 system-ui, -apple-system, sans-serif; letter-spacing: 0.12em; text-transform: uppercase;
    cursor: pointer; text-decoration: none; width: 100%; box-sizing: border-box; transition: opacity 0.15s ease; }
  .btn:hover { opacity: 0.88; color: var(--paper); }
  .btn.secondary { background: transparent; color: var(--ink); border-color: var(--hairline); }
  .btn.secondary:hover { border-color: var(--ink); }

  .admin-detail-footer { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center;
    gap: 12px; margin-top: 8px; padding-top: 14px; border-top: 1px solid var(--hairline); }
  .admin-detail-footer a { color: var(--ink); text-decoration: underline; text-decoration-thickness: 1px;
    text-underline-offset: 3px; }

  @media (max-width: 640px) {
    main { padding: 16px 14px; }
    header { padding: 12px 14px; }
    .row { grid-template-columns: 1fr; }
    .row .span { grid-column: auto; }
  }

  /*
    Below here is not styling, it is the panel being usable on the phone ADR-0003
    puts it in front of — an operator standing in a stockroom, not sitting at a
    desk. None of it changes how the admin looks on a desktop.

    16px is the load-bearing one. iOS Safari zooms the page in whenever a control
    under that size takes focus and does not zoom back out, so the operator is
    left panning a magnified page for the rest of the session. The rest is the
    44px target floor and a focus ring on everything that takes focus, several of
    which had none — an accessibility failure independent of screen size.
  */
  input, textarea, select, button { font-size: 16px; min-height: 44px; padding: 10px; }
  button { padding: 10px 16px; }
  header nav a { display: inline-flex; align-items: center; min-height: 44px; }
  .back { display: inline-flex; align-items: center; min-height: 44px; }
  .cards h2 a { display: inline-flex; align-items: center; min-height: 44px; }
  /* The row is 44px but the link inside it was only its own line box, so it
     takes the whole cell back. */
  td a { display: block; margin: -6px -10px; padding: 6px 10px; min-height: 32px; }
  /* currentColor rather than a fixed colour, so one rule serves both schemes. */
  a:focus-visible, button:focus-visible, input:focus-visible,
  select:focus-visible, textarea:focus-visible, summary:focus-visible {
    outline: 2px solid currentColor; outline-offset: 2px; }
  /* Inset: this one sits inside a scroll container, which clips a ring drawn
     outside the box. */
  .table-wrap a:focus-visible { outline-offset: -2px; }
  input[type=file] { padding: 6px; }
  input[type=file]::file-selector-button { min-height: 32px; margin-right: 10px;
    padding: 0 12px; border: 1px solid var(--hairline); border-radius: 5px;
    background: var(--shot); color: inherit; font: inherit; font-size: 15px; cursor: pointer; }
  /* Buttons share the width on a phone rather than sitting thumb-sized against
     the left edge; 9rem still fits a pair on one line at 360px. */
  @media (max-width: 640px) {
    .actions button, .order-actions button { flex: 1 1 9rem; }
  }
`
