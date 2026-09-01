import { raw } from 'hono/html'
import type { PropsWithChildren } from 'hono/jsx'
import { brandMarkUrl } from '../media.js'

/**
 * The storefront shell. ADR-0007: no client framework, and the stylesheet is
 * inline because a second round trip from Dhaka costs more than these bytes —
 * the whole point of serving this HTML from the edge is that it arrives in one.
 *
 * The visual system is docs/design/mobile-wireframes: paper and ink lifted off
 * the logo, one weight of serif, tracked system-ui caps for labels. Nothing on
 * these pages is interactive beyond a link, a GET form, a <details> and a CSS
 * scroll-snap row, so there is no script here at all.
 *
 * Chrome the spec draws but this shell deliberately omits — a menu, a cart link
 * and count, footer policy links — has nowhere to go yet. It arrives with the
 * routes it points at, not before.
 */
export function StorefrontLayout(
  props: PropsWithChildren<{ title: string; description?: string; canonicalPath: string }>,
) {
  return (
    <>
      {/*
        Without this the browser renders in quirks mode — `document.compatMode`
        comes back `BackCompat` — and a hand-written sheet is the last thing that
        should be laid out under 1990s rules.
      */}
      {raw('<!doctype html>')}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{props.title}</title>
          {props.description ? <meta name="description" content={props.description} /> : null}
          <link rel="canonical" href={props.canonicalPath} />
          {/*
            <style> is a raw-text element: the browser does not decode character
            references inside it. Rendering the sheet as a JSX child would escape
            the quotes in "Times New Roman" and the > in a child selector, and
            the CSS parser drops those declarations whole — which is what was
            happening to `body { font: … }`. The sheet is a static constant in
            this file with no interpolation, so writing it verbatim is safe.
            test/views.test.ts holds this shut.
          */}
          <style dangerouslySetInnerHTML={{ __html: css }} />
        </head>
        <body>
          {/*
            A constant, not a per-visitor message: that is what keeps it out of
            the cache rules, since everyone is served the same strip. One run,
            not two: daily dispatch is what ADR-0003 and ADR-0004 actually
            commit us to, and it fits on one line at 360px. How you pay is said
            on the product page, at the point where it is a decision.
          */}
          <div class="promo">Dispatched daily</div>
          <header class="site">
            <a class="wm" href="/">
              <i class="dot" />
              <b>Butterloom</b>
              <i class="dot" />
            </a>
          </header>
          {props.children}
          <footer class="site">
            {/* The lockup already reads BUTTERLOOM and WOVEN IN COMFORT; saying
                either again in type underneath is just saying it twice. */}
            <Seal alt="" />
            <p class="muted">Delivered across Bangladesh</p>
          </footer>
        </body>
      </html>
    </>
  )
}

/**
 * The logo lockup in a paper-coloured circle. The PNG is flattened onto the
 * paper colour, so the circle keeps that ground even in dark mode — otherwise
 * the square corners of the file would glow on the dark ground. width/height
 * are the file's own 460 × 460; ADR-0007 wants no layout shift while it loads.
 */
export function Seal(props: { alt: string }) {
  return (
    <div class="seal">
      <img src={brandMarkUrl} width={460} height={460} alt={props.alt} />
    </div>
  )
}

