# Launch prerequisites

External dependencies with lead times we do not control. None are engineering
work; all of them can start before a line of code is written, and several will
take longer than the build.

| Prerequisite | Needed for | Notes |
|---|---|---|
| **DBID / UBI registration** | Trading legally at all | Mandatory for online businesses in Bangladesh — websites, pages and apps alike. Also a precondition for gateway applications later. |
| **bKash Merchant Account** | Manual bKash tier | A till number, not a gateway agreement, so a much lighter approval than PGW. Running business volume through a personal wallet instead risks the number being frozen. |
| **Trade licence, TIN, company bank account, NID** | DBID, Merchant Account, and every later gateway | The common KYC set. Assemble once. |
| **Pathao merchant account** | Dispatch | Needed for the merchant panel and its bulk upload. Verified business address required for pickup. |
| **SMS delivery account** | Cash on Delivery checkout, order and dispatch notifications | A launch blocker since ADR-0008 put an OTP in front of every Cash on Delivery order — without working SMS, that tier cannot take orders. The *masked sender ID* is the part that needs provider approval with real lead time; unmasked SMS works as a fallback and is not itself a blocker. |
| **Card endorsed for international payment** | Paying the host every month | Foreign-currency billing from Bangladesh needs a card actually endorsed for it (ADR-0006). A declined renewal takes the site down. Arrange a second one as a standby. |
| **Product photography** | The storefront existing | Not an approval, but reliably the true critical path for a fashion catalogue. Shooting and retouching outlast the build. |
| **Published policies** — returns, refunds, terms, privacy, contact | Trading, and later gateway approval | Gateways inspect the live site before approving. |

Later, and not on the launch path: bKash PGW Merchant Approval and a payment
aggregator account, both of which improve fee margin and checkout experience
without gating the ability to trade (ADR-0001).
