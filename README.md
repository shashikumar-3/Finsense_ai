# FinSense AI

FinSense AI is a stock and personal-finance intelligence application for Indian-market research. It combines a React/Vite client, an Express API, Supabase authentication and persistence, and a Python market/RAG layer.

The application is designed to keep calculations and retrieved evidence separate from interpretation. Missing market, news or macroeconomic data is reported as unavailable rather than replaced with fabricated values.

## About the project

FinSense AI is a decision-support platform for investors who want one place to understand their stocks, portfolio behavior and long-term financial plans. It combines deterministic financial calculations with evidence-grounded AI explanations so that users can explore market information without confusing a model interpretation with a verified financial fact.

The project is built for the Indian market. Stock symbols are normalized for NSE usage, financial values are displayed in Indian rupees, and the application supports Indian-focused portfolio accounting, news retrieval, macroeconomic scenarios and Supabase-backed user data.

### What problem it solves

Investment information is usually spread across price data, financial statements, news feeds, transaction records and personal goals. FinSense AI brings these sources together and gives them separate, traceable roles:

- Market data describes observed prices, volume and technical indicators.
- Company data describes available fundamentals, statements and business metadata.
- News data provides dated headlines, publishers, article links and sentiment when usable articles are available.
- Portfolio data records the user's authenticated transactions and calculates holdings, cost basis and P&L.
- Planning data models savings, goals, inflation and future-wealth scenarios.
- AI explains retrieved evidence but does not replace missing values or alter financial calculations.

The result is intended to help users ask better questions, identify data limitations, compare evidence and understand the trade-offs in a decision. It is not an automated trading system, a return guarantee or personalized financial advice.

## Product architecture

FinSense AI uses a layered architecture:

1. The React/Vite client provides the dashboard, stock detail, portfolio, behavior, insights, planner, reports and profile experiences.
2. The Express server owns authenticated API routes, validation, portfolio calculations, report generation and orchestration between the client and data services.
3. Supabase provides authentication, PostgreSQL persistence and row-level security for user-owned records.
4. The Python layer retrieves and normalizes market data, company fundamentals, technical indicators and news, and provides the existing RAG/FinRobot integration.
5. External providers supply market, news, macroeconomic and optional LLM data. Provider failures are represented explicitly so the UI can distinguish unavailable data from a real zero value.

The important design boundary is that deterministic services produce the financial facts and scores first. AI is used for conversational explanation, summaries and contextual interpretation of those facts. An AI response must not invent a headline, metric, price, sector, article body or macroeconomic observation.

## Main modules

### Authentication and profile preferences

Users can sign up, sign in, use Google OAuth where configured, restore sessions and access protected pages. Profile preferences control supported experience features such as dark mode, dashboard density, motion, behavior alerts, macro scenarios and trading warnings. Preferences are persisted per authenticated user through the existing Supabase flow.

### Stock intelligence

The Stocks area lets users search supported stocks and inspect company identity, sector and industry metadata, valuation, profitability, financial health, growth, statements, price history and technical indicators. The stock-strength view combines available fundamentals, technicals, news and observable attention signals with explicit evidence coverage. Missing components are not silently treated as zero.

### Conversational stock analyst

The Stock Detail analyst is a stock-specialized, multi-turn assistant. It keeps the selected symbol and bounded conversation context, identifies the user's question, retrieves relevant evidence and answers in a structured format. Follow-up questions such as “explain the first article,” “what about its debt?” or “can it move 3%?” are resolved against the current conversation and selected stock.

News answers use actual normalized articles when available, including headline, publisher, publication time, provider and URL. NewsAPI is used when available and Google News RSS is the configured fallback. HTTP 429 responses trigger cooldown-aware behavior instead of repeated quota-consuming retries. If only a headline is available, the assistant says that the article body could not be verified.

### News and sentiment

The news pipeline fetches company-relevant articles, normalizes timestamps, removes duplicates, validates freshness, ranks newest articles first and calculates sentiment only from eligible usable articles. The UI shows provider and coverage information and distinguishes current, historical, stale and unavailable news. A provider failure does not break the rest of stock intelligence.

### Portfolio intelligence

Users can create portfolios and record buys and sells. The server-side accounting engine matches sales against acquisition lots using FIFO, calculates remaining quantity and cost basis, realized and unrealized P&L, market value and configurable estimated tax. Current quotes are required for current valuation; transaction prices are never substituted for live market prices.

Portfolio views include holdings, concentration, sector allocation, transaction history, portfolio reports and grounded AI insights. Sector allocation uses verified stock metadata and keeps an explicit Unknown category when metadata cannot be obtained. AI portfolio insights explain concentration, diversification and risk context from computed portfolio facts, while deterministic analysis remains available if an external LLM is unavailable.

### Behavior analyzer

The Behavior module examines authenticated transaction history for evidence-based patterns such as completed buy/sell episodes, holding behavior and risk indicators. Concentration uses compatible current quotes and displays coverage limitations when some holdings cannot be valued. The module is educational analysis, not a diagnosis of the user's personality or a personalized instruction to trade.

### Economic Ripple Simulator

Insights provides hypothetical sensitivity scenarios for supported macroeconomic variables such as RBI repo rate, CPI inflation, USD/INR, crude oil, GDP growth and government bond yields. The simulator applies configured sector-variable coefficients to a selected stock or requested portfolio and renders modeled stock and sector impacts.

