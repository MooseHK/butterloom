# A server component is mandatory; static export is a development convenience

Both integrations Butterloom depends on — bKash for MFS payments and Pathao for
COD delivery — are structurally impossible to call from browser JavaScript. We
verified this empirically against both providers' live APIs rather than inferring
it from documentation. Butterloom will therefore be deployed with a server
runtime, and the static export is treated as a development-phase preview only.

## Evidence

**bKash PGW.** No endpoint returns any `access-control-*` header, on sandbox or
production, with `Origin` supplied; preflight `OPTIONS` returns 403 because no
OPTIONS method is configured on their gateway. Calls require custom headers, so
they always preflight — browser-side calls fail structurally, not by policy.
bKash's own `bKash.init()` checkout script confirms the intended shape: its
`createRequest` and `executeRequestOnAuthorization` callbacks post to *the
merchant's own backend*, which then calls bKash. Their reference implementation
is literally named `pgw-merchant-backend-php`.

Decisively, the Grant Token API is rate-limited to **two calls per hour**, with a
one-hour block on breach. Per-browser token minting would lock the merchant out
of their own payment gateway within minutes of any real traffic.

**Pathao Courier.** Their Kong gateway runs a fixed CORS origin allowlist
containing `https://merchant.pathao.com` and nothing else; every other origin
receives no `Access-Control-Allow-Origin`. The failure mode is worse than a
plain rejection: an authenticated request still reaches Pathao and mutates state
while the browser blocks the response, so an order could be created that the
page reports as failed. Separately, `client_id` + `client_secret` alone mint a
**90-day merchant-wide** bearer token, so those credentials can never ship to a
client.

Both providers also require a publicly reachable HTTPS endpoint to receive
webhooks (bKash IPN via AWS SNS with a subscription handshake; Pathao's
`X-PATHAO-Signature` webhook with a 10-second response requirement and a header
echo). A static host cannot receive a POST.

## Consequences

The storefront may still be prerendered and served statically, but the
deployment target must provide a server runtime for payment and courier
routes. GitHub Pages remains useful for previewing storefront design during
development and is not the production host.

This also forecloses browser-only order storage. A courier integration needs a
server-side Order record to hand over, and COD reconciliation against Pathao's
settlements needs order history that outlives one visitor's browser.

One caveat carried forward, unverified: bKash's documentation says nothing about
IP allowlisting and our probes reached their auth layer from an arbitrary cloud
IP, but whether bKash applies a per-merchant allowlist to production credentials
as an onboarding step is unconfirmed. Confirm with bKash before committing to a
rotating-IP edge runtime.
