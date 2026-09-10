import { ArrowUpRight, BrainCircuit, CircleAlert, ScanSearch } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fetchStockIntelligence } from '../api/intelligenceApi'
import PageHeader from '../components/PageHeader'
import SectionCard from '../components/SectionCard'
import { indianStockSymbols, shortSymbolLabel } from '../data/stocksData'

function formatStructuredValue(value) {
  if (value === null || value === undefined || value === '') {
    return '--'
  }

  return String(value)
}

function InsightsPage() {
  const [selectedSymbol, setSelectedSymbol] = useState(indianStockSymbols[0])
  const [intelligence, setIntelligence] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadInsights() {
      try {
        setLoading(true)
        setError('')
        const result = await fetchStockIntelligence(selectedSymbol)
        if (!cancelled) {
          setIntelligence(result.document || result)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Unable to load insights.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadInsights()

    return () => {
      cancelled = true
    }
  }, [selectedSymbol])

  const insights = useMemo(() => {
    if (!intelligence) {
      return []
    }

    return [
      {
        title: 'Decision recommendation',
        icon: BrainCircuit,
        text: intelligence.analysis?.recommendation || 'Recommendation unavailable.',
        tone: intelligence.market?.trend || 'Unknown trend',
      },
      {
        title: 'News sentiment posture',
        icon: CircleAlert,
        text: intelligence.analysis?.news_summary || 'News summary unavailable.',
        tone: `${intelligence.news?.overall_sentiment || 'Unknown'} sentiment`,
      },
      {
        title: 'Market structure read',
        icon: ScanSearch,
        text: intelligence.analysis?.market_summary || 'Market summary unavailable.',
        tone: `RSI ${(intelligence.market?.rsi || 0).toFixed(2)}`,
      },
    ]
  }, [intelligence])

  const topHeadlines = intelligence?.news?.top_headlines || []
  const structuredMarketSummary = intelligence?.analysis?.market_summary_structured
  const structuredNewsSummary = intelligence?.analysis?.news_summary_structured

  return (
    <div>
      <PageHeader
        eyebrow="Insights"
        title="Actionable intelligence, not just dashboards"
        description="This layer converts charts into readable reasoning. Each block frames what the AI sees, why it matters, and what the user should change next."
        actions={
          <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <span className="text-sm text-slate-300">Focus stock</span>
            <select
              className="bg-transparent text-sm text-white outline-none"
              value={selectedSymbol}
              onChange={(event) => setSelectedSymbol(event.target.value)}
            >
              {indianStockSymbols.map((symbol) => (
                <option key={symbol} value={symbol} className="bg-slate-950">
                  {symbol}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {error ? (
        <div className="mb-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {loading ? (
          <div className="glass-panel animate-pulse rounded-[30px] p-6 text-slate-300 lg:col-span-3">Loading insight stream...</div>
        ) : insights.map(({ title, text, tone, icon: Icon }) => (
          <div
            key={title}
            className="glass-panel elevate-hover rounded-[30px] p-6"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan/20 bg-white/10 text-cyan">
              <Icon className="h-5 w-5" />
            </div>
            <h3 className="mt-6 font-display text-2xl text-white">{title}</h3>
            <p className="mt-3 text-sm leading-7 text-slate-400">{text}</p>
            <div className="mt-6 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <span className="text-sm text-slate-300">{tone}</span>
              <ArrowUpRight className="h-4 w-4 text-slate-400" />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <SectionCard
          title="Advisor-style recommendation stream"
          subtitle={`Recent headlines and next-step framing for ${shortSymbolLabel(selectedSymbol)}.`}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="elevate-hover rounded-[28px] border border-cyan/20 bg-cyan/10 p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-cyan">Recommended move</p>
              <h3 className="mt-4 font-display text-2xl text-white">{intelligence?.market?.trend || 'Unknown'} posture</h3>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                {intelligence?.analysis?.recommendation || 'Current recommendation is still loading.'}
              </p>
            </div>
            <div className="elevate-hover rounded-[28px] border border-violet/20 bg-violet/10 p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-rose">Headline watch</p>
              <h3 className="mt-4 font-display text-2xl text-white">{topHeadlines[0]?.sentiment || intelligence?.news?.overall_sentiment || 'Neutral'}</h3>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                {topHeadlines[0]?.headline || 'No ranked headline available yet for this stock.'}
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan">Structured market summary</p>
              <div className="mt-4 grid gap-2">
                {(structuredMarketSummary?.trend_signals || []).map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3">
                    <span className="text-sm text-slate-400">{item.label}</span>
                    <span className="text-sm font-medium text-white">{formatStructuredValue(item.value)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan">Structured news summary</p>
              <div className="mt-4 grid gap-2">
                {[
                  ...(structuredNewsSummary?.sentiment_breakdown || []),
                  ...(structuredNewsSummary?.coverage || []),
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3">
                    <span className="text-sm text-slate-400">{item.label}</span>
                    <span className="text-sm font-medium text-white">{formatStructuredValue(item.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

export default InsightsPage
