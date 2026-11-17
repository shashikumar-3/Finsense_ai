const fs = require('fs')
const path = require('path')
const { normalizeAgentResponse } = require('./agentResponse')
const dotenv = require('dotenv')

const environmentRoot = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(environmentRoot, '.env') })

// The frontend's local environment is convenient for local development because
// it contains the testing Supabase target, but it must never be loaded by a
// production backend. Production deployments must provide SUPABASE_URL and a
// server-side publishable/anon key through their own environment.
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.join(environmentRoot, 'client', '.env.local'), override: false })
}

const { execFile } = require('child_process')
const { promisify } = require('util')
const express = require('express')
const cors = require('cors')
const axios = require('axios')
const YahooFinance = require('yahoo-finance2').default
const { OAuth2Client } = require('google-auth-library')
const { createClient } = require('@supabase/supabase-js')
const {
  buildPortfolioInsightCacheKey,
  buildPortfolioInsightQuery,
  buildDeterministicPortfolioInsight,
  sanitizeAiText,
  validatePortfolioInsightPayload,
} = require('./portfolioInsights')
const { normalizeCachedSymbols, normalizeNseSymbol, parseNseCsv } = require('./nseDirectory')
const { selectHistoricalPrice } = require('./portfolioPriceResolver')
const { accountFifoTransactions } = require('./portfolioAccounting')
const { analyzeBehavior } = require('./behaviorAnalysis')
const { buildPlannerExplanation, calculatePlanner, compareScenarios, simulateLifeEvent, calculateFinancialIndependence } = require('./financialPlanner')
const { buildPortfolioReport, buildFinancialReport, buildStockReport, reportCsv, buildSimplePdf, safeFilename } = require('./reporting')
const {
  applyPortfolioImpacts,
  applyStockImpacts,
  SECTOR_COEFFICIENTS,
  simulateRipple,
} = require('./rippleAnalysis')
const { loadCurrentMacroData } = require('./macroData')

const execFileAsync = promisify(execFile)
const app = express()
const port = process.env.PORT || 5000
const allowedOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173'
const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClient = new OAuth2Client(googleClientId)
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })
const nseSymbolsUrl = 'https://archives.nseindia.com/content/equities/EQUITY_L.csv'
const nseSymbolsRefreshMs = 24 * 60 * 60 * 1000
const projectRoot = path.resolve(__dirname, '..')
const ragRoot = path.join(projectRoot, 'Rag_model')
const nseSymbolsCachePath = path.join(ragRoot, 'pipeline', 'data', 'nse_symbols_cache.json')
const ragServicePath = path.join(ragRoot, 'pipeline', 'rag_service.py')
const marketOverviewSymbols = [
  'RELIANCE',
  'TCS',
  'INFY',
  'HDFCBANK',
  'ICICIBANK',
  'SBIN',
  'ITC',
  'LT',
  'BHARTIARTL',
  'HINDUNILVR',
  'SUNPHARMA',
  'TATAMOTORS',
]
const ragVenvPython = path.join(ragRoot, 'venv', 'Scripts', 'python.exe')
let macroLiveCache = { expiresAt: 0, observations: [] }
const pythonExecutable = fs.existsSync(ragVenvPython) ? ragVenvPython : 'python'
const agentResponseCache = new Map()
const portfolioInsightCache = new Map()
const marketResponseCache = new Map()
const intelligenceInFlight = new Map()
let nseSymbolsCache = []
let nseSymbolsFetchedAt = 0
let nseSymbolsLastAttemptAt = 0
let nseSymbolsRefreshPromise = null
let nseSymbolsSource = 'unavailable'
let nseSymbolsStale = false
let nseSymbolsLastError = null
const agentResponseTtlMs =
  Math.max(Number(process.env.AGENT_RESPONSE_TTL_MINUTES) || 180, 1) * 60 * 1000
const symbolRefreshConcurrency = Math.min(
  Math.max(Number(process.env.INTELLIGENCE_REFRESH_CONCURRENCY) || 4, 1),
  8,
)
const portfolioInsightTtlMs = Math.max(Number(process.env.PORTFOLIO_INSIGHT_TTL_MINUTES) || 5, 1) * 60 * 1000

const portfolioSupabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const portfolioSupabaseKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const portfolioSupabaseProjectRef = (() => {
  try {
    return new URL(portfolioSupabaseUrl || '').hostname.split('.')[0]
  } catch {
    return ''
  }
})()
const portfolioSupabaseEnabled = Boolean(
  portfolioSupabaseUrl && portfolioSupabaseKey,
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
    success: false,
    message,
    detail: process.env.NODE_ENV === 'development' ? error?.message : undefined,
  })
}

app.get('/api/health', async (req, res) => {
  const health = {
    status: 'ok',
    backend: 'ok',
    transactionPriceResolver: 'historical-market-v2',
    rag: 'unknown',
    timestamp: new Date().toISOString(),
  }

  try {
    health.ragStore = await runRagCommand(['stats'], { timeout: 30000 })
    health.rag = 'ok'
  } catch (error) {
    health.status = 'degraded'
    health.rag = 'error'
    health.ragMessage = 'RAG service is not available.'
  }

  return res.status(health.status === 'ok' ? 200 : 503).json(health)
})

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

function loadNseSymbolsFromDisk() {
  try {
    const payload = JSON.parse(fs.readFileSync(nseSymbolsCachePath, 'utf8'))
    if (!Array.isArray(payload)) {
      return []
    }

    return normalizeCachedSymbols(payload)
  } catch (error) {
    console.warn('Unable to load the local NSE symbol cache.', error.message)
    return []
  }
}

async function ensureNseSymbolsLoaded() {
  const now = Date.now()
  const shouldRefresh = !nseSymbolsCache.length || now - nseSymbolsFetchedAt > nseSymbolsRefreshMs
  const retryAllowed = now - nseSymbolsLastAttemptAt > 5 * 60 * 1000
  if (!shouldRefresh) return nseSymbolsCache
  if (nseSymbolsCache.length && (!retryAllowed || nseSymbolsRefreshPromise)) return nseSymbolsCache

  nseSymbolsLastAttemptAt = now
  nseSymbolsRefreshPromise = (async () => {
    try {
      const response = await axios.get(nseSymbolsUrl, { timeout: 15000 })
      const parsed = parseNseCsv(response.data || '')
      if (!parsed.length) throw new Error('NSE symbol provider returned no valid symbols.')
      nseSymbolsCache = parsed
      nseSymbolsFetchedAt = Date.now()
      nseSymbolsSource = 'nse-official-csv'
      nseSymbolsStale = false
      nseSymbolsLastError = null
      return nseSymbolsCache
    } catch (error) {
      nseSymbolsLastError = error?.message || 'NSE symbol provider unavailable.'
      nseSymbolsStale = Boolean(nseSymbolsCache.length)
      if (nseSymbolsCache.length) return nseSymbolsCache
      throw error
    } finally {
      nseSymbolsRefreshPromise = null
    }
  })()

  if (nseSymbolsCache.length) return nseSymbolsCache
  return nseSymbolsRefreshPromise
}

function getCachedMarketResponse(key) {
  const entry = marketResponseCache.get(key)
  if (!entry || entry.expiresAt <= Date.now()) {
    marketResponseCache.delete(key)
    return null
  }

  return entry.payload
}

function setCachedMarketResponse(key, payload, ttlMs) {
  marketResponseCache.set(key, { payload, expiresAt: Date.now() + ttlMs })
}

function extractJson(text) {
  const trimmed = (text || '').trim()
  if (!trimmed) {
    return null
  }

  try {
    return JSON.parse(trimmed)
  } catch (_) {
    return null
  }
}

function formatRagCommand(args) {
  return [pythonExecutable, ragServicePath, ...args].join(' ')
}

function truncateLog(value, limit = 500) {
  const normalized = String(value || '').trim()
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized
}

