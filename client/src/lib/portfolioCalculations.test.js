import { calculatePortfolioSummary, isQuoteUsable } from './portfolioCalculations'

const holding = (overrides = {}) => ({
  symbol: 'TCS', currency: 'INR', quantity: 5, average_purchase_price: 43, realized_pnl: 0, ...overrides,
})

const quote = (price = 50, overrides = {}) => ({
  price, currency: 'INR', timestamp: '2026-10-20T10:00:00.000Z', ...overrides,
})

describe('portfolio calculations', () => {
  it('calculates positive, negative, and flat unrealized P&L', () => {
    expect(calculatePortfolioSummary([holding()], { TCS: quote(50) }, { baseCurrency: 'INR', now: Date.parse('2026-10-20T10:05:00Z') }).unrealizedPnl).toBe(35)
    expect(calculatePortfolioSummary([holding()], { TCS: quote(40) }, { baseCurrency: 'INR', now: Date.parse('2026-10-20T10:05:00Z') }).unrealizedPnl).toBe(-15)
    expect(calculatePortfolioSummary([holding()], { TCS: quote(43) }, { baseCurrency: 'INR', now: Date.parse('2026-10-20T10:05:00Z') }).unrealizedPnl).toBe(0)
  })

  it('includes fees through the database-provided average cost', () => {
    const result = calculatePortfolioSummary([holding({ quantity: 1, average_purchase_price: 510 })], { TCS: quote(550) }, { baseCurrency: 'INR', now: Date.parse('2026-10-20T10:05:00Z') })
    expect(result.investedCostBasis).toBe(510)
    expect(result.unrealizedPnl).toBe(40)
  })

  it('keeps realized P&L once, including zero-quantity positions', () => {
    const result = calculatePortfolioSummary([
      holding({ quantity: 0, average_purchase_price: 0, realized_pnl: 30 }),
      holding({ symbol: 'INFY', quantity: 2, average_purchase_price: 100, realized_pnl: -5 }),
    ], { INFY: quote(110) }, { baseCurrency: 'INR', now: Date.parse('2026-10-20T10:05:00Z') })
    expect(result.realizedPnl).toBe(25)
    expect(result.overallPnl).toBe(45)
  })

  it('does not value missing, invalid, or stale quotes', () => {
    expect(calculatePortfolioSummary([holding()], {}, { baseCurrency: 'INR' }).marketValue).toBeNull()
    expect(calculatePortfolioSummary([holding()], { TCS: quote('nope') }, { baseCurrency: 'INR', now: Date.parse('2026-10-20T10:05:00Z') }).marketValue).toBeNull()
    expect(isQuoteUsable(quote(50, { timestamp: '2026-10-18T10:00:00Z' }), holding(), { now: Date.parse('2026-10-20T10:00:00Z') })).toBe(false)
  })

  it('accepts Yahoo Unix-second quote timestamps as current values', () => {
    const unixSeconds = Math.floor(Date.parse('2026-10-20T10:00:00Z') / 1000)
    const result = calculatePortfolioSummary([holding()], { TCS: quote(50, { timestamp: unixSeconds }) }, { baseCurrency: 'INR', now: Date.parse('2026-10-20T10:05:00Z') })
    expect(isQuoteUsable(quote(50, { timestamp: unixSeconds }), holding(), { now: Date.parse('2026-10-20T10:05:00Z') })).toBe(true)
    expect(result.marketValue).toBe(250)
    expect(result.unrealizedPnl).toBe(35)
  })

  it('handles empty portfolios and incompatible currencies safely', () => {
    expect(calculatePortfolioSummary([], {}, { baseCurrency: 'INR' }).activeHoldings).toBe(0)
    const result = calculatePortfolioSummary([holding({ currency: 'USD' })], { TCS: quote(50, { currency: 'USD' }) }, { baseCurrency: 'INR', now: Date.parse('2026-10-20T10:05:00Z') })
    expect(result.marketValue).toBeNull()
    expect(result.investedCostBasis).toBeNull()
    expect(result.realizedPnl).toBeNull()
    expect(result.overallPnl).toBeNull()
    expect(result.rows[0].marketValue).toBe(250)
  })
})
