const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')

const PORT = 5018

test('financial planner endpoint is protected before accessing private planning tables', async () => {
  const child = spawn(process.execPath, ['server/server.js'], { cwd: require('node:path').resolve(__dirname, '..'), env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] })
  const output = []
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Planner test server did not start: ${output.join(' ')}`)), 10000)
      const onData = (chunk) => { output.push(String(chunk)); if (output.join('').includes(`Server running on port ${PORT}`)) { clearTimeout(timer); resolve() } }
      child.stdout.on('data', onData); child.stderr.on('data', onData); child.once('error', reject)
    })
    const response = await fetch(`http://127.0.0.1:${PORT}/api/financial-planner`)
    assert.equal(response.status, 401)
    assert.equal((await response.json()).code, 'UNAUTHORIZED')
  } finally { if (!child.killed) child.kill() }
})
