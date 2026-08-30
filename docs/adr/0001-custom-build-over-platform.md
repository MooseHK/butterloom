# Build Butterloom as a custom application rather than adopting a commerce platform

Butterloom needs COD ordering, shared stock, a two-operator admin and later bKash,
for an online-first brand in Dhaka. We evaluated adopting an existing open-source
platform and chose instead to build a custom application, composing open-source
libraries where they fit rather than inheriting a platform's product model, admin
and conventions.

## Considered Options

- **WooCommerce + custom theme** — would have supplied COD, orders, stock, refunds
  and staff accounts on day one, and bKash/Nagad integration is an existing,
  locally-maintained plugin rather than engineering work. Rejected in favour of
  owning the codebase outright.
- **Medusa (Node/TypeScript)** — headless, real TypeScript codebase, COD built in;
  the bKash provider would have been ours to write regardless.
- **Bagisto (Laravel)** — complete store and admin as an editable codebase, but a
  much smaller ecosystem, so bKash would likely have been custom anyway.

## Consequences

Order lifecycle, stock control, staff access, reporting, returns and the bKash
integration are all ours to build and maintain — none arrive for free. The
counterweight is total control of the product model and storefront, with no
platform conventions to work around. This is the decision most likely to be
revisited if operator time becomes the binding constraint; revisiting it means
migrating data into a platform, not re-skinning, so it gets harder over time.
