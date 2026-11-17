import { supabase } from '../lib/supabase'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

async function request(path, options = {}) {
  const { data, error } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (error || !token) throw new Error('Your session has expired. Please sign in again.')
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}`, ...(options.headers || {}) } })
  if (options.download) {
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      const error = new Error(payload?.message || 'Report export failed.')
      error.status = response.status
      error.code = payload?.code || ''
      throw error
    }
    return { blob: await response.blob(), filename: response.headers.get('content-disposition') || '' }
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(payload?.message || (response.status === 503 ? 'Reports are temporarily unavailable. Check the development data services and try again.' : 'Report request failed.'))
    error.status = response.status
    error.code = payload?.code || ''
    throw error
  }
  return payload
}

export const fetchReportPortfolios = () => request('/api/reports/portfolios')
export const fetchPortfolioReport = (portfolioId) => request(`/api/reports/portfolio/${encodeURIComponent(portfolioId)}`)
export const fetchStockReport = (symbol) => request(`/api/reports/stock/${encodeURIComponent(symbol)}`)
export const fetchFinancialFutureReport = () => request('/api/reports/financial-future')
export const downloadReport = (path, format) => request(`${path}?format=${encodeURIComponent(format)}`, { download: true })

export function filenameFromDisposition(disposition, fallback) {
  const match = String(disposition || '').match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i)
  return match?.[1] ? decodeURIComponent(match[1].replace(/^"|"$/g, '')) : fallback
}

export function saveDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  setTimeout(() => { anchor.remove(); URL.revokeObjectURL(url) }, 0)
}