const css = `
  :root {
    color-scheme: light dark;
    /* Lifted off the logo file, not chosen: docs/design/mobile-wireframes. */
    --paper: #f2eee6;
    --gridline: #eee9e1;
    --ink: #33383a;
    --secondary: #62635c;
    /* Not the logo's own #83827b: that is 3.33:1 on paper and fails the 4.5:1
       floor for small text. This is the same colour walked down to 4.62:1. */
    --tertiary: #6c6b64;
    --hairline: #e2ddd1;
    /* Dots and rules only — 1.9:1, never text. */
    --dot: #a3a194;
    /* The ground a photograph sits on before its bytes arrive. */
    --shot: #eae5db;
    /* The promo strip is ink-on-paper reversed, so it needs its own two tokens. */
    --strip: #33383a;
    --strip-ink: #eee9e1;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      /* The same palette turned over: warm dark ground, paper-coloured ink. */
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
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink);
    font: 400 15.5px/1.7 ui-serif, Georgia, "Times New Roman", serif;
    -webkit-font-smoothing: antialiased; }
  a { color: inherit; text-decoration: none; }
  a:hover { color: var(--secondary); }
  /* The reset above is for cards and the wordmark, which are obviously
     clickable. A link inside a sentence is not, and a colour change alone is no
     cue at all when the link inherits the paragraph's colour. */
  main p a { color: var(--ink); text-decoration: underline;
    text-decoration-thickness: 1px; text-underline-offset: 3px; }
  .dot { width: 3px; height: 3px; border-radius: 50%; background: var(--dot); flex: none; }

  /* min-height, not height: at 360px the two runs still fit on one line, but a
     longer strip or a larger text setting must be allowed to grow rather than
     spill out of a fixed 34px band. */
  .promo { display: flex; flex-wrap: wrap; align-items: center;
    justify-content: center; gap: 9px; min-height: 34px; padding: 6px 16px;
    text-align: center; background: var(--strip); color: var(--strip-ink);
    font: 400 9.5px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.17em; text-transform: uppercase; }
  header.site { display: flex; align-items: center; justify-content: center;
    height: 58px; padding: 0 14px; border-bottom: 1px solid var(--hairline); }
  .wm { display: flex; align-items: center; gap: 9px; min-height: 44px; }
  .wm b { font: 400 14px/1 ui-serif, Georgia, "Times New Roman", serif;
    letter-spacing: 0.26em; text-transform: uppercase; }

  main { max-width: 40rem; margin: 0 auto; padding: 0 20px; }
  h1 { margin: 0; font: 400 28px/1.15 ui-serif, Georgia, "Times New Roman", serif; }
  .head { display: flex; flex-direction: column; gap: 7px;
    padding: 22px 0 18px; border-bottom: 1px solid var(--hairline); }
  /* The listing's count of pieces, and the only span the head ever holds. */
  .head span { font: 400 10.5px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.15em; text-transform: uppercase; color: var(--tertiary); }
  /* The crumb row is a 44px tap target, which is most of the room the head's own
     top padding was giving the h1; a shelf would otherwise open with 80px of
     nothing above its name. */
  .head:has(.crumbs) { padding-top: 6px; }
  .crumbs { display: flex; align-items: center; gap: 9px; min-height: 44px;
    font: 400 10px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.15em; text-transform: uppercase; color: var(--tertiary); }
  .crumbs a { display: flex; align-items: center; min-height: 44px; }
  .crumbs b { font-weight: 400; color: var(--secondary); }
  .muted { margin: 0; color: var(--tertiary); font-size: 13px; }

  /* Grid paper, 28px pitch: the only gradient on these two pages. */
  .brand, footer.site { display: flex; flex-direction: column; align-items: center;
    text-align: center; background-color: var(--paper);
    background-image:
      repeating-linear-gradient(0deg, var(--gridline) 0 1px, transparent 1px 28px),
      repeating-linear-gradient(90deg, var(--gridline) 0 1px, transparent 1px 28px); }
  .brand { gap: 16px; margin: 0 -20px; padding: 34px 20px; }
  footer.site { gap: 11px; margin-top: 44px; padding: 36px 20px 32px;
    border-top: 1px solid var(--hairline); }
  .seal { width: 132px; height: 132px; border-radius: 50%; overflow: hidden;
    /* Literal paper, not the token: the file's own ground, in both themes. */
    background: #f2eee6; }
  .seal img { display: block; width: 100%; height: auto; }

  /* The editorial slot (site_images.slot = 'hero'). Bleeds to main's own edge,
     which is the viewport on a phone; 4/5 is the design's 390 x 488 kept as a
     ratio so it scales rather than snapping at one width. */
  .hero { position: relative; margin: 0 -20px;
    aspect-ratio: 4 / 5; max-height: 70vh; overflow: hidden; background: var(--shot); }
  .hero .hero-shot { position: absolute; inset: 0; }
  .hero .hero-shot img { width: 100%; height: 100%; object-fit: cover; }

  .grid { display: grid; gap: 30px 14px; padding: 22px 0 0; margin: 0; list-style: none;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  .card a { display: flex; flex-direction: column; gap: 10px; }
  .card img { display: block; width: 100%; height: auto;
    border-radius: 2px; background: var(--shot); }
  .card h2 { margin: 0; font: 400 15px/1.35 ui-serif, Georgia, "Times New Roman", serif; }
  .card p { margin: 0; color: var(--secondary); font-size: 14px; }
  /* Secondary, not tertiary: this label sits on --shot rather than paper, where
     the quiet ink would fall back under 4.5:1. */
  .placeholder { display: grid; place-items: center; aspect-ratio: 4 / 5;
    border-radius: 2px; background: var(--shot); color: var(--secondary);
    font: 400 9px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.16em; text-transform: uppercase; }

  /* A scroll-snap row rather than a stack: stacking every photograph pushed the
     price a screen and a half down the phone, which is what the design pass
     found. Native scrolling, so it costs nothing in script. */
  .gallery { display: flex; gap: 10px; margin: 20px -20px 0; padding: 0 20px; list-style: none;
    overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory; }
  .gallery li { flex: 0 0 85%; scroll-snap-align: center; }
  .gallery img { display: block; width: 100%; height: auto;
    border-radius: 2px; background: var(--shot); }
  /* Scoped: inside a card the placeholder is a flex item and must not shift. */
  main > .placeholder { margin-top: 20px; }

  .detail { display: flex; flex-direction: column; gap: 16px; padding: 24px 0 0; }
  .price { margin: 0; padding-bottom: 16px; border-bottom: 1px solid var(--hairline);
    font: 400 18px/1 ui-serif, Georgia, "Times New Roman", serif; letter-spacing: 0.01em; }
  .description { margin: 0; white-space: pre-wrap;
    color: var(--secondary); font-size: 15px; line-height: 1.75; }

  /* Front page: a titled block with a rule under the heading, per Main.dc.html. */
  .sec { display: flex; flex-direction: column; gap: 18px; padding: 34px 0 0; }
  /* Direct child: a card heading inside the rail is also an h2 in here, and a
     descendant selector would put a section rule under every product title. */
  .sec > h2 { margin: 0; padding-bottom: 12px; border-bottom: 1px solid var(--hairline);
    font: 400 19px/1.2 ui-serif, Georgia, "Times New Roman", serif; }

  /* The wireframe photographs its category tiles; a category has no image column
     and nothing plans to give it one, so a tile is type on the ground a
     photograph would have sat on rather than an empty square implying one is
     coming. */
  .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px; margin: 0; padding: 0; list-style: none; }
  .tiles a { display: flex; flex-direction: column; justify-content: flex-end; gap: 5px;
    min-height: 84px; padding: 14px; border-radius: 2px; background: var(--shot); }
  .tiles b { font: 400 11px/1.3 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.16em; text-transform: uppercase; }
  /* Secondary again, for the same reason as .placeholder: --shot is not paper. */
  .tiles span { color: var(--secondary); font-size: 12.5px; }

  /* Six cards a thumb pushes sideways, rather than three rows of the grid
     between the hero and the way through to the shop. */
  .rail { display: flex; gap: 14px; margin: 0 -20px; padding: 0 20px; list-style: none;
    overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory; }
  .rail .card { flex: 0 0 168px; scroll-snap-align: start; }

  .btn { display: flex; align-items: center; justify-content: center;
    min-height: 52px; padding: 0 22px; border: 1px solid var(--ink); border-radius: 2px;
    background: var(--ink); color: var(--paper); cursor: pointer;
    font: 600 11.5px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.16em; text-transform: uppercase; }
  /* The link reset above hands hover --secondary, which on ink is unreadable. */
  .btn:hover { color: var(--paper); background: var(--secondary); border-color: var(--secondary); }

  /* Filter and sort are a GET form in a <details>. ADR-0007 rules out client
     script, and collapsing a panel on a phone is the one thing HTML will do
     without any — every applied combination is then its own cacheable URL. */
  .controls { margin: 0 -20px; border-bottom: 1px solid var(--hairline); }
  /* Padding rather than a flex box with a height: any display other than the
     default list-item drops the disclosure triangle in Chrome and Safari, and
     that triangle is the only thing saying the row opens. */
  .controls summary { padding: 21px 20px; cursor: pointer;
    font: 400 10.5px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.16em; text-transform: uppercase; }
  .controls form { display: flex; flex-direction: column; gap: 22px; padding: 2px 20px 24px; }
  .controls fieldset { margin: 0; padding: 0; border: 0; min-width: 0; }
  .controls legend, .controls .label { display: block; padding: 0 0 8px;
    font: 400 10px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.15em; text-transform: uppercase; color: var(--tertiary); }
  .controls .values { display: flex; flex-wrap: wrap; gap: 2px 20px; }
  .controls .values label { display: flex; align-items: center; gap: 9px;
    min-height: 44px; font-size: 15px; }
  .controls input { width: 18px; height: 18px; margin: 0; accent-color: var(--ink); }
  .controls select { width: 100%; min-height: 44px; padding: 0 12px;
    border: 1px solid var(--hairline); border-radius: 2px;
    background: var(--paper); color: var(--ink); font: inherit; font-size: 15px; }

  /* One chip per applied value, each a link that drops it, plus the escape
     hatch. 44px where the wireframe drew 34: these are the smallest targets on
     the page and a thumb needs the height more than the row needs to be tight. */
  .chips { display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    margin: 0; padding: 16px 0 0; list-style: none; }
  .chip { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 12px;
    border: 1px solid var(--hairline); border-radius: 2px; color: var(--secondary);
    font: 400 10.5px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.12em; text-transform: uppercase; }
  .chips .chip, .clear { min-height: 44px; }
  .clear { display: flex; align-items: center; padding: 0 2px; color: var(--tertiary);
    font: 400 10.5px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.12em; text-transform: uppercase;
    text-decoration: underline; text-underline-offset: 4px; }

  /* Previous and next, not an infinite scroll: each page has to be its own URL
     to be cached and crawled at all (ADR-0007). The columns are fixed so the
     count stays centred when one of the two links is missing. */
  .pages { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px;
    margin-top: 34px; padding-top: 18px; border-top: 1px solid var(--hairline);
    font: 400 10.5px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.15em; text-transform: uppercase; }
  .pages a { display: flex; align-items: center; min-height: 44px; }
  .pages .prev { grid-column: 1; }
  .pages span { grid-column: 2; color: var(--tertiary); }
  .pages .next { grid-column: 3; justify-content: flex-end; }

  /* What the piece comes in — not a picker, and never a count. */
  .axes { display: flex; flex-direction: column; gap: 14px; margin: 0; }
  .axes dt { font: 400 10px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.15em; text-transform: uppercase; color: var(--tertiary); }
  .axes dd { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 0; }
`
