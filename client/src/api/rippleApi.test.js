import { describe, expect, it, vi } from 'vitest'
import { explainRipple, simulateRipple } from './rippleApi'

describe('rippleApi', () => {
  it('sends a deterministic scenario without requiring authentication', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, sectorImpacts: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(simulateRipple({ shocks: [{ key: 'crude_oil', shock: 10 }] })).resolves.toMatchObject({ success: true })
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/ripple/simulate'), expect.objectContaining({ method: 'POST' }))
  })

  it('surfaces provider failures without fabricating an explanation', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, message: 'AI explanation is unavailable.' }), { status: 503, headers: { 'content-type': 'application/json' } }))
    await expect(explainRipple({ sectorImpacts: [] })).rejects.toThrow('AI explanation is unavailable.')
  })
})
