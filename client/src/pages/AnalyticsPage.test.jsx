import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AnalyticsPage from './AnalyticsPage'
import { fetchMarketOverview, fetchNseStocks } from '../api/stocksApi'
import { fetchStrengthAnalysis } from '../api/strengthApi'
import { popularNseSymbols } from '../data/stocksData'

const strengthResult = (symbol, overrides = {}) => ({
  symbol,
  status: 'available',
  overall: { score: 72.5, eligible_components: ['fundamentals', 'technical', 'news', 'hype'], effective_weights: { fundamentals: 0.35, technical: 0.3, news: 0.2, hype: 0.15 }, explanation: 'Weighted eligible component scores; missing components are excluded and weights are renormalized.' },
  components: {
    fundamentals: { status: 'available', score: 78, values: { sector: 'Technology', period: '2026', revenue_growth: 0.12, earnings_growth: 0.1, profit_margin: 0.2, operating_margin: 0.22, roe: 0.18, debt_to_equity: 20, interest_coverage: 8, pe_ratio: 28 }, evidence: ['Revenue growth: 0.12'], warnings: [] },
    technical: { status: 'available', score: 70, values: { trend: 'Bullish', rsi: 58, sma_20: 100, sma_50: 98, sma_200: 90, macd: { histogram: 1.2 }, date: '2026-10-20' }, evidence: ['Trend: Bullish'], warnings: [] },
    news: { status: 'available', score: 50, values: { status: 'current', article_count: 1, articles: [{ headline: `${symbol} results`, source: 'Example', published_date: '2026-10-20', url: 'https://example.com/article' }] }, evidence: ['Current sentiment: neutral'], warnings: [] },
    hype: { status: 'available', score: 65, signals: [{ name: '20-session price change', value: 0.12, baseline: '20 sessions' }], evidence: [], warnings: ['Social-media attention is not measured.'] },
  },
  comparison: { classification: 'Strength and attention broadly aligned', evidence: ['Fundamental score: 78'], limitations: ['Analytical comparison only.'] },
  ...overrides,
})

