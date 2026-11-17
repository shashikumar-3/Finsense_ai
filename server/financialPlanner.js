const MONTHS_PER_YEAR = 12

function finite(value, name, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${name} must be a finite number between ${min} and ${max}.`)
  return number
}

function monthlyRate(annualPercent) {
  return Math.pow(1 + finite(annualPercent, 'Annual return', { min: -99, max: 1000 }) / 100, 1 / MONTHS_PER_YEAR) - 1
}

function futureValue(principal, monthlyContribution, annualReturnPercent, months) {
  const p = finite(principal, 'Principal', { min: 0 })
  const c = finite(monthlyContribution, 'Monthly contribution', { min: 0 })
  const n = Math.floor(finite(months, 'Months', { min: 0, max: 1200 }))
  const rate = monthlyRate(annualReturnPercent)
  if (n === 0) return p
  const growth = Math.pow(1 + rate, n)
  return rate === 0 ? p + c * n : p * growth + c * ((growth - 1) / rate)
}

function inflationAdjusted(value, annualInflationPercent, months) {
  const amount = finite(value, 'Future value', { min: 0 })
  const inflation = finite(annualInflationPercent, 'Inflation', { min: -99, max: 1000 })
  const n = finite(months, 'Months', { min: 0, max: 1200 })
  return amount / Math.pow(1 + inflation / 100, n / MONTHS_PER_YEAR)
}

function monthlySummary(records = []) {
  const summary = { income: 0, expenses: 0, surplus: 0, estimatedIncome: 0, estimatedExpenses: 0 }
  for (const record of Array.isArray(records) ? records : []) {
    const amount = finite(record.amount, 'Cash-flow amount', { min: 0 })
    // One-off events are handled by the life-event simulator; they are not recurring monthly cash flow.
    const monthly = record.frequency === 'annual' ? amount / 12 : record.frequency === 'weekly' ? amount * 52 / 12 : record.frequency === 'one_time' ? 0 : amount
    if (record.kind === 'income') { summary.income += monthly; if (record.is_estimated) summary.estimatedIncome += monthly }
    else { summary.expenses += monthly; if (record.is_estimated) summary.estimatedExpenses += monthly }
  }
  summary.surplus = summary.income - summary.expenses
  return summary
}

function projectPlan({ currentSavings = 0, monthlyContribution = 0, annualReturnPercent = 8, annualInflationPercent = 6, years = 20 } = {}) {
  const months = Math.floor(finite(years, 'Projection years', { min: 0, max: 100 }) * 12)
  const points = [{ year: 0, nominal: finite(currentSavings, 'Current savings', { min: 0 }), real: finite(currentSavings, 'Current savings', { min: 0 }) }]
  for (let year = 1; year <= Math.ceil(months / 12); year += 1) {
    const elapsed = Math.min(year * 12, months)
    const nominal = futureValue(currentSavings, monthlyContribution, annualReturnPercent, elapsed)
    points.push({ year: elapsed / 12, nominal, real: inflationAdjusted(nominal, annualInflationPercent, elapsed) })
  }
  const endingNominal = points.at(-1).nominal
  const totalContributions = finite(currentSavings, 'Current savings', { min: 0 }) + finite(monthlyContribution, 'Monthly contribution', { min: 0 }) * months
  return {
    points,
    endingNominal,
    endingReal: points.at(-1).real,
    totalContributions,
    investmentGrowth: endingNominal - totalContributions,
    assumptions: {
      annualReturnPercent,
      annualInflationPercent,
      realAnnualReturnPercent: ((1 + Number(annualReturnPercent) / 100) / (1 + Number(annualInflationPercent) / 100) - 1) * 100,
      monthlyContribution,
      years,
      contributionMethod: 'end_of_month',
    },
  }
}

function analyzeGoals(goals = [], projection, monthlySurplus = null) {
  return (Array.isArray(goals) ? goals : []).map((goal) => {
    const target = finite(goal.target_amount, 'Goal target', { min: 0 })
    const saved = finite(goal.current_amount || 0, 'Goal current amount', { min: 0 })
    const months = Math.max(0, Math.ceil((new Date(goal.target_date).getTime() - Date.now()) / (30.4375 * 86400000)))
    const monthly = months > 0 ? Math.max(0, (target - saved) / months) : target > saved ? Infinity : 0
    const projected = projection?.points?.find((point) => point.year >= months / 12)?.nominal ?? saved
    return { id: goal.id, name: goal.name, targetAmount: target, currentAmount: saved, monthsRemaining: months, requiredMonthlyContribution: Number.isFinite(monthly) ? monthly : null, projectedAmount: projected, status: projected >= target ? 'on_track' : 'shortfall', shortfall: Math.max(0, target - projected), monthlySurplus }
  })
}

function buildRiskAlerts({ cashFlow, emergencySavings = 0, essentialExpenses = 0, debtPayments = 0, goals = [], assumedReturn = 8 }) {
  const alerts = []
  if (cashFlow.surplus < 0) alerts.push({ id: 'negative-cash-flow', severity: 'high', title: 'Monthly cash flow is negative', reason: 'Recorded monthly expenses exceed recorded income.', rule: 'income - expenses < 0' })
  if (essentialExpenses > 0 && emergencySavings < essentialExpenses * 3) alerts.push({ id: 'emergency-reserve', severity: 'attention', title: 'Emergency reserve is below the configured target', reason: 'The planner target is three months of essential expenses.', rule: 'emergency savings < 3 × essential expenses' })
  if (cashFlow.income > 0 && debtPayments / cashFlow.income > 0.4) alerts.push({ id: 'debt-burden', severity: 'attention', title: 'Debt payments are a large share of income', reason: 'Debt payments exceed the configured 40% review threshold.', rule: 'debt payments / income > 0.40' })
  if (assumedReturn > 12) alerts.push({ id: 'high-return-assumption', severity: 'attention', title: 'Return assumption is unusually high', reason: 'Review the assumption; projections are not guaranteed.', rule: 'assumed annual return > 12%' })
  for (const goal of goals.filter((item) => item.status === 'shortfall')) alerts.push({ id: `goal-${goal.id}`, severity: 'attention', title: `Goal shortfall: ${goal.name}`, reason: `The current projection is below the target by ${goal.shortfall.toFixed(2)}.`, rule: 'projected amount < target amount' })
  return alerts
}

function calculatePlanner(input = {}) {
  const profile = input.profile || {}
  const recorded = monthlySummary(input.cashflows)
  const currency = String(profile.currency || 'INR').toUpperCase()

  const profileTakeHome = finite(profile.monthly_take_home || 0, 'Monthly take-home', { min: 0 })
  const profileExpenses = finite(profile.essential_monthly_expenses || 0, 'Essential expenses', { min: 0 }) + finite(profile.monthly_debt_payments || 0, 'Debt payments', { min: 0 })

  const income = recorded.income > 0 ? recorded.income : profileTakeHome
  const expenses = recorded.expenses > 0 ? recorded.expenses : profileExpenses
  const surplus = income - expenses
  const cashFlow = {
    income,
    expenses,
    surplus,
    estimatedIncome: recorded.estimatedIncome || (recorded.income === 0 ? profileTakeHome : 0),
    estimatedExpenses: recorded.estimatedExpenses || (recorded.expenses === 0 ? profileExpenses : 0),
  }

  const allAssets = Array.isArray(input.assets) ? input.assets : []
  const compatibleAssets = allAssets.filter((item) => String(item.currency || currency).toUpperCase() === currency)
  const excludedAssets = allAssets.filter((item) => !compatibleAssets.includes(item)).map((item) => ({ id: item.id, name: item.name, currency: item.currency || null }))
  const assets = compatibleAssets.reduce((sum, item) => sum + finite(item.current_value || 0, 'Asset value', { min: 0 }), 0)
  const emergencySavings = compatibleAssets.filter((item) => item.kind === 'emergency_fund').reduce((sum, item) => sum + Number(item.current_value || 0), 0)
  const years = Math.max(1, Math.min(100, Number(profile.retirement_age || 60) - Number(profile.age || 30)))
  const projection = projectPlan({ currentSavings: assets, monthlyContribution: Math.max(0, cashFlow.surplus), annualReturnPercent: Number(profile.expected_return_percent ?? 8), annualInflationPercent: Number(profile.inflation_percent ?? 6), years })
  const goals = analyzeGoals(input.goals, projection, cashFlow.surplus)
  return { currency, cashFlow, totalAssets: assets, assetCoverage: { included: compatibleAssets.length, excluded: excludedAssets.length, excludedAssets }, projection, goals, emergencyFund: { current: emergencySavings, target: Math.max(0, Number(profile.essential_monthly_expenses || 0) * Number(profile.emergency_months || 3)), shortfall: Math.max(0, Number(profile.essential_monthly_expenses || 0) * Number(profile.emergency_months || 3) - emergencySavings) }, alerts: buildRiskAlerts({ cashFlow, emergencySavings, essentialExpenses: Number(profile.essential_monthly_expenses || 0), debtPayments: Number(profile.monthly_debt_payments || 0), goals, assumedReturn: Number(profile.expected_return_percent ?? 8) }), generatedAt: new Date().toISOString(), methodology: { compounding: 'monthly', contributions: 'end of month', inflation: 'nominal values divided by compounded annual inflation', disclaimer: 'Projections are estimates based on user-entered assumptions, not guarantees or financial advice.', limitations: excludedAssets.length ? ['Assets in a different currency were excluded from totals; convert them explicitly before including them.'] : [] } }
}

function compareScenarios(baseInput, scenarios = []) {
  if (!Array.isArray(scenarios) || scenarios.length === 0 || scenarios.length > 6) throw new Error('One to six scenarios are required.')
  return scenarios.map((scenario) => {
    const overrides = scenario?.overrides || {}
    const profile = { ...(baseInput?.profile || {}), ...overrides }
    const result = calculatePlanner({ ...baseInput, profile })
    return { name: String(scenario.name || 'Custom scenario'), assumptions: profile, endingNominal: result.projection.endingNominal, endingReal: result.projection.endingReal, monthlySurplus: result.cashFlow.surplus, alerts: result.alerts }
  })
}

function buildPlannerExplanation(analysis) {
  const cashFlow = analysis?.cashFlow || {}
  const surplusText = Number(cashFlow.surplus) >= 0 ? `a monthly surplus of ${cashFlow.surplus.toFixed(2)}` : `a monthly deficit of ${Math.abs(cashFlow.surplus || 0).toFixed(2)}`
  const alerts = (analysis?.alerts || []).map((item) => item.title).join('; ')
  const assumptions = analysis?.projection?.assumptions || {}
  const projection = analysis?.projection || {}
  return `Current position: the recorded planning inputs indicate ${surplusText}.\n\nProjection: estimated ending wealth is ${Number(projection.endingNominal || 0).toFixed(2)} nominal, or approximately ${Number(projection.endingReal || 0).toFixed(2)} in today's purchasing power, over ${Number(assumptions.years || 0)} years.\n\nAssumptions: the model uses ${Number(assumptions.annualReturnPercent || 0).toFixed(2)}% annual investment return, ${Number(assumptions.annualInflationPercent || 0).toFixed(2)}% inflation, and ${Number(assumptions.monthlyContribution || 0).toFixed(2)} contributed at the end of each month. The implied real annual return is approximately ${Number(assumptions.realAnnualReturnPercent || 0).toFixed(2)}%; this is an assumption, not a forecast.\n\nContribution versus growth: approximately ${Number(projection.totalContributions || 0).toFixed(2)} comes from current savings and planned contributions, while ${Number(projection.investmentGrowth || 0).toFixed(2)} is modeled growth. ${alerts ? `Areas to review: ${alerts}.` : 'No configured planning alert was triggered.'} These figures are estimates, not guarantees or personalized investment instructions.`
}

