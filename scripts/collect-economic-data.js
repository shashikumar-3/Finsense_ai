const path = require('node:path')
const { collectHistoricalEconomicData, writeHistoricalSnapshot } = require('../server/historicalEconomicPipeline')

async function main() {
  const snapshot = await collectHistoricalEconomicData()
  await writeHistoricalSnapshot(snapshot, path.join(process.cwd(), 'data', 'economic'))
  const calibration = snapshot.calibrations.filter((item) => item.status === 'available')
  console.log(JSON.stringify({
    retrievedAt: snapshot.retrievedAt,
    normalizedObservations: snapshot.observations.length,
    unavailableFeatures: snapshot.unavailableFeatures,
    marketSeries: Object.fromEntries(Object.entries(snapshot.marketSeries).map(([symbol, item]) => [symbol, { records: item.rows.length, error: item.error }])),
    calibration: calibration.map((item) => ({ sector: item.sector, sampleCount: item.sampleCount, trainingPeriod: item.trainingPeriod, test: item.test, baselines: item.baselines, comparison: item.comparison })),
    moSpi: snapshot.moSpi,
  }, null, 2))
}

main().catch((error) => {
  console.error(`Historical economic collection failed: ${error.name || 'Error'}: ${error.message}`)
  process.exitCode = 1
})
