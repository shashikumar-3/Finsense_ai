import { supabase } from '../lib/supabase'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

async function request(path, options = {}) {
  const { data, error } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (error || !token) throw new Error('Your session has expired. Please sign in again.')
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.message || 'Unable to save the transaction.')
  return payload
}

export function savePortfolioTransaction(portfolioId, transaction, transactionId = '') {
  const suffix = transactionId ? `/${encodeURIComponent(transactionId)}` : ''
  return request(`/api/portfolio/${encodeURIComponent(portfolioId)}/transactions${suffix}`, {
    method: transactionId ? 'PUT' : 'POST',
    body: JSON.stringify(transaction),
  })
}

export function fetchPortfolioAccounting(portfolioId) {
  return request(`/api/portfolio/${encodeURIComponent(portfolioId)}/accounting`)
}
