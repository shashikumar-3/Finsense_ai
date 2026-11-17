const crypto = require('crypto')
const { accountFifoTransactions } = require('./portfolioAccounting')

function safeText(value, limit = 300) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit)
}

function finite(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function csvCell(value) {
  const text = safeText(value, 1000)
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function toCsv(rows = [], columns = []) {
  const headers = columns.map((column) => column.label)
  const lines = [headers.map(csvCell).join(',')]
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column.key])).join(','))
  return `${lines.join('\r\n')}\r\n`
}

function formatReportText(report) {
  const lines = [`${report.title}`, `Generated: ${report.generatedAt}`, `As of: ${report.asOf || 'Unavailable'}`, '']
  for (const section of report.sections || []) {
    lines.push(section.title)
    for (const row of section.rows || []) lines.push(`${row.label}: ${row.value ?? 'Unavailable'}`)
    if (section.text) lines.push(section.text)
    lines.push('')
  }
  if (report.limitations?.length) lines.push('Limitations', ...report.limitations.map((item) => `- ${item}`))
  return lines.join('\n')
}

function escapePdfText(value) {
  // Helvetica in the built-in PDF core fonts is WinAnsi/ASCII oriented. Keep
  // exports readable and structurally valid when reports contain ₹ or other
  // Unicode text by replacing unsupported glyphs rather than emitting broken
  // byte sequences into a literal PDF string.
  return safeText(value, 120)
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

function wrapPdfLine(value, width = 92) {
  const text = String(value || '')
  if (!text) return ['']
  const words = text.split(/\s+/)
  const lines = []
  let current = ''
  for (const word of words) {
    if (!current) current = word.slice(0, width)
    else if ((current.length + word.length + 1) <= width) current += ` ${word}`
    else { lines.push(current); current = word.slice(0, width) }
  }
  if (current) lines.push(current)
  return lines
}

function buildSimplePdf(report) {
  const rawLines = formatReportText(report).split('\n')
  const textLines = rawLines.flatMap((line) => wrapPdfLine(line))
  const pages = []
  for (let index = 0; index < textLines.length; index += 46) pages.push(textLines.slice(index, index + 46))
  if (!pages.length) pages.push(['No report data available.'])

  // Object references are assigned once, after all page streams are known.
  // This avoids the invalid references produced by prepending objects after
  // calculating content/page numbers.
  const objects = []
  const addObject = (value) => { objects.push(value); return objects.length }
  const catalogRef = addObject(null)
  const pagesRef = addObject(null)
  const fontRef = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const pageRefs = []

  for (const pageLines of pages) {
    const commands = ['BT', '/F1 10 Tf', '48 760 Td']
    pageLines.forEach((line, lineIndex) => {
      if (lineIndex) commands.push('0 -15 Td')
      commands.push(`(${escapePdfText(line)}) Tj`)
    })
    commands.push('ET')
    const stream = commands.join('\n')
    const contentRef = addObject(`<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`)
    const pageRef = addObject(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRef} 0 R >> >> /Contents ${contentRef} 0 R >>`)
    pageRefs.push(pageRef)
  }

  objects[catalogRef - 1] = `<< /Type /Catalog /Pages ${pagesRef} 0 R >>`
  objects[pagesRef - 1] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'binary'))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf, 'binary')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')
  pdf += `\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalogRef} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'binary')
}

