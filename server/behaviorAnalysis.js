const DAY_MS = 24 * 60 * 60 * 1000

const DEFAULTS = Object.freeze({
  recurringMinimumBuys: 4,
  repeatedActivityMinimumTransactions: 4,
  elevatedActivityRatio: 1.5,
  feeRatioAttention: 0.005,
  shortHoldingDays: 30,
})

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function parseTimestamp(value) {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function average(values) {
  const valid = values.filter(Number.isFinite)
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null
}

function calculateConcentration(holdings = [], quotes = {}, baseCurrency = 'INR') {
  const rows = (Array.isArray(holdings) ? holdings : []).filter((holding) => Number(holding?.quantity) > 0).map((holding) => {
    const quote = quotes[String(holding.symbol || '').toUpperCase()]
    const price = Number(quote?.price)
    const quantity = Number(holding.quantity)
    const currency = String(quote?.currency || holding.currency || '').toUpperCase()
    return { symbol: String(holding.symbol || '').toUpperCase(), marketValue: Number.isFinite(price) && price > 0 && Number.isFinite(quantity) && currency === String(baseCurrency || '').toUpperCase() ? price * quantity : null }
  })
  const valued = rows.filter((row) => row.marketValue !== null)
  if (!valued.length) return { status: 'unavailable', largestHoldingWeight: null, hhi: null, coverage: { valued: 0, total: rows.length }, reason: 'No fresh compatible market quotes are available for active holdings.' }
  const total = valued.reduce((sum, row) => sum + row.marketValue, 0)
  const weights = valued.map((row) => ({ ...row, weight: total > 0 ? row.marketValue / total : 0 }))
  const largest = [...weights].sort((left, right) => right.weight - left.weight)[0]
  return { status: valued.length === rows.length ? 'available' : 'partial', largestHoldingWeight: largest?.weight ?? null, hhi: weights.reduce((sum, row) => sum + row.weight ** 2 * 10000, 0), coverage: { valued: valued.length, total: rows.length }, reason: valued.length === rows.length ? null : 'Some active holdings do not have fresh compatible market quotes and were excluded from the denominator.' }
}

function sortTransactions(transactions) {
  return [...transactions].sort((left, right) => {
    const executed = (left.executedAtMs ?? Infinity) - (right.executedAtMs ?? Infinity)
    if (executed !== 0) return executed
    const created = (left.createdAtMs ?? Infinity) - (right.createdAtMs ?? Infinity)
    if (created !== 0) return created
    return String(left.id || '').localeCompare(String(right.id || ''))
  })
}

function normalizeTransactions(rows) {
  const invalid = []
  const normalized = []
  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    const symbol = String(row?.symbol || '').trim().toUpperCase()
    const type = String(row?.transaction_type || '').trim().toUpperCase()
    const quantity = finiteNumber(row?.quantity)
    const unitPrice = finiteNumber(row?.unit_price)
    const fees = row?.fees === null || row?.fees === undefined || row?.fees === '' ? 0 : finiteNumber(row.fees)
    const executedAtMs = parseTimestamp(row?.executed_at)
    const createdAtMs = parseTimestamp(row?.created_at)
    const reasons = []
    if (!symbol) reasons.push('missing symbol')
    if (!['BUY', 'SELL'].includes(type)) reasons.push('invalid transaction type')
    if (quantity === null || quantity <= 0) reasons.push('invalid quantity')
    if (unitPrice === null || unitPrice <= 0) reasons.push('invalid unit price')
    if (fees === null || fees < 0) reasons.push('invalid fees')
    if (executedAtMs === null) reasons.push('invalid executed_at timestamp')
    if (reasons.length) {
      invalid.push({ index, id: row?.id || null, reasons })
      continue
    }
    normalized.push({
      id: row?.id || `row-${index}`,
      symbol,
      exchange: String(row?.exchange || '').trim().toUpperCase() || null,
      currency: String(row?.currency || '').trim().toUpperCase() || 'UNKNOWN',
      type,
      quantity,
      unitPrice,
      fees,
      executedAt: new Date(executedAtMs).toISOString(),
      executedAtMs,
      createdAtMs,
      buyNotional: type === 'BUY' ? quantity * unitPrice : 0,
      sellNotional: type === 'SELL' ? quantity * unitPrice : 0,
    })
  }
  return { transactions: sortTransactions(normalized), invalid }
}

