const test = require('node:test')
const assert = require('node:assert/strict')
const { buildPortfolioReport, buildSimplePdf, buildStockReport, reportCsv } = require('./reporting')

test('portfolio report preserves partial quote coverage and recorded fees', () => {
  const report = buildPortfolioReport({ portfolio: { id: 'p', name: 'Test', base_currency: 'INR' }, holdings: [{ symbol: 'TCS', quantity: 2, average_purchase_price: 100 }, { symbol: 'INFY', quantity: 1, average_purchase_price: 200 }], transactions: [{ fees: 3 }], quotes: { TCS: { price: 150, timestamp: '2026-01-01' }, INFY: null } })
  assert.equal(report.summary.marketValue, 300)
  assert.equal(report.summary.recordedFees, 3)
  assert.equal(report.summary.holdingsCovered, 1)
  assert.ok(report.limitations[0].includes('partial'))
})

test('CSV escapes formula-like and comma-containing values', () => {
  const report = buildPortfolioReport({ portfolio: { name: 'Test', base_currency: 'INR' }, holdings: [{ symbol: '=IMPORT()', quantity: 1, average_purchase_price: 1, currency: 'INR' }], quotes: {} })
  const csv = reportCsv(report)
  assert.match(csv, /'=IMPORT\(\)/)
})

test('PDF export has a valid PDF header', () => {
  const pdf = buildSimplePdf({ title: 'Test', generatedAt: '2026-01-01', sections: [{ title: 'Summary', rows: [{ label: 'Value', value: 10 }] }] })
  assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.4')
})

test('stock report preserves normalized news sentiment and coverage fields', () => {
  const report = buildStockReport({ symbol: 'TCS', intelligence: { company_name: 'TCS', updated_at: '2026-11-05T00:00:00Z', market: { price: 2500, sector: 'Technology' }, news: { overall_sentiment: 'Positive', sentiment_status: 'available', average_polarity: 0.42, positive_score: 0.6, negative_score: 0.1, neutral_score: 0.3, news_frequency_count: 4, top_headlines: [{ headline: 'Results', source: 'Example', published_date: '2026-11-04T00:00:00Z' }] }, analysis: { recommendation: 'Mixed setup' } } })
  assert.equal(report.summary.sentiment, 'Positive')
  assert.equal(report.summary.sentimentScore, 0.42)
  assert.ok(report.sections.some((section) => section.title === 'News coverage'))
  assert.ok(report.sections[0].rows.some((row) => row.label === 'Articles analyzed' && row.value === 4))
})
