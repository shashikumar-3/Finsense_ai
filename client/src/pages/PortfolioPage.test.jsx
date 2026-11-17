import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PortfolioPage from './PortfolioPage'

const state = {
  portfolios: [
    { id: 'portfolio-a', name: 'Long term', base_currency: 'INR', created_at: '2026-10-20T08:00:00Z' },
    { id: 'portfolio-b', name: 'Trading', base_currency: 'INR', created_at: '2026-10-20T09:00:00Z' },
  ],
  holdings: {
    'portfolio-a': [{ id: 'holding-a', symbol: 'TCS', exchange: 'NSE', currency: 'INR', quantity: 2, average_purchase_price: 100, realized_pnl: 5 }],
    'portfolio-b': [{ id: 'holding-b', symbol: 'INFY', exchange: 'NSE', currency: 'INR', quantity: 3, average_purchase_price: 200, realized_pnl: -2 }],
  },
  transactions: {
    'portfolio-a': [{ id: 'transaction-a', symbol: 'TCS', exchange: 'NSE', currency: 'INR', transaction_type: 'BUY', quantity: 2, unit_price: 100, fees: 0, executed_at: '2026-10-20T08:00:00Z' }],
    'portfolio-b': [{ id: 'transaction-b', symbol: 'INFY', exchange: 'NSE', currency: 'INR', transaction_type: 'BUY', quantity: 3, unit_price: 200, fees: 0, executed_at: '2026-10-20T08:00:00Z' }],
  },
}

let delayedPortfolioB

function accountingPayload(portfolioId) {
  const holdings = state.holdings[portfolioId] || []
  const transactions = state.transactions[portfolioId] || []
  return {
    success: true,
    transactions,
    quotes: Object.fromEntries(holdings.map((holding) => [holding.symbol, { price: 250, currency: 'INR', timestamp: new Date().toISOString() }])),
    accounting: {
      rows: holdings.map((holding) => ({ ...holding, remainingCostBasis: holding.quantity * holding.average_purchase_price, quoteTimestamp: new Date().toISOString() })),
      currentMarketValue: holdings.reduce((sum, holding) => sum + holding.quantity * 250, 0),
      remainingCostBasis: holdings.reduce((sum, holding) => sum + holding.quantity * holding.average_purchase_price, 0),
      realizedPnl: holdings.reduce((sum, holding) => sum + holding.realized_pnl, 0),
    },
  }
}

function queryFor(table) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((_, value) => {
      builder.portfolioId = value
      return builder
    }),
    order: vi.fn(() => {
      if (table === 'portfolios') return Promise.resolve({ data: state.portfolios, error: null })
      if (table === 'portfolio_holdings' && builder.portfolioId === 'portfolio-b' && delayedPortfolioB) return delayedPortfolioB
      const data = table === 'portfolio_holdings' ? state.holdings[builder.portfolioId] : state.transactions[builder.portfolioId]
      return Promise.resolve({ data: data || [], error: null })
    }),
    insert: vi.fn((payload) => {
      const created = { id: 'portfolio-c', name: payload.name, base_currency: 'INR', created_at: '2026-10-20T10:00:00Z' }
      state.portfolios.unshift(created)
      state.holdings[created.id] = []
      state.transactions[created.id] = []
      return { select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: created, error: null })) })) }
    }),
  }
  return builder
}

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn((table) => queryFor(table)) },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}))

vi.mock('../api/portfolioApi', () => ({
  fetchPortfolioAccounting: vi.fn((portfolioId) => {
    if (portfolioId === 'portfolio-b' && delayedPortfolioB) return delayedPortfolioB.then(() => accountingPayload(portfolioId))
    return Promise.resolve(accountingPayload(portfolioId))
  }),
  savePortfolioTransaction: vi.fn(),
}))

vi.mock('../api/stocksApi', () => ({
  fetchStock: vi.fn().mockResolvedValue({ price: 250, currency: 'INR', timestamp: new Date().toISOString() }),
}))

vi.mock('../api/intelligenceApi', () => ({
  fetchStockIntelligence: vi.fn().mockResolvedValue({ found: false, document: null }),
}))

vi.mock('../components/Charts', () => ({
  AllocationChart: () => <div data-testid="allocation-chart">Allocation chart</div>,
}))

function renderPage() {
  return render(<PortfolioPage />)
}

describe('PortfolioPage portfolio isolation and switching', () => {
  beforeEach(() => {
    delayedPortfolioB = null
  })

  it('lists multiple portfolios and switches all portfolio-specific data', async () => {
    renderPage()
    expect(await screen.findByRole('combobox', { name: 'Select portfolio' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Select portfolio' })).toHaveValue('portfolio-a')
    expect((await screen.findAllByText('TCS')).length).toBeGreaterThan(0)

    fireEvent.change(screen.getByRole('combobox', { name: 'Select portfolio' }), { target: { value: 'portfolio-b' } })
    expect((await screen.findAllByText('INFY')).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.queryByText('TCS')).not.toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: 'Select portfolio' })).toHaveValue('portfolio-b')
  })

  it('keeps existing portfolios selectable after creating a portfolio', async () => {
    renderPage()
    await screen.findByRole('combobox', { name: 'Select portfolio' })
    fireEvent.click(screen.getAllByRole('button', { name: /Create Portfolio/ })[0])
    fireEvent.change(screen.getByLabelText('Portfolio name'), { target: { value: 'New ideas' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create portfolio' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Select portfolio' })).toHaveValue('portfolio-c'))
    expect(screen.getByRole('option', { name: 'Long term' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Trading' })).toBeInTheDocument()
  })

  it('does not let a delayed previous selection overwrite the current portfolio', async () => {
    let resolveB
    delayedPortfolioB = new Promise((resolve) => { resolveB = resolve })
    renderPage()
    await screen.findByRole('combobox', { name: 'Select portfolio' })
    const selector = screen.getByRole('combobox', { name: 'Select portfolio' })
    fireEvent.change(selector, { target: { value: 'portfolio-b' } })
    fireEvent.change(selector, { target: { value: 'portfolio-a' } })
    resolveB({ data: state.holdings['portfolio-b'], error: null })
    await waitFor(() => expect(selector).toHaveValue('portfolio-a'))
    expect((await screen.findAllByText('TCS')).length).toBeGreaterThan(0)
    expect(screen.queryByText('INFY')).not.toBeInTheDocument()
  })
})
