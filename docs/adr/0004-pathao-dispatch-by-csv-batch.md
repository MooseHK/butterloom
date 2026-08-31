# Hand consignments to Pathao as a daily CSV batch, not over the API

Pathao's merchant panel accepts a Dispatch Batch as an uploaded CSV, validating
rows in place and marking failures for correction. Because Butterloom dispatches
once a day at a volume of roughly 30 orders (ADR-0003), a single upload per day
delivers substantially all of what the courier API would, while depending on
nothing that requires approval, carries API credentials, or breaks when the
courier changes an endpoint. The API remains available later if dispatch
frequency or volume changes.

## Consequences

- **Addresses must be structured to Pathao's location hierarchy.** Pathao
  identifies a destination by numeric city, zone and area IDs alongside a free
  text address line; a single free-text address field produces a batch in which
  every row fails. Checkout must capture city, zone and area as a cascading
  selection, and orders must store those IDs. This is the load-bearing
  consequence of the decision and the expensive one to retrofit.
- Pathao's location list is external data that drifts, so it needs periodic
  refreshing rather than hard-coding.
- Delivery charges are not quoted live at checkout, so shipping must be priced
  by our own rule rather than by asking the courier.
- Consignment tracking numbers arrive back from the panel rather than being
  returned at creation, so the Order-to-Consignment link is established after
  upload, not during it.
