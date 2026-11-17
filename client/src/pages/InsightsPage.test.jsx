import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InsightsPage from './InsightsPage'
import { fetchStockIntelligence } from '../api/intelligenceApi'
import { explainRipple, fetchRippleBriefing, simulateRipple } from '../api/rippleApi'
import { fetchNseStocks } from '../api/stocksApi'

vi.mock('../api/intelligenceApi', () => ({ fetchStockIntelligence: vi.fn() }))
vi.mock('../api/rippleApi', () => ({ simulateRipple: vi.fn(), explainRipple: vi.fn(), fetchRippleBriefing: vi.fn() }))
vi.mock('../api/stocksApi', () => ({ fetchNseStocks: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({ select: vi.fn(() => ({ order: vi.fn().mockResolvedValue({ data: [], error: null }) })) })),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
  },
}))

describe('Insights economic ripple simulator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    fetchStockIntelligence.mockResolvedValue({ document: { market: {}, news: {}, analysis: { market_summary_structured: { trend_signals: [{ label: 'RSI', value: 69.98799714450954 }] }, news_summary_structured: { sentiment_breakdown: [{ label: 'Positive Score', value: 0.105 }] } } } })
    fetchRippleBriefing.mockResolvedValue({ success: true, indicators: [], supportedSectors: ['Aviation'], macroNews: { message: 'No macro feed configured.' } })
    fetchNseStocks.mockResolvedValue({ stocks: [{ symbol: 'TCS', name: 'Tata Consultancy Services' }], total: 1 })
    simulateRipple.mockResolvedValue({
      success: true,
      status: 'partial',
      modelVersion: 'ripple-heuristic-v1',
      sectorImpacts: [{ sector: 'Aviation', modeledImpactPct: -8, status: 'available' }],
      portfolio: { status: 'not_requested', modeledImpactPct: null, coveragePct: null, contributions: [] },
      assumptions: ['Illustrative coefficients'],
      limitations: ['No observed macro baseline'],
    })
    explainRipple.mockResolvedValue({ success: true, fallback: true, answer: 'generic fallback text' })
  })

  it('accepts a shock and renders deterministic sector output inside Insights', async () => {
    render(<InsightsPage />)
    const crudeInput = await screen.findByLabelText('Crude oil shock')
    fireEvent.change(crudeInput, { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: /run scenario/i }))

    await waitFor(() => expect(simulateRipple).toHaveBeenCalledWith(
      expect.objectContaining({ shocks: [{ key: 'crude_oil', shock: 10 }], target: { type: 'sectors' } }),
      expect.anything(),
    ))
    expect(await screen.findByText('ripple-heuristic-v1')).toBeInTheDocument()
    expect(screen.getByText(/Modeled sector impact/)).toBeInTheDocument()
  })

  it('formats structured indicator values without changing the underlying result', async () => {
    render(<InsightsPage />)
    expect((await screen.findAllByText(/RSI: 69\.99/)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Positive Score: 10\.5%/).length).toBeGreaterThan(0)
  })

  it('searches the NSE directory and uses the selected stock for stock-target scenarios', async () => {
    render(<InsightsPage />)
    const search = screen.getByRole('textbox', { name: 'Search stock' })
    fireEvent.change(search, { target: { value: 'Tata' } })
    expect(await screen.findByRole('option', { name: /Tata Consultancy Services TCS/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /Tata Consultancy Services TCS/i }))
    expect((await screen.findAllByText('TCS')).length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Crude oil shock'), { target: { value: '10' } })
    fireEvent.change(screen.getByDisplayValue(/Sector impact/), { target: { value: 'stock' } })
    fireEvent.click(screen.getByRole('button', { name: /run scenario/i }))
    await waitFor(() => expect(simulateRipple).toHaveBeenCalledWith(expect.objectContaining({ target: { type: 'stock', symbols: ['TCS'] } }), expect.anything()))
  })

  it('explains a stock fallback from the current stock-impact result', async () => {
    simulateRipple.mockResolvedValueOnce({
      success: true,
      status: 'partial',
      modelVersion: 'ripple-heuristic-v1',
      scenario: { shocks: [{ key: 'crude_oil', label: 'Crude oil', shock: 15, shockLabel: '%' }] },
      stockImpacts: [{ symbol: 'TCS', sector: 'Information Technology', modeledImpactPct: null }],
      sectorImpacts: [],
      portfolio: { status: 'not_requested' },
      assumptions: [],
      limitations: ['Only configured relationships contribute.'],
    })
    render(<InsightsPage />)
    fireEvent.change(screen.getByLabelText('Crude oil shock'), { target: { value: '15' } })
    fireEvent.change(screen.getByDisplayValue(/Sector impact/), { target: { value: 'stock' } })
    fireEvent.click(screen.getByRole('button', { name: /run scenario/i }))
    await waitFor(() => expect(simulateRipple).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button', { name: /explain with ai/i }))
    expect(await screen.findByText(/No supported stock or sector result is available/)).toBeInTheDocument()
    expect(screen.queryByText('generic fallback text')).not.toBeInTheDocument()
  })

})
