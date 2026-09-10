import { Download, FileText, Share2 } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import SectionCard from '../components/SectionCard'
import { FutureChart } from '../components/Charts'
import { futureProjection, reportCards } from '../data/mockData'

function ReportsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Reports"
        title="Financial reports and future simulators"
        description="Structured reporting pages make the product feel ready for client delivery, investor demos, and premium subscription workflows."
        actions={
          <>
            <button className="btn-secondary">
              <span className="inline-flex items-center gap-2">
                <Share2 className="h-4 w-4" /> Share report
              </span>
            </button>
            <button className="btn-primary">
              <span className="inline-flex items-center gap-2">
                <Download className="h-4 w-4" /> Export PDF
              </span>
            </button>
          </>
        }
      />

      <div className="page-grid">
        <SectionCard
          title="Future wealth simulator"
          subtitle="Baseline versus optimized path based on better contribution discipline and lower portfolio concentration."
        >
          <FutureChart data={futureProjection} />
        </SectionCard>

        <SectionCard title="Scenario summary" subtitle="What changes if your inputs improve?">
          <div className="space-y-4">
            <div className="elevate-hover rounded-[26px] border border-white/10 bg-white/[0.03] p-5">
              <p className="text-sm text-slate-400">Age 35 projection</p>
              <h3 className="mt-2 font-display text-4xl text-white">₹18.4L</h3>
            </div>
            <div className="elevate-hover rounded-[26px] border border-cyan/10 bg-white/[0.03] p-5">
              <p className="text-sm text-slate-400">If SIP rises by ₹8k</p>
              <h3 className="mt-2 font-display text-4xl text-aqua">₹25.3L</h3>
            </div>
            <div className="rounded-[26px] border border-gold/20 bg-gold/8 p-5">
              <p className="text-sm leading-7 text-slate-200">
                The optimized path adds resilience, increases target probability, and provides a
                wider buffer against weak market years.
              </p>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {reportCards.map((report) => (
          <div key={report.title} className="glass-panel elevate-hover rounded-[28px] p-5">
            <div className="flex items-center justify-between">
              <FileText className="h-5 w-5 text-aqua" />
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-300">
                {report.status}
              </span>
            </div>
            <h3 className="mt-6 font-display text-2xl text-white">{report.title}</h3>
            <p className="mt-3 text-sm leading-7 text-slate-400">{report.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default ReportsPage
