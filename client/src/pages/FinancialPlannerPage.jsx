import { AlertTriangle, Calculator, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { calculateFinancialIndependence, comparePlannerScenarios, createPlanningRecord, deletePlanningRecord, explainFinancialPlan, fetchFinancialPlanner, saveFinancialProfile, simulateLifeEvent } from '../api/financialPlannerApi'
import PageHeader from '../components/PageHeader'
import SectionCard from '../components/SectionCard'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const money = (value, currency = 'INR') => Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value)) : '--'
const compactMoney = (value, currency = 'INR') => {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '--'
  if (currency === 'INR') {
    if (Math.abs(amount) >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`
    if (Math.abs(amount) >= 100000) return `₹${(amount / 100000).toFixed(2)} L`
  }
  return money(amount, currency)
}

function FinancialPlannerPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [profile, setProfile] = useState({ currency: 'INR', age: '', retirement_age: 60, monthly_take_home: '', essential_monthly_expenses: '', monthly_debt_payments: '', emergency_months: 3, expected_return_percent: 8, inflation_percent: 6 })
  const [cashflow, setCashflow] = useState({ kind: 'expense', category: 'Living expenses', amount: '', frequency: 'monthly', is_estimated: true })
  const [goal, setGoal] = useState({ name: '', category: 'other', target_amount: '', target_date: '', current_amount: 0, monthly_contribution: 0, priority: 3 })
  const [asset, setAsset] = useState({ kind: 'savings', name: 'Savings', current_value: '', currency: 'INR', is_estimated: true, is_liquid: true })
  const [scenarios, setScenarios] = useState([])
  const [explanation, setExplanation] = useState('')
  const [lifeEvent, setLifeEvent] = useState({ name: 'Temporary income interruption', months: 3, monthlyIncomeChange: -50000, monthlyExpenseChange: 0, oneOffCost: 0 })
  const [lifeEventResult, setLifeEventResult] = useState(null)
  const [fiResult, setFiResult] = useState(null)

  async function load() {
    setLoading(true); setError('')
    try { const result = await fetchFinancialPlanner(); setData(result); setProfile((current) => ({ ...current, ...(result.profile || {}) })) } catch (reason) { setError(reason.message || 'Unable to load Financial Planner.') } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function saveProfile(event) {
    event.preventDefault(); setSaving(true); setError('')
    try { await saveFinancialProfile(profile); await load() } catch (reason) { setError(reason.message || 'Unable to save profile.') } finally { setSaving(false) }
  }
  async function addCashflow(event) {
    event.preventDefault(); if (!cashflow.amount || !cashflow.category) return setError('Enter a cash-flow category and amount.')
    setSaving(true); try { await createPlanningRecord('cashflow', { ...cashflow, amount: Number(cashflow.amount) }); setCashflow({ ...cashflow, amount: '' }); await load() } catch (reason) { setError(reason.message) } finally { setSaving(false) }
  }
  async function addGoal(event) {
    event.preventDefault(); if (!goal.name || !goal.target_amount || !goal.target_date) return setError('Enter a goal name, target amount, and target date.')
    setSaving(true); try { await createPlanningRecord('goal', { ...goal, target_amount: Number(goal.target_amount), current_amount: Number(goal.current_amount || 0), monthly_contribution: Number(goal.monthly_contribution || 0) }); setGoal({ ...goal, name: '', target_amount: '', target_date: '' }); await load() } catch (reason) { setError(reason.message) } finally { setSaving(false) }
  }
  async function addAsset(event) {
    event.preventDefault(); if (!asset.name || asset.current_value === '') return setError('Enter an asset name and current value.')
    setSaving(true); try { await createPlanningRecord('asset', { ...asset, current_value: Number(asset.current_value) }); setAsset({ ...asset, current_value: '' }); await load() } catch (reason) { setError(reason.message) } finally { setSaving(false) }
  }
  async function removeRecord(type, id) {
    if (!id) return
    setSaving(true); setError('')
    try { await deletePlanningRecord(type, id); await load() } catch (reason) { setError(reason.message || 'Unable to delete record.') } finally { setSaving(false) }
  }
  async function compareScenarios() {
    setSaving(true); setError('')
    try { const result = await comparePlannerScenarios(); setScenarios(result.scenarios || []) } catch (reason) { setError(reason.message || 'Unable to compare scenarios.') } finally { setSaving(false) }
  }
  async function explainPlan() {
    setSaving(true); setError('')
    try { const result = await explainFinancialPlan(); setExplanation(result.answer || '') } catch (reason) { setError(reason.message || 'Unable to explain the plan.') } finally { setSaving(false) }
  }
  async function runLifeEvent(event) {
    setSaving(true); setError('')
    try { const result = await simulateLifeEvent(event); setLifeEventResult(result.result) } catch (reason) { setError(reason.message || 'Unable to simulate the life event.') } finally { setSaving(false) }
  }
  async function runFi() {
    setSaving(true); setError('')
    try { const result = await calculateFinancialIndependence({ targetMultiple: 25 }); setFiResult(result.result) } catch (reason) { setError(reason.message || 'Unable to calculate financial independence.') } finally { setSaving(false) }
  }

  const analysis = data?.analysis
  const storageUnavailable = Boolean(error && !data)
  return <div><PageHeader eyebrow="Financial Planner" title="Plan your financial future" description="Build a private, assumption-driven plan for cash flow, goals, emergency reserves, and future wealth. Projections are estimates, not guarantees." actions={<button type="button" className="btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</button>} />
    {error && !storageUnavailable ? <div role="alert" className="mb-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div> : null}
    {loading ? <div className="glass-panel animate-pulse rounded-3xl p-8">Loading your private plan…</div> : storageUnavailable ? <div role="alert" className="glass-panel rounded-3xl border border-amber-400/25 p-8"><p className="text-xs uppercase tracking-[0.18em] text-amber-200">Planner unavailable</p><h2 className="mt-3 text-2xl font-semibold text-white">Your private planning storage is unavailable</h2><p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">{error}</p><p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">No profile, balances, or projections are shown until the authenticated development database is available. Once the Phase 6 testing migration is applied, use Refresh to load your plan.</p><button type="button" className="btn-primary mt-6" onClick={load}>Retry planner</button></div> : <div className="space-y-6">
      <SectionCard title="Financial profile" subtitle="These are planning assumptions. Actual portfolio values remain in Portfolio and are not duplicated here."><form onSubmit={saveProfile} className="grid gap-4 md:grid-cols-3">{[['age','Age'],['retirement_age','Retirement age'],['monthly_take_home','Monthly take-home income'],['essential_monthly_expenses','Essential monthly expenses'],['monthly_debt_payments','Monthly debt payments'],['emergency_months','Emergency-fund months'],['expected_return_percent','Expected annual return (%)'],['inflation_percent','Inflation assumption (%)']].map(([key,label]) => <label key={key} className="text-sm text-slate-300">{label}<input className="input-shell mt-2 w-full" type="number" step="any" value={profile[key] ?? ''} onChange={(event) => setProfile({ ...profile, [key]: event.target.value })} /></label>)}<button className="btn-primary md:col-span-3" disabled={saving} type="submit">{saving ? 'Saving…' : 'Save profile'}</button></form></SectionCard>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><div className="glass-panel rounded-3xl p-5"><p className="text-xs uppercase tracking-[0.18em] text-slate-500">Monthly income</p><p className="mt-3 text-2xl text-white">{money(analysis?.cashFlow?.income, analysis?.currency)}</p></div><div className="glass-panel rounded-3xl p-5"><p className="text-xs uppercase tracking-[0.18em] text-slate-500">Monthly expenses</p><p className="mt-3 text-2xl text-white">{money(analysis?.cashFlow?.expenses, analysis?.currency)}</p></div><div className="glass-panel rounded-3xl p-5"><p className="text-xs uppercase tracking-[0.18em] text-slate-500">Monthly surplus</p><p className={`mt-3 text-2xl ${Number(analysis?.cashFlow?.surplus) < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{money(analysis?.cashFlow?.surplus, analysis?.currency)}</p></div><div className="glass-panel rounded-3xl p-5"><p className="text-xs uppercase tracking-[0.18em] text-slate-500">Projected wealth</p><p className="mt-3 text-2xl text-white">{money(analysis?.projection?.endingNominal, analysis?.currency)}</p><p className="mt-2 text-xs text-slate-500">Today's purchasing power: {money(analysis?.projection?.endingReal, analysis?.currency)}</p></div></section>
      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard title="Add income or expense" subtitle="Records are normalized to monthly amounts for the cash-flow summary.">
          <form onSubmit={addCashflow} className="space-y-3">
            <select className="input-shell w-full" value={cashflow.kind} onChange={(event) => setCashflow({ ...cashflow, kind: event.target.value })}><option value="income">Income</option><option value="expense">Expense</option></select>
            <input className="input-shell w-full" placeholder="Category" value={cashflow.category} onChange={(event) => setCashflow({ ...cashflow, category: event.target.value })} />
            <input className="input-shell w-full" type="number" min="0" placeholder="Amount" value={cashflow.amount} onChange={(event) => setCashflow({ ...cashflow, amount: event.target.value })} />
            <select className="input-shell w-full" value={cashflow.frequency} onChange={(event) => setCashflow({ ...cashflow, frequency: event.target.value })}><option value="monthly">Monthly</option><option value="annual">Annual</option><option value="weekly">Weekly</option></select>
            <button className="btn-secondary inline-flex items-center gap-2" disabled={saving}><Plus className="h-4 w-4" />Add record</button>
          </form>
          {(data?.cashflows || []).length > 0 ? (
            <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Added Cash Flows</p>
              <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                {data.cashflows.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${item.kind === 'income' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                        {item.kind}
                      </span>
                      <span className="font-medium text-white">{item.category}</span>
                      <span className="text-slate-400">({item.frequency})</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-slate-200">{money(item.amount, analysis?.currency)}</span>
                      <button type="button" onClick={() => removeRecord('cashflow', item.id)} disabled={saving} className="text-slate-500 hover:text-rose-400 transition" title="Delete record">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </SectionCard>
        <SectionCard title="Add savings or asset" subtitle="Use estimates for assets that are not linked to a verified portfolio value.">
          <form onSubmit={addAsset} className="space-y-3">
            <select className="input-shell w-full" value={asset.kind} onChange={(event) => setAsset({ ...asset, kind: event.target.value })}><option value="savings">Bank savings</option><option value="emergency_fund">Emergency fund</option><option value="investment">Other investment</option></select>
            <input className="input-shell w-full" placeholder="Asset name" value={asset.name} onChange={(event) => setAsset({ ...asset, name: event.target.value })} />
            <input className="input-shell w-full" type="number" min="0" placeholder="Current value" value={asset.current_value} onChange={(event) => setAsset({ ...asset, current_value: event.target.value })} />
            <button className="btn-secondary inline-flex items-center gap-2" disabled={saving}><Plus className="h-4 w-4" />Add asset</button>
          </form>
          {(data?.assets || []).length > 0 ? (
            <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Recorded Assets & Savings</p>
              <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                {data.assets.map((item) => (
                  <div key={item.id || item.name} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-cyan/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-cyan">
                        {item.kind?.replace('_', ' ')}
                      </span>
                      <span className="font-medium text-white">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-slate-200">{money(item.current_value, item.currency || analysis?.currency)}</span>
                      {item.id && !item.linked_portfolio_id ? (
                        <button type="button" onClick={() => removeRecord('asset', item.id)} disabled={saving} className="text-slate-500 hover:text-rose-400 transition" title="Delete asset">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </SectionCard>
        <SectionCard title="Create a goal" subtitle="Goal projections use the same validated assumptions as the wealth projection.">
          <form onSubmit={addGoal} className="space-y-3">
            <input className="input-shell w-full" placeholder="Goal name" value={goal.name} onChange={(event) => setGoal({ ...goal, name: event.target.value })} />
            <input className="input-shell w-full" type="number" min="0" placeholder="Target amount" value={goal.target_amount} onChange={(event) => setGoal({ ...goal, target_amount: event.target.value })} />
            <input className="input-shell w-full" type="date" value={goal.target_date} onChange={(event) => setGoal({ ...goal, target_date: event.target.value })} />
            <button className="btn-secondary inline-flex items-center gap-2" disabled={saving}><Plus className="h-4 w-4" />Add goal</button>
          </form>
        </SectionCard>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]"><SectionCard title="Future wealth estimate" subtitle="Nominal wealth and approximate purchasing power in today's rupees. The chart shows estimates, not actual returns."><div className="h-72 w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={analysis?.projection?.points || []}><CartesianGrid strokeDasharray="3 3" stroke="#ffffff12" /><XAxis dataKey="year" stroke="#94a3b8" tickFormatter={(value) => `Y${value}`} /><YAxis stroke="#94a3b8" tickFormatter={(value) => compactMoney(value, analysis?.currency || 'INR')} /><Tooltip formatter={(value, name) => [money(value, analysis?.currency || 'INR'), name === 'real' ? "Today's value" : 'Nominal value']} /><Line type="monotone" dataKey="nominal" stroke="#34d399" strokeWidth={3} dot={false} /><Line type="monotone" dataKey="real" stroke="#67e8f9" strokeWidth={3} dot={false} /></LineChart></ResponsiveContainer></div><div className="mt-4 space-y-3">{(analysis?.projection?.points || []).slice(-3).map((point) => <div key={point.year} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm"><span className="text-slate-400">Year {point.year}</span><span className="text-white">{money(point.nominal, analysis?.currency || 'INR')}</span><span className="text-cyan">Real {money(point.real, analysis?.currency || 'INR')}</span></div>)}</div></SectionCard><SectionCard title="Alerts and emergency fund" subtitle="Rules are transparent planning prompts, not universal financial laws."><div className="rounded-2xl border border-cyan/20 bg-cyan/10 p-4"><ShieldCheck className="h-5 w-5 text-cyan" /><p className="mt-3 text-sm text-slate-200">Emergency fund: {money(analysis?.emergencyFund?.current, analysis?.currency)} / {money(analysis?.emergencyFund?.target, analysis?.currency)}</p><p className="mt-2 text-xs text-slate-400">Shortfall: {money(analysis?.emergencyFund?.shortfall, analysis?.currency)}</p></div><div className="mt-4 space-y-3">{(analysis?.alerts || []).map((alert) => <div key={alert.id} className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm"><div className="flex gap-2 text-amber-100"><AlertTriangle className="h-4 w-4" />{alert.title}</div><p className="mt-2 text-xs text-slate-300">{alert.reason}</p></div>)}{!analysis?.alerts?.length ? <p className="text-sm text-slate-400">No configured planning alerts were triggered.</p> : null}</div></SectionCard></div>
      <SectionCard title="Compare hypothetical scenarios" subtitle="The starting data is held constant; only the displayed return assumption changes. No probabilities are assigned."><button type="button" className="btn-secondary" onClick={compareScenarios} disabled={saving}>Compare conservative, moderate, and optimistic</button>{scenarios.length ? <div className="mt-4 grid gap-3 md:grid-cols-3">{scenarios.map((scenario) => <div key={scenario.name} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="font-medium text-white">{scenario.name}</p><p className="mt-2 text-sm text-cyan">{money(scenario.endingNominal, analysis?.currency || 'INR')}</p><p className="mt-1 text-xs text-slate-500">Return assumption: {scenario.assumptions.expected_return_percent}%</p></div>)}</div> : null}</SectionCard>
      <SectionCard title="Plan explanation" subtitle="A deterministic explanation is available even when an external AI provider is unavailable."><button type="button" className="btn-secondary" onClick={explainPlan} disabled={saving}>Explain my plan</button>{explanation ? <p className="mt-4 rounded-2xl border border-cyan/20 bg-cyan/10 p-4 text-sm leading-7 text-slate-200">{explanation}</p> : null}</SectionCard>
      <div className="grid gap-6 lg:grid-cols-2"><SectionCard title="Life-event simulator" subtitle="Test a hypothetical income change or one-off cost without changing your saved plan."><div className="grid gap-3 sm:grid-cols-2">{[['name','Event name'],['months','Months'],['monthlyIncomeChange','Monthly income change'],['monthlyExpenseChange','Monthly expense change'],['oneOffCost','One-off cost']].map(([key,label]) => <label key={key} className="text-sm text-slate-300">{label}<input className="input-shell mt-2 w-full" type={key === 'name' ? 'text' : 'number'} value={lifeEvent[key]} onChange={(event) => setLifeEvent({ ...lifeEvent, [key]: key === 'name' ? event.target.value : Number(event.target.value) })} /></label>)}</div><button type="button" className="btn-secondary mt-4" disabled={saving} onClick={() => runLifeEvent(lifeEvent)}>Run hypothetical event</button>{lifeEventResult ? <p className="mt-4 text-sm text-slate-300">Estimated ending wealth change: <span className={lifeEventResult.difference >= 0 ? 'text-emerald-300' : 'text-amber-200'}>{money(lifeEventResult.difference, analysis?.currency || 'INR')}</span>. Monthly surplus in this scenario: {money(lifeEventResult.monthlySurplus, analysis?.currency || 'INR')}.</p> : null}</SectionCard><SectionCard title="Financial independence estimate" subtitle="A planning estimate using annual expenses × 25 as a configurable target. It is not a guaranteed retirement date."><button type="button" className="btn-secondary" disabled={saving} onClick={runFi}>Calculate estimate</button>{fiResult ? <div className="mt-4 space-y-2 text-sm text-slate-300"><p>Target assets: <span className="text-white">{money(fiResult.targetAssets, analysis?.currency || 'INR')}</span></p><p>Estimated time: <span className="text-white">{fiResult.estimatedYears === null ? 'Not reached within 100 years' : `${fiResult.estimatedYears} years`}</span></p><p className="text-xs text-slate-500">{fiResult.disclaimer}</p></div> : null}</SectionCard></div>
      <SectionCard title="Goal achievement" subtitle="Shortfalls are estimates based on the current inputs and available monthly surplus.">{(analysis?.goals || []).length ? <div className="grid gap-3 md:grid-cols-2">{analysis.goals.map((item) => <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><div className="flex justify-between gap-3"><span className="font-medium text-white">{item.name}</span><div className="flex items-center gap-2"><span className={item.status === 'on_track' ? 'text-emerald-300' : 'text-amber-200'}>{item.status.replace('_',' ')}</span><button type="button" onClick={() => removeRecord('goal', item.id)} disabled={saving} className="text-slate-500 hover:text-rose-400 transition" title="Delete goal"><Trash2 className="h-3.5 w-3.5" /></button></div></div><p className="mt-2 text-sm text-slate-400">Projected {money(item.projectedAmount, analysis?.currency || 'INR')} of {money(item.targetAmount, analysis?.currency || 'INR')}</p><p className="mt-2 text-xs text-slate-500">Required monthly contribution: {item.requiredMonthlyContribution === null ? 'Unavailable' : money(item.requiredMonthlyContribution, analysis?.currency || 'INR')}</p></div>)}</div> : <p className="text-sm text-slate-400">No goals yet. Add one above to compare progress against a target date.</p>}</SectionCard>
      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs leading-5 text-slate-400"><Calculator className="h-4 w-4 shrink-0 text-cyan" />{analysis?.methodology?.disclaimer}</div>
    </div>}
  </div>
}

export default FinancialPlannerPage
