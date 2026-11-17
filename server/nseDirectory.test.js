const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeCachedSymbols, normalizeNseSymbol, parseNseCsv } = require('./nseDirectory')

test('normalizes NSE provider symbols and parses BOM-prefixed CSV headers', () => {
  assert.equal(normalizeNseSymbol('nse:reliance.ns'), 'RELIANCE')
  const result = parseNseCsv('\uFEFFSYMBOL,NAME OF COMPANY\nRELIANCE,"Reliance Industries Limited"\n')
  assert.deepEqual(result, [{ symbol: 'RELIANCE', name: 'Reliance Industries Limited' }])
})

test('rejects malformed/empty directories rather than inventing symbols', () => {
  assert.deepEqual(parseNseCsv('unexpected,response\n'), [])
  assert.deepEqual(normalizeCachedSymbols({ stocks: [] }), [])
})
