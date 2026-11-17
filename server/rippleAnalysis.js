const MODEL_VERSION = 'ripple-heuristic-v1'

const MACRO_VARIABLES = Object.freeze({
  repo_rate: { key: 'repo_rate', label: 'RBI repo rate', unit: 'percentage_points', shockLabel: 'percentage points', min: -5, max: 5 },
  cpi_inflation: { key: 'cpi_inflation', label: 'CPI inflation', unit: 'percentage_points', shockLabel: 'percentage points', min: -10, max: 10 },
  usd_inr: { key: 'usd_inr', label: 'USD/INR', unit: 'percent', shockLabel: '%', min: -30, max: 30 },
  crude_oil: { key: 'crude_oil', label: 'Crude oil', unit: 'percent', shockLabel: '%', min: -50, max: 50 },
  gdp_growth: { key: 'gdp_growth', label: 'GDP growth', unit: 'percentage_points', shockLabel: 'percentage points', min: -10, max: 10 },
  bond_yield: { key: 'bond_yield', label: 'Government bond yield', unit: 'basis_points', shockLabel: 'bps', min: -300, max: 300 },
})

// Illustrative transmission assumptions, not fitted or causal estimates.
// Positive values indicate a positive modeled impact for the sector when the
// corresponding shock is positive under the variable's sign convention.
const SECTOR_COEFFICIENTS = Object.freeze({
  'Financial Services': { repo_rate: -0.8, cpi_inflation: -0.2, usd_inr: 0.05, gdp_growth: 0.6, bond_yield: -0.08 },
  'Information Technology': { repo_rate: 0, cpi_inflation: -0.1, usd_inr: 0.7, crude_oil: 0, gdp_growth: 0.25, bond_yield: 0 },
  'Oil & Gas': { repo_rate: 0, cpi_inflation: 0.05, usd_inr: -0.1, crude_oil: 0.55, gdp_growth: 0.2, bond_yield: 0 },
  'Automobile': { repo_rate: -0.35, cpi_inflation: -0.25, usd_inr: -0.15, crude_oil: -0.2, gdp_growth: 0.55, bond_yield: -0.03 },
  'Aviation': { repo_rate: -0.2, cpi_inflation: -0.2, usd_inr: -0.2, crude_oil: -0.8, gdp_growth: 0.45, bond_yield: -0.02 },
  'FMCG': { repo_rate: -0.1, cpi_inflation: -0.3, usd_inr: -0.1, crude_oil: -0.2, gdp_growth: 0.3, bond_yield: 0 },
  'Pharmaceuticals': { repo_rate: -0.05, cpi_inflation: -0.05, usd_inr: 0.25, crude_oil: -0.1, gdp_growth: 0.2, bond_yield: 0 },
  'Metals': { repo_rate: -0.1, cpi_inflation: -0.1, usd_inr: 0.05, crude_oil: -0.15, gdp_growth: 0.7, bond_yield: 0 },
  'Infrastructure': { repo_rate: -0.4, cpi_inflation: -0.2, usd_inr: -0.05, crude_oil: -0.1, gdp_growth: 0.7, bond_yield: -0.05 },
  'Telecommunications': { repo_rate: -0.15, cpi_inflation: -0.1, usd_inr: -0.05, crude_oil: -0.05, gdp_growth: 0.35, bond_yield: -0.02 },
  'Consumer Durables': { repo_rate: -0.3, cpi_inflation: -0.25, usd_inr: -0.15, crude_oil: -0.1, gdp_growth: 0.5, bond_yield: -0.03 },
  'Chemicals': { repo_rate: -0.1, cpi_inflation: -0.1, usd_inr: 0.15, crude_oil: -0.25, gdp_growth: 0.35, bond_yield: 0 },
  'Cement': { repo_rate: -0.3, cpi_inflation: -0.2, usd_inr: -0.05, crude_oil: -0.15, gdp_growth: 0.65, bond_yield: -0.04 },
  'Power': { repo_rate: -0.25, cpi_inflation: -0.1, usd_inr: -0.05, crude_oil: -0.1, gdp_growth: 0.5, bond_yield: -0.04 },
  'Retail': { repo_rate: -0.25, cpi_inflation: -0.35, usd_inr: -0.1, crude_oil: -0.15, gdp_growth: 0.55, bond_yield: -0.02 },
  'Media': { repo_rate: -0.1, cpi_inflation: -0.2, usd_inr: -0.05, crude_oil: -0.05, gdp_growth: 0.4, bond_yield: 0 },
})

