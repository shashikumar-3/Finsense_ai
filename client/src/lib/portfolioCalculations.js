export const DEFAULT_MAX_QUOTE_AGE_MS = 24 * 60 * 60 * 1000

function finiteNumber(value) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizeCurrency(value) {
  return String(value || '').trim().toUpperCase()
}

function timestampMs(value) {
  if (typeof value === 'number' || /^\d+$/.test(String(value || '').trim())) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric
  }
  return new Date(value).getTime()
}

export function isQuoteUsable(quote, holding, { now = Date.now(), maxAgeMs = DEFAULT_MAX_QUOTE_AGE_MS } = {}) {
  const price = finiteNumber(quote?.price)
  const quoteCurrency = normalizeCurrency(quote?.currency)
  const holdingCurrency = normalizeCurrency(holding?.currency)
  if (price === null || price < 0 || (quoteCurrency && holdingCurrency && quoteCurrency !== holdingCurrency)) return false

  if (!quote?.timestamp) return false
  const timestamp = timestampMs(quote.timestamp)
  if (!Number.isFinite(timestamp)) return false
  return now - timestamp <= maxAgeMs
}

export function calculatePortfolioSummary(holdings = [], quotes = {}, options = {}) {
  const now = options.now ?? Date.now()
  const maxQuoteAgeMs = options.maxQuoteAgeMs ?? DEFAULT_MAX_QUOTE_AGE_MS
  const rows = []

  for (const holding of Array.isArray(holdings) ? holdings : []) {
    const quantity = finiteNumber(holding?.quantity)
    const averageCost = finiteNumber(holding?.average_purchase_price)
    const realizedPnl = finiteNumber(holding?.realized_pnl)
    const currency = normalizeCurrency(holding?.currency)
    const validPosition = quantity !== null && quantity >= 0 && averageCost !== null && averageCost >= 0
    const costBasis = validPosition ? quantity * averageCost : null
    const quote = quotes[holding?.symbol]
    const quoteUsable = quantity !== null && quantity > 0 && isQuoteUsable(quote, holding, { now, maxAgeMs: maxQuoteAgeMs })
    const currentPrice = quoteUsable ? finiteNumber(quote.price) : null
    const marketValue = currentPrice === null ? null : quantity * currentPrice
    const unrealizedPnl = marketValue === null || costBasis === null ? null : marketValue - costBasis
    const returnPercentage = unrealizedPnl === null || costBasis === null || costBasis <= 0 ? null : (unrealizedPnl / costBasis) * 100

    rows.push({
      ...holding,
      quantity,
      averageCost,
      realizedPnl,
      currency,
      costBasis,
      quote,
      quoteUsable,
      currentPrice,
      marketValue,
      unrealizedPnl,
      returnPercentage,
    })
  }

  const activeRows = rows.filter((row) => row.quantity !== null && row.quantity > 0)
  const currencies = [...new Set(rows.map((row) => row.currency).filter(Boolean))]
  const baseCurrency = normalizeCurrency(options.baseCurrency)
  const valuationCurrencies = [...new Set(activeRows.filter((row) => row.marketValue !== null).map((row) => row.currency).filter(Boolean))]
  const allActiveQuotesAvailable = activeRows.length > 0 && activeRows.every((row) => row.quoteUsable)
  const safelyComparable = currencies.length <= 1 && (!baseCurrency || currencies.every((currency) => currency === baseCurrency))
  const marketValue = allActiveQuotesAvailable && safelyComparable ? activeRows.reduce((sum, row) => sum + row.marketValue, 0) : null
  const investedCostBasis = safelyComparable ? activeRows.reduce((sum, row) => sum + (row.costBasis ?? 0), 0) : null
  const unrealizedPnl = marketValue === null || investedCostBasis === null ? null : marketValue - investedCostBasis
  const unrealizedReturnPercentage = unrealizedPnl === null || investedCostBasis <= 0 ? null : (unrealizedPnl / investedCostBasis) * 100
  const realizedPnl = safelyComparable ? rows.reduce((sum, row) => sum + (row.realizedPnl ?? 0), 0) : null
  const overallPnl = unrealizedPnl === null || realizedPnl === null ? null : realizedPnl + unrealizedPnl
  const allocation = marketValue === null ? [] : activeRows.filter((row) => row.marketValue !== null).map((row) => ({
    name: row.symbol,
    value: row.marketValue,
  }))

  return {
    rows,
    activeHoldings: activeRows.length,
    currencies,
    valuationCurrencies,
    allActiveQuotesAvailable,
    safelyComparable,
    marketValue,
    investedCostBasis,
    realizedPnl,
    unrealizedPnl,
    unrealizedReturnPercentage,
    overallPnl,
    allocation,
    baseCurrency,
  }
}