async function runRagCommand(args, { timeout = 20 * 60 * 1000 } = {}) {
  let stdout = ''
  let stderr = ''
  const command = formatRagCommand(args)

  try {
    const execResult = await execFileAsync(
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
    stdout = execResult.stdout
    stderr = execResult.stderr
  } catch (err) {
    if (err.killed || err.signal === 'SIGTERM') {
      throw new Error(
        `RAG command timed out after ${Math.round(timeout / 1000)}s: ${command}`,
      )
    }

    const exitCode = err.code ?? 'unknown'
    const diagnostic = truncateLog(err.stderr || err.stdout || err.message)
    throw new Error(
      `RAG command failed (exit code ${exitCode}): ${command}${diagnostic ? `; ${diagnostic}` : ''}`,
    )
  }

  const parsed = extractJson(stdout)
  if (parsed !== null) {
    return parsed
  }

  const errorSummary = truncateLog(stderr) || truncateLog(stdout, 300)
  throw new Error(
    `Unable to parse RAG output (exit code 0): ${command}${errorSummary ? `; ${errorSummary}` : ''}`,
  )
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
  const normalizedQuery = String(query || '').trim().replace(/\s+/g, ' ').toLowerCase()
  return [symbol || '', normalizedQuery, updatedAt || '', model || ''].join('::')
}

function normalizeAgentHistory(history) {
  if (!Array.isArray(history)) return []
  return history
    .filter((item) => item && ['user', 'assistant'].includes(item.role))
    .map((item) => ({
      role: item.role,
      content: String(item.content || '').trim().slice(0, 1200),
    }))
    .filter((item) => item.content)
    .slice(-12)
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

function getBearerToken(req) {
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
}

async function getAuthorizedPortfolioClient(req) {
  if (!portfolioSupabaseEnabled) {
    const error = new Error('Portfolio insights require the configured development Supabase project.')
    error.status = 503
    throw error
  }

  const token = getBearerToken(req)
  if (!token) {
    const error = new Error('Authentication is required.')
    error.status = 401
    throw error
  }

  const client = createClient(portfolioSupabaseUrl, portfolioSupabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data?.user?.id) {
    const authError = new Error('Authentication could not be verified.')
    authError.status = 401
    throw authError
  }
  return { client, user: data.user }
}

async function resolveHistoricalTransactionPrice(symbol, executedAt) {
  const normalized = normalizeNseSymbol(symbol)
  const target = new Date(executedAt)
  const targetMs = target.getTime()
  if (!normalized || !Number.isFinite(targetMs)) throw Object.assign(new Error('A valid NSE symbol and transaction timestamp are required.'), { status: 400 })
  if (targetMs > Date.now() + 5 * 60 * 1000) throw Object.assign(new Error('A transaction cannot be dated in the future.'), { status: 400 })

  const yahooSymbol = `${normalized}.NS`
  const localParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(target).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  const localDate = `${localParts.year}-${localParts.month}-${localParts.day}`
  const localMinutes = Number(localParts.hour) * 60 + Number(localParts.minute)
  const beforeMarketOpen = localMinutes < 9 * 60 + 15
  const afterMarketClose = localMinutes >= 15 * 60 + 30
  const sameDay = (date) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
    return `${parts.year}-${parts.month}-${parts.day}`
  }
  const intervals = beforeMarketOpen || afterMarketClose ? ['1d'] : ['5m', '1d']
  for (const interval of intervals) {
    try {
      const chartOptions = {
        period1: new Date(Math.max(0, targetMs - 14 * 24 * 60 * 60 * 1000)),
        period2: new Date(Math.min(Date.now() + 24 * 60 * 60 * 1000, targetMs + 24 * 60 * 60 * 1000)),
        interval,
      }
      let data
      try {
        data = await yahooFinance.chart(yahooSymbol, chartOptions)
      } catch (primaryError) {
        const response = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`, {
          params: { period1: Math.floor(chartOptions.period1.getTime() / 1000), period2: Math.floor(chartOptions.period2.getTime() / 1000), interval },
          timeout: 15_000,
          responseType: 'json',
        })
        const result = response.data?.chart?.result?.[0]
        data = { quotes: (result?.timestamp || []).map((timestamp, index) => ({ date: new Date(timestamp * 1000), close: result?.indicators?.quote?.[0]?.close?.[index] })) }
        if (!data.quotes.length) throw primaryError
      }
      const points = (data?.quotes || []).map((point) => ({
        timestamp: new Date(point.date || point.datetime || point.timestamp || '').getTime(),
        price: Number(point.close),
      })).filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.price) && point.price > 0).sort((left, right) => left.timestamp - right.timestamp)
      const selected = selectHistoricalPrice(points, target, interval)
      if (selected) return { price: selected.price, observedAt: new Date(selected.timestamp).toISOString(), interval, symbol: normalized }
    } catch {
      // Try the next supported interval; the caller receives a clear unavailable
      // response if no historical observation can be resolved.
    }
  }
  throw Object.assign(new Error(`No historical market price was available for ${normalized} at or before the selected transaction time.`), { status: 422 })
}

async function authorizePortfolio(req, portfolioId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(portfolioId || ''))) throw Object.assign(new Error('A valid portfolio ID is required.'), { status: 400 })
  const { client, user } = await getAuthorizedPortfolioClient(req)
  const { data: portfolio, error } = await client.from('portfolios').select('id,user_id,base_currency').eq('id', portfolioId).eq('user_id', user.id).maybeSingle()
  if (error) throw error
  if (!portfolio) throw Object.assign(new Error('Portfolio not found.'), { status: 404 })
  return { client, user, portfolio }
}

async function savePortfolioTransaction(req, res, transactionId = '') {
  try {
    const portfolioId = String(req.params.portfolioId || '').trim()
    const { client, portfolio } = await authorizePortfolio(req, portfolioId)
    const body = req.body || {}
    const symbol = normalizeNseSymbol(body.symbol || '')
    const exchange = String(body.exchange || 'NSE').trim().toUpperCase()
    const currency = String(body.currency || portfolio.base_currency || 'INR').trim().toUpperCase()
    const transactionType = String(body.transaction_type || '').trim().toUpperCase()
    const quantity = Number(body.quantity)
    const executedAt = new Date(body.executed_at)
    if (!symbol || exchange !== 'NSE' || !/^[A-Z]{3}$/.test(currency) || !['BUY', 'SELL'].includes(transactionType) || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(executedAt.getTime())) throw Object.assign(new Error('Symbol, NSE exchange, currency, transaction type, positive quantity, and a valid transaction timestamp are required.'), { status: 400 })
    const resolved = await resolveHistoricalTransactionPrice(symbol, executedAt.toISOString())
    const payload = { portfolio_id: portfolioId, symbol, exchange, currency, transaction_type: transactionType, quantity, unit_price: resolved.price, executed_at: executedAt.toISOString() }
    const query = transactionId
      ? client.from('portfolio_transactions').update(payload).eq('id', transactionId).eq('portfolio_id', portfolioId).select('id,symbol,exchange,currency,transaction_type,quantity,unit_price,fees,executed_at').maybeSingle()
      : client.from('portfolio_transactions').insert(payload).select('id,symbol,exchange,currency,transaction_type,quantity,unit_price,fees,executed_at').single()
    const { data, error } = await query
    if (error) throw error
    if (!data) throw Object.assign(new Error('Transaction not found.'), { status: 404 })
    return res.status(transactionId ? 200 : 201).json({ success: true, transaction: data, priceResolution: resolved })
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502
    if ([400, 401, 404, 422, 503].includes(status)) return res.status(status).json({ success: false, code: status === 401 ? 'UNAUTHORIZED' : 'TRANSACTION_UNAVAILABLE', message: error.message })
    console.error(`[portfolio] transaction save failed errorType=${error?.name || 'Error'} message=${truncateLog(error?.message, 240)}`)
    return res.status(502).json({ success: false, code: 'TRANSACTION_UNAVAILABLE', message: 'Unable to resolve the historical market price for this transaction.' })
  }
}

app.post('/api/portfolio/:portfolioId/transactions', (req, res) => savePortfolioTransaction(req, res))
app.put('/api/portfolio/:portfolioId/transactions/:transactionId', (req, res) => savePortfolioTransaction(req, res, String(req.params.transactionId || '').trim()))

app.get('/api/portfolio/:portfolioId/accounting', async (req, res) => {
  try {
    const { client, portfolio } = await authorizePortfolio(req, String(req.params.portfolioId || '').trim())
    const { data: transactions, error } = await client
      .from('portfolio_transactions')
      .select('id, symbol, exchange, currency, transaction_type, quantity, unit_price, fees, executed_at, created_at')
      .eq('portfolio_id', portfolio.id)
      .order('executed_at', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
    if (error) throw error

    const symbols = [...new Set((transactions || []).filter((row) => Number(row.quantity) > 0).map((row) => String(row.symbol || '').toUpperCase()))]
    const quoteEntries = await Promise.all(symbols.map(async (symbol) => {
      try {
        const quote = await yahooFinance.quote(`${symbol}.NS`)
        return [symbol, {
          price: Number.isFinite(Number(quote?.regularMarketPrice)) ? Number(quote.regularMarketPrice) : null,
          currency: quote?.currency || 'INR',
          timestamp: quote?.regularMarketTime || null,
        }]
      } catch (quoteError) {
        return [symbol, { price: null, currency: 'INR', timestamp: null, error: quoteError?.message || 'Quote unavailable.' }]
      }
    }))
    const quotes = Object.fromEntries(quoteEntries)
    const accounting = accountFifoTransactions(transactions || [], quotes, { baseCurrency: portfolio.base_currency })
    return res.json({ success: true, portfolio: { id: portfolio.id, name: portfolio.name, baseCurrency: portfolio.base_currency }, transactions: transactions || [], quotes, accounting })
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502
    if ([400, 401, 404, 422, 503].includes(status)) return res.status(status).json({ success: false, code: status === 401 ? 'UNAUTHORIZED' : 'PORTFOLIO_ACCOUNTING_UNAVAILABLE', message: error.message })
    console.error(`[portfolio] accounting failed errorType=${error?.name || 'Error'} message=${truncateLog(error?.message, 240)}`)
    return res.status(502).json({ success: false, code: 'PORTFOLIO_ACCOUNTING_UNAVAILABLE', message: 'Unable to calculate the portfolio accounting summary.' })
  }
})

function getCachedPortfolioInsight(cacheKey) {
  const cached = portfolioInsightCache.get(cacheKey)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    portfolioInsightCache.delete(cacheKey)
    return null
  }
  return cached.payload
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
      source: nseSymbolsSource,
      stale: nseSymbolsStale,
      lastRefreshError: nseSymbolsStale ? 'The official NSE directory could not be refreshed; showing the last known directory.' : null,
    })
  } catch (error) {
    return sendServerError(res, 'The NSE symbol directory is temporarily unavailable.', error, 503)
  }
})

app.get('/api/strength/:symbol', async (req, res) => {
  const startedAt = Date.now()
  let normalizedSymbol = ''
  try {
    normalizedSymbol = normalizeNseSymbol(req.params.symbol || '')
    if (!normalizedSymbol) {
      return res.status(400).json({ message: 'Stock symbol is required.' })
    }
    const symbols = await ensureNseSymbolsLoaded()
    if (!symbols.some((item) => item.symbol === normalizedSymbol)) {
      return res.status(404).json({ message: 'Unsupported NSE symbol.' })
    }
    const args = ['strength', normalizedSymbol]
    if (toBoolean(req.query.withAi, false)) {
      args.push('--with-ai')
      appendArg(args, '--query', req.query.query || 'Explain this strength analysis.')
    }
    const result = await runRagCommand(args, { timeout: 180000 })
    console.info(`[strength] completed symbol=${normalizedSymbol} elapsedMs=${Date.now() - startedAt}`)
    return res.json(result)
  } catch (error) {
    console.error(
      `[strength] failed symbol=${normalizedSymbol || 'unresolved'} elapsedMs=${Date.now() - startedAt} ` +
        `errorType=${error?.name || 'Error'} message=${truncateLog(error?.message, 300)}`,
    )
    return sendServerError(res, 'Unable to generate strength analysis.', error)
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

app.get('/api/market-overview', async (req, res) => {
  try {
    const indexSymbols = [
      { symbol: 'NIFTY 50', yahooSymbol: '^NSEI' },
      { symbol: 'SENSEX', yahooSymbol: '^BSESN' },
    ]
    const indexQuotes = await Promise.all(indexSymbols.map(async (index) => {
      const data = await yahooFinance.quote(index.yahooSymbol)
      return {
        symbol: index.symbol,
        price: data.regularMarketPrice,
        change: data.regularMarketChange,
        changePercent: data.regularMarketChangePercent,
        timestamp: data.regularMarketTime || null,
      }
    }))

    const stockResults = await Promise.allSettled(
      marketOverviewSymbols.map(async (symbol) => {
        const data = await yahooFinance.quote(`${symbol}.NS`)
        return {
          symbol,
          name: data.shortName || data.longName || symbol,
          price: data.regularMarketPrice,
          change: data.regularMarketChange,
          changePercent: data.regularMarketChangePercent,
          timestamp: data.regularMarketTime || null,
        }
      }),
    )
    const movers = stockResults
      .filter((result) => result.status === 'fulfilled' && Number.isFinite(result.value.changePercent))
      .map((result) => result.value)
      .sort((left, right) => right.changePercent - left.changePercent)
      .slice(0, 3)

    const chart = await Promise.all(indexSymbols.map(async (index) => {
      const data = await yahooFinance.chart(index.yahooSymbol, {
        period1: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        period2: new Date(),
        interval: '1d',
      })
      return {
        symbol: index.symbol,
        points: normalizeChartQuotes(data?.quotes || []).map((point) => ({
          datetime: point.datetime,
          close: point.close,
        })),
      }
    }))

    return res.json({ indexes: indexQuotes, movers, chart })
  } catch (error) {
    return sendServerError(res, 'Unable to fetch market overview.', error)
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

    const requestKey = `${normalizedSymbol}:${toBoolean(req.query.refresh, false)}:${toBoolean(req.query.includeNews, true)}:${toBoolean(req.query.cachedOnly, false)}`
    let request = intelligenceInFlight.get(requestKey)
    if (!request) {
      request = runRagCommand(args, { timeout: 300000 })
      intelligenceInFlight.set(requestKey, request)
      request.finally(() => intelligenceInFlight.delete(requestKey)).catch(() => {})
    }
    const result = await request
    return res.json(result)
  } catch (error) {
    return sendServerError(res, 'Unable to fetch unified stock intelligence.', error)
  }
})

app.get('/api/intelligence/stocks', async (req, res) => {
  try {
    const rawSymbols = Array.isArray(req.query.symbols)
      ? req.query.symbols
      : String(req.query.symbols || '').split(',')
    const normalizedSymbols = [...new Set(
      rawSymbols
        .map((symbol) => normalizeNseSymbol(symbol))
        .filter(Boolean),
    )].slice(0, 24)

    if (!normalizedSymbols.length) {
      return res.status(400).json({ message: 'At least one stock symbol is required.' })
    }

    const args = ['stocks', '--symbols', normalizedSymbols.join(',')]
    if (!toBoolean(req.query.includeNews, true)) {
      args.push('--skip-news')
    }
    if (toBoolean(req.query.cachedOnly, true)) {
      args.push('--cached-only')
    }

    const result = await runRagCommand(args, { timeout: 300000 })
    if (!Array.isArray(result)) {
      return res.status(502).json({ message: 'Intelligence service returned an invalid stock batch.' })
    }
    return res.json({ items: result })
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
    const fast = body.fast !== undefined ? Boolean(body.fast) : false
    const history = normalizeAgentHistory(body.history)

    if (!normalizedSymbol) {
      return res.status(400).json({ success: false, message: 'Stock symbol is required.' })
    }

    if (!query) {
      return res.status(400).json({ success: false, message: 'A question is required.' })
    }

    const currentModel = fast
      ? 'market-snapshot-v2'
      : process.env.LLM_MODEL || process.env.LLM_PROVIDER || 'gemini-2.0-flash'

    const cacheKey = buildAgentCacheKey({
      symbol: normalizedSymbol,
      query: `${history.map((item) => `${item.role}:${item.content}`).join('\n')}\n${query}`,
      model: currentModel,
    })

    const cachedResponse = !refresh ? getCachedAgentResponse(cacheKey) : null
    if (cachedResponse) {
      try {
        return res.json({ ...normalizeAgentResponse(cachedResponse, normalizedSymbol), cached: true })
      } catch (error) {
        // Do not keep malformed cached responses capable of rendering an empty chat bubble.
        agentResponseCache.delete(cacheKey)
      }
    }

    const conversationContext = history.length
      ? `Previous conversation for ${normalizedSymbol} (use only as conversational context; current verified data remains authoritative):\n${history.map((item) => `${item.role}: ${item.content}`).join('\n')}\n\nLatest user question: ${query}`
      : query
    const args = ['respond', '--symbol', normalizedSymbol, '--query', conversationContext]
    if (fast) {
      args.push('--fast')
    }
    if (refresh) {
      args.push('--refresh')
    }
    if (!includeNews) {
      args.push('--skip-news')
    }

    const result = await runRagCommand(args, { timeout: 120000 })
    const payload = {
      ...normalizeAgentResponse(result, normalizedSymbol),
      cached: false,
    }
    setCachedAgentResponse(cacheKey, payload)
    return res.json(payload)
  } catch (error) {
    return sendServerError(res, 'Unable to generate AI analyst response.', error)
  }
})

app.post('/api/portfolio/:portfolioId/insights', async (req, res) => {
  try {
    const portfolioId = String(req.params.portfolioId || '').trim()
    if (!/^[0-9a-f-]{36}$/i.test(portfolioId)) {
      return res.status(400).json({ success: false, code: 'INVALID_PORTFOLIO_ID', message: 'A valid portfolio ID is required.' })
    }

    const { client, user } = await getAuthorizedPortfolioClient(req)
    const { data: portfolio, error: portfolioError } = await client
      .from('portfolios')
      .select('id, name, base_currency')
      .eq('id', portfolioId)
      .maybeSingle()
    if (portfolioError) throw portfolioError
    if (!portfolio) return res.status(404).json({ success: false, code: 'PORTFOLIO_NOT_FOUND', message: 'Portfolio not found.' })

    const { data: holdings, error: holdingsError } = await client
      .from('portfolio_holdings')
      .select('symbol, currency, quantity, average_purchase_price, realized_pnl')
      .eq('portfolio_id', portfolioId)
      .order('symbol')
    if (holdingsError) throw holdingsError

    const facts = validatePortfolioInsightPayload(req.body || {}, holdings || [], portfolio)
    const cacheKey = buildPortfolioInsightCacheKey(user.id, portfolioId, facts)
    const cached = getCachedPortfolioInsight(cacheKey)
    if (cached) return res.json({ ...cached, cached: true })

    const result = await runRagCommand(
      ['portfolio', '--query', buildPortfolioInsightQuery(), '--facts', JSON.stringify(facts)],
      { timeout: 120000 },
    )
    const providerUnavailable = result?.provider === 'fallback' || result?.provider === 'deterministic'
    const answer = sanitizeAiText(result?.response || result?.answer) || (providerUnavailable ? buildDeterministicPortfolioInsight(facts) : '')
    if (!answer) {
      return res.status(503).json({ success: false, code: 'AI_UNAVAILABLE', message: 'AI insights are unavailable. Deterministic portfolio analysis remains available.' })
    }
    const payload = {
      success: true,
      cached: false,
      answer,
      generatedAt: new Date().toISOString(),
      provider: sanitizeAiText(result.provider || 'deterministic', 80),
      model: sanitizeAiText(result.model, 120),
      limitations: [
        result?.provider === 'fallback' || result?.provider === 'deterministic'
          ? 'The configured AI provider was unavailable; this is a deterministic explanation of the supplied verified facts.'
          : 'This interpretation is grounded in the supplied ledger and computed analysis.',
        'It is educational decision support, not a forecast or personalized buy/sell instruction.',
      ],
    }
    portfolioInsightCache.set(cacheKey, { payload, expiresAt: Date.now() + portfolioInsightTtlMs })
    return res.json(payload)
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502
    if (status === 401 || status === 404 || status === 400 || status === 503) {
      return res.status(status).json({ success: false, code: status === 401 ? 'UNAUTHORIZED' : 'AI_UNAVAILABLE', message: error.message })
    }
    console.error('Portfolio insight request failed.', error?.message || error)
    return res.status(502).json({ success: false, code: 'AI_PROVIDER_ERROR', message: 'Unable to generate portfolio insights. Deterministic analysis remains available.' })
  }
})

app.get('/api/portfolio/:portfolioId/behavior', async (req, res) => {
  try {
    const portfolioId = String(req.params.portfolioId || '').trim()
    if (!/^[0-9a-f-]{36}$/i.test(portfolioId)) {
      return res.status(400).json({ success: false, code: 'INVALID_PORTFOLIO_ID', message: 'A valid portfolio ID is required.' })
    }

    const { client, user } = await getAuthorizedPortfolioClient(req)
    const { data: portfolio, error: portfolioError } = await client
      .from('portfolios')
      .select('id, user_id, name, base_currency, created_at')
      .eq('id', portfolioId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (portfolioError) throw portfolioError
    if (!portfolio) return res.status(404).json({ success: false, code: 'PORTFOLIO_NOT_FOUND', message: 'Portfolio not found.' })

    const transactions = []
    const transactionPageSize = 1000
    let transactionOffset = 0
    while (true) {
      const { data: page, error: transactionError } = await client
        .from('portfolio_transactions')
        .select('id, portfolio_id, symbol, exchange, currency, transaction_type, quantity, unit_price, fees, executed_at, created_at')
        .eq('portfolio_id', portfolioId)
        .order('executed_at', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(transactionOffset, transactionOffset + transactionPageSize - 1)
      if (transactionError) throw transactionError
      transactions.push(...(page || []))
      if (!page || page.length < transactionPageSize) break
      transactionOffset += transactionPageSize
    }

    const { data: holdings, error: holdingsError } = await client
      .from('portfolio_holdings')
      .select('symbol, currency, quantity, average_purchase_price, realized_pnl, last_transaction_at')
      .eq('portfolio_id', portfolioId)
      .order('symbol')
    if (holdingsError) throw holdingsError

    const activeHoldings = (holdings || []).filter((holding) => Number(holding.quantity) > 0)
    const quoteEntries = await Promise.all(activeHoldings.map(async (holding) => {
      const symbol = String(holding.symbol || '').toUpperCase()
      try {
        const quote = await yahooFinance.quote(`${symbol}.NS`)
        return [symbol, { price: quote?.regularMarketPrice, currency: quote?.currency || holding.currency, timestamp: quote?.regularMarketTime || null }]
      } catch {
        const cached = getCachedMarketResponse(`quote:${symbol}.NS`)
        return [symbol, cached && Number.isFinite(Number(cached.price)) ? { price: cached.price, currency: cached.currency || holding.currency, timestamp: cached.timestamp || null, cached: true } : null]
      }
    }))

    return res.json({
      success: true,
      portfolio: { id: portfolio.id, name: portfolio.name, baseCurrency: portfolio.base_currency, createdAt: portfolio.created_at },
      analysis: analyzeBehavior(transactions || [], holdings || [], { currentQuotes: Object.fromEntries(quoteEntries), baseCurrency: portfolio.base_currency }),
    })
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502
    if (status === 401 || status === 404 || status === 400 || status === 503) {
      return res.status(status).json({ success: false, code: status === 401 ? 'UNAUTHORIZED' : 'BEHAVIOR_UNAVAILABLE', message: error.message })
    }
    console.error('Portfolio behavior request failed.', error?.message || error)
    return res.status(502).json({ success: false, code: 'BEHAVIOR_UNAVAILABLE', message: 'Unable to load behavior analysis.' })
  }
})

function plannerError(res, error, fallback = 'Financial planner request failed.') {
  const status = Number.isInteger(error?.status) ? error.status : 502
  const missingTables = error?.code === '42P01' || /relation .*financial_planning_/i.test(error?.message || '')
  if (missingTables) {
    return res.status(503).json({
      success: false,
      code: 'PLANNER_MIGRATION_MISSING',
      message: 'Financial Planner storage is not available in the development database. Apply the Phase 6 testing migration, then reload the page.',
    })
  }
  if (status === 400 || status === 401 || status === 404 || status === 503) return res.status(status).json({ success: false, code: status === 401 ? 'UNAUTHORIZED' : 'PLANNER_ERROR', message: error.message })
  console.error('Financial planner request failed.', error?.message || error)
  return res.status(502).json({ success: false, code: 'PLANNER_UNAVAILABLE', message: fallback })
}

function reportError(res, error, fallback = 'Report generation failed.') {
  const status = Number.isInteger(error?.status) ? error.status : 502
  if (error?.code === '42P01' || /relation .*financial_planning_/i.test(error?.message || '')) {
    return res.status(503).json({ success: false, code: 'PLANNER_MIGRATION_MISSING', message: 'The Financial Planner data is not available in the development database. Apply the Phase 6 testing migration, then retry this report.' })
  }
  if ([400, 401, 404, 503].includes(status)) return res.status(status).json({ success: false, code: status === 401 ? 'UNAUTHORIZED' : 'REPORT_ERROR', message: error.message })
  console.error(`[reports] errorType=${error?.name || 'Error'} message=${truncateLog(error?.message, 240)}`)
  return res.status(502).json({ success: false, code: 'REPORT_UNAVAILABLE', message: fallback })
}

function sendReport(res, report, format = 'json') {
  const normalized = String(format || 'json').toLowerCase()
  if (normalized === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(report.title)}.csv"`)
    return res.send(reportCsv(report))
  }
  if (normalized === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(report.title)}.pdf"`)
    return res.send(buildSimplePdf(report))
  }
  return res.json({ success: true, report })
}

async function loadAuthorizedPortfolioReport(req, portfolioId) {
  if (!/^[0-9a-f-]{36}$/i.test(portfolioId)) throw Object.assign(new Error('A valid portfolio ID is required.'), { status: 400 })
  const { client, user } = await getAuthorizedPortfolioClient(req)
  const { data: portfolio, error: portfolioError } = await client.from('portfolios').select('id,user_id,name,base_currency').eq('id', portfolioId).eq('user_id', user.id).maybeSingle()
  if (portfolioError) throw portfolioError
  if (!portfolio) throw Object.assign(new Error('Portfolio not found.'), { status: 404 })
  const [{ data: holdings, error: holdingsError }, { data: transactions, error: transactionsError }] = await Promise.all([
    client.from('portfolio_holdings').select('symbol,currency,quantity,average_purchase_price,realized_pnl').eq('portfolio_id', portfolioId).order('symbol'),
    client.from('portfolio_transactions').select('id,symbol,exchange,currency,transaction_type,quantity,unit_price,executed_at,created_at,fees').eq('portfolio_id', portfolioId).order('executed_at', { ascending: true }).limit(5000),
  ])
  if (holdingsError) throw holdingsError
  if (transactionsError) throw transactionsError
  const quoteEntries = await Promise.all((holdings || []).filter((holding) => Number(holding.quantity) > 0).map(async (holding) => {
    try {
      const quote = await yahooFinance.quote(`${String(holding.symbol).toUpperCase()}.NS`)
      return [holding.symbol, { price: quote?.regularMarketPrice, currency: quote?.currency, timestamp: quote?.regularMarketTime || null }]
    } catch { return [holding.symbol, null] }
  }))
  return { user, report: buildPortfolioReport({ portfolio, holdings: holdings || [], transactions: transactions || [], quotes: Object.fromEntries(quoteEntries) }) }
}

app.get('/api/reports/portfolios', async (req, res) => {
  try {
    const { client, user } = await getAuthorizedPortfolioClient(req)
    const { data, error } = await client.from('portfolios').select('id,name,base_currency,created_at').eq('user_id', user.id).order('created_at', { ascending: false })
    if (error) throw error
    return res.json({ success: true, portfolios: data || [] })
  } catch (error) { return reportError(res, error, 'Unable to load your portfolios.') }
})

app.all('/api/reports/portfolio/:portfolioId', async (req, res) => {
  try {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ success: false, code: 'METHOD_NOT_ALLOWED', message: 'Unsupported report method.' })
    const { report } = await loadAuthorizedPortfolioReport(req, String(req.params.portfolioId || '').trim())
    return sendReport(res, report, req.query.format || req.body?.format)
  } catch (error) { return reportError(res, error, 'Unable to generate the portfolio report.') }
})

