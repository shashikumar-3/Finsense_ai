const test = require('node:test')
const assert = require('node:assert/strict')
const { futureValue, inflationAdjusted, monthlySummary, projectPlan, calculatePlanner, compareScenarios, simulateLifeEvent, calculateFinancialIndependence } = require('./financialPlanner')

test('future value handles zero return and monthly compounding', () => {
  assert.equal(futureValue(1000, 100, 0, 12), 2200)
  assert.ok(futureValue(1000, 100, 12, 12) > 2200)
})

test('inflation adjustment preserves nominal and real values separately', () => {
  assert.ok(Math.abs(inflationAdjusted(110, 10, 12) - 100) < 1e-9)
})

test('cash-flow summary normalizes annual and weekly records', () => {
  const summary = monthlySummary([{ kind: 'income', amount: 12000, frequency: 'annual' }, { kind: 'expense', amount: 100, frequency: 'weekly' }, { kind: 'expense', amount: 50000, frequency: 'one_time' }])
  assert.equal(summary.income, 1000)
  assert.equal(summary.expenses, 100 * 52 / 12)
})

test('planner excludes incompatible asset currencies instead of combining unlike values', () => {
  const result = calculatePlanner({ profile: { currency: 'INR', age: 30, retirement_age: 60 }, assets: [{ name: 'INR savings', current_value: 1000, currency: 'INR' }, { name: 'USD account', current_value: 1000, currency: 'USD' }] })
  assert.equal(result.totalAssets, 1000)
  assert.equal(result.assetCoverage.excluded, 1)
})

test('planner output is deterministic for identical inputs except generated timestamp', () => {
  const input = { profile: { age: 30, retirement_age: 60, expected_return_percent: 8, inflation_percent: 6, essential_monthly_expenses: 20000 }, cashflows: [{ kind: 'income', amount: 50000, frequency: 'monthly' }, { kind: 'expense', amount: 20000, frequency: 'monthly' }], assets: [{ kind: 'emergency_fund', current_value: 30000 }], goals: [] }
  const left = calculatePlanner(input)
  const right = calculatePlanner(input)
  assert.deepEqual({ ...left, generatedAt: undefined }, { ...right, generatedAt: undefined })
  assert.equal(left.cashFlow.surplus, 30000)
  assert.equal(left.emergencyFund.shortfall, 30000)
})

test('projection limits and invalid values are rejected', () => {
  assert.throws(() => projectPlan({ currentSavings: -1 }), /Current savings/)
  assert.throws(() => futureValue(0, 0, Infinity, 1), /Annual return/)
})

test('scenario comparison uses the same base input and only explicit overrides', () => {
  const base = { profile: { age: 30, retirement_age: 60, expected_return_percent: 8, inflation_percent: 6 }, cashflows: [{ kind: 'income', amount: 50000, frequency: 'monthly' }, { kind: 'expense', amount: 20000, frequency: 'monthly' }], assets: [], goals: [] }
  const results = compareScenarios(base, [{ name: 'Conservative', overrides: { expected_return_percent: 4 } }, { name: 'Moderate', overrides: {} }])
  assert.equal(results.length, 2)
  assert.ok(results[1].endingNominal > results[0].endingNominal)
})

test('life events are hypothetical and do not mutate the base input', () => {
  const input = { profile: { age: 30, retirement_age: 60, expected_return_percent: 8, inflation_percent: 6 }, cashflows: [{ kind: 'income', amount: 100000, frequency: 'monthly' }], assets: [{ current_value: 100000 }] }
  const result = simulateLifeEvent(input, { name: 'Leave', months: 3, monthlyIncomeChange: -50000, oneOffCost: 10000 })
  assert.equal(result.event.name, 'Leave')
  assert.equal(input.assets[0].current_value, 100000)
  assert.ok(result.difference < 0)
})

test('financial independence estimate reports an insufficient horizon honestly', () => {
  const result = calculateFinancialIndependence({ profile: { essential_monthly_expenses: 10000, monthly_debt_payments: 0, expected_return_percent: 0 }, cashflows: [], assets: [] }, { maxYears: 1 })
  assert.equal(result.status, 'not_reached_within_horizon')
  assert.equal(result.targetAssets, 3000000)
})

test('profile-only baseline establishes realistic cash flow and future wealth', () => {
  const result = calculatePlanner({
    profile: {
      currency: 'INR',
      age: 25,
      retirement_age: 55,
      monthly_take_home: 75000,
      essential_monthly_expenses: 30000,
      monthly_debt_payments: 5000,
      emergency_months: 6,
      expected_return_percent: 8,
      inflation_percent: 6
    },
    cashflows: [],
    assets: [{ current_value: 100000 }],
    goals: []
  })

  assert.equal(result.cashFlow.income, 75000)
  assert.equal(result.cashFlow.expenses, 35000)
  assert.equal(result.cashFlow.surplus, 40000)
  assert.ok(result.projection.endingNominal > 50000000, 'Wealth projection should grow significantly with surplus')
  assert.equal(result.emergencyFund.target, 180000)
})
