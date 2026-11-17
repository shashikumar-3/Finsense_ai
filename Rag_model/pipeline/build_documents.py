"""Build unified stock-intelligence documents for FinSense AI."""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

try:
    from market.scanner import analyze_stock
    from news.news_processor import process_stock_news
except ImportError:
    import sys

    ROOT = Path(__file__).resolve().parents[1]
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from market.scanner import analyze_stock
    from news.news_processor import process_stock_news


PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAG_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(__file__).resolve().parent / "data"
DOCUMENTS_PATH = DATA_DIR / "latest_documents.json"
NSE_SYMBOLS_CACHE_PATH = DATA_DIR / "nse_symbols_cache.json"
ROOT_ENV_PATH = PROJECT_ROOT / ".env"
NSE_SYMBOLS_URL = "https://archives.nseindia.com/content/equities/EQUITY_L.csv"
NSE_SYMBOLS_CACHE_HOURS = 24

load_dotenv(ROOT_ENV_PATH)
MARKET_TTL_MINUTES = max(int(os.getenv("MARKET_TTL_MINUTES") or 30), 1)
NEWS_TTL_MINUTES = max(int(os.getenv("NEWS_TTL_MINUTES") or 180), 1)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _coerce_existing_news(existing_document: dict[str, Any] | None, symbol: str) -> dict[str, Any]:
    if existing_document:
        existing_news = existing_document.get("news")
        if isinstance(existing_news, dict):
            return existing_news

        refresh_metadata = existing_document.get("refresh_metadata") or {}
        if existing_document.get("symbol") == f"{symbol}.NS":
            return {
                "symbol": f"{symbol}.NS",
                "is_valid": False,
                "overall_sentiment": "Neutral",
                "positive_score": 0.0,
                "negative_score": 0.0,
                "neutral_score": 0.0,
                "hype_score": 0.0,
                "hype_label": "Low",
                "news_frequency_count": 0,
                "top_headlines": [],
                "error": "News not available in cached document.",
                "cached_updated_at": refresh_metadata.get("news_updated_at") or existing_document.get("updated_at"),
            }

    return {
        "symbol": f"{symbol}.NS",
        "is_valid": False,
        "overall_sentiment": "Neutral",
        "positive_score": 0.0,
        "negative_score": 0.0,
        "neutral_score": 0.0,
        "hype_score": 0.0,
        "hype_label": "Low",
        "news_frequency_count": 0,
        "top_headlines": [],
        "error": "News fetch skipped for this build.",
    }


def _reuse_cached_news_after_failure(
    existing_document: dict[str, Any] | None,
    failed_news: dict[str, Any],
) -> dict[str, Any]:
    existing_news = (existing_document or {}).get("news")
    if (
        not isinstance(existing_news, dict)
        or not existing_news.get("articles")
        and not existing_news.get("top_headlines")
    ):
        return failed_news

    cached_news = dict(existing_news)
    cached_news["is_current"] = False
    cached_news["historical_only"] = True
    cached_news["freshness_status"] = "stale"
    cached_news["freshness"] = {
        "status": "historical",
        "max_age_days": 90,
    }
    cached_news["error"] = failed_news.get("error") or "Current news is temporarily unavailable."
    cached_news["provider_error"] = failed_news.get("error")
    return cached_news


def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _cache_is_fresh(path: Path, max_age_hours: int) -> bool:
    if not path.exists():
        return False
    age_seconds = datetime.now(timezone.utc).timestamp() - path.stat().st_mtime
    return age_seconds < (max_age_hours * 3600)


def fetch_nse_symbols(force_refresh: bool = False) -> list[dict[str, str]]:
    """Fetch the NSE equity universe with a small local cache."""

    ensure_data_dir()

    if not force_refresh and _cache_is_fresh(NSE_SYMBOLS_CACHE_PATH, NSE_SYMBOLS_CACHE_HOURS):
        with NSE_SYMBOLS_CACHE_PATH.open("r", encoding="utf-8") as file:
            cached = json.load(file)
        if isinstance(cached, list):
            return cached

    response = requests.get(NSE_SYMBOLS_URL, timeout=20)
    response.raise_for_status()

    rows: list[dict[str, str]] = []
    reader = csv.DictReader(response.text.splitlines())
    for row in reader:
        symbol = (row.get("SYMBOL") or "").strip().upper()
        company_name = (row.get("NAME OF COMPANY") or "").strip()
        if not symbol:
            continue
        rows.append({"symbol": symbol, "company_name": company_name})

    with NSE_SYMBOLS_CACHE_PATH.open("w", encoding="utf-8") as file:
        json.dump(rows, file, indent=2)

    return rows


