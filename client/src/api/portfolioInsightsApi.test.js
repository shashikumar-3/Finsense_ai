import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { getSession } } }))

import { fetchPortfolioInsights } from './portfolioInsightsApi'

describe('portfolio insights API', () => {
  beforeEach(() => {
    getSession.mockReset()
    vi.restoreAllMocks()
  })

  it('sends the session token and accepts grounded insight payloads', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } }, error: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ success: true, answer: 'Grounded explanation.', generatedAt: '2026-10-20T00:00:00Z' }) }))
    await expect(fetchPortfolioInsights('portfolio-id', { summary: { activeHoldings: 1 } })).resolves.toMatchObject({ success: true })
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/portfolio/portfolio-id/insights'), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) }))
  })

  it('fails closed for missing sessions, provider failures and malformed payloads', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    await expect(fetchPortfolioInsights('p')).rejects.toThrow('session has expired')
    getSession.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, headers: { get: () => 'application/json' }, json: async () => ({ message: 'AI unavailable' }) }))
    await expect(fetchPortfolioInsights('p')).rejects.toThrow('AI unavailable')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ success: true }) }))
    await expect(fetchPortfolioInsights('p')).rejects.toThrow('invalid response')
  })
})
