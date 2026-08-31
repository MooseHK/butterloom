# Treat a slow, metered mobile connection in Dhaka as the design target, not the edge case

Butterloom's customers are on Android phones on mobile data. Dhaka has 4G, but
congested cells, indoor coverage and shared towers mean the throughput a customer
actually gets is intermittent and often far below the headline figure, and the
data is prepaid and metered — a heavy page spends the customer's money, not just
their patience. Designing for a good connection and treating the bad one as
degradation gets this backwards: the bad connection is the normal case, and it is
where orders are won or lost. So the slow connection is what the site is designed
against, and the fast one is what it happens to also be quick on.

This constrains ADR-0005 as much as it follows from it. SvelteKit was chosen for
interaction quality; this ADR sets the ceiling on how much of that we are allowed
to spend, and where the two pull against each other, this one wins.

## Budget

A budget with a number that can be tested is worth more than a principle. These
are starting figures, to be tuned against measurement rather than defended:

- **150 KB** compressed for HTML, CSS and JavaScript on any first view.
- **200 KB** for all images above the fold, so a first view lands under ~350 KB.
- Measured on a mid-range Android with CPU throttled 4×, over a **400 kbps,
  400 ms RTT** link — the floor case, not the average one.
- Checkout completes with JavaScript disabled entirely. This is pass or fail, not
  a budget.

## Consequences

- **Images are the whole game and get engineered first.** Sized variants per
  breakpoint, AVIF or WebP with fallback, explicit dimensions so nothing reflows,
  lazy loading below the fold, and a hard cap on the largest variant. No
  carousels that fetch eight images to show one. Photography is already the
  critical path; it is also the payload.
- **No Bangla webfont without subsetting.** Bengali's glyph set and conjuncts
  make a full webfont enormous next to a Latin one, and Android ships a usable
  Bengali face already. System fonts first; a webfont only if subset and
  measured.
- Every client-side dependency is weighed in transferred kilobytes before it is
  added. Svelte's small output is the reason it was chosen; spending that win on
  libraries would leave us with the costs of ADR-0005 and none of its benefit.
- **Order placement is idempotent.** On a flaky connection a customer taps
  submit twice, and the second tap must not produce a second order or a second
  Reservation. An idempotency key on placement, not a disabled button, which does
  nothing for a request that was already in flight.
- The OTP step of ADR-0008 is the most fragile point in checkout, since it needs
  a round trip and an SMS to both land. It gets generous timeouts, a resend that
  does not restart the order, and a state that survives the customer switching
  apps to read the message.
- No autoplaying video, no preloading of assets the customer has not asked for,
  and no analytics payload that outweighs the page. Spending a customer's data
  allowance without their consent is a usability failure, not a technical one.
- Performance is verified from a real connection in Bangladesh before launch, not
  only from a CI runner in a datacentre. A synthetic throttle catches page
  weight; it does not catch what a congested Dhaka cell does to a real handshake.
- **This puts ADR-0006's Singapore origin under a standing question.** A CDN with
  a nearby point of presence is the answer for images and static assets, and the
  origin round trip for HTML is the part it cannot fix. If measurement shows that
  round trip is what hurts, BDIX-peered hosting inside Bangladesh is the lever to
  reconsider — recorded here as a known tension, not acted on yet.
