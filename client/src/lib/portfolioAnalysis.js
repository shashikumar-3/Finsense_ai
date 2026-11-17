export const DEFAULT_STOCK_CONCENTRATION_THRESHOLD = 0.20
export const DEFAULT_SECTOR_CONCENTRATION_THRESHOLD = 0.40
export const DEFAULT_SECTOR_METADATA_MAX_AGE_MS = 30 * 60 * 1000

const UNKNOWN_SECTOR = 'Unknown'

function finiteNumber(value) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizedSector(value) {
  const sector = String(value || '').trim()
  return sector && !/^unknown|unclassified|n\/a$/i.test(sector) ? sector : UNKNOWN_SECTOR
}

export function buildPortfolioAnalysis(summary, metadataBySymbol = {}, options = {}) {
  const stockThreshold = finiteNumber(options.stockConcentrationThreshold) ?? DEFAULT_STOCK_CONCENTRATION_THRESHOLD
  const sectorThreshold = finiteNumber(options.sectorConcentrationThreshold) ?? DEFAULT_SECTOR_CONCENTRATION_THRESHOLD
  const now = options.now ?? Date.now()
  const metadataMaxAgeMs = options.metadataMaxAgeMs ?? DEFAULT_SECTOR_METADATA_MAX_AGE_MS
  const rows = Array.isArray(summary?.rows) ? summary.rows : []
  const totalValue = finiteNumber(summary?.marketValue)
  const valuedRows = rows.filter((row) => row.quantity > 0 && finiteNumber(row.marketValue) !== null)
  const valuationComplete = totalValue !== null && totalValue > 0 && summary?.allActiveQuotesAvailable === true && summary?.safelyComparable === true
  const activeRows = rows.filter((row) => row.quantity > 0)

  if (!valuationComplete) {
    return {
      available: false,
      valuationComplete: false,
      totalValue,
      stockAllocations: [],
      sectorAllocations: [],
      largestStock: null,
      largestSector: null,
      stockWarnings: [],
      sectorWarnings: [],
      hhi: null,
      activeHoldings: activeRows.length,
      sectorCoverage: { known: 0, total: activeRows.length, complete: false },
      thresholds: { stock: stockThreshold, sector: sectorThreshold },
      reason: totalValue === null ? 'Current prices are missing or stale.' : 'A complete compatible valuation is unavailable.',
    }
  }

  const stockAllocations = valuedRows
    .map((row) => {
      const percentage = (row.marketValue / totalValue) * 100
      const metadata = metadataBySymbol[row.symbol] || {}
      return {
        symbol: row.symbol,
        companyName: metadata.companyName || metadata.company_name || row.quote?.name || row.symbol,
        marketValue: row.marketValue,
        currency: row.currency,
        percentage,
      }
    })
    .sort((left, right) => right.percentage - left.percentage)

  const sectors = new Map()
  let knownSectors = 0
  for (const row of valuedRows) {
    const metadata = metadataBySymbol[row.symbol] || {}
    const metadataTimestamp = new Date(metadata.updatedAt || '').getTime()
    const metadataFresh = Number.isFinite(metadataTimestamp) && now - metadataTimestamp <= metadataMaxAgeMs
    const sector = metadataFresh ? normalizedSector(metadata.sector || metadata.market?.sector) : UNKNOWN_SECTOR
    if (sector !== UNKNOWN_SECTOR) knownSectors += 1
    const current = sectors.get(sector) || { name: sector, marketValue: 0, percentage: 0, holdings: 0, known: sector !== UNKNOWN_SECTOR }
    current.marketValue += row.marketValue
    current.holdings += 1
    sectors.set(sector, current)
  }
  const sectorAllocations = [...sectors.values()]
    .map((sector) => ({ ...sector, percentage: (sector.marketValue / totalValue) * 100 }))
    .sort((left, right) => right.percentage - left.percentage)

  const stockWarnings = stockAllocations
    .filter((item) => item.percentage > stockThreshold * 100)
    .map((item) => ({
      ...item,
      threshold: stockThreshold * 100,
      reason: `${item.companyName} represents ${item.percentage.toFixed(2)}% of the valued portfolio and exceeds the configured ${(stockThreshold * 100).toFixed(0)}% stock concentration threshold.`,
    }))
  const sectorWarnings = sectorAllocations
    .filter((item) => item.known && item.percentage > sectorThreshold * 100)
    .map((item) => ({
      ...item,
      threshold: sectorThreshold * 100,
      reason: `${item.name} represents ${item.percentage.toFixed(2)}% of the valued portfolio and exceeds the configured ${(sectorThreshold * 100).toFixed(0)}% sector concentration threshold.`,
    }))

  return {
    available: true,
    valuationComplete: true,
    totalValue,
    stockAllocations,
    sectorAllocations,
    largestStock: stockAllocations[0] || null,
    largestSector: sectorAllocations[0] || null,
    stockWarnings,
    sectorWarnings,
    hhi: stockAllocations.reduce((total, item) => total + ((item.percentage / 100) ** 2) * 10000, 0),
    activeHoldings: activeRows.length,
    sectorCoverage: { known: knownSectors, total: valuedRows.length, complete: knownSectors === valuedRows.length },
    thresholds: { stock: stockThreshold, sector: sectorThreshold },
    reason: null,
  }
}

export { UNKNOWN_SECTOR }
