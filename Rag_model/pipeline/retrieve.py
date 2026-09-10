"""Retrieve stock intelligence from the FinSense AI semantic vector store."""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

try:
    from .embed_store import (
        CHROMA_DIR,
        get_item_by_symbol,
        get_store_stats,
        query_store,
        upsert_single_stock,
    )
except ImportError:
    import sys

    PIPELINE_ROOT = Path(__file__).resolve().parent
    if str(PIPELINE_ROOT) not in sys.path:
        sys.path.insert(0, str(PIPELINE_ROOT))
    from embed_store import CHROMA_DIR, get_item_by_symbol, get_store_stats, query_store, upsert_single_stock


ROOT_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(ROOT_ENV_PATH)
MARKET_TTL_MINUTES = max(int(os.getenv("MARKET_TTL_MINUTES") or 30), 1)
NEWS_TTL_MINUTES = max(int(os.getenv("NEWS_TTL_MINUTES") or 180), 1)


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _document_timestamp(document: dict[str, Any], key: str) -> datetime | None:
    refresh_metadata = document.get("refresh_metadata") or {}
    return _parse_iso_datetime(refresh_metadata.get(key)) or _parse_iso_datetime(document.get("updated_at"))


def _is_fresh(timestamp: datetime | None, ttl_minutes: int) -> bool:
    if not timestamp:
        return False
    age_seconds = (datetime.now(timezone.utc) - timestamp).total_seconds()
    return age_seconds <= (ttl_minutes * 60)


def get_stock(
    symbol: str,
    company_name: str = "",
    refresh: bool = False,
    include_news: bool = True,
    cached_only: bool = False,
) -> dict[str, Any]:
    normalized_symbol = f"{(symbol or '').strip().upper().removesuffix('.NS')}.NS"
    existing_item = get_item_by_symbol(normalized_symbol)
    existing_document = existing_item.get("document") if existing_item else None

    if cached_only:
        if existing_item:
            existing_item["found"] = True
            return existing_item
        return {
            "symbol": normalized_symbol,
            "found": False,
            "document": None,
        }

    if refresh:
        return upsert_single_stock(
            normalized_symbol,
            company_name=company_name,
            include_news=include_news,
            refresh_news=include_news,
        )

    if not existing_document:
        return upsert_single_stock(
            normalized_symbol,
            company_name=company_name,
            include_news=include_news,
            refresh_news=include_news,
        )

    market_fresh = _is_fresh(_document_timestamp(existing_document, "market_updated_at"), MARKET_TTL_MINUTES)
    news_fresh = _is_fresh(_document_timestamp(existing_document, "news_updated_at"), NEWS_TTL_MINUTES)

    if market_fresh and (not include_news or news_fresh):
        return existing_item

    refresh_news = include_news and not news_fresh
    return upsert_single_stock(
        normalized_symbol,
        company_name=company_name,
        include_news=include_news,
        refresh_news=refresh_news,
    )


def search(query: str, limit: int = 5) -> list[dict[str, Any]]:
    return [
        {
            "id": item.get("id"),
            "symbol": item.get("symbol"),
            "company_name": item.get("company_name"),
            "score": item.get("score", 0.0),
            "metadata": item.get("metadata"),
            "document": item.get("document"),
        }
        for item in query_store(query, limit=max(limit, 1))
    ]


def search_by_text_filters(
    query: str = "",
    limit: int = 25,
    trend: str = "",
    sentiment: str = "",
    hype_label: str = "",
) -> list[dict[str, Any]]:
    where: dict[str, Any] = {}

    normalized_trend = (trend or "").strip()
    normalized_sentiment = (sentiment or "").strip()
    normalized_hype_label = (hype_label or "").strip()

    if normalized_trend:
        where["trend"] = normalized_trend
    if normalized_sentiment:
        where["overall_sentiment"] = normalized_sentiment
    if normalized_hype_label:
        where["hype_label"] = normalized_hype_label

    items = query_store(query, limit=max(limit, 1), where=where or None)
    items.sort(
        key=lambda item: (
            item.get("score", 0.0),
            (item.get("document") or {}).get("updated_at", ""),
        ),
        reverse=True,
    )

    return [
        {
            "id": item.get("id"),
            "symbol": item.get("symbol"),
            "company_name": item.get("company_name"),
            "score": round(item.get("score", 0.0), 6),
            "metadata": item.get("metadata"),
            "document": item.get("document"),
        }
        for item in items[: max(limit, 1)]
    ]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Retrieve FinSense AI stock intelligence.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    stock_parser = subparsers.add_parser("stock", help="Fetch one unified stock analysis.")
    stock_parser.add_argument("symbol")
    stock_parser.add_argument("--company-name", default="")
    stock_parser.add_argument("--refresh", action="store_true")
    stock_parser.add_argument("--skip-news", action="store_true")
    stock_parser.add_argument("--cached-only", action="store_true")

    search_parser = subparsers.add_parser("search", help="Semantic search across stored stock documents.")
    search_parser.add_argument("query")
    search_parser.add_argument("--limit", type=int, default=5)

    info_parser = subparsers.add_parser("info", help="Inspect the store.")
    info_parser.add_argument("--store-path", default=str(CHROMA_DIR))

    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.command == "stock":
        item = get_stock(
            args.symbol,
            company_name=args.company_name,
            refresh=args.refresh,
            include_news=not args.skip_news,
            cached_only=args.cached_only,
        )
        print(json.dumps(item, ensure_ascii=False))
        return

    if args.command == "search":
        print(json.dumps(search(args.query, limit=args.limit), ensure_ascii=False))
        return

    print(json.dumps(get_store_stats(), ensure_ascii=False))


if __name__ == "__main__":
    main()
