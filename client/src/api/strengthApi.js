const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

export async function fetchStrengthAnalysis(symbol, { withAi = false, query = '', signal } = {}) {
  const encoded = encodeURIComponent(symbol)
  const params = new URLSearchParams({ withAi: String(withAi) })
  if (query) params.set('query', query)
  const response = await fetch(`${API_BASE_URL}/api/strength/${encoded}?${params.toString()}`, { signal })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.message || 'Unable to load strength analysis.')
  if (!data || typeof data !== 'object' || !data.components) throw new Error('Strength service returned an invalid response.')
  return data
}