function buildPortfolioReport({ portfolio, holdings = [], transactions = [], quotes = {}, generatedAt = new Date().toISOString() }) {
  const currency = portfolio.base_currency || 'INR'
  let invested = 0
  let marketValue = 0
  let coverage = 0
  const holdingRows = holdings.map((holding) => {
    const quantity = finite(holding.quantity) || 0
    const averageCost = finite(holding.average_purchase_price)
    const price = finite(quotes[holding.symbol]?.price)
    const value = price === null ? null : quantity * price
    if (averageCost !== null) invested += quantity * averageCost
    if (value !== null) { marketValue += value; coverage += 1 }
    return { symbol: safeText(holding.symbol, 32), quantity, averageCost, currentPrice: price, marketValue: value, currency: safeText(holding.currency || currency, 8) }
  })
  const fees = transactions.reduce((sum, transaction) => sum + (finite(transaction.fees) || 0), 0)
  let fifo = null
  try { fifo = transactions.length ? accountFifoTransactions(transactions, quotes, { baseCurrency: currency }) : null } catch { fifo = null }
  return { type: 'portfolio', title: `${safeText(portfolio.name, 100) || 'Portfolio'} report`, generatedAt, asOf: Object.values(quotes).filter(Boolean).map((quote) => quote.timestamp).filter(Boolean).sort().at(-1) || null, portfolio: { id: portfolio.id, name: portfolio.name, currency }, summary: { invested: fifo?.remainingCostBasis ?? invested, marketValue: fifo?.currentMarketValue ?? (coverage ? marketValue : null), unrealized: fifo?.unrealizedPnl ?? (coverage ? marketValue - invested : null), realized: fifo?.realizedPnl ?? null, grossPnl: fifo?.grossPnl ?? null, estimatedTax: fifo?.tax?.estimatedTax ?? null, netRealizedPnl: fifo?.netRealizedPnl ?? null, accountingMethod: fifo ? 'FIFO' : 'database_projection', recordedFees: fifo?.recordedFees ?? fees, holdingsCovered: fifo?.quoteCoverage?.covered ?? coverage, holdingsTotal: fifo?.quoteCoverage?.total ?? holdingRows.length }, holdings: fifo?.rows || holdingRows, transactions: transactions.length, limitations: [coverage < holdingRows.length ? 'Some holdings did not have a usable current quote; market value and unrealized P/L are partial.' : 'Current values use available market quotes and are not guaranteed real-time.', 'Capital-gains tax uses configurable project estimates (STCG 20%, LTCG 12.5%) and is not tax advice.', 'Recorded fees exclude costs not present in the transaction ledger.'] }
}

function buildFinancialReport({ data, analysis, generatedAt = new Date().toISOString() }) {
  const goalRows = (analysis.goals || []).map((goal) => ({ label: goal.name, value: `${goal.status}; projected ${goal.projectedAmount}; target ${goal.targetAmount}` }))
  const alertRows = (analysis.alerts || []).map((alert) => ({ label: alert.title, value: alert.reason }))
  return { type: 'financial-future', title: 'Financial future report', generatedAt, asOf: generatedAt, summary: { currency: analysis.currency, monthlyIncome: analysis.cashFlow.income, monthlyExpenses: analysis.cashFlow.expenses, monthlySurplus: analysis.cashFlow.surplus, projectedNominal: analysis.projection.endingNominal, projectedReal: analysis.projection.endingReal, goalCount: analysis.goals.length }, profile: data.profile, goals: analysis.goals, alerts: analysis.alerts, projection: analysis.projection, sections: [{ title: 'Cash flow', rows: [{ label: 'Monthly income', value: analysis.cashFlow.income }, { label: 'Monthly expenses', value: analysis.cashFlow.expenses }, { label: 'Monthly surplus', value: analysis.cashFlow.surplus }] }, { title: 'Projection', rows: [{ label: 'Ending nominal wealth', value: analysis.projection.endingNominal }, { label: "Ending today's purchasing power", value: analysis.projection.endingReal }] }, ...(goalRows.length ? [{ title: 'Goals', rows: goalRows }] : []), ...(alertRows.length ? [{ title: 'Risk alerts', rows: alertRows }] : [])], limitations: [analysis.methodology.disclaimer, ...(analysis.methodology.limitations || []), 'Projection results depend on the entered assumptions and available planning records.'] }
}