app.all('/api/reports/stock/:symbol', async (req, res) => {
  try {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ success: false, code: 'METHOD_NOT_ALLOWED', message: 'Unsupported report method.' })
    const symbol = normalizeNseSymbol(req.params.symbol || '')
    if (!symbol) throw Object.assign(new Error('A valid NSE symbol is required.'), { status: 400 })
    const cached = await runRagCommand(['stocks', '--symbols', symbol, '--cached-only'], { timeout: 60000 })
    const cachedItem = Array.isArray(cached) ? cached[0] : cached?.items?.[0] || cached?.[symbol]
    let intelligence = cachedItem?.document || (cachedItem?.found === false ? null : cachedItem) || null
    if (!intelligence) {
      const fresh = await runRagCommand(['stock', symbol], { timeout: 300000 })
      intelligence = fresh?.document || fresh || null
    }
    if (!intelligence) throw Object.assign(new Error('No stock intelligence is available for this symbol.'), { status: 404 })
    return sendReport(res, buildStockReport({ symbol, intelligence }), req.query.format || req.body?.format)
  } catch (error) { return reportError(res, error, 'Unable to generate the stock report.') }
})

app.all('/api/reports/financial-future', async (req, res) => {
  try {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ success: false, code: 'METHOD_NOT_ALLOWED', message: 'Unsupported report method.' })
    const { client, user } = await getAuthorizedPortfolioClient(req)
    const data = await loadPlannerData(client, user.id)
    const analysis = calculatePlanner(data)
    return sendReport(res, buildFinancialReport({ data, analysis }), req.query.format || req.body?.format)
  } catch (error) { return reportError(res, error, 'Unable to generate the financial future report.') }
})

