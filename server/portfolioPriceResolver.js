function indiaParts(value, includeTime = true) {
  const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }
  if (includeTime) Object.assign(options, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', options).formatToParts(new Date(value)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
}

function selectHistoricalPrice(points, executedAt, interval) {
  const target = new Date(executedAt)
  const targetMs = target.getTime()
  if (!Number.isFinite(targetMs)) return null
  const targetParts = indiaParts(target)
  const targetDate = `${targetParts.year}-${targetParts.month}-${targetParts.day}`
  const targetMinutes = Number(targetParts.hour) * 60 + Number(targetParts.minute)
  const beforeMarketOpen = targetMinutes < 9 * 60 + 15
  const afterMarketClose = targetMinutes >= 15 * 60 + 30
  const valid = points.filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.price) && point.price > 0).sort((left, right) => left.timestamp - right.timestamp)
  const dateOf = (timestamp) => { const parts = indiaParts(timestamp, false); return `${parts.year}-${parts.month}-${parts.day}` }
  const eligible = valid.filter((point) => {
    const pointDate = dateOf(point.timestamp)
    if (interval === '1d' && beforeMarketOpen) return pointDate < targetDate
    if (interval === '1d' && afterMarketClose) return pointDate <= targetDate
    return point.timestamp <= targetMs && pointDate === targetDate
  })
  return eligible.at(-1) || (interval === '5m' ? valid.filter((point) => dateOf(point.timestamp) < targetDate).at(-1) : null)
}

module.exports = { indiaParts, selectHistoricalPrice }
