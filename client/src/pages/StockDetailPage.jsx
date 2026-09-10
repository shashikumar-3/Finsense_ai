import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchAgentResponse } from '../api/agentApi'
import { fetchStockIntelligence } from '../api/intelligenceApi'
import { fetchStock, fetchStockChart } from '../api/stocksApi'
import StockCandlestickChart from '../components/stock/StockCandlestickChart'
import StockLineChart from '../components/stock/StockLineChart'
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  getChangeClasses,
  shortSymbolLabel,
} from '../data/stocksData'

const RANGE_OPTIONS = [
  { label: '1D', value: '1d' },
  { label: '1W', value: '1w' },
  { label: '1M', value: '1m' },
  { label: '3M', value: '3m' },
  { label: '6M', value: '6m' },
  { label: '1Y', value: '1y' },
]
const CHART_TYPES = ['line', 'candles']

function getIntervalForRange(range) {
  switch (range) {
    case '1d':
      return '5m'
    case '1w':
      return '15m'
    case '1m':
    case '6m':
      return '1d'
    case '3m':
      return '1d'
    case '1y':
      return '1wk'
    case '3y':
    case '5y':
    case 'all':
      return '1wk'
    default:
      return '1d'
  }
}

function getTargetPointCount(range) {
  switch (range) {
    case '1d':
    case '1w':
    case '1m':
    case '3m':
    case '6m':
    case '1y':
      return 52
    default:
      return 52
  }
}

function aggregateChartPoints(points, targetCount) {
  if (!Array.isArray(points) || points.length <= targetCount) {
    return points
  }

  const bucketSize = Math.ceil(points.length / targetCount)
  const aggregated = []

  for (let index = 0; index < points.length; index += bucketSize) {
    const bucket = points.slice(index, index + bucketSize).filter(
      (point) =>
        Number.isFinite(point.open) &&
        Number.isFinite(point.high) &&
        Number.isFinite(point.low) &&
        Number.isFinite(point.close) &&
        point.open > 0 &&
        point.high > 0 &&
        point.low > 0 &&
        point.close > 0,
    )

    if (!bucket.length) {
      continue
    }

    aggregated.push({
      datetime: bucket[bucket.length - 1].datetime,
      open: bucket[0].open,
      high: Math.max(...bucket.map((point) => point.high)),
      low: Math.min(...bucket.map((point) => point.low)),
      close: bucket[bucket.length - 1].close,
      volume: bucket.reduce((total, point) => total + (Number.isFinite(point.volume) ? point.volume : 0), 0),
    })
  }

  return aggregated
}

