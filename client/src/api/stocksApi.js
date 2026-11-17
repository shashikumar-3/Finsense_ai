const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

async function parseJson(response) {
  const contentType = response.headers.get('content-type') || ''
  let data = null
  if (contentType.includes('application/json')) {
    try {
      data = await response.json()
    } catch {
      throw new Error('Market data service returned malformed JSON.')
    }
  }

  if (!response.ok) {
    throw new Error(data?.message || 'Unable to reach the market data service. Please try again.')
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Market data service returned an invalid response.')
  }

  return data
}

export async function fetchStock(symbol) {
  const encoded = encodeURIComponent(symbol)
  const response = await fetch(`${API_BASE_URL}/api/stock/${encoded}`)
  return parseJson(response)
}

export async function fetchStockChart(symbol, { range = '1mo', interval = '1d' } = {}) {
  const encoded = encodeURIComponent(symbol)
  const query = new URLSearchParams({ range, interval })
  const response = await fetch(`${API_BASE_URL}/api/stock/${encoded}/chart?${query.toString()}`)
  return parseJson(response)
}

export async function fetchNseStocks({ search = '', limit = 100, offset = 0, signal } = {}) {
  const query = new URLSearchParams({
    search,
    limit: String(limit),
    offset: String(offset),
  })
  const response = await fetch(`${API_BASE_URL}/api/stocks/nse?${query.toString()}`, { signal })
  const data = await parseJson(response)
  if (!Array.isArray(data.stocks) || !Number.isFinite(Number(data.total)) || Number(data.total) < 0) {
    throw new Error('Market data service returned an invalid stock list.')
  }
  return data
}

export async function fetchMarketOverview() {
  const response = await fetch(`${API_BASE_URL}/api/market-overview`)
  return parseJson(response)
}
