# Regulatory requirements affecting the build

Bangladesh, online retail, COD-primary. This drives schema and workflow, not just policy
pages. Tiers: **[LAW]** statute · **[GUIDELINE]** Ministry of Commerce guideline, binding
via trade-licence and VAT sanctions · **[PRACTICE]** industry norm · **[VERIFY]** unconfirmed.

## Obligations that must exist in the software

| Requirement | Source | Tier |
|---|---|---|
| Product page must state country of origin, material, measurements, live stock count, delivery charge and delivery timeline **before purchase** | Digital Commerce Operation Guidelines 2021 | GUIDELINE |
| Checkout blocked when stock is zero — out-of-stock items may not accept payment | DCOG 2021 | GUIDELINE |
| Terms, and the return/refund/exchange policy, **written in Bengali** | DCOG 2021 | GUIDELINE |
| Delivery SLA: **5 days** same city, **10 days** elsewhere; goods to courier within **48h** of full payment, customer notified by SMS/email/phone | DCOG 2021 | GUIDELINE |
| Refunds: **10 days** on delivery failure, via the same channel paid; force majeure notify in **48h**, refund in **72h**; seller bears transaction charges | DCOG 2021 | GUIDELINE |
| Complaints: intake channel, named compliance officer, **resolved within 72 hours** | DCOG 2021 | GUIDELINE |
| Customer-visible reviews; **negative reviews may not be deleted**; no vendor-connected reviews | DCOG 2021 | GUIDELINE |
| Trade licence, DBID, BIN and TIN displayed on the site | DCOG 2021 | GUIDELINE |
| **Six-year retention** of transactions, customer data and complaint records | DCOG 2021 | GUIDELINE |
| Timestamped, **versioned** consent captured at collection, stating purpose and storage | PDPA 2026 + DCOG | LAW |
| Rectification within **30 days**; erasure for data outside the mandated retention set | PDPA 2026 | LAW |
| **Displayed price is the price charged** | Consumer Rights Protection Act 2009, s.40 | LAW |
| Accurate description and imagery (s.44 carries a Tk 2 lakh penalty) | CRPA 2009, s.44 | LAW |
| Receipt itemising VAT and other charges — **regardless of VAT registration** | DCOG 2021 | GUIDELINE |
| Invoice record carrying the nine Mushak 6.3 fields with a **monotonic serial** | VAT & SD Rules 2016, r.40(1) | LAW once registered |
| SMS in **Bengali** (OTP codes, numbers and URLs may stay Latin), via a BTRC-enlisted local aggregator, registered sender ID ≤11 chars, transactional traffic flagged separately | BTRC memos 2021 / 2022 | REGULATORY |

## Things that constrain design choices

**Advance payment is capped at 10%** of price for goods not handed to a courier within 48
hours, unless operating a Bangladesh Bank–approved escrow. This limits "partial advance
to deter COD abuse" to in-stock, ships-in-48h inventory. Pre-orders cannot use it.

**VAT is displayed inclusive.** Bangladeshi retail quotes VAT-inclusive prices; CRPA s.40
makes charging above the displayed price an offence, while the Guidelines require the
receipt to break VAT out. So: one inclusive price on the product card, itemised on the
invoice. Adding VAT as a surprise checkout line is the pattern most likely to draw a
complaint.

**The VAT rate must be configurable, never a constant.** It moved 7.5% → 15% → 10% for
own-brand clothing retail within January 2025 alone. Registration threshold is Tk 50 lakh
turnover (lowered from Tk 3 crore in January 2025); turnover tax applies from Tk 30 lakh.

**International SMS routing is prohibited** for local OTP delivery, so Twilio and similar
global providers are not a compliant path. A BTRC-enlisted local aggregator is required.

**Advertise delivery timelines in calendar days, not business days.** The 5-day same-city
and 10-day elsewhere limits count calendar days, while the market almost universally
quotes business days — so a promise of "5–8 business days" is 7–11 calendar days and
breaches the same-city SLA. At least one major Bangladeshi fashion retailer is currently
advertising in breach on this basis. Quoting calendar days costs nothing competitively
and removes the exposure entirely.

**Data protection is in force.** The Personal Data Protection Act 2026 became law on
15 April 2026 (Ordinance gazetted November 2025). This corrects an assumption carried
earlier in this project that Bangladesh had only a draft bill — several law-firm summaries
and DLA Piper's country page are still stale on this point. Penalties reach Tk 25 lakh,
Tk 50 lakh for significant data fiduciaries, with no small-business exemption.

**Retention and erasure conflict, and retention wins.** The six-year record-keeping rule
is the strictest constraint; erasure requests can only be honoured for data outside the
mandated transaction record. Design deletion as scoped redaction, never as `DELETE`.

## Operational context [PRACTICE — not law]

COD is **75–90%** of Bangladeshi online orders. Pathao's own published guidance puts
healthy delivery success at **75–85%**, with 90%+ for strong operators, and treats sub-75%
as an operational problem. Their worked example: 20% return-to-origin at 100 orders/day
and Tk 800 average order value costs roughly **Tk 117,000 a month** in logistics alone.

The standard mitigations are a pre-dispatch confirmation call, OTP on order placement for
new customers, phone-number blacklists, and third-party courier fraud-check APIs that
score a phone number against its historical success and cancellation ratio across
couriers. The risk gate belongs **pre-dispatch, not at checkout** — gating checkout costs
conversions in a market where COD is the default.

## Confirm with a local consultant before relying on these

1. **The current VAT rate for own-brand clothing retail.** It changed twice in January 2025
   and the FY2026-27 position could not be confirmed from a primary NBR source. Also the
   turnover-tax rate (3% or 4% — sources disagree).
2. **Whether the 5/10-day delivery clock binds pure-COD orders**, or only prepaid ones.
   Every English rendering of the clause conditions it on payment having been made; the
   operative Bangla clause could not be read. Treat 5/10 days as the SLA regardless.
3. **Whether the PDPA 2026 mandates breach notification.** Two sources directly contradict
   each other. Log breaches regardless; it is cheap.

Sources are recorded in the research thread; the primary ones are the Digital Commerce
Operation Guidelines 2021 gazette, the DNCRP official text of the Consumer Rights
Protection Act 2009, and the BTRC enlisted-aggregator list and SMS memos.
