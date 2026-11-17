const fs = require('node:fs/promises')
const path = require('node:path')
const { chronologicalSplit, evaluatePredictions, normalizeSeries } = require('./historicalEconomicData')
const { calibrateSector } = require('./rippleCalibration')
const { SECTOR_COEFFICIENTS } = require('./rippleAnalysis')

const SOURCES = Object.freeze({
  rbiRepo: {
    id: 'rbi-dbie-policy-rates',
    name: 'Reserve Bank of India DBIE',
    url: 'https://data-api.dbie.rbihub.in/api/tables/financial_sector/r151_major_monetary_policy_rates_and_reserve_requirements_bank/rows?limit=10000',
    frequency: 'as_and_when',
  },
  worldBankGdp: {
    id: 'world-bank-india-real-gdp-growth',
    name: 'World Bank Open Data',
    url: 'https://api.worldbank.org/v2/country/IND/indicator/NY.GDP.MKTP.KD.ZG?format=json&per_page=100',
    frequency: 'annual',
  },
  yahooFx: { id: 'yahoo-inr-x', name: 'Yahoo Finance', symbol: 'INR=X', frequency: 'monthly' },
  yahooBrent: { id: 'yahoo-bz-f', name: 'Yahoo Finance', symbol: 'BZ=F', frequency: 'monthly' },
  yahooNifty: { id: 'yahoo-nsei', name: 'Yahoo Finance', symbol: '^NSEI', frequency: 'monthly' },
  moSpiCpi: { id: 'mospi-cpi', name: 'Ministry of Statistics and Programme Implementation', url: 'https://esankhyiki.mospi.gov.in/catalogue-main/catalogue?product=CPI', frequency: 'monthly', status: 'blocked_in_environment' },
})

const SECTOR_SYMBOLS = Object.freeze({
  'Financial Services': '^NSEBANK',
  'Information Technology': '^CNXIT',
  Automobile: '^CNXAUTO',
  FMCG: '^CNXFMCG',
  Pharmaceuticals: '^CNXPHARMA',
  Metals: '^CNXMETAL',
  Infrastructure: '^CNXINFRA',
  'Oil & Gas': '^CNXENERGY',
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchJson(url, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.')
  const response = await fetchImpl(url, { headers: { accept: 'application/json,text/csv' } })
  if (!response.ok) throw new Error(`Historical provider returned HTTP ${response.status}.`)
  return response.json()
}

function parseRbiRepoRows(payload, retrievedAt = new Date().toISOString()) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : []
  return rows.filter((row) => /^\d{2}-\d{2}-\d{4}$/.test(String(row?.[4] || '').trim())).map((row) => {
    const dateText = String(row?.[4] || '').trim()
    const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dateText)
    const date = match ? `${match[3]}-${match[2]}-${match[1]}` : null
    const valueText = String(row?.[6] ?? '').trim()
    const value = valueText && valueText !== '-' ? Number(valueText.replace(/,/g, '')) : null
    return {
      variable: 'repo_rate',
      date,
      value,
      unit: 'percent',
      source: SOURCES.rbiRepo.name,
      sourceUrl: SOURCES.rbiRepo.url,
      sourceId: SOURCES.rbiRepo.id,
      frequency: SOURCES.rbiRepo.frequency,
      retrievalTimestamp: retrievedAt,
      provenance: 'rbi_dbie_observation',
    }
  }).filter((row) => row.date && row.value !== null)
}

function parseWorldBankGdp(payload, retrievedAt = new Date().toISOString()) {
  const rows = Array.isArray(payload) && Array.isArray(payload[1]) ? payload[1] : []
  return rows.map((row) => ({
    variable: 'gdp_growth',
    date: row.date ? `${row.date}-12-31` : null,
    value: row.value,
    unit: 'percent_year_over_year',
    source: SOURCES.worldBankGdp.name,
    sourceUrl: SOURCES.worldBankGdp.url,
    sourceId: SOURCES.worldBankGdp.id,
    frequency: SOURCES.worldBankGdp.frequency,
    retrievalTimestamp: retrievedAt,
    provenance: 'world_bank_observation',
    revision: payload?.[0]?.lastupdated || null,
  }))
}

