import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchAgentResponse } from '../api/agentApi'
import { fetchStockIntelligence } from '../api/intelligenceApi'
import { fetchStock, fetchStockChart } from '../api/stocksApi'
import { isCurrentNews, needsNewsRefresh, newsDisplayState } from '../lib/newsFreshness'
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
    case '1d': return '5m'
    case '1w': return '15m'
    case '1m':
    case '6m': return '1d'
    case '3m': return '1d'
    case '1y': return '1wk'
    case '3y':
    case '5y':
    case 'all': return '1wk'
    default: return '1d'
  }
}

function getTargetPointCount() { return 52 }

function aggregateChartPoints(points, targetCount) {
  if (!Array.isArray(points) || points.length <= targetCount) return points
  const bucketSize = Math.ceil(points.length / targetCount)
  const aggregated = []
  for (let index = 0; index < points.length; index += bucketSize) {
    const bucket = points.slice(index, index + bucketSize).filter(
      (p) => Number.isFinite(p.open) && Number.isFinite(p.high) && Number.isFinite(p.low) && Number.isFinite(p.close)
        && p.open > 0 && p.high > 0 && p.low > 0 && p.close > 0,
    )
    if (!bucket.length) continue
    aggregated.push({
      datetime: bucket[bucket.length - 1].datetime,
      open: bucket[0].open,
      high: Math.max(...bucket.map((p) => p.high)),
      low: Math.min(...bucket.map((p) => p.low)),
      close: bucket[bucket.length - 1].close,
      volume: bucket.reduce((t, p) => t + (Number.isFinite(p.volume) ? p.volume : 0), 0),
    })
  }
  return aggregated
}

function formatTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function formatNewsDateTime(value) {
  if (!value) return 'Unknown date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ')
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatStructuredValue(value) {
  if (value === null || value === undefined || value === '') return '--'
  if (typeof value === 'number') return Number.isInteger(value) ? formatNumber(value, 0) : formatNumber(value, 2)
  return String(value)
}

