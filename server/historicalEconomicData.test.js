const test = require('node:test')
const assert = require('node:assert/strict')
const { chronologicalSplit, evaluatePredictions, fitOls, normalizeSeries } = require('./historicalEconomicData')

test('normalizes observations, preserves metadata, and reports duplicates', () => {
  const result = normalizeSeries([
    { variable: 'cpi_inflation', date: '2024-01-01', value: 5.1, unit: 'percent', source: 'fixture' },
    { variable: 'cpi_inflation', date: '2024-01-01', value: 5.1, unit: 'percent', source: 'fixture' },
    { variable: 'cpi_inflation', date: 'bad-date', value: 5.2 },
  ])
  assert.equal(result.status, 'partial')
  assert.equal(result.observations.length, 1)
  assert.equal(result.observations[0].source, 'fixture')
  assert.equal(result.issues.filter((item) => item.type === 'duplicate_observation').length, 1)
})

test('splits rows chronologically without shuffling future observations into training', () => {
  const rows = ['2024-04-01', '2024-01-01', '2024-03-01', '2024-02-01', '2024-05-01'].map((date) => ({ date }))
  const split = chronologicalSplit(rows, { trainRatio: 0.6, validationRatio: 0.2 })
  assert.deepEqual(split.train.map((row) => row.date), ['2024-01-01', '2024-02-01', '2024-03-01'])
  assert.deepEqual(split.validation.map((row) => row.date), ['2024-04-01'])
  assert.deepEqual(split.test.map((row) => row.date), ['2024-05-01'])
})

test('fits a deterministic known linear relationship and rejects insufficient samples', () => {
  const rows = [1, 2, 3, 4, 5].map((x) => ({ target: 2 + 3 * x, features: { shock: x } }))
  const fit = fitOls(rows, ['shock'])
  assert.equal(fit.status, 'available')
  assert.equal(fit.intercept, 2)
  assert.equal(fit.coefficients.shock, 3)
  assert.equal(fitOls(rows.slice(0, 2), ['shock']).status, 'insufficient_data')
})

test('evaluates out-of-sample predictions with explicit metrics', () => {
  const result = evaluatePredictions([{ target: 1, features: { x: 1 } }, { target: -2, features: { x: 2 } }], (row) => row.target)
  assert.equal(result.status, 'available')
  assert.equal(result.sampleCount, 2)
  assert.equal(result.mae, 0)
  assert.equal(result.rmse, 0)
  assert.equal(result.directionalAccuracy, 1)
})