function formatTime(value) {
  if (!value) {
    return '--'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '--'
  }

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatNewsDateTime(value) {
  if (!value) {
    return 'Unknown date'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value).replace('T', ' ')
  }

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatStructuredValue(value) {
  if (value === null || value === undefined || value === '') {
    return '--'
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? formatNumber(value) : String(value)
  }

  return String(value)
}

function formatAnalystAnswer(answer) {
  if (!answer) {
    return ''
  }

  return String(answer)
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/^[*-]\s+/gm, '')
    .replace(/^(View|Evidence|Risks|Next action)\s*:\s*/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function StockDetailPage() {
  const { symbol: routeSymbol } = useParams()
  const symbol = decodeURIComponent(routeSymbol || '')

  const [quote, setQuote] = useState(null)
  const [chartPoints, setChartPoints] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [intelligence, setIntelligence] = useState(null)
  const [intelligenceLoading, setIntelligenceLoading] = useState(true)
  const [intelligenceRefreshing, setIntelligenceRefreshing] = useState(false)
  const [newsBackfillRunning, setNewsBackfillRunning] = useState(false)
  const [agentQuestion, setAgentQuestion] = useState('')
  const [agentResponse, setAgentResponse] = useState(null)
  const [agentLoading, setAgentLoading] = useState(false)
  const [agentError, setAgentError] = useState('')
  const [chartRange, setChartRange] = useState('1m')
  const [chartType, setChartType] = useState('candles')

  const terminalUrl = useMemo(
    () =>
      `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(
        quote?.tradingViewSymbol || `NSE:${shortSymbolLabel(symbol)}`,
      )}`,
    [quote?.tradingViewSymbol, symbol],
  )

  const loadStockData = useCallback(
    async ({ silent = false } = {}) => {
      try {
        if (!silent) {
          setLoading(true)
        } else {
          setRefreshing(true)
        }

        setError('')
        const [quoteResult, chartResult] = await Promise.all([
          fetchStock(symbol),
          fetchStockChart(symbol, { range: chartRange, interval: getIntervalForRange(chartRange) }),
        ])
        setQuote(quoteResult || null)
        setChartPoints(chartResult.points || [])
      } catch (err) {
        setError(err.message || 'Unable to load stock details.')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [chartRange, symbol],
  )

  const loadIntelligence = useCallback(
    async ({ refresh = false, includeNews = true, cachedOnly = false } = {}) => {
      try {
        if (refresh) {
          setIntelligenceRefreshing(true)
        } else {
          setIntelligenceLoading(true)
        }

        const result = await fetchStockIntelligence(symbol, { refresh, includeNews, cachedOnly })
        const nextDocument = result?.document || (result?.symbol && result?.found !== false ? result : null)
        if (nextDocument) {
          setIntelligence(nextDocument)
        } else if (cachedOnly) {
          setIntelligence(null)
        }
        return result
      } catch (err) {
        setError(err.message || 'Unable to load stock intelligence.')
        return null
      } finally {
        setIntelligenceLoading(false)
        setIntelligenceRefreshing(false)
      }
    },
    [symbol],
  )

  useEffect(() => {
    loadStockData()
  }, [loadStockData])

  useEffect(() => {
    let cancelled = false

    async function loadIntelligenceFast() {
      setIntelligenceLoading(true)
      setError('')

      const cached = await loadIntelligence({ includeNews: true, cachedOnly: true })
      if (cancelled) {
        return
      }

      setIntelligenceLoading(false)
      setNewsBackfillRunning(true)

      const hasCachedDocument = Boolean(cached?.document || (cached?.symbol && cached?.found !== false))
      await loadIntelligence({
        includeNews: true,
        refresh: !hasCachedDocument,
      })

      if (!cancelled) {
        setNewsBackfillRunning(false)
      }
    }

    loadIntelligenceFast()

    return () => {
      cancelled = true
    }
  }, [loadIntelligence, loadStockData])

  useEffect(() => {
    const timer = setInterval(() => {
      loadStockData({ silent: true })
    }, 15000)

    return () => clearInterval(timer)
  }, [loadStockData])

  const changeClass = getChangeClasses(quote?.changePercent)
  const displayChartPoints = useMemo(
    () => aggregateChartPoints(chartPoints, getTargetPointCount(chartRange)),
    [chartPoints, chartRange],
  )
  const chartSummary = useMemo(() => {
    if (!displayChartPoints.length) {
      return {
        rangeHigh: null,
        rangeLow: null,
        rangeVolume: null,
      }
    }

    const highs = displayChartPoints.map((point) => point.high).filter(Number.isFinite)
    const lows = displayChartPoints.map((point) => point.low).filter(Number.isFinite)
    const volume = displayChartPoints.reduce((total, point) => total + (Number.isFinite(point.volume) ? point.volume : 0), 0)

    return {
      rangeHigh: highs.length ? Math.max(...highs) : null,
      rangeLow: lows.length ? Math.min(...lows) : null,
      rangeVolume: volume,
    }
  }, [displayChartPoints])
  const structuredMarketSummary = intelligence?.analysis?.market_summary_structured
  const structuredNewsSummary = intelligence?.analysis?.news_summary_structured

  async function handleAskAnalyst(event) {
    event.preventDefault()
    const question = agentQuestion.trim()

    if (!question) {
      setAgentError('Enter a question for the AI analyst.')
      return
    }

    try {
      setAgentLoading(true)
      setAgentError('')
      const result = await fetchAgentResponse(symbol, question)
      setAgentResponse(result)
    } catch (err) {
      setAgentError(err.message || 'Unable to generate AI analyst response.')
    } finally {
      setAgentLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link to="/stocks" className="btn-secondary inline-flex items-center gap-2 !px-4 !py-2">
          <ArrowLeft className="h-4 w-4" />
          Back to stocks
        </Link>
        <button
          onClick={() => loadStockData({ silent: true })}
          className="btn-secondary inline-flex items-center gap-2 !px-4 !py-2"
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>
      ) : null}

      <section className="glass-panel rounded-[30px] p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{quote?.exchange || 'NSE'}</p>
            <h1 className="mt-2 text-3xl font-semibold text-white md:text-4xl">{shortSymbolLabel(symbol)}</h1>
            <p className="mt-2 text-slate-300">{quote?.name || shortSymbolLabel(symbol)}</p>
          </div>
          <div className="rounded-2xl border border-cyan/20 bg-cyan/10 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan">Last update</p>
            <p className="mt-2 text-sm font-medium text-white">{formatTime(quote?.timestamp)}</p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-end gap-4">
          <p className="text-4xl font-semibold text-white">{formatCurrency(quote?.price, quote?.currency)}</p>
          <div className={`pb-1 text-sm font-semibold ${changeClass}`}>
            {formatCurrency(quote?.change, quote?.currency)} ({formatPercent(quote?.changePercent)})
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Open</p>
            <p className="mt-2 font-semibold text-white">{formatCurrency(quote?.open, quote?.currency)}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Day High</p>
            <p className="mt-2 font-semibold text-white">{formatCurrency(quote?.high, quote?.currency)}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Day Low</p>
            <p className="mt-2 font-semibold text-white">{formatCurrency(quote?.low, quote?.currency)}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Prev Close</p>
            <p className="mt-2 font-semibold text-white">{formatCurrency(quote?.previousClose, quote?.currency)}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Volume</p>
            <p className="mt-2 font-semibold text-white">{formatNumber(quote?.volume)}</p>
          </div>
        </div>
      </section>

      <section className="glass-panel rounded-[30px] p-5 md:p-7">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan">Chart</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">In-app market chart</h2>
            <p className="mt-2 text-sm text-slate-300">
              The chart stays inside the app. Use the controls inside the chart for time ranges or open the terminal.
            </p>
          </div>

          <div className="inline-flex rounded-[24px] border border-emerald-400/15 bg-emerald-950/25 p-1.5">
            {CHART_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => setChartType(type)}
                className={`rounded-[18px] px-4 py-2 text-sm font-medium capitalize transition ${
                  chartType === type
                    ? 'bg-emerald-400/18 text-emerald-200 ring-1 ring-inset ring-emerald-300/30'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {type === 'candles' ? 'Candlestick' : 'Line'}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Range High</p>
            <p className="mt-2 font-semibold text-white">{formatCurrency(chartSummary.rangeHigh, quote?.currency)}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Range Low</p>
            <p className="mt-2 font-semibold text-white">{formatCurrency(chartSummary.rangeLow, quote?.currency)}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Range Volume</p>
            <p className="mt-2 font-semibold text-white">{formatNumber(chartSummary.rangeVolume)}</p>
          </div>
        </div>

        {loading ? (
          <div className="animate-pulse rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-slate-300">Loading chart...</div>
        ) : !displayChartPoints.length ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-slate-300">
            No chart data available for this stock right now.
          </div>
        ) : chartType === 'candles' ? (
          <StockCandlestickChart
            points={displayChartPoints}
            rangeOptions={RANGE_OPTIONS}
            activeRange={chartRange}
            onRangeChange={setChartRange}
            terminalUrl={terminalUrl}
          />
        ) : (
          <StockLineChart
            points={displayChartPoints}
            rangeOptions={RANGE_OPTIONS}
            activeRange={chartRange}
            onRangeChange={setChartRange}
            terminalUrl={terminalUrl}
          />
        )}
      </section>

      <section className="glass-panel rounded-[30px] p-5 md:p-7">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan">Intelligence</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Unified analysis</h2>
            <p className="mt-2 text-sm text-slate-300">
              Combined recommendation built from the market engine and recent news pipeline.
            </p>
            {newsBackfillRunning ? (
              <p className="mt-2 text-xs text-slate-400">Refreshing market and news intelligence in the background...</p>
            ) : null}
          </div>

          <button
            onClick={() => loadIntelligence({ refresh: true })}
            className="btn-secondary inline-flex items-center gap-2 !px-4 !py-2"
            disabled={intelligenceRefreshing}
          >
            <RefreshCw className={`h-4 w-4 ${intelligenceRefreshing ? 'animate-spin' : ''}`} />
            Refresh analysis
          </button>
        </div>

        {intelligenceLoading ? (
          <div className="animate-pulse rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-slate-300">Loading unified analysis...</div>
        ) : !intelligence ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-slate-300">
            No intelligence available for this stock right now.
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-[26px] border border-cyan/20 bg-cyan/10 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan">Recommendation</p>
              <p className="mt-3 text-lg font-semibold text-white">{intelligence.analysis?.recommendation}</p>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Trend</p>
                <p className="mt-2 text-2xl font-semibold text-white">{intelligence.market?.trend || '--'}</p>
                <p className="mt-2 text-sm text-slate-400">RSI {intelligence.market?.rsi?.toFixed?.(2) || '--'}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Sentiment</p>
                <p className="mt-2 text-2xl font-semibold text-white">{intelligence.news?.overall_sentiment || '--'}</p>
                <p className="mt-2 text-sm text-slate-400">Hype {Math.round((intelligence.news?.hype_score || 0) * 100)}/100</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">News coverage</p>
                <p className="mt-2 text-2xl font-semibold text-white">{intelligence.news?.news_frequency_count ?? 0}</p>
                <p className="mt-2 text-sm text-slate-400">{intelligence.news?.provider || 'No provider'}</p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Market summary</p>
                {structuredMarketSummary?.is_valid ? (
                  <div className="mt-4 space-y-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-cyan">Overview</p>
                      <div className="mt-2 grid gap-2">
                        {structuredMarketSummary.overview.map((item) => (
                          <div key={item.label} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                            <span className="text-sm text-slate-400">{item.label}</span>
                            <span className="text-sm font-medium text-white">{formatStructuredValue(item.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-cyan">Trend signals</p>
                      <div className="mt-2 grid gap-2">
                        {structuredMarketSummary.trend_signals.map((item) => (
                          <div key={item.label} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                            <span className="text-sm text-slate-400">{item.label}</span>
                            <span className="text-sm font-medium text-white">{formatStructuredValue(item.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-cyan">Indicator snapshot</p>
                      <div className="mt-2 grid gap-2">
                        {structuredMarketSummary.indicator_snapshot.map((item) => (
                          <div key={item.label} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                            <span className="text-sm text-slate-400">{item.label}</span>
                            <span className="text-sm font-medium text-white">{formatStructuredValue(item.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-7 text-slate-300">{intelligence.analysis?.market_summary}</p>
                )}
              </div>
              <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">News summary</p>
                {structuredNewsSummary?.is_valid ? (
                  <div className="mt-4 space-y-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-cyan">Sentiment breakdown</p>
                      <div className="mt-2 grid gap-2">
                        {structuredNewsSummary.sentiment_breakdown.map((item) => (
                          <div key={item.label} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                            <span className="text-sm text-slate-400">{item.label}</span>
                            <span className="text-sm font-medium text-white">{formatStructuredValue(item.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-cyan">Coverage</p>
                      <div className="mt-2 grid gap-2">
                        {structuredNewsSummary.coverage.map((item) => (
                          <div key={item.label} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                            <span className="text-sm text-slate-400">{item.label}</span>
                            <span className="text-sm font-medium text-white">{formatStructuredValue(item.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-7 text-slate-300">{intelligence.analysis?.news_summary}</p>
                )}
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Ranked headlines</p>
              <div className="mt-4 space-y-3">
                {(intelligence.news?.top_headlines || []).map((headline) => (
                  <a
                    key={`${headline.url}-${headline.headline}`}
                    href={headline.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-2xl border border-white/10 bg-slate-950/35 p-4 transition hover:border-cyan/30 hover:bg-white/[0.04]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-medium text-white">{headline.headline}</p>
                      <span className="rounded-full bg-white/8 px-3 py-1 text-xs text-slate-300">
                        {headline.sentiment || 'Unknown'}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      {headline.source || 'Unknown source'} - {formatNewsDateTime(headline.published_date)}
                    </p>
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="glass-panel rounded-[30px] p-5 md:p-7">
        <div className="mb-5">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan">AI Analyst</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">FinRobot-style answer layer</h2>
          <p className="mt-2 text-sm text-slate-300">
            Ask one focused question. The backend uses your stock intelligence plus Gemini to generate a cached analyst response.
          </p>
        </div>

        <form onSubmit={handleAskAnalyst} className="space-y-4">
          <textarea
            value={agentQuestion}
            onChange={(event) => setAgentQuestion(event.target.value)}
            placeholder={`Example: Is ${shortSymbolLabel(symbol)} a short-term buy or should I wait?`}
            className="min-h-28 w-full rounded-[24px] border border-white/10 bg-slate-950/35 px-4 py-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan/30"
          />

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary min-w-44" disabled={agentLoading}>
              {agentLoading ? 'Analyzing...' : 'Ask AI analyst'}
            </button>
            {agentResponse?.cached ? (
              <span className="rounded-full border border-cyan/20 bg-cyan/10 px-3 py-1 text-xs font-medium text-cyan">
                Cached response
              </span>
            ) : null}
            {agentResponse?.response?.model ? (
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-slate-300">
                {agentResponse.response.model}
              </span>
            ) : null}
          </div>

          {agentError ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{agentError}</div>
          ) : null}

          {agentLoading ? (
            <div className="animate-pulse rounded-[24px] border border-white/10 bg-white/[0.03] p-5 text-slate-300">
              Generating analyst response...
            </div>
          ) : agentResponse?.response?.answer ? (
            <div className="rounded-[24px] border border-cyan/20 bg-cyan/10 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan">Response</p>
              <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white">
                {formatAnalystAnswer(agentResponse.response.answer)}
              </div>
            </div>
          ) : null}
        </form>
      </section>
    </div>
  )
}

export default StockDetailPage
