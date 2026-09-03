# ADR-0009: Uncached Stock Fragment on Edge-Cached Product Pages for Compliance

## Context

The Digital Commerce Operation Guidelines (DCOG) 2021 mandates that an online retail storefront in Bangladesh display a live stock count on the product page before purchase.

ADR-0007 committed to edge-caching product detail pages (`/p/:slug`) from a Dhaka edge PoP, keeping availability strictly out of the cached HTML so that a stale cached page can never assert a false stock count.

These two requirements collide:
1. An edge-cached static page cannot embed a dynamic, real-time stock count.
2. Disabling caching on `/p/:slug` degrades Time To First Byte (TTFB) by ~250ms from Dhaka on the highest-intent page in the store.

## Decision

We chose **Option A: Uncached stock fragment**.

1. The HTML of `/p/:slug` remains edge-cacheable, pre-rendered without stock numbers baked into the markup.
2. A lightweight client-side fetch (under 1KB of vanilla JavaScript, well inside the 200KB JS budget from ADR-0007) requests `/stock/:slug`.
3. The `/stock/:slug` endpoint responds with:
   - `Cache-Control: private, no-store`
   - Never sets any cookie (preserving edge-caching compatibility per ADR-0007 and `src/storefront/cache.ts`).
   - JSON payload containing total stock and per-variant stock counts.
4. The client script updates the DOM:
   - Displays real-time stock count (e.g. "5 in stock", "Only 1 left in stock", "Out of stock").
   - Disables out-of-stock variant chips and toggles the buy button to "Sold out" if the selected variant has 0 stock.
   - If JavaScript fails or is disabled, the page degrades cleanly: the server-side add-to-cart check refuses short items with an explanatory error.
5. In addition, checkout blocks when stock is zero: placement checks stock and applies a guarded atomic decrement inside SQLite's single-writer transaction.

## Consequences

- The product detail page preserves edge cacheability and fast TTFB (~10–20ms from Dhaka edge).
- Compliance with DCOG 2021 live stock disclosure is fully achieved.
- No cookies are set on the stock endpoint, avoiding unintended cache poisoning.
- The 200KB client script budget easily accommodates the small stock indicator script.
