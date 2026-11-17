import { useEffect, useMemo, useState } from 'react'

export const DEFAULT_PREFERENCES = {
  adaptiveDarkMode: true,
  compactDashboardDensity: false,
  motionEnhancedTransitions: true,
  behavioralAlerts: true,
  macroRippleScenarios: true,
  highRiskTradingWarnings: false,
}

const STORAGE_PREFIX = 'finsense.preferences.'
const EVENT_NAME = 'finsense:preferences-changed'

function storageKey(userId) {
  return `${STORAGE_PREFIX}${userId || 'anonymous'}`
}

export function normalizePreferences(value = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_PREFERENCES).map(([key, fallback]) => [key, typeof value?.[key] === 'boolean' ? value[key] : fallback]))
}

export function readPreferences(user) {
  const metadataPreferences = user?.preferences || {}
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey(user?.id)) || '{}')
    return normalizePreferences({ ...metadataPreferences, ...stored })
  } catch {
    return normalizePreferences(metadataPreferences)
  }
}

export function writePreferences(user, preferences) {
  const normalized = normalizePreferences(preferences)
  window.localStorage.setItem(storageKey(user?.id), JSON.stringify(normalized))
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { userId: user?.id, preferences: normalized } }))
  return normalized
}

export function usePreferences(user) {
  const [preferences, setPreferences] = useState(() => readPreferences(user))
  useEffect(() => {
    setPreferences(readPreferences(user))
    const onChange = (event) => {
      if (event.detail?.userId === user?.id) setPreferences(normalizePreferences(event.detail.preferences))
    }
    window.addEventListener(EVENT_NAME, onChange)
    return () => window.removeEventListener(EVENT_NAME, onChange)
  }, [user?.id, user?.preferences])
  return useMemo(() => preferences, [preferences])
}

export { EVENT_NAME }
