const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

async function parseJson(response) {
  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json() : null

  if (!response.ok) {
    throw new Error(data?.message || 'Unable to reach the intelligence service. Please try again.')
  }

  return data
}

export async function fetchStockIntelligence(
  symbol,
  { refresh = false, includeNews = true, cachedOnly = false } = {},
) {
  const encoded = encodeURIComponent(symbol)
  const query = new URLSearchParams({
    refresh: String(refresh),
    includeNews: String(includeNews),
    cachedOnly: String(cachedOnly),
  })
  const response = await fetch(`${API_BASE_URL}/api/intelligence/stock/${encoded}?${query.toString()}`)
  return parseJson(response)
}

export async function refreshStockIntelligence(payload) {
  const response = await fetch(`${API_BASE_URL}/api/intelligence/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return parseJson(response)
}

export async function fetchIntelligenceStoreStats() {
  const response = await fetch(`${API_BASE_URL}/api/intelligence/store`)
  return parseJson(response)
}

export async function searchStockIntelligence({
  query = '',
  limit = 100,
  trend = '',
  sentiment = '',
  hypeLabel = '',
} = {}) {
  const search = new URLSearchParams({
    query,
    limit: String(limit),
    trend,
    sentiment,
    hypeLabel,
  })
  const response = await fetch(`${API_BASE_URL}/api/intelligence/search?${search.toString()}`)
  return parseJson(response)
}
