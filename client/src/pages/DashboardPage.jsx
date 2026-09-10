import { ArrowRight, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchIntelligenceStoreStats, fetchStockIntelligence, refreshStockIntelligence } from '../api/intelligenceApi'
import MetricCard from '../components/MetricCard'
import SectionCard from '../components/SectionCard'
import { AllocationChart, TrendChart } from '../components/Charts'
import { indianStockSymbols, shortSymbolLabel } from '../data/stocksData'

const FEATURED_SYMBOLS = indianStockSymbols.slice(0, 4)

function buildSectorAllocation(items) {
  const counts = new Map()
  const total = items.length || 1
  const colors = ['#60a5fa', '#5eead4', '#fbbf24', '#fb7185', '#94a3b8', '#2dd4bf']

  for (const item of items) {
    const sector = item?.document?.market?.sector || 'Unknown'
    counts.set(sector, (counts.get(sector) || 0) + 1)
  }

  return [...counts.entries()].map(([name, count], index) => ({
    name,
    value: Number(((count / total) * 100).toFixed(1)),
    color: colors[index % colors.length],
  }))
}

function DashboardPage() {
  const [items, setItems] = useState([])
  const [storeStats, setStoreStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadDashboard() {
      try {
        setLoading(true)
        setError('')

        const intelligenceItems = await Promise.all(
          FEATURED_SYMBOLS.map((symbol) =>
            fetchStockIntelligence(symbol, { includeNews: true, cachedOnly: true }),
          ),
        )
        const statsResult = await fetchIntelligenceStoreStats()

        if (cancelled) {
          return
        }

        setItems(intelligenceItems.filter((item) => item?.document))
        setStoreStats(statsResult)
        setLoading(false)

        setBackgroundRefreshing(true)
        const refreshedItems = await Promise.all(
          FEATURED_SYMBOLS.map((symbol) => fetchStockIntelligence(symbol, { includeNews: true })),
        )

        if (cancelled) {
          return
        }

        setItems(refreshedItems.filter((item) => item?.document))
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Unable to load dashboard intelligence.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          setBackgroundRefreshing(false)
        }
      }
    }

    loadDashboard()

    return () => {
      cancelled = true
    }
  }, [])

  async function handleRefresh() {
    try {
      setRefreshing(true)
      setError('')
      const [batchResult, statsResult] = await Promise.all([
        refreshStockIntelligence({
          symbols: FEATURED_SYMBOLS,
          includeNews: true,
        }),
        fetchIntelligenceStoreStats(),
      ])
      setItems(batchResult.items || [])
      setStoreStats(statsResult)
    } catch (err) {
      setError(err.message || 'Unable to refresh dashboard intelligence.')
    } finally {
      setRefreshing(false)
    }
  }

  const documents = useMemo(() => items.map((item) => item.document).filter(Boolean), [items])
  const sectorAllocation = useMemo(() => buildSectorAllocation(items), [items])
  const signalPoints = useMemo(
    () =>
      documents.map((document) => ({
        month: shortSymbolLabel(document.symbol),
        wealth: Number(((document.news?.hype_score || 0) * 100).toFixed(1)),
        confidence: Number((document.market?.rsi || 0).toFixed(1)),
      })),
    [documents],
  )

  const heroMetrics = useMemo(() => {
    const averageHype =
      documents.length > 0
        ? documents.reduce((total, document) => total + (document.news?.hype_score || 0), 0) / documents.length
        : 0
    const bearishCount = documents.filter((document) => document.market?.trend === 'Bearish').length
    const newsReady = documents.filter((document) => document.news?.is_valid).length

    return [
      {
        label: 'Tracked intelligence',
        value: String(documents.length),
        change: `${newsReady}/${documents.length || FEATURED_SYMBOLS.length} with news`,
        detail: 'Featured dashboard symbols currently indexed with combined market and news reasoning.',
      },
      {
        label: 'Average hype score',
        value: `${Math.round(averageHype * 100)} / 100`,
        change: averageHype >= 0.67 ? 'Elevated' : averageHype >= 0.34 ? 'Moderate' : 'Calm',
        detail: 'Cross-symbol measure of how intense the current narrative flow is across the watchlist.',
      },
      {
        label: 'Bearish setups',
        value: String(bearishCount),
        change: `${documents.length - bearishCount} not bearish`,
        detail: 'Count of tracked names where the technical stack currently resolves to a bearish trend.',
      },
    ]
  }, [documents])

  const spotlightCards = useMemo(
    () =>
      documents.slice(0, 3).map((document, index) => ({
        symbol: shortSymbolLabel(document.symbol),
        companyName: document.company_name,
        tag: ['Market + news', 'Risk lens', 'Reasoning'][index] || 'Signal',
        text: document.analysis?.recommendation || document.analysis?.market_summary || 'Analysis unavailable.',
        accent: ['from-sky/30 to-sky/5', 'from-aqua/30 to-aqua/5', 'from-gold/30 to-gold/5'][index] || 'from-sky/30 to-sky/5',
      })),
    [documents],
  )

  const insightFeed = useMemo(
    () =>
      documents.flatMap((document) =>
        (document.news?.top_headlines || []).slice(0, 1).map((headline) => ({
          key: `${document.symbol}-${headline.url}`,
          symbol: shortSymbolLabel(document.symbol),
          title: headline.headline,
          summary: `${document.company_name}: ${document.analysis?.recommendation || 'Review this stock setup.'}`,
          severity: headline.sentiment || document.news?.overall_sentiment || 'Neutral',
        })),
      ),
    [documents],
  )

  return (
    <div>
      <section className="hero-shell mb-8 min-h-[620px] px-5 py-6 md:px-8 md:py-8 lg:px-12 lg:py-10">
        <div className="tech-line left-6 top-16 hidden h-28 w-28 lg:block" />
        <div className="tech-line bottom-14 right-10 hidden h-32 w-32 lg:block" />

        <div className="relative z-10 flex min-h-[430px] flex-col justify-center lg:w-[52%]">
          <div className="hero-badge inline-flex w-fit items-center gap-2 rounded-full px-4 py-2 text-xs uppercase tracking-[0.28em] text-cyan">
            Overview
          </div>

          <h1 className="mt-8 max-w-[11ch] font-display text-5xl font-semibold leading-[0.98] tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">
            A cleaner signal layer for investing decisions
          </h1>

          <p className="mt-8 max-w-xl text-base leading-8 text-slate-300 md:text-lg">
            FinSense AI now pulls live stock intelligence for the featured watchlist,
            combining technical posture, recent news, and an advisor-style recommendation
            into one signal layer.
          </p>
          {backgroundRefreshing ? (
            <p className="mt-4 text-sm text-slate-400">
              Refreshing featured intelligence in the background...
            </p>
          ) : null}

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <button onClick={handleRefresh} className="btn-primary min-w-44" disabled={refreshing}>
              <span className="inline-flex items-center gap-2">
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh briefing
              </span>
            </button>
            <Link to="/stocks" className="btn-secondary min-w-44 text-center">
              Open stock board
            </Link>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] lg:block">
          <div className="hex-orb absolute left-[18%] top-[18%] opacity-70" />
          <div className="hex-orb absolute left-[42%] top-[10%] h-[21rem] w-[18rem]" />
          <div className="absolute left-[24%] top-[36%] h-44 w-44 rounded-full bg-aqua/12 blur-3xl" />
          <div className="absolute left-[48%] top-[22%] h-40 w-40 rounded-full bg-cyan/10 blur-3xl" />
          <div className="absolute bottom-[20%] right-[18%] h-24 w-24 rounded-[28px] border border-white/8 bg-white/[0.03] backdrop-blur-xl" />
          <div className="absolute bottom-[12%] right-[6%] h-20 w-20 rounded-[24px] border border-white/8 bg-white/[0.03] backdrop-blur-xl" />
        </div>

        <div className="relative z-10 mt-12 grid gap-4 md:grid-cols-3">
          {heroMetrics.map((metric) => (
            <MetricCard key={metric.label} {...metric} />
          ))}
        </div>
      </section>

      {error ? (
        <div className="mb-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>
      ) : null}

      <div className="page-grid">
        <SectionCard
          title="Signal snapshot"
          subtitle="Hype intensity versus RSI across the live featured watchlist."
          action={
            <span className="rounded-full border border-cyan/20 bg-cyan/10 px-3 py-1 text-xs font-medium text-cyan">
              {storeStats?.item_count || 0} stored documents
            </span>
          }
        >
          {loading ? (
            <div className="animate-pulse rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-slate-300">Loading dashboard intelligence...</div>
          ) : (
            <TrendChart data={signalPoints} />
          )}
        </SectionCard>

        <SectionCard title="Sector mix" subtitle="Distribution of the live featured symbols by sector.">
          {loading ? (
            <div className="animate-pulse rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-slate-300">Preparing sector breakdown...</div>
          ) : (
            <>
              <AllocationChart data={sectorAllocation} />
              <div className="mt-2 space-y-3">
                {sectorAllocation.map((item) => (
                  <div key={item.name} className="elevate-hover rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-sm text-slate-300">{item.name}</span>
                    </div>
                    <span className="text-sm font-semibold text-white">{item.value}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <SectionCard
          title="Intelligence modules"
          subtitle="Each live card is generated from the current stock-level market and news document."
        >
          <div className="grid gap-4 md:grid-cols-3">
            {spotlightCards.map((card) => (
              <div
                key={`${card.symbol}-${card.companyName}`}
                className={`elevate-hover rounded-[26px] border border-white/10 bg-gradient-to-b ${card.accent} p-5`}
              >
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.22em] text-slate-200">
                    {card.tag}
                  </span>
                  <Sparkles className="h-4 w-4 text-slate-300" />
                </div>
                <h3 className="mt-6 font-display text-xl text-white">{card.symbol}</h3>
                <p className="mt-2 text-sm text-slate-300">{card.companyName}</p>
                <p className="mt-3 text-sm leading-7 text-slate-300">{card.text}</p>
                <Link to={`/stocks/${encodeURIComponent(card.symbol)}`} className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-cyan">
                  Explore module <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="AI feed"
          subtitle="Recent top headlines and the matching recommendation pulled from each stock intelligence record."
        >
          <div className="space-y-4">
            {insightFeed.map((item) => (
              <div key={item.key} className="elevate-hover rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-white">{item.symbol}: {item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{item.summary}</p>
                  </div>
                  <span className="rounded-full bg-white/8 px-3 py-1 text-xs text-slate-300">
                    {item.severity}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

export default DashboardPage
