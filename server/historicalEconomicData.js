/**
 * Lightweight historical-data and calibration primitives for the ripple model.
 *
 * This module deliberately has no network or database dependency. Provider
 * adapters can normalize verified observations into this format, while tests
 * and offline calibration can use deterministic arrays. It is not a claim that
 * coefficients estimated from a small dataset are causal or predictive.
 */

const DATA_STATUSES = Object.freeze({
  available: 'available',
  partial: 'partial',
  invalid: 'invalid',
  unavailable: 'unavailable',
})

function finite(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  const text = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const timestamp = Date.parse(`${text}T00:00:00Z`)
  return Number.isFinite(timestamp) ? text : null
}

function normalizeObservation(record = {}, defaults = {}) {
  const date = parseDate(record.date || record.observationDate)
  const value = finite(record.value)
  const issues = []
  if (!date) issues.push('invalid_observation_date')
  if (value === null) issues.push('invalid_observation_value')
  const observation = {
    variable: String(record.variable || defaults.variable || '').trim(),
    instrument: String(record.instrument || defaults.instrument || '').trim() || null,
    date,
    publicationDate: parseDate(record.publicationDate || record.releaseDate),
    retrievalTimestamp: record.retrievalTimestamp || null,
    value,
    unit: String(record.unit || defaults.unit || '').trim() || null,
    source: String(record.source || defaults.source || '').trim() || null,
    sourceUrl: String(record.sourceUrl || defaults.sourceUrl || '').trim() || null,
    sourceId: String(record.sourceId || defaults.sourceId || '').trim() || null,
    frequency: String(record.frequency || defaults.frequency || '').trim() || null,
    currency: String(record.currency || defaults.currency || '').trim() || null,
    status: issues.length ? DATA_STATUSES.invalid : DATA_STATUSES.available,
    provenance: record.provenance || defaults.provenance || 'source_observation',
    revision: record.revision ?? null,
    issues,
  }
  return observation
}

function normalizeSeries(records, defaults = {}) {
  const observations = []
  const issues = []
  const seen = new Set()
  for (const record of Array.isArray(records) ? records : []) {
    const observation = normalizeObservation(record, defaults)
    const key = `${observation.variable}|${observation.instrument || ''}|${observation.date || ''}`
    if (observation.status === DATA_STATUSES.invalid) {
      issues.push({ type: 'invalid_observation', date: observation.date, issues: observation.issues })
      continue
    }
    if (seen.has(key)) {
      issues.push({ type: 'duplicate_observation', key })
      continue
    }
    seen.add(key)
    observations.push(observation)
  }
  observations.sort((left, right) => left.date.localeCompare(right.date))
  return {
    status: observations.length ? (issues.length ? DATA_STATUSES.partial : DATA_STATUSES.available) : DATA_STATUSES.unavailable,
    observations,
    issues,
  }
}

function chronologicalSplit(rows, { trainRatio = 0.6, validationRatio = 0.2 } = {}) {
  const ordered = [...(Array.isArray(rows) ? rows : [])].sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')))
  if (!(trainRatio > 0 && validationRatio >= 0 && trainRatio + validationRatio < 1)) throw new Error('Invalid chronological split ratios.')
  const trainEnd = Math.max(0, Math.floor(ordered.length * trainRatio))
  const validationEnd = trainEnd + Math.floor(ordered.length * validationRatio)
  return { train: ordered.slice(0, trainEnd), validation: ordered.slice(trainEnd, validationEnd), test: ordered.slice(validationEnd) }
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length
  const augmented = matrix.map((row, index) => [...row, vector[index]])
  for (let column = 0; column < size; column += 1) {
    let pivot = column
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row
    }
    if (Math.abs(augmented[pivot][column]) < 1e-12) return null
    ;[augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]]
    const divisor = augmented[column][column]
    for (let index = column; index <= size; index += 1) augmented[column][index] /= divisor
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue
      const factor = augmented[row][column]
      for (let index = column; index <= size; index += 1) augmented[row][index] -= factor * augmented[column][index]
    }
  }
  return augmented.map((row) => row[size])
}

function fitOls(rows, featureNames) {
  const names = Array.isArray(featureNames) ? featureNames : []
  const usable = (Array.isArray(rows) ? rows : []).filter((row) => finite(row?.target) !== null && names.every((name) => finite(row?.features?.[name]) !== null))
  if (usable.length <= names.length + 1) return { status: 'insufficient_data', coefficients: null, sampleCount: usable.length, featureNames: names }
  const columns = names.length + 1
  const matrix = Array.from({ length: columns }, () => Array(columns).fill(0))
  const vector = Array(columns).fill(0)
  for (const row of usable) {
    const x = [1, ...names.map((name) => Number(row.features[name]))]
    const y = Number(row.target)
    for (let i = 0; i < columns; i += 1) {
      vector[i] += x[i] * y
      for (let j = 0; j < columns; j += 1) matrix[i][j] += x[i] * x[j]
    }
  }
  const solution = solveLinearSystem(matrix, vector)
  if (!solution || solution.some((value) => !Number.isFinite(value))) return { status: 'unstable', coefficients: null, sampleCount: usable.length, featureNames: names }
  return {
    status: 'available',
    sampleCount: usable.length,
    featureNames: names,
    intercept: Number(solution[0].toFixed(12)),
    coefficients: Object.fromEntries(names.map((name, index) => [name, Number(solution[index + 1].toFixed(12))])),
    provenance: 'historically_estimated',
    estimationMethod: 'ordinary_least_squares',
  }
}

function evaluatePredictions(rows, prediction) {
  const evaluated = (Array.isArray(rows) ? rows : []).map((row) => ({ actual: finite(row?.target), predicted: finite(prediction?.(row)) })).filter((row) => row.actual !== null && row.predicted !== null)
  if (!evaluated.length) return { status: 'insufficient_data', sampleCount: 0, mae: null, rmse: null, directionalAccuracy: null }
  const errors = evaluated.map((row) => row.predicted - row.actual)
  const mae = errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length
  const rmse = Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length)
  const directional = evaluated.filter((row) => Math.sign(row.actual) === Math.sign(row.predicted)).length / evaluated.length
  return { status: 'available', sampleCount: evaluated.length, mae, rmse, directionalAccuracy: directional }
}

module.exports = { DATA_STATUSES, normalizeObservation, normalizeSeries, chronologicalSplit, fitOls, evaluatePredictions }