function buildStockReport({ symbol, intelligence, generatedAt = new Date().toISOString() }) {
  const market = intelligence?.market || {}
  const news = intelligence?.news || {}
  const analysis = intelligence?.analysis || {}
  const structuredMarket = analysis.market_summary_structured || {}
  const structuredNews = analysis.news_summary_structured || {}
  const newsStatus = news.sentiment_status || news.status || (news.is_valid ? 'available' : 'unavailable')
  const sentiment = news.overall_sentiment || structuredNews.sentiment_breakdown?.find((item) => item.label === 'Overall Sentiment')?.value
  const score = finite(news.average_polarity)
  const fields = [
    ['Symbol', safeText(symbol, 32)],
    ['Company', intelligence?.company_name || market.company_name || 'Unavailable'],
    ['Sector', market.sector || 'Not available from current provider'],
    ['Industry', market.industry || 'Not available from current provider'],
    ['Price', finite(market.price)],
    ['Market cap', finite(market.market_cap)],
    ['Trend', market.trend || structuredMarket.trend_signals?.find((item) => item.label === 'Trend')?.value],
    ['Recommendation', analysis.recommendation || 'Unavailable'],
    ['News status', newsStatus],
    ['Overall sentiment', sentiment || 'Unavailable'],
    ['Sentiment score (-1 to +1)', score],
    ['Positive score', finite(news.positive_score)],
    ['Negative score', finite(news.negative_score)],
    ['Neutral score', finite(news.neutral_score)],
    ['Articles analyzed', finite(news.news_frequency_count)],
  ]
  const rows = fields.map(([label, value]) => ({ label, value: value === null || value === undefined || value === '' ? 'Unavailable' : value }))
  const headlines = (news.top_headlines || news.articles || []).slice(0, 10).map((article) => ({ label: article.headline || 'Headline', value: `${article.source || 'Unknown source'} · ${article.published_date || 'Date unavailable'}` }))
  const limitations = [
    'This report uses the normalized stock-intelligence response and its source timestamps.',
    newsStatus === 'historical' || news.historical_only ? 'News coverage is historical or cached and should not be treated as current.' : 'News freshness depends on the configured provider.',
    'Unavailable fields are not treated as zero and may require another provider.',
    'This report is informational and is not a guaranteed forecast or investment recommendation.',
  ]
  return { type: 'stock', title: `${safeText(symbol, 32)} stock analysis report`, generatedAt, asOf: intelligence?.updated_at || news.retrieved_at || generatedAt, symbol: safeText(symbol, 32), intelligence, summary: { symbol: safeText(symbol, 32), company: intelligence?.company_name || market.company_name || 'Unavailable', price: finite(market.price), sector: market.sector || 'Unavailable', industry: market.industry || 'Unavailable', sentiment: sentiment || 'Unavailable', sentimentScore: score, articleCount: finite(news.news_frequency_count) }, sections: [{ title: 'Stock overview', rows }, ...(headlines.length ? [{ title: 'News coverage', rows: headlines }] : [])], limitations }
}

function reportCsv(report) {
  if (report.type === 'portfolio') return toCsv(report.holdings, [{ key: 'symbol', label: 'Symbol' }, { key: 'quantity', label: 'Quantity' }, { key: 'averageCost', label: 'Average Cost' }, { key: 'currentPrice', label: 'Current Price' }, { key: 'marketValue', label: 'Market Value' }, { key: 'currency', label: 'Currency' }])
  if (report.type === 'financial-future') return toCsv(report.projection?.points || [], [{ key: 'year', label: 'Year' }, { key: 'nominal', label: 'Nominal Wealth' }, { key: 'real', label: 'Inflation Adjusted Wealth' }])
  return toCsv([{ symbol: report.symbol, recommendation: report.intelligence?.analysis?.recommendation || '', sentiment: report.intelligence?.news?.overall_sentiment || '', sentimentScore: report.intelligence?.news?.average_polarity ?? '', newsStatus: report.intelligence?.news?.sentiment_status || report.intelligence?.news?.status || '' }], [{ key: 'symbol', label: 'Symbol' }, { key: 'recommendation', label: 'Recommendation' }, { key: 'sentiment', label: 'Sentiment' }, { key: 'sentimentScore', label: 'Sentiment Score' }, { key: 'newsStatus', label: 'News Status' }])
}

function safeFilename(value) { return safeText(value, 60).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || `report-${crypto.randomUUID().slice(0, 8)}` }

module.exports = { buildPortfolioReport, buildFinancialReport, buildStockReport, reportCsv, buildSimplePdf, safeFilename, toCsv }
