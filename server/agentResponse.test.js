const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeAgentResponse } = require('./agentResponse')

test('flattens the RAG response contract for the frontend', () => {
  const result = normalizeAgentResponse({
    symbol: 'ANANTRAJ.NS',
    response: {
      provider: 'deterministic',
      model: 'market-snapshot-v2',
      answer: 'The stock is currently sideways.',
    },
  }, 'ANANTRAJ')

  assert.equal(result.symbol, 'ANANTRAJ.NS')
  assert.equal(result.answer, 'The stock is currently sideways.')
  assert.equal(result.model, 'market-snapshot-v2')
  assert.equal(result.provider, 'deterministic')
})

test('rejects empty RAG answers instead of returning a blank chat message', () => {
  assert.throws(
    () => normalizeAgentResponse({ response: { model: 'market-snapshot-v2', answer: '  ' } }, 'TCS'),
    (error) => error.code === 'EMPTY_AGENT_RESPONSE' && error.status === 502,
  )
})