function finite(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeScenario(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Scenario must be an object.')
  const raw = Array.isArray(input.shocks) ? input.shocks : []
  if (!raw.length || raw.length > Object.keys(MACRO_VARIABLES).length) throw new Error('At least one supported macro shock is required.')
  const seen = new Set()
  const shocks = raw.map((item) => {
    const key = String(item?.key || '').trim()
    const definition = MACRO_VARIABLES[key]
    if (!definition) throw new Error(`Unsupported macro variable: ${key || 'missing key'}.`)
    if (seen.has(key)) throw new Error(`Duplicate macro variable: ${key}.`)
    seen.add(key)
    const shock = finite(item?.shock)
    if (shock === null || shock < definition.min || shock > definition.max) throw new Error(`Invalid ${key} shock. Expected ${definition.min} to ${definition.max} ${definition.shockLabel}.`)
    const baseline = item?.baseline === undefined || item?.baseline === null || item?.baseline === '' ? null : finite(item.baseline)
    if (item?.baseline !== undefined && item?.baseline !== null && item?.baseline !== '' && baseline === null) throw new Error(`Invalid ${key} baseline.`)
    return {
      ...definition,
      shock,
      baseline,
      provenance: baseline === null ? 'hypothetical_without_observed_baseline' : (item?.provenance || 'user_provided_baseline'),
      source: item?.source || null,
      sourceTimestamp: item?.sourceTimestamp || null,
    }
  })
  return { shocks }
}

function calculateSectorImpact(sector, shocks, coefficientRegistry = SECTOR_COEFFICIENTS) {
  const coefficients = coefficientRegistry?.[sector]
  if (!coefficients) return { sector, status: 'unavailable', modeledImpactPct: null, reason: 'No supported sector transmission coefficients are configured.' }
  const contributions = shocks.map((shock) => {
    const coefficient = coefficients[shock.key]
    if (!Number.isFinite(coefficient)) return { key: shock.key, status: 'unsupported', shock: shock.shock, contributionPct: null }
    const contributionPct = shock.shock * coefficient
    return { key: shock.key, status: 'modeled', shock: shock.shock, coefficient, contributionPct }
  })
  const supported = contributions.filter((item) => item.status === 'modeled')
  if (!supported.length) return { sector, status: 'unavailable', modeledImpactPct: null, contributions, reason: 'None of the selected shocks has a configured relationship for this sector.' }
  return {
    sector,
    status: supported.length === contributions.length ? 'available' : 'partial',
    modeledImpactPct: Number(supported.reduce((total, item) => total + item.contributionPct, 0).toFixed(6)),
    contributions,
    coefficientProvenance: 'illustrative_heuristic',
  }
}

function simulateRipple(input = {}) {
  const scenario = normalizeScenario(input)
  const coefficientRegistry = input.coefficientRegistry || SECTOR_COEFFICIENTS
  const modelVersion = input.modelVersion || MODEL_VERSION
  const coefficientProvenance = input.coefficientProvenance || (coefficientRegistry === SECTOR_COEFFICIENTS ? 'illustrative_heuristic' : 'historically_estimated')
  const requestedSectors = Array.isArray(input.sectors) && input.sectors.length ? input.sectors : Object.keys(coefficientRegistry)
  const sectorImpacts = [...new Set(requestedSectors.map((value) => String(value).trim()).filter(Boolean))].map((sector) => calculateSectorImpact(sector, scenario.shocks, coefficientRegistry))
  const available = sectorImpacts.filter((item) => item.status === 'available' || item.status === 'partial')
  return {
    modelVersion,
    status: available.length === sectorImpacts.length ? 'available' : available.length ? 'partial' : 'unavailable',
    scenario: clone(scenario),
    sectorImpacts,
    stockImpacts: [],
    portfolio: { status: 'not_requested', modeledValue: null, modeledImpactPct: null, coveragePct: null, contributions: [], reasons: [] },
    coefficientProvenance,
    assumptions: [coefficientProvenance === 'historically_estimated' ? 'Coefficients were estimated from supplied historical observations; association is not proof of causation.' : 'Coefficients are illustrative economic transmission assumptions, not statistically estimated relationships.', 'Effects are additive and do not capture interactions, company-specific hedges, or valuation changes.', 'Modeled impact is a scenario sensitivity, not a forecast or price target.'],
    limitations: ['Observed macroeconomic baselines are not currently integrated; baselines are user-provided or unavailable.', 'Only configured sector-variable relationships contribute to a result.'],
  }
}

function applyStockImpacts(result, stockMetadata = []) {
  const items = Array.isArray(stockMetadata) ? stockMetadata : []
  const stockImpacts = items.map((item) => {
    const symbol = String(item?.symbol || '').toUpperCase().replace(/\.NS$/, '')
    const sector = String(item?.sector || '').trim()
    const sectorResult = result.sectorImpacts.find((entry) => entry.sector === sector)
    if (!sectorResult || sectorResult.modeledImpactPct === null) return { symbol, sector: sector || null, status: 'unavailable', modeledImpactPct: null, reason: 'Sector metadata or a supported sector model is unavailable.' }
    return { symbol, sector, status: sectorResult.status, modeledImpactPct: sectorResult.modeledImpactPct, reason: 'Inherited from the configured sector transmission model.' }
  })
  return { ...result, stockImpacts }
}

function applyPortfolioImpacts(result, holdings = [], quotes = {}, baseCurrency = 'INR') {
  const active = (Array.isArray(holdings) ? holdings : []).filter((item) => finite(item?.quantity) > 0)
  const eligible = []
  const unavailable = []
  for (const holding of active) {
    const symbol = String(holding.symbol || '').toUpperCase()
    const quote = quotes[symbol]
    const price = finite(quote?.price)
    const quantity = finite(holding.quantity)
    const currency = String(quote?.currency || holding.currency || '').toUpperCase()
    const stock = result.stockImpacts.find((item) => item.symbol === symbol)
    if (!quote || price === null || currency !== String(baseCurrency || '').toUpperCase() || !stock || stock.modeledImpactPct === null) {
      unavailable.push({ symbol, reason: !quote || price === null ? 'Current quote unavailable.' : currency !== String(baseCurrency || '').toUpperCase() ? 'Currency is incompatible with the portfolio base currency.' : 'Sector impact unavailable.' })
      continue
    }
    eligible.push({ symbol, marketValue: quantity * price, modeledImpactPct: stock.modeledImpactPct, currency })
  }
  const total = eligible.reduce((sum, item) => sum + item.marketValue, 0)
  const contributions = total > 0 ? eligible.map((item) => ({ ...item, weight: item.marketValue / total, contributionPct: item.marketValue / total * item.modeledImpactPct })) : []
  const modeledImpactPct = contributions.length ? contributions.reduce((sum, item) => sum + item.contributionPct, 0) : null
  return {
    ...result,
    portfolio: {
      status: !active.length ? 'empty' : unavailable.length ? (eligible.length ? 'partial' : 'unavailable') : 'available',
      baseCurrency,
      modeledValue: total > 0 ? total : null,
      modeledImpactPct,
      coveragePct: active.length ? eligible.length / active.length * 100 : 0,
      contributions,
      unavailable,
      reasons: unavailable.length ? ['Portfolio impact excludes holdings without a compatible current quote or supported sector model.'] : [],
    },
  }
}

module.exports = { MACRO_VARIABLES, MODEL_VERSION, SECTOR_COEFFICIENTS, normalizeScenario, calculateSectorImpact, simulateRipple, applyStockImpacts, applyPortfolioImpacts }