const searchResults = [
  { symbol: 'TCS', name: 'Tata Consultancy Services Limited' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors Limited' },
]

vi.mock('../api/stocksApi', () => ({ fetchMarketOverview: vi.fn(), fetchNseStocks: vi.fn() }))
vi.mock('../api/strengthApi', () => ({ fetchStrengthAnalysis: vi.fn() }))
vi.mock('../components/Charts', () => ({
  ScoreRadar: () => <div data-testid="score-radar">Score radar</div>,
  ConfidenceChart: () => <div data-testid="confidence-chart">Confidence chart</div>,
}))
vi.mock('recharts', () => ({
  LineChart: ({ children }) => <div>{children}</div>,
  Line: () => null,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

describe('AnalyticsPage Phase 3 integration', () => {
  beforeEach(() => {
    fetchMarketOverview.mockResolvedValue({
      indexes: [
        { symbol: 'NIFTY 50', price: 24000, change: 120, changePercent: 0.5 },
        { symbol: 'SENSEX', price: 79000, change: 300, changePercent: 0.38 },
      ],
      movers: [{ symbol: 'TCS', name: 'Tata Consultancy Services Limited', price: 2500, changePercent: 1.2 }],
      chart: [
        { symbol: 'NIFTY 50', points: [{ datetime: '2026-10-20T00:00:00Z', close: 24000 }] },
        { symbol: 'SENSEX', points: [{ datetime: '2026-10-20T00:00:00Z', close: 79000 }] },
      ],
    })
    fetchNseStocks.mockResolvedValue({ total: searchResults.length, stocks: searchResults })
    fetchStrengthAnalysis.mockImplementation((symbol) => Promise.resolve(strengthResult(symbol)))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('loads real analysis sections and provides the full NSE search flow', async () => {
    render(<AnalyticsPage />)
    expect(await screen.findByText('NIFTY 50')).toBeInTheDocument()
    expect(screen.getByText('SENSEX')).toBeInTheDocument()
    expect(screen.getByText('Market trend')).toBeInTheDocument()
    expect(screen.getByText('NIFTY 50')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: /Search NSE stocks/i }), { target: { value: 'Tata Consultancy Services' } })
    await waitFor(() => expect(fetchNseStocks).toHaveBeenCalledWith({ search: 'Tata Consultancy Services', limit: 8, offset: 0 }))
    expect(await screen.findByRole('option', { name: /Tata Consultancy Services Limited TCS/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /Tata Consultancy Services Limited TCS/i }))
    await waitFor(() => expect(fetchStrengthAnalysis).toHaveBeenLastCalledWith('TCS', { withAi: false }))
    expect(await screen.findByText('Tata Consultancy Services Limited')).toBeInTheDocument()
    expect(screen.getByText('(TCS)')).toBeInTheDocument()
    expect(screen.getByTestId('score-radar')).toBeInTheDocument()
    expect(screen.getByText('Fundamental metrics')).toBeInTheDocument()
    expect(screen.getByText('News evidence')).toBeInTheDocument()
    expect(screen.getByText('Hype versus fundamentals')).toBeInTheDocument()
    expect(screen.getByText('The overall score summarizes available evidence using weighted component scores. It is not a probability of future returns or a buy/sell recommendation.')).toBeInTheDocument()
    expect(screen.getByText('12.0%')).toBeInTheDocument()
  })

  it('keeps deterministic analysis available when AI fails after stock selection', async () => {
    fetchStrengthAnalysis.mockImplementation((symbol, options = {}) => options.withAi ? Promise.reject(new Error('AI unavailable')) : Promise.resolve(strengthResult(symbol)))
    render(<AnalyticsPage />)
    await screen.findByText('Market trend')
    fireEvent.change(screen.getByRole('textbox', { name: /Search NSE stocks/i }), { target: { value: 'TCS' } })
    await screen.findByRole('option', { name: /Tata Consultancy Services Limited TCS/i })
    fireEvent.click(screen.getByRole('option', { name: /Tata Consultancy Services Limited TCS/i }))
    await waitFor(() => expect(fetchStrengthAnalysis).toHaveBeenLastCalledWith('TCS', { withAi: false }))
    expect(await screen.findByText('News evidence')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Explain this analysis' }))
    await waitFor(() => expect(screen.getByText('AI unavailable')).toBeInTheDocument())
    expect(screen.getByText('News evidence')).toBeInTheDocument()
  })

  it('selects a NIFTY 50 quick-selection button and loads its analysis', async () => {
    render(<AnalyticsPage />)
    await screen.findByText('Market trend')
    fireEvent.click(screen.getByRole('button', { name: 'INFY' }))
    await waitFor(() => expect(fetchStrengthAnalysis).toHaveBeenLastCalledWith('INFY', { withAi: false }))
    expect(await screen.findByText('(INFY)')).toBeInTheDocument()
  })

  it('keeps the current analysis when search is focused and cancelled', async () => {
    expect(popularNseSymbols).toHaveLength(25)
    render(<AnalyticsPage />)
    await screen.findByText('Market trend')
    fireEvent.click(screen.getByRole('button', { name: 'INFY' }))
    expect(await screen.findByText('(INFY)')).toBeInTheDocument()

    const input = screen.getByRole('textbox', { name: /Search NSE stocks/i })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'TCS' } })
    expect(await screen.findByRole('option', { name: /Tata Consultancy Services Limited TCS/i })).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(input).toHaveValue('')
    expect(screen.getByRole('button', { name: 'INFY' })).toBeInTheDocument()
    expect(screen.getByText('(INFY)')).toBeInTheDocument()
    expect(fetchStrengthAnalysis).toHaveBeenCalledTimes(1)
  })

  it('restores the normal layout when search loses focus without a selection', async () => {
    render(<AnalyticsPage />)
    await screen.findByText('Market trend')
    const input = screen.getByRole('textbox', { name: /Search NSE stocks/i })
    fireEvent.change(input, { target: { value: 'TCS' } })
    expect(await screen.findByRole('option', { name: /Tata Consultancy Services Limited TCS/i })).toBeInTheDocument()
    fireEvent.blur(input)

    await waitFor(() => expect(input).toHaveValue(''))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'RELIANCE' })).toBeInTheDocument()
  })

  it('supports keyboard navigation without replacing the previous result prematurely', async () => {
    render(<AnalyticsPage />)
    await screen.findByText('Market trend')
    const input = screen.getByRole('textbox', { name: /Search NSE stocks/i })
    fireEvent.change(input, { target: { value: 'TCS' } })
    await screen.findByRole('option', { name: /Tata Consultancy Services Limited TCS/i })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(fetchStrengthAnalysis).toHaveBeenLastCalledWith('TCS', { withAi: false }))
  })

  it('shows empty and failed search states without fabricating results', async () => {
    fetchNseStocks.mockResolvedValueOnce({ total: 0, stocks: [] })
    render(<AnalyticsPage />)
    await screen.findByText('Market trend')
    fireEvent.change(screen.getByRole('textbox', { name: /Search NSE stocks/i }), { target: { value: 'no-such-stock' } })
    await waitFor(() => expect(fetchNseStocks).toHaveBeenCalledWith({ search: 'no-such-stock', limit: 8, offset: 0 }))
    expect(await screen.findByText('No supported NSE stocks found.')).toBeInTheDocument()

    fetchNseStocks.mockRejectedValueOnce(new Error('NSE directory unavailable'))
    fireEvent.change(screen.getByRole('textbox', { name: /Search NSE stocks/i }), { target: { value: 'TCS' } })
    await waitFor(() => expect(fetchNseStocks).toHaveBeenCalledWith({ search: 'TCS', limit: 8, offset: 0 }))
    expect(await screen.findByText('NSE directory unavailable')).toBeInTheDocument()
  })

  it('renders clean unavailable news messaging without hiding other analysis sections', async () => {
    fetchStrengthAnalysis.mockResolvedValueOnce(strengthResult('TCS', {
      components: {
        ...strengthResult('TCS').components,
        news: {
          status: 'insufficient_data',
          score: null,
          values: { status: 'unavailable', article_count: 0, articles: [], provider_error: '426 Upgrade Required' },
          evidence: [],
          warnings: ['Current news is temporarily unavailable.'],
        },
      },
    }))
    render(<AnalyticsPage />)
    await screen.findByText('Market trend')
    fireEvent.change(screen.getByRole('textbox', { name: /Search NSE stocks/i }), { target: { value: 'TCS' } })
    fireEvent.click(await screen.findByRole('option', { name: /Tata Consultancy Services Limited TCS/i }))
    expect(await screen.findByText('Current news is temporarily unavailable.')).toBeInTheDocument()
    expect(screen.getByText('Fundamental metrics')).toBeInTheDocument()
    expect(screen.queryByText('426 Upgrade Required')).not.toBeInTheDocument()
  })
})