async function loadPlannerData(client, userId) {
  const [profileResult, cashflowResult, assetResult, goalResult] = await Promise.all([
    client.from('financial_planning_profiles').select('*').eq('user_id', userId).maybeSingle(),
    client.from('financial_planning_cashflows').select('*').eq('user_id', userId).order('effective_date', { ascending: false }),
    client.from('financial_planning_assets').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    client.from('financial_planning_goals').select('*').eq('user_id', userId).order('target_date', { ascending: true }),
  ])
  for (const result of [profileResult, cashflowResult, assetResult, goalResult]) if (result.error) throw result.error
  const profile = profileResult.data || { currency: 'INR', emergency_months: 3, expected_return_percent: 8, inflation_percent: 6 }
  const assets = assetResult.data || []
  const linkedIds = [...new Set(assets.map((item) => item.linked_portfolio_id).filter(Boolean))]
  const linkedAssets = []
  const linkedCoverage = []
  for (const portfolioId of linkedIds) {
    const { data: portfolio, error: portfolioError } = await client.from('portfolios').select('id,base_currency').eq('id', portfolioId).eq('user_id', userId).maybeSingle()
    if (portfolioError) throw portfolioError
    if (!portfolio) continue
    const { data: holdings, error: holdingsError } = await client.from('portfolio_holdings').select('symbol,quantity,currency').eq('portfolio_id', portfolioId)
    if (holdingsError) throw holdingsError
    const active = (holdings || []).filter((holding) => Number(holding.quantity) > 0)
    const quotes = await Promise.all(active.map(async (holding) => {
      try {
        const quote = await yahooFinance.quote(`${String(holding.symbol).toUpperCase()}.NS`)
        const value = Number(holding.quantity) * Number(quote?.regularMarketPrice)
        return Number.isFinite(value) && value >= 0 && String(quote?.currency || portfolio.base_currency || 'INR').toUpperCase() === String(portfolio.base_currency || 'INR').toUpperCase() ? value : null
      } catch { return null }
    }))
    const valid = quotes.filter((value) => value !== null)
    const total = valid.reduce((sum, value) => sum + value, 0)
    linkedCoverage.push({ portfolioId, eligibleHoldings: valid.length, totalHoldings: active.length, complete: valid.length === active.length, currency: portfolio.base_currency || 'INR' })
    if (valid.length) linkedAssets.push({ kind: 'linked_portfolio', name: `Linked portfolio ${portfolioId.slice(0, 8)}`, current_value: total, currency: portfolio.base_currency || 'INR', is_estimated: false, is_liquid: false })
  }
  const standaloneAssets = assets.filter((item) => !item.linked_portfolio_id)
  return { profile, cashflows: cashflowResult.data || [], assets: [...standaloneAssets, ...linkedAssets], goals: goalResult.data || [], linkedCoverage }
}

