const { chronologicalSplit, evaluatePredictions, fitOls } = require('./historicalEconomicData')

const CALIBRATED_MODEL_VERSION = 'ripple-calibrated-v1'

/**
 * Estimate one sector's coefficients from already-aligned observations.
 * Rows must contain a target sector return and feature values known at the
 * observation date. Publication-time alignment is the caller's responsibility.
 */
function calibrateSector(sector, rows, featureNames, metadata = {}) {
  const split = chronologicalSplit(rows, metadata.split || {})
  const fit = fitOls(split.train, featureNames)
  if (fit.status !== 'available') return { sector, ...fit, modelVersion: CALIBRATED_MODEL_VERSION, warnings: ['Training sample is insufficient or numerically unstable.'] }
  const prediction = (row) => fit.intercept + featureNames.reduce((sum, name) => sum + fit.coefficients[name] * Number(row.features[name]), 0)
  return {
    sector,
    ...fit,
    modelVersion: CALIBRATED_MODEL_VERSION,
    trainingPeriod: { start: split.train[0]?.date || null, end: split.train.at(-1)?.date || null },
    validation: evaluatePredictions(split.validation, prediction),
    test: evaluatePredictions(split.test, prediction),
    source: metadata.source || null,
    estimationTimestamp: metadata.estimationTimestamp || new Date().toISOString(),
    warnings: ['Association is not proof of causation.', 'Historical publication and revision metadata must be validated before claiming no look-ahead bias.'],
  }
}

function buildCoefficientRegistry(calibrations = []) {
  const registry = {}
  for (const calibration of Array.isArray(calibrations) ? calibrations : []) {
    if (calibration?.status !== 'available' || !calibration.sector) continue
    registry[calibration.sector] = { ...calibration.coefficients }
  }
  return registry
}

module.exports = { CALIBRATED_MODEL_VERSION, calibrateSector, buildCoefficientRegistry }
