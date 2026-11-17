import { fetchNseStocks } from './stocksApi'

describe('fetchNseStocks response validation', () => {
  it('accepts a valid response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ total: 1, offset: 0, limit: 24, stocks: [{ symbol: 'TCS' }] }), { status: 200, headers: { 'content-type': 'application/json' } })))
    await expect(fetchNseStocks({ search: 'TCS' })).resolves.toMatchObject({ total: 1, stocks: [{ symbol: 'TCS' }] })
  })

  it('rejects malformed successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: [] }), { status: 200, headers: { 'content-type': 'application/json' } })))
    await expect(fetchNseStocks()).rejects.toThrow('invalid stock list')
  })

  it('surfaces provider failures instead of treating them as an empty directory', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'The NSE symbol directory is temporarily unavailable.' }), { status: 503, headers: { 'content-type': 'application/json' } })))
    await expect(fetchNseStocks()).rejects.toThrow('temporarily unavailable')
  })

  it('rejects malformed JSON bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{not-json', { status: 200, headers: { 'content-type': 'application/json' } })))
    await expect(fetchNseStocks()).rejects.toThrow('malformed JSON')
  })
})
