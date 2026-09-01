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
 * these pages is interactive beyond a link and a CSS scroll-snap row, so there
 * is no script here at all.
 *
 * Chrome the spec draws but this shell deliberately omits — a menu, a cart link
 * and count, category tiles, footer policy links — has nowhere to go yet. It
 * arrives with the routes it points at, not before.
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
            the cache rules, since everyone is served the same strip. Kept short
            because it has to sit on one line at 360px, and daily dispatch is
            what ADR-0003 and ADR-0004 actually commit us to.
          */}
          <div class="promo">
            Cash on delivery
            <i class="dot" />
            Dispatched daily
          </div>
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
  .head { padding: 22px 0 18px; border-bottom: 1px solid var(--hairline); }
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
`
