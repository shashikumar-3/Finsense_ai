import { supabase } from '../lib/supabase'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

async function token() {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data?.session?.access_token) throw new Error('Your session has expired. Please sign in again.')
  return data.session.access_token
}

async function request(path, options = {}) {
  const accessToken = await token()
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(payload?.message || (response.status === 503 ? 'Financial Planner is temporarily unavailable. Check the development database migration and try again.' : 'Financial planner request failed.'))
    error.status = response.status
    error.code = payload?.code || ''
    throw error
  }
  return payload
}

export const fetchFinancialPlanner = (options = {}) => request('/api/financial-planner', { signal: options.signal })
export const saveFinancialProfile = (profile) => request('/api/financial-planner/profile', { method: 'PUT', body: JSON.stringify(profile) })
export const createPlanningRecord = (type, record) => request('/api/financial-planner/records', { method: 'POST', body: JSON.stringify({ type, record }) })
export const updatePlanningRecord = (type, id, record) => request(`/api/financial-planner/records/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(record) })
export const deletePlanningRecord = (type, id) => request(`/api/financial-planner/records/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const deleteFinancialProfile = () => request('/api/financial-planner/profile', { method: 'DELETE' })
export const comparePlannerScenarios = (scenarios) => request('/api/financial-planner/scenarios', { method: 'POST', body: JSON.stringify({ scenarios }) })
export const explainFinancialPlan = () => request('/api/financial-planner/explain', { method: 'POST', body: '{}' })
export const simulateLifeEvent = (event) => request('/api/financial-planner/life-event', { method: 'POST', body: JSON.stringify({ event }) })
export const calculateFinancialIndependence = (options = {}) => request('/api/financial-planner/financial-independence', { method: 'POST', body: JSON.stringify(options) })