function simulateLifeEvent(input = {}, event = {}) {
  const base = calculatePlanner(input)
  const months = Math.max(1, Math.min(1200, Math.floor(finite(event.months || 1, 'Event months', { min: 1, max: 1200 }))))
  const incomeReduction = finite(event.monthlyIncomeChange || 0, 'Monthly income change', { min: -1e9, max: 1e9 })
  const expenseChange = finite(event.monthlyExpenseChange || 0, 'Monthly expense change', { min: -1e9, max: 1e9 })
  const oneOffCost = finite(event.oneOffCost || 0, 'One-off event cost', { min: 0, max: 1e12 })
  const monthlySurplus = base.cashFlow.surplus + incomeReduction - expenseChange
  const currentSavings = Math.max(0, base.totalAssets - oneOffCost)
  const years = Math.max(1, Number(input.profile?.retirement_age || 60) - Number(input.profile?.age || 30))
  const horizonMonths = years * MONTHS_PER_YEAR
  const eventMonths = Math.min(months, horizonMonths)
  const annualReturnPercent = Number(input.profile?.expected_return_percent ?? 8)
  const annualInflationPercent = Number(input.profile?.inflation_percent ?? 6)
  const duringEvent = futureValue(currentSavings, Math.max(0, monthlySurplus), annualReturnPercent, eventMonths)
  const afterEvent = futureValue(duringEvent, Math.max(0, base.cashFlow.surplus), annualReturnPercent, horizonMonths - eventMonths)
  const projected = projectPlan({ currentSavings, monthlyContribution: Math.max(0, monthlySurplus), annualReturnPercent, annualInflationPercent, years })
  projected.points[projected.points.length - 1].nominal = afterEvent
  projected.points[projected.points.length - 1].real = inflationAdjusted(afterEvent, annualInflationPercent, horizonMonths)
  projected.endingNominal = afterEvent
  projected.endingReal = projected.points[projected.points.length - 1].real
  return { event: { name: String(event.name || 'Life event'), months, incomeReduction, expenseChange, oneOffCost }, baselineEndingNominal: base.projection.endingNominal, scenarioEndingNominal: projected.endingNominal, monthlySurplus, difference: projected.endingNominal - base.projection.endingNominal, projection: projected, limitations: ['This is a deterministic sensitivity calculation using the entered event assumptions.', 'It does not assign probabilities or predict employment, markets, or expenses.'] }
}

