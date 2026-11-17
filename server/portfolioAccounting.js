const DEFAULT_TAX_RULES = Object.freeze({
  stcgRate: 0.20,
  ltcgRate: 0.125,
  longTermDays: 365,
  status: 'configurable_estimate',
  effectiveDate: null,
})

function finite(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function timestamp(value) {
  const parsed = new Date(value || '').getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function orderTransactions(transactions = []) {
  return transactions
    .map((transaction, sourceIndex) => ({ transaction, sourceIndex, executedAt: timestamp(transaction.executed_at), createdAt: timestamp(transaction.created_at) }))
    .sort((a, b) => (a.executedAt ?? Number.MAX_SAFE_INTEGER) - (b.executedAt ?? Number.MAX_SAFE_INTEGER)
      || (a.createdAt ?? Number.MAX_SAFE_INTEGER) - (b.createdAt ?? Number.MAX_SAFE_INTEGER)
      || String(a.transaction.id || '').localeCompare(String(b.transaction.id || ''))
      || a.sourceIndex - b.sourceIndex)
}

function groupKey(transaction) {
  return [transaction.symbol, transaction.exchange, transaction.currency].map((value) => String(value || '').trim().toUpperCase()).join('|')
}

function validateTransaction(transaction) {
  const quantity = finite(transaction.quantity)
  const unitPrice = finite(transaction.unit_price)
  if (!['BUY', 'SELL'].includes(transaction.transaction_type)) throw new Error('Transaction type must be BUY or SELL.')
  if (quantity === null || quantity <= 0 || unitPrice === null || unitPrice <= 0) throw new Error('Transaction quantity and price must be positive finite numbers.')
  const executedAt = timestamp(transaction.executed_at)
  if (executedAt === null) throw new Error('Transaction timestamp is invalid.')
  return { quantity, unitPrice, executedAt, fees: Math.max(finite(transaction.fees) || 0, 0) }
}

function calculateTax(matches, rules = {}) {
  const config = { ...DEFAULT_TAX_RULES, ...rules }
  let stcg = 0
  let ltcg = 0
  for (const match of matches) {
    if (match.gain <= 0) continue
    if (match.holdingDays >= config.longTermDays) ltcg += match.gain
    else stcg += match.gain
  }
  const estimatedStcgTax = stcg * config.stcgRate
  const estimatedLtcgTax = ltcg * config.ltcgRate
  return {
    rules: config,
    stcgGains: stcg,
    ltcgGains: ltcg,
    estimatedStcgTax,
    estimatedLtcgTax,
    estimatedTax: estimatedStcgTax + estimatedLtcgTax,
  }
}

function accountFifoTransactions(transactions = [], quotes = {}, options = {}) {
  if (!Array.isArray(transactions)) throw new Error('Transactions must be an array.')
  const lots = new Map()
  const matches = []
  const errors = []
  let investedCapital = 0
  let recordedFees = 0

  for (const { transaction } of orderTransactions(transactions)) {
    const input = validateTransaction(transaction)
    const key = groupKey(transaction)
    const queue = lots.get(key) || []
    const feesPerUnit = input.fees / input.quantity
    recordedFees += input.fees
    if (transaction.transaction_type === 'BUY') {
      investedCapital += input.quantity * input.unitPrice + input.fees
      queue.push({ quantity: input.quantity, unitPrice: input.unitPrice, costPerUnit: input.unitPrice + feesPerUnit, executedAt: input.executedAt, symbol: transaction.symbol, currency: transaction.currency })
      lots.set(key, queue)
      continue
    }

    let remaining = input.quantity
    let proceeds = 0
    while (remaining > 0 && queue.length) {
      const lot = queue[0]
      const matchedQuantity = Math.min(remaining, lot.quantity)
      const holdingDays = Math.max(0, Math.floor((input.executedAt - lot.executedAt) / 86400000))
      const matchedCost = matchedQuantity * lot.costPerUnit
      const matchedProceeds = matchedQuantity * input.unitPrice - matchedQuantity * feesPerUnit
      const gain = matchedProceeds - matchedCost
      matches.push({ symbol: transaction.symbol, currency: transaction.currency, quantity: matchedQuantity, acquisitionDate: new Date(lot.executedAt).toISOString(), saleDate: new Date(input.executedAt).toISOString(), holdingDays, matchedCost, proceeds: matchedProceeds, gain })
      proceeds += matchedProceeds
      lot.quantity -= matchedQuantity
      remaining -= matchedQuantity
      if (lot.quantity <= 1e-12) queue.shift()
    }
    if (remaining > 1e-12) {
      const error = new Error(`Sale exceeds available FIFO quantity for ${transaction.symbol}.`)
      error.code = 'INSUFFICIENT_QUANTITY'
      throw error
    }
    investedCapital += 0
    lots.set(key, queue)
    void proceeds
  }

  const tax = calculateTax(matches, options.taxRules)
  const rows = []
  let currentMarketValue = 0
  let remainingCostBasis = 0
  let quoteCoverage = 0
  const baseCurrency = String(options.baseCurrency || '').toUpperCase()
  for (const [key, queue] of lots.entries()) {
    const [symbol, exchange, currency] = key.split('|')
    const quantity = queue.reduce((sum, lot) => sum + lot.quantity, 0)
    const costBasis = queue.reduce((sum, lot) => sum + lot.quantity * lot.costPerUnit, 0)
    const realizedForSymbol = matches
      .filter((match) => groupKey(match) === key)
      .reduce((sum, match) => sum + match.gain, 0)
    remainingCostBasis += costBasis
    const quote = quotes[symbol]
    const price = finite(quote?.price)
    const quoteCurrency = String(quote?.currency || currency).toUpperCase()
    const comparable = !baseCurrency || currency === baseCurrency
    const marketValue = price !== null && price >= 0 && quoteCurrency === currency && comparable ? quantity * price : null
    if (marketValue !== null) { currentMarketValue += marketValue; quoteCoverage += 1 }
    rows.push({ symbol, exchange, currency, quantity, remainingCostBasis: costBasis, average_purchase_price: quantity > 0 ? costBasis / quantity : 0, realized_pnl: realizedForSymbol, currentPrice: marketValue === null ? null : price, marketValue, unrealizedPnl: marketValue === null ? null : marketValue - costBasis, quoteTimestamp: quote?.timestamp || null })
  }
  const realizedPnl = matches.reduce((sum, match) => sum + match.gain, 0)
  const allQuotesAvailable = rows.length === 0 || quoteCoverage === rows.length
  return {
    method: 'FIFO',
    rows,
    matches,
    investedCapital,
    remainingCostBasis,
    currentMarketValue: allQuotesAvailable ? currentMarketValue : null,
    realizedPnl,
    unrealizedPnl: allQuotesAvailable ? currentMarketValue - remainingCostBasis : null,
    grossPnl: allQuotesAvailable ? realizedPnl + currentMarketValue - remainingCostBasis : null,
    recordedFees,
    quoteCoverage: { covered: quoteCoverage, total: rows.length, complete: allQuotesAvailable },
    tax,
    netRealizedPnl: realizedPnl - tax.estimatedTax,
    errors,
  }
}

module.exports = { DEFAULT_TAX_RULES, orderTransactions, calculateTax, accountFifoTransactions }