app.get('/api/financial-planner', async (req, res) => {
  try {
    const { client, user } = await getAuthorizedPortfolioClient(req)
    const data = await loadPlannerData(client, user.id)
    return res.json({ success: true, ...data, analysis: calculatePlanner(data) })
  } catch (error) { return plannerError(res, error, 'Unable to load the financial planner.') }
})

app.post('/api/financial-planner/scenarios', async (req, res) => {
  try {
    const { client, user } = await getAuthorizedPortfolioClient(req)
    const data = await loadPlannerData(client, user.id)
    const scenarios = Array.isArray(req.body?.scenarios) ? req.body.scenarios : [
      { name: 'Conservative', overrides: { expected_return_percent: 4 } },
      { name: 'Moderate', overrides: {} },
      { name: 'Optimistic', overrides: { expected_return_percent: 10 } },
    ]
    return res.json({ success: true, scenarios: compareScenarios(data, scenarios) })
  } catch (error) { return plannerError(res, error, 'Unable to compare financial scenarios.') }
})

app.post('/api/financial-planner/explain', async (req, res) => {
  try {
    const { client, user } = await getAuthorizedPortfolioClient(req)
    const data = await loadPlannerData(client, user.id)
    const analysis = calculatePlanner(data)
    const fallback = buildPlannerExplanation(analysis)
    if (!process.env.GEMINI_API_KEY && !process.env.LLM_API_KEY) return res.json({ success: true, provider: 'deterministic_fallback', answer: fallback })
    try {
      const facts = { cashFlow: analysis.cashFlow, projection: { endingNominal: analysis.projection.endingNominal, endingReal: analysis.projection.endingReal }, goals: analysis.goals, alerts: analysis.alerts, methodology: analysis.methodology }
      const result = await runRagCommand(['portfolio', '--query', 'Explain this financial plan using only the verified calculated facts supplied below. Do not change or invent any numbers. Use short headings: Current position, Main takeaways, Uncertainty, and Disclaimer. Do not give buy or sell instructions.', '--facts', JSON.stringify({ portfolio: { name: 'Financial Planner' }, computed: facts })], { timeout: 120000 })
      const answer = sanitizeAiText(result?.response)
      if (answer && result?.provider !== 'fallback' && result?.provider !== 'deterministic') return res.json({ success: true, provider: sanitizeAiText(result.provider, 80), answer })
    } catch (aiError) { console.warn(`[planner] explanation fallback errorType=${aiError?.name || 'Error'}`) }
    return res.json({ success: true, provider: 'deterministic_fallback', answer: fallback })
  } catch (error) { return plannerError(res, error, 'Unable to explain the financial plan.') }
})

