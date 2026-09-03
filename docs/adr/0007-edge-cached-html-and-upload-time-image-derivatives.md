# Serve catalogue HTML from the edge and generate image derivatives at upload

Butterloom's customers are on Bangladeshi mobile networks, where the binding
constraint is round-trip time and JavaScript execution on inexpensive phones
rather than raw throughput. A cold HTTPS connection from Dhaka to a Singapore
origin costs roughly three round trips — around 250ms — before the server does any
work, while a Dhaka edge PoP answers in 10–20ms. Catalogue HTML is therefore
cacheable and served from the edge, and images, which are around 97% of page
weight, are pre-generated into an immutable, content-addressed derivative ladder at
upload time and served from the same CDN. The origin is a single small instance in
Singapore behind it.

## Considered options

Rendering every request at the origin is simplest and always truthful, but concedes
200–300ms of TTFB on every navigation to precisely the users being optimised for.
Fully pre-rendering the catalogue to flat files was rejected because Reservation
expiry is a timer, which would fire rebuilds on a clock. Caching pages with
availability baked in behind a short TTL and a purge was rejected because it adds a
purge path that must never silently fail, in exchange for a property the option
below gets for free.

A managed image CDN would have been less code to own, and was rejected to avoid a
vendor on the storefront's critical path with per-delivery pricing in USD.
On-the-fly resizing was rejected because it puts image encoding on the request path
of the smallest instance ADR-0003 calls for.

## Consequences

- **Availability is deliberately excluded from cached HTML.** The cached product
  page always renders the product; availability is resolved at order placement,
  where Reservation already lives per CONTEXT.md. A stale page can never assert
  something false about stock, because it asserts nothing about stock.
- **No cacheable path may ever set a cookie.** A CDN will not cache a response
  carrying `Set-Cookie`, so a session started during catalogue browsing silently
  disables edge caching of HTML with no error and no obvious symptom. Carts are
  created lazily: the first add-to-cart POST is the only response that issues a
  cookie, and the cart itself lives server-side keyed by it.
- **Admin paths must be excluded from cache rules explicitly**, and the exclusion
  is security-relevant rather than merely a performance detail.
- **The origin's template-rendering speed is nearly irrelevant to browsing traffic**,
  so it must not be used as an argument in future stack discussions. The origin's
  hot paths are checkout, Reservation and the back-office.
- **Derivatives are named by content hash and are immutable**, so they carry
  far-future cache headers and there is no purge logic to maintain or get wrong.
- **The AVIF/WebP encoder is a subprocess, not a language binding.** Derivative
  generation happens a handful of times a day inside an admin form, so shelling out
  keeps encoder choice independent of ADR-0005.
- **Client JavaScript is budgeted at 200KB, hand-written, with no framework.**
  Raised in September 2026 from the 2–3KB this ADR was written with, to leave room
  to develop against: no Bangladeshi customer's phone has been observed to have
  trouble with that much script. It is a ceiling to build under, not a target —
  what ships today is about 3.7KB uncompressed on the product page, the heaviest
  page on the storefront, and 185 bytes everywhere else. The rest of this ADR is
  unchanged by the larger number: hand-written and framework-free is a separate
  commitment, from ADR-0002 and ADR-0005, and so is the requirement below that
  checkout complete without JavaScript at all. It covers
  four interactions: the Pathao city/zone/area cascade that ADR-0004 makes mandatory,
  fetching edge-cacheable option fragments rather than shipping the whole location
  tree; a cart count read from a client-readable cookie, which is what makes a
  per-visitor badge possible on a shared cached page at all; the add-to-cart button
  on the product page, which posts by fetch and falls back to a real form submit;
  and recently viewed, which reads a slug list out of the visitor's own
  localStorage and fetches an edge-cacheable HTML fragment of the products it
  names — the second use of the fragment pattern the Pathao cascade established.
  Every form is a real form that POSTs and redirects, so checkout completes with
  JavaScript disabled.
- **Egress, not compute, is the largest infrastructure cost**, because every image
  byte is served to Bangladesh. Object storage is chosen for zero egress fees.
- **An international-bandwidth disruption in Bangladesh leaves cached catalogue
  pages serving from the Dhaka PoP while checkout, being uncached, stops.** This is
  accepted as a noted risk rather than designed around; capturing orders for later
  replay would require the queue ADR-0003 explicitly excludes.
