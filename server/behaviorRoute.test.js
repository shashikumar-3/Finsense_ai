const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')

const PORT = 5017
const BASE_URL = `http://127.0.0.1:${PORT}`

function startServer() {
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: require('node:path').resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const output = []
  const waitForStartup = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Behavior test server did not start. ${output.join(' ')}`)), 10000)
    const onData = (chunk) => {
      output.push(String(chunk))
      if (output.join('').includes(`Server running on port ${PORT}`)) {
        clearTimeout(timer)
        resolve()
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer)
        reject(new Error(`Behavior test server exited with ${code || signal}. ${output.join(' ')}`))
      }
    })
  })

  return { child, waitForStartup }
}

test('behavior endpoint is registered and enforces route validation and auth', async () => {
  const { child, waitForStartup } = startServer()
  try {
    await waitForStartup

    const invalidIdResponse = await fetch(`${BASE_URL}/api/portfolio/not-a-uuid/behavior`)
    assert.equal(invalidIdResponse.status, 400)
    assert.deepEqual(await invalidIdResponse.json(), {
      success: false,
      code: 'INVALID_PORTFOLIO_ID',
      message: 'A valid portfolio ID is required.',
    })

    const unauthenticatedResponse = await fetch(
      `${BASE_URL}/api/portfolio/31947c1e-a192-4a5e-9608-790cb63aefd3/behavior`,
    )
    assert.equal(unauthenticatedResponse.status, 401)
    const payload = await unauthenticatedResponse.json()
    assert.equal(payload.success, false)
    assert.equal(payload.code, 'UNAUTHORIZED')
  } finally {
    if (!child.killed) child.kill()
  }
})
