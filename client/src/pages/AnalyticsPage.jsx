import { useEffect, useMemo, useState } from 'react'
import { fetchStockIntelligence } from '../api/intelligenceApi'
import PageHeader from '../components/PageHeader'
import SectionCard from '../components/SectionCard'
import { ConfidenceChart, ScoreRadar } from '../components/Charts'
import { indianStockSymbols, shortSymbolLabel } from '../data/stocksData'

function AnalyticsPage() {
  const [selectedSymbol, setSelectedSymbol] = useState(indianStockSymbols[0])
  const [intelligence, setIntelligence] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadIntelligence() {
      try {
        setLoading(true)
        setError('')
        const result = await fetchStockIntelligence(selectedSymbol)
        if (!cancelled) {
          setIntelligence(result.document || result)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Unable to load analytics.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadIntelligence()

    return () => {
      cancelled = true
    }
  }, [selectedSymbol])

  const analyticsStats = useMemo(() => {
    if (!intelligence) {
      return []
    }

    return [
      {
        title: 'Hype score',
        value: `${Math.round((intelligence.news?.hype_score || 0) * 100)} / 100`,
        description: `Narrative intensity is currently ${intelligence.news?.hype_label || 'Unknown'}.`,
      },
      {
        title: 'Sentiment',
        value: intelligence.news?.overall_sentiment || 'Unknown',
        description: `Positive ${(intelligence.news?.positive_score || 0).toFixed(2)} | Negative ${(intelligence.news?.negative_score || 0).toFixed(2)}`,
      },
      {
        title: 'Technical trend',
        value: intelligence.market?.trend || 'Unknown',
        description: `RSI ${(intelligence.market?.rsi || 0).toFixed(2)} with ${shortSymbolLabel(selectedSymbol)} as the active symbol.`,
      },
    ]
  }, [intelligence, selectedSymbol])

  const radarData = useMemo(() => {
    if (!intelligence) {
      return []
    }

    const positive = (intelligence.news?.positive_score || 0) * 100
    const negative = (intelligence.news?.negative_score || 0) * 100
    const neutral = (intelligence.news?.neutral_score || 0) * 100
    const rsi = intelligence.market?.rsi || 0
    const trendScore = intelligence.market?.trend === 'Bullish' ? 80 : intelligence.market?.trend === 'Bearish' ? 35 : 55
    const hype = (intelligence.news?.hype_score || 0) * 100

    return [
      { metric: 'Positive', value: Number(positive.toFixed(1)) },
      { metric: 'Negative', value: Number(negative.toFixed(1)) },
      { metric: 'Neutral', value: Number(neutral.toFixed(1)) },
      { metric: 'RSI', value: Number(rsi.toFixed(1)) },
      { metric: 'Trend', value: trendScore },
      { metric: 'Hype', value: Number(hype.toFixed(1)) },
    ]
  }, [intelligence])

  const chartData = useMemo(() => {
    if (!intelligence) {
      return []
    }

    return [
      {
        month: 'News',
        confidence: Math.round((intelligence.news?.positive_score || 0) * 100),
        risk: Math.round((intelligence.news?.negative_score || 0) * 100),
      },
      {
        month: 'Trend',
        confidence: intelligence.market?.trend === 'Bullish' ? 80 : intelligence.market?.trend === 'Bearish' ? 35 : 55,
        risk: intelligence.market?.trend === 'Bearish' ? 72 : 38,
      },
      {
        month: 'Momentum',
        confidence: Math.round(intelligence.market?.rsi || 0),
        risk: Math.round((intelligence.news?.hype_score || 0) * 100),
      },
    ]
  }, [intelligence])

  return (
    <div>
      <PageHeader
        eyebrow="Analytics"
        title="Truth-versus-hype analytics"
        description="This screen visualizes the core differentiator from the project brief: hype detection balanced against fundamentals, technicals, and resilience signals."
        actions={
          <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <span className="text-sm text-slate-300">Active symbol</span>
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

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        {loading ? (
          <div className="glass-panel animate-pulse rounded-3xl p-5 text-slate-300 lg:col-span-3">Loading analytics...</div>
        ) : analyticsStats.map(({ title, value, description }) => (
          <div key={title} className="glass-panel elevate-hover rounded-3xl p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">{title}</p>
              <span className="rounded-full border border-cyan/20 bg-cyan/10 px-3 py-1 text-xs font-medium text-cyan">
                {shortSymbolLabel(selectedSymbol)}
              </span>
            </div>
            <h3 className="mt-4 font-display text-3xl text-white">{value}</h3>
            <p className="mt-3 text-sm leading-6 text-slate-400">{description}</p>
          </div>
        ))}
      </div>

      <div className="page-grid">
        <SectionCard
          title="Factor map"
          subtitle="A single glance at sentiment, valuation, governance, and market structure."
        >
          {loading ? (
            <div className="animate-pulse rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-slate-300">Preparing factor map...</div>
          ) : (
            <ScoreRadar data={radarData} />
          )}
        </SectionCard>

        <SectionCard
          title="Confidence versus risk"
          subtitle="Live comparison between sentiment strength, technical posture, and hype intensity."
        >
          {loading ? (
            <div className="animate-pulse rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-slate-300">Preparing comparative chart...</div>
          ) : (
            <ConfidenceChart data={chartData} />
          )}
          <div className="mt-4 rounded-[24px] border border-cyan/10 bg-gradient-to-r from-sky/10 via-violet/10 to-transparent p-4">
            <p className="text-sm leading-6 text-slate-300">
              Interpretation: {intelligence?.analysis?.recommendation || 'Current signals are still loading.'}
            </p>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

export default AnalyticsPage