function analyzeHoldingEpisodes(transactions, now, options) {
  const lots = new Map()
  const completed = []
  for (const transaction of transactions) {
    const key = `${transaction.symbol}:${transaction.currency}`
    const queue = lots.get(key) || []
    if (transaction.type === 'BUY') {
      queue.push({ quantity: transaction.quantity, boughtAt: transaction.executedAtMs })
    } else {
      let remaining = transaction.quantity
      while (remaining > 0 && queue.length) {
        const lot = queue[0]
        const matched = Math.min(remaining, lot.quantity)
        completed.push({
          symbol: transaction.symbol,
          currency: transaction.currency,
          days: Math.max(0, (transaction.executedAtMs - lot.boughtAt) / DAY_MS),
          quantity: matched,
        })
        remaining -= matched
        lot.quantity -= matched
        if (lot.quantity <= 1e-12) queue.shift()
      }
    }
    lots.set(key, queue)
  }

  const current = []
  for (const [key, queue] of lots.entries()) {
    if (!queue.length) continue
    const [symbol, currency] = key.split(':')
    const quantity = queue.reduce((sum, lot) => sum + lot.quantity, 0)
    const earliest = Math.min(...queue.map((lot) => lot.boughtAt))
    current.push({
      symbol,
      currency,
      quantity,
      estimatedAgeDays: Math.max(0, (now - earliest) / DAY_MS),
      methodology: 'Estimated from earliest unmatched BUY using chronological inventory matching; this is not a replacement for weighted-average accounting.',
    })
  }

  const shortEpisodes = completed.filter((episode) => episode.days < options.shortHoldingDays)
  return {
    status: transactions.length ? 'available' : 'insufficient_data',
    current,
    completed,
    summary: {
      completedCount: completed.length,
      averageCompletedDays: average(completed.map((episode) => episode.days)),
      medianCompletedDays: median(completed.map((episode) => episode.days)),
      shortCompletedCount: shortEpisodes.length,
    },
    warnings: transactions.length ? [] : ['Holding periods require valid transaction history.'],
  }
}

function buildInsights(metrics, options) {
  const generatedAt = new Date().toISOString()
  const insights = []
  const add = (insight) => insights.push({ generated_at: generatedAt, ...insight })

  if (!metrics.transactionCount) {
    add({ id: 'insufficient-history', category: 'data_quality', title: 'More transaction history is needed', summary: 'There are no valid recorded transactions in this portfolio, so behavioral patterns cannot be assessed.', severity: 'info', metrics: {}, period: metrics.period, evidence: [], confidence: 'low', data_quality: metrics.dataQuality, limitations: ['The ledger may be empty or historical activity may not have been imported.'], suggested_action: 'Add or review transaction history before drawing conclusions.' })
    return insights
  }

  if (metrics.repeatedPurchases.length) {
    const top = metrics.repeatedPurchases[0]
    add({ id: 'repeated-purchases', category: 'recurring_patterns', title: 'Repeated purchases were recorded', summary: `${top.symbol} was bought ${top.buyCount} times in the available ledger.`, severity: 'info', metrics: { symbol: top.symbol, buyCount: top.buyCount }, period: metrics.period, evidence: [`${top.buyCount} BUY transactions for ${top.symbol}`], confidence: top.buyCount >= 4 ? 'medium' : 'low', data_quality: metrics.dataQuality, limitations: ['Repeated purchases do not prove an automatic investment plan or a mistake.'], suggested_action: 'Review whether repeated purchases match your intended allocation process.' })
  }

  if (metrics.regularIntervals.length) {
    const pattern = metrics.regularIntervals[0]
    add({ id: 'approximately-regular-purchases', category: 'recurring_patterns', title: 'Purchases occurred at approximately regular intervals', summary: `${pattern.symbol} purchases had a median interval of ${pattern.medianIntervalDays.toFixed(1)} days.`, severity: 'info', metrics: pattern, period: metrics.period, evidence: [`${pattern.intervalCount} intervals; variability ratio ${pattern.variabilityRatio.toFixed(2)}`], confidence: 'medium', data_quality: metrics.dataQuality, limitations: ['Regular timing alone does not establish an automatic plan or investment suitability.'], suggested_action: 'Compare this timing with your documented investment plan and cash-flow schedule.' })
  }

  if (metrics.buySellCycles.length) {
    const cycle = metrics.buySellCycles[0]
    add({ id: 'repeated-buy-sell', category: 'trading_frequency', title: 'Repeated buy and sell activity was recorded', summary: `${cycle.symbol} has both repeated purchases and sales in the available history.`, severity: 'attention', metrics: cycle, period: metrics.period, evidence: [`${cycle.buyCount} buys and ${cycle.sellCount} sells for ${cycle.symbol}`], confidence: 'medium', data_quality: metrics.dataQuality, limitations: ['The records do not reveal the user’s rationale or whether the activity was intentional.'], suggested_action: 'Review the rationale and intended holding period for repeated buy/sell cycles.' })
  }

  if (metrics.frequencyChange && metrics.frequencyChange.elevated) {
    add({ id: 'activity-increased', category: 'investment_activity', title: 'Transaction activity increased', summary: 'The later half of the available transaction history contains materially more transactions than the earlier half.', severity: 'attention', metrics: metrics.frequencyChange, period: metrics.period, evidence: [`Earlier half: ${metrics.frequencyChange.earlierCount}; later half: ${metrics.frequencyChange.laterCount}`], confidence: 'medium', data_quality: metrics.dataQuality, limitations: ['The comparison is relative to this portfolio’s own recorded history and does not identify motivation.'], suggested_action: 'Compare the higher-activity period with your investment plan and risk limits.' })
  }

  for (const currency of metrics.currencyBreakdown) {
    if (currency.feeRatio !== null && currency.feeRatio >= options.feeRatioAttention) {
      add({ id: `fee-ratio-${currency.currency}`, category: 'recorded_fees', title: 'Recorded fees are material relative to recorded trading', summary: `Recorded fees are ${(currency.feeRatio * 100).toFixed(2)}% of recorded gross traded notional in ${currency.currency}.`, severity: 'attention', metrics: currency, period: metrics.period, evidence: [`Fees ${currency.totalFees.toFixed(2)} / gross notional ${currency.grossTradedNotional.toFixed(2)}`], confidence: 'medium', data_quality: metrics.dataQuality, limitations: ['This uses only fees stored in the ledger and is not a complete estimate of taxes, spread, slippage, or brokerage.'], suggested_action: 'Review whether all transaction costs are being recorded consistently.' })
    }
  }

  if (metrics.holdingPeriods.summary.shortCompletedCount > 0) {
    add({ id: 'short-holding-periods', category: 'holding_duration', title: 'Short completed holding episodes were recorded', summary: `${metrics.holdingPeriods.summary.shortCompletedCount} completed episode(s) lasted less than ${options.shortHoldingDays} days.`, severity: 'attention', metrics: metrics.holdingPeriods.summary, period: metrics.period, evidence: [`Completed episodes: ${metrics.holdingPeriods.summary.completedCount}`], confidence: 'medium', data_quality: metrics.dataQuality, limitations: ['Short duration does not prove a mistake and is estimated from chronological inventory matching.'], suggested_action: 'Review whether these holding durations matched the original investment horizon.' })
  }
  return insights
}