function parseYahooChart(payload, instrument, source, retrievedAt = new Date().toISOString()) {
  const result = payload?.chart?.result?.[0]
  const timestamps = result?.timestamp || []
  const closes = result?.indicators?.quote?.[0]?.close || []
  return timestamps.map((timestamp, index) => ({
    variable: instrument === 'INR=X' ? 'usd_inr_level' : instrument === 'BZ=F' ? 'crude_oil_level' : `${source.id}_level`,
    instrument,
    date: new Date(timestamp * 1000).toISOString().slice(0, 10),
    value: Number.isFinite(Number(closes[index])) ? Number(closes[index]) : null,
    unit: instrument === 'INR=X' ? 'INR_per_USD' : instrument === 'BZ=F' ? 'USD_per_barrel' : 'index_points',
    source: source.name,
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(instrument)}/history`,
    sourceId: source.id,
    frequency: source.frequency,
    retrievalTimestamp: retrievedAt,
    provenance: 'yahoo_chart_observation',
  })).filter((row) => row.value !== null)
}

function monthKey(date) {
  return String(date).slice(0, 7)
}

function monthEnd(rows) {
  const grouped = new Map()
  for (const row of rows) {
    const key = monthKey(row.date)
    const current = grouped.get(key)
    if (!current || row.date > current.date) grouped.set(key, row)
  }
  return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function percentageChanges(rows, variable) {
  const ordered = monthEnd(rows)
  return ordered.slice(1).map((row, index) => {
    const previous = ordered[index]
    return { ...row, variable, value: (row.value / previous.value - 1) * 100, unit: 'percent_change', previousDate: previous.date }
  }).filter((row) => Number.isFinite(row.value) && row.value > -100)
}

function repoMonthlyChange(rows) {
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date))
  const byMonth = new Map()
  for (const row of ordered) byMonth.set(monthKey(row.date), row)
  const monthRows = [...byMonth.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, row]) => row)
  return monthRows.slice(1).map((row, index) => ({
    date: row.date,
    variable: 'repo_rate_change',
    value: row.value - monthRows[index].value,
    unit: 'percentage_points',
    source: row.source,
    sourceUrl: row.sourceUrl,
    sourceId: row.sourceId,
    retrievalTimestamp: row.retrievalTimestamp,
    publicationDate: row.date,
  }))
}

function alignMonthlyRows(targetRows, featureSeries) {
  const featuresByMonth = Object.fromEntries(featureSeries.map(({ name, rows }) => [name, new Map(monthEnd(rows).map((row) => [monthKey(row.date), row]))]))
  const targets = monthEnd(targetRows)
  const rows = []
  for (let index = 1; index < targets.length; index += 1) {
    const target = targets[index]
    const month = monthKey(target.date)
    const features = {}
    let complete = true
    for (const { name } of featureSeries) {
      const row = featuresByMonth[name].get(month)
      if (!row || !Number.isFinite(Number(row.value))) complete = false
      else features[name] = Number(row.value)
    }
    if (complete) rows.push({ date: target.date, target: Number(target.value), features })
  }
  return rows
}

async function collectHistoricalEconomicData({ fetchImpl = globalThis.fetch, now = new Date(), yahooRange = '10y' } = {}) {
  const retrievedAt = now.toISOString()
  const rbi = await fetchJson(SOURCES.rbiRepo.url, fetchImpl)
  const gdp = await fetchJson(SOURCES.worldBankGdp.url, fetchImpl)
  const yahooSymbols = [SOURCES.yahooFx, SOURCES.yahooBrent, ...Object.entries(SECTOR_SYMBOLS).map(([sector, symbol]) => ({ id: `yahoo-${symbol.replace(/[^a-z0-9]/gi, '').toLowerCase()}`, name: 'Yahoo Finance', symbol, frequency: 'monthly', sector }))]
  const market = {}
  for (const source of yahooSymbols) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(source.symbol)}?range=${yahooRange}&interval=1mo&events=div%2Csplits`
    try {
      market[source.symbol] = { source, rows: parseYahooChart(await fetchJson(url, fetchImpl), source.symbol, source, retrievedAt) }
    } catch (error) {
      market[source.symbol] = { source, rows: [], error: error.message }
    }
    await sleep(25)
  }
  const repo = normalizeSeries(parseRbiRepoRows(rbi, retrievedAt)).observations
  const gdpRows = normalizeSeries(parseWorldBankGdp(gdp, retrievedAt)).observations
  const fxRows = normalizeSeries(market[SOURCES.yahooFx.symbol]?.rows || []).observations
  const crudeRows = normalizeSeries(market[SOURCES.yahooBrent.symbol]?.rows || []).observations
  const observations = [...repo, ...gdpRows, ...fxRows, ...crudeRows]
  const calibrations = []
  const candidateFeatureSeries = [
    { name: 'usd_inr_return_pct', rows: percentageChanges(fxRows, 'usd_inr_return_pct') },
    { name: 'crude_oil_return_pct', rows: percentageChanges(crudeRows, 'crude_oil_return_pct') },
    { name: 'repo_rate_change_pp', rows: repoMonthlyChange(repo) },
  ]
  // Do not turn an unavailable source into an all-missing feature that would
  // suppress otherwise usable calibration rows. Its absence is reported in
  // the snapshot and the resulting model metadata remains explicit.
  const featureSeries = candidateFeatureSeries.filter((series) => series.rows.length > 0)
  for (const [sector, symbol] of Object.entries(SECTOR_SYMBOLS)) {
    const sourceRows = normalizeSeries(market[symbol]?.rows || []).observations
    const targets = percentageChanges(sourceRows, `${sector}_return_pct`)
    const aligned = alignMonthlyRows(targets, featureSeries)
    if (aligned.length) {
      const featureNames = featureSeries.map(({ name }) => name)
      const calibration = calibrateSector(sector, aligned, featureNames, { source: market[symbol]?.source?.name || 'Yahoo Finance' })
      const testRows = chronologicalSplit(aligned).test
      const heuristic = SECTOR_COEFFICIENTS[sector] || {}
      const heuristicPrediction = (row) => featureNames.reduce((sum, name) => {
        const key = name === 'usd_inr_return_pct' ? 'usd_inr' : name === 'crude_oil_return_pct' ? 'crude_oil' : null
        return sum + (key && Number.isFinite(heuristic[key]) ? Number(row.features[name]) * heuristic[key] : 0)
      }, 0)
      calibration.baselines = {
        zero: evaluatePredictions(testRows, () => 0),
        rippleHeuristicV1: evaluatePredictions(testRows, heuristicPrediction),
      }
      calibration.comparison = calibration.test.status === 'available'
        ? { calibratedMinusHeuristicMae: calibration.test.mae - calibration.baselines.rippleHeuristicV1.mae, calibratedMinusHeuristicRmse: calibration.test.rmse - calibration.baselines.rippleHeuristicV1.rmse }
        : null
      calibrations.push(calibration)
    }
  }
  return {
    retrievedAt,
    sources: SOURCES,
    rawSources: { rbiDbie: rbi, worldBankGdp: gdp },
    observations,
    marketSeries: Object.fromEntries(Object.entries(market).map(([symbol, item]) => [symbol, { source: item.source, rows: item.rows, error: item.error || null }])),
    featureSeries,
    unavailableFeatures: candidateFeatureSeries.filter((series) => !series.rows.length).map((series) => series.name),
    calibrations,
    moSpi: { status: 'blocked_in_environment', source: SOURCES.moSpiCpi, reason: 'MoSPI warehouse was verified as the official source, but its data endpoint was not reachable from the collection environment.' },
  }
}

async function writeHistoricalSnapshot(snapshot, outputDir) {
  await fs.mkdir(outputDir, { recursive: true })
  await fs.mkdir(path.join(outputDir, 'raw'), { recursive: true })
  await fs.writeFile(path.join(outputDir, 'raw', 'rbi-dbie-policy-rates.json'), JSON.stringify(snapshot.rawSources.rbiDbie, null, 2))
  await fs.writeFile(path.join(outputDir, 'raw', 'world-bank-india-gdp.json'), JSON.stringify(snapshot.rawSources.worldBankGdp, null, 2))
  await fs.writeFile(path.join(outputDir, 'normalized-observations.json'), JSON.stringify({ retrievedAt: snapshot.retrievedAt, sources: snapshot.sources, observations: snapshot.observations, moSpi: snapshot.moSpi }, null, 2))
  await fs.writeFile(path.join(outputDir, 'market-series.json'), JSON.stringify({ retrievedAt: snapshot.retrievedAt, series: snapshot.marketSeries }, null, 2))
  await fs.writeFile(path.join(outputDir, 'calibrated-coefficients.json'), JSON.stringify({ modelVersion: 'ripple-calibrated-v1', retrievedAt: snapshot.retrievedAt, provenance: 'historically_estimated', coefficients: Object.fromEntries(snapshot.calibrations.filter((item) => item.status === 'available').map((item) => [item.sector, item.coefficients])), warnings: ['Research artifact only; not enabled as the simulator default.', 'Coefficients are associations from the collected sample, not causal estimates.'] }, null, 2))
  await fs.writeFile(path.join(outputDir, 'calibration-report.json'), JSON.stringify({ retrievedAt: snapshot.retrievedAt, sources: snapshot.sources, featureSeries: snapshot.featureSeries, unavailableFeatures: snapshot.unavailableFeatures, calibrations: snapshot.calibrations, moSpi: snapshot.moSpi }, null, 2))
}

module.exports = { SOURCES, SECTOR_SYMBOLS, parseRbiRepoRows, parseWorldBankGdp, parseYahooChart, monthEnd, percentageChanges, repoMonthlyChange, alignMonthlyRows, collectHistoricalEconomicData, writeHistoricalSnapshot }
