import { beforeEach, describe, expect, it, vi } from 'vitest'
import { savePortfolioTransaction } from './portfolioApi'

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { getSession } } }))

describe('portfolio transaction API', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } }, error: null })
  })

  it('sends only transaction facts and leaves market-price resolution to the server', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    await savePortfolioTransaction('portfolio-1', { symbol: 'TCS', transaction_type: 'BUY', quantity: 2, executed_at: '2026-10-20T10:00:00.000Z' })
    const [, request] = fetchSpy.mock.calls[0]
    const body = JSON.parse(request.body)
    expect(body).toEqual({ symbol: 'TCS', transaction_type: 'BUY', quantity: 2, executed_at: '2026-10-20T10:00:00.000Z' })
    expect(body).not.toHaveProperty('unit_price')
    expect(request.method).toBe('POST')
  })
})
