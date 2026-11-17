import { BrainCircuit, Play, RefreshCw, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fetchStockIntelligence } from '../api/intelligenceApi'
import { fetchNseStocks } from '../api/stocksApi'
import { explainRipple, fetchRippleBriefing, simulateRipple } from '../api/rippleApi'
import PageHeader from '../components/PageHeader'
import SectionCard from '../components/SectionCard'
import { useAuth } from '../context/AuthContext'
import { indianStockSymbols, popularNseSymbols, shortSymbolLabel } from '../data/stocksData'
import { supabase } from '../lib/supabase'
import { isCurrentNews } from '../lib/newsFreshness'
import { usePreferences } from '../lib/preferences'

const EMPTY_SHOCKS = { repo_rate: '', crude_oil: '', usd_inr: '', cpi_inflation: '', gdp_growth: '', bond_yield: '' }
const SHOCK_FIELDS = [
  ['repo_rate', 'RBI repo rate', 'percentage points', 'A rate increase generally raises borrowing costs.'],
  ['cpi_inflation', 'CPI inflation', 'percentage points', 'Higher inflation can pressure margins and spending.'],
  ['usd_inr', 'USD/INR', '%', 'A positive shock means rupee depreciation.'],
  ['crude_oil', 'Crude oil', '%', 'Higher oil prices can raise transport and input costs.'],
  ['gdp_growth', 'GDP growth', 'percentage points', 'A positive shock represents stronger economic growth.'],
  ['bond_yield', 'Government bond yield', 'basis points', 'Higher yields can increase financing costs.'],
]
const PRESETS = { 'Rising rates': { repo_rate: '1', bond_yield: '25' }, 'Higher crude': { crude_oil: '15' }, 'Rupee depreciation': { usd_inr: '5' }, 'Positive growth': { gdp_growth: '1' } }

function formatValue(value, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(value) : '--'
}

function formatStructuredValue(label, value) {
  if (value === null || value === undefined || value === '') return '--'
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value)
  const normalized = String(label || '').toLowerCase()
  if (normalized.includes('score') && value >= 0 && value <= 1) return `${(value * 100).toFixed(1)}%`
  if (normalized.includes('count') || normalized.includes('volume')) return formatValue(value, 0)
  return formatValue(value)
}

function summarizeStructured(items = []) {
  return items.filter((item) => item?.value !== null && item?.value !== undefined && item?.value !== '')
    .map((item) => `${item.label}: ${formatStructuredValue(item.label, item.value)}`).join(' · ')
}

function deterministicExplanation(result) {
  const scenario = (result?.scenario?.shocks || []).map((item) => `${item.label || item.key}: ${item.shock} ${item.shockLabel || ''}`).join(', ')
  const stockRows = (result?.stockImpacts || []).filter((item) => item?.modeledImpactPct !== null && item?.modeledImpactPct !== undefined && Number.isFinite(Number(item.modeledImpactPct)))
  const rows = stockRows.length ? stockRows : (result?.sectorImpacts || []).filter((item) => item?.modeledImpactPct !== null && item?.modeledImpactPct !== undefined && Number.isFinite(Number(item.modeledImpactPct)))
  const strongest = [...rows].sort((a, b) => Math.abs(b.modeledImpactPct) - Math.abs(a.modeledImpactPct))[0]
  const label = strongest ? (strongest.symbol ? `${strongest.symbol}${strongest.sector ? ` (${strongest.sector})` : ''}` : strongest.sector) : null
  return `Scenario summary: ${scenario || 'No shocks were supplied.'}\n\nStock impact: ${label ? `${label} has a modeled sensitivity of ${formatValue(strongest.modeledImpactPct)}% under this scenario.` : 'No supported stock or sector result is available.'}\n\nWhy it matters: The result applies configured economic transmission assumptions to the selected hypothetical macroeconomic changes. A negative value indicates modeled pressure under these assumptions; a positive value indicates modeled support. This is not an observed return, forecast, or price target.\n\nWhat could change the outcome: Sector metadata, coefficient coverage, current macro baselines, company-specific hedges, and interactions may be unavailable or different from the illustrative model.`
}

function MacroCard({ indicator }) {
  const available = indicator?.status === 'available' || indicator?.status === 'historical_only'
  return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-white">{indicator.label}</p><span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{indicator.status?.replaceAll('_', ' ')}</span></div><p className="mt-3 text-2xl font-semibold text-white">{available && indicator.value !== null ? `${formatValue(indicator.value)} ${indicator.unit || ''}` : 'Data unavailable'}</p><p className="mt-2 text-xs leading-5 text-slate-500">{available ? `Observed ${indicator.date || 'date unavailable'} · ${indicator.source || 'source unavailable'}` : (indicator.reason || 'No verified observation is integrated.')}</p>{indicator.trend ? <p className="mt-2 text-xs text-cyan">Recent direction: {indicator.trend}</p> : null}</div>
}

