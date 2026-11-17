const test = require('node:test')
const assert = require('node:assert/strict')
const { parseRbiRepoRate, parseCpiInflation, parseGovernmentBondYield, loadCurrentMacroData } = require('./macroData')

test('parses the RBI repo rate from the current-rates page', () => {
  const result = parseRbiRepoRate('<div>Policy Repo Rate | : 5.50%</div><p>As at 1.00pm of November 09, 2026</p>')
  assert.equal(result.value, 5.5)
  assert.equal(result.date, '2026-11-09')
})

test('parses official CPI release and CCIL indicative government yield', () => {
  const cpi = parseCpiInflation('Year-on-year inflation rate based on All India Consumer Price Index (CPI) for the month of October, 2026 over October, 2025 is 6.09% (Provisional).')
  const bond = parseGovernmentBondYield('Date 2026-11-13 9Y-10Y 6.94% GS 2036 YTM (%) 7.3069')
  assert.equal(cpi.value, 6.09)
  assert.equal(cpi.date, '2026-10-01')
  assert.equal(bond.value, 7.3069)
  assert.equal(bond.unit, 'percent')
})

test('loads available macro sources without fabricating failed providers', async () => {
  const pages = {
    'https://www.rbi.org.in/Home.aspx': '<div>Policy Repo Rate | : 5.50%</div>',
    'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2335416&lang=1&reg=3': 'inflation rate based on All India Consumer Price Index for the month of October, 2026 over October, 2025 is 6.09%',
    'https://www.ccilindia.com/en/tenorwise-indicative-yields': '9Y-10Y 6.94% GS 2036 7.3069',
  }
  const fetchImpl = async (url) => ({ ok: true, text: async () => pages[url] })
  const rows = await loadCurrentMacroData({ fetchImpl, now: new Date('2026-11-16T00:00:00Z') })
  assert.deepEqual(rows.map((row) => row.variable).sort(), ['bond_yield', 'cpi_inflation', 'repo_rate'])
})
