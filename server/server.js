const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })

const { execFile } = require('child_process')
const { promisify } = require('util')
const express = require('express')
const cors = require('cors')
const axios = require('axios')
const YahooFinance = require('yahoo-finance2').default
const { OAuth2Client } = require('google-auth-library')

const execFileAsync = promisify(execFile)
const app = express()
const port = process.env.PORT || 5000
const allowedOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173'
const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClient = new OAuth2Client(googleClientId)
const yahooFinance = new YahooFinance()
const nseSymbolsUrl = 'https://archives.nseindia.com/content/equities/EQUITY_L.csv'
const nseSymbolsRefreshMs = 24 * 60 * 60 * 1000
const projectRoot = path.resolve(__dirname, '..')
const ragRoot = path.join(projectRoot, 'Rag_model')
const ragServicePath = path.join(ragRoot, 'pipeline', 'rag_service.py')
const ragVenvPython = path.join(ragRoot, 'venv', 'Scripts', 'python.exe')
const pythonExecutable = fs.existsSync(ragVenvPython) ? ragVenvPython : 'python'
const agentResponseCache = new Map()
let nseSymbolsCache = []
let nseSymbolsFetchedAt = 0
const agentResponseTtlMs =
  Math.max(Number(process.env.AGENT_RESPONSE_TTL_MINUTES) || 180, 1) * 60 * 1000
const symbolRefreshConcurrency = Math.min(
  Math.max(Number(process.env.INTELLIGENCE_REFRESH_CONCURRENCY) || 4, 1),
  8,
)

app.use(
  cors({
    origin: allowedOrigin,
  }),
)
app.use(express.json())

app.get('/', (req, res) => {
  res.send('FinSense AI Backend Running')
})

function sendServerError(res, message, error, status = 500) {
  console.error(message, error)

  return res.status(status).json({
    message,
    detail: process.env.NODE_ENV === 'development' ? error.message : undefined,
  })
}

app.get('/api/health', async (req, res) => {
  const health = {
    status: 'ok',
    backend: 'ok',
    rag: 'unknown',
    timestamp: new Date().toISOString(),
  }

  try {
    health.ragStore = await runRagCommand(['stats'], { timeout: 10000 })
    health.rag = 'ok'
  } catch (error) {
    health.status = 'degraded'
    health.rag = 'error'
    health.ragMessage = 'RAG service is not available.'
  }

  return res.status(health.status === 'ok' ? 200 : 503).json(health)
})

function normalizeNseSymbol(rawSymbol = '') {
  const clean = rawSymbol
    .toUpperCase()
    .replace(/^NSE:/, '')
    .replace(/\.NS$/, '')
    .trim()

  return clean
}

function mapRangeToDays(range) {
  switch ((range || '').toLowerCase()) {
    case '1d':
      return 1
    case '1w':
      return 7
    case '5d':
      return 5
    case '1m':
    case '1mo':
      return 30
    case '3m':
    case '3mo':
      return 90
    case '6m':
    case '6mo':
      return 180
    case '3y':
      return 365 * 3
    case '5y':
      return 365 * 5
    case 'all':
    case 'max':
      return 365 * 20
    case '1y':
      return 365
    default:
      return 30
  }
}

function normalizeChartQuotes(quotes = []) {
  const normalized = []

  for (const item of quotes) {
    const datetime = item?.date ? new Date(item.date).toISOString() : null
    const open = Number(item?.open)
    const high = Number(item?.high)
    const low = Number(item?.low)
    const close = Number(item?.close)
    const volume = Number(item?.volume)

    if (
      !datetime ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0
    ) {
      continue
    }

    const safeHigh = Math.max(open, high, low, close)
    const safeLow = Math.min(open, high, low, close)

    normalized.push({
      datetime,
      open,
      high: safeHigh,
      low: safeLow,
      close,
      volume: Number.isFinite(volume) && volume > 0 ? volume : 0,
    })
  }

  return normalized.filter((point, index, array) => index === 0 || point.datetime !== array[index - 1].datetime)
}

