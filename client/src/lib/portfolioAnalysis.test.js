import { buildPortfolioAnalysis, DEFAULT_SECTOR_CONCENTRATION_THRESHOLD, DEFAULT_SECTOR_METADATA_MAX_AGE_MS, DEFAULT_STOCK_CONCENTRATION_THRESHOLD, UNKNOWN_SECTOR } from './portfolioAnalysis'

const summary = (overrides = {}) => ({
  rows: [
    { symbol: 'TCS', quantity: 5, marketValue: 600, currency: 'INR', quote: { name: 'Tata Consultancy Services' } },
    { symbol: 'INFY', quantity: 4, marketValue: 300, currency: 'INR' },
    { symbol: 'CLOSED', quantity: 0, marketValue: null, currency: 'INR' },
  ],
  marketValue: 900,
  allActiveQuotesAvailable: true,
  safelyComparable: true,
  ...overrides,
})

const metadata = {
  TCS: { companyName: 'Tata Consultancy Services', sector: 'Information Technology', updatedAt: '2026-10-20T10:00:00.000Z' },
  INFY: { companyName: 'Infosys', sector: 'Information Technology', updatedAt: '2026-10-20T10:00:00.000Z' },
}
const analysisOptions = { now: Date.parse('2026-10-20T10:05:00Z') }

describe('portfolio allocation and concentration analysis', () => {
  it('calculates stock allocations that sum to 100% and excludes closed positions', () => {
    const result = buildPortfolioAnalysis(summary(), metadata, analysisOptions)
    expect(result.stockAllocations.map((item) => item.percentage)).toEqual([66.66666666666666, 33.33333333333333])
    expect(result.stockAllocations.reduce((total, item) => total + item.percentage, 0)).toBeCloseTo(100)
    expect(result.stockAllocations.some((item) => item.symbol === 'CLOSED')).toBe(false)
  })

  it('groups holdings by sector and preserves missing metadata as Unknown', () => {
    const result = buildPortfolioAnalysis(summary(), { TCS: metadata.TCS }, { now: Date.parse('2026-10-20T10:05:00Z') })
    expect(result.sectorAllocations).toEqual([
      expect.objectContaining({ name: 'Information Technology', marketValue: 600, percentage: 66.66666666666666, holdings: 1 }),
      expect.objectContaining({ name: UNKNOWN_SECTOR, marketValue: 300, percentage: 33.33333333333333, holdings: 1 }),
    ])
    expect(result.sectorCoverage).toEqual({ known: 1, total: 2, complete: false })
  })

  it('treats stale sector metadata as Unknown', () => {
    const result = buildPortfolioAnalysis(summary(), { TCS: { ...metadata.TCS, updatedAt: '2026-10-19T10:00:00Z' } }, { now: Date.parse('2026-10-20T10:00:00Z') })
    expect(result.sectorAllocations[0].name).toBe(UNKNOWN_SECTOR)
    expect(result.sectorCoverage.complete).toBe(false)
    expect(DEFAULT_SECTOR_METADATA_MAX_AGE_MS).toBe(30 * 60 * 1000)
  })

  it('withholds allocations for incomplete valuation, mixed currencies, empty and zero-value portfolios', () => {
    expect(buildPortfolioAnalysis(summary({ allActiveQuotesAvailable: false }), metadata).available).toBe(false)
    expect(buildPortfolioAnalysis(summary({ safelyComparable: false }), metadata).available).toBe(false)
    expect(buildPortfolioAnalysis({ rows: [], marketValue: null }, {}).available).toBe(false)
    expect(buildPortfolioAnalysis({ rows: [{ symbol: 'ZERO', quantity: 1, marketValue: 0 }], marketValue: 0, allActiveQuotesAvailable: true, safelyComparable: true }, {}).available).toBe(false)
  })

  it('finds largest stock and applies strict stock and sector thresholds', () => {
    const result = buildPortfolioAnalysis(summary(), metadata, { ...analysisOptions, stockConcentrationThreshold: 0.66, sectorConcentrationThreshold: 0.66 })
    expect(result.largestStock.symbol).toBe('TCS')
    expect(result.largestSector.name).toBe('Information Technology')
    expect(result.stockWarnings).toHaveLength(1)
    expect(result.sectorWarnings).toHaveLength(1)
    expect(buildPortfolioAnalysis(summary(), metadata, { ...analysisOptions, stockConcentrationThreshold: 2 / 3 }).stockWarnings).toHaveLength(0)
    expect(DEFAULT_STOCK_CONCENTRATION_THRESHOLD).toBe(0.2)
    expect(DEFAULT_SECTOR_CONCENTRATION_THRESHOLD).toBe(0.4)
  })

  it('calculates HHI without invalid numbers', () => {
    const result = buildPortfolioAnalysis(summary(), metadata, analysisOptions)
    expect(result.hhi).toBeCloseTo(5555.555555555555)
    expect(Number.isFinite(result.hhi)).toBe(true)
  })
})
