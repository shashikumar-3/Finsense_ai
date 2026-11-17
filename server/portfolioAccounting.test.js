const test = require('node:test')
const assert = require('node:assert/strict')
const { accountFifoTransactions } = require('./portfolioAccounting')

const buy = (id, quantity, price, date, fees = 0) => ({ id, symbol: 'TCS', exchange: 'NSE', currency: 'INR', transaction_type: 'BUY', quantity, unit_price: price, fees, executed_at: date })
const sell = (id, quantity, price, date, fees = 0) => ({ id, symbol: 'TCS', exchange: 'NSE', currency: 'INR', transaction_type: 'SELL', quantity, unit_price: price, fees, executed_at: date })

test('FIFO matches oldest lots and calculates realized and unrealized P&L', () => {
  const result = accountFifoTransactions([
    buy('1', 10, 100, '2025-01-01T10:00:00Z'),
    buy('2', 10, 120, '2025-02-01T10:00:00Z'),
    sell('3', 12, 150, '2025-03-01T10:00:00Z'),
  ], { TCS: { price: 140, currency: 'INR', timestamp: '2025-03-02T00:00:00Z' } }, { baseCurrency: 'INR' })
  assert.equal(result.matches[0].matchedCost, 1000)
  assert.equal(result.matches[1].matchedCost, 240)
  assert.equal(result.realizedPnl, 560)
  assert.equal(result.rows[0].quantity, 8)
  assert.equal(result.rows[0].remainingCostBasis, 960)
  assert.equal(result.currentMarketValue, 1120)
  assert.equal(result.unrealizedPnl, 160)
})

test('same timestamps use created/id ordering and oversells are rejected', () => {
  const result = accountFifoTransactions([
    { ...buy('b', 2, 100, '2025-01-01T00:00:00Z'), created_at: '2025-01-01T00:00:01Z' },
    { ...buy('a', 2, 90, '2025-01-01T00:00:00Z'), created_at: '2025-01-01T00:00:01Z' },
  ])
  assert.equal(result.rows[0].quantity, 4)
  assert.throws(() => accountFifoTransactions([sell('s', 1, 100, '2025-01-01T00:00:00Z')]), /Sale exceeds available FIFO quantity/)
})

test('tax estimates are separated by holding period and never tax losses', () => {
  const result = accountFifoTransactions([
    buy('1', 1, 100, '2024-01-01T00:00:00Z'),
    buy('2', 1, 100, '2025-07-01T00:00:00Z'),
    sell('3', 2, 200, '2026-01-01T00:00:00Z'),
  ])
  assert.equal(result.tax.ltcgGains, 100)
  assert.equal(result.tax.stcgGains, 100)
  assert.equal(result.tax.estimatedTax, 32.5)
  const loss = accountFifoTransactions([buy('1', 1, 100, '2025-01-01T00:00:00Z'), sell('2', 1, 50, '2025-02-01T00:00:00Z')])
  assert.equal(loss.tax.estimatedTax, 0)
})
