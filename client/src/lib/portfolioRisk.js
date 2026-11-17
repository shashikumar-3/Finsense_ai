const DEFAULT_ANNUALIZATION_FACTOR = 252
const DEFAULT_MIN_OBSERVATIONS = 30

function finitePositive(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function dateKey(value) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null
}

/**
 * Normalises daily close observations. The existing chart endpoint supplies
 * unadjusted closes, so all risk results are explicitly close-to-close
 * estimates and must not be described as split-adjusted performance.
 */
export function normalizeRiskSeries(points = []) {
  const byDate = new Map()
  points.forEach((point) => {
    const date = dateKey(point?.datetime || point?.date || point?.timestamp)
    const price = finitePositive(point?.adjustedClose ?? point?.close)
    if (date && price !== null) byDate.set(date, { date, price })
  })
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function returnsForSeries(series) {
  const returns = []
  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1].price
    const current = series[index].price
    const value = current / previous - 1
    if (Number.isFinite(value) && value > -1) {
      returns.push({ date: series[index].date, value })
    }
  }
  return returns
}

function sampleStdDev(values) {
  if (values.length < 2) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Number.isFinite(variance) && variance >= 0 ? Math.sqrt(variance) : null
}

export function calculateSeriesRisk(points, {
  annualizationFactor = DEFAULT_ANNUALIZATION_FACTOR,
  minObservations = DEFAULT_MIN_OBSERVATIONS,
  asOf = null,
  maxHistoryAgeDays = 7,
} = {}) {
  const series = normalizeRiskSeries(points)
  const observations = returnsForSeries(series)
  const prices = series.map((item) => item.price)
  const result = {
    status: 'insufficient',
    observations: observations.length,
    startDate: series[0]?.date || null,
    endDate: series.at(-1)?.date || null,
    annualizationFactor,
    volatility: null,
    maximumDrawdown: null,
    cumulativeReturn: null,
    downsideDeviation: null,
    reason: null,
  }

  if (asOf && result.endDate) {
    const ageDays = (new Date(asOf).getTime() - new Date(`${result.endDate}T23:59:59Z`).getTime()) / (24 * 60 * 60 * 1000)
    if (!Number.isFinite(ageDays) || ageDays > maxHistoryAgeDays) {
      result.status = 'partial'
      result.reason = 'The latest historical observation is stale for the configured data-quality window.'
      return result
    }
  }

  if (observations.length < minObservations) {
    result.reason = `At least ${minObservations} valid daily returns are required.`
    return result
  }

  const values = observations.map((item) => item.value)
  const standardDeviation = sampleStdDev(values)
  let peak = prices[0]
  let maximumDrawdown = 0
  prices.forEach((price) => {
    peak = Math.max(peak, price)
    maximumDrawdown = Math.min(maximumDrawdown, price / peak - 1)
  })
  // Downside deviation is the square root of mean squared negative returns,
  // with non-negative returns contributing zero, annualized by √252.
  const downsideDeviation = Math.sqrt(values.reduce((sum, value) => sum + Math.min(value, 0) ** 2, 0) / values.length)

  result.status = 'valid'
  result.volatility = standardDeviation === null ? null : standardDeviation * Math.sqrt(annualizationFactor)
  result.maximumDrawdown = Number.isFinite(maximumDrawdown) ? maximumDrawdown : null
  result.cumulativeReturn = prices.length > 1 ? prices.at(-1) / prices[0] - 1 : null
  result.downsideDeviation = Number.isFinite(downsideDeviation) ? downsideDeviation * Math.sqrt(annualizationFactor) : null
  if (result.volatility === null || result.maximumDrawdown === null) {
    result.status = 'partial'
    result.reason = 'One or more historical risk metrics could not be calculated.'
  }
  return result
}

function comparableCurrency(holding, baseCurrency) {
  const currency = String(holding?.currency || '').toUpperCase()
  const base = String(baseCurrency || '').toUpperCase()
  return Boolean(currency && base && currency === base)
}

/**
 * Calculates a current-weight holdings-based proxy. It deliberately does not
 * claim to be account history: historical transaction timing and historical
 * weights are not reconstructed by the current portfolio schema/UI.
 */
export function calculatePortfolioRisk({ holdings = [], summary, historicalSeriesBySymbol = {}, baseCurrency = 'INR' } = {}, options = {}) {
  const activeRows = (summary?.rows || holdings)
    .filter((row) => Number(row?.quantity) > 0)
    .map((row) => ({ ...row, quantity: Number(row.quantity) }))
  const result = {
    status: 'unavailable',
    methodology: 'Current holdings-weighted historical proxy using daily close-to-close returns; historical transaction weights are not reconstructed.',
    annualizationFactor: options.annualizationFactor || DEFAULT_ANNUALIZATION_FACTOR,
    minimumObservations: options.minObservations || DEFAULT_MIN_OBSERVATIONS,
    assetRisk: [],
    portfolio: null,
    reasons: [],
  }
  if (!activeRows.length) {
    result.status = 'empty'
    result.reasons.push('There are no active holdings.')
    return result
  }
  if (!activeRows.every((row) => comparableCurrency(row, baseCurrency))) {
    result.reasons.push('Risk aggregation is unavailable because holdings are not all in the portfolio base currency.')
    return result
  }
  if (!summary?.safelyComparable || !Number.isFinite(summary?.marketValue) || summary.marketValue <= 0) {
    result.reasons.push('A complete compatible current valuation is required for portfolio weighting.')
    return result
  }

  const weightedSeries = []
  activeRows.forEach((row) => {
    const symbol = row.symbol
    const asset = calculateSeriesRisk(historicalSeriesBySymbol[symbol], options)
    const weight = Number.isFinite(row.marketValue) ? row.marketValue / summary.marketValue : null
    result.assetRisk.push({ symbol, weight, ...asset })
    if (asset.status === 'valid' && Number.isFinite(weight) && weight >= 0) {
      weightedSeries.push({ symbol, weight, series: normalizeRiskSeries(historicalSeriesBySymbol[symbol]) })
    } else {
      result.reasons.push(`${symbol} does not have sufficient valid historical data.`)
    }
  })

  if (weightedSeries.length !== activeRows.length) {
    result.status = 'partial'
    return result
  }
  const commonDates = weightedSeries.reduce((dates, item) => {
    const current = new Set(item.series.map((point) => point.date))
    return dates ? new Set([...dates].filter((date) => current.has(date))) : current
  }, null)
  const portfolioPoints = [...(commonDates || [])].sort().map((date) => ({
    date,
    close: weightedSeries.reduce((total, item) => total + item.weight * item.series.find((point) => point.date === date).price, 0),
  }))
  result.portfolio = calculateSeriesRisk(portfolioPoints, options)
  result.status = result.portfolio.status === 'valid' ? 'valid' : 'partial'
  return result
}

export const PORTFOLIO_RISK_DEFAULTS = {
  annualizationFactor: DEFAULT_ANNUALIZATION_FACTOR,
  minObservations: DEFAULT_MIN_OBSERVATIONS,
}
