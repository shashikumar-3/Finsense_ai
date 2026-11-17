import { RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchStockIntelligenceBatch } from '../api/intelligenceApi'
import { fetchNseStocks } from '../api/stocksApi'
import { shortSymbolLabel } from '../data/stocksData'
import { newsDisplayState } from '../lib/newsFreshness'

const STOCK_LIST_LIMIT = 24
const INTELLIGENCE_BATCH_SIZE = 24

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
  const [hydratingIntelligence, setHydratingIntelligence] = useState(false)
  const [directoryStale, setDirectoryStale] = useState(false)
  const stockRequestRef = useRef(0)
  const intelligenceBySymbolRef = useRef({})
  const intelligenceInFlightRef = useRef(new Map())

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

      intelligenceBySymbolRef.current = next

      return next
    })
  }, [])

  const loadStocks = useCallback(async ({ search = '', silent = false } = {}) => {
    const requestId = ++stockRequestRef.current
    try {
      if (!silent) {
        setLoading(true)
      } else {
        setRefreshing(true)
      }

      setError('')
      setStocks([])
      setTotal(0)
      const data = await fetchNseStocks({ search, limit: STOCK_LIST_LIMIT, offset: 0 })
      if (requestId !== stockRequestRef.current) return
      setStocks(data.stocks || [])
      setTotal(Number(data.total) || 0)
      setDirectoryStale(data.stale === true)
    } catch (err) {
      if (requestId !== stockRequestRef.current) return
      setStocks([])
      setTotal(0)
      setDirectoryStale(false)
      setError(err.message || 'Unable to load stocks.')
    } finally {
      if (requestId === stockRequestRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
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
    let cancelled = false
    const controller = new AbortController()
    const requestToken = {}
    let requestedSymbols = []

    async function hydrateVisibleStocks() {
      if (loading || !stocks.length) {
        return
      }

      const missingSymbols = stocks
        .map((stock) => shortSymbolLabel(stock.symbol))
        .filter((symbol) => !intelligenceBySymbolRef.current[symbol] && !intelligenceInFlightRef.current.has(symbol))

      if (!missingSymbols.length) {
        return
      }

      setHydratingIntelligence(true)
      requestedSymbols = missingSymbols
      missingSymbols.forEach((symbol) => intelligenceInFlightRef.current.set(symbol, requestToken))

      try {
        for (let index = 0; index < missingSymbols.length; index += INTELLIGENCE_BATCH_SIZE) {
          if (cancelled || controller.signal.aborted) {
            return
          }

          const batch = missingSymbols.slice(index, index + INTELLIGENCE_BATCH_SIZE)
          const batchItems = await fetchStockIntelligenceBatch(batch, {
            includeNews: true,
            // The stock board must be able to refresh stale/missing news. The
            // backend still reuses fresh records, so this does not force a
            // provider request for every render.
            cachedOnly: false,
            signal: controller.signal,
          })

          if (cancelled) {
            return
          }

          mergeIntelligenceItems(batchItems.filter((item) => item?.document))
        }
      } catch {
      } finally {
        requestedSymbols.forEach((symbol) => {
          if (intelligenceInFlightRef.current.get(symbol) === requestToken) {
            intelligenceInFlightRef.current.delete(symbol)
          }
        })
        if (!cancelled) {
          setHydratingIntelligence(false)
        }
      }
    }

    hydrateVisibleStocks()

    return () => {
      cancelled = true
      requestedSymbols.forEach((symbol) => {
        if (intelligenceInFlightRef.current.get(symbol) === requestToken) {
          intelligenceInFlightRef.current.delete(symbol)
        }
      })
      controller.abort()
    }
  }, [loading, mergeIntelligenceItems, stocks])

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
              {hydratingIntelligence ? 'Indexing live intelligence' : directoryStale ? 'Stale NSE cache' : 'Live NSE directory'}
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

      {directoryStale && !error ? (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-200">The official NSE directory could not be refreshed. Showing the last known supported directory; refresh again later to retry.</div>
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
                const newsState = newsDisplayState(intelligence?.news)
                const recommendation =
                  newsState === 'current' ? intelligence?.analysis?.recommendation :
                  newsState === 'historical' ? 'Recent news is unavailable; cached articles are historical only.' :
                  (hydratingIntelligence ? 'Building live intelligence for this stock...' : 'No stored intelligence yet for this stock.')
                const sentiment = newsState === 'current' ? intelligence?.news?.overall_sentiment || 'Unknown' : (hydratingIntelligence ? 'Loading' : 'Unavailable')
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
                        {!intelligence ? (hydratingIntelligence ? 'Loading intelligence state...' : 'Not indexed') : `Last updated ${lastUpdated}`}
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

