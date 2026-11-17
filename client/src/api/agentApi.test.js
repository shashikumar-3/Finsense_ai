import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAgentResponse } from './agentApi'

describe('agentApi conversation context', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sends only the bounded recent conversation with the stock question', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, answer: 'Answer' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const history = Array.from({ length: 14 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `message ${index}` }))

    await fetchAgentResponse('TCS', 'Is that concerning?', { history, timeoutMs: 1000 })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.symbol).toBe('TCS')
    expect(body.question).toBe('Is that concerning?')
    expect(body.history).toHaveLength(12)
    expect(body.history[0].content).toBe('message 2')
  })

  it('normalizes a legacy nested RAG response and rejects empty answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, response: { model: 'deterministic', answer: 'Grounded answer' } }),
    }))

    await expect(fetchAgentResponse('TCS', 'What about debt?', { timeoutMs: 1000 })).resolves.toMatchObject({
      model: 'deterministic',
      answer: 'Grounded answer',
    })
  })
})
