# Use SvelteKit rather than Next.js for the storefront

Butterloom sells to customers in and around Dhaka, where mobile data cost and
network quality make first-load JavaScript weight a business concern, not a
engineering preference. We built the same page — an eight-product grid with an
interactive add-to-cart control — in both frameworks and measured the static
build output. SvelteKit ships roughly a third of the JavaScript, so we chose it.

## Measurement

Identical page, production build, gzipped, as referenced by the built
`index.html`:

| Framework | First-load JS (gzip) | Raw | Output tree |
|---|---|---|---|
| SvelteKit (`adapter-static`) | **33.3 kB** across 10 chunks | 80 kB | 144 KB |
| Next.js 15 (`output: 'export'`) | **103 kB** across 5 chunks | 341 kB | 864 KB |

Next.js additionally references a 39 kB (gzip) polyfill chunk for older
browsers, which its own reported "103 kB First Load JS" figure excludes. Taking
that into account the gap widens to roughly 4x.

Both frameworks satisfied the other hard requirement: a fully static export that
can be served from GitHub Pages during development.

## Consequences

We give up React's much larger pool of adoptable open-source commerce and admin
components, which was the original argument for Next.js — so more of the cart,
checkout and admin UI is ours to write. Accepted deliberately in exchange for
the page-weight advantage in the target market.

SvelteKit's static adapter covers the storefront only. Anything holding a
secret — the bKash app secret, courier API credentials — cannot ship in a static
build and will require deploying with a server adapter. Static export is a
development-phase convenience, not the production shape.
