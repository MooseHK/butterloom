# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Butterloom is an online-first ethnic clothing brand selling to customers in and around
**Dhaka, Bangladesh**. This is a real commercial project, not a demo — treat correctness in
the money and order paths accordingly.

The repository is mid-transition. Read `CONTEXT.md` for the domain glossary and
`docs/adr/` for decisions already made and why; both are authoritative and this file
defers to them.

## Current state (transition in progress)

- `index.html` — the **legacy** single-file demo storefront. Still the only thing that
  runs. Keep it serving until the replacement is genuinely usable; do not leave the repo
  in a half-migrated state.
- `src/lib/money.js` — carried forward from the legacy work, currency-agnostic and
  worth keeping.
- Everything else is being rebuilt. The vanilla `assets/js/` modules were deleted
  because they encoded assumptions (USD, Stripe, browser-local state) the project has
  since rejected.

## Decisions already settled — do not relitigate without reading the ADRs

- **Custom application, not a commerce platform** (ADR 0001). WooCommerce, Medusa and
  Bagisto were evaluated and rejected. The cost is that orders, stock, staff access,
  returns and reporting are all ours to build. Compose open-source libraries
  aggressively; do not reimplement solved problems by hand.
- **SvelteKit, not Next.js** (ADR 0002). Chosen on measured first-load JavaScript
  weight — 33 kB vs 103 kB gzipped for an identical page — because mobile data cost in
  the target market is a business concern.
- **A server runtime is mandatory** (ADR 0003). This is the constraint that shapes
  everything.

## The constraint that shapes every change

**bKash and Pathao cannot be called from browser JavaScript.** This was verified against
their live APIs, not inferred:

- Neither returns CORS headers to any origin we control.
- bKash's Grant Token API is limited to **two calls per hour** — per-visitor token
  minting would lock the merchant out of their own payment gateway.
- Pathao's `client_secret` mints a 90-day merchant-wide token; exposing it hands over
  the courier account.
- Pathao's failure mode is especially dangerous: a browser request still reaches them
  and creates the order, but the response is blocked, so the page reports failure on a
  consignment that now exists.

Therefore: **any credential, payment call or courier call belongs on the server.** The
storefront may be prerendered, but a static-only deployment cannot be the production
shape.

GitHub Pages is a **development preview only** — useful for showing storefront design
during a session. It is not the deployment target. (Because SvelteKit emits an `_app`
directory and Jekyll drops underscore-prefixed paths, the root `.nojekyll` file must
stay for Pages previews to work.)

## Money

Every monetary amount is an **integer number of minor units**, never a float and never a
string. Rates are basis points. Amounts become decimal only at the moment they are
rendered. Currency is BDT. `src/lib/money.js` holds this and asserts integer inputs —
route new money handling through it rather than doing arithmetic inline.

## Domain language

Use the terms in `CONTEXT.md` exactly, in code and in conversation. In particular an
**Order** exists only once Butterloom has received it — a cart in a customer's browser is
not an Order — and a **Delivery Area** is a courier city/zone/area triple, not a typed
address.

## Design system

Undecided. No logo, typeface or token spec exists yet. Route styling through custom
properties so a real design system can land by redefining tokens rather than by editing
components.

## Working style

- Verify claims about third-party APIs against the actual API. The bKash and Pathao
  findings in ADR 0003 came from live probes and contradicted what the documentation
  implied; assume the same rigour is needed elsewhere.
- Prefer durable structure built side-by-side with what exists over throwaway patches.

## Branch

Develop on `claude/butterloom-ecommerce-setup-1cv4em`; push there and do not push to `main`.
