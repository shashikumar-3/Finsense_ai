import { supabase } from '../lib/supabase'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

export async function fetchPortfolioInsights(portfolioId, { summary, analysis, risk, signal = null } = {}) {
  const { data, error: sessionError } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (sessionError || !token) throw new Error('Your session has expired. Please sign in again.')

  const response = await fetch(`${API_BASE_URL}/api/portfolio/${encodeURIComponent(portfolioId)}/insights`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ summary, analysis, risk }),
    signal,
  })
  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json') ? await response.json() : null
  if (!response.ok) throw new Error(payload?.message || 'Portfolio insights are unavailable right now.')
  if (!payload?.success || typeof payload.answer !== 'string') throw new Error('Portfolio insights returned an invalid response.')
  return payload
}
