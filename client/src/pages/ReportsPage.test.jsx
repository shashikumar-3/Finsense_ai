import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReportsPage from './ReportsPage'
import { fetchReportPortfolios, fetchFinancialFutureReport } from '../api/reportsApi'

vi.mock('../api/reportsApi', () => ({ fetchReportPortfolios: vi.fn(), fetchPortfolioReport: vi.fn(), fetchStockReport: vi.fn(), fetchFinancialFutureReport: vi.fn(), downloadReport: vi.fn(), saveDownload: vi.fn() }))

describe('ReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchReportPortfolios.mockResolvedValue({ portfolios: [] })
    fetchFinancialFutureReport.mockResolvedValue({ report: { title: 'Financial future report', generatedAt: '2026-01-01', asOf: '2026-01-01', summary: { projectedNominal: 1000 }, limitations: [] } })
  })

  it('renders report categories and generates a financial report', async () => {
    render(<ReportsPage />)
    expect(screen.getByText('Portfolio report')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /Generate/ })[2])
    await waitFor(() => expect(fetchFinancialFutureReport).toHaveBeenCalled())
    expect((await screen.findAllByText('Financial future report')).length).toBeGreaterThanOrEqual(2)
  })

  it('surfaces report-source failures instead of silently leaving the page unusable', async () => {
    fetchReportPortfolios.mockRejectedValueOnce(new Error('The Financial Planner data is not available in the development database.'))
    render(<ReportsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Financial Planner data is not available/i)
  })
})
