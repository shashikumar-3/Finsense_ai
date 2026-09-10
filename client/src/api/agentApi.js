const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

async function parseJson(response) {
  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json() : null

  if (!response.ok) {
    throw new Error(data?.message || 'Unable to reach the AI analyst service. Please try again.')
  }

  return data
}

export async function fetchAgentResponse(symbol, question, { refresh = false, includeNews = true } = {}) {
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
    }),
  })

  return parseJson(response)
}