The current `ripple-heuristic-v1` model is explicitly illustrative. Its outputs are sensitivity estimates rather than forecasts or price targets. Stored economic observations include their source and timestamp; unavailable live baselines are not replaced by hardcoded “current” values. The AI explanation describes which shock affected which configured sector relationship and preserves the model's limitations.

### Financial Planner

The planner stores a user's profile, income, expenses, assets and goals. It calculates monthly surplus, contributions, compound projections, inflation-adjusted purchasing power, emergency-fund status, goal gaps and life-event effects. The chart separates nominal wealth from today's purchasing power, and explanations identify assumptions such as annual return, inflation and projection horizon. These are estimates, not guarantees.

### Reports and exports

Reports reuse server-side portfolio, stock and planner calculations. They provide structured report data and export paths for PDF and CSV. Reports are authorized against the authenticated user, preserve missing-data states and avoid trusting client-supplied financial totals.

## Typical data flow

For a stock question, the flow is:

`user question → selected stock context → intent identification → relevant provider/RAG retrieval → freshness and availability validation → grounded evidence context → AI or deterministic explanation → sources and limitations`

For a portfolio calculation, the flow is:

`authenticated transactions → server-side validation → FIFO/accounting engine → verified quote and metadata lookup → portfolio metrics → UI, report or grounded explanation`

For a macro scenario, the flow is:

`scenario inputs → validation → configured economic coefficients → stock/sector/portfolio sensitivity → chart data → limitation-aware explanation`

This separation prevents a failed news provider from erasing fundamentals, prevents an unavailable quote from becoming a fabricated market value, and prevents an AI fallback from pretending that it retrieved evidence it did not receive.

## Included capabilities

- Supabase authentication, profiles and per-user settings.
- Portfolio transactions, FIFO lots, realized/unrealized P&L and estimated tax reporting.
- Stock search, company metadata, fundamentals, technical indicators, news and sentiment.
- Context-aware stock analyst conversations with Google News fallback when NewsAPI is unavailable.
- Behavior analysis based on verified transaction history and compatible current quotes.
- Economic Ripple sensitivity scenarios with explicit illustrative-model limitations.
- Financial planning projections, goals, life events and inflation-adjusted views.
- Portfolio, stock and financial-future reports with CSV/PDF export.

## Requirements

- Git
- Node.js 20 or newer and npm
- Python 3.11 or newer
- A Supabase project for authentication and database access
- Optional provider credentials: Gemini, NewsAPI and Google OAuth. Google News RSS works as the news fallback and does not require an API key.

## Clone and install

```powershell
git clone https://github.com/shashikumar-3/Finsense_ai.git
cd Finsense_ai
npm install
Set-Location client
npm install
Set-Location ..
python -m venv Rag_model/venv
Rag_model\venv\Scripts\python.exe -m pip install --upgrade pip
Rag_model\venv\Scripts\python.exe -m pip install -r Rag_model\requirements.txt
```

The repository intentionally does not contain `.env` files, service-role keys, OAuth secrets, virtual environments, `node_modules`, Chroma runtime data or Python bytecode.

## Configuration

Copy the examples and fill them with values for your own development environment:

```powershell
Copy-Item .env.example .env
Copy-Item client/.env.example client/.env.local
```

The root environment is used by the server and Python services. The client environment may contain only browser-safe `VITE_` values. Never put a Supabase service-role key, Gemini secret or NewsAPI key in `client/.env.local`.

At minimum, configure the Supabase URL and publishable/anonymous key expected by the existing Supabase client. Add the server-side provider variables documented in `.env.example` when those features are needed. Do not commit either environment file.

Apply the SQL files in `supabase/migrations/` to a separate development or staging Supabase project using the Supabase dashboard or CLI. Do not run destructive migrations against production without reviewing them.

## Run locally

From the repository root:

```powershell
.\start-dev.ps1
```

This starts the Express API at `http://localhost:5000` and the Vite client at `http://localhost:5173`. If a port is already in use, stop only the project process or use the existing launcher safeguards; do not terminate unrelated applications.

You can also start the services separately:

```powershell
npm run server
Set-Location client
npm run dev:vite
```

## Tests and build

Run focused tests first on a low-memory development machine, then the complete suites:

```powershell
node --test server/*.test.js
Set-Location client
npx.cmd vitest run
npm.cmd run build
Set-Location ..
Rag_model\venv\Scripts\python.exe -m unittest discover -s Rag_model -p "test_*.py"
node --check server/server.js
git diff --check
```

External providers are mocked by the provider tests. Live NewsAPI access is quota-limited; Google News fallback and explicit unavailable states are part of normal operation when a provider cannot respond.

## Data and production notes

Economic snapshots committed under `data/economic/` are source-labelled datasets used for reproducible analysis. They are not automatically presented as live observations. Runtime caches and provider state remain local and are excluded where they are machine-specific.

Before deployment, configure production environment variables in the hosting platform, apply reviewed Supabase migrations, configure the allowed OAuth redirect URLs, verify provider quotas and connectivity, and run the browser QA flow for authentication, portfolio ownership, stock news, AI explanations, reports and exports.

FinSense AI provides research and educational analysis. It does not guarantee returns or replace professional financial advice.
