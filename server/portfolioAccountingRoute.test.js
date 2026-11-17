const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')

const PORT = 5020

test('portfolio accounting endpoint requires authentication before private ledger access', async () => {
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: require('node:path').resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = []
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Accounting test server did not start: ${output.join(' ')}`)), 10000)
      const onData = (chunk) => {
        output.push(String(chunk))
        if (output.join('').includes(`Server running on port ${PORT}`)) {
          clearTimeout(timer)
          resolve()
        }
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)
      child.once('error', reject)
    })
    const response = await fetch(`http://127.0.0.1:${PORT}/api/portfolio/00000000-0000-0000-0000-000000000000/accounting`)
    assert.equal(response.status, 401)
    assert.equal((await response.json()).code, 'UNAUTHORIZED')
  } finally {
    if (!child.killed) child.kill()
  }
})
