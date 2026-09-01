import type { PropsWithChildren } from 'hono/jsx'

/**
 * ADR-0007: no client framework. The only stylesheet is inline because the
 * admin is behind auth and never edge-cached, so a second round trip for CSS
 * buys nothing.
 */
export function AdminLayout(props: PropsWithChildren<{ title: string }>) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} — Butterloom admin</title>
        <style>{css}</style>
      </head>
      <body>
        <header>
          <a href="/admin/products">Butterloom admin</a>
        </header>
        <main>
          <h1>{props.title}</h1>
          {props.children}
        </main>
      </body>
    </html>
  )
}

const css = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; }
  header { padding: 12px 20px; border-bottom: 1px solid #8883; }
  header a { font-weight: 600; text-decoration: none; color: inherit; }
  main { max-width: 60rem; margin: 0 auto; padding: 20px; }
  h1 { font-size: 1.4rem; }
  form { display: grid; gap: 12px; max-width: 34rem; margin: 16px 0 28px; }
  label { display: grid; gap: 4px; font-weight: 600; }
  input, textarea, button { font: inherit; padding: 8px; border: 1px solid #8886; border-radius: 6px; background: transparent; color: inherit; }
  button { cursor: pointer; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #8883; }
  .gallery { display: flex; flex-wrap: wrap; gap: 14px; list-style: none; padding: 0; }
  .gallery img { width: 180px; height: auto; border-radius: 6px; display: block; }
  .notice { padding: 10px 12px; border-radius: 6px; border: 1px solid #8886; }
  .notice.error { border-color: #d33; }
  .muted { color: #8889; }
`
