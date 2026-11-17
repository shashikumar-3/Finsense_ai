import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FinancialPlannerPage from './FinancialPlannerPage'
import { fetchFinancialPlanner, saveFinancialProfile } from '../api/financialPlannerApi'

vi.mock('../api/financialPlannerApi', () => ({ fetchFinancialPlanner: vi.fn(), saveFinancialProfile: vi.fn(), createPlanningRecord: vi.fn(), comparePlannerScenarios: vi.fn(), explainFinancialPlan: vi.fn() }))

const response = { success: true, profile: { currency: 'INR', age: 30, retirement_age: 60 }, analysis: { currency: 'INR', cashFlow: { income: 50000, expenses: 20000, surplus: 30000 }, projection: { endingNominal: 1000000, endingReal: 500000, points: [{ year: 0, nominal: 0, real: 0 }] }, emergencyFund: { current: 0, target: 60000, shortfall: 60000 }, alerts: [], goals: [], methodology: { disclaimer: 'Estimate only.' } } }

describe('FinancialPlannerPage', () => {
  beforeEach(() => { vi.clearAllMocks(); fetchFinancialPlanner.mockResolvedValue(response); saveFinancialProfile.mockResolvedValue({ success: true, profile: response.profile }) })

  it('renders private planning overview and profile form', async () => {
    render(<FinancialPlannerPage />)
    expect(await screen.findByText('Plan your financial future')).toBeInTheDocument()
    expect(screen.getByText('Monthly surplus')).toBeInTheDocument()
    expect(screen.getByText(/Emergency fund:/)).toBeInTheDocument()
  })

  it('saves validated profile inputs through the planner API', async () => {
    render(<FinancialPlannerPage />)
    await screen.findByText('Financial profile')
    fireEvent.change(screen.getByLabelText('Monthly take-home income'), { target: { value: '60000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(saveFinancialProfile).toHaveBeenCalledWith(expect.objectContaining({ monthly_take_home: '60000' })))
  })

  it('shows an actionable storage message instead of rendering unusable planner controls', async () => {
    fetchFinancialPlanner.mockRejectedValueOnce(new Error('Financial Planner storage is not available in the development database. Apply the Phase 6 testing migration, then reload the page.'))
    render(<FinancialPlannerPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/storage is not available/i)
    expect(screen.getByRole('button', { name: 'Retry planner' })).toBeInTheDocument()
  })
})
