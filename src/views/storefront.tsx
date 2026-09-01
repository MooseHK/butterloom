import type { PropsWithChildren } from 'hono/jsx'

/**
 * The storefront shell. ADR-0007: no client framework, and the stylesheet is
 * inline because a second round trip from Dhaka costs more than these bytes —
 * the whole point of serving this HTML from the edge is that it arrives in one.
 */
export function StorefrontLayout(
  props: PropsWithChildren<{ title: string; description?: string; canonicalPath: string }>,
) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        {props.description ? <meta name="description" content={props.description} /> : null}
        <link rel="canonical" href={props.canonicalPath} />
        <style>{css}</style>
      </head>
      <body>
        <header class="site">
          <a class="wordmark" href="/">
            Butterloom
          </a>
        </header>
        {props.children}
        <footer class="site">
          <p>Butterloom · Delivered across Bangladesh</p>
        </footer>
      </body>
    </html>
  )
}

const css = `
  :root { color-scheme: light dark; --ink: #1a1614; --muted: #6b625c; --line: #e5ded7; --bg: #fbf8f5; }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #f2ede8; --muted: #a89f98; --line: #3a3330; --bg: #171412; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 16px/1.55 ui-serif, Georgia, "Times New Roman", serif; }
  a { color: inherit; }
  header.site, footer.site { padding: 18px 20px; border-bottom: 1px solid var(--line); }
  footer.site { border: 0; border-top: 1px solid var(--line); margin-top: 48px; color: var(--muted); font-size: 0.85rem; }
  .wordmark { font-size: 1.25rem; letter-spacing: 0.08em; text-transform: uppercase; text-decoration: none; }
  main { max-width: 64rem; margin: 0 auto; padding: 24px 20px 0; }
  h1 { font-size: 1.6rem; margin: 0 0 4px; font-weight: 600; }
  .price { font-size: 1.15rem; margin: 0 0 20px; }
  .muted { color: var(--muted); }

  .grid { display: grid; gap: 24px 18px; padding: 0; margin: 0; list-style: none;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  .card a { text-decoration: none; display: block; }
  .card img { width: 100%; height: auto; border-radius: 4px; background: var(--line); }
  .card h2 { font-size: 0.98rem; font-weight: 500; margin: 8px 0 2px; }
  .card p { margin: 0; font-size: 0.92rem; }

  .product { display: grid; gap: 28px; }
  @media (min-width: 820px) { .product { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: start; } }
  .shots { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
  .shots img { width: 100%; height: auto; border-radius: 4px; background: var(--line); }
  .description { white-space: pre-wrap; }
  .placeholder { display: grid; place-items: center; aspect-ratio: 4 / 5; border-radius: 4px;
    background: var(--line); color: var(--muted); font-size: 0.8rem; }
`
