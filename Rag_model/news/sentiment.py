"""Sentiment analysis helpers for FinSense AI news articles."""

from __future__ import annotations

from typing import Any

from textblob import TextBlob


def _normalize_component_scores(polarity: float) -> tuple[float, float, float]:
    positive = max(polarity, 0.0)
    negative = max(-polarity, 0.0)
    neutral = max(0.0, 1.0 - abs(polarity))

    total = positive + negative + neutral
    if total == 0:
        return 0.0, 0.0, 1.0

    return positive / total, negative / total, neutral / total


def _sentiment_label(polarity: float) -> str:
    if polarity > 0.08:
        return "Positive"
    if polarity < -0.08:
        return "Negative"
    return "Neutral"


def analyze_sentiment(news_articles: list[dict[str, Any]]) -> dict[str, Any]:
    """Analyze sentiment across fetched news articles."""

    if not news_articles:
        return {
            "is_valid": False,
            "overall_sentiment": "Neutral",
            "positive_score": 0.0,
            "negative_score": 0.0,
            "neutral_score": 0.0,
            "articles": [],
            "error": "No news articles were provided for sentiment analysis.",
        }

    analyzed_articles: list[dict[str, Any]] = []
    total_positive = 0.0
    total_negative = 0.0
    total_neutral = 0.0
    total_polarity = 0.0

    for article in news_articles:
        headline = article.get("headline") or ""
        summary = article.get("summary") or ""
        text = f"{headline}. {summary}".strip()

        polarity = TextBlob(text).sentiment.polarity if text else 0.0
        positive_score, negative_score, neutral_score = _normalize_component_scores(
            polarity
        )

        analyzed_articles.append(
            {
                **article,
                "polarity": round(polarity, 4),
                "positive_score": round(positive_score, 4),
                "negative_score": round(negative_score, 4),
                "neutral_score": round(neutral_score, 4),
                "sentiment": _sentiment_label(polarity),
            }
        )

        total_positive += positive_score
        total_negative += negative_score
        total_neutral += neutral_score
        total_polarity += polarity

    count = len(analyzed_articles)
    average_polarity = total_polarity / count

    return {
        "is_valid": True,
        "overall_sentiment": _sentiment_label(average_polarity),
        "positive_score": round(total_positive / count, 4),
        "negative_score": round(total_negative / count, 4),
        "neutral_score": round(total_neutral / count, 4),
        "average_polarity": round(average_polarity, 4),
        "articles": analyzed_articles,
        "error": None,
    }
