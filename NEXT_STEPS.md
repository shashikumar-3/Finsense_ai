# FinSense AI Next Steps

## Current State

The project now has:

- Live market data integration
- News enrichment
- A working Python RAG pipeline
- Embedded stock intelligence storage
- Backend intelligence APIs
- Frontend pages connected to live intelligence

The remaining work is mostly product hardening, scale, and UX refinement.

## Recommended Order

1. Stabilize the intelligence refresh flow
2. Expand dashboard and stock list coverage
3. Improve ranking and relevance of news + retrieval
4. Add background refresh and caching strategy
5. Add production readiness checks

## Step 1: Stabilize Refresh Flow

Goal: make refresh reliable for daily use.

Tasks:

- Add retry handling around news fetch failures
- Add per-symbol refresh status tracking
- Add refresh timestamps in the stored document payload
- Prevent duplicate refreshes for the same symbol in parallel
- Add clear backend error messages for partial refresh failures

Suggested files:

- `Rag_model/pipeline/rag_service.py`
- `Rag_model/pipeline/build_documents.py`
- `server/server.js`

## Step 2: Expand Frontend Coverage

Goal: show structured intelligence everywhere the user expects it.

Tasks:

- Add intelligence badges/cards on the stocks listing page
- Use structured market/news summaries on dashboard cards
- Add watchlist-oriented intelligence blocks
- Show last-updated times in the UI
- Add loading and fallback states for empty news coverage

Suggested files:

- `client/src/pages/StocksPage.jsx`
- `client/src/pages/DashboardPage.jsx`
- `client/src/pages/InsightsPage.jsx`
- `client/src/pages/StockDetailPage.jsx`

## Step 3: Improve Relevance

Goal: make the RAG output sharper and less noisy.

Tasks:

- Improve symbol-to-news matching to reduce wrong-company articles
- Add source weighting for trusted financial news outlets
- Rank headlines by recency + relevance + sentiment impact
- Tune recommendation generation using both technicals and news posture
- Add query-time filtering by sector, sentiment, and signal strength

Suggested files:

- `Rag_model/pipeline/build_documents.py`
- `Rag_model/pipeline/retrieve.py`
- `Rag_model/news/news_processor.py`

## Step 4: Add Background Refresh

Goal: stop doing too much work on-demand from the UI.

Tasks:

- Add a scheduled refresh job for a selected stock universe
- Refresh market data broadly and news data selectively
- Cache popular symbols aggressively
- Refresh watchlist/dashboard symbols first
- Keep full-universe market coverage separate from news enrichment

Suggested implementation:

- Start with a Python scheduler or Windows Task Scheduler job
- Later move to a queue-based worker if needed

## Step 5: Production Hardening

Goal: make deployment and maintenance realistic.

Tasks:

- Add `.env.example` cleanup for required keys
- Add API timeout and failure handling review
- Add backend route tests for intelligence endpoints
- Add Python pipeline smoke tests for refresh/search/stock retrieval
- Add logging around refresh duration and failure counts
- Document setup and run flow in `README.md`

## Best Immediate Start

If continuing from the current repo state, start here:

1. Add refresh timestamps and status metadata to the stored intelligence documents
2. Surface that metadata in the dashboard, insights, and stock detail pages
3. Add intelligence summaries to `StocksPage.jsx`

This is the highest-value next move because it makes the current RAG system feel complete to the user before deeper infrastructure work.