function calculateFinancialIndependence(input = {}, { targetMultiple = 25, maxYears = 100 } = {}) {
  const profile = input.profile || {}
  const expenses = finite(profile.essential_monthly_expenses || 0, 'Essential monthly expenses', { min: 0 }) + finite(profile.monthly_debt_payments || 0, 'Debt payments', { min: 0 })
  const assets = (Array.isArray(input.assets) ? input.assets : []).reduce((sum, item) => sum + finite(item.current_value || 0, 'Asset value', { min: 0 }), 0)
  const planned = calculatePlanner(input)
  const surplus = planned.cashFlow.surplus
  const target = expenses * 12 * finite(targetMultiple, 'Target multiple', { min: 1, max: 100 })
  const annualReturn = Number(profile.expected_return_percent ?? 8)
  let value = assets
  let years = null
  for (let year = 0; year <= maxYears; year += 1) {
    if (value >= target) { years = year; break }
    value = futureValue(value, Math.max(0, surplus), annualReturn, 12)
  }
  return { currentAssets: assets, annualExpenses: expenses * 12, targetAssets: target, monthlySurplus: surplus, estimatedYears: years, status: years === null ? 'not_reached_within_horizon' : 'estimate', assumptions: { targetMultiple, annualReturnPercent: annualReturn, maxYears }, disclaimer: 'This is an estimate based on entered expenses, savings, and return assumptions; it is not a guaranteed retirement date.' }
}

module.exports = { futureValue, inflationAdjusted, monthlySummary, projectPlan, analyzeGoals, buildRiskAlerts, calculatePlanner, compareScenarios, buildPlannerExplanation, simulateLifeEvent, calculateFinancialIndependence }
