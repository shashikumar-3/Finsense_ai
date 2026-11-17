import { Download, FileText, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import SectionCard from '../components/SectionCard'
import {
  downloadReport,
  fetchFinancialFutureReport,
  fetchPortfolioReport,
  fetchReportPortfolios,
  fetchStockReport,
  filenameFromDisposition,
  saveDownload,
} from '../api/reportsApi'

function displayValue(value) {
  if (value === null || value === undefined || value === '') return 'Unavailable'
  return typeof value === 'number' ? value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(value)
}

function ReportPreview({ report, kind, loading, onExport }) {
  return (
    <SectionCard className="mt-6" title={report.title} subtitle={`Generated ${new Date(report.generatedAt).toLocaleString('en-IN')} · As of ${report.asOf ? new Date(report.asOf).toLocaleString('en-IN') : 'Unavailable'}`}>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary inline-flex items-center gap-2" disabled={loading} onClick={() => onExport('pdf', kind)}><Download className="h-4 w-4" />Download PDF</button>
        <button type="button" className="btn-secondary" disabled={loading} onClick={() => onExport('csv', kind)}>Download CSV</button>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {Object.entries(report.summary || {}).slice(0, 9).map(([key, value]) => <div key={key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs uppercase tracking-[0.15em] text-slate-500">{key.replace(/([A-Z])/g, ' $1')}</p><p className="mt-2 break-words text-lg text-white">{displayValue(value)}</p></div>)}
      </div>
      <div className="mt-6 space-y-5">
        {(report.sections || []).map((section) => <div key={section.title}><h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan">{section.title}</h3>{section.text ? <p className="mt-2 text-sm leading-6 text-slate-300">{section.text}</p> : null}<div className="mt-2 space-y-2">{(section.rows || []).map((row) => <div key={`${section.title}-${row.label}`} className="flex flex-wrap justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm"><span className="text-slate-400">{row.label}</span><span className="text-right text-slate-100">{displayValue(row.value)}</span></div>)}</div></div>)}
      </div>
      {(report.limitations || []).length ? <div className="mt-6 space-y-2">{report.limitations.map((item) => <p key={item} className="text-sm leading-6 text-amber-100">• {item}</p>)}</div> : null}
    </SectionCard>
  )
}

function ReportsPage() {
  const [portfolios, setPortfolios] = useState([])
  const [portfolioId, setPortfolioId] = useState('')
  const [symbol, setSymbol] = useState('TCS')
  const [report, setReport] = useState(null)
  const [lastKind, setLastKind] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    fetchReportPortfolios().then((result) => { setPortfolios(result.portfolios || []); if (result.portfolios?.[0]) setPortfolioId(result.portfolios[0].id) }).catch((reason) => setError(reason.message || 'Unable to load your report sources.'))
  }, [])

  async function generate(kind) {
    setLoading(true); setError(''); setStatus('')
    try {
      const result = kind === 'portfolio' ? await fetchPortfolioReport(portfolioId) : kind === 'stock' ? await fetchStockReport(symbol.trim()) : await fetchFinancialFutureReport()
      setReport(result.report); setLastKind(kind); setStatus('Report generated successfully.')
    } catch (reason) { setReport(null); setError(reason.message || 'Unable to generate report.') } finally { setLoading(false) }
  }

  async function exportReport(format, kind) {
    setLoading(true); setError('')
    try {
      const path = kind === 'portfolio' ? `/api/reports/portfolio/${encodeURIComponent(portfolioId)}` : kind === 'stock' ? `/api/reports/stock/${encodeURIComponent(symbol.trim())}` : '/api/reports/financial-future'
      const result = await downloadReport(path, format)
      saveDownload(result.blob, filenameFromDisposition(result.filename, `finsense-${kind}.${format}`))
      setStatus(`${format.toUpperCase()} export downloaded.`)
    } catch (reason) { setError(reason.message || 'Unable to export report.') } finally { setLoading(false) }
  }

  return <div><PageHeader eyebrow="Reports" title="Reports & intelligence" description="Generate verified, authenticated reports from your portfolio, stock analysis, and financial plan." actions={<button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => window.location.reload()}><RefreshCw className="h-4 w-4" />Refresh</button>} />
    {error ? <div role="alert" className="mt-6 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-100">{error}</div> : null}
    {status ? <div role="status" className="mt-6 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-100">{status}</div> : null}
    <div className="mt-6 grid gap-4 lg:grid-cols-3">
      <SectionCard title="Portfolio report" subtitle="Holdings, market values, allocation, and coverage from your authenticated portfolio."><select aria-label="Portfolio" className="input-shell w-full" value={portfolioId} onChange={(event) => setPortfolioId(event.target.value)}><option value="">Select portfolio</option>{portfolios.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" className="btn-primary mt-4 w-full" disabled={loading || !portfolioId} onClick={() => generate('portfolio')}><FileText className="mr-2 inline h-4 w-4" />Generate portfolio report</button></SectionCard>
      <SectionCard title="Stock analysis report" subtitle="Company data, fundamentals, technicals, news, and explicit missing-data notes."><label className="text-sm text-slate-300">NSE symbol<input aria-label="NSE symbol" className="input-shell mt-2 w-full uppercase" value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="TCS" /></label><button type="button" className="btn-primary mt-4 w-full" disabled={loading || !symbol.trim()} onClick={() => generate('stock')}><FileText className="mr-2 inline h-4 w-4" />Generate stock report</button></SectionCard>
      <SectionCard title="Financial future report" subtitle="Private planner projections, goals, alerts, and assumptions from your saved plan."><p className="text-sm leading-6 text-slate-400">The report uses server-authorized planner data. Missing profile data is shown as incomplete rather than fabricated.</p><button type="button" className="btn-primary mt-4 w-full" disabled={loading} onClick={() => generate('financial')}><FileText className="mr-2 inline h-4 w-4" />Generate financial future report</button></SectionCard>
    </div>
    {loading ? <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-300">Generating your report…</div> : null}
    {report ? <ReportPreview report={report} kind={lastKind} loading={loading} onExport={exportReport} /> : <div className="mt-6 rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-400">Choose a report above to preview authenticated results and download a PDF or CSV export.</div>}
  </div>
}

export default ReportsPage
