const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

async function parseJson(response) {
  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json() : null

  if (!response.ok) {
    throw new Error(data?.message || data?.error || 'Unable to reach the AI analyst service. Please try again.')
  }

  return data
}

export async function fetchAgentResponse(
  symbol,
  question,
  { refresh = false, includeNews = true, fast = false, history = [], signal = null, timeoutMs = 95000 } = {},
) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort(new Error('AI analyst request timed out. Please try again.'))
  }, timeoutMs)

  if (signal) {
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/agent/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        symbol,
        question,
        refresh,
        includeNews,
        fast,
        history: Array.isArray(history) ? history.slice(-12) : [],
      }),
      signal: controller.signal,
    })

    const data = await parseJson(response)
    const nested = data?.response && typeof data.response === 'object' ? data.response : null
    const answer = String(data?.answer ?? nested?.answer ?? '').trim()
    if (!answer) {
      throw new Error('The stock analyst returned an empty response. Please try again.')
    }
    return nested ? { ...data, ...nested, answer } : { ...data, answer }
  } catch (error) {
    if (error.name === 'AbortError' || controller.signal.aborted) {
      throw new Error(controller.signal.reason?.message || 'AI analyst request timed out. Please try again.')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}
