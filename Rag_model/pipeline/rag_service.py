"""Service entry points for FinSense AI RAG operations."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

try:
    from .build_documents import build_universe_documents, resolve_symbol_selection
    from .embed_store import get_store_stats, upsert_documents
    from .retrieve import get_stock, search_by_text_filters
    from ..analysis.strength_analyzer import analyze_strength
    from ..llm.finrobot_agent import generate_finrobot_response
except ImportError:
    import sys

    PIPELINE_ROOT = Path(__file__).resolve().parent
    RAG_ROOT = PIPELINE_ROOT.parent
    if str(PIPELINE_ROOT) not in sys.path:
        sys.path.insert(0, str(PIPELINE_ROOT))
    if str(RAG_ROOT) not in sys.path:
        sys.path.insert(0, str(RAG_ROOT))

    from build_documents import build_universe_documents, resolve_symbol_selection
    from embed_store import get_store_stats, upsert_documents
    from retrieve import get_stock, search_by_text_filters
    from analysis.strength_analyzer import analyze_strength
    from llm.finrobot_agent import generate_finrobot_response


def refresh_universe(
    use_all: bool = False,
    search: str = "",
    offset: int = 0,
    limit: int = 0,
    include_news: bool = True,
    skip_invalid_market: bool = False,
    force_refresh_universe: bool = False,
) -> dict[str, Any]:
    selected_symbols = resolve_symbol_selection(
        use_all=use_all,
        search=search,
        offset=offset,
        limit=limit,
        force_refresh_universe=force_refresh_universe,
    )
    documents = build_universe_documents(
        selected_symbols,
        include_news=include_news,
        skip_invalid_market=skip_invalid_market,
    )
    payload = upsert_documents(documents)
    return {
        "selected_symbols": len(selected_symbols),
        "processed_documents": len(documents),
        "store": get_store_stats(),
        "items": [
            {
                "symbol": document.get("symbol"),
                "company_name": document.get("company_name"),
                "market_valid": bool(document.get("market", {}).get("is_valid")),
                "news_valid": bool(document.get("news", {}).get("is_valid")),
            }
            for document in documents
        ],
        "store_item_count": len(payload.get("items", [])),
    }


def get_cached_stocks(
    symbols: list[str],
    include_news: bool = True,
    cached_only: bool = True,
) -> list[dict[str, Any]]:
    """Load several stock records while reusing this process's Chroma client."""
    return [
        get_stock(
            symbol,
            include_news=include_news,
            cached_only=cached_only,
        )
        for symbol in symbols
    ]