app.put('/api/financial-planner/profile', async (req, res) => {
  try {
    const { client, user } = await getAuthorizedPortfolioClient(req)
    const body = req.body || {}
    const profile = {
      user_id: user.id,
      currency: String(body.currency || 'INR').toUpperCase(),
      age: body.age === '' || body.age == null ? null : Number(body.age),
      retirement_age: body.retirement_age === '' || body.retirement_age == null ? null : Number(body.retirement_age),
      monthly_take_home: Number(body.monthly_take_home || 0),
      essential_monthly_expenses: Number(body.essential_monthly_expenses || 0),
      monthly_debt_payments: Number(body.monthly_debt_payments || 0),
      emergency_months: Number(body.emergency_months ?? 3),
      expected_return_percent: Number(body.expected_return_percent ?? 8),
      inflation_percent: Number(body.inflation_percent ?? 6),
    }
    if (![profile.monthly_take_home, profile.essential_monthly_expenses, profile.monthly_debt_payments, profile.emergency_months, profile.expected_return_percent, profile.inflation_percent].every(Number.isFinite)) throw Object.assign(new Error('Profile values must be finite numbers.'), { status: 400 })
    const { data, error } = await client.from('financial_planning_profiles').upsert(profile, { onConflict: 'user_id' }).select('*').single()
    if (error) throw error
    return res.json({ success: true, profile: data })
  } catch (error) { return plannerError(res, error, 'Unable to save the financial profile.') }
})

app.post('/api/financial-planner/records', async (req, res) => {
  try {
    const { client, user } = await getAuthorizedPortfolioClient(req)
    const body = req.body || {}
    const type = String(body.type || '')
    const table = type === 'cashflow' ? 'financial_planning_cashflows' : type === 'asset' ? 'financial_planning_assets' : type === 'goal' ? 'financial_planning_goals' : null
    if (!table) throw Object.assign(new Error('Record type must be cashflow, asset, or goal.'), { status: 400 })
    const record = { ...(body.record || {}), user_id: user.id }
    delete record.id
    const { data, error } = await client.from(table).insert(record).select('*').single()
    if (error) throw error
    return res.status(201).json({ success: true, type, record: data })
  } catch (error) { return plannerError(res, error, 'Unable to save the planning record.') }
})

const plannerRecordTables = { cashflow: 'financial_planning_cashflows', asset: 'financial_planning_assets', goal: 'financial_planning_goals' }

app.put('/api/financial-planner/records/:type/:id', async (req, res) => {
  try {
    const { client, user } = await getAuthorizedPortfolioClient(req)
    const table = plannerRecordTables[String(req.params.type || '')]
    if (!table || !/^[0-9a-f-]{36}$/i.test(req.params.id || '')) throw Object.assign(new Error('A valid planning record type and ID are required.'), { status: 400 })
    const updates = { ...(req.body || {}) }
    delete updates.id; delete updates.user_id; delete updates.created_at; delete updates.updated_at
    const { data, error } = await client.from(table).update(updates).eq('id', req.params.id).eq('user_id', user.id).select('*').maybeSingle()
    if (error) throw error
    if (!data) throw Object.assign(new Error('Planning record not found.'), { status: 404 })
    return res.json({ success: true, type: req.params.type, record: data })
  } catch (error) { return plannerError(res, error, 'Unable to update the planning record.') }
})

app.delete('/api/financial-planner/records/:type/:id', async (req, res) => {
  try {
    const { client, user } = await getAuthorizedPortfolioClient(req)
    const table = plannerRecordTables[String(req.params.type || '')]
    if (!table || !/^[0-9a-f-]{36}$/i.test(req.params.id || '')) throw Object.assign(new Error('A valid planning record type and ID are required.'), { status: 400 })
    const { data, error } = await client.from(table).delete().eq('id', req.params.id).eq('user_id', user.id).select('id').maybeSingle()
    if (error) throw error
    if (!data) throw Object.assign(new Error('Planning record not found.'), { status: 404 })
    return res.json({ success: true, type: req.params.type, deleted: data.id })
  } catch (error) { return plannerError(res, error, 'Unable to delete the planning record.') }
})

app.delete('/api/financial-planner/profile', async (req, res) => {
  try {
    const { client, user } = await getAuthorizedPortfolioClient(req)
    const { error } = await client.from('financial_planning_profiles').delete().eq('user_id', user.id)
    if (error) throw error
    return res.json({ success: true, deleted: true })
  } catch (error) { return plannerError(res, error, 'Unable to delete the financial profile.') }
})