def _safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        number = float(value)
        return round(number, 4) if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def _sanitize_json_values(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _sanitize_json_values(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_sanitize_json_values(item) for item in value]
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    return value


def _summarize_market(market: dict[str, Any]) -> str:
    if not market.get("is_valid"):
        return market.get("error", "Market analysis unavailable.")

    parts = [
        f"Price {_safe_float(market.get('price'))}",
        f"trend {market.get('trend')}",
        f"RSI {_safe_float(market.get('rsi'))}",
        f"SMA20 {_safe_float(market.get('sma_20'))}",
        f"SMA50 {_safe_float(market.get('sma_50'))}",
        f"SMA200 {_safe_float(market.get('sma_200'))}",
        f"EMA20 {_safe_float(market.get('ema_20'))}",
        f"volume {_safe_float(market.get('volume'))}",
        f"sector {market.get('sector') or 'Not available from current provider'}",
        f"industry {market.get('industry') or 'Not available from current provider'}",
    ]

    macd = market.get("macd") or {}
    parts.append(
        "MACD "
        f"{_safe_float(macd.get('macd'))}, "
        f"signal {_safe_float(macd.get('signal'))}, "
        f"histogram {_safe_float(macd.get('histogram'))}"
    )

    bands = market.get("bollinger_bands") or {}
    parts.append(
        "Bollinger bands "
        f"upper {_safe_float(bands.get('upper'))}, "
        f"middle {_safe_float(bands.get('middle'))}, "
        f"lower {_safe_float(bands.get('lower'))}"
    )

    return ". ".join(part for part in parts if part)


def _build_market_summary_structured(market: dict[str, Any]) -> dict[str, Any]:
    if not market.get("is_valid"):
        return {
            "is_valid": False,
            "error": market.get("error", "Market analysis unavailable."),
            "overview": [],
            "trend_signals": [],
            "indicator_snapshot": [],
        }

    macd = market.get("macd") or {}
    bands = market.get("bollinger_bands") or {}

    return {
        "is_valid": True,
        "error": None,
        "overview": [
            {"label": "Price", "value": market.get("price")},
            {"label": "Previous Close", "value": market.get("previous_close")},
            {"label": "Volume", "value": market.get("volume")},
            {"label": "Sector", "value": market.get("sector") or "Not available from current provider"},
            {"label": "Industry", "value": market.get("industry") or "Not available from current provider"},
            {"label": "Metadata source", "value": market.get("metadata_source") or "Yahoo Finance (unavailable)"},
        ],
        "trend_signals": [
            {"label": "Trend", "value": market.get("trend") or "Unknown"},
            {"label": "RSI", "value": _safe_float(market.get("rsi"))},
            {"label": "SMA 20", "value": _safe_float(market.get("sma_20"))},
            {"label": "SMA 50", "value": _safe_float(market.get("sma_50"))},
            {"label": "SMA 200", "value": _safe_float(market.get("sma_200"))},
            {"label": "EMA 20", "value": _safe_float(market.get("ema_20"))},
        ],
        "indicator_snapshot": [
            {"label": "MACD", "value": _safe_float(macd.get("macd"))},
            {"label": "MACD Signal", "value": _safe_float(macd.get("signal"))},
            {"label": "MACD Histogram", "value": _safe_float(macd.get("histogram"))},
            {"label": "Bollinger Upper", "value": _safe_float(bands.get("upper"))},
            {"label": "Bollinger Middle", "value": _safe_float(bands.get("middle"))},
            {"label": "Bollinger Lower", "value": _safe_float(bands.get("lower"))},
        ],
    }


def _summarize_news(news: dict[str, Any]) -> str:
    if not news.get("is_valid"):
        return news.get("error", "Recent stock-specific news unavailable.")

    headlines = []
    for article in (news.get("top_headlines") or [])[:5]:
        headline = article.get("headline")
        sentiment = article.get("sentiment")
        source = article.get("source")
        if headline:
            headlines.append(f"{headline} [{sentiment or 'Unknown'} via {source or 'Unknown'}]")

    parts = [
        f"Overall sentiment {news.get('overall_sentiment')}",
        f"positive score {_safe_float(news.get('positive_score'))}",
        f"negative score {_safe_float(news.get('negative_score'))}",
        f"neutral score {_safe_float(news.get('neutral_score'))}",
        f"hype score {_safe_float(news.get('hype_score'))}",
        f"hype label {news.get('hype_label')}",
        f"news frequency {news.get('news_frequency_count')}",
    ]
    if headlines:
        parts.append("Top headlines: " + " | ".join(headlines))

    return ". ".join(part for part in parts if part)


def _build_news_summary_structured(news: dict[str, Any]) -> dict[str, Any]:
    if not news.get("is_valid"):
        return {
            "is_valid": False,
            "error": news.get("error", "Recent stock-specific news unavailable."),
            "sentiment_breakdown": [],
            "coverage": [],
            "top_headlines": [],
        }

    return {
        "is_valid": True,
        "error": None,
        "sentiment_breakdown": [
            {"label": "Overall Sentiment", "value": news.get("overall_sentiment") or "Unknown"},
            {"label": "Positive Score", "value": _safe_float(news.get("positive_score"))},
            {"label": "Negative Score", "value": _safe_float(news.get("negative_score"))},
            {"label": "Neutral Score", "value": _safe_float(news.get("neutral_score"))},
        ],
        "coverage": [
            {"label": "Provider", "value": news.get("provider") or "Unknown"},
            {"label": "Hype Score", "value": _safe_float(news.get("hype_score"))},
            {"label": "Hype Label", "value": news.get("hype_label") or "Unknown"},
            {"label": "Article Count", "value": news.get("news_frequency_count") or 0},
        ],
        "top_headlines": [
            {
                "headline": article.get("headline"),
                "source": article.get("source"),
                "published_date": article.get("published_date"),
                "sentiment": article.get("sentiment"),
                "relevance_score": _safe_float(article.get("relevance_score")),
                "url": article.get("url"),
            }
            for article in (news.get("top_headlines") or [])[:5]
        ],
    }


def _derive_recommendation(market: dict[str, Any], news: dict[str, Any]) -> str:
    if not market.get("is_valid"):
        return "Watchlist: market data needs validation before generating an investment view."

    trend = (market.get("trend") or "").lower()
    rsi = _safe_float(market.get("rsi"))
    sentiment = (news.get("overall_sentiment") or "Neutral").lower()
    hype_label = (news.get("hype_label") or "Low").lower()

    if trend == "bullish" and sentiment == "positive" and hype_label != "high":
        return "Constructive setup: technicals and news both support deeper review for accumulation."
    if trend == "bearish" and sentiment == "negative":
        return "Risk elevated: both trend and news are weak, so avoid aggressive entries."
    if hype_label == "high":
        return "Caution: narrative intensity is high, so validate fundamentals before acting on momentum."
    if rsi is not None and rsi < 35:
        return "Potential oversold setup: check whether the weakness is temporary or thesis-breaking."
    if rsi is not None and rsi > 70:
        return "Momentum is extended: prefer confirmation rather than chasing price."
    return "Mixed setup: combine this with valuation and portfolio context before deciding."


def build_stock_document(
    symbol: str,
    company_name: str | None = None,
    include_news: bool = True,
    existing_document: dict[str, Any] | None = None,
    refresh_news: bool | None = None,
) -> dict[str, Any]:
    """Build one unified stock document from market and news engines."""

    symbol = (symbol or "").strip().upper().removesuffix(".NS")
    company_name = (company_name or "").strip()
    now_iso = utc_now_iso()
    market = _sanitize_json_values(analyze_stock(symbol))
    if market.get("is_valid") and market.get("price") is None:
        market["is_valid"] = False
        market["error"] = "Market price unavailable."
    should_refresh_news = include_news if refresh_news is None else refresh_news
    news_refreshed = False

    if include_news and should_refresh_news:
        news = process_stock_news(symbol)
        if not news.get("is_valid"):
            news = _reuse_cached_news_after_failure(existing_document, news)
        news_refreshed = True
        news_updated_at = now_iso
    else:
        news = _coerce_existing_news(existing_document, symbol)
        news_updated_at = (
            (existing_document or {}).get("refresh_metadata", {}).get("news_updated_at")
            or (existing_document or {}).get("updated_at")
            or (now_iso if include_news else None)
        )

    market_summary = _summarize_market(market)
    news_summary = _summarize_news(news)
    market_summary_structured = _build_market_summary_structured(market)
    news_summary_structured = _build_news_summary_structured(news)
    recommendation = _derive_recommendation(market, news)
    normalized_symbol = f"{symbol}.NS"

    document_text = "\n".join(
        [
            f"Stock: {normalized_symbol}",
            f"Company: {company_name or symbol}",
            f"Market summary: {market_summary}",
            f"News summary: {news_summary}",
            f"Recommendation: {recommendation}",
        ]
    )

    return {
        "id": normalized_symbol,
        "symbol": normalized_symbol,
        "base_symbol": symbol,
        "company_name": company_name or symbol,
        "updated_at": now_iso,
        "document_text": document_text,
        "analysis": {
            "recommendation": recommendation,
            "market_summary": market_summary,
            "news_summary": news_summary,
            "market_summary_structured": market_summary_structured,
            "news_summary_structured": news_summary_structured,
        },
        "refresh_metadata": {
            "market_updated_at": now_iso,
            "news_updated_at": news_updated_at,
            "market_ttl_minutes": MARKET_TTL_MINUTES,
            "news_ttl_minutes": NEWS_TTL_MINUTES,
            "news_refreshed": news_refreshed,
        },
        "market": market,
        "news": news,
    }


def build_universe_documents(
    symbols: list[dict[str, str]],
    include_news: bool = True,
    skip_invalid_market: bool = False,
) -> list[dict[str, Any]]:
    documents: list[dict[str, Any]] = []

    for item in symbols:
        document = build_stock_document(
            item.get("symbol", ""),
            company_name=item.get("company_name"),
            include_news=include_news,
        )
        if skip_invalid_market and not document.get("market", {}).get("is_valid"):
            continue
        documents.append(document)

    return documents


def save_documents(documents: list[dict[str, Any]], path: Path = DOCUMENTS_PATH) -> Path:
    ensure_data_dir()
    with path.open("w", encoding="utf-8") as file:
        json.dump(documents, file, indent=2)
    return path


def load_documents(path: Path = DOCUMENTS_PATH) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as file:
        data = json.load(file)
    return data if isinstance(data, list) else []


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build FinSense AI stock intelligence documents.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    build_stock_parser = subparsers.add_parser("stock", help="Build one stock document.")
    build_stock_parser.add_argument("symbol", help="NSE symbol, with or without .NS")
    build_stock_parser.add_argument("--company-name", default="", help="Optional company name")
    build_stock_parser.add_argument("--skip-news", action="store_true", help="Skip the news stage")

    batch_parser = subparsers.add_parser("batch", help="Build many stock documents.")
    batch_parser.add_argument("--all", action="store_true", help="Use the full NSE symbol universe")
    batch_parser.add_argument("--limit", type=int, default=0, help="Limit number of symbols")
    batch_parser.add_argument("--offset", type=int, default=0, help="Offset inside the NSE universe")
    batch_parser.add_argument("--search", default="", help="Filter NSE symbols by search string")
    batch_parser.add_argument("--skip-news", action="store_true", help="Skip the news stage")
    batch_parser.add_argument("--skip-invalid-market", action="store_true", help="Drop symbols with invalid market data")
    batch_parser.add_argument("--force-refresh-universe", action="store_true", help="Refresh NSE symbol cache")

    return parser.parse_args()


def _filter_symbols(
    symbols: list[dict[str, str]],
    search: str = "",
    offset: int = 0,
    limit: int = 0,
) -> list[dict[str, str]]:
    search_value = (search or "").strip().upper()
    filtered = symbols

    if search_value:
        filtered = [
            item
            for item in symbols
            if search_value in item.get("symbol", "").upper()
            or search_value in item.get("company_name", "").upper()
        ]
        filtered.sort(
            key=lambda item: (
                0 if item.get("symbol", "").upper() == search_value else 1,
                0 if item.get("symbol", "").upper().startswith(search_value) else 1,
                0 if item.get("company_name", "").upper().startswith(search_value) else 1,
                item.get("symbol", ""),
            )
        )

    if offset > 0:
        filtered = filtered[offset:]
    if limit > 0:
        filtered = filtered[:limit]

    return filtered


def resolve_symbol_selection(
    use_all: bool = False,
    search: str = "",
    offset: int = 0,
    limit: int = 0,
    force_refresh_universe: bool = False,
) -> list[dict[str, str]]:
    universe = fetch_nse_symbols(force_refresh=force_refresh_universe)
    if use_all and not search and offset == 0 and limit <= 0:
        return universe

    return _filter_symbols(
        universe,
        search=search,
        offset=max(offset, 0),
        limit=max(limit, 0),
    )


def main() -> None:
    args = parse_args()

    if args.command == "stock":
        document = build_stock_document(
            args.symbol,
            company_name=args.company_name,
            include_news=not args.skip_news,
        )
        print(json.dumps(document, ensure_ascii=False))
        return

    selected_symbols = resolve_symbol_selection(
        use_all=args.all,
        search=args.search,
        offset=args.offset,
        limit=args.limit,
        force_refresh_universe=args.force_refresh_universe,
    )

    documents = build_universe_documents(
        selected_symbols,
        include_news=not args.skip_news,
        skip_invalid_market=args.skip_invalid_market,
    )
    save_documents(documents)
    print(
        json.dumps(
            {
                "saved_path": str(DOCUMENTS_PATH),
                "document_count": len(documents),
                "selected_symbols": len(selected_symbols),
                "updated_at": utc_now_iso(),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