function formatAnalystAnswer(answer) {
  if (!answer) return ''
  return String(answer)
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/^###?\s+/gm, '')
    .replace(/^(View|Evidence|Risks|Next action)\s*:\s*/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const QUICK_QUESTIONS = [
  'Is this a short-term buy or should I wait?',
  'What are the key risks right now?',
  'What does the news sentiment say about this stock?',
  'Give me a brief market outlook for this stock.',
]

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
  const [intelligenceStatus, setIntelligenceStatus] = useState('')
  const [agentQuestion, setAgentQuestion] = useState('')
  const [agentResponse, setAgentResponse] = useState(null)
  const [agentMessages, setAgentMessages] = useState([])
  const [agentLoading, setAgentLoading] = useState(false)
  const [agentError, setAgentError] = useState('')
  const [chartRange, setChartRange] = useState('1m')
  const [chartType, setChartType] = useState('candles')

  const intelligenceAbortRef = useRef(false)
  const agentAbortRef = useRef(null)
  const intelligenceRef = useRef(null)

  const terminalUrl = useMemo(
    () => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(quote?.tradingViewSymbol || `NSE:${shortSymbolLabel(symbol)}`)}`,
    [quote?.tradingViewSymbol, symbol],
  )

  const loadStockData = useCallback(
    async ({ silent = false } = {}) => {
      try {
        if (!silent) setLoading(true)
        else setRefreshing(true)
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
          setIntelligenceStatus('Refreshing market and news intelligence...')
        }
        const result = await fetchStockIntelligence(symbol, { refresh, includeNews, cachedOnly })
        const nextDocument = result?.document || (result?.symbol && result?.found !== false ? result : null)
        if (nextDocument) {
          const previousNews = intelligenceRef.current?.news
          const nextArticles = nextDocument.news?.articles || nextDocument.news?.top_headlines || []
          const previousArticles = previousNews?.articles || previousNews?.top_headlines || []
          const preservedNews = previousArticles.length && (!nextDocument.news?.is_valid || !nextArticles.length)
            ? previousNews
            : nextDocument.news
          const mergedDocument = preservedNews && preservedNews !== nextDocument.news
            ? { ...nextDocument, news: preservedNews }
            : nextDocument
          intelligenceRef.current = mergedDocument
          setIntelligence(mergedDocument)
        }
        else if (cachedOnly) setIntelligence(null)
        return result
      } catch (err) {
        if (!cachedOnly) setError(err.message || 'Unable to load stock intelligence.')
        return null
      } finally {
        setIntelligenceRefreshing(false)
        setIntelligenceStatus('')
      }
    },
    [symbol],
  )

  // Cache-first intelligence loading: show cached instantly, fetch fresh only if missing
  useEffect(() => {
    intelligenceAbortRef.current = false
    async function bootstrap() {
      setIntelligenceLoading(true)
      setIntelligenceStatus('Checking cached analysis...')
      setError('')

      const cached = await loadIntelligence({ includeNews: true, cachedOnly: true })
      if (intelligenceAbortRef.current) return

      const hasCached = Boolean(cached?.document || (cached?.symbol && cached?.found !== false))
      if (hasCached) {
        setIntelligenceLoading(false)
        const cachedDocument = cached?.document || cached
        if (needsNewsRefresh(cachedDocument?.news)) {
          setIntelligenceStatus('Refreshing current news...')
          await loadIntelligence({ includeNews: true })
        } else {
          setIntelligenceStatus('')
        }
      } else {
        setIntelligenceStatus('Fetching live market data and news (first load ~15s)...')
        await loadIntelligence({ includeNews: true })
        if (!intelligenceAbortRef.current) {
          setIntelligenceLoading(false)
          setIntelligenceStatus('')
        }
      }
    }
    bootstrap()
    return () => { intelligenceAbortRef.current = true }
  }, [loadIntelligence])

  useEffect(() => { loadStockData() }, [loadStockData])

  useEffect(() => {
    const timer = setInterval(() => loadStockData({ silent: true }), 15000)
    return () => clearInterval(timer)
  }, [loadStockData])

  useEffect(() => {
    return () => {
      if (agentAbortRef.current) {
        agentAbortRef.current.abort()
      }
    }
  }, [])

  const changeClass = getChangeClasses(quote?.changePercent)
  const displayChartPoints = useMemo(
    () => aggregateChartPoints(chartPoints, getTargetPointCount(chartRange)),
    [chartPoints, chartRange],
  )
  const chartSummary = useMemo(() => {
    if (!displayChartPoints.length) return { rangeHigh: null, rangeLow: null, rangeVolume: null }
    const highs = displayChartPoints.map((p) => p.high).filter(Number.isFinite)
    const lows = displayChartPoints.map((p) => p.low).filter(Number.isFinite)
    const volume = displayChartPoints.reduce((t, p) => t + (Number.isFinite(p.volume) ? p.volume : 0), 0)
    return { rangeHigh: highs.length ? Math.max(...highs) : null, rangeLow: lows.length ? Math.min(...lows) : null, rangeVolume: volume }
  }, [displayChartPoints])

  const structuredMarketSummary = intelligence?.analysis?.market_summary_structured
  const structuredNewsSummary = intelligence?.analysis?.news_summary_structured
  const marketSummary = useMemo(() => {
    if (structuredMarketSummary?.is_valid) return structuredMarketSummary
    if (!Number.isFinite(Number(quote?.price))) return structuredMarketSummary
    return {
      is_valid: true,
      overview: [
        { label: 'Price', value: quote.price },
        { label: 'Previous close', value: quote.previousClose },
        { label: 'Day high', value: quote.high },
        { label: 'Day low', value: quote.low },
        { label: 'Volume', value: quote.volume },
      ],
      trend_signals: [],
      indicator_snapshot: [],
    }
  }, [quote, structuredMarketSummary])

  async function handleAskAnalyst(event) {
    event?.preventDefault()
    if (agentLoading) return
    const question = agentQuestion.trim()
    if (!question) { setAgentError('Enter a question for the AI analyst.'); return }

    if (agentAbortRef.current) {
      agentAbortRef.current.abort()
    }
    const controller = new AbortController()
    agentAbortRef.current = controller

    try {
      setAgentLoading(true)
      setAgentError('')
      const result = await fetchAgentResponse(symbol, question, {
        fast: false,
        history: agentMessages.map(({ role, content }) => ({ role, content })),
        signal: controller.signal,
      })
      const answer = formatAnalystAnswer(result?.answer)
      if (!answer) {
        throw new Error('The stock analyst returned an empty response. Please try again.')
      }
      setAgentMessages((messages) => [
        ...messages,
        { role: 'user', content: question },
        { role: 'assistant', content: answer },
      ])
      setAgentResponse(result)
      setAgentQuestion('')
    } catch (err) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        return
      }
      setAgentError(err.message || 'Unable to generate AI analyst response.')
    } finally {
      if (agentAbortRef.current === controller) {
        agentAbortRef.current = null
        setAgentLoading(false)
      }
    }
  }

  function handleTextareaKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleAskAnalyst(event)
    }
  }

  function handleQuickQuestion(q) {
    setAgentQuestion(q)
    setAgentError('')
  }

  function clearAnalystConversation() {
    setAgentMessages([])
    setAgentResponse(null)
    setAgentQuestion('')
    setAgentError('')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link to="/stocks" className="btn-secondary inline-flex items-center gap-2 !px-4 !py-2">
          <ArrowLeft className="h-4 w-4" />
          Back to stocks
        </Link>
        <button onClick={() => loadStockData({ silent: true })} className="btn-secondary inline-flex items-center gap-2 !px-4 !py-2" disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div> : null}

      {/* Quote */}
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
          {[['Open', quote?.open], ['Day High', quote?.high], ['Day Low', quote?.low], ['Prev Close', quote?.previousClose]].map(([label, val]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{label}</p>
              <p className="mt-2 font-semibold text-white">{formatCurrency(val, quote?.currency)}</p>
            </div>
          ))}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Volume</p>
            <p className="mt-2 font-semibold text-white">{formatNumber(quote?.volume, 0)}</p>
          </div>
        </div>
      </section>

      {/* Chart */}
      <section className="glass-panel rounded-[30px] p-5 md:p-7">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan">Chart</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">In-app market chart</h2>
            <p className="mt-2 text-sm text-slate-300">The chart stays inside the app. Use the controls inside the chart for time ranges or open the terminal.</p>
          </div>
          <div className="inline-flex rounded-[24px] border border-emerald-400/15 bg-emerald-950/25 p-1.5">
            {CHART_TYPES.map((type) => (
              <button key={type} onClick={() => setChartType(type)}
                className={`rounded-[18px] px-4 py-2 text-sm font-medium capitalize transition ${chartType === type ? 'bg-emerald-400/18 text-emerald-200 ring-1 ring-inset ring-emerald-300/30' : 'text-slate-300 hover:text-white'}`}>
                {type === 'candles' ? 'Candlestick' : 'Line'}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-400">Range High</p><p className="mt-2 font-semibold text-white">{formatCurrency(chartSummary.rangeHigh, quote?.currency)}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-400">Range Low</p><p className="mt-2 font-semibold text-white">{formatCurrency(chartSummary.rangeLow, quote?.currency)}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-400">Range Volume</p><p className="mt-2 font-semibold text-white">{formatNumber(chartSummary.rangeVolume, 0)}</p></div>
        </div>
        {loading ? (
          <div className="animate-pulse rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-slate-300">Loading chart...</div>
        ) : !displayChartPoints.length ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-slate-300">No chart data available for this stock right now.</div>
        ) : chartType === 'candles' ? (
          <StockCandlestickChart points={displayChartPoints} rangeOptions={RANGE_OPTIONS} activeRange={chartRange} onRangeChange={setChartRange} terminalUrl={terminalUrl} />
        ) : (
          <StockLineChart points={displayChartPoints} rangeOptions={RANGE_OPTIONS} activeRange={chartRange} onRangeChange={setChartRange} terminalUrl={terminalUrl} />
        )}
      </section>

      {/* Unified analysis */}
      <section className="glass-panel rounded-[30px] p-5 md:p-7">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan">Intelligence</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Unified analysis</h2>
            <p className="mt-2 text-sm text-slate-300">Combined recommendation built from the market engine and recent news pipeline.</p>
            {intelligenceStatus ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-cyan/70">
                <span className="inline-block h-1.5 w-1.5 animate-ping rounded-full bg-cyan/60" />
                {intelligenceStatus}
              </p>
            ) : null}
          </div>
          <button
            onClick={() => loadIntelligence({ refresh: true })}
            className="btn-secondary inline-flex items-center gap-2 !px-4 !py-2"
            disabled={intelligenceRefreshing || intelligenceLoading}
          >
            <RefreshCw className={`h-4 w-4 ${intelligenceRefreshing ? 'animate-spin' : ''}`} />
            Refresh analysis
          </button>
        </div>

        {intelligenceLoading ? (
          <div className="space-y-3">
            <div className="animate-pulse rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-slate-300">{intelligenceStatus || 'Loading unified analysis...'}</div>
            <div className="animate-pulse grid gap-4 lg:grid-cols-3">
              {[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl border border-white/10 bg-white/[0.02]" />)}
            </div>
          </div>
        ) : !intelligence ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-slate-300">
            No intelligence available for this stock right now.{' '}
            <button onClick={() => loadIntelligence({ refresh: true })} className="ml-1 underline underline-offset-2 hover:text-white">Try fetching now.</button>
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
                <p className="mt-2 text-2xl font-semibold text-white">{newsDisplayState(intelligence.news) !== 'unavailable' ? intelligence.news?.overall_sentiment || '--' : 'Unavailable'}</p>
                <p className="mt-2 text-sm text-slate-400">{newsDisplayState(intelligence.news) === 'historical' ? 'Historical coverage; not a current catalyst.' : newsDisplayState(intelligence.news) === 'current' ? `Hype ${Math.round((intelligence.news?.hype_score || 0) * 100)}/100` : 'Recent news is unavailable.'}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">News coverage</p>
                <p className="mt-2 text-2xl font-semibold text-white">{newsDisplayState(intelligence.news) !== 'unavailable' ? intelligence.news?.news_frequency_count ?? 0 : '--'}</p>
                <p className="mt-2 text-sm text-slate-400">{intelligence.news?.provider || 'No provider'} · {newsDisplayState(intelligence.news)}</p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Market summary</p>
                {marketSummary?.is_valid ? (
                  <div className="mt-4 space-y-4">
                    {[['Overview', marketSummary.overview], ['Trend signals', marketSummary.trend_signals], ['Indicator snapshot', marketSummary.indicator_snapshot]].filter(([, items]) => items?.length).map(([title, items]) => (
                      <div key={title}>
                        <p className="text-xs uppercase tracking-[0.16em] text-cyan">{title}</p>
                        <div className="mt-2 grid gap-2">
                          {items.map((item) => (
                            <div key={item.label} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                              <span className="text-sm text-slate-400">{item.label}</span>
                              <span className="text-sm font-medium text-white">{formatStructuredValue(item.value)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-7 text-slate-300">{intelligence.analysis?.market_summary}</p>
                )}
              </div>
              <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">News summary</p>
                {structuredNewsSummary?.is_valid ? (
                  <div className="mt-4 space-y-4">
                    {[['Sentiment breakdown', structuredNewsSummary.sentiment_breakdown], ['Coverage', structuredNewsSummary.coverage]].map(([title, items]) => (
                      <div key={title}>
                        <p className="text-xs uppercase tracking-[0.16em] text-cyan">{title}</p>
                        <div className="mt-2 grid gap-2">
                          {items.map((item) => (
                            <div key={item.label} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                              <span className="text-sm text-slate-400">{item.label}</span>
                              <span className="text-sm font-medium text-white">{formatStructuredValue(item.value)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-7 text-slate-300">{intelligence.analysis?.news_summary}</p>
                )}
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Ranked headlines</p>
              <div className="mt-4 space-y-3">
                {(newsDisplayState(intelligence.news) !== 'unavailable' ? (intelligence.news?.top_headlines || []).slice(0, 7) : []).map((headline) => (
                  <a key={`${headline.url}-${headline.headline}`} href={headline.url} target="_blank" rel="noreferrer"
                    className="block rounded-2xl border border-white/10 bg-slate-950/35 p-4 transition hover:border-cyan/30 hover:bg-white/[0.04]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-medium text-white">{headline.headline}</p>
                      <span className="rounded-full bg-white/8 px-3 py-1 text-xs text-slate-300">{headline.sentiment || 'Unknown'}</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">{newsDisplayState(intelligence.news) === 'historical' ? 'Historical' : 'Current'} · {headline.source || 'Unknown source'} - {formatNewsDateTime(headline.published_date)}</p>
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* AI Analyst chatbot */}
      <section className="glass-panel rounded-[30px] p-5 md:p-7">
        <div className="mb-5">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan">AI Analyst</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Ask the analyst</h2>
          <p className="mt-2 text-sm text-slate-300">
            Ask a focused question about {shortSymbolLabel(symbol)}. The analyst keeps the conversation grounded in this stock's available market data and news.{' '}
            <span className="text-slate-500">Press Enter to send; Shift+Enter adds a new line.</span>
          </p>
        </div>

        {/* Quick question chips */}
        <div className="mb-4 flex flex-wrap gap-2">
          {QUICK_QUESTIONS.map((q) => (
            <button key={q} type="button" onClick={() => handleQuickQuestion(q)}
              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-300 transition hover:border-cyan/30 hover:bg-cyan/5 hover:text-white">
              {q}
            </button>
          ))}
        </div>

        <form onSubmit={handleAskAnalyst} className="space-y-4">
          <textarea
            value={agentQuestion}
            onChange={(event) => setAgentQuestion(event.target.value)}
            onKeyDown={handleTextareaKeyDown}
            placeholder={`Example: Is ${shortSymbolLabel(symbol)} a short-term buy or should I wait?`}
            className="min-h-28 w-full rounded-[24px] border border-white/10 bg-slate-950/35 px-4 py-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan/30"
          />

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary min-w-44" disabled={agentLoading}>
              {agentLoading ? (
                <span className="inline-flex items-center gap-2">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Analyzing...
                </span>
              ) : 'Ask AI analyst'}
            </button>
            {agentResponse?.cached ? (
              <span className="rounded-full border border-cyan/20 bg-cyan/10 px-3 py-1 text-xs font-medium text-cyan">Cached response</span>
            ) : null}
            {agentResponse?.model ? (
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-slate-300">{agentResponse.model}</span>
            ) : null}
          </div>

          {agentError ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{agentError}</div> : null}

          {agentMessages.length ? (
            <div className="space-y-3" aria-live="polite">
              {agentMessages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`rounded-[22px] border p-4 ${message.role === 'user' ? 'ml-8 border-cyan/20 bg-cyan/10' : 'mr-8 border-white/10 bg-white/[0.04]'}`}>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-400">{message.role === 'user' ? 'You' : 'AI analyst'}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-white">{message.content}</p>
                </div>
              ))}
            </div>
          ) : null}
          {agentLoading ? (
            <div className="animate-pulse rounded-[24px] border border-white/10 bg-white/[0.03] p-5 text-slate-300">Generating analyst response...</div>
          ) : !agentMessages.length && agentResponse?.answer ? (
            <div className="rounded-[24px] border border-cyan/20 bg-cyan/10 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan">Response</p>
              <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white">{formatAnalystAnswer(agentResponse.answer)}</div>
            </div>
          ) : null}
          {agentMessages.length ? <button type="button" className="btn-secondary !px-3 !py-2 text-xs" onClick={clearAnalystConversation}>Start new conversation</button> : null}
        </form>
      </section>
    </div>
  )
}

export default StockDetailPage