app.post('/api/financial-planner/life-event', async (req, res) => {
  try {
    const { client, user } = await getAuthorizedPortfolioClient(req)
    const data = await loadPlannerData(client, user.id)
    return res.json({ success: true, result: simulateLifeEvent(data, req.body?.event || {}) })
  } catch (error) { return plannerError(res, error, 'Unable to simulate the life event.') }
})

app.post('/api/financial-planner/financial-independence', async (req, res) => {
  try {
    const { client, user } = await getAuthorizedPortfolioClient(req)
    const data = await loadPlannerData(client, user.id)
    return res.json({ success: true, result: calculateFinancialIndependence(data, req.body || {}) })
  } catch (error) { return plannerError(res, error, 'Unable to calculate financial independence.') }
})

async function loadCachedRippleMetadata(symbols) {
  const uniqueSymbols = [...new Set((symbols || []).map((symbol) => normalizeNseSymbol(symbol)).filter(Boolean))]
  if (!uniqueSymbols.length) return []
  try {
    const result = await runRagCommand(
      ['stocks', '--symbols', uniqueSymbols.join(','), '--skip-news', '--cached-only'],
      { timeout: 60000 },
    )
    let items = Array.isArray(result) ? result : result?.items
    if (!(items || []).some((item) => item?.document?.market?.sector || item?.market?.sector)) {
      const freshResult = await runRagCommand(
        ['stocks', '--symbols', uniqueSymbols.join(','), '--skip-news'],
        { timeout: 180000 },
      )
      items = Array.isArray(freshResult) ? freshResult : freshResult?.items
    }
    return (items || []).map((item) => {
      const document = item?.document || item || {}
      return {
        symbol: normalizeNseSymbol(document.base_symbol || document.symbol || item.symbol),
        sector: document.market?.sector || null,
      }
    })
  } catch (error) {
    console.warn(`[ripple] cached metadata unavailable symbols=${uniqueSymbols.length} errorType=${error?.name || 'Error'}`)
    return []
  }
}

function readRippleJson(fileName) {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, 'data', 'economic', fileName), 'utf8'))
  } catch {
    return null
  }
}

function latestEconomicObservation(rows = []) {
  const valid = rows.filter((row) => row?.date && Number.isFinite(Number(row.value))).sort((left, right) => left.date.localeCompare(right.date))
  if (!valid.length) return null
  const latest = valid[valid.length - 1]
  const previous = valid.length > 1 ? valid[valid.length - 2] : null
  return {
    value: Number(latest.value),
    unit: latest.unit,
    date: latest.date,
    source: latest.source,
    sourceUrl: latest.sourceUrl,
    retrievalTimestamp: latest.retrievalTimestamp,
    trend: previous ? (Number(latest.value) > Number(previous.value) ? 'up' : Number(latest.value) < Number(previous.value) ? 'down' : 'flat') : 'unavailable',
  }
}

app.get('/api/ripple/macro-briefing', async (req, res) => {
  const snapshot = readRippleJson('normalized-observations.json')
  const market = readRippleJson('market-series.json')
  let observations = snapshot?.observations || []
  if (Date.now() >= macroLiveCache.expiresAt) {
    try {
      macroLiveCache = { expiresAt: Date.now() + 15 * 60 * 1000, observations: await loadCurrentMacroData() }
    } catch (error) {
      macroLiveCache = { expiresAt: Date.now() + 60 * 1000, observations: [] }
      console.warn(`[ripple] live macro refresh unavailable errorType=${error?.name || 'Error'}`)
    }
  }
  const liveByVariable = new Map(macroLiveCache.observations.map((row) => [row.variable, row]))
  observations = observations.map((row) => liveByVariable.has(row.variable) ? liveByVariable.get(row.variable) : row)
  for (const row of macroLiveCache.observations) if (!observations.some((item) => item.variable === row.variable)) observations.push(row)
  const levels = market?.series || {}
  const find = (variable) => latestEconomicObservation(observations.filter((row) => row.variable === variable))
  const findMarket = (symbol) => latestEconomicObservation(levels[symbol]?.rows || [])
  return res.json({
    success: true,
    retrievedAt: snapshot?.retrievedAt || market?.retrievedAt || null,
    indicators: [
      { key: 'repo_rate', label: 'RBI repo rate', status: liveByVariable.has('repo_rate') ? 'available' : find('repo_rate') ? 'historical_only' : 'unavailable', ...find('repo_rate'), unit: 'percentage points', explanation: 'The policy rate influences borrowing costs and liquidity across the Indian economy.', reason: 'No verified RBI repo-rate observation is available from the live source or local snapshot.' },
      { key: 'cpi_inflation', label: 'CPI inflation', status: liveByVariable.has('cpi_inflation') ? 'available' : find('cpi_inflation') ? 'historical_only' : 'unavailable', ...find('cpi_inflation'), unit: 'percentage points', explanation: 'Consumer inflation affects household demand, input costs, and interest-rate expectations.', reason: 'No verified CPI observation is available from the official release or local snapshot.' },
      { key: 'usd_inr', label: 'USD/INR exchange rate', status: findMarket('INR=X') ? 'historical_only' : 'unavailable', ...findMarket('INR=X'), unit: 'INR per USD', explanation: 'A higher USD/INR value means rupee depreciation; exporters and importers can respond differently.' },
      { key: 'crude_oil', label: 'Brent crude oil', status: findMarket('BZ=F') ? 'historical_only' : 'unavailable', ...findMarket('BZ=F'), unit: 'USD per barrel', explanation: 'Oil prices can affect transport, input costs, inflation, and external balances.' },
      { key: 'gdp_growth', label: 'India real GDP growth', status: find('gdp_growth') ? 'historical_only' : 'unavailable', ...find('gdp_growth'), explanation: 'GDP growth provides broad context for demand and business activity.' },
      { key: 'bond_yield', label: 'Government bond yield', status: liveByVariable.has('bond_yield') ? 'available' : find('bond_yield') ? 'historical_only' : 'unavailable', ...find('bond_yield'), unit: 'percent', explanation: 'Yields affect financing conditions and the discount rate applied to future cash flows.', reason: 'No verified CCIL government-security yield is available from the live source or local snapshot.' },
    ],
    supportedSectors: Object.keys(SECTOR_COEFFICIENTS),
    macroNews: { status: 'unavailable', message: 'No dedicated macroeconomic news feed is configured. Historical source observations are shown without fabricated headlines.' },
  })
})

