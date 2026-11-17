# Economic Ripple Simulator methodology

## Status

The initial simulator is a deterministic, stateless sensitivity model. It is
not an econometric forecast, a price target, or investment advice. Coefficients
in `server/rippleAnalysis.js` are illustrative heuristics and are marked with
`illustrative_heuristic` provenance. No coefficient has been statistically
calibrated or causally validated by this project.

## Variables and units

The registry currently accepts:

- `repo_rate`: RBI policy-rate shock in percentage points.
- `cpi_inflation`: inflation shock in percentage points.
- `usd_inr`: percentage change in INR per USD. A positive shock means rupee depreciation.
- `crude_oil`: percentage change in crude oil price.
- `gdp_growth`: GDP-growth shock in percentage points.
- `bond_yield`: government-yield shock in basis points.

The repository does not currently integrate an authoritative live macroeconomic
provider for these values. Baselines are therefore user-provided or explicitly
marked unavailable. A missing baseline is never silently replaced with zero.

## Calculation

For each configured sector:

```text
sector impact (%) = sum(shock × sector coefficient)
```

Only configured variable-sector relationships contribute. Unsupported
relationships are reported as unavailable or partial.

Stock impacts inherit the modeled impact of a validated sector classification.
Portfolio impacts use current market-value weights:

```text
weight = current quantity × current price / comparable current portfolio value
portfolio impact (%) = sum(weight × modeled stock impact (%))
```

Transaction prices and cost basis are never substituted for missing current
quotes. Incompatible currencies are excluded from the aggregate and disclosed
as partial coverage.

## Data quality and future calibration

Sector metadata is obtained from the existing cached stock-intelligence path.
If metadata is absent, the stock is not modeled. Current portfolio quotes are
retrieved server-side from the existing Yahoo Finance integration.

Future calibration should add a separate provider and estimation pipeline with
timestamped observations, frequency alignment, no look-ahead bias, sample-size
checks, and coefficient provenance. Until verified historical observations are
supplied, the current coefficients remain illustrative.

## Phase 5.1 historical-data and calibration framework

`server/historicalEconomicData.js` provides the normalized observation contract,
duplicate and invalid-record reporting, chronological splits, dependency-free
ordinary least squares, and out-of-sample error metrics. `server/rippleCalibration.js`
wraps those primitives into a separate `ripple-calibrated-v1` coefficient
registry. The calibrated registry is opt-in and cannot silently replace
`ripple-heuristic-v1`.

The repository still has no verified, configured retrieval adapter for RBI/MoSPI
macro observations or official sector-index history. Consequently no live macro
observations or calibrated economic coefficients are claimed or used by the
default simulator. The pipeline accepts normalized observations and reports
insufficient data rather than fabricating baselines or relabelling heuristics as
fitted results.

Before calibration is used in an evaluation, a provider adapter must supply
observation dates, publication/release dates, units, source, frequency, and
revision/vintage metadata. Feature alignment must use information available on
each decision date; the framework does not infer publication timing from an
observation date.

Offline checks from the repository root:

```powershell
node --test server/historicalEconomicData.test.js server/rippleCalibration.test.js
node --test server/rippleAnalysis.test.js
```

Calibration is an association model, not a causal economic model. A usable
dataset still needs sample-size, collinearity, missingness, structural-break,
survivorship, and out-of-sample evaluation before a calibrated version is
enabled for users.

## Collected snapshot (2026-11-01)

The repeatable collector is `scripts/collect-economic-data.js`. It writes raw
source payloads under `data/economic/raw/`, normalized macro observations under
`data/economic/normalized-observations.json`, Yahoo market series under
`data/economic/market-series.json`, and a research-only coefficient artifact
under `data/economic/calibration-report.json` and
`data/economic/calibrated-coefficients.json`.

The verified run collected:

- RBI DBIE policy-rate table payload: 271 source rows were retrieved, but the
  table payload exposed dates without numeric repo-rate values in this
  environment. No repo-rate coefficient was therefore estimated.
- World Bank India real GDP growth: 66 annual observations, 1960–2025. The
  API supplied a dataset `lastupdated` revision marker, but not historical
  publication vintages, so GDP was collected but excluded from the
  look-ahead-sensitive monthly calibration.
- Yahoo Finance `INR=X`: 121 monthly observations, 2016-11 through 2026-11.
- Yahoo Finance `BZ=F` Brent crude: 104 monthly observations, 2016-11 through
  2026-10.
- Yahoo Finance monthly sector-index proxies: 121 observations each for
  `^NSEBANK`, `^CNXIT`, `^CNXAUTO`, `^CNXFMCG`, `^CNXPHARMA`, `^CNXMETAL`,
  `^CNXINFRA`, and `^CNXENERGY`, covering 2016-10 through 2026-10.
- MoSPI CPI: the official e-Sankhyiki/CPI warehouse was verified as the source,
  but its endpoint was unreachable from the collection environment. CPI remains
  blocked and is not substituted with FRED or another series.

Using only aligned monthly USD/INR and Brent percentage changes, the collector
estimated separate research coefficients for eight sector-index proxies with
56 training observations and 20 chronological unseen test observations per
sector. The report contains MAE, RMSE, directional accuracy, a zero-prediction
baseline, and a `ripple-heuristic-v1` comparison. Results are mixed: the
calibrated model improves RMSE versus the heuristic for Automobile, FMCG,
Pharmaceuticals, and Oil & Gas, but worsens it for Financial Services, IT,
Metals, and Infrastructure. It is therefore not enabled in the simulator.

## AI explanation

The optional AI endpoint receives the deterministic scenario result, assumptions,
coverage, and limitations. It may explain those results but must not calculate,
change, or invent numeric impacts. Deterministic results remain available when
the AI provider is unavailable.