function parseCsvLine(line) {
  const result = []
  let current = ''
  let insideQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    const nextChar = line[i + 1]

    if (char === '"' && insideQuotes && nextChar === '"') {
      current += '"'
      i += 1
      continue
    }

    if (char === '"') {
      insideQuotes = !insideQuotes
      continue
    }

    if (char === ',' && !insideQuotes) {
      result.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  result.push(current.trim())
  return result
}

function parseNseCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) {
    return []
  }

  const headers = parseCsvLine(lines[0])
  const symbolIndex = headers.findIndex((header) => header === 'SYMBOL')
  const nameIndex = headers.findIndex((header) => header === 'NAME OF COMPANY')

  if (symbolIndex < 0 || nameIndex < 0) {
    return []
  }

  return lines
    .slice(1)
    .map((line) => parseCsvLine(line))
    .map((parts) => ({
      symbol: normalizeNseSymbol(parts[symbolIndex] || ''),
      name: (parts[nameIndex] || '').trim(),
    }))
    .filter((item) => item.symbol)
}

async function ensureNseSymbolsLoaded() {
  const shouldRefresh =
    !nseSymbolsCache.length || Date.now() - nseSymbolsFetchedAt > nseSymbolsRefreshMs

  if (!shouldRefresh) {
    return nseSymbolsCache
  }

  const response = await axios.get(nseSymbolsUrl, { timeout: 15000 })
  const parsed = parseNseCsv(response.data || '')

  if (parsed.length) {
    nseSymbolsCache = parsed
    nseSymbolsFetchedAt = Date.now()
  }

  return nseSymbolsCache
}

async function runRagCommand(args, { timeout = 20 * 60 * 1000 } = {}) {
  const { stdout, stderr } = await execFileAsync(
    pythonExecutable,
    [ragServicePath, ...args],
    {
      cwd: ragRoot,
      timeout,
      maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
      },
    },
  )

  const output = (stdout || '').trim()
  if (!output) {
    throw new Error(stderr?.trim() || 'RAG command returned no output.')
  }

  try {
    return JSON.parse(output)
  } catch (error) {
    throw new Error(`Unable to parse RAG output: ${error.message}`)
  }
}

function toBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue
  }

  const normalized = String(value).trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

function appendArg(args, flag, value) {
  if (value !== undefined && value !== null && String(value) !== '') {
    args.push(flag, String(value))
  }
}

function buildAgentCacheKey({ symbol, query, updatedAt, model }) {
  return [symbol || '', query || '', updatedAt || '', model || ''].join('::')
}

function getCachedAgentResponse(cacheKey) {
  const entry = agentResponseCache.get(cacheKey)
  if (!entry) {
    return null
  }

  if (entry.expiresAt <= Date.now()) {
    agentResponseCache.delete(cacheKey)
    return null
  }

  return entry.payload
}

function setCachedAgentResponse(cacheKey, payload) {
  agentResponseCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + agentResponseTtlMs,
  })
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function runWorker() {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1

      if (currentIndex >= items.length) {
        return
      }

      results[currentIndex] = await worker(items[currentIndex], currentIndex)
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length)
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
  return results
}

app.get('/api/stocks/nse', async (req, res) => {
  try {
    const search = (req.query.search || '').toString().trim().toUpperCase()
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500)
    const offset = Math.max(Number(req.query.offset) || 0, 0)
    const allSymbols = await ensureNseSymbolsLoaded()

    const filtered = search
      ? allSymbols.filter(
          (item) =>
            item.symbol.includes(search) ||
            item.name.toUpperCase().includes(search),
        )
      : allSymbols

    const paginated = filtered.slice(offset, offset + limit)

    return res.json({
      total: filtered.length,
      offset,
      limit,
      stocks: paginated,
    })
  } catch (error) {
    return sendServerError(res, 'Unable to fetch NSE symbols list.', error)
  }
})

app.get('/api/intelligence/store', async (req, res) => {
  try {
    const result = await runRagCommand(['stats'], { timeout: 30000 })
    return res.json(result)
  } catch (error) {
    return sendServerError(res, 'Unable to inspect the intelligence store.', error)
  }
})

