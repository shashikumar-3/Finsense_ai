import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import StocksPage from './StocksPage'
import { fetchNseStocks } from '../api/stocksApi'
import { fetchStockIntelligenceBatch } from '../api/intelligenceApi'

vi.mock('../api/stocksApi', () => ({
  fetchNseStocks: vi.fn(),
}))

vi.mock('../api/intelligenceApi', () => ({
  fetchStockIntelligenceBatch: vi.fn(),
}))

function renderPage() {
  return render(<MemoryRouter><StocksPage /></MemoryRouter>)
}

describe('StocksPage search states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchNseStocks.mockResolvedValue({ total: 1, offset: 0, limit: 24, stocks: [{ symbol: 'RELIANCE', name: 'Reliance Industries Limited' }] })
    fetchStockIntelligenceBatch.mockResolvedValue([])
  })

  it('renders a successful stock search response', async () => {
    renderPage()
    expect(await screen.findByText('RELIANCE')).toBeInTheDocument()
    expect(screen.getByText('Reliance Industries Limited')).toBeInTheDocument()
  })

  it('renders stock rows before asynchronous intelligence hydration completes', async () => {
    let resolveBatch
    fetchStockIntelligenceBatch.mockReturnValueOnce(new Promise((resolve) => {
      resolveBatch = resolve
    }))

    renderPage()

    expect(await screen.findByText('RELIANCE')).toBeInTheDocument()
    expect(fetchStockIntelligenceBatch).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveBatch([])
    })
  })

  it('labels a valid but stale cached directory', async () => {
    fetchNseStocks.mockResolvedValue({ total: 1, offset: 0, limit: 24, stale: true, stocks: [{ symbol: 'RELIANCE', name: 'Reliance Industries Limited' }] })
    renderPage()
    expect(await screen.findByText(/last known supported directory/i)).toBeInTheDocument()
  })

  it('renders an explicit no-results state', async () => {
    fetchNseStocks.mockResolvedValue({ total: 0, offset: 0, limit: 24, stocks: [] })
    renderPage()
    expect(await screen.findByText('No NSE stocks available right now.')).toBeInTheDocument()
  })

  it('renders backend failures and malformed responses as errors', async () => {
    fetchNseStocks.mockRejectedValueOnce(new Error('Unable to reach the market data service.'))
    renderPage()
    expect(await screen.findByText('Unable to reach the market data service.')).toBeInTheDocument()

    fetchNseStocks.mockRejectedValueOnce(new Error('Market data service returned an invalid stock list.'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Market data service returned an invalid stock list.')).toBeInTheDocument()
  })

  it('does not let an older response replace a newer search', async () => {
    let resolveFirst
    const first = new Promise((resolve) => { resolveFirst = resolve })
    fetchNseStocks.mockReset()
    fetchNseStocks.mockReturnValueOnce(first).mockResolvedValueOnce({ total: 1, offset: 0, limit: 24, stocks: [{ symbol: 'TCS', name: 'Tata Consultancy Services' }] })
    renderPage()
    fireEvent.change(screen.getByPlaceholderText(/Search by symbol/), { target: { value: 'TCS' } })
    await waitFor(() => expect(fetchNseStocks).toHaveBeenCalledTimes(2), { timeout: 1000 })
    resolveFirst({ total: 1, offset: 0, limit: 24, stocks: [{ symbol: 'RELIANCE', name: 'Reliance Industries Limited' }] })
    expect((await screen.findAllByText('TCS')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Reliance Industries Limited')).not.toBeInTheDocument()
  })
})
