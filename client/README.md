# FinSense AI

Financial decision intelligence app with a React frontend, Express backend, and Python stock-intelligence pipeline.

## Run locally

```bash
npm install
npm run dev
```

Open the local Vite URL shown in the terminal.

The dev script starts:

- Backend: `http://localhost:5000`
- Frontend: `http://localhost:5173`

## Build

```bash
npm run build
```

## Notes

- Live NSE symbols, quotes, and chart data come from the backend.
- Intelligence pages use the Python market/news/RAG pipeline through Express APIs.
- `Rag_model/chroma_db` is a generated local JSON vector store, not a production database.
- Some product areas, such as reports and profile settings, still use demo data.
