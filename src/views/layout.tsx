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
          {/*
            Classed rather than styled as a bare `header`, which is what the
            sheet used to do. A bare element selector for the page chrome
            matches every <header> anywhere on the page — including the one
            inside an order receipt, which it laid out as a flex row and
            printed the shop name, the order number and the date on one line.
            The chrome gets a name; the element stays available to components.
          */}
          <header class="chrome">
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
  .chrome { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 22px;
    padding: 12px 20px; border-bottom: 1px solid var(--hairline); }
  .chrome a { text-decoration: none; color: inherit; }
  .chrome .wm { font-weight: 600; }
  .chrome nav { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; }
  .chrome nav a { padding-bottom: 2px; border-bottom: 2px solid transparent; color: var(--secondary); }
  .chrome nav a:hover { color: inherit; }
  /* The current section, named for assistive tech and shown to everyone else.
     Colour alone would not carry it. */
  .chrome nav a[aria-current="page"] { color: inherit; font-weight: 600;
    border-bottom-color: currentColor; }
  .chrome nav a.out { margin-left: auto; }
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
  /* One row for the search boxes on the products and orders lists, so both
     read the same and neither wraps its label onto its own line on a laptop. */
  .search-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 16px 0 0; }
  .search-bar input[type=search] { flex: 1 1 16rem; max-width: 24rem; }

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
  .order-group { margin-bottom: 32px; }
  .order-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .order-actions form { margin: 0; display: inline-block; max-width: none; width: auto; }

  /*
    The status filter, as tabs above whichever board is open. Distinct from
    .tabs above it — that one switches board, this one narrows it — so it is
    pills on the paper rather than a second underlined row, which would read as
    two rows of the same control.
  */
  .status-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 20px; }
  .status-tab { display: inline-flex; align-items: center; gap: 7px; min-height: 40px;
    padding: 6px 14px; border: 1px solid var(--hairline); border-radius: 999px;
    text-decoration: none; color: var(--secondary); font-size: 14px; }
  .status-tab:hover { color: inherit; border-color: var(--dot); }
  /*
    --ink on --paper rather than the --strip pair, because --strip is only a
    shade off --paper in the dark scheme: the selected pill came out almost
    the same colour as the page and stopped reading as selected at all. This
    inverts the body colours, so it is a solid block in both schemes.
  */
  .status-tab.active { color: var(--paper); background: var(--ink);
    border-color: var(--ink); font-weight: 600; }
  .status-tab-n { font-size: 12px; font-variant-numeric: tabular-nums;
    padding: 1px 7px; border-radius: 999px; background: var(--hairline); color: var(--ink); }
  /* Outlined in the pill's own text colour, which is legible whichever way
     round the inversion went. */
  .status-tab.active .status-tab-n { background: transparent; color: inherit;
    box-shadow: inset 0 0 0 1px currentColor; }

  /*
    Active orders as paper receipts.

    An operator works this board against a stack of real printed receipts, so
    the card reads in the same order as the paper — who, what, how much, total
    under a rule at the foot. Monospace and a column of right-aligned amounts
    are what make the two checkable against each other at a glance.

    Deliberately low fidelity: the outline and the formatting only. The torn
    top and bottom are two dashed borders, not a zigzag gradient; there is no
    paper texture, no shadow and no curl. It should read as a receipt across
    the room and as an admin panel when you look at it.
  */
  /*
    Capped at 21rem and packed from the left rather than stretched to 1fr: a
    receipt that grows to half a laptop screen stops reading as a receipt, and
    a group holding one order would otherwise print a 500px-wide slip. The min
    keeps it inside a 360px phone.
  */
  .receipts { display: grid; gap: 16px; align-items: start; justify-content: start;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 21rem)); }
  .receipt { position: relative; padding: 16px 16px 14px; background: var(--shot);
    border: 1px solid var(--hairline);
    /* The tear. Heavier and dashed on the two cut edges, hairline on the sides
       the roll was never cut along. */
    border-top: 2px dashed var(--dot); border-bottom: 2px dashed var(--dot);
    font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-variant-numeric: tabular-nums; }
  .receipt p { margin: 0; }
  .receipt-head { text-align: center; padding-bottom: 10px;
    border-bottom: 1px dashed var(--hairline); }
  .receipt-shop { font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--secondary); }
  .receipt-no { font-size: 17px; font-weight: 600; letter-spacing: 0.04em; margin-top: 2px; }
  .receipt-when { font-size: 11.5px; color: var(--secondary); }
  /* Room for the pen, which is absolutely positioned into this corner. */
  .receipt-head { padding-right: 26px; padding-left: 26px; }
  .receipt-status { display: flex; align-items: center; justify-content: space-between;
    gap: 8px; padding: 9px 0; border-bottom: 1px dashed var(--hairline); }
  .receipt-k { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--secondary); }
  .receipt-who { padding: 9px 0; border-bottom: 1px dashed var(--hairline);
    overflow-wrap: anywhere; }
  .receipt-name { font-weight: 600; }
  .receipt-addr, .receipt-note { color: var(--secondary); white-space: pre-wrap; }
  .receipt-note { margin-top: 4px; }
  .receipt-lines { list-style: none; margin: 0; padding: 9px 0; }
  /* The quantity, the thing, and the money — the money in its own column so a
     stack of receipts totals down the right-hand edge. */
  .receipt-lines li { display: grid; grid-template-columns: 2.2rem 1fr auto; gap: 0 6px;
    padding: 2px 0; }
  .receipt-qty { color: var(--secondary); }
  .receipt-what { overflow-wrap: anywhere; }
  .receipt-variant { color: var(--secondary); }
  .receipt-amt { text-align: right; white-space: nowrap; }
  .receipt-total { display: flex; justify-content: space-between; gap: 8px;
    padding-top: 9px; border-top: 1px dashed var(--hairline); font-weight: 600; }
  .receipt-pay { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--secondary); margin-top: 2px; }

  /* The pen. One target per receipt instead of a row of buttons under each. */
  .receipt-pen { position: absolute; top: 8px; right: 8px; z-index: 2;
    display: inline-flex; align-items: center; justify-content: center;
    width: 38px; height: 38px; min-height: 38px; padding: 0;
    border: 1px solid transparent; border-radius: 999px;
    background: transparent; color: var(--secondary); cursor: pointer; }
  .receipt-pen:hover { color: var(--ink); border-color: var(--hairline); background: var(--paper); }

  /*
    The dialog is a panel, not a receipt. It is rendered inside the <article
    class="receipt"> it belongs to, so without this it inherits the receipt's
    monospace and the whole thing reads as a terminal window.
  */
  .order-dialog { font: 15px/1.5 system-ui, sans-serif; }
  .order-dialog h3 { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--secondary); margin: 0 0 6px; }
  .order-dialog section { margin: 18px 0 0; padding-top: 14px;
    border-top: 1px solid var(--hairline); }
  .order-dialog section p { margin: 0 0 3px; }
  .dialog-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .dialog-top > div { min-width: 0; }
  .dialog-top p { margin: 0; }
  .dialog-title { display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
    margin: 0 0 2px; font-size: 1.2rem; }
  .dialog-dismiss { margin: 0; display: block; max-width: none; width: auto; flex: 0 0 auto; }
  .dialog-name { font-weight: 600; }
  .dialog-addr { white-space: pre-wrap; }
  .dialog-total { text-align: right; font-weight: 600; margin-top: 8px; }
  /*
    [open] is load-bearing, not tidiness. A closed dialog is hidden by
    display:none in the UA sheet, so an unqualified .order-dialog rule setting
    display:flex outranks it — and then every dialog on the page renders
    inline, always open, every order's details spilled down the board.
  */
  .order-dialog[open] { display: flex; flex-direction: column; }
  .chip { display: inline-block; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 4px; }
  .chip.placed { background: #e8a83833; color: #d97706; }
  .chip.packed { background: #3b82f633; color: #2563eb; }
  .chip.handed_over { background: #8b5cf633; color: #7c3aed; }
  .chip.delivered { background: #22c55e33; color: #16a34a; }
  .chip.returned { background: #ef444433; color: #dc2626; }
  .chip.cancelled { background: #6b728033; color: #4b5563; }
  /* Not a fulfilment state — a product that is off the storefront. Outlined
     rather than filled, so it reads as a note on the row it sits in rather
     than competing with the order chips above. */
  .chip.off-storefront { margin-left: 8px; border: 1px solid var(--dot); color: var(--secondary);
    font-weight: 500; white-space: nowrap; }
  dialog { border: 1px solid var(--hairline); border-radius: 8px; padding: 20px; max-width: 36rem; width: 90%; background: var(--paper); color: var(--ink); }
  dialog::backdrop { background: rgba(0, 0, 0, 0.5); }
  /* No longer floated — see .dialog-top, which lays it out beside the title
     instead of taking a blank line above it. */
  .dialog-close { display: inline-flex; align-items: center; justify-content: center;
    width: 40px; height: 40px; min-height: 40px; padding: 0; font-size: 22px;
    border: none; background: none; cursor: pointer; color: var(--secondary); }
  .dialog-close:hover { color: var(--ink); }
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

  /*
    Taking a product off the storefront, at the foot of its editor. Its own
    form outside the Save Changes one above (forms do not nest, and this is not
    a thing to do as a side effect of fixing a typo), so it needs its own
    separation rather than inheriting the footer's.
  */
  .storefront-state { display: flex; flex-wrap: wrap; align-items: center;
    justify-content: space-between; gap: 12px 16px; max-width: none; width: 100%;
    margin: 22px 0 0; padding-top: 16px; border-top: 1px solid var(--hairline); }
  .storefront-state > div { flex: 1 1 16rem; min-width: 0; }
  .storefront-state-copy { margin: 2px 0 0; font-size: 13px; color: var(--secondary); }
  /* The button sizes to its label here rather than spanning the measure the
     way .btn does inside the editor's single-column form. */
  .storefront-state .btn { width: auto; flex: 0 0 auto; }

  .admin-detail-footer { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center;
    gap: 12px; margin-top: 8px; padding-top: 14px; border-top: 1px solid var(--hairline); }
  .admin-detail-footer a { color: var(--ink); text-decoration: underline; text-decoration-thickness: 1px;
    text-underline-offset: 3px; }

  @media (max-width: 640px) {
    main { padding: 16px 14px; }
    .chrome { padding: 12px 14px; }
    .row { grid-template-columns: 1fr; }
    .row .span { grid-column: auto; }
  }

  /*
    The admin chrome on a phone.

    Six destinations at a 44px touch target do not fit across 360px, so
    flex-wrap was stacking them three rows deep — over 130px of navigation
    above every page, on the device ADR-0003 says this panel is actually used
    on. Worse, .out's \`margin-left: auto\` only pushes Storefront to the right
    on a line it shares with something, so once wrapped it landed under
    Overview looking like a fourth section rather than the way out.

    So on a phone the bar becomes one scrolling row: the wordmark on its own
    line, the sections in a strip under it that swipes horizontally. One row of
    chrome, every destination still reachable, and no menu button to build —
    a scroll strip needs no script, no ARIA and no open/closed state to get
    wrong, which is the whole reason to prefer it to a hamburger here.
  */
  @media (max-width: 640px) {
    .chrome { display: block; padding: 10px 0 0; }
    .chrome .wm { display: block; padding: 0 14px 8px; }
    .chrome nav {
      flex-wrap: nowrap;
      gap: 0 18px;
      overflow-x: auto;
      /* Momentum on iOS, and no rubber-banding of the page behind it. */
      -webkit-overflow-scrolling: touch;
      overscroll-behavior-x: contain;
      /* The strip runs to both edges, so the first and last items can be
         scrolled fully clear of the screen edge rather than sitting under it. */
      padding: 0 14px;
      /* Room for the current-section underline, which is otherwise clipped by
         the scroll container. */
      padding-bottom: 2px;
      scrollbar-width: none;
    }
    .chrome nav::-webkit-scrollbar { display: none; }
    .chrome nav a {
      /* Without this a long label wraps to two lines inside the strip and
         every item grows to match it. */
      white-space: nowrap;
      flex: 0 0 auto;
    }
    /* Undone: in a scroll container this would push Storefront a screen-width
       away from the item before it, leaving the strip apparently empty. */
    .chrome nav a.out { margin-left: 0; }
    /* The badge is the one thing on the strip that must not be swiped past
       unseen, so it keeps its own contrast rather than the hairline it has on
       a desktop where it sits still. */
    .chrome nav .badge { background: var(--strip); color: var(--strip-ink); }
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
  .chrome nav a { display: inline-flex; align-items: center; min-height: 44px; }
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
