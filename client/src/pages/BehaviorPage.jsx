import { AlertTriangle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { fetchBehaviorAnalysis } from '../api/behaviorApi'
import PageHeader from '../components/PageHeader'
import SectionCard from '../components/SectionCard'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { usePreferences } from '../lib/preferences'

const numberFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
const currencyFormatter = (currency) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 })
function number(value) { return Number.isFinite(Number(value)) ? numberFormatter.format(Number(value)) : 'Unavailable' }
function money(value, currency) { return Number.isFinite(Number(value)) ? currencyFormatter(currency).format(Number(value)) : 'Unavailable' }
function readableDate(value) { return value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Unavailable' }

function StatCard({ label, value, detail }) {
  return <div className="glass-panel rounded-3xl p-5"><p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p><p className="mt-3 text-2xl font-semibold text-white">{value}</p><p className="mt-2 text-xs text-slate-400">{detail}</p></div>
}

function InsightCard({ insight }) {
  return <article className="rounded-3xl border border-amber-400/30 bg-amber-400/10 p-5"><p className="text-xs uppercase tracking-[0.18em] text-cyan">{String(insight.category || '').replaceAll('_', ' ')}</p><h3 className="mt-2 text-lg font-semibold text-white">{insight.title}</h3><p className="mt-3 text-sm leading-6 text-slate-200">{insight.summary}</p><p className="mt-3 text-xs text-slate-400">Suggested review: {insight.suggested_action}</p></article>
}

function concentrationDisplay(concentration) {
  if (!concentration || concentration.status === 'unavailable') return { value: 'Unavailable', detail: concentration?.reason || 'No compatible current market values are available.' }
  const weight = Number(concentration.largestHoldingWeight)
  const coverage = concentration.coverage ? `Quote coverage: ${concentration.coverage.valued}/${concentration.coverage.total}` : 'Based on current compatible quotes.'
  return { value: Number.isFinite(weight) ? `${number(weight * 100)}% largest holding` : 'Calculated', detail: concentration.reason || coverage }
}

function BehaviorPage() {
  const { user } = useAuth()
  const preferences = usePreferences(user)
  const [portfolios, setPortfolios] = useState([])
  const [selectedPortfolioId, setSelectedPortfolioId] = useState('')
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [portfolioLoading, setPortfolioLoading] = useState(true)
  const [error, setError] = useState('')
  const requestRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    async function loadPortfolios() {
      setPortfolioLoading(true)
      const { data, error: queryError } = await supabase.from('portfolios').select('id, name, base_currency, created_at').order('created_at', { ascending: false })
      if (cancelled) return
      if (queryError) setError(queryError.message || 'Unable to load portfolios.')
      else { setPortfolios(data || []); setSelectedPortfolioId((current) => current && data?.some((item) => item.id === current) ? current : data?.[0]?.id || '') }
      setPortfolioLoading(false)
    }
    void loadPortfolios()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!selectedPortfolioId) { setAnalysis(null); setLoading(false); return undefined }
    const requestId = ++requestRef.current
    const controller = new AbortController()
    setLoading(true); setError('')
    fetchBehaviorAnalysis(selectedPortfolioId, { signal: controller.signal })
      .then((result) => { if (requestId === requestRef.current) setAnalysis(result) })
      .catch((reason) => { if (reason.name !== 'AbortError' && requestId === requestRef.current) { setAnalysis(null); setError(reason.message || 'Unable to load behavior analysis.') } })
      .finally(() => { if (requestId === requestRef.current) setLoading(false) })
    return () => controller.abort()
  }, [selectedPortfolioId])

  const metrics = analysis?.analysis?.metrics
  const selectedPortfolio = portfolios.find((item) => item.id === selectedPortfolioId)
  const currency = selectedPortfolio?.base_currency || metrics?.currencyBreakdown?.[0]?.currency || 'INR'
  const concentration = concentrationDisplay(metrics?.concentration)

  return <div>
    <PageHeader eyebrow="Behavior" title="Behavior & Mistake Analyzer" description="Review recorded investing activity, recurring patterns, fees, and evidence-based areas for attention. Findings describe the ledger; they do not prove mistakes or intent." actions={<label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"><span className="text-sm text-slate-300">Portfolio</span><select aria-label="Select portfolio" className="bg-transparent text-sm text-white outline-none" value={selectedPortfolioId} onChange={(event) => setSelectedPortfolioId(event.target.value)} disabled={portfolioLoading || !portfolios.length}><option value="">{portfolioLoading ? 'Loading…' : 'No portfolios'}</option>{portfolios.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>)}</select></label>} />
    {error ? <div className="mb-6 flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div> : null}
    {!portfolioLoading && !portfolios.length && !error ? <div className="glass-panel rounded-3xl p-8 text-slate-300">Create a portfolio and record transactions before analyzing investing behavior.</div> : null}
    {loading ? <div className="glass-panel animate-pulse rounded-3xl p-8 text-slate-300">Loading recorded portfolio behavior…</div> : null}
    {!loading && analysis && metrics ? <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Recorded transactions" value={number(metrics.transactionCount)} detail={`${number(metrics.buyCount)} BUY · ${number(metrics.sellCount)} SELL`} /><StatCard label="Gross purchase activity" value={metrics.grossPurchaseNotional === null ? 'Separated by currency' : money(metrics.grossPurchaseNotional, currency)} detail="BUY quantity × unit price" /><StatCard label="Gross sale activity" value={metrics.grossSaleNotional === null ? 'Separated by currency' : money(metrics.grossSaleNotional, currency)} detail="SELL quantity × unit price" /><StatCard label="Recorded fees" value={metrics.totalRecordedFees === null ? 'Separated by currency' : money(metrics.totalRecordedFees, currency)} detail="Ledger fees only" /></section>
      <SectionCard title="Investment activity" subtitle="Activity is grouped by calendar month and uses only valid ledger records."><div className="space-y-2">{(metrics.activityByMonth || []).map((item) => <div key={item.period} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm"><span className="text-slate-300">{item.period}</span><span className="text-slate-200">{item.buyCount} buys · {item.sellCount} sells · {money(item.grossNotional, currency)}</span></div>)}{!metrics.activityByMonth?.length ? <p className="text-sm text-slate-400">No valid activity is available.</p> : null}</div><p className="mt-4 text-xs text-slate-500">First recorded: {readableDate(metrics.firstTransactionAt)} · Most recent: {readableDate(metrics.latestTransactionAt)}</p></SectionCard>
      <div className="grid gap-6 lg:grid-cols-2"><SectionCard title="Recurring patterns" subtitle="Patterns require sufficient observations and do not establish an automatic plan.">{(analysis.analysis.patterns.repeatedPurchases || []).map((item) => <p key={item.symbol} className="mb-3 text-sm text-slate-300">Repeated purchases: <span className="font-medium text-white">{item.symbol}</span> ({item.buyCount} buys)</p>)}{!analysis.analysis.patterns.repeatedPurchases?.length ? <p className="text-sm text-slate-400">No recurring pattern met the configured evidence threshold.</p> : null}</SectionCard><SectionCard title="Holding and concentration limits" subtitle="Uses current compatible market quotes; transaction prices are never substituted."><p className="text-sm text-slate-300">Current concentration: <span className={metrics.concentration?.status === 'unavailable' ? 'text-amber-200' : 'text-cyan'}>{concentration.value}</span></p><p className="mt-3 text-sm leading-6 text-slate-400">{concentration.detail}</p><p className="mt-3 text-sm text-slate-300">Completed episodes: {number(metrics.holdingPeriods?.summary?.completedCount)} · Short episodes: {number(metrics.holdingPeriods?.summary?.shortCompletedCount)}</p></SectionCard></div>
      <SectionCard title="Potential behavioral risks and insights" subtitle="These are evidence-based review prompts, not proof of mistakes or personalized instructions.">{preferences.behavioralAlerts ? <div className="grid gap-4 lg:grid-cols-2">{(analysis.analysis.findings || []).map((insight) => <InsightCard key={insight.id} insight={insight} />)}{!analysis.analysis.findings?.length ? <p className="text-sm text-slate-400">No evidence-based behavioral alert is currently supported.</p> : null}</div> : <p className="text-sm text-slate-400">Behavioral alerts are disabled in Profile settings. Essential account and data-integrity messages remain enabled.</p>}</SectionCard>
      <SectionCard title="Data quality and methodology" subtitle="How this analysis should be interpreted."><div className="space-y-2 text-sm text-slate-400">{Object.entries(analysis.analysis.methodology || {}).map(([key, value]) => <p key={key}><span className="text-slate-300">{key.replaceAll(/([A-Z])/g, ' $1')}: </span>{value}</p>)}</div></SectionCard>
    </div> : null}
  </div>
}

export default BehaviorPage
