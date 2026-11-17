function normalizeAgentResponse(payload, symbol) {
  const source = payload && typeof payload === 'object' ? payload : {}
  const nested = source.response && typeof source.response === 'object' ? source.response : {}
  const answer = String(source.answer ?? nested.answer ?? '').trim()

  if (!answer) {
    const error = new Error('The stock analyst returned an empty response. Please try again.')
    error.code = 'EMPTY_AGENT_RESPONSE'
    error.status = 502
    throw error
  }

  return {
    ...source,
    ...nested,
    success: true,
    symbol: source.symbol || symbol,
    answer,
    response: source.response && typeof source.response === 'object'
      ? { ...nested, answer }
      : undefined,
  }
}

module.exports = { normalizeAgentResponse }
