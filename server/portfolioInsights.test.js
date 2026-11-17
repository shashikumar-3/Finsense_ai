const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildPortfolioInsightCacheKey,
  buildPortfolioInsightQuery,
  buildDeterministicPortfolioInsight,
  sanitizeAiText,
  validatePortfolioInsightPayload,
} = require('./portfolioInsights')

test('projects only authorized symbols and finite portfolio facts', () => {
  const facts = validatePortfolioInsightPayload({
    summary: { activeHoldings: 1, marketValue: '100', overallPnl: 'not-a-number' },
    analysis: {
      stockAllocations: [{ symbol: 'A', percentage: 100, marketValue: 100 }, { symbol: 'B', percentage: 0 }],
      stockWarnings: [{ symbol: 'A', percentage: 25, reason: '<script>' }],
      hhi: 10000,
    },
    risk: { status: 'valid', portfolio: { volatility: 0.2, maximumDrawdown: -0.1 } },
  }, [{ symbol: 'A', quantity: 1, currency: 'INR', average_purchase_price: 100, realized_pnl: 0 }], { name: 'Test', base_currency: 'INR' })
  assert.equal(facts.computed.marketValue, 100)
  assert.equal(facts.computed.overallPnl, null)
  assert.deepEqual(facts.computed.stockAllocations.map((row) => row.symbol), ['A'])
  assert.equal(facts.computed.stockWarnings[0].reason, '<script>')
})

test('sanitizes generated text and keeps cache keys isolated by user and portfolio', () => {
  assert.equal(sanitizeAiText('hello <b>world</b>'), 'hello bworld/b')
  assert.notEqual(buildPortfolioInsightCacheKey('user-a', 'portfolio-a', { value: 1 }), buildPortfolioInsightCacheKey('user-b', 'portfolio-a', { value: 1 }))
  assert.notEqual(buildPortfolioInsightCacheKey('user-a', 'portfolio-a', { value: 1 }), buildPortfolioInsightCacheKey('user-a', 'portfolio-b', { value: 1 }))
  assert.match(buildPortfolioInsightQuery(), /Do not invent prices/)
})

test('builds a grounded deterministic portfolio explanation when AI is unavailable', () => {
  const answer = buildDeterministicPortfolioInsight({
    portfolio: { name: 'Long term', baseCurrency: 'INR' },
    computed: {
      activeHoldings: 2,
      marketValue: 1000,
      overallPnl: 25,
      stockAllocations: [{ symbol: 'TCS', percentage: 70 }],
      sectorAllocations: [{ name: 'Technology', percentage: 70 }],
      sectorCoverage: { known: 1, total: 2 },
    },
    risk: { portfolio: { status: 'valid', volatility: 0.2, maximumDrawdown: -0.1, observations: 30 } },
  })
  assert.match(answer, /TCS is the largest valued holding at 70%/)
  assert.match(answer, /Technology 70%/)
  assert.match(answer, /deterministic explanation/)
})
