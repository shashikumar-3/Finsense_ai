import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BehaviorPage from './BehaviorPage'
import { fetchBehaviorAnalysis } from '../api/behaviorApi'

const fetchBehaviorAnalysisMock = vi.mocked(fetchBehaviorAnalysis)
const portfolioState = {
  portfolios: [
    { id: 'portfolio-a', name: 'Long term', base_currency: 'INR', created_at: '2026-10-20T08:00:00Z' },
    { id: 'portfolio-b', name: 'Trading', base_currency: 'INR', created_at: '2026-10-21T08:00:00Z' },
  ],
}

vi.mock('../api/behaviorApi', () => ({ fetchBehaviorAnalysis: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: () => ({
        order: () => Promise.resolve({ data: portfolioState.portfolios, error: null }),
      }),
    })),
  },
}))

const analysis = (portfolio = 'portfolio-a') => ({
  success: true,
  portfolio: { id: portfolio, name: portfolio === 'portfolio-a' ? 'Long term' : 'Trading', baseCurrency: 'INR' },
  analysis: {
    metrics: {
      transactionCount: 3, buyCount: 2, sellCount: 1, grossPurchaseNotional: 300, grossSaleNotional: 100, totalRecordedFees: 2,
      currencyBreakdown: [{ currency: 'INR', buyNotional: 300, sellNotional: 100, totalFees: 2, grossTradedNotional: 400, feeRatio: 0.005 }],
      firstTransactionAt: '2026-01-01T00:00:00Z', latestTransactionAt: '2026-02-01T00:00:00Z', averageIntervalDays: 15,
      activityByMonth: [{ period: '2026-01', buyCount: 2, sellCount: 0, transactionCount: 2, grossNotional: 300 }],
      repeatedPurchases: [], regularIntervals: [], buySellCycles: [], frequencyChange: null,
      holdingPeriods: { summary: { completedCount: 1, shortCompletedCount: 1 } },
      concentration: { status: 'unavailable', reason: 'Current values unavailable.' },
      dataQuality: { status: 'available', validTransactionCount: 3, invalidTransactionCount: 0 },
    },
    patterns: { repeatedPurchases: [], regularIntervals: [], buySellCycles: [], frequencyChange: null },
    findings: [{ id: 'finding', category: 'recorded_fees', title: 'Recorded fees are material', summary: 'Review recorded fees.', severity: 'attention', confidence: 'medium', evidence: ['Fee ratio'], limitations: [], suggested_action: 'Review costs.' }],
    dataQuality: { status: 'available', validTransactionCount: 3, invalidTransactionCount: 0 },
    methodology: { fees: 'Recorded fees only' },
  },
})

describe('BehaviorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchBehaviorAnalysisMock.mockResolvedValue(analysis())
  })

  it('loads the selected portfolio and renders deterministic metrics and findings', async () => {
    render(<BehaviorPage />)
    expect(await screen.findByText('Recorded transactions')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Recorded fees are material')).toBeInTheDocument()
    expect(fetchBehaviorAnalysisMock).toHaveBeenCalledWith('portfolio-a', expect.anything())
  })

  it('refreshes analysis when the portfolio changes', async () => {
    render(<BehaviorPage />)
    const selector = await screen.findByRole('combobox', { name: 'Select portfolio' })
    fireEvent.change(selector, { target: { value: 'portfolio-b' } })
    await waitFor(() => expect(fetchBehaviorAnalysisMock).toHaveBeenLastCalledWith('portfolio-b', expect.anything()))
  })

  it('keeps a useful error state when the behavior endpoint fails', async () => {
    fetchBehaviorAnalysisMock.mockRejectedValueOnce(new Error('Behavior unavailable'))
    render(<BehaviorPage />)
    expect(await screen.findByText('Behavior unavailable')).toBeInTheDocument()
    expect(screen.getByText('Behavior & Mistake Analyzer')).toBeInTheDocument()
  })

  it('renders calculated concentration separately from unavailable concentration', async () => {
    fetchBehaviorAnalysisMock.mockResolvedValueOnce({
      ...analysis(),
      analysis: {
        ...analysis().analysis,
        metrics: {
          ...analysis().analysis.metrics,
          concentration: {
            status: 'available',
            largestHoldingWeight: 0.42,
            coverage: { valued: 2, total: 2 },
          },
        },
      },
    })
    render(<BehaviorPage />)
    expect(await screen.findByText('42% largest holding')).toBeInTheDocument()
    expect(screen.getByText('Quote coverage: 2/2')).toBeInTheDocument()
  })
})
