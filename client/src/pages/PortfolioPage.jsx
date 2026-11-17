import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Clock3, Pencil, Plus, RefreshCw, Trash2, Wallet, X } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import SectionCard from '../components/SectionCard'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { fetchNseStocks, fetchStockChart } from '../api/stocksApi'
import { fetchStockIntelligence } from '../api/intelligenceApi'
import { fetchPortfolioInsights } from '../api/portfolioInsightsApi'
import { fetchPortfolioAccounting, savePortfolioTransaction } from '../api/portfolioApi'
import { calculatePortfolioSummary } from '../lib/portfolioCalculations'
import { buildPortfolioAnalysis } from '../lib/portfolioAnalysis'
import { calculatePortfolioRisk } from '../lib/portfolioRisk'
import { usePreferences } from '../lib/preferences'
import { AllocationChart } from '../components/Charts'

const emptyTransaction = {
  symbol: '',
  exchange: 'NSE',
  currency: 'INR',
  transaction_type: 'BUY',
  quantity: '',
  executed_at: '',
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function toDateTimeInput(value) {
  if (!value) return ''
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function cleanError(error, fallback) {
  const message = error?.message || ''
  if (/oversold/i.test(message)) return 'That sale exceeds the available holding.'
  if (/row-level security|permission denied/i.test(message)) {
    return 'You do not have permission to change this portfolio.'
  }
  if (/duplicate key/i.test(message)) return 'This portfolio position already exists.'
  return message || fallback
}

const allocationColors = ['#5eead4', '#60a5fa', '#fbbf24', '#fb7185', '#a78bfa', '#f97316']

function formatMoney(value, currency = 'INR', { dash = '—' } = {}) {
  if (!Number.isFinite(value)) return dash
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}

function formatPercent(value, { dash = '—' } = {}) {
  return Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : dash
}

function pnlClass(value) {
  return value === null || !Number.isFinite(value) ? 'text-slate-400' : value >= 0 ? 'text-aqua' : 'text-rose-300'
}

function PortfolioPage() {
  const { user } = useAuth()
  const preferences = usePreferences(user)
  const [portfolios, setPortfolios] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [holdings, setHoldings] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [quotes, setQuotes] = useState({})
  const [quoteErrors, setQuoteErrors] = useState({})
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [metadataBySymbol, setMetadataBySymbol] = useState({})
  const [metadataLoading, setMetadataLoading] = useState(false)
  const [riskSeriesBySymbol, setRiskSeriesBySymbol] = useState({})
  const [riskErrors, setRiskErrors] = useState({})
  const [riskLoading, setRiskLoading] = useState(false)
  const [insightLoading, setInsightLoading] = useState(false)
  const [insight, setInsight] = useState(null)
  const [insightError, setInsightError] = useState('')
  const [portfolioName, setPortfolioName] = useState('')
  const [showPortfolioForm, setShowPortfolioForm] = useState(false)
  const [showTransactionForm, setShowTransactionForm] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState(null)
  const [transaction, setTransaction] = useState(emptyTransaction)
  const [symbolSuggestions, setSymbolSuggestions] = useState([])
  const [symbolSearchLoading, setSymbolSearchLoading] = useState(false)
  const [symbolSearchError, setSymbolSearchError] = useState('')
  const [symbolFieldFocused, setSymbolFieldFocused] = useState(false)
  const ledgerRequestRef = useRef(0)
  const quoteRequestRef = useRef(0)
  const metadataCacheRef = useRef({})
  const metadataRequestRef = useRef(0)
  const riskRequestRef = useRef(0)
  const insightRequestRef = useRef(0)
  const riskCacheRef = useRef({})
  const symbolSearchRequestRef = useRef(0)

  useEffect(() => {
    const query = transaction.symbol.trim()
    if (!showTransactionForm || query.length < 1) {
      setSymbolSuggestions([])
      setSymbolSearchLoading(false)
      return undefined
    }
    const requestId = ++symbolSearchRequestRef.current
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setSymbolSearchLoading(true)
      setSymbolSearchError('')
      try {
        const result = await fetchNseStocks({ search: query, limit: 8, signal: controller.signal })
        if (requestId === symbolSearchRequestRef.current) setSymbolSuggestions(result.stocks || [])
      } catch (searchError) {
        if (searchError?.name !== 'AbortError' && requestId === symbolSearchRequestRef.current) setSymbolSearchError(searchError.message || 'Stock search is unavailable.')
      } finally {
        if (requestId === symbolSearchRequestRef.current) setSymbolSearchLoading(false)
      }
    }, 220)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [showTransactionForm, transaction.symbol])

  const selectedPortfolio = useMemo(
    () => portfolios.find((portfolio) => portfolio.id === selectedId),
    [portfolios, selectedId],
  )

  const summary = useMemo(
    () => calculatePortfolioSummary(holdings, quotes, { baseCurrency: selectedPortfolio?.base_currency }),
    [holdings, quotes, selectedPortfolio?.base_currency],
  )

  const allocationData = useMemo(
    () => summary.allocation.map((item, index) => ({ ...item, color: allocationColors[index % allocationColors.length] })),
    [summary.allocation],
  )

  const portfolioAnalysis = useMemo(
    () => buildPortfolioAnalysis(summary, metadataBySymbol),
    [summary, metadataBySymbol],
  )
  const visibleStockWarnings = preferences.highRiskTradingWarnings ? portfolioAnalysis.stockWarnings : []
  const visibleSectorWarnings = preferences.highRiskTradingWarnings ? portfolioAnalysis.sectorWarnings : []

  const sectorAllocationData = useMemo(
    () => portfolioAnalysis.sectorAllocations.map((item, index) => ({ name: item.name, value: item.marketValue, color: allocationColors[index % allocationColors.length] })),
    [portfolioAnalysis.sectorAllocations],
  )

  const portfolioRisk = useMemo(
    () => calculatePortfolioRisk({
      holdings,
      summary,
      historicalSeriesBySymbol: riskSeriesBySymbol,
      baseCurrency: selectedPortfolio?.base_currency,
    }, { asOf: new Date() }),
    [holdings, summary, riskSeriesBySymbol, selectedPortfolio?.base_currency],
  )

  const loadPortfolios = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: queryError } = await supabase
      .from('portfolios')
      .select('id, name, base_currency, created_at')
      .order('created_at', { ascending: false })

    if (queryError) {
      setError(cleanError(queryError, 'Unable to load your portfolios.'))
      setPortfolios([])
      setSelectedId('')
    } else {
      setPortfolios(data || [])
      setSelectedId((current) => (data?.some((item) => item.id === current) ? current : data?.[0]?.id || ''))
    }
    setLoading(false)
  }, [])

  const loadLedger = useCallback(async (portfolioId = selectedId) => {
    const requestId = ++ledgerRequestRef.current
    if (!portfolioId) {
      setHoldings([])
      setTransactions([])
      setQuotes({})
      setQuoteErrors({})
      setLedgerLoading(false)
      return
    }

    setLedgerLoading(true)
    setHoldings([])
    setTransactions([])
    setQuotes({})
    setQuoteErrors({})
    setMetadataBySymbol({})
    setRiskSeriesBySymbol({})
    setRiskErrors({})

    try {
      const payload = await fetchPortfolioAccounting(portfolioId)
      if (requestId !== ledgerRequestRef.current) return
      const accountingRows = Array.isArray(payload?.accounting?.rows) ? payload.accounting.rows : []
      const nextHoldings = accountingRows.map((row) => ({
        ...row,
        id: `${portfolioId}:${row.symbol}`,
        last_transaction_at: row.quoteTimestamp || null,
      }))
      const nextQuotes = {}
      const nextQuoteErrors = {}
      Object.entries(payload?.quotes || {}).forEach(([symbol, quote]) => {
        if (quote?.error || !Number.isFinite(Number(quote?.price))) nextQuoteErrors[symbol] = quote?.error || 'Quote unavailable.'
        nextQuotes[symbol] = quote
      })
      setHoldings(nextHoldings)
      setTransactions(Array.isArray(payload?.transactions) ? payload.transactions : [])
      setQuotes(nextQuotes)
      setQuoteErrors(nextQuoteErrors)
      setLedgerLoading(false)
    } catch (queryError) {
      if (requestId !== ledgerRequestRef.current) return
      setError(cleanError(queryError, 'Unable to load portfolio accounting.'))
      setHoldings([])
      setTransactions([])
      setLedgerLoading(false)
    }
  }, [selectedId])

  const loadQuotes = useCallback(async () => {
    const requestId = ++quoteRequestRef.current
    const portfolioId = selectedId
    const symbols = [...new Set(holdings.filter((holding) => Number(holding.quantity) > 0).map((holding) => holding.symbol))]
    if (symbols.length === 0) {
      setQuotes({})
      setQuoteErrors({})
      setQuoteLoading(false)
      return
    }
    setQuoteLoading(true)
    const results = await Promise.allSettled(symbols.map(async (symbol) => [symbol, await fetchStock(symbol)]))
    const nextQuotes = {}
    const nextErrors = {}
    results.forEach((result, index) => {
      const symbol = symbols[index]
      if (result.status === 'fulfilled') nextQuotes[result.value[0]] = result.value[1]
      else nextErrors[symbol] = result.reason?.message || 'Quote unavailable.'
    })
    if (requestId !== quoteRequestRef.current || portfolioId !== selectedId) return
    setQuotes(nextQuotes)
    setQuoteErrors(nextErrors)
    setQuoteLoading(false)
  }, [holdings, selectedId])

  const loadRiskHistory = useCallback(async () => {
    const requestId = ++riskRequestRef.current
    const portfolioId = selectedId
    const symbols = [...new Set(holdings.filter((holding) => Number(holding.quantity) > 0).map((holding) => holding.symbol))]
    if (!symbols.length) {
      setRiskSeriesBySymbol({})
      setRiskErrors({})
      setRiskLoading(false)
      return
    }

    setRiskLoading(true)
    setRiskErrors({})
    const missingSymbols = symbols.filter((symbol) => !riskCacheRef.current[symbol])
    if (missingSymbols.length) {
      const results = await Promise.allSettled(missingSymbols.map(async (symbol) => {
        const payload = await fetchStockChart(symbol, { range: '1y', interval: '1d' })
        if (!Array.isArray(payload?.points)) throw new Error('Historical price service returned an invalid response.')
        return [symbol, payload.points]
      }))
      const nextErrors = {}
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') riskCacheRef.current[missingSymbols[index]] = result.value[1]
        else nextErrors[missingSymbols[index]] = result.reason?.message || 'Historical prices unavailable.'
      })
      if (requestId !== riskRequestRef.current || portfolioId !== selectedId) return
      setRiskErrors(nextErrors)
    }

    if (requestId !== riskRequestRef.current || portfolioId !== selectedId) return
    const nextSeries = {}
    symbols.forEach((symbol) => {
      if (riskCacheRef.current[symbol]) nextSeries[symbol] = riskCacheRef.current[symbol]
    })
    setRiskSeriesBySymbol(nextSeries)
    setRiskLoading(false)
  }, [holdings, selectedId])

  const loadSectorMetadata = useCallback(async () => {
    const requestId = ++metadataRequestRef.current
    const portfolioId = selectedId
    const symbols = [...new Set(holdings.filter((holding) => Number(holding.quantity) > 0).map((holding) => holding.symbol))]
    if (!symbols.length) {
      setMetadataBySymbol({})
      setMetadataLoading(false)
      return
    }

    setMetadataLoading(true)
    const missingSymbols = symbols.filter((symbol) => !metadataCacheRef.current[symbol])
    if (missingSymbols.length) {
      const results = await Promise.allSettled(missingSymbols.map(async (symbol) => {
        const normalized = String(symbol || '').replace(/\.NS$/i, '').toUpperCase()
        let payload
        try {
          payload = await fetchStockIntelligence(normalized, { includeNews: false, cachedOnly: true })
        } catch (cachedError) {
          payload = await fetchStockIntelligence(normalized, { includeNews: false, cachedOnly: false })
        }
        let document = payload?.document || {}
        let market = document.market || {}
        if (!market.sector && !market.industry) {
          const freshPayload = await fetchStockIntelligence(normalized, { includeNews: false, cachedOnly: false })
          document = freshPayload?.document || {}
          market = document.market || {}
        }
        if (!market.sector && !market.industry && !document.company_name) return [normalized, { sector: 'Unknown', updatedAt: document.updated_at || null }]
        return [normalized, { companyName: document.company_name || '', sector: market.sector || 'Unknown', updatedAt: document.refresh_metadata?.market_updated_at || document.updated_at || null }]
      }))
      results.forEach((result, index) => {
        if (result.status !== 'fulfilled') return
        const [, metadata] = result.value
        metadataCacheRef.current[missingSymbols[index]] = metadata
      })
    }

    if (requestId !== metadataRequestRef.current || portfolioId !== selectedId) return
    const nextMetadata = {}
    symbols.forEach((symbol) => { nextMetadata[symbol] = metadataCacheRef.current[symbol] || { sector: 'Unknown' } })
    setMetadataBySymbol(nextMetadata)
    setMetadataLoading(false)
  }, [holdings, selectedId])

  function selectPortfolio(portfolioId) {
    if (portfolioId === selectedId) return
    setSelectedId(portfolioId)
    setHoldings([])
    setTransactions([])
    setQuotes({})
    setQuoteErrors({})
    setMetadataBySymbol({})
    setRiskSeriesBySymbol({})
    setRiskErrors({})
    setError('')
    setNotice('')
  }

  useEffect(() => {
    if (user) void loadPortfolios()
  }, [user, loadPortfolios])

  useEffect(() => {
    void loadLedger()
  }, [loadLedger])

  useEffect(() => {
    void loadSectorMetadata()
  }, [loadSectorMetadata])

  useEffect(() => {
    void loadRiskHistory()
  }, [loadRiskHistory])

  useEffect(() => {
    setInsight(null)
    setInsightError('')
  }, [selectedId, holdings, quotes, metadataBySymbol])

  async function requestPortfolioInsight() {
    const requestId = ++insightRequestRef.current
    if (!selectedId) return
    setInsightLoading(true)
    setInsightError('')
    try {
      const payload = await fetchPortfolioInsights(selectedId, {
        summary,
        analysis: portfolioAnalysis,
        risk: portfolioRisk,
      })
      if (requestId === insightRequestRef.current && selectedId) setInsight(payload)
    } catch (requestError) {
      if (requestId === insightRequestRef.current) setInsightError(requestError.message || 'Portfolio insights are unavailable.')
    } finally {
      if (requestId === insightRequestRef.current) setInsightLoading(false)
    }
  }

  async function createPortfolio(event) {
    event.preventDefault()
    const name = portfolioName.trim()
    if (!name) {
      setError('Enter a portfolio name.')
      return
    }
    setSaving(true)
    setError('')
    const { data, error: insertError } = await supabase
      .from('portfolios')
      .insert({ user_id: user.id, name, base_currency: 'INR' })
      .select('id, name, base_currency, created_at')
      .single()
    setSaving(false)
    if (insertError) {
      setError(cleanError(insertError, 'Unable to create the portfolio.'))
      return
    }
    setPortfolios((current) => [data, ...current])
    setSelectedId(data.id)
    setPortfolioName('')
    setShowPortfolioForm(false)
    setNotice('Portfolio created.')
  }

  function openNewTransaction() {
    setEditingTransaction(null)
    setTransaction({ ...emptyTransaction, executed_at: toDateTimeInput(new Date().toISOString()) })
    setError('')
    setShowTransactionForm(true)
  }

  function openEditTransaction(item) {
    setEditingTransaction(item)
    setTransaction({
      symbol: item.symbol,
      exchange: item.exchange,
      currency: item.currency,
      transaction_type: item.transaction_type,
      quantity: String(item.quantity),
      executed_at: toDateTimeInput(item.executed_at),
    })
    setError('')
    setShowTransactionForm(true)
  }

  function validateTransaction() {
    const quantity = Number(transaction.quantity)
    if (!transaction.symbol.trim()) return 'Symbol is required.'
    if (!transaction.exchange.trim()) return 'Exchange is required.'
    if (!transaction.currency.trim()) return 'Currency is required.'
    if (!transaction.transaction_type) return 'Transaction type is required.'
    if (!Number.isFinite(quantity) || quantity <= 0) return 'Quantity must be greater than zero.'
    if (!transaction.executed_at) return 'Executed date and time are required.'
    return null
  }

  async function saveTransaction(event) {
    event.preventDefault()
    const validationError = validateTransaction()
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError('')
    const payload = {
      symbol: transaction.symbol.trim().toUpperCase(),
      exchange: transaction.exchange.trim().toUpperCase(),
      currency: transaction.currency.trim().toUpperCase(),
      transaction_type: transaction.transaction_type,
      quantity: Number(transaction.quantity),
      executed_at: new Date(transaction.executed_at).toISOString(),
    }
    const portfolioId = selectedId
    try {
      await savePortfolioTransaction(portfolioId, payload, editingTransaction?.id || '')
    } catch (saveError) {
      setSaving(false)
      setError(cleanError(saveError, 'Unable to resolve the market price for this transaction.'))
      return
    }
    setSaving(false)
    setShowTransactionForm(false)
    setNotice(editingTransaction ? 'Transaction updated.' : 'Transaction added.')
    if (portfolioId === selectedId) await loadLedger(portfolioId)
  }

  async function deleteTransaction(item) {
    if (!window.confirm(`Delete the ${item.transaction_type} of ${item.symbol}?`)) return
    setSaving(true)
    setError('')
    const portfolioId = selectedId
    const { error: deleteError } = await supabase
      .from('portfolio_transactions')
      .delete()
      .eq('id', item.id)
      .eq('portfolio_id', portfolioId)
    setSaving(false)
    if (deleteError) {
      setError(cleanError(deleteError, 'Unable to delete this transaction.'))
      return
    }
    setNotice('Transaction deleted.')
    if (portfolioId === selectedId) await loadLedger(portfolioId)
  }

  return (
    <div>
      {showTransactionForm && transaction.symbol.trim() && (symbolSearchLoading || symbolSearchError || symbolSuggestions.length) ? <div className="fixed inset-x-4 top-24 z-[80] mx-auto max-w-2xl rounded-2xl border border-white/15 bg-[#0b211b] p-2 shadow-2xl">{symbolSearchLoading ? <p className="px-3 py-2 text-xs text-slate-400">Searching NSE stocks…</p> : symbolSearchError ? <p className="px-3 py-2 text-xs text-rose-200">{symbolSearchError}</p> : symbolSuggestions.map((item) => <button type="button" key={item.symbol} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/10" onClick={() => { setTransaction({ ...transaction, symbol: item.symbol, exchange: 'NSE' }); setSymbolSuggestions([]) }}><span className="font-semibold text-white">{item.symbol}</span><span className="ml-2 text-xs text-slate-400">{item.name}</span></button>)}</div> : null}
      <PageHeader
        eyebrow="Portfolio"
        title="Track the decisions behind your wealth"
        description="Record buys and sells once. FinSense calculates holdings and gains from the server-side FIFO transaction ledger."
        actions={
          <>
            <button className="btn-secondary" onClick={() => void loadLedger()} disabled={!selectedId || loading || quoteLoading}>
              <span className="inline-flex items-center gap-2"><RefreshCw className="h-4 w-4" /> Refresh</span>
            </button>
            <button className="btn-primary" onClick={() => setShowPortfolioForm(true)}>
              <span className="inline-flex items-center gap-2"><Plus className="h-4 w-4" /> Create Portfolio</span>
            </button>
          </>
        }
      />

      {error ? <div className="mb-5 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
      {notice ? <div className="mb-5 rounded-2xl border border-aqua/20 bg-aqua/10 px-4 py-3 text-sm text-aqua">{notice}</div> : null}

      {selectedId ? (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ['Market value', summary.marketValue === null ? 'Unavailable' : formatMoney(summary.marketValue, selectedPortfolio?.base_currency), 'Live valuation'],
              ['Invested cost basis', summary.investedCostBasis === null ? 'Unavailable' : formatMoney(summary.investedCostBasis, selectedPortfolio?.base_currency), 'Remaining positions'],
              ['Unrealized P&L', summary.unrealizedPnl === null ? 'Unavailable' : formatMoney(summary.unrealizedPnl, selectedPortfolio?.base_currency), formatPercent(summary.unrealizedReturnPercentage)],
              ['Realized P&L', formatMoney(summary.realizedPnl, selectedPortfolio?.base_currency), 'Database ledger'],
              ['Overall P&L', summary.overallPnl === null ? 'Unavailable' : formatMoney(summary.overallPnl, selectedPortfolio?.base_currency), 'Realized + unrealized'],
            ].map(([label, value, detail]) => <div key={label} className="glass-panel rounded-3xl p-5"><p className="text-sm text-slate-400">{label}</p><p className={`mt-3 text-2xl font-semibold ${label.includes('P&L') ? pnlClass(label === 'Realized P&L' ? summary.realizedPnl : label === 'Unrealized P&L' ? summary.unrealizedPnl : summary.overallPnl) : 'text-white'}`}>{value}</p><p className="mt-2 text-xs text-slate-500">{detail}</p></div>)}
          </div>

          {!summary.allActiveQuotesAvailable && summary.activeHoldings > 0 ? <div className="mb-6 flex items-start gap-3 rounded-2xl border border-gold/25 bg-gold/10 px-4 py-3 text-sm text-gold"><Clock3 className="mt-0.5 h-4 w-4 shrink-0" /><span>{quoteLoading ? 'Refreshing current NSE prices…' : 'Some current prices are missing or stale. Valuation totals are withheld; transaction-derived metrics remain available.'}</span></div> : null}
          {!summary.safelyComparable && summary.activeHoldings > 0 ? <div className="mb-6 flex items-start gap-3 rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>Holdings use currencies that cannot be safely combined with this portfolio’s {selectedPortfolio?.base_currency} base currency. Totals are unavailable until currency conversion is supported.</span></div> : null}

          <div className="mb-6 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.8fr)]">
            <SectionCard title="Portfolio dashboard" subtitle={`${summary.activeHoldings} active holding${summary.activeHoldings === 1 ? '' : 's'} · Current value uses the latest available market quote.`}>
              {summary.rows.length === 0 ? <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center"><Wallet className="mx-auto h-8 w-8 text-aqua" /><p className="mt-3 text-sm text-slate-300">No holdings yet. Add a BUY transaction to start tracking live P&L.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="text-xs uppercase tracking-wider text-slate-500"><tr><th className="pb-3">Holding</th><th className="pb-3">Qty</th><th className="pb-3">Avg cost</th><th className="pb-3">Current price</th><th className="pb-3">Market value</th><th className="pb-3">Unrealized</th><th className="pb-3">Realized</th><th className="pb-3">Return</th></tr></thead><tbody>{summary.rows.map((row) => <tr key={row.id} className="border-t border-white/10"><td className="py-4 font-semibold text-white">{row.symbol}<span className="ml-2 text-xs text-slate-500">{row.exchange}</span>{row.quantity === 0 ? <span className="ml-2 rounded-full bg-white/10 px-2 py-1 text-[10px] text-slate-400">Closed</span> : null}</td><td className="py-4 text-slate-300">{row.quantity === null ? '—' : row.quantity.toLocaleString('en-IN')}</td><td className="py-4 text-slate-300">{formatMoney(row.averageCost, row.currency)}</td><td className="py-4 text-slate-300">{row.currentPrice === null ? <span title={quoteErrors[row.symbol] || 'Quote missing or stale'}>—</span> : formatMoney(row.currentPrice, row.currency)}</td><td className="py-4 text-slate-300">{formatMoney(row.marketValue, row.currency)}</td><td className={`py-4 font-medium ${pnlClass(row.unrealizedPnl)}`}>{formatMoney(row.unrealizedPnl, row.currency)}</td><td className={`py-4 font-medium ${pnlClass(row.realizedPnl)}`}>{formatMoney(row.realizedPnl, row.currency)}</td><td className={`py-4 font-medium ${pnlClass(row.returnPercentage)}`}>{formatPercent(row.returnPercentage)}</td></tr>)}</tbody></table></div>}
            </SectionCard>
            <SectionCard title="Stock allocation" subtitle="Each position’s share of the complete valued portfolio.">
              {portfolioAnalysis.available ? <><AllocationChart data={allocationData} /><div className="space-y-2">{portfolioAnalysis.stockAllocations.map((item, index) => <div key={item.symbol} className="flex items-center justify-between gap-3 text-sm"><span className="flex min-w-0 items-center gap-2 text-slate-300"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: allocationColors[index % allocationColors.length] }} /><span className="truncate">{item.symbol} <span className="text-xs text-slate-500">{item.companyName}</span></span></span><span className="shrink-0 font-medium text-white">{item.percentage.toFixed(2)}%</span></div>)}</div></> : <div className="flex h-72 items-center justify-center text-center text-sm text-slate-400">{portfolioAnalysis.reason || 'Allocation appears after compatible, current quotes are available.'}</div>}
            </SectionCard>
          </div>

          <div className="mb-6 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
            <SectionCard title="Sector allocation" subtitle="Sectors come from cached stock intelligence metadata; no ticker-based inference is used.">
              {metadataLoading ? <div className="animate-pulse rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-300">Loading sector metadata…</div> : !portfolioAnalysis.available ? <div className="rounded-2xl border border-dashed border-white/15 p-6 text-sm text-slate-400">{portfolioAnalysis.reason || 'Sector allocation requires a complete compatible valuation.'}</div> : <><AllocationChart data={sectorAllocationData} /><div className="space-y-2">{portfolioAnalysis.sectorAllocations.map((item) => <div key={item.name} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm"><span className="text-slate-300">{item.name}{item.name === 'Unknown' ? <span className="ml-2 text-xs text-gold">classification unavailable</span> : null}</span><span className="font-medium text-white">{formatMoney(item.marketValue, selectedPortfolio?.base_currency)} · {item.percentage.toFixed(2)}%</span></div>)}</div>{!portfolioAnalysis.sectorCoverage.complete ? <p className="mt-4 text-xs leading-5 text-slate-500">Sector analysis is incomplete because {portfolioAnalysis.sectorCoverage.total - portfolioAnalysis.sectorCoverage.known} active holding{portfolioAnalysis.sectorCoverage.total - portfolioAnalysis.sectorCoverage.known === 1 ? '' : 's'} lack usable sector metadata and are grouped as Unknown.</p> : null}</>}
            </SectionCard>

            <SectionCard title="Diversification indicators" subtitle="Descriptive concentration measures, not a comprehensive risk assessment.">
              {!portfolioAnalysis.available ? <p className="text-sm text-slate-400">{portfolioAnalysis.reason || 'Indicators appear after a complete compatible valuation.'}</p> : <div className="space-y-3"><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Active holdings</p><p className="mt-2 text-2xl font-semibold text-white">{portfolioAnalysis.activeHoldings}</p></div><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Largest stock</p><p className="mt-2 font-semibold text-white">{portfolioAnalysis.largestStock?.symbol || '—'} <span className="text-aqua">{portfolioAnalysis.largestStock ? `${portfolioAnalysis.largestStock.percentage.toFixed(2)}%` : ''}</span></p></div><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Largest sector</p><p className="mt-2 font-semibold text-white">{portfolioAnalysis.largestSector?.name || '—'} <span className="text-aqua">{portfolioAnalysis.largestSector ? `${portfolioAnalysis.largestSector.percentage.toFixed(2)}%` : ''}</span></p></div><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Stock HHI</p><p className="mt-2 font-semibold text-white">{portfolioAnalysis.hhi.toFixed(0)}</p><p className="mt-1 text-xs text-slate-500">Sum of squared stock allocation percentages on a 0–10,000 scale.</p></div></div>}
            </SectionCard>
          </div>

          <SectionCard className="mb-6" title="Historical risk analysis" subtitle="A current-holdings historical proxy using daily close-to-close returns; it is not a reconstructed account return or a forecast.">
            {riskLoading ? <div className="animate-pulse rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-300">Loading one-year historical prices…</div> : portfolioRisk.status === 'empty' ? <p className="text-sm text-slate-400">Risk metrics appear after you add an active holding.</p> : portfolioRisk.status === 'unavailable' ? <div className="rounded-2xl border border-dashed border-white/15 p-6 text-sm text-slate-400">{portfolioRisk.reasons.join(' ') || 'Historical risk metrics are unavailable.'}</div> : <>
              {portfolioRisk.status !== 'valid' ? <div className="mb-4 rounded-2xl border border-gold/25 bg-gold/10 p-4 text-sm text-gold">Historical risk is partial or insufficient. {portfolioRisk.reasons.join(' ') || 'Some metrics could not be calculated from the available observations.'}</div> : null}
              {portfolioRisk.portfolio ? <div className="grid gap-4 sm:grid-cols-3"><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Annualized volatility</p><p className="mt-2 text-2xl font-semibold text-white">{formatPercent(portfolioRisk.portfolio.volatility * 100)}</p></div><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Maximum drawdown</p><p className="mt-2 text-2xl font-semibold text-rose-200">{formatPercent(portfolioRisk.portfolio.maximumDrawdown * 100)}</p></div><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Proxy return</p><p className={`mt-2 text-2xl font-semibold ${pnlClass(portfolioRisk.portfolio.cumulativeReturn)}`}>{formatPercent(portfolioRisk.portfolio.cumulativeReturn * 100)}</p></div></div> : null}
              <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="text-xs uppercase tracking-wider text-slate-500"><tr><th className="pb-3">Holding</th><th className="pb-3">Observations</th><th className="pb-3">Volatility</th><th className="pb-3">Drawdown</th><th className="pb-3">Status</th></tr></thead><tbody>{portfolioRisk.assetRisk.map((item) => <tr key={item.symbol} className="border-t border-white/10"><td className="py-3 font-semibold text-white">{item.symbol}</td><td className="py-3 text-slate-300">{item.observations}</td><td className="py-3 text-slate-300">{item.volatility === null ? 'Unavailable' : formatPercent(item.volatility * 100)}</td><td className="py-3 text-slate-300">{item.maximumDrawdown === null ? 'Unavailable' : formatPercent(item.maximumDrawdown * 100)}</td><td className="py-3 text-slate-400">{item.status === 'valid' ? 'Valid' : item.reason || riskErrors[item.symbol] || 'Partial'}</td></tr>)}</tbody></table></div>
              <p className="mt-4 text-xs leading-5 text-slate-500">Volatility is sample standard deviation of daily simple returns annualized by √252. Drawdown is the largest peak-to-trough decline in the one-year history returned by the market-data service. These historical measures do not guarantee future outcomes.</p>
            </>}
          </SectionCard>

          <SectionCard className="mb-6" title="AI portfolio insights" subtitle="Grounded interpretation of the verified ledger and computed analysis. AI text never changes the financial calculations.">
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-sm leading-6 text-slate-400">Insights explain concentration, diversification and historical-risk context when the underlying data is available. They are educational decision support, not personalized advice or a forecast.</p><button type="button" className="btn-primary px-4 py-2" onClick={() => void requestPortfolioInsight()} disabled={insightLoading || !selectedId || summary.rows.length === 0}>{insightLoading ? 'Generating…' : 'Generate insights'}</button></div>
            {insightError ? <div className="mt-4 rounded-2xl border border-gold/25 bg-gold/10 p-4 text-sm text-gold">{insightError} Deterministic portfolio analysis remains available above.</div> : null}
            {insight ? <div className="mt-4 rounded-2xl border border-aqua/20 bg-aqua/5 p-4"><p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">{insight.answer}</p><p className="mt-4 text-xs text-slate-500">Generated {formatDate(insight.generatedAt)} · Provider: {insight.provider || 'configured AI service'} · Based on current ledger and analysis inputs.</p><p className="mt-2 text-xs leading-5 text-slate-500">{(insight.limitations || []).join(' ')}</p></div> : null}
          </SectionCard>

          <SectionCard className="mb-6" title="Concentration warnings" subtitle={`Analytical warnings only. Stock threshold: ${(portfolioAnalysis.thresholds.stock * 100).toFixed(0)}%; sector threshold: ${(portfolioAnalysis.thresholds.sector * 100).toFixed(0)}%.`}>
            {!preferences.highRiskTradingWarnings ? <p className="text-sm text-slate-400">High-risk trading warnings are disabled in Profile settings.</p> : !portfolioAnalysis.available ? <p className="text-sm text-slate-400">{portfolioAnalysis.reason || 'Warnings appear after a complete compatible valuation.'}</p> : !visibleStockWarnings.length && !visibleSectorWarnings.length ? <div className="rounded-2xl border border-aqua/20 bg-aqua/10 p-4 text-sm text-aqua">No configured concentration thresholds are exceeded by the currently valued holdings.</div> : <div className="space-y-3">{[...visibleStockWarnings.map((warning) => ({ ...warning, key: `stock-${warning.symbol}`, label: `Stock · ${warning.symbol}` })), ...visibleSectorWarnings.map((warning) => ({ ...warning, key: `sector-${warning.name}`, label: `Sector · ${warning.name}` }))].map((warning) => <div key={warning.key} className="rounded-2xl border border-gold/25 bg-gold/10 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-white">{warning.label}</p><span className="text-sm text-gold">{warning.percentage.toFixed(2)}% · threshold {warning.threshold.toFixed(0)}%</span></div><p className="mt-2 text-sm leading-6 text-slate-300">{warning.reason} Concentration can increase exposure to company- or sector-specific changes; this is not a prediction or personalized advice.</p></div>)}</div>}
            {portfolioAnalysis.available && !portfolioAnalysis.sectorCoverage.complete ? <p className="mt-4 text-xs leading-5 text-slate-500">Sector warnings are limited because Unknown sector exposure cannot be treated as a classified sector concentration.</p> : null}
          </SectionCard>
        </>
      ) : null}

      <div className="page-grid">
        <SectionCard title="Your portfolios" subtitle="Choose a ledger to view its transactions and derived holdings." action={<div className="flex flex-wrap items-center justify-end gap-2"><select aria-label="Select portfolio" className="input-shell max-w-[180px] bg-panel py-2 text-sm" value={selectedId} onChange={(event) => selectPortfolio(event.target.value)} disabled={loading || portfolios.length === 0}><option value="">Select portfolio</option>{portfolios.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>)}</select><button type="button" className="btn-primary px-3 py-2 text-sm" onClick={() => setShowPortfolioForm(true)}><span className="inline-flex items-center gap-1"><Plus className="h-4 w-4" /> Create Portfolio</span></button></div>}>
          {loading ? <p className="text-sm text-slate-400">Loading portfolios…</p> : portfolios.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center"><Wallet className="mx-auto h-8 w-8 text-aqua" /><p className="mt-3 text-sm text-slate-300">Create your first portfolio to begin.</p></div>
          ) : <div className="space-y-3">{portfolios.map((portfolio) => <button key={portfolio.id} onClick={() => selectPortfolio(portfolio.id)} className={`w-full rounded-2xl border p-4 text-left transition ${portfolio.id === selectedId ? 'border-aqua/50 bg-aqua/10' : 'border-white/10 bg-white/[0.03] hover:border-white/25'}`}><div className="flex items-center justify-between"><span className="font-semibold text-white">{portfolio.name}</span><span className="text-xs text-slate-400">{portfolio.base_currency}</span></div><p className="mt-1 text-xs text-slate-500">Created {formatDate(portfolio.created_at)}</p></button>)}</div>}
        </SectionCard>

        <SectionCard title="Current holdings" subtitle="Read-only FIFO projection calculated from your transaction ledger." action={selectedId ? <button className="btn-primary px-4 py-2" onClick={openNewTransaction}><span className="inline-flex items-center gap-2"><Plus className="h-4 w-4" /> Transaction</span></button> : null}>
          {!selectedId ? <p className="text-sm text-slate-400">Select or create a portfolio.</p> : ledgerLoading ? <p className="text-sm text-slate-400">Loading portfolio holdings…</p> : holdings.length === 0 ? <p className="text-sm text-slate-400">No holdings yet. Add a BUY transaction to get started.</p> : <div className="space-y-3">{summary.rows.map((row) => <div key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><div className="flex items-center justify-between"><span className="font-semibold text-white">{row.symbol} <span className="text-xs text-slate-500">{row.exchange}</span></span><span className="text-sm text-aqua">{row.quantity?.toLocaleString('en-IN')} units</span></div><div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-400"><span>Avg cost {formatMoney(row.averageCost, row.currency)}</span><span className={pnlClass(row.realizedPnl)}>Realized P&amp;L {formatMoney(row.realizedPnl, row.currency)}</span><span className={pnlClass(row.unrealizedPnl)}>Unrealized {formatMoney(row.unrealizedPnl, row.currency)}</span></div></div>)}</div>}
        </SectionCard>
      </div>

      <SectionCard className="mt-6" title="Transaction history" subtitle="The transaction ledger is the source of truth for your holdings.">
        {!selectedId ? <p className="text-sm text-slate-400">Select a portfolio to view transactions.</p> : transactions.length === 0 ? <p className="text-sm text-slate-400">No transactions recorded yet.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="text-xs uppercase tracking-wider text-slate-500"><tr><th className="pb-3">Date</th><th className="pb-3">Position</th><th className="pb-3">Type</th><th className="pb-3">Quantity</th><th className="pb-3">Resolved price</th><th className="pb-3">Fees</th><th className="pb-3 text-right">Actions</th></tr></thead><tbody>{transactions.map((item) => <tr key={item.id} className="border-t border-white/10"><td className="py-4 text-slate-400">{formatDate(item.executed_at)}</td><td className="py-4 font-semibold text-white">{item.symbol} <span className="text-xs text-slate-500">{item.exchange}</span></td><td className={`py-4 font-semibold ${item.transaction_type === 'BUY' ? 'text-aqua' : 'text-rose-300'}`}>{item.transaction_type}</td><td className="py-4 text-slate-300">{Number(item.quantity).toLocaleString('en-IN')}</td><td className="py-4 text-slate-300">{Number(item.unit_price).toFixed(2)} {item.currency}</td><td className="py-4 text-slate-400">{Number(item.fees).toFixed(2)}</td><td className="py-4 text-right"><div className="flex justify-end gap-2"><button className="icon-button" title="Edit transaction" onClick={() => openEditTransaction(item)}><Pencil className="h-4 w-4" /></button><button className="icon-button" title="Delete transaction" onClick={() => void deleteTransaction(item)} disabled={saving}><Trash2 className="h-4 w-4 text-rose-300" /></button></div></td></tr>)}</tbody></table></div>}
      </SectionCard>

      {showPortfolioForm ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><form onSubmit={createPortfolio} className="glass-panel w-full max-w-md rounded-3xl p-6"><div className="flex items-center justify-between"><h3 className="font-display text-2xl text-white">New portfolio</h3><button type="button" className="icon-button" onClick={() => setShowPortfolioForm(false)}><X className="h-4 w-4" /></button></div><label className="mt-6 block text-sm text-slate-300">Portfolio name<input className="input-shell mt-2 w-full bg-white/[0.04]" value={portfolioName} onChange={(event) => setPortfolioName(event.target.value)} placeholder="Long-term investments" autoFocus /></label><button className="btn-primary mt-5 w-full" disabled={saving}>{saving ? 'Creating…' : 'Create portfolio'}</button></form></div> : null}

      {showTransactionForm ? <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4"><form onSubmit={saveTransaction} className="glass-panel my-8 w-full max-w-2xl rounded-3xl p-6"><div className="flex items-center justify-between"><h3 className="font-display text-2xl text-white">{editingTransaction ? 'Edit transaction' : 'Add transaction'}</h3><button type="button" className="icon-button" onClick={() => setShowTransactionForm(false)}><X className="h-4 w-4" /></button></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm text-slate-300">Symbol<input className="input-shell mt-2 w-full bg-white/[0.04] uppercase" value={transaction.symbol} onChange={(event) => setTransaction({ ...transaction, symbol: event.target.value })} placeholder="TCS" /></label><label className="text-sm text-slate-300">Exchange<input className="input-shell mt-2 w-full bg-white/[0.04] uppercase" value={transaction.exchange} onChange={(event) => setTransaction({ ...transaction, exchange: event.target.value })} /></label><label className="text-sm text-slate-300">Currency<input className="input-shell mt-2 w-full bg-white/[0.04] uppercase" value={transaction.currency} onChange={(event) => setTransaction({ ...transaction, currency: event.target.value })} /></label><label className="text-sm text-slate-300">Type<select className="input-shell mt-2 w-full bg-panel" value={transaction.transaction_type} onChange={(event) => setTransaction({ ...transaction, transaction_type: event.target.value })}><option value="BUY">BUY</option><option value="SELL">SELL</option></select></label><label className="text-sm text-slate-300">Quantity<input type="number" min="0" step="any" className="input-shell mt-2 w-full bg-white/[0.04]" value={transaction.quantity} onChange={(event) => setTransaction({ ...transaction, quantity: event.target.value })} /></label><label className="text-sm text-slate-300 sm:col-span-2">Executed date/time<input type="datetime-local" className="input-shell mt-2 w-full bg-white/[0.04]" value={transaction.executed_at} onChange={(event) => setTransaction({ ...transaction, executed_at: event.target.value })} /></label></div><p className="mt-4 text-xs leading-5 text-slate-400">The server resolves the nearest available NSE market price at or before this timestamp. No manual unit price or fee is accepted. If no historical quote is available, the transaction is rejected instead of using a fabricated price.</p><button className="btn-primary mt-5 w-full" disabled={saving}>{saving ? 'Resolving market price…' : editingTransaction ? 'Save changes' : 'Add transaction'}</button></form></div> : null}
    </div>
  )
}

export default PortfolioPage
