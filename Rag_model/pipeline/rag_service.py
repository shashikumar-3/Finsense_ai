"""Service entry points for FinSense AI RAG operations."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

try:
    from .build_documents import build_universe_documents, resolve_symbol_selection
    from .embed_store import get_store_stats, upsert_documents
    from .retrieve import get_stock, search_by_text_filters
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="FinSense AI RAG service wrapper.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    stock_parser = subparsers.add_parser("stock", help="Get one stock intelligence item.")
    stock_parser.add_argument("symbol")
    stock_parser.add_argument("--company-name", default="")
    stock_parser.add_argument("--refresh", action="store_true")
    stock_parser.add_argument("--skip-news", action="store_true")
    stock_parser.add_argument("--cached-only", action="store_true")

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
        print(json.dumps(result, ensure_ascii=False))
        return

    if args.command == "search":
        result = search_by_text_filters(
            query=args.query,
            limit=args.limit,
            trend=args.trend,
            sentiment=args.sentiment,
            hype_label=args.hype_label,
        )
        print(json.dumps(result, ensure_ascii=False))
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
            "response": generate_finrobot_response(document, args.query),
        }
        print(json.dumps(result, ensure_ascii=False))
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
        print(json.dumps(result, ensure_ascii=False))
        return

    print(json.dumps(get_store_stats(), ensure_ascii=False))


if __name__ == "__main__":
    main()