app.post('/api/ripple/simulate', async (req, res) => {
  try {
    const body = req.body || {}
    const result = simulateRipple({ shocks: body.shocks, sectors: body.sectors })
    const target = body.target || {}
    const targetType = String(target.type || 'sectors').toLowerCase()

    if (targetType === 'stock') {
      const symbols = Array.isArray(target.symbols) ? target.symbols.slice(0, 25) : []
      const metadata = await loadCachedRippleMetadata(symbols)
      return res.json({ success: true, ...applyStockImpacts(result, metadata), coverage: { requestedStocks: symbols.length, metadataRecords: metadata.length } })
    }

    if (targetType !== 'portfolio') return res.json({ success: true, ...result })

    const portfolioId = String(target.portfolioId || '').trim()
    if (!/^[0-9a-f-]{36}$/i.test(portfolioId)) {
      return res.status(400).json({ success: false, code: 'INVALID_PORTFOLIO_ID', message: 'A valid portfolio ID is required for portfolio simulation.' })
    }
    const { client, user } = await getAuthorizedPortfolioClient(req)
    const { data: portfolio, error: portfolioError } = await client
      .from('portfolios')
      .select('id, user_id, name, base_currency')
      .eq('id', portfolioId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (portfolioError) throw portfolioError
    if (!portfolio) return res.status(404).json({ success: false, code: 'PORTFOLIO_NOT_FOUND', message: 'Portfolio not found.' })

    const { data: holdings, error: holdingsError } = await client
      .from('portfolio_holdings')
      .select('symbol, currency, quantity')
      .eq('portfolio_id', portfolioId)
    if (holdingsError) throw holdingsError

    const activeHoldings = (holdings || []).filter((holding) => Number(holding.quantity) > 0)
    const symbols = [...new Set(activeHoldings.map((holding) => holding.symbol))]
    const [metadata, ...quoteResults] = await Promise.all([
      loadCachedRippleMetadata(symbols),
      ...symbols.map(async (symbol) => {
        try {
          const quote = await yahooFinance.quote(`${symbol}.NS`)
          return [symbol, { price: quote?.regularMarketPrice, currency: quote?.currency || 'INR', timestamp: quote?.regularMarketTime || null }]
        } catch {
          return [symbol, null]
        }
      }),
    ])
    const quotes = Object.fromEntries(quoteResults)
    const withStocks = applyStockImpacts(result, metadata)
    return res.json({ success: true, portfolio: { id: portfolio.id, name: portfolio.name, baseCurrency: portfolio.base_currency }, ...applyPortfolioImpacts(withStocks, activeHoldings, quotes, portfolio.base_currency) })
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 400
    if (status === 401 || status === 404 || status === 400 || status === 503) return res.status(status).json({ success: false, code: status === 401 ? 'UNAUTHORIZED' : 'RIPPLE_REQUEST_INVALID', message: error.message })
    console.error(`[ripple] simulation failed errorType=${error?.name || 'Error'} message=${truncateLog(error?.message, 300)}`)
    return res.status(502).json({ success: false, code: 'RIPPLE_UNAVAILABLE', message: 'Economic ripple simulation is temporarily unavailable.' })
  }
})

app.post('/api/ripple/explain', async (req, res) => {
  try {
    const body = req.body || {}
    const portfolioId = String(body.portfolioId || '').trim()
    if (portfolioId) {
      const { client, user } = await getAuthorizedPortfolioClient(req)
      const { data: portfolio, error } = await client.from('portfolios').select('id').eq('id', portfolioId).eq('user_id', user.id).maybeSingle()
      if (error) throw error
      if (!portfolio) return res.status(404).json({ success: false, code: 'PORTFOLIO_NOT_FOUND', message: 'Portfolio not found.' })
    }
    const facts = { scenario: body.scenario || {}, sectorImpacts: body.sectorImpacts || [], stockImpacts: body.stockImpacts || [], portfolio: body.portfolio || {}, assumptions: body.assumptions || [], limitations: body.limitations || [] }
    const result = await runRagCommand(['portfolio', '--query', 'Explain this deterministic economic ripple scenario without changing any numbers.', '--facts', JSON.stringify({ portfolio: { name: 'Economic Ripple Scenario' }, computed: facts })], { timeout: 120000 })
    const providerUnavailable = result?.provider === 'fallback' || result?.provider === 'deterministic'
    const shocks = Array.isArray(facts.scenario?.shocks) ? facts.scenario.shocks : []
    const stockImpacts = Array.isArray(facts.stockImpacts) ? facts.stockImpacts.filter((item) => item?.modeledImpactPct !== null && item?.modeledImpactPct !== undefined && Number.isFinite(Number(item.modeledImpactPct))) : []
    const sectorImpacts = Array.isArray(facts.sectorImpacts) ? facts.sectorImpacts.filter((item) => item?.modeledImpactPct !== null && item?.modeledImpactPct !== undefined && Number.isFinite(Number(item.modeledImpactPct))) : []
    const impacts = stockImpacts.length ? stockImpacts : sectorImpacts
    const strongest = [...impacts].sort((left, right) => Math.abs(Number(right.modeledImpactPct)) - Math.abs(Number(left.modeledImpactPct)))[0]
    const shockText = shocks.map((item) => `${item.label || item.key}: ${item.shock} ${item.shockLabel || ''}`.trim()).join(', ')
    const deterministicAnswer = [
      `Scenario: ${shockText || 'No shock details were supplied.'}`,
      strongest
        ? `Modeled stock impact: ${strongest.symbol || 'Selected stock'}${strongest.sector ? ` (${strongest.sector})` : ''} is estimated at ${Number(strongest.modeledImpactPct).toLocaleString('en-IN', { maximumFractionDigits: 2 })}% under the configured economic transmission assumptions.`
        : 'Modeled stock impact is unavailable because no numeric stock or sector result was returned.',
      strongest?.modeledImpactPct < 0
        ? 'Interpretation: the selected macroeconomic changes create modeled pressure for this stock through its classified sector. This is a sensitivity result, not an observed price move or a forecast.'
        : strongest
          ? 'Interpretation: the selected macroeconomic changes create modeled support for this stock through its classified sector. This is a sensitivity result, not an observed price move or a forecast.'
          : 'Interpretation: no supported relationship was available for a reliable directional explanation.',
      `Limitations: ${facts.limitations?.join(' ') || 'Coefficients are illustrative, and company-specific effects are not modeled.'}`,
    ].join('\n\n')
    const answer = providerUnavailable ? deterministicAnswer : sanitizeAiText(result?.response || result?.answer)
    if (!answer) return res.status(503).json({ success: false, code: 'AI_UNAVAILABLE', message: 'AI explanation is unavailable. The deterministic simulation remains available.' })
    return res.json({ success: true, answer, provider: sanitizeAiText(result.provider || 'deterministic', 80), model: sanitizeAiText(result.model, 120), fallback: result?.provider === 'fallback' || result?.provider === 'deterministic' })
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502
    if (status === 401 || status === 404 || status === 400 || status === 503) return res.status(status).json({ success: false, code: status === 401 ? 'UNAUTHORIZED' : 'AI_UNAVAILABLE', message: error.message })
    console.error(`[ripple] explanation failed errorType=${error?.name || 'Error'} message=${truncateLog(error?.message, 300)}`)
    return res.status(502).json({ success: false, code: 'AI_PROVIDER_ERROR', message: 'AI explanation is temporarily unavailable.' })
  }
})

app.get('/api/stock/:symbol', async (req, res) => {
  try {
    const normalizedSymbol = normalizeNseSymbol(req.params.symbol || '')

    if (!normalizedSymbol) {
      return res.status(400).json({ message: 'Stock symbol is required.' })
    }

    const yahooSymbol = `${normalizedSymbol}.NS`
    const cacheKey = `quote:${yahooSymbol}`
    const cached = getCachedMarketResponse(cacheKey)
    if (cached) {
      return res.json(cached)
    }
    const data = await yahooFinance.quote(yahooSymbol)

    if (!data || !Number.isFinite(data.regularMarketPrice)) {
      return res.status(404).json({ message: 'Stock not found.' })
    }

    const payload = {
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
    }
    setCachedMarketResponse(cacheKey, payload, 10 * 1000)
    return res.json(payload)
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
    const cacheKey = `chart:${yahooSymbol}:${range}:${interval}`
    const cached = getCachedMarketResponse(cacheKey)
    if (cached) {
      return res.json(cached)
    }

    const data = await yahooFinance.chart(yahooSymbol, {
      period1,
      period2,
      interval,
    })

    const result = Array.isArray(data?.quotes) ? normalizeChartQuotes(data.quotes) : []

    const payload = {
      symbol: normalizedSymbol,
      interval,
      range,
      points: result,
    }
    setCachedMarketResponse(cacheKey, payload, 30 * 1000)
    return res.json(payload)
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

nseSymbolsCache = loadNseSymbolsFromDisk()
if (nseSymbolsCache.length) {
  nseSymbolsSource = 'local-cache'
  try {
    nseSymbolsFetchedAt = fs.statSync(nseSymbolsCachePath).mtimeMs
    nseSymbolsStale = Date.now() - nseSymbolsFetchedAt > nseSymbolsRefreshMs
  } catch {
    nseSymbolsFetchedAt = 0
    nseSymbolsStale = true
  }
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
  // Keep startup and the first stock-board render local and fast. The remote
  // directory is refreshed afterwards without blocking requests.
  ensureNseSymbolsLoaded().catch((error) => {
    console.warn('Unable to refresh the NSE symbol directory.', error.message)
  })
})
