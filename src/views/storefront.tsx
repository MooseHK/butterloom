import { raw } from 'hono/html'
import type { PropsWithChildren } from 'hono/jsx'
import { brandMarkUrl } from '../media.js'

/**
 * The storefront shell. ADR-0007: no client framework, and the stylesheet is
 * inline because a second round trip from Dhaka costs more than these bytes —
 * the whole point of serving this HTML from the edge is that it arrives in one.
 *
 * The visual system is docs/design/mobile-wireframes: paper and ink lifted off
 * the logo, one weight of serif, tracked system-ui caps for labels. It is a
 * quiet system on purpose — the photograph is the loudest thing on any page,
 * and everything else is a hairline, a label, or nothing at all.
 */
export function StorefrontLayout(
  props: PropsWithChildren<{
    title: string
    description?: string
    canonicalPath: string
    cartCount?: number
  }>,
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
          {/*
            viewport-fit=cover lets the page paint under the notch and the home
            indicator; the sheet then pays that back with env(safe-area-inset-*)
            padding, which is what keeps the promo strip off the camera cutout
            in landscape.
          */}
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1, viewport-fit=cover"
          />
          {/* The paper colour, so the browser chrome and the overscroll gutter
              match the page rather than flashing white above it. */}
          <meta name="theme-color" content="#f2eee6" media="(prefers-color-scheme: light)" />
          <meta name="theme-color" content="#201e1b" media="(prefers-color-scheme: dark)" />
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
          {/*
            Declarative prefetch, not script: the browser fetches a catalogue or
            product page when the visitor's finger goes down on the link, so the
            tap lands on a page that has already arrived. `moderate` is the point
            of it — an eager rule would pull every card's page over a mobile
            network the visitor is paying for. Only the two cacheable route
            shapes are listed; /cart, /checkout and /order are per-visitor and
            no-store, and prefetching them would be waste at best. Browsers
            without speculation rules ignore the block entirely.
          */}
          <script type="speculationrules" dangerouslySetInnerHTML={{ __html: speculationRules }} />
        </head>
        <body>
          {/*
            A constant, not a per-visitor message: that is what keeps it out of
            the cache rules, since everyone is served the same strip. Kept to two
            short runs because it has to sit on one line at 360px, and both are
            things ADR-0003 and ADR-0004 actually commit us to — the strip is the
            one place a first-time visitor learns they can pay at the door.
          */}
          <div class="promo">
            Cash on delivery
            <i class="dot" />
            Dispatched daily
          </div>
          <header class="site">
            <div class="header-left" />
            <a class="wm" href="/">
              <i class="dot" />
              <b>Butterloom</b>
              <i class="dot" />
            </a>
            <div class="header-right">
              <a class="cart-btn" href="/cart" aria-label="Cart">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <path d="M16 10a4 4 0 0 1-8 0"></path>
                </svg>
                {props.cartCount && props.cartCount > 0 ? (
                  <span class="cart-badge" id="cart-badge">
                    {props.cartCount}
                  </span>
                ) : (
                  <span class="cart-badge" id="cart-badge" hidden>
                    0
                  </span>
                )}
              </a>
            </div>
          </header>
          {props.children}
          <footer class="site">
            {/* The lockup already reads BUTTERLOOM and WOVEN IN COMFORT; saying
                either again in type underneath is just saying it twice. */}
            <Seal alt="" />
            <nav class="footlinks">
              <a href="/">The collection</a>
              <i class="dot" />
              <a href="/cart">Your cart</a>
            </nav>
            <p class="muted">Delivered across Bangladesh</p>
          </footer>
          {/*
            The count, and only the count, comes off a cookie the page did not
            set. /  and /p/:slug are edge-cached, so the HTML has to be byte
            identical for every visitor — rendering a per-visitor number into it
            would serve one shopper's cart to the next. Reading it here instead
            keeps the cached page constant and still lets the badge tell the
            truth after a navigation, which a server-rendered count on a cached
            page cannot. Deliberately not httpOnly: it holds a small integer and
            nothing else, and this line is the whole reason it exists.
          */}
          <script dangerouslySetInnerHTML={{ __html: cartBadgeScript }} />
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

const speculationRules = JSON.stringify({
  prefetch: [
    {
      where: { or: [{ href_matches: '/' }, { href_matches: '/p/*' }] },
      eagerness: 'moderate',
    },
  ],
})

const cartBadgeScript = `
  var m = document.cookie.match(/(?:^|; )bl_cart_count=(\\d+)/);
  var b = document.getElementById('cart-badge');
  if (b && m && +m[1] > 0) { b.textContent = m[1]; b.hidden = false; }
`

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
    /* One gutter token, so the bleeds that cancel it stay honest. */
    --gutter: 20px;
    --edge: max(20px, env(safe-area-inset-left));
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
  /* Safari on iOS inflates text when a phone turns landscape; the page is set
     in one size for a reason. */
  html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
  /* A column the height of the screen, so the footer sits on the bottom of a
     short page — a 404 or an empty cart — instead of halfway up it with paper
     below. dvh, not vh: on a phone the URL bar collapses as you scroll, and vh
     is measured against the taller of the two. */
  body { margin: 0; background: var(--paper); color: var(--ink);
    font: 400 15.5px/1.7 ui-serif, Georgia, "Times New Roman", serif;
    -webkit-font-smoothing: antialiased;
    display: flex; flex-direction: column; min-height: 100vh; min-height: 100dvh; }
  a { color: inherit; text-decoration: none; }
  a:hover { color: var(--secondary); }
  /* The reset above is for cards and the wordmark, which are obviously
     clickable. A link inside a sentence is not, and a colour change alone is no
     cue at all when the link inherits the paragraph's colour. */
  main p a { color: var(--ink); text-decoration: underline;
    text-decoration-thickness: 1px; text-underline-offset: 3px; }
  /* Removing an outline without replacing it is how a keyboard becomes unusable.
     :focus-visible, so a thumb never sees it and a Tab key always does. */
  a:focus-visible, button:focus-visible, select:focus-visible,
  input:focus-visible, textarea:focus-visible, summary:focus-visible {
    outline: 2px solid var(--ink); outline-offset: 2px; border-radius: 2px; }
  @media (prefers-reduced-motion: reduce) {
    * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important;
      scroll-behavior: auto !important; }
  }
  .dot { width: 3px; height: 3px; border-radius: 50%; background: var(--dot); flex: none; }

  /* min-height, not height: at 360px the two runs still fit on one line, but a
     longer strip or a larger text setting must be allowed to grow rather than
     spill out of a fixed 34px band. */
  /* flex: none on both bars — they are items in the body column now, and a
     flex item's min-height is the first thing shrinking gives away. */
  .promo { flex: none; display: flex; flex-wrap: wrap; align-items: center;
    justify-content: center; gap: 9px; min-height: 34px;
    padding: 6px max(16px, env(safe-area-inset-right)) 6px max(16px, env(safe-area-inset-left));
    text-align: center; background: var(--strip); color: var(--strip-ink);
    font: 400 9.5px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.17em; text-transform: uppercase; }

  /* Sticky, so the wordmark and the cart are one thumb away down a long
     catalogue rather than a scroll back to the top. The promo strip is a
     one-time message and is allowed to leave. */
  header.site { position: sticky; top: 0; z-index: 10; flex: none;
    display: flex; align-items: center; justify-content: space-between;
    height: 58px; padding: 0 max(12px, env(safe-area-inset-right)) 0 max(12px, env(safe-area-inset-left));
    background: var(--paper); border-bottom: 1px solid var(--hairline); }
  .header-left, .header-right { width: 44px; }
  .header-right { display: flex; justify-content: flex-end; }
  .cart-btn { position: relative; display: flex; align-items: center;
    justify-content: center; width: 44px; height: 44px; color: var(--ink); }
  .cart-badge { position: absolute; top: 4px; right: 1px; display: flex;
    align-items: center; justify-content: center; min-width: 16px; height: 16px;
    padding: 0 4px; border-radius: 8px; background: var(--ink); color: var(--paper);
    font: 600 10px/1 system-ui, -apple-system, sans-serif; }
  /* The UA's [hidden] rule is display:none at the lowest specificity there is,
     and a class beats it — without this line the empty badge renders a literal
     0 on every page. */
  .cart-badge[hidden] { display: none; }
  .wm { display: flex; align-items: center; gap: 9px; min-height: 44px; }
  .wm b { font: 400 14px/1 ui-serif, Georgia, "Times New Roman", serif;
    letter-spacing: 0.26em; text-transform: uppercase; }

  /* flex: 1 0 auto — takes the slack on a short page, keeps its own height on a
     long one. The auto margins still centre it, since this is a column. */
  main { flex: 1 0 auto; width: 100%; max-width: 40rem; margin: 0 auto;
    padding: 0 var(--edge) 0 var(--edge); }
  h1 { margin: 0; font: 400 28px/1.15 ui-serif, Georgia, "Times New Roman", serif;
    text-wrap: balance; }
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

  /* Grid paper, 28px pitch: the only gradient on the storefront. */
  .brand, footer.site { display: flex; flex-direction: column; align-items: center;
    text-align: center; background-color: var(--paper);
    background-image:
      repeating-linear-gradient(0deg, var(--gridline) 0 1px, transparent 1px 28px),
      repeating-linear-gradient(90deg, var(--gridline) 0 1px, transparent 1px 28px); }
  .brand { gap: 16px; margin: 0 calc(var(--edge) * -1); padding: 34px 20px; }
  footer.site { gap: 14px; margin-top: 48px;
    padding: 36px 20px calc(30px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--hairline); }
  .footlinks { display: flex; flex-wrap: wrap; align-items: center;
    justify-content: center; gap: 12px;
    font: 400 10px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.15em; text-transform: uppercase; color: var(--tertiary); }
  .footlinks a { display: inline-flex; align-items: center; min-height: 34px; }
  /* The footer mark is chrome; the one standing in for a missing hero is the
     page. Same seal at two sizes, so scrolling past both does not read as the
     same thing printed twice. */
  footer.site .seal { width: 86px; height: 86px; }
  .seal { width: 132px; height: 132px; border-radius: 50%; overflow: hidden;
    /* Literal paper, not the token: the file's own ground, in both themes. */
    background: #f2eee6; }
  .seal img { display: block; width: 100%; height: auto; }

  /* The editorial slot (site_images.slot = 'hero'). Bleeds to main's own edge,
     which is the viewport on a phone; 4/5 is the design's 390 x 488 kept as a
     ratio so it scales rather than snapping at one width. */
  .hero { position: relative; margin: 0 calc(var(--edge) * -1);
    aspect-ratio: 4 / 5; max-height: 70vh; overflow: hidden; background: var(--shot); }
  .hero .hero-shot { position: absolute; inset: 0; }
  .hero .hero-shot img { width: 100%; height: 100%; object-fit: cover; }

  .grid { display: grid; gap: 26px 14px; padding: 22px 0 0; margin: 0; list-style: none;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  .card a { display: flex; flex-direction: column; gap: 9px; }
  /* One ratio for every cover, cropped rather than letterboxed. Photographs
     arrive at whatever shape the camera held, and a grid of mixed shapes reads
     as a page that is still loading: titles land at four different heights and
     the eye has nothing to run down. The crop is the single biggest thing
     separating this grid from a calm one. */
  /* height:auto is load-bearing, not tidiness. Picture sets width/height
     attributes so nothing shifts while the bytes arrive, and those attributes
     are a definite height that aspect-ratio loses to — the crop silently does
     nothing and a tall photograph runs three screens down the page. */
  .card img { display: block; width: 100%; height: auto; aspect-ratio: 4 / 5;
    object-fit: cover; border-radius: 2px; background: var(--shot); }
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
  .gallery { display: flex; gap: 10px; margin: 18px calc(var(--edge) * -1) 0;
    padding: 0 var(--edge); list-style: none;
    overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory;
    /* The row is its own affordance — the next frame peeks in from the right.
       A scrollbar on top of that is a second, uglier one. */
    scrollbar-width: none; }
  .gallery::-webkit-scrollbar { display: none; }
  .gallery li { flex: 0 0 85%; scroll-snap-align: center; }
  /* Nothing to peek at with one photograph, so the 15% gutter is just a page
     that looks mis-measured. Take the full frame instead. */
  .gallery li:only-child { flex-basis: 100%; }
  /* One ratio across the row, for the same reason as the grid and one more:
     frames of different heights make the page grow and shrink under the thumb
     as it swipes, and everything below the gallery moves with it. */
  .gallery img { display: block; width: 100%; height: auto; aspect-ratio: 4 / 5;
    object-fit: cover; border-radius: 2px; background: var(--shot); }
  /* Native carousel markers: real dots, tappable, tracking the scroll position,
     with no script and no state to keep. :has() gates them on there being a
     second photograph — one lone dot is noise, not an indicator. A browser
     without ::scroll-marker renders nothing at all, which is exactly what the
     page showed before. */
  .gallery:has(li:nth-child(2)) { scroll-marker-group: after; }
  .gallery::scroll-marker-group { display: flex; justify-content: center;
    gap: 7px; padding-top: 14px; }
  .gallery li::scroll-marker { content: ""; width: 5px; height: 5px;
    border-radius: 50%; background: var(--hairline); }
  .gallery li::scroll-marker:target-current { background: var(--tertiary); }
  /* Scoped: inside a card the placeholder is a flex item and must not shift. */
  main > .placeholder { margin-top: 18px; }

  .detail { display: flex; flex-direction: column; gap: 16px; padding: 22px 0 0; }
  .price { margin: 0; padding-bottom: 16px; border-bottom: 1px solid var(--hairline);
    font: 400 18px/1 ui-serif, Georgia, "Times New Roman", serif; letter-spacing: 0.01em; }
  .description { margin: 0; white-space: pre-wrap; text-wrap: pretty;
    color: var(--secondary); font-size: 15px; line-height: 1.75; }

  /* One button, in the wireframe's proportions: 54px is a thumb, and 11.5px
     tracked caps is the same label voice as everything else rather than a
     second, louder one. */
  .btn { display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; min-height: 54px; padding: 8px 20px;
    border: 1px solid var(--ink); border-radius: 2px;
    background: var(--ink); color: var(--paper);
    font: 600 11.5px/1.3 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.16em; text-transform: uppercase; text-align: center;
    cursor: pointer; transition: opacity 0.15s ease; }

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
  /* scroll-padding, not just padding: scroll-snap-align start aligns a card
     to the scrollport's edge, and mandatory snapping applies that on load — so
     with padding alone the row arrives already scrolled 20px, with the first
     card sliced down its left side. scroll-padding is what tells snapping where
     the edge actually is. Both track --edge, or they come apart by the width of
     a notch the moment the phone turns landscape. */
  .rail { display: flex; gap: 14px; margin: 0 calc(var(--edge) * -1);
    padding: 0 var(--edge); scroll-padding-inline: var(--edge); list-style: none;
    overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory; }
  .rail .card { flex: 0 0 168px; scroll-snap-align: start; }

  /* Filter and sort are a GET form in a <details>. ADR-0007 rules out client
     script, and collapsing a panel on a phone is the one thing HTML will do
     without any — every applied combination is then its own cacheable URL. */
  .controls { margin: 0 calc(var(--edge) * -1); border-bottom: 1px solid var(--hairline); }
  /* Padding rather than a flex box with a height: any display other than the
     default list-item drops the disclosure triangle in Chrome and Safari, and
     that triangle is the only thing saying the row opens. */
  .controls summary { padding: 21px var(--edge); cursor: pointer;
    font: 400 10.5px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.16em; text-transform: uppercase; }
  .controls form { display: flex; flex-direction: column; gap: 22px; padding: 2px var(--edge) 24px; }
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
  .btn:hover { opacity: 0.88; color: var(--paper); }
  .btn.secondary { background: transparent; color: var(--ink); border-color: var(--hairline); }
  .btn.secondary:hover { color: var(--ink); border-color: var(--ink); opacity: 1; }
  /* A button that has to sit next to type rather than span the measure. */
  .btn.inline { width: auto; display: inline-flex; }
  .btn:disabled { opacity: 0.45; cursor: default; }
  .actions { display: flex; flex-direction: column; gap: 10px; margin-top: 22px; }

  .buy { margin: 14px 0 6px; }
  /* Variants. A fieldset, so the radios are one named group to a screen reader
     rather than four unrelated controls — but laid out as plain blocks: a
     legend inside a flex container is rendered by its own rules and lands in
     the wrong place. */
  .variant-group { margin: 0 0 16px; padding: 0; border: 0; }
  .variant-label { display: block; padding: 0; margin-bottom: 9px;
    font: 400 10px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.16em; text-transform: uppercase; color: var(--tertiary); }
  .variant-options { display: flex; flex-wrap: wrap; gap: 8px; }
  /* Off-screen rather than display:none — a hidden radio is still the control a
     keyboard tabs to and a screen reader announces. */
  .variant-radio { position: absolute; width: 1px; height: 1px; padding: 0;
    margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .variant-chip { display: inline-flex; align-items: center; justify-content: center;
    min-height: 44px; min-width: 52px; padding: 0 16px;
    border: 1px solid var(--hairline); border-radius: 2px; font-size: 14.5px;
    cursor: pointer; user-select: none; transition: border-color 0.15s, background 0.15s; }
  .variant-radio:checked + .variant-chip { border-color: var(--ink);
    background: var(--ink); color: var(--paper); }
  .variant-radio:focus-visible + .variant-chip { outline: 2px solid var(--ink);
    outline-offset: 2px; }
  .variant-chip.disabled { opacity: 0.35; text-decoration: line-through; cursor: not-allowed; }

  /* Cart */
  .cart-list { list-style: none; padding: 0; margin: 0; }
  .cart-item { display: grid; grid-template-columns: 68px 1fr auto; gap: 14px;
    padding: 18px 0; border-bottom: 1px solid var(--hairline); align-items: start; }
  .cart-thumb { width: 68px; aspect-ratio: 4 / 5; border-radius: 2px;
    overflow: hidden; background: var(--shot); }
  .cart-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .cart-info { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .cart-title { margin: 0; font: 400 16px/1.3 ui-serif, Georgia, "Times New Roman", serif; }
  .cart-variant, .cart-price { margin: 0; font-size: 13px; color: var(--tertiary); }
  .cart-line { font-size: 15px; text-align: right; white-space: nowrap; }
  /* Quantity and remove sit on one 44px row, so neither is a target a thumb
     has to aim at. */
  .cart-controls { display: flex; align-items: center; gap: 14px; margin-top: 6px; }
  .cart-qty-label { display: flex; align-items: center; gap: 7px;
    font: 400 10px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.15em; text-transform: uppercase; color: var(--tertiary); }
  .cart-qty-select { min-height: 40px; padding: 0 6px;
    border: 1px solid var(--hairline); border-radius: 2px;
    background: var(--paper); color: var(--ink);
    font: 400 15px/1 ui-serif, Georgia, "Times New Roman", serif; }
  .cart-remove-btn { display: inline-flex; align-items: center; min-height: 40px;
    padding: 0; border: 0; background: none; color: var(--tertiary);
    font: 400 10px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.15em; text-transform: uppercase; cursor: pointer; }
  .cart-remove-btn:hover { color: var(--ink); }

  /* A panel is a heading and a hairline, not a filled box. Three grey slabs on
     one confirmation page is more ink than the whole rest of the storefront
     spends, and none of it says anything. */
  .panel { padding: 20px 0; border-top: 1px solid var(--hairline); }
  /* Whatever a panel follows has already drawn the rule. Named, rather than
     :first-of-type, because the element before it is a different one on each of
     the three pages and :first-of-type counts elements, not rules. */
  .head + .panel, .confirm + .panel, .cart-list + .panel { border-top: 0; }
  /* A shade louder than a field label, or "Where it goes" reads as one more
     field rather than the name of the four under it. */
  .panel-head { margin: 0 0 16px; font: 400 11px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.19em; text-transform: uppercase; color: var(--secondary); }
  .panel p { margin: 0 0 4px; }
  .panel p:last-child { margin-bottom: 0; }
  .note { margin-top: 14px; }
  .cart-row { display: flex; justify-content: space-between; align-items: baseline;
    gap: 16px; font-size: 15px; }
  .cart-row + .cart-row { margin-top: 9px; }
  .cart-row .lab { color: var(--tertiary); }
  .cart-row.grand { margin-top: 14px; padding-top: 14px;
    border-top: 1px solid var(--hairline);
    font: 400 18px/1 ui-serif, Georgia, "Times New Roman", serif; }
  .lines { display: flex; flex-direction: column; gap: 9px; }
  .line { display: flex; justify-content: space-between; align-items: baseline;
    gap: 14px; font-size: 14.5px; }
  .line .qty { color: var(--tertiary); }
  .line .amount { white-space: nowrap; }
  .address { margin: 0; white-space: pre-wrap; }

  /* Forms */
  .form-group { display: flex; flex-direction: column; gap: 7px; margin-bottom: 18px; }
  .form-label { font: 400 10px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.16em; text-transform: uppercase; color: var(--tertiary); }
  /* 16px is not a taste call: Safari on iOS zooms the whole page in when a text
     field smaller than that takes focus, and then leaves it zoomed. */
  .form-input, .form-textarea { width: 100%; min-height: 50px; padding: 13px 14px;
    border: 1px solid var(--hairline); border-radius: 2px;
    background: var(--paper); color: var(--ink);
    font: 400 16px/1.5 ui-serif, Georgia, "Times New Roman", serif; }
  .form-textarea { min-height: auto; resize: vertical; }
  .form-input:focus, .form-textarea:focus { border-color: var(--ink); }
  .form-input::placeholder, .form-textarea::placeholder { color: var(--tertiary); opacity: 1; }
  .notice-banner { margin: 16px 0; padding: 12px 14px;
    border: 1px solid var(--hairline); border-radius: 2px; font-size: 14.5px; }
  .notice-banner.error { border-color: #b3403a; color: #b3403a; }

  .confirm { display: flex; flex-direction: column; align-items: center;
    gap: 10px; padding: 34px 0 22px; text-align: center;
    border-bottom: 1px solid var(--hairline); }
  .confirm-badge { display: grid; place-items: center; width: 46px; height: 46px;
    border-radius: 50%; background: var(--ink); color: var(--paper); }
  .centre { text-align: center; }
`
