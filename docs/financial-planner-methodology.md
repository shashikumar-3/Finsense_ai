# Financial Planner methodology

The Financial Planner is an authenticated, assumption-driven planning tool. It does not provide guaranteed outcomes or personalized investment advice.

## Cash flow

Monthly income and expense records are normalized by frequency: annual amounts are divided by 12 and weekly amounts are multiplied by 52/12. Monthly surplus is normalized income minus normalized expenses. Records retain an `is_estimated` flag so estimates are not presented as observed ledger facts.

## Projection

The projection uses monthly compounding and end-of-month contributions. For principal `P`, monthly contribution `C`, monthly rate `r`, and `n` months:

`FV = P(1+r)^n + C[((1+r)^n - 1) / r]`

At zero return, the second term is `C × n`. Real purchasing power is nominal value divided by `(1 + inflation)^(months/12)`. Values are kept at full JavaScript precision internally and formatted only in the UI.

## Goals and alerts

Goal status compares the deterministic projection with the target amount at the available deadline. Emergency-fund targets use the user-configured number of months of essential expenses; the default is three months and is a planning assumption, not a universal rule. Alerts are rule-based review prompts, not proof of financial failure or security.

## Security and data boundaries

Planning tables are user-owned and protected by Supabase RLS. The server derives the authenticated user from the bearer token and never trusts a client user ID. Portfolio transactions and holdings remain the source of truth for actual portfolio functionality; planner assets are explicitly estimates unless linked data is added through a trusted integration.
