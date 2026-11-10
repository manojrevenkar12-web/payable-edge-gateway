# Working in this repository

Fast feedback first: `npm run typecheck && npm test` takes seconds and runs inside workerd. Run it after every change.
`npm run sim` takes under a minute; run it before touching the dashboard.

## Invariants

- **Never charge for what was not delivered.** Settlement happens after the origin's answer and before the content
  leaves. A non-2xx answer, or an unmet outcome on an outcome-priced rule, releases the reservation.
- **One payment pays once.** Every decision about a payer goes through that payer's `PayerLedger` Durable Object.
  Do not add a path that settles without a reservation.
- **Money is integers.** Atomic units as `bigint`, parsed with `parseAtomic` from integer strings. No floats, no
  `Number()` on an amount outside display code.
- **The book reconciles to the chain.** `SellerBook` keys sales by transaction. The report compares it with the
  chain every time; a difference is a bug to find, not a number to adjust.
- **The simulator keeps its own accounts.** `scripts/simulate.ts` uses only what an agent has (client helpers,
  public config). It must never import the gateway, ledger or seller book to work out what was owed.
- **Settings in config.** Prices, limits, windows and the spending cap live in `config/pricing.json`. The console's
  colours, sizes and timings live in `web/src/shared/theme/tokens.ts`.
- **Generated reports.** `reports/*.json`, the README dashboard and `web/public/sample-report.json` are written by
  `npm run sim`, `npm run test:report` and `npm run report`. Do not edit them by hand.

## Reported run

The dashboard reports seed 7 with 4,000 tasks. Explore with other seeds (`SIM_SEED=…`); change the reported seed
only with a note in the commit saying why.
