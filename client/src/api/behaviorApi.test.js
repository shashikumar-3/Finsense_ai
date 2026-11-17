import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn(), refreshSession: vi.fn() } } }))

import { fetchBehaviorAnalysis } from './behaviorApi'
import { supabase } from '../lib/supabase'

const getSession = supabase.auth.getSession
const refreshSession = supabase.auth.refreshSession

describe('behaviorApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } }, error: null })
    refreshSession.mockResolvedValue({ data: { session: { access_token: 'refreshed-token' } }, error: null })
  })

  it('sends the authenticated portfolio behavior request', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, analysis: { metrics: {} } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const result = await fetchBehaviorAnalysis('portfolio-id')
    expect(result.analysis).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/portfolio/portfolio-id/behavior'), expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }))
  })

  it('surfaces unauthorized responses without exposing internals', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Authentication is required.' }), { status: 401, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Authentication is required.' }), { status: 401, headers: { 'content-type': 'application/json' } }))
    await expect(fetchBehaviorAnalysis('portfolio-id')).rejects.toThrow('Authentication is required.')
    expect(refreshSession).toHaveBeenCalledOnce()
  })

  it('refreshes an expired session once and retries the behavior request', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Authentication could not be verified.' }), { status: 401, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, analysis: { metrics: {} } }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const result = await fetchBehaviorAnalysis('portfolio-id')

    expect(result.analysis).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][1]).toEqual(expect.objectContaining({ headers: { Authorization: 'Bearer refreshed-token' } }))
  })
})