app.get('/api/intelligence/stock/:symbol', async (req, res) => {
  try {
    const normalizedSymbol = normalizeNseSymbol(req.params.symbol || '')
    if (!normalizedSymbol) {
      return res.status(400).json({ message: 'Stock symbol is required.' })
    }

    const args = ['stock', normalizedSymbol]
    if (toBoolean(req.query.refresh, false)) {
      args.push('--refresh')
    }
    if (!toBoolean(req.query.includeNews, true)) {
      args.push('--skip-news')
    }
    if (toBoolean(req.query.cachedOnly, false)) {
      args.push('--cached-only')
    }

    const result = await runRagCommand(args, { timeout: 300000 })
    return res.json(result)
  } catch (error) {
    return sendServerError(res, 'Unable to fetch unified stock intelligence.', error)
  }
})

app.get('/api/intelligence/search', async (req, res) => {
  try {
    const args = ['search']
    appendArg(args, '--query', req.query.query || '')
    appendArg(args, '--limit', Math.min(Math.max(Number(req.query.limit) || 10, 1), 100))
    appendArg(args, '--trend', req.query.trend || '')
    appendArg(args, '--sentiment', req.query.sentiment || '')
    appendArg(args, '--hype-label', req.query.hypeLabel || '')

    const result = await runRagCommand(args, { timeout: 120000 })
    return res.json({
      total: result.length,
      results: result,
    })
  } catch (error) {
    return sendServerError(res, 'Unable to search stock intelligence.', error)
  }
})

app.post('/api/intelligence/refresh', async (req, res) => {
  try {
    const body = req.body || {}
    const includeNews = body.includeNews !== undefined ? Boolean(body.includeNews) : true
    const skipInvalidMarket = Boolean(body.skipInvalidMarket)
    const forceRefreshUniverse = Boolean(body.forceRefreshUniverse)
    const limit = Math.max(Number(body.limit) || 0, 0)
    const offset = Math.max(Number(body.offset) || 0, 0)
    const search = (body.search || '').toString()
    const rawSymbols = Array.isArray(body.symbols) ? body.symbols : []
    const normalizedSymbols = rawSymbols
      .map((symbol) => normalizeNseSymbol(symbol))
      .filter(Boolean)

    if (normalizedSymbols.length) {
      const items = await mapWithConcurrency(
        normalizedSymbols,
        symbolRefreshConcurrency,
        async (symbol) => {
          const args = ['stock', symbol, '--refresh']
          if (!includeNews) {
            args.push('--skip-news')
          }
          return runRagCommand(args, { timeout: 180000 })
        },
      )

      const store = await runRagCommand(['stats'], { timeout: 30000 })
      return res.json({
        mode: 'symbols',
        processed: items.length,
        store,
        items,
      })
    }

    const args = ['refresh']
    const wantsAll = Boolean(body.all) || (!search && !limit && !offset)
    if (wantsAll) {
      args.push('--all')
    }
    if (!includeNews) {
      args.push('--skip-news')
    }
    if (skipInvalidMarket) {
      args.push('--skip-invalid-market')
    }
    if (forceRefreshUniverse) {
      args.push('--force-refresh-universe')
    }
    appendArg(args, '--search', search)
    appendArg(args, '--offset', offset)
    appendArg(args, '--limit', limit)

    const result = await runRagCommand(args, { timeout: 30 * 60 * 1000 })
    return res.json({
      mode: wantsAll ? 'universe' : 'filtered',
      ...result,
    })
  } catch (error) {
    return sendServerError(res, 'Unable to refresh stock intelligence.', error)
  }
})

