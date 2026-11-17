const test = require('node:test')
const assert = require('node:assert/strict')
const { applyPortfolioImpacts, applyStockImpacts, normalizeScenario, simulateRipple } = require('./rippleAnalysis')

test('normalizes units, preserves provenance, and is deterministic', () => {
  const input = { shocks: [{ key: 'repo_rate', shock: 1, baseline: 6.5 }, { key: 'usd_inr', shock: 5 }] }
  const first = simulateRipple(input)
  const second = simulateRipple(input)
  assert.deepEqual(first, second)
  assert.equal(first.scenario.shocks[0].unit, 'percentage_points')
  assert.equal(first.scenario.shocks[1].provenance, 'hypothetical_without_observed_baseline')
  assert.deepEqual(input, { shocks: [{ key: 'repo_rate', shock: 1, baseline: 6.5 }, { key: 'usd_inr', shock: 5 }] })
})

test('calculates positive, negative, combined, and unsupported sector impacts', () => {
  const result = simulateRipple({ shocks: [{ key: 'crude_oil', shock: 10 }], sectors: ['Aviation', 'Information Technology', 'Unknown'] })
  assert.equal(result.sectorImpacts[0].modeledImpactPct, -8)
  assert.equal(result.sectorImpacts[1].modeledImpactPct, 0)
  assert.equal(result.sectorImpacts[2].status, 'unavailable')
  const combined = simulateRipple({ shocks: [{ key: 'gdp_growth', shock: 2 }, { key: 'repo_rate', shock: -1 }], sectors: ['Automobile'] })
  assert.equal(combined.sectorImpacts[0].modeledImpactPct, 1.45)
})

test('rejects malformed, unsupported, duplicate, and extreme inputs', () => {
  assert.throws(() => normalizeScenario({ shocks: [] }), /At least one/)
  assert.throws(() => normalizeScenario({ shocks: [{ key: 'made_up', shock: 1 }] }), /Unsupported/)
  assert.throws(() => normalizeScenario({ shocks: [{ key: 'repo_rate', shock: 1 }, { key: 'repo_rate', shock: 2 }] }), /Duplicate/)
  assert.throws(() => normalizeScenario({ shocks: [{ key: 'repo_rate', shock: 99 }] }), /Invalid/)
})

test('requires validated stock metadata and reports unavailable sectors', () => {
  const result = applyStockImpacts(simulateRipple({ shocks: [{ key: 'usd_inr', shock: 5 }] }), [
    { symbol: 'INFY', sector: 'Information Technology' },
    { symbol: 'UNKNOWN', sector: null },
  ])
  assert.equal(result.stockImpacts[0].status, 'available')
  assert.equal(result.stockImpacts[1].status, 'unavailable')
})

test('weights portfolio impact by current market value and keeps incompatible data out', () => {
  const result = applyPortfolioImpacts(
    applyStockImpacts(simulateRipple({ shocks: [{ key: 'crude_oil', shock: 10 }] }), [{ symbol: 'AVIATION', sector: 'Aviation' }, { symbol: 'IT', sector: 'Information Technology' }]),
    [
      { symbol: 'AVIATION', quantity: 10, currency: 'INR' },
      { symbol: 'IT', quantity: 10, currency: 'INR' },
      { symbol: 'USD', quantity: 10, currency: 'USD' },
    ],
    { AVIATION: { price: 100, currency: 'INR' }, IT: { price: 100, currency: 'INR' }, USD: { price: 100, currency: 'USD' } },
    'INR',
  )
  assert.equal(result.portfolio.status, 'partial')
  assert.equal(result.portfolio.modeledValue, 2000)
  assert.equal(result.portfolio.coveragePct, 66.66666666666666)
  assert.equal(result.portfolio.contributions[0].contributionPct, -4)
  assert.equal(result.portfolio.unavailable[0].reason.includes('Currency'), true)
})
