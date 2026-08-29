# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Butterloom is an e-commerce storefront for an ethnic/South-Asian-inspired clothing brand. Today the
entire product — storefront, cart, checkout, and admin dashboard — is a single self-contained
`index.html` (markup + `<style>` + `<script>`, no dependencies, no build step).

## Deployment model (this constrains every change)

GitHub Pages serves this repo with the **legacy "deploy from a branch"** build
(`dynamic/pages/pages-build-deployment`), publishing the **root of `main`**. Live at
`https://moosehk.github.io/butterloom/`. Merging to `main` deploys within ~40s; there is no
staging environment and no CI.

Consequences that must hold for any change:

- **No server, no build output that isn't committed.** Anything requiring `npm run build`, SSR, a
  Node server, or a database will not run on Pages. If a toolchain is ever introduced, either commit
  the built output to the served root or replace the legacy Pages build with a GitHub Actions
  workflow that builds and uploads the artifact — the current dynamic workflow does not run one.
- **The site is served from the `/butterloom/` sub-path**, not a domain root. Use relative URLs
  (`./assets/x.svg`), never root-absolute (`/assets/x.svg`), for links, images, fetches, and any
  router `basename`.
- **No SPA 404 fallback.** Deep links only work for real files on disk, so multi-page navigation
  means real `.html` files (or hash routing).
- **Jekyll processes the branch.** Files/directories starting with `_` are dropped. Add a
  `.nojekyll` file at the root before introducing any such paths.
- Verify work the way the user does: on the deployed Pages URL after merge, not only locally.

## Run locally

```bash
python -m http.server 8000   # then open http://127.0.0.1:8000
```

Opening `index.html` via `file://` mostly works but diverges from Pages on relative paths and
`localStorage` origin, so prefer the server. There are no tests, linters, or package manifests —
verification is manual in the browser. When adding tooling, keep it optional: the site must stay
runnable by serving the repo root as-is.

## Architecture of `index.html`

One `<script>` holds the whole app; there are no modules or framework.

- **State**: a single object `{ users, products, cart, orders, logs }` persisted as JSON in
  `localStorage` under `butterloom-store-v1`. `load()` merges stored state over `createDefaults()`
  and array-checks every key, so adding a new top-level key means adding it to *both* the defaults
  and the merge in `load()`. Bump the key name when a shape change would break existing browsers.
- **Mutate → `save()` → re-render.** There is no reactivity: every handler mutates `state`, calls
  `save()`, then explicitly calls the affected `renderX()` functions (`renderCatalog`, `renderCart`,
  `renderCheckoutReview`, `renderInventory`, `renderOrders`, `renderUsers`, `renderLogs`). Forgetting
  a render call is the most common bug. Renderers clear via `textContent = ""` and rebuild with
  `createElement` — no `innerHTML` anywhere; keep it that way since product/user text is user input.
- **Roles**: `manager` (inventory + users + restock), `fulfillment` (+ `manager`: order status),
  `viewer` (read-only), validated against `allowedRoles`. `hasRole()` gates every admin mutation.
- **Orders**: checkout re-validates stock for every line, decrements `product.stock`, unshifts the
  order, clears the cart, and logs. `logAction()` writes to `state.logs` (capped at 100, newest first).

**All of this is client-side and per-browser.** Admin "sign-in" is a dropdown with no credentials,
inventory is not shared between visitors, and role checks are UI affordances, not security. Do not
describe or build on them as if they were enforced; anything requiring real accounts, shared
inventory, or payments needs a backend or a hosted service (and a plan for how it reaches Pages).

## Design system

Not yet decided — there is no logo, typeface, or token spec. Current colors live in the `:root`
custom properties at the top of the `<style>` block (warm terracotta `--accent` on a cream `--bg`)
and the type stack is a system-font fallback. Route new styling through those custom properties
rather than hardcoding values, so a real design system can land by redefining tokens.

## Working style for this repo

- The user tests from the public internet, so ship changes that are deployable and reachable via
  plain static Pages unless they explicitly say otherwise.
- Prefer durable structure over throwaway patches, built side-by-side with what exists: when
  extracting CSS/JS out of `index.html` or splitting pages, keep the working site serving the whole
  time rather than landing a half-migrated root.

## Branch

Develop on `claude/butterloom-ecommerce-setup-1cv4em`; push there and do not push to `main`.
