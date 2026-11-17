"""Stock-news processing pipeline for FinSense AI."""

from __future__ import annotations

import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any

try:
    from .fetch_news import get_stock_news, normalize_symbol
    from .sentiment import analyze_sentiment
except ImportError:
    from fetch_news import get_stock_news, normalize_symbol
    from sentiment import analyze_sentiment

try:
    from ..analysis.event_risk import classify_event
except ImportError:
    try:
        from analysis.event_risk import classify_event
    except ImportError:
        from event_risk import classify_event


def _normalize_headline(headline: str) -> str:
    cleaned = re.sub(r"[^a-z0-9\s]", " ", (headline or "").lower())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _estimate_hype_score(analyzed_articles: list[dict[str, Any]]) -> dict[str, Any]:
    if not analyzed_articles:
        return {
            "news_frequency_count": 0,
            "repeated_headline_count": 0,
            "hype_score": 0.0,
            "hype_label": "Low",
        }

    frequency_count = len(analyzed_articles)
    normalized_headlines = [
        _normalize_headline(article.get("headline") or "") for article in analyzed_articles
    ]
    headline_counts = Counter(headline for headline in normalized_headlines if headline)

    repeated_headline_count = sum(count - 1 for count in headline_counts.values() if count > 1)
    repeated_ratio = repeated_headline_count / max(frequency_count, 1)

    positive_count = sum(
        1 for article in analyzed_articles if article.get("sentiment") == "Positive"
    )
    negative_count = sum(
        1 for article in analyzed_articles if article.get("sentiment") == "Negative"
    )
    dominant_sentiment_ratio = max(positive_count, negative_count) / max(frequency_count, 1)

    volume_score = min(frequency_count / 10.0, 1.0)
    polarity_score = min(dominant_sentiment_ratio, 1.0)
    hype_score = min(
        1.0,
        (0.45 * volume_score) + (0.30 * repeated_ratio) + (0.25 * polarity_score),
    )

    if hype_score >= 0.67:
        hype_label = "High"
    elif hype_score >= 0.34:
        hype_label = "Medium"
    else:
        hype_label = "Low"

    return {
        "news_frequency_count": frequency_count,
        "repeated_headline_count": repeated_headline_count,
        "hype_score": round(hype_score, 4),
        "hype_label": hype_label,
    }


def process_stock_news(symbol: str) -> dict[str, Any]:
    """Fetch, score, and summarize news intelligence for one stock."""

    normalized_symbol = normalize_symbol(symbol)
    fetched_news = get_stock_news(normalized_symbol)

    if not fetched_news.get("is_valid"):
        return {
            "symbol": normalized_symbol,
            "is_valid": False,
            "provider": fetched_news.get("provider"),
            "overall_sentiment": None,
            "sentiment_status": "unavailable",
            "positive_score": None,
            "negative_score": None,
            "neutral_score": None,
            "news_frequency_count": 0,
            "repeated_headline_count": 0,
            "hype_score": 0.0,
            "hype_label": "Low",
            "top_headlines": [],
            "error": fetched_news.get("error", "Unable to fetch stock news."),
            "historical_only": bool(fetched_news.get("historical_only")),
            "freshness": fetched_news.get("freshness", {"status": "unavailable"}),
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
        }

    sentiment_result = analyze_sentiment(fetched_news.get("articles", []))
    if not sentiment_result.get("is_valid"):
        return {
            "symbol": normalized_symbol,
            "is_valid": False,
            "provider": fetched_news.get("provider"),
            "overall_sentiment": None,
            "sentiment_status": "unavailable",
            "positive_score": None,
            "negative_score": None,
            "neutral_score": None,
            "news_frequency_count": fetched_news.get("article_count", 0),
            "repeated_headline_count": 0,
            "hype_score": 0.0,
            "hype_label": "Low",
            "top_headlines": [],
            "error": sentiment_result.get("error", "Unable to analyze sentiment."),
            "historical_only": bool(fetched_news.get("historical_only")),
            "freshness": fetched_news.get("freshness", {"status": "unavailable"}),
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
        }

    analyzed_articles = sentiment_result.get("articles", [])
    hype_result = _estimate_hype_score(analyzed_articles)

    top_headlines = [
        {
            "headline": article.get("headline"),
            "source": article.get("source"),
            "published_date": article.get("published_date"),
            "url": article.get("url"),
            "sentiment": article.get("sentiment"),
            "polarity": article.get("polarity"),
            "relevance_score": article.get("relevance_score"),
            "event_category": article.get("event_category") or classify_event(article.get("headline")),
        }
        for article in analyzed_articles
    ]

    return {
        "symbol": normalized_symbol,
        "is_valid": True,
        "provider": fetched_news.get("provider"),
        "overall_sentiment": sentiment_result.get("overall_sentiment"),
        "sentiment_status": "available",
        "positive_score": sentiment_result.get("positive_score"),
        "negative_score": sentiment_result.get("negative_score"),
        "neutral_score": sentiment_result.get("neutral_score"),
        "average_polarity": sentiment_result.get("average_polarity"),
        "news_frequency_count": hype_result.get("news_frequency_count"),
        "repeated_headline_count": hype_result.get("repeated_headline_count"),
        "hype_score": hype_result.get("hype_score"),
        "hype_label": hype_result.get("hype_label"),
        "top_headlines": top_headlines,
        "articles": analyzed_articles,
        "error": None,
        "historical_only": bool(fetched_news.get("historical_only")),
        "freshness": fetched_news.get("freshness", {"status": "current"}),
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
    }
