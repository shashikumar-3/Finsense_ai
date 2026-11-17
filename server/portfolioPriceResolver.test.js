const test = require('node:test')
const assert = require('node:assert/strict')
const { selectHistoricalPrice } = require('./portfolioPriceResolver')

const point = (iso, price) => ({ timestamp: new Date(iso).getTime(), price })

test('uses the previous trading close before the NSE session opens', () => {
  const selected = selectHistoricalPrice([point('2026-11-04T10:00:00Z', 100), point('2026-11-05T10:00:00Z', 110)], '2026-11-05T03:00:00Z', '1d')
  assert.equal(selected.price, 100)
})

test('uses the same day close after 15:30 IST', () => {
  const selected = selectHistoricalPrice([point('2026-11-05T10:00:00Z', 110), point('2026-11-06T10:00:00Z', 120)], '2026-11-05T14:02:00Z', '1d')
  assert.equal(selected.price, 110)
})

test('uses the latest intraday price at or before the entered time', () => {
  const selected = selectHistoricalPrice([point('2026-11-05T09:00:00Z', 100), point('2026-11-05T09:30:00Z', 105), point('2026-11-05T10:00:00Z', 110)], '2026-11-05T09:45:00Z', '5m')
  assert.equal(selected.price, 105)
})
