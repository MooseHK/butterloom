import { raw } from 'hono/html'
import type { PropsWithChildren } from 'hono/jsx'

/**
 * ADR-0007: no client framework. The only stylesheet is inline because the
 * admin is behind auth and never edge-cached, so a second round trip for CSS
 * buys nothing.
 */
export function AdminLayout(
  props: PropsWithChildren<{
    title: string
    /** Which nav item is the current one. Omitted on pages that are in neither. */
    section?: 'home' | 'products' | 'categories' | 'site-images'
    /** A way back up one level, for pages reached from a list. */
    back?: { href: string; label: string }
  }>,
) {
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
            <h1>{props.title}</h1>
            {props.children}
          </main>
        </body>
      </html>
    </>
  )
}

/*
  Written narrow first. ADR-0003 puts a single operator behind this panel, and
  that operator is as often standing in a stockroom holding a phone as sitting
  at a desk, so 360px is what the sheet states plainly and the wider layouts are
  the exceptions added back. Two widths do that: 34rem, already the measure a
  single-product form takes, and 40rem, where the wordmark and all five sections
  fit on one line again.

  It stays a dense tool at every width. Someone entering twenty products wants
  to see rows; the only things that grew are the ones a thumb has to hit.
*/
const css = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; }
  header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 22px;
    padding: 10px 14px; border-bottom: 1px solid #8883; }
  header a { text-decoration: none; color: inherit; }
  header .wm { font-weight: 600; }
  /* Five sections are about 400px of text. Wrapping them costs two 44px bands
     of chrome before the page begins, so instead they take one row that
     scrolls, bled to the viewport edge — a half-cut item reads as "there is
     more this way", where one cut at a 14px margin reads as a bug. */
  header nav { display: flex; flex: 1 0 100%; gap: 16px; margin: 0 -14px;
    padding: 0 14px; overflow-x: auto; overscroll-behavior-x: contain; }
  header nav a { display: flex; align-items: center; min-height: 44px;
    white-space: nowrap; border-bottom: 2px solid transparent; color: #8889; }
  header nav a:hover { color: inherit; }
  /* The current section, named for assistive tech and shown to everyone else.
     Colour alone would not carry it. */
  header nav a[aria-current="page"] { color: inherit; font-weight: 600;
    border-bottom-color: currentColor; }
  header nav a.out { margin-left: auto; }
  .back { display: inline-flex; align-items: center; min-height: 44px;
    margin: -6px 0 -10px; font-size: 13px; color: #8889; text-decoration: none; }
  .back:hover { color: inherit; }
  main { max-width: 60rem; margin: 0 auto; padding: 14px 14px 32px; }
  h1 { font-size: 1.4rem; }
  form { display: grid; gap: 12px; max-width: 34rem; margin: 16px 0 28px; }
  label { display: grid; gap: 4px; font-weight: 600; }
  /* 16px is not a taste call. iOS Safari zooms the page in whenever a control
     under that size takes focus, and it does not zoom back out again — the
     operator is left panning a magnified page for the rest of the session. The
     desktop keeps the same size because a second one buys nothing. */
  input, select, textarea, button { font: inherit; font-size: 16px;
    min-height: 44px; padding: 10px; border: 1px solid #8886; border-radius: 6px;
    background: transparent; color: inherit; }
  button { cursor: pointer; font-weight: 600; padding: 10px 16px; }
  /* Stepping a price a paisa at a time is not worth a 12px target, and every
     number field here already asks for the numeric keypad with inputmode. */
  input[type=number] { -webkit-appearance: textfield; appearance: textfield; }
  /* Tapping anywhere in a file input opens the picker, so the 44px above is the
     real target; this is only so the control stops looking like the one thing
     on the page the sheet forgot. */
  input[type=file] { padding: 6px; }
  input[type=file]::file-selector-button { min-height: 32px; margin-right: 10px;
    padding: 0 12px; border: 1px solid #8886; border-radius: 5px;
    background: #8881; color: inherit; font: inherit; font-size: 15px;
    cursor: pointer; }
  /* One ring for everything, in currentColor so it inverts with the scheme
     rather than needing a colour that survives both. The UA default differs per
     control and per browser and is easy to lose against the quiet nav ink,
     which is why a focused nav item also takes the full-contrast colour. */
  a:focus-visible, button:focus-visible, input:focus-visible,
  select:focus-visible, textarea:focus-visible {
    outline: 2px solid currentColor; outline-offset: 2px; }
  header nav a:focus-visible { color: inherit; }
  /* Inset: both of these sit inside a scroll container, which clips a ring
     drawn outside the box. */
  header nav a:focus-visible, td a:focus-visible { outline-offset: -2px; }
  /* Six columns do not cross a 360px screen, so the table is its own scroller.
     A wrapper element is the usual way to do that, but the tables live in
     src/admin and this sheet does not own that markup — hence display: block on
     the table itself, which costs it its role in the accessibility tree on some
     screen readers. Below 34rem that is the lesser harm; above it, it is a
     table again. Stacked cards would read better still on a phone, but they
     need a data-label on every td, which is that same markup change. */
  table { display: block; width: 100%; overflow-x: auto;
    overscroll-behavior-x: contain; border-collapse: collapse; }
  th, td { text-align: left; padding: 11px 12px; border-bottom: 1px solid #8883;
    white-space: nowrap; }
  /* The row is 44px but the link inside it was only its own 22px line box, so
     it takes the whole cell back. */
  td a { display: block; margin: -11px -12px; padding: 11px 12px; }
  /* A fixed 180px thumbnail plus its gap overflows 360px by a hair, which is
     the worst of both — one per row with half the width wasted. Flexible down
     to 150 puts two up on a phone and leaves the desktop row where it was. */
  .gallery { display: flex; flex-wrap: wrap; gap: 14px; list-style: none; padding: 0; }
  .gallery li { flex: 1 1 150px; max-width: 180px; }
  .gallery img { width: 100%; height: auto; border-radius: 6px; display: block; }
  /* The bulk form is a table of rows, not a single column of fields, so it
     takes the whole measure rather than the 34rem a one-product form wants. */
  form.bulk { max-width: none; }
  .row { display: grid; gap: 10px 14px;
    padding: 12px; border: 1px solid #8883; border-radius: 8px; }
  .row + .row { margin-top: 10px; }
  .row .span { grid-column: 1 / -1; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 0; }
  /* Sharing the width rather than sitting thumb-sized against the left edge.
     9rem is small enough that a pair still fits on one line at 360px. */
  .actions button { flex: 1 1 9rem; }
  .queue { display: grid; gap: 8px; margin: 0 0 20px; padding: 0; list-style: none; }
  .queue li { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .queue form { margin: 0; }
  .cards { display: grid; gap: 14px; padding: 0; list-style: none;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
  .cards li { padding: 14px 16px; border: 1px solid #8883; border-radius: 8px; }
  .cards h2 { margin: 0 0 4px; font-size: 1.1rem; }
  /* The heading is the only way into a section from the overview, so it is the
     heading that carries the target. */
  .cards h2 a { display: inline-flex; align-items: center; min-height: 44px; }
  .cards p { margin: 0 0 6px; }
  .fail { color: #d33; }
  .notice { padding: 10px 12px; border-radius: 6px; border: 1px solid #8886; }
  .notice.error { border-color: #d33; }
  .muted { color: #8889; }

  @media (min-width: 34rem) {
    main { padding: 20px; }
    /* Title beside price only once there is room for both: at 360px the 2fr
       column is 200px and the 1fr is 100, and a squeezed pair of fields is
       worse to type into than a stack of full-width ones. */
    .row { grid-template-columns: 2fr 1fr; }
    .actions button { flex: none; }
    /* Wide enough for the columns without a scroller, so the table goes back to
       being a table, semantics included. */
    table { display: table; }
    th, td { white-space: normal; }
  }
  @media (min-width: 40rem) {
    /* The wordmark and all five sections fit on one line again, which is the
       header this panel has always had. The nav keeps its overflow rule: a
       sixth section would scroll rather than open a second band of chrome. */
    header { padding: 10px 20px; }
    header nav { flex: 0 1 auto; margin: 0; padding: 0; }
  }
`
