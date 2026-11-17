const test = require('node:test')
const assert = require('node:assert/strict')
const { CALIBRATED_MODEL_VERSION, buildCoefficientRegistry, calibrateSector } = require('./rippleCalibration')

function rows() {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((shock, index) => ({
    date: `202${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`,
    target: 1 + 2 * shock,
    features: { crude_oil: shock },
  }))
}

test('calibration uses a separate version and chronological out-of-sample metadata', () => {
  const result = calibrateSector('Aviation', rows(), ['crude_oil'], { source: 'fixture', split: { trainRatio: 0.6, validationRatio: 0.2 } })
  assert.equal(result.status, 'available')
  assert.equal(result.modelVersion, CALIBRATED_MODEL_VERSION)
  assert.equal(result.provenance, 'historically_estimated')
  assert.equal(result.trainingPeriod.start, '2020-01-01')
  assert.equal(result.test.sampleCount, 2)
  assert.equal(result.source, 'fixture')
})

test('insufficient calibration never creates a coefficient registry entry', () => {
  const result = calibrateSector('Aviation', rows().slice(0, 2), ['crude_oil'])
  assert.equal(result.status, 'insufficient_data')
  assert.deepEqual(buildCoefficientRegistry([result]), {})
})