function InsightsPage() {
  const { user } = useAuth()
  const preferences = usePreferences(user)
  const [selectedSymbol, setSelectedSymbol] = useState(indianStockSymbols[0])
  const [stockQuery, setStockQuery] = useState('')
  const [stockMatches, setStockMatches] = useState([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [activeMatch, setActiveMatch] = useState(0)
  const searchAbort = useRef(null)
  const [intelligence, setIntelligence] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [briefing, setBriefing] = useState(null)
  const [rippleShocks, setRippleShocks] = useState(EMPTY_SHOCKS)
  const [rippleTarget, setRippleTarget] = useState('sectors')
  const [sectorScope, setSectorScope] = useState('all')
  const [portfolios, setPortfolios] = useState([])
  const [ripplePortfolioId, setRipplePortfolioId] = useState('')
  const [rippleResult, setRippleResult] = useState(null)
  const [rippleLoading, setRippleLoading] = useState(false)
  const [rippleError, setRippleError] = useState('')
  const [rippleExplanation, setRippleExplanation] = useState('')
  const [rippleAiLoading, setRippleAiLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    fetchStockIntelligence(selectedSymbol).then((result) => { if (!cancelled) setIntelligence(result.document || result) }).catch((err) => { if (!cancelled) setError(err.message || 'Unable to load insights.') }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedSymbol])

  useEffect(() => {
    let cancelled = false
    fetchRippleBriefing().then((data) => { if (!cancelled) setBriefing(data) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let active = true
    supabase.from('portfolios').select('id, name, base_currency').order('created_at', { ascending: false }).then(({ data }) => { if (active) { setPortfolios(data || []); setRipplePortfolioId(data?.[0]?.id || '') } })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const query = stockQuery.trim()
    if (!query) { setStockMatches([]); setSearchLoading(false); setSearchError(''); return undefined }
    const timer = window.setTimeout(() => {
      searchAbort.current?.abort()
      const controller = new AbortController(); searchAbort.current = controller
      setSearchLoading(true); setSearchError('')
      fetchNseStocks({ search: query, limit: 12, signal: controller.signal }).then((data) => { if (!controller.signal.aborted) { setStockMatches(data.stocks || []); setActiveMatch(0) } }).catch((reason) => { if (reason?.name !== 'AbortError' && !controller.signal.aborted) { setStockMatches([]); setSearchError(reason.message || 'Stock search is unavailable.') } }).finally(() => { if (!controller.signal.aborted) setSearchLoading(false) })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [stockQuery])

  function chooseStock(stock) {
    const symbol = typeof stock === 'string' ? stock : stock.symbol
    if (!symbol) return
    setSelectedSymbol(symbol.replace(/\.NS$/i, '').toUpperCase()); setStockQuery(''); setStockMatches([]); setSearchOpen(false); setActiveMatch(0)
  }

  function handleSearchKeyDown(event) {
    if (event.key === 'Escape') { setStockQuery(''); setStockMatches([]); setSearchError(''); setSearchOpen(false); return }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveMatch((current) => Math.min(current + 1, Math.max(stockMatches.length - 1, 0))) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveMatch((current) => Math.max(current - 1, 0)) }
    if (event.key === 'Enter' && stockMatches[activeMatch]) { event.preventDefault(); chooseStock(stockMatches[activeMatch]) }
  }

  async function runRipple() {
    const shocks = Object.entries(rippleShocks).filter(([, value]) => String(value).trim() !== '').map(([key, value]) => ({ key, shock: Number(value) }))
    if (!shocks.length || shocks.some((item) => !Number.isFinite(item.shock))) { setRippleError('Enter at least one valid economic shock.'); return }
    setRippleLoading(true); setRippleError(''); setRippleExplanation('')
    try {
      const { data } = await supabase.auth.getSession()
      const target = rippleTarget === 'portfolio' ? { type: 'portfolio', portfolioId: ripplePortfolioId } : rippleTarget === 'stock' ? { type: 'stock', symbols: [selectedSymbol] } : { type: 'sectors', ...(sectorScope !== 'all' ? { sectors: [sectorScope] } : {}) }
      setRippleResult(await simulateRipple({ shocks, target }, { token: data?.session?.access_token }))
    } catch (requestError) { setRippleResult(null); setRippleError(requestError.message || 'Economic ripple simulation is unavailable.') } finally { setRippleLoading(false) }
  }

  async function requestRippleExplanation() {
    if (!rippleResult) return
    setRippleAiLoading(true); setRippleError('')
    try { const { data } = await supabase.auth.getSession(); const result = await explainRipple(rippleResult, { token: data?.session?.access_token, portfolioId: rippleTarget === 'portfolio' ? ripplePortfolioId : '' }); setRippleExplanation(result.fallback ? `${deterministicExplanation(rippleResult)}\n\nAI provider unavailable; deterministic explanation shown from the current simulation.` : result.answer) } catch (requestError) { setRippleExplanation(`${deterministicExplanation(rippleResult)}\n\nAI provider unavailable; this deterministic explanation uses the verified simulation result.`); setRippleError('') } finally { setRippleAiLoading(false) }
  }

  const topHeadlines = isCurrentNews(intelligence?.news) ? intelligence?.news?.top_headlines || [] : []
  const marketDetails = intelligence?.analysis?.market_summary_structured?.trend_signals || []
  const newsDetails = [...(intelligence?.analysis?.news_summary_structured?.sentiment_breakdown || []), ...(intelligence?.analysis?.news_summary_structured?.coverage || [])]
  const supportedSectors = briefing?.supportedSectors || []
  const rippleRows = rippleTarget === 'stock' ? (rippleResult?.stockImpacts || []).map((item) => ({ ...item, label: item.symbol })) : (rippleResult?.sectorImpacts || []).map((item) => ({ ...item, label: item.sector }))
  const plottableRippleRows = rippleRows.filter((item) => item?.modeledImpactPct !== null && item?.modeledImpactPct !== undefined && Number.isFinite(Number(item.modeledImpactPct)))

  return <div>
    <PageHeader eyebrow="Insights" title="Actionable intelligence, not just dashboards" description="One concise view of the selected stock, followed by a transparent economic scenario simulator." />
    <SectionCard className="!overflow-visible" title="Stock intelligence" subtitle="Search any supported NSE-listed stock by company name or symbol. The selected stock is shared with the analysis and stock-impact target.">
      <div className="relative max-w-2xl"><label htmlFor="insights-stock-search" className="mb-2 block text-sm text-slate-300">Search stock</label><div className="relative"><Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input id="insights-stock-search" className="input-shell w-full pl-11" value={stockQuery} placeholder={`${shortSymbolLabel(selectedSymbol)} or company name`} onFocus={() => setSearchOpen(true)} onChange={(event) => { setStockQuery(event.target.value); setSearchOpen(true) }} onKeyDown={handleSearchKeyDown} onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)} aria-controls="insights-stock-results" aria-expanded={searchOpen} />{searchOpen && stockQuery.trim() ? <div id="insights-stock-results" role="listbox" className="absolute left-0 right-0 top-full z-50 mt-2 max-h-72 overflow-y-auto rounded-2xl border border-cyan/30 bg-[#071b18] p-2 shadow-2xl">{searchLoading ? <p className="p-3 text-sm text-slate-400">Searching supported NSE stocks…</p> : searchError ? <p className="p-3 text-sm text-rose-200">{searchError}</p> : stockMatches.length ? stockMatches.map((stock, index) => <button type="button" role="option" aria-selected={index === activeMatch} key={stock.symbol} className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left hover:bg-white/10 ${index === activeMatch ? 'bg-white/10' : ''}`} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseStock(stock)}><span className="text-sm text-white">{stock.name || stock.symbol}</span><span className="text-xs text-cyan">{stock.symbol}</span></button>) : <p className="p-3 text-sm text-slate-500">No supported NSE stock matches.</p>}</div> : null}</div></div>
      {!searchOpen || !stockQuery.trim() ? <div className="mt-5 flex flex-wrap gap-2">{popularNseSymbols.map((symbol) => <button type="button" key={symbol} onClick={() => chooseStock(symbol)} className={`rounded-xl border px-3 py-2 text-xs ${selectedSymbol === symbol ? 'border-cyan bg-cyan/10 text-white' : 'border-white/10 text-slate-400 hover:text-white'}`}>{symbol}</button>)}</div> : null}
      <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]"><div className="rounded-2xl border border-cyan/20 bg-cyan/10 p-5"><p className="text-xs uppercase tracking-[0.2em] text-cyan">Selected stock</p><h2 className="mt-2 font-display text-3xl text-white">{shortSymbolLabel(selectedSymbol)}</h2><p className="mt-3 text-sm leading-7 text-slate-300">{loading ? 'Loading stock intelligence…' : intelligence?.analysis?.recommendation || 'Recommendation unavailable.'}</p>{!loading ? <p className="mt-3 text-xs leading-6 text-slate-400">{summarizeStructured(marketDetails)}{newsDetails.length ? ` · ${summarizeStructured(newsDetails)}` : ''}</p> : null}</div><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><p className="text-xs uppercase tracking-[0.2em] text-cyan">News context</p><p className="mt-3 text-sm leading-7 text-slate-300">{isCurrentNews(intelligence?.news) ? topHeadlines[0]?.headline || intelligence?.news?.overall_sentiment || 'Current news evidence is limited.' : 'Recent company news is unavailable; historical articles are not treated as current evidence.'}</p></div></div>
      {error ? <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div> : null}
      {!loading ? <details className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4"><summary className="cursor-pointer text-sm font-medium text-white">Technical and news details</summary><div className="mt-4 grid gap-4 lg:grid-cols-2"><div><p className="text-xs uppercase tracking-[0.2em] text-cyan">Technical indicators</p><p className="mt-3 text-sm leading-7 text-slate-300">{summarizeStructured(marketDetails) || 'Technical detail unavailable.'}</p><p className="mt-3 text-xs leading-5 text-slate-500">RSI measures momentum, moving averages describe trend context, and MACD helps interpret momentum changes. None guarantees a future price move.</p></div><div><p className="text-xs uppercase tracking-[0.2em] text-cyan">Sentiment evidence</p><p className="mt-3 text-sm leading-7 text-slate-300">{summarizeStructured(newsDetails) || 'Sentiment detail unavailable.'}</p><p className="mt-3 text-xs leading-5 text-slate-500">{topHeadlines.length ? `${topHeadlines.length} current headline(s) available.` : 'No current headline evidence is available.'}</p></div></div></details> : null}
    </SectionCard>

    <div className="mt-6"><SectionCard title="Economic Ripple Simulator" subtitle="Test hypothetical economic changes against supported sectors, the selected NSE stock, or your authenticated portfolio. Results are sensitivity estimates, not forecasts or investment advice." action={<button type="button" className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm" onClick={runRipple} disabled={rippleLoading || !preferences.macroRippleScenarios}><Play className="h-4 w-4" />{rippleLoading ? 'Simulating…' : 'Run scenario'}</button>}>
      <div className="mb-6"><div className="flex items-center gap-2"><BrainCircuit className="h-5 w-5 text-cyan" /><h3 className="font-display text-2xl text-white">Macroeconomic Briefing</h3></div><p className="mt-2 text-sm text-slate-400">Observed readings are shown only when verified in the local historical snapshot. They are separate from the hypothetical shocks below.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{(briefing?.indicators || []).map((indicator) => <MacroCard key={indicator.key} indicator={indicator} />)}</div>{briefing?.macroNews?.message ? <p className="mt-3 text-xs text-slate-500">Macro release feed: {briefing.macroNews.message}</p> : null}</div>
      <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-slate-300">Hypothetical presets:</span>{Object.entries(PRESETS).map(([name, values]) => <button type="button" key={name} className="btn-secondary px-3 py-2 text-xs" onClick={() => setRippleShocks({ ...EMPTY_SHOCKS, ...values })}>{name}</button>)}</div>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{SHOCK_FIELDS.map(([key, label, unit, help]) => <label key={key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><span className="text-sm text-white">{label}</span><span className="mt-1 block text-xs text-slate-500">Shock in {unit}; leave blank to exclude.</span><span className="mt-1 block text-xs text-slate-500">{help}</span><input aria-label={`${label} shock`} className="input-shell mt-3 w-full" type="number" step="any" value={rippleShocks[key]} onChange={(event) => setRippleShocks((current) => ({ ...current, [key]: event.target.value }))} /></label>)}</div>
      <div className="mt-5 grid gap-3 md:grid-cols-3"><label className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><span className="text-xs uppercase tracking-[0.16em] text-slate-500">Target</span><select className="input-shell mt-2 w-full" value={rippleTarget} onChange={(event) => setRippleTarget(event.target.value)}><option value="sectors">Sector impact</option><option value="stock">Selected stock: {selectedSymbol}</option><option value="portfolio" disabled={!portfolios.length}>My portfolio</option></select></label>{rippleTarget === 'sectors' ? <label className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><span className="text-xs uppercase tracking-[0.16em] text-slate-500">Sector scope</span><select className="input-shell mt-2 w-full" value={sectorScope} onChange={(event) => setSectorScope(event.target.value)}><option value="all">Compare supported sectors</option>{supportedSectors.map((sector) => <option key={sector} value={sector}>{sector}</option>)}</select></label> : null}{rippleTarget === 'portfolio' ? <label className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><span className="text-xs uppercase tracking-[0.16em] text-slate-500">Portfolio</span><select aria-label="Ripple portfolio" className="input-shell mt-2 w-full" value={ripplePortfolioId} onChange={(event) => setRipplePortfolioId(event.target.value)}>{portfolios.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>)}</select></label> : null}<button type="button" className="btn-secondary self-end px-4 py-3 text-sm" onClick={() => { setRippleShocks(EMPTY_SHOCKS); setRippleResult(null); setRippleError(''); setRippleExplanation('') }}><RefreshCw className="mr-2 inline h-4 w-4" />Reset</button></div>
      {rippleError ? <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{rippleError}</div> : null}
      {rippleResult ? <div className="mt-6 space-y-5"><div className="grid gap-4 sm:grid-cols-3"><div className="rounded-2xl border border-aqua/20 bg-aqua/10 p-4"><p className="text-xs uppercase tracking-[0.18em] text-aqua">Model status</p><p className="mt-2 text-xl font-semibold text-white">{rippleResult.status}</p></div><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs uppercase tracking-[0.18em] text-slate-500">Model version</p><p className="mt-2 text-xl font-semibold text-white">{rippleResult.modelVersion}</p><p className="mt-1 text-xs text-slate-500">{rippleResult.coefficientProvenance || 'provenance unavailable'}</p></div><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs uppercase tracking-[0.18em] text-slate-500">Portfolio impact</p><p className="mt-2 text-xl font-semibold text-white">{rippleResult.portfolio?.status === 'not_requested' ? 'Not requested' : rippleResult.portfolio?.modeledImpactPct === null ? 'Unavailable' : `${formatValue(rippleResult.portfolio.modeledImpactPct)}%`}</p></div></div><div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]"><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-sm font-medium text-white">Modeled {rippleTarget === 'stock' ? 'stock' : 'sector'} impact (%)</p><p className="mt-1 text-xs text-slate-500">Positive bars indicate a positive modeled sensitivity; negative bars indicate a negative modeled sensitivity. These are not historical returns.</p>{plottableRippleRows.length ? <div className="mt-3 h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={plottableRippleRows} layout="vertical" margin={{ left: 20, right: 12 }}><CartesianGrid strokeDasharray="3 3" stroke="#ffffff18" /><XAxis type="number" stroke="#94a3b8" /><YAxis type="category" dataKey="label" width={140} stroke="#94a3b8" tick={{ fontSize: 11 }} /><Tooltip cursor={false} formatter={(value) => [`${formatValue(Number(value))}%`, 'Modeled sensitivity']} contentStyle={{ background: '#071b18', border: '1px solid #ffffff22' }} /><Bar dataKey="modeledImpactPct">{plottableRippleRows.map((item) => <Cell key={item.label} fill={Number(item.modeledImpactPct) >= 0 ? '#2ce57e' : '#fb7185'} />)}</Bar></BarChart></ResponsiveContainer></div> : <div className="mt-6 rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">No numeric modeled result is available for this target. This is different from a zero impact: the selected stock has no usable sector model or its required metadata is unavailable.</div>}</div><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-sm font-medium text-white">How to interpret these results</p><ul className="mt-3 space-y-2 text-sm leading-6 text-slate-400">{(rippleResult.assumptions || []).map((item) => <li key={item}>• {item}</li>)}{(rippleResult.limitations || []).map((item) => <li key={item} className="text-amber-200">• {item}</li>)}</ul></div></div><div className="flex flex-wrap gap-3"><button type="button" className="btn-secondary px-4 py-2 text-sm" onClick={requestRippleExplanation} disabled={rippleAiLoading}>{rippleAiLoading ? 'Explaining…' : 'Explain with AI'}</button>{rippleExplanation ? <div className="basis-full whitespace-pre-line rounded-2xl border border-violet/20 bg-violet/10 p-4 text-sm leading-7 text-slate-300">{rippleExplanation}</div> : null}</div></div> : <p className="mt-5 text-sm text-slate-500">Enter a hypothetical shock and run a scenario. No current macroeconomic readings are assumed.</p>}
    </SectionCard></div>
  </div>
}

export default InsightsPage
