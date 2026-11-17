const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

async function parseResponse(response, fallback) {
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.message || fallback)
  if (!payload?.success) throw new Error('Economic ripple service returned an invalid response.')
  return payload
}

export async function simulateRipple(scenario, { signal, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${API_BASE_URL}/api/ripple/simulate`, { method: 'POST', headers, body: JSON.stringify(scenario), signal })
  return parseResponse(response, 'Economic ripple simulation is unavailable right now.')
}

export async function fetchRippleBriefing({ signal } = {}) {
  const response = await fetch(`${API_BASE_URL}/api/ripple/macro-briefing`, { signal })
  return parseResponse(response, 'Macroeconomic briefing is unavailable right now.')
}

export async function explainRipple(result, { signal, token, portfolioId } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${API_BASE_URL}/api/ripple/explain`, {
    method: 'POST', headers, signal, body: JSON.stringify({ ...result, portfolioId }),
  })
  return parseResponse(response, 'AI explanation is unavailable right now.')
}
