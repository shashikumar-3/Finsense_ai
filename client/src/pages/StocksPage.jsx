import { RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchStockIntelligence, searchStockIntelligence } from '../api/intelligenceApi'
import { fetchNseStocks } from '../api/stocksApi'
import { shortSymbolLabel } from '../data/stocksData'

const STOCK_LIST_LIMIT = 24
const INTELLIGENCE_BATCH_SIZE = 6

function formatUpdatedAt(value) {
  if (!value) {
    return 'Not indexed'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Unknown'
  }

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getSentimentClasses(sentiment = '') {
  const normalized = sentiment.toLowerCase()

  if (normalized === 'positive') {
    return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
  }

  if (normalized === 'negative') {
    return 'border-rose-400/20 bg-rose-400/10 text-rose-300'
  }

  return 'border-white/10 bg-white/[0.05] text-slate-300'
}

function getTrendClasses(trend = '') {
  const normalized = trend.toLowerCase()

  if (normalized === 'bullish') {
    return 'border-cyan/20 bg-cyan/10 text-cyan'
  }

  if (normalized === 'bearish') {
    return 'border-amber-400/20 bg-amber-400/10 text-amber-200'
  }

  return 'border-white/10 bg-white/[0.05] text-slate-300'
}

function StocksPage() {
  const [stocks, setStocks] = useState([])
  const [intelligenceBySymbol, setIntelligenceBySymbol] = useState({})
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [intelligenceLoading, setIntelligenceLoading] = useState(true)
  const [hydratingIntelligence, setHydratingIntelligence] = useState(false)

  const mergeIntelligenceItems = useCallback((items = []) => {
    if (!items.length) {
      return
    }

    setIntelligenceBySymbol((current) => {
      const next = { ...current }

      for (const item of items) {
        const document = item?.document || item
        if (!document?.symbol) {
          continue
        }

        next[shortSymbolLabel(document.symbol)] = document
      }

      return next
    })
  }, [])

  const loadIntelligence = useCallback(async () => {
    try {
      setIntelligenceLoading(true)
      const data = await searchStockIntelligence({ limit: 100 })
      mergeIntelligenceItems((data.results || []).map((item) => item?.document).filter(Boolean))
    } catch {
      setIntelligenceBySymbol({})
    } finally {
      setIntelligenceLoading(false)
    }
  }, [mergeIntelligenceItems])

  const loadStocks = useCallback(async ({ search = '', silent = false } = {}) => {
    try {
      if (!silent) {
        setLoading(true)
      } else {
        setRefreshing(true)
      }

      setError('')
      const data = await fetchNseStocks({ search, limit: STOCK_LIST_LIMIT, offset: 0 })
      setStocks(data.stocks || [])
      setTotal(Number(data.total) || 0)
    } catch (err) {
      setError(err.message || 'Unable to load stocks.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim())
    }, 300)

    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    loadStocks({ search: debouncedQuery })
  }, [debouncedQuery, loadStocks])

  useEffect(() => {
    loadIntelligence()
  }, [loadIntelligence])

  useEffect(() => {
    let cancelled = false

    async function hydrateVisibleStocks() {
      if (loading || !stocks.length) {
        return
      }

      const missingSymbols = stocks
        .map((stock) => shortSymbolLabel(stock.symbol))
        .filter((symbol) => !intelligenceBySymbol[symbol])

      if (!missingSymbols.length) {
        return
      }

      setHydratingIntelligence(true)

      try {
        for (let index = 0; index < missingSymbols.length; index += INTELLIGENCE_BATCH_SIZE) {
          if (cancelled) {
            return
          }

          const batch = missingSymbols.slice(index, index + INTELLIGENCE_BATCH_SIZE)
          const batchItems = await Promise.all(
            batch.map((symbol) =>
              fetchStockIntelligence(symbol, { includeNews: true, cachedOnly: true }),
            ),
          )

          if (cancelled) {
            return
          }

          mergeIntelligenceItems(batchItems.filter((item) => item?.document))
        }
      } catch {
      } finally {
        if (!cancelled) {
          setHydratingIntelligence(false)
        }
      }
    }

    hydrateVisibleStocks()

    return () => {
      cancelled = true
    }
  }, [intelligenceBySymbol, loading, mergeIntelligenceItems, stocks])

  const marketStats = useMemo(
    () => ({
      total,
      visible: stocks.length,
      query: query.trim(),
    }),
    [query, stocks.length, total],
  )

  const noDataText = query.trim()
    ? `No NSE stocks found for "${query.trim()}".`
    : 'No NSE stocks available right now.'

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-[30px] p-6 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.24em] text-cyan">Stocks</p>
            <h1 className="mt-3 text-3xl font-semibold text-white md:text-4xl">NSE market board</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Search by company or symbol, scan the market board, and open an in-app trading screen with live quote,
              chart, and stock stats.
            </p>
          </div>
          <button
            onClick={() => loadStocks({ search: query, silent: true })}
            className="btn-secondary inline-flex items-center gap-2 !px-4 !py-2"
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Total NSE symbols</p>
            <p className="mt-2 text-2xl font-semibold text-white">{marketStats.total}</p>
          </div>
          <div className="rounded-2xl border border-cyan/20 bg-cyan/10 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan">Showing</p>
            <p className="mt-2 text-2xl font-semibold text-cyan">{marketStats.visible}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Search term</p>
            <p className="mt-2 truncate text-lg font-semibold text-white">{marketStats.query || 'None'}</p>
          </div>
        </div>

        <div className="mt-5 rounded-[28px] border border-white/10 bg-slate-950/40 p-3 md:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Search terminal</p>
              <p className="mt-1 text-sm text-slate-300">Find a stock quickly by symbol or full company name.</p>
            </div>
            <p className="rounded-full border border-cyan/20 bg-cyan/10 px-3 py-1 text-xs font-medium text-cyan">
              {hydratingIntelligence ? 'Indexing live intelligence' : 'Live NSE directory'}
            </p>
          </div>

          <label className="relative block">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-5">
              <Search className="h-4 w-4 text-slate-400" />
            </span>
            <input
              className="input-shell h-14 w-full rounded-[22px] !pl-16 pr-4 text-[15px]"
              placeholder="Search by symbol or company name, for example RELIANCE, TCS, INFY"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>
      ) : null}

      {loading ? (
        <div className="animate-pulse rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-slate-300">Loading NSE stock list...</div>
      ) : !stocks.length ? (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-slate-300">{noDataText}</div>
      ) : (
      <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
          <div className="grid grid-cols-[1.1fr_2.4fr_2fr_1.2fr] border-b border-white/10 bg-slate-950/40 px-4 py-4 text-xs uppercase tracking-[0.2em] text-slate-400">
            <p>Symbol</p>
            <p>Company</p>
            <p>AI intelligence</p>
            <p className="text-right">Trade View</p>
          </div>

          <div className="max-h-[560px] overflow-y-auto">
            {stocks.map((stock) => (
              (() => {
                const intelligence = intelligenceBySymbol[shortSymbolLabel(stock.symbol)]
                const recommendation =
                  intelligence?.analysis?.recommendation ||
                  (hydratingIntelligence ? 'Building live intelligence for this stock...' : 'No stored intelligence yet for this stock.')
                const sentiment = intelligence?.news?.overall_sentiment || (hydratingIntelligence ? 'Loading' : 'Unavailable')
                const trend = intelligence?.market?.trend || (hydratingIntelligence ? 'Indexing' : 'Unindexed')
                const lastUpdated = formatUpdatedAt(intelligence?.updated_at)

                return (
                  <Link
                    key={stock.symbol}
                    to={`/stocks/${encodeURIComponent(stock.symbol)}`}
                    className="grid grid-cols-[1.1fr_2.4fr_2fr_1.2fr] items-center gap-4 border-b border-white/5 px-4 py-4 transition hover:bg-white/[0.04]"
                  >
                    <div>
                      <p className="font-semibold text-white">{shortSymbolLabel(stock.symbol)}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">NSE Equity</p>
                    </div>

                    <div>
                      <p className="truncate text-sm text-slate-300">{stock.name || stock.symbol}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        {intelligenceLoading && !intelligence ? 'Loading intelligence state...' : `Last updated ${lastUpdated}`}
                      </p>
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${getTrendClasses(trend)}`}>
                          {trend}
                        </span>
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${getSentimentClasses(sentiment)}`}>
                          {sentiment}
                        </span>
                      </div>
                      <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-300">{recommendation}</p>
                    </div>

                    <div className="text-right">
                      <span className="inline-flex rounded-full border border-cyan/20 bg-cyan/10 px-3 py-1 text-sm font-medium text-cyan">
                        Open Chart
                      </span>
                    </div>
                  </Link>
                )
              })()
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export default StocksPage

