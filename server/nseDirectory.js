function normalizeNseSymbol(rawSymbol = '') {
  return String(rawSymbol || '')
    .toUpperCase()
    .replace(/^NSE:/, '')
    .replace(/\.NS$/, '')
    .trim()
}

function parseCsvLine(line) {
  const result = []
  let current = ''
  let insideQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const nextChar = line[index + 1]
    if (char === '"' && insideQuotes && nextChar === '"') {
      current += '"'
      index += 1
      continue
    }
    if (char === '"') {
      insideQuotes = !insideQuotes
      continue
    }
    if (char === ',' && !insideQuotes) {
      result.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  result.push(current.trim())
  return result
}

function normalizeHeader(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim().toUpperCase()
}

function parseNseCsv(csvText) {
  const lines = String(csvText || '').split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]).map(normalizeHeader)
  const symbolIndex = headers.findIndex((header) => header === 'SYMBOL')
  const nameIndex = headers.findIndex((header) => header === 'NAME OF COMPANY')
  if (symbolIndex < 0 || nameIndex < 0) return []

  return lines.slice(1).map((line) => {
    const parts = parseCsvLine(line)
    return {
      symbol: normalizeNseSymbol(parts[symbolIndex] || ''),
      name: String(parts[nameIndex] || '').trim(),
    }
  }).filter((item) => item.symbol && item.name)
}

function normalizeCachedSymbols(payload) {
  if (!Array.isArray(payload)) return []
  return payload.map((item) => ({
    symbol: normalizeNseSymbol(item?.symbol || ''),
    name: String(item?.name || item?.company_name || '').trim(),
  })).filter((item) => item.symbol && item.name)
}

module.exports = { normalizeNseSymbol, normalizeCachedSymbols, parseCsvLine, parseNseCsv }
