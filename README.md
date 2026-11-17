# FinSense AI

FinSense AI is a stock and personal-finance intelligence application for Indian-market research. It combines a React/Vite client, an Express API, Supabase authentication and persistence, and a Python market/RAG layer.

The application is designed to keep calculations and retrieved evidence separate from interpretation. Missing market, news or macroeconomic data is reported as unavailable rather than replaced with fabricated values.

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
