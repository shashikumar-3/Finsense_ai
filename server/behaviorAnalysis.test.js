const test = require('node:test')
const assert = require('node:assert/strict')
const { analyzeBehavior, sortTransactions } = require('./behaviorAnalysis')

const tx = (overrides = {}) => ({
  id: 'id', symbol: 'TCS', currency: 'INR', transaction_type: 'BUY', quantity: 1, unit_price: 100, fees: 2,
  executed_at: '2026-01-01T10:00:00Z', created_at: '2026-01-01T11:00:00Z', ...overrides,
})

test('empty history is truthful and does not fabricate concentration or patterns', () => {
  const result = analyzeBehavior([])
  assert.equal(result.metrics.transactionCount, 0)
  assert.equal(result.metrics.concentration.status, 'unavailable')
  assert.equal(result.dataQuality.status, 'unavailable')
  assert.equal(result.findings[0].category, 'data_quality')
})

test('calculates concentration only from supplied compatible current quotes', () => {
  const result = analyzeBehavior([
    tx({ id: 'buy-tcs', quantity: 2 }),
  ], [
    { symbol: 'TCS', currency: 'INR', quantity: 2 },
  ], { currentQuotes: { TCS: { price: 150, currency: 'INR' } }, baseCurrency: 'INR' })
  assert.equal(result.metrics.concentration.status, 'available')
  assert.equal(result.metrics.concentration.largestHoldingWeight, 1)
  assert.equal(result.metrics.concentration.hhi, 10000)
})

test('orders by executed_at, created_at, then id and calculates currency-safe metrics', () => {
  const result = analyzeBehavior([
    tx({ id: 'b', executed_at: '2026-01-02T10:00:00Z', created_at: '2026-01-01T12:00:00Z', fees: 1 }),
    tx({ id: 'a', executed_at: '2026-01-02T10:00:00Z', created_at: '2026-01-01T12:00:00Z', fees: 3 }),
    tx({ id: 'usd', currency: 'USD', unit_price: 10 }),
  ])
  const ordered = sortTransactions(result.metrics.bySymbol ? [
    { id: 'b', executedAtMs: Date.parse('2026-01-02T10:00:00Z'), createdAtMs: Date.parse('2026-01-01T12:00:00Z') },
    { id: 'a', executedAtMs: Date.parse('2026-01-02T10:00:00Z'), createdAtMs: Date.parse('2026-01-01T12:00:00Z') },
  ] : [])
  assert.deepEqual(ordered.map((item) => item.id), ['a', 'b'])
  assert.equal(result.metrics.grossPurchaseNotional, null)
  assert.equal(result.metrics.currencyBreakdown.length, 2)
})

test('detects repeated buys, buy-sell cycles, and regular intervals only with sufficient history', () => {
  const rows = [0, 30, 60, 90].map((day, index) => tx({ id: `buy-${index}`, executed_at: `2026-${String(1 + Math.floor(day / 30)).padStart(2, '0')}-01T10:00:00Z` }))
  rows.push(tx({ id: 'sell-1', transaction_type: 'SELL', executed_at: '2026-05-01T10:00:00Z' }))
  rows.push(tx({ id: 'sell-2', transaction_type: 'SELL', executed_at: '2026-06-01T10:00:00Z' }))
  const result = analyzeBehavior(rows)
  assert.equal(result.patterns.repeatedPurchases[0].buyCount, 4)
  assert.equal(result.patterns.buySellCycles[0].symbol, 'TCS')
  assert.equal(result.patterns.regularIntervals[0].symbol, 'TCS')
})

test('invalid records are excluded and reported as partial data', () => {
  const result = analyzeBehavior([tx(), tx({ id: 'bad', quantity: 0 }), tx({ id: 'bad-date', executed_at: 'not-a-date' })])
  assert.equal(result.metrics.transactionCount, 1)
  assert.equal(result.dataQuality.status, 'partial')
  assert.equal(result.dataQuality.invalidTransactionCount, 2)
})
