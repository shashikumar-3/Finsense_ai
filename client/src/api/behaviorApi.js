import { supabase } from '../lib/supabase'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

export async function fetchBehaviorAnalysis(portfolioId, { signal } = {}) {
  async function getSessionToken() {
    const { data, error } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (error || !token) throw new Error('Your session has expired. Please sign in again.')
    return token
  }

  async function request(token) {
    const response = await fetch(`${API_BASE_URL}/api/portfolio/${encodeURIComponent(portfolioId)}/behavior`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    })
    const payload = await response.json().catch(() => null)
    return { response, payload }
  }

  let token = await getSessionToken()
  let result = await request(token)

  // A browser can hold an expired access token while Supabase is refreshing it.
  // Refresh once after an authorization failure, then preserve the server's
  // normal error response if the refreshed token is also rejected.
  if (result.response.status === 401) {
    const { data, error } = await supabase.auth.refreshSession()
    const refreshedToken = data?.session?.access_token
    if (!error && refreshedToken && refreshedToken !== token) {
      token = refreshedToken
      result = await request(token)
    }
  }

  if (!result.response.ok) {
    throw new Error(result.payload?.message || 'Behavior analysis is unavailable right now.')
  }
  if (!result.payload?.success || !result.payload.analysis) {
    throw new Error('Behavior analysis returned an invalid response.')
  }
  return result.payload
}
