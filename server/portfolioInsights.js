const crypto = require('crypto')

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function safeText(value, limit = 240) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, limit)
}

function projectMetric(value) {
  const number = finiteNumber(value)
  return number === null ? null : number
}

function projectRows(rows, authorizedSymbols) {
  if (!Array.isArray(rows)) return []
  return rows.slice(0, 100).flatMap((row) => {
    const symbol = safeText(row?.symbol, 32).toUpperCase()
    if (!authorizedSymbols.has(symbol)) return []
    return [{
      symbol,
      percentage: projectMetric(row?.percentage),
      marketValue: projectMetric(row?.marketValue),
      sector: safeText(row?.name || row?.sector, 80),
      reason: safeText(row?.reason, 240),
    }]
  })
}

function validatePortfolioInsightPayload(body = {}, holdings = [], portfolio = {}) {
  const authorizedSymbols = new Set(holdings.map((row) => safeText(row?.symbol, 32).toUpperCase()).filter(Boolean))
  const analysis = body.analysis && typeof body.analysis === 'object' ? body.analysis : {}
  const risk = body.risk && typeof body.risk === 'object' ? body.risk : {}
  const summary = body.summary && typeof body.summary === 'object' ? body.summary : {}
  const ledger = holdings.map((row) => ({
    symbol: safeText(row.symbol, 32).toUpperCase(),
    currency: safeText(row.currency, 12).toUpperCase(),
    quantity: projectMetric(row.quantity),
    averageCost: projectMetric(row.average_purchase_price),
    realizedPnl: projectMetric(row.realized_pnl),
  }))
  return {
    portfolio: {
      name: safeText(portfolio.name, 120),
      baseCurrency: safeText(portfolio.base_currency, 12).toUpperCase(),
    },
    ledger,
    computed: {
      activeHoldings: projectMetric(summary.activeHoldings),
      marketValue: projectMetric(summary.marketValue),
      investedCostBasis: projectMetric(summary.investedCostBasis),
      realizedPnl: projectMetric(summary.realizedPnl),
      unrealizedPnl: projectMetric(summary.unrealizedPnl),
      overallPnl: projectMetric(summary.overallPnl),
      stockAllocations: projectRows(analysis.stockAllocations, authorizedSymbols),
      sectorAllocations: Array.isArray(analysis.sectorAllocations) ? analysis.sectorAllocations.slice(0, 100).map((row) => ({
        name: safeText(row?.name, 80),
        percentage: projectMetric(row?.percentage),
        marketValue: projectMetric(row?.marketValue),
      })) : [],
      stockWarnings: projectRows(analysis.stockWarnings, authorizedSymbols),
      sectorWarnings: Array.isArray(analysis.sectorWarnings) ? analysis.sectorWarnings.slice(0, 100).map((row) => ({ name: safeText(row?.name, 80), percentage: projectMetric(row?.percentage), threshold: projectMetric(row?.threshold), reason: safeText(row?.reason, 240) })) : [],
      hhi: projectMetric(analysis.hhi),
      valuationAvailable: analysis.available === true,
      sectorCoverage: analysis.sectorCoverage && typeof analysis.sectorCoverage === 'object' ? {
        known: projectMetric(analysis.sectorCoverage.known),
        total: projectMetric(analysis.sectorCoverage.total),
        complete: analysis.sectorCoverage.complete === true,
      } : null,
    },
    risk: {
      status: safeText(risk.status, 32),
      methodology: safeText(risk.methodology, 400),
      annualizationFactor: projectMetric(risk.annualizationFactor),
      portfolio: risk.portfolio && typeof risk.portfolio === 'object' ? {
        status: safeText(risk.portfolio.status, 32),
        volatility: projectMetric(risk.portfolio.volatility),
        maximumDrawdown: projectMetric(risk.portfolio.maximumDrawdown),
        cumulativeReturn: projectMetric(risk.portfolio.cumulativeReturn),
        observations: projectMetric(risk.portfolio.observations),
        startDate: safeText(risk.portfolio.startDate, 32),
        endDate: safeText(risk.portfolio.endDate, 32),
      } : null,
    },
  }
}

function sanitizeAiText(value) {
  return safeText(value, 6000).replace(/[<>]/g, '')
}

function formatFact(value) {
  if (value === null || value === undefined || value === '') return 'unavailable'
  const number = Number(value)
  return Number.isFinite(number) ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(number) : safeText(String(value), 120)
}

function buildPortfolioInsightQuery() {
  return 'Explain this portfolio using only the verified ledger facts and computed analysis supplied below. Clearly distinguish facts, computed findings, unavailable data, and interpretation. Discuss concentration, diversification, and historical risk only when the supplied values are available. Do not invent prices, news, fundamentals, forecasts, citations, or buy/sell instructions. Use plain text in three short paragraphs.'
}

function buildDeterministicPortfolioInsight(facts = {}) {
  const computed = facts.computed || {}
  const allocations = Array.isArray(computed.stockAllocations) ? computed.stockAllocations.filter((item) => item.percentage !== null) : []
  const sectors = Array.isArray(computed.sectorAllocations) ? computed.sectorAllocations.filter((item) => item.percentage !== null) : []
  const largest = [...allocations].sort((a, b) => Number(b.percentage) - Number(a.percentage))[0]
  const coverage = computed.sectorCoverage
  const risk = facts.risk?.portfolio
  const lines = [
    `Portfolio: ${facts.portfolio?.name || 'Selected portfolio'} (${facts.portfolio?.baseCurrency || 'base currency unavailable'}).`,
    `Verified holdings: ${formatFact(computed.activeHoldings)}; market value: ${formatFact(computed.marketValue)}; overall P&L: ${formatFact(computed.overallPnl)}.`,
    largest ? `Concentration: ${largest.symbol} is the largest valued holding at ${formatFact(largest.percentage)}%.` : 'Concentration: unavailable because compatible holding values were not supplied.',
    sectors.length ? `Sector coverage: ${sectors.map((item) => `${item.name} ${formatFact(item.percentage)}%`).join(', ')}.` : `Sector coverage: unavailable${coverage ? ` (${formatFact(coverage.known)}/${formatFact(coverage.total)} classified)` : ''}.`,
    risk?.status === 'valid' ? `Historical risk: annualized volatility ${formatFact(risk.volatility)}, maximum drawdown ${formatFact(risk.maximumDrawdown)}, based on ${formatFact(risk.observations)} observations.` : 'Historical risk: unavailable or insufficient observations.',
    'This is a deterministic explanation of verified portfolio data. It is not a forecast or a buy/sell instruction.',
  ]
  return lines.join('\n\n')
}

function buildPortfolioInsightCacheKey(userId, portfolioId, facts) {
  const digest = crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex')
  return `${userId}:${portfolioId}:${digest}`
}

module.exports = {
  buildPortfolioInsightCacheKey,
  buildPortfolioInsightQuery,
  buildDeterministicPortfolioInsight,
  sanitizeAiText,
  validatePortfolioInsightPayload,
}
