import { describe, expect, it } from 'vitest'
import { calculatePortfolioRisk, calculateSeriesRisk, normalizeRiskSeries } from './portfolioRisk'

function series(values, start = '2026-01-01') {
  return values.map((close, index) => ({ datetime: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`, close }))
}

describe('portfolio risk calculations', () => {
  it('calculates annualized volatility and drawdown from a known series', () => {
    const prices = Array.from({ length: 31 }, (_, index) => 100 + index)
    const returns = prices.slice(1).map((price, index) => price / prices[index] - 1)
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
    const expectedVolatility = Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)) * Math.sqrt(252)
    const result = calculateSeriesRisk(series(prices), { minObservations: 2 })
    expect(result.status).toBe('valid')
    expect(result.volatility).toBeCloseTo(expectedVolatility, 10)
    expect(result.maximumDrawdown).toBe(0)
    expect(result.cumulativeReturn).toBeCloseTo(0.3)
  })

  it('handles zero returns and a large drawdown', () => {
    const flat = calculateSeriesRisk(series(Array(31).fill(100)), { minObservations: 2 })
    const drawdown = calculateSeriesRisk(series([100, ...Array(29).fill(50), 75]), { minObservations: 2 })
    expect(flat.volatility).toBe(0)
    expect(flat.maximumDrawdown).toBe(0)
    expect(drawdown.maximumDrawdown).toBe(-0.5)
  })

  it('rejects insufficient, invalid and duplicate observations without fabricating metrics', () => {
    const result = calculateSeriesRisk([
      { datetime: '2026-01-02', close: 110 },
      { datetime: '2026-01-01', close: -1 },
      { datetime: '2026-01-02', close: 100 },
    ])
    expect(normalizeRiskSeries([{ datetime: '2026-01-01', close: 1 }, { datetime: '2026-01-01', close: 2 }])).toHaveLength(1)
    expect(result.status).toBe('insufficient')
    expect(result.volatility).toBeNull()
  })

  it('marks a historical series stale when it is outside the configured freshness window', () => {
    const result = calculateSeriesRisk(series(Array.from({ length: 31 }, () => 100)), { minObservations: 2, asOf: '2026-10-20', maxHistoryAgeDays: 7 })
    expect(result.status).toBe('partial')
    expect(result.volatility).toBeNull()
  })

  it('reports partial risk for missing history, closed holdings and currency incompatibility', () => {
    const holdings = [
      { symbol: 'OPEN', quantity: 1, currency: 'INR', marketValue: 100 },
      { symbol: 'CLOSED', quantity: 0, currency: 'INR', marketValue: 0, realizedPnl: 20 },
      { symbol: 'USD', quantity: 1, currency: 'USD', marketValue: 100 },
    ]
    const result = calculatePortfolioRisk({ holdings, summary: { rows: holdings, marketValue: 100, safelyComparable: true }, baseCurrency: 'INR', historicalSeriesBySymbol: { OPEN: series([100, 101]) } })
    expect(result.status).toBe('unavailable')
    expect(result.assetRisk).toHaveLength(0)
  })

  it('calculates a valid current-weight proxy without including closed positions', () => {
    const rows = [{ symbol: 'A', quantity: 1, currency: 'INR', marketValue: 100 }, { symbol: 'CLOSED', quantity: 0, currency: 'INR', marketValue: 0 }]
    const result = calculatePortfolioRisk({ holdings: rows, summary: { rows, marketValue: 100, safelyComparable: true }, historicalSeriesBySymbol: { A: series(Array.from({ length: 31 }, () => 100)) } })
    expect(result.status).toBe('valid')
    expect(result.assetRisk.map((item) => item.symbol)).toEqual(['A'])
    expect(result.portfolio.volatility).toBe(0)
  })
})
