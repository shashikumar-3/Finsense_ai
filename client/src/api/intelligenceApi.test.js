import { fetchStockIntelligenceBatch } from './intelligenceApi'

describe('fetchStockIntelligenceBatch', () => {
  it('returns the validated batch payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ items: [{ document: { symbol: 'RELIANCE.NS' } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))

    await expect(fetchStockIntelligenceBatch(['RELIANCE'], { cachedOnly: true }))
      .resolves.toEqual([{ document: { symbol: 'RELIANCE.NS' } }])
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/intelligence/stocks?'),
      expect.objectContaining({ signal: undefined }),
    )
  })

  it('rejects an invalid batch payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ items: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))

    await expect(fetchStockIntelligenceBatch(['TCS'])).rejects.toThrow('invalid stock batch')
  })
})
