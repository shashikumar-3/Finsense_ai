const { spawn } = require('child_process')

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:5000'

async function requestJson(path) {
  const response = await fetch(`${BASE_URL}${path}`)
  const text = await response.text()
  let payload = null

  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`${path} returned non-JSON: ${text.slice(0, 120)}`)
  }

  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${payload?.message || text}`)
  }

  return payload
}

async function requestText(path) {
  const response = await fetch(`${BASE_URL}${path}`)
  const text = await response.text()

  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${text.slice(0, 120)}`)
  }

  return text
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await requestText('/')
      return
    } catch {
      await wait(500)
    }
  }

  throw new Error('Backend did not become ready in time.')
}

async function main() {
  let server = null
  let startedServer = false

  try {
    await requestText('/')
  } catch {
    startedServer = true
    server = spawn(process.execPath, ['server/server.js'], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: 'inherit',
    })
  }

  try {
    await waitForServer()

    const health = await requestJson('/api/health')
    const store = await requestJson('/api/intelligence/store')
    const nse = await requestJson('/api/stocks/nse?limit=1')

    if (!health.backend || !store.store_path || !Array.isArray(nse.stocks)) {
      throw new Error('Smoke test response shape check failed.')
    }

    console.log('Smoke tests passed.')
  } finally {
    if (startedServer && server) {
      server.kill()
    }
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