app.post('/api/agent/respond', async (req, res) => {
  try {
    const body = req.body || {}
    const normalizedSymbol = normalizeNseSymbol(body.symbol || '')
    const query = (body.question || body.query || '').toString().trim()
    const includeNews = body.includeNews !== undefined ? Boolean(body.includeNews) : true
    const refresh = Boolean(body.refresh)

    if (!normalizedSymbol) {
      return res.status(400).json({ message: 'Stock symbol is required.' })
    }

    if (!query) {
      return res.status(400).json({ message: 'A question is required.' })
    }

    const stockArgs = ['stock', normalizedSymbol, '--cached-only']
    const cachedItem = await runRagCommand(stockArgs, { timeout: 60000 })
    const cachedDocument = cachedItem?.document || cachedItem
    const cacheKey = buildAgentCacheKey({
      symbol: cachedDocument?.symbol || `${normalizedSymbol}.NS`,
      query,
      updatedAt: cachedDocument?.updated_at || '',
      model: process.env.LLM_MODEL || process.env.LLM_PROVIDER || 'fallback',
    })

    const cachedResponse = !refresh ? getCachedAgentResponse(cacheKey) : null
    if (cachedResponse) {
      return res.json({
        cached: true,
        ...cachedResponse,
      })
    }

    const args = ['respond', '--symbol', normalizedSymbol, '--query', query]
    if (!refresh && cachedItem?.found !== false && cachedDocument) {
      args.push('--cached-only')
    }
    if (refresh) {
      args.push('--refresh')
    }
    if (!includeNews) {
      args.push('--skip-news')
    }

    const result = await runRagCommand(args, { timeout: 300000 })
    const responseDocument = result?.document || {}
    const resolvedCacheKey = buildAgentCacheKey({
      symbol: responseDocument?.symbol || `${normalizedSymbol}.NS`,
      query,
      updatedAt: responseDocument?.updated_at || '',
      model: result?.response?.model || process.env.LLM_MODEL || process.env.LLM_PROVIDER || 'fallback',
    })

    const payload = {
      cached: false,
      ...result,
    }
    setCachedAgentResponse(resolvedCacheKey, payload)
    return res.json(payload)
  } catch (error) {
    return sendServerError(res, 'Unable to generate AI analyst response.', error)
  }
})

app.get('/api/stock/:symbol', async (req, res) => {
  try {
    const normalizedSymbol = normalizeNseSymbol(req.params.symbol || '')

    if (!normalizedSymbol) {
      return res.status(400).json({ message: 'Stock symbol is required.' })
    }

    const yahooSymbol = `${normalizedSymbol}.NS`
    const data = await yahooFinance.quote(yahooSymbol)

    if (!data || !Number.isFinite(data.regularMarketPrice)) {
      return res.status(404).json({ message: 'Stock not found.' })
    }

    return res.json({
      symbol: normalizedSymbol,
      yahooSymbol,
      tradingViewSymbol: `NSE:${normalizedSymbol}`,
      exchange: 'NSE',
      currency: data.currency || 'INR',
      name: data.shortName || data.longName || normalizedSymbol,
      price: data.regularMarketPrice,
      change: data.regularMarketChange,
      changePercent: data.regularMarketChangePercent,
      open: data.regularMarketOpen,
      high: data.regularMarketDayHigh,
      low: data.regularMarketDayLow,
      previousClose: data.regularMarketPreviousClose,
      volume: data.regularMarketVolume,
      timestamp: data.regularMarketTime || null,
    })
  } catch (error) {
    return sendServerError(res, 'Unable to fetch stock data.', error)
  }
})

app.get('/api/stock/:symbol/chart', async (req, res) => {
  try {
    const normalizedSymbol = normalizeNseSymbol(req.params.symbol || '')
    if (!normalizedSymbol) {
      return res.status(400).json({ message: 'Stock symbol is required.' })
    }

    const range = req.query.range || '1mo'
    const interval = req.query.interval || '1d'
    const days = mapRangeToDays(range)
    const period2 = new Date()
    const period1 = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const yahooSymbol = `${normalizedSymbol}.NS`

    const data = await yahooFinance.chart(yahooSymbol, {
      period1,
      period2,
      interval,
    })

    const result = Array.isArray(data?.quotes) ? normalizeChartQuotes(data.quotes) : []

    return res.json({
      symbol: normalizedSymbol,
      interval,
      range,
      points: result,
    })
  } catch (error) {
    return sendServerError(res, 'Unable to fetch stock chart data.', error)
  }
})

app.post('/auth/google', async (req, res) => {
  if (!googleClientId) {
    return res.status(500).json({
      message: 'GOOGLE_CLIENT_ID is not configured on the server.',
    })
  }

  const { credential } = req.body

  if (!credential) {
    return res.status(400).json({
      message: 'Missing Google credential.',
    })
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: googleClientId,
    })

    const payload = ticket.getPayload()

    if (!payload || !payload.sub || !payload.email) {
      return res.status(401).json({
        message: 'Google token payload is incomplete.',
      })
    }

    return res.json({
      user: {
        sub: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified,
        name: payload.name || payload.email.split('@')[0],
        picture: payload.picture || null,
      },
    })
  } catch (error) {
    return sendServerError(res, 'Google token verification failed.', error, 401)
  }
})

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})
