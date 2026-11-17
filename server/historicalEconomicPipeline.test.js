const test = require('node:test')
const assert = require('node:assert/strict')
const { alignMonthlyRows, parseRbiRepoRows, parseWorldBankGdp, parseYahooChart, percentageChanges, repoMonthlyChange } = require('./historicalEconomicPipeline')

test('parses RBI DBIE repo observations without fabricating unchanged rows', () => {
  const rows = [
    ['source', 'tab', 'period', 6, 'Effective Date', 'Bank Rate', 'Repo'],
    ['source', 'tab', 'period', 7, '07-02-2025', '', '6.25'],
    ['source', 'tab', 'period', 8, '08-02-2023', '', '6.50'],
  ]
  const parsed = parseRbiRepoRows({ rows }, '2026-11-01T00:00:00.000Z')
  assert.deepEqual(parsed.map((row) => [row.date, row.value]), [['2025-02-07', 6.25], ['2023-02-08', 6.5]])
  assert.equal(parsed[0].sourceId, 'rbi-dbie-policy-rates')
})

test('normalizes World Bank annual growth and Yahoo chart observations with provenance', () => {
  const gdp = parseWorldBankGdp([{ lastupdated: '2026-10-08' }, [{ date: '2024', value: 8.2 }]], '2026-11-01T00:00:00.000Z')
  assert.equal(gdp[0].date, '2024-12-31')
  assert.equal(gdp[0].revision, '2026-10-08')
  const yahoo = parseYahooChart({ chart: { result: [{ timestamp: [1704067200], indicators: { quote: [{ close: [83.1] }] } }] } }, 'INR=X', { id: 'yahoo-inr-x', name: 'Yahoo Finance', frequency: 'monthly' }, '2026-11-01T00:00:00.000Z')
  assert.equal(yahoo[0].value, 83.1)
  assert.equal(yahoo[0].sourceId, 'yahoo-inr-x')
})

test('computes monthly returns, policy-rate changes, and aligned calibration rows', () => {
  const fx = [1, 2, 3].map((value, index) => ({ date: `2024-0${index + 1}-31`, value }))
  const returns = percentageChanges(fx, 'fx_return')
  assert.equal(Number(returns[0].value.toFixed(4)), 100)
  const repo = [{ date: '2024-01-01', value: 6 }, { date: '2024-02-01', value: 6 }, { date: '2024-03-01', value: 6.25 }]
  assert.deepEqual(repoMonthlyChange(repo).map((row) => row.value), [0, 0.25])
  const target = [{ date: '2024-01-31', value: 1 }, { date: '2024-02-29', value: 2 }, { date: '2024-03-31', value: 4 }]
  const aligned = alignMonthlyRows(target, [{ name: 'fx', rows: fx }, { name: 'repo', rows: repo }])
  assert.equal(aligned.length, 2)
  assert.equal(aligned[0].features.fx, 2)
})
