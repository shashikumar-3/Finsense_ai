export const indianStockSymbols = [
  'RELIANCE',
  'TCS',
  'INFY',
  'HDFCBANK',
  'ICICIBANK',
  'SBIN',
  'ITC',
  'LT',
  'KOTAKBANK',
  'BHARTIARTL',
  'HINDUNILVR',
  'WIPRO',
]

// Complete NIFTY 50 constituent snapshot used for quick selection. The backend
// still validates every selection against the supported NSE directory.
export const nifty50Symbols = [
  'ADANIENT', 'ADANIPORTS', 'APOLLOHOSP', 'ASIANPAINT', 'AXISBANK',
  'BAJAJ-AUTO', 'BAJFINANCE', 'BAJAJFINSV', 'BEL', 'BHARTIARTL',
  'CIPLA', 'COALINDIA', 'DRREDDY', 'EICHERMOT', 'ETERNAL',
  'GRASIM', 'HCLTECH', 'HDFCBANK', 'HDFCLIFE', 'INDIGO',
  'HINDALCO', 'HINDUNILVR', 'ICICIBANK', 'INFY',
  'ITC', 'JIOFIN', 'JSWSTEEL', 'KOTAKBANK', 'LT',
  'M&M', 'MARUTI', 'MAXHEALTH', 'NESTLEIND', 'NTPC',
  'ONGC', 'POWERGRID', 'RELIANCE', 'SBILIFE', 'SHRIRAMFIN',
  'SBIN', 'SUNPHARMA', 'TATACONSUM', 'TATAMOTORS', 'TATASTEEL',
  'TCS', 'TECHM', 'TITAN', 'TRENT', 'ULTRACEMCO', 'BSE',
]

// Stable, curated quick-selection set used by Analytics. These are widely
// followed NSE names across technology, banking, energy, consumer, healthcare,
// automotive, industrial, metals, and utilities.
export const popularNseSymbols = [
  'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK',
  'SBIN', 'ITC', 'LT', 'KOTAKBANK', 'BHARTIARTL',
  'HINDUNILVR', 'AXISBANK', 'BAJFINANCE', 'MARUTI', 'SUNPHARMA',
  'TATAMOTORS', 'TATASTEEL', 'NTPC', 'ONGC', 'POWERGRID',
  'ADANIENT', 'ASIANPAINT', 'TITAN', 'ULTRACEMCO', 'COALINDIA',
]

export function formatCurrency(value, currency = 'INR') {
  if (!Number.isFinite(value)) {
    return '--'
  }

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return '--'
  }

  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return '--'
  }

  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

export function getChangeClasses(value) {
  if (!Number.isFinite(value)) {
    return 'text-slate-300'
  }

  return value >= 0 ? 'text-emerald-400' : 'text-rose-400'
}

export function shortSymbolLabel(symbol = '') {
  return symbol.replace(':NSE', '').replace('.NS', '')
}

