const SOURCES = Object.freeze({
  rbi: 'https://www.rbi.org.in/Home.aspx',
  cpi: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2335416&lang=1&reg=3',
  bond: 'https://www.ccilindia.com/en/tenorwise-indicative-yields',
})

function text(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
}

function number(value) {
  const parsed = Number(String(value || '').replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function isoDateFromEnglish(value) {
  const match = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(String(value || '').trim())
  if (!match) return null
  const month = new Date(`${match[1]} 1, 2000`).getMonth()
  return Number.isInteger(month) ? new Date(Date.UTC(Number(match[3]), month, Number(match[2]))).toISOString().slice(0, 10) : null
}

function parseRbiRepoRate(html, retrievedAt = new Date().toISOString()) {
  const content = text(html)
  const match = /Policy\s+Repo\s+Rate\s*\|?\s*:?[\s-]*([0-9]+(?:\.[0-9]+)?)\s*%/i.exec(content)
  if (!match) return null
  const asAt = /As at\s+[^)]*?\s+of\s+([A-Za-z]+\s+[0-9]{1,2},\s+[0-9]{4})/i.exec(content)
  const date = asAt ? isoDateFromEnglish(asAt[1]) || retrievedAt.slice(0, 10) : retrievedAt.slice(0, 10)
  return { variable: 'repo_rate', value: number(match[1]), unit: 'percent', date, source: 'Reserve Bank of India', sourceUrl: SOURCES.rbi, retrievalTimestamp: retrievedAt }
}

function parseCpiInflation(html, retrievedAt = new Date().toISOString()) {
  const content = text(html)
  const match = /inflation\s+rate\s+based\s+on\s+All\s+India\s+Consumer\s+Price\s+Index.*?\bis\s*([0-9]+(?:\.[0-9]+)?)\s*%/i.exec(content)
  if (!match) return null
  const period = /month\s+of\s+([A-Za-z]+),\s*([0-9]{4})/i.exec(content)
  const date = period ? `${period[2]}-${String(new Date(`${period[1]} 1, ${period[2]}`).getMonth() + 1).padStart(2, '0')}-01` : retrievedAt.slice(0, 10)
  return { variable: 'cpi_inflation', value: number(match[1]), unit: 'percent', date, source: 'Ministry of Statistics and Programme Implementation (PIB)', sourceUrl: SOURCES.cpi, retrievalTimestamp: retrievedAt, statusNote: 'Provisional where the official release identifies it as provisional.' }
}

function parseGovernmentBondYield(html, retrievedAt = new Date().toISOString()) {
  const content = text(html)
  const bucket = /9Y-10Y([\s\S]{0,500})/i.exec(content)
  if (!bucket) return null
  const values = [...bucket[1].matchAll(/\b([0-9]+(?:\.[0-9]+)?)\b/g)].map((match) => number(match[1])).filter((value) => value !== null)
  const value = values.at(-1)
  if (value === undefined) return null
  return { variable: 'bond_yield', value, unit: 'percent', date: retrievedAt.slice(0, 10), source: 'Clearing Corporation of India (CCIL)', sourceUrl: SOURCES.bond, retrievalTimestamp: retrievedAt, tenor: '9Y-10Y indicative government security yield' }
}

async function fetchText(url, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, { headers: { accept: 'text/html,application/xhtml+xml' } })
  if (!response.ok) throw new Error(`Macro provider returned HTTP ${response.status}.`)
  return response.text()
}

async function loadCurrentMacroData({ fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const retrievedAt = now.toISOString()
  const results = await Promise.allSettled([
    fetchText(SOURCES.rbi, fetchImpl).then((html) => parseRbiRepoRate(html, retrievedAt)),
    fetchText(SOURCES.cpi, fetchImpl).then((html) => parseCpiInflation(html, retrievedAt)),
    fetchText(SOURCES.bond, fetchImpl).then((html) => parseGovernmentBondYield(html, retrievedAt)),
  ])
  return results.map((result) => result.status === 'fulfilled' ? result.value : null).filter(Boolean)
}

module.exports = { SOURCES, parseRbiRepoRate, parseCpiInflation, parseGovernmentBondYield, loadCurrentMacroData }
