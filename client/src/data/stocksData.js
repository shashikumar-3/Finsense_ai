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

export function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return '--'
  }

  return new Intl.NumberFormat('en-IN').format(value)
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