function analyzeBehavior(rows, holdings = [], inputOptions = {}) {
  const options = { ...DEFAULTS, ...inputOptions }
  const { transactions, invalid } = normalizeTransactions(rows)
  const now = finiteNumber(options.now) || Date.now()
  const symbols = new Map()
  const currencies = new Map()
  const activity = new Map()
  for (const transaction of transactions) {
    const symbol = symbols.get(transaction.symbol) || { symbol: transaction.symbol, buyCount: 0, sellCount: 0, transactionCount: 0, buyNotional: 0, sellNotional: 0 }
    symbol.transactionCount += 1
    if (transaction.type === 'BUY') { symbol.buyCount += 1; symbol.buyNotional += transaction.buyNotional } else { symbol.sellCount += 1; symbol.sellNotional += transaction.sellNotional }
    symbols.set(transaction.symbol, symbol)

    const currency = currencies.get(transaction.currency) || { currency: transaction.currency, buyNotional: 0, sellNotional: 0, totalFees: 0 }
    currency.buyNotional += transaction.buyNotional
    currency.sellNotional += transaction.sellNotional
    currency.totalFees += transaction.fees
    currencies.set(transaction.currency, currency)

    const month = transaction.executedAt.slice(0, 7)
    const period = activity.get(month) || { period: month, buyCount: 0, sellCount: 0, transactionCount: 0, grossNotional: 0 }
    period.transactionCount += 1
    period.grossNotional += transaction.buyNotional + transaction.sellNotional
    if (transaction.type === 'BUY') period.buyCount += 1
    else period.sellCount += 1
    activity.set(month, period)
  }

  const dates = transactions.map((transaction) => transaction.executedAtMs)
  const intervals = dates.slice(1).map((date, index) => (date - dates[index]) / DAY_MS).filter((value) => value >= 0)
  const symbolsList = [...symbols.values()].sort((left, right) => right.transactionCount - left.transactionCount || left.symbol.localeCompare(right.symbol))
  const repeatedPurchases = symbolsList.filter((item) => item.buyCount >= 2).sort((left, right) => right.buyCount - left.buyCount)
  const buySellCycles = symbolsList.filter((item) => item.buyCount >= 2 && item.sellCount >= 2)
  const regularIntervals = []
  for (const item of repeatedPurchases) {
    const buys = transactions.filter((transaction) => transaction.symbol === item.symbol && transaction.type === 'BUY').map((transaction) => transaction.executedAtMs)
    const buyIntervals = buys.slice(1).map((date, index) => (date - buys[index]) / DAY_MS).filter((value) => value > 0)
    if (buys.length >= options.recurringMinimumBuys && buyIntervals.length >= 3) {
      const center = median(buyIntervals)
      const variabilityRatio = center ? Math.sqrt(average(buyIntervals.map((value) => (value - center) ** 2))) / center : null
      if (variabilityRatio !== null && variabilityRatio <= 0.35) regularIntervals.push({ symbol: item.symbol, intervalCount: buyIntervals.length, medianIntervalDays: center, variabilityRatio })
    }
  }
  const first = dates[0]
  const last = dates[dates.length - 1]
  const midpoint = first !== undefined && last !== undefined ? first + (last - first) / 2 : null
  const earlierCount = midpoint === null ? 0 : transactions.filter((transaction) => transaction.executedAtMs <= midpoint).length
  const laterCount = midpoint === null ? 0 : transactions.filter((transaction) => transaction.executedAtMs > midpoint).length
  const frequencyChange = transactions.length >= 4 ? { earlierCount, laterCount, ratio: earlierCount ? laterCount / earlierCount : null, elevated: earlierCount > 0 && laterCount / earlierCount >= options.elevatedActivityRatio } : null
  const currencyBreakdown = [...currencies.values()].map((item) => ({ ...item, grossTradedNotional: item.buyNotional + item.sellNotional, feeRatio: item.buyNotional + item.sellNotional > 0 ? item.totalFees / (item.buyNotional + item.sellNotional) : null }))
  const holdingPeriods = analyzeHoldingEpisodes(transactions, now, options)
  const period = { start: first ? new Date(first).toISOString() : null, end: last ? new Date(last).toISOString() : null, completeLedgerAssumed: invalid.length === 0 }
  const dataQuality = { status: invalid.length || !transactions.length ? (transactions.length ? 'partial' : 'unavailable') : 'available', validTransactionCount: transactions.length, invalidTransactionCount: invalid.length, currencies: currencyBreakdown.map((item) => item.currency), warnings: invalid.length ? [`${invalid.length} transaction record(s) were excluded because required fields were invalid.`] : [], coverage: period }
  const metrics = {
    transactionCount: transactions.length,
    buyCount: transactions.filter((transaction) => transaction.type === 'BUY').length,
    sellCount: transactions.filter((transaction) => transaction.type === 'SELL').length,
    grossPurchaseNotional: currencyBreakdown.length === 1 ? currencyBreakdown[0].buyNotional : null,
    grossSaleNotional: currencyBreakdown.length === 1 ? currencyBreakdown[0].sellNotional : null,
    totalRecordedFees: currencyBreakdown.length === 1 ? currencyBreakdown[0].totalFees : null,
    currencyBreakdown,
    firstTransactionAt: period.start,
    latestTransactionAt: period.end,
    averageIntervalDays: average(intervals),
    activityByMonth: [...activity.values()].sort((left, right) => left.period.localeCompare(right.period)),
    bySymbol: symbolsList,
    repeatedPurchases,
    regularIntervals,
    buySellCycles,
    frequencyChange,
    holdingPeriods,
    concentration: calculateConcentration(holdings, options.currentQuotes, options.baseCurrency || holdings?.[0]?.currency || 'INR'),
    holdingsProvided: Array.isArray(holdings) && holdings.length > 0,
    dataQuality,
    period,
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    period,
    metrics,
    patterns: { repeatedPurchases, regularIntervals, buySellCycles, frequencyChange },
    findings: buildInsights(metrics, options),
    dataQuality,
    methodology: {
      transactionOrdering: ['executed_at', 'created_at', 'id'],
      purchaseNotional: 'quantity × unit_price for BUY records',
      saleNotional: 'quantity × unit_price for SELL records',
      fees: 'sum of recorded fees only; taxes, spread, slippage, and unrecorded brokerage are excluded',
      recurringIntervals: `At least ${options.recurringMinimumBuys} purchases and 3 positive intervals with interval variability ratio ≤ 0.35`,
      holdingPeriods: 'Chronological FIFO matching is used only to estimate episode duration; it does not replace the database weighted-average cost ledger.',
      concentration: 'Uses active holding quantity multiplied by a fresh compatible market quote; transaction prices are never substituted for current quotes.',
      currency: 'Notional and fees are grouped by currency; combined totals are null when multiple currencies are present.',
    },
    limitations: ['Behavioral findings describe recorded activity and do not prove mistakes, intent, skill, or causation.'],
  }
}

module.exports = {
  DEFAULTS,
  analyzeBehavior,
  normalizeTransactions,
  sortTransactions,
  calculateConcentration,
}