def _sanitize_json_values(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _sanitize_json_values(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_sanitize_json_values(item) for item in value]
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    return value


def _write_json(value: Any) -> None:
    print(
        json.dumps(
            _sanitize_json_values(value),
            ensure_ascii=False,
            allow_nan=False,
        )
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="FinSense AI RAG service wrapper.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    stock_parser = subparsers.add_parser("stock", help="Get one stock intelligence item.")
    stock_parser.add_argument("symbol")
    stock_parser.add_argument("--company-name", default="")
    stock_parser.add_argument("--refresh", action="store_true")
    stock_parser.add_argument("--skip-news", action="store_true")
    stock_parser.add_argument("--cached-only", action="store_true")

    strength_parser = subparsers.add_parser("strength", help="Run deterministic Hype versus Reality analysis.")
    strength_parser.add_argument("symbol")
    strength_parser.add_argument("--with-ai", action="store_true")
    strength_parser.add_argument("--query", default="Explain this strength analysis.")

    stocks_parser = subparsers.add_parser("stocks", help="Get several cached stock intelligence items.")
    stocks_parser.add_argument("--symbols", required=True, help="Comma-separated NSE symbols")
    stocks_parser.add_argument("--skip-news", action="store_true")
    stocks_parser.add_argument("--cached-only", action="store_true")

    search_parser = subparsers.add_parser("search", help="Search across stored intelligence.")
    search_parser.add_argument("--query", default="")
    search_parser.add_argument("--limit", type=int, default=10)
    search_parser.add_argument("--trend", default="")
    search_parser.add_argument("--sentiment", default="")
    search_parser.add_argument("--hype-label", default="")

    response_parser = subparsers.add_parser("respond", help="Generate a FinRobot-style LLM response.")
    response_parser.add_argument("--symbol", required=True)
    response_parser.add_argument("--query", required=True)
    response_parser.add_argument("--refresh", action="store_true")
    response_parser.add_argument("--skip-news", action="store_true")
    response_parser.add_argument("--cached-only", action="store_true")
    response_parser.add_argument("--fast", action="store_true", help="Return a local, data-grounded answer without an LLM call.")

    portfolio_parser = subparsers.add_parser("portfolio", help="Generate an explanation from validated portfolio facts.")
    portfolio_parser.add_argument("--query", required=True)
    portfolio_parser.add_argument("--facts", required=True)

    refresh_parser = subparsers.add_parser("refresh", help="Build and embed a stock batch.")
    refresh_parser.add_argument("--all", action="store_true")
    refresh_parser.add_argument("--search", default="")
    refresh_parser.add_argument("--offset", type=int, default=0)
    refresh_parser.add_argument("--limit", type=int, default=0)
    refresh_parser.add_argument("--skip-news", action="store_true")
    refresh_parser.add_argument("--skip-invalid-market", action="store_true")
    refresh_parser.add_argument("--force-refresh-universe", action="store_true")

    subparsers.add_parser("stats", help="Inspect the vector store.")

    return parser.parse_args()


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    args = parse_args()

    if args.command == "stock":
        result = get_stock(
            args.symbol,
            company_name=args.company_name,
            refresh=args.refresh,
            include_news=not args.skip_news,
            cached_only=args.cached_only,
        )
        _write_json(result)
        return

    if args.command == "strength":
        result = analyze_strength(args.symbol)
        if args.with_ai:
            document = {
                "type": "strength",
                "symbol": result.get("symbol"),
                "company_name": result.get("symbol"),
                "strength": result,
            }
            ai = generate_finrobot_response(document, args.query)
            result["ai"] = {
                "answer": ai.get("answer"),
                "provider": ai.get("provider"),
                "model": ai.get("model"),
            }
        _write_json(result)
        return

    if args.command == "stocks":
        symbols = [symbol.strip() for symbol in args.symbols.split(",") if symbol.strip()]
        if not symbols:
            raise ValueError("At least one stock symbol is required.")
        result = get_cached_stocks(
            symbols,
            include_news=not args.skip_news,
            cached_only=args.cached_only,
        )
        _write_json(result)
        return

    if args.command == "search":
        result = search_by_text_filters(
            query=args.query,
            limit=args.limit,
            trend=args.trend,
            sentiment=args.sentiment,
            hype_label=args.hype_label,
        )
        _write_json(result)
        return

    if args.command == "respond":
        item = get_stock(
            args.symbol,
            refresh=args.refresh,
            include_news=not args.skip_news,
            cached_only=args.cached_only,
        )

        document = item.get("document") or item
        result = {
            "symbol": document.get("symbol") or args.symbol,
            "document": document,
            "response": generate_finrobot_response(document, args.query, fast=args.fast),
        }
        _write_json(result)
        return

    if args.command == "portfolio":
        try:
            facts = json.loads(args.facts)
        except json.JSONDecodeError as error:
            raise ValueError("Portfolio facts must be valid JSON.") from error
        result = generate_finrobot_response(
            {"type": "portfolio", "facts": facts, "symbol": "PORTFOLIO", "company_name": "Portfolio"},
            args.query,
        )
        _write_json({"response": result["answer"], "provider": result["provider"], "model": result["model"]})
        return

    if args.command == "refresh":
        result = refresh_universe(
            use_all=args.all,
            search=args.search,
            offset=args.offset,
            limit=args.limit,
            include_news=not args.skip_news,
            skip_invalid_market=args.skip_invalid_market,
            force_refresh_universe=args.force_refresh_universe,
        )
        _write_json(result)
        return

    _write_json(get_store_stats())


if __name__ == "__main__":
    main()
