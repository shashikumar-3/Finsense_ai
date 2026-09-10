"""Manual test runner for the FinSense AI news engine."""

from __future__ import annotations

import sys
from pprint import pprint

try:
    from .fetch_news import get_stock_news
    from .news_processor import process_stock_news
    from .sentiment import analyze_sentiment
except ImportError:
    from fetch_news import get_stock_news
    from news_processor import process_stock_news
    from sentiment import analyze_sentiment


TEST_SYMBOLS = ["RELIANCE.NS", "TCS.NS", "INFY.NS"]

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def run_single_symbol_test(symbol: str) -> None:
    print("=" * 80)
    print(f"Testing symbol: {symbol}")

    news_result = get_stock_news(symbol)
    print("\n1. Fetched news")
    pprint(
        {
            "symbol": news_result.get("symbol"),
            "is_valid": news_result.get("is_valid"),
            "provider": news_result.get("provider"),
            "article_count": news_result.get("article_count"),
            "error": news_result.get("error"),
        }
    )

    sentiment_result = analyze_sentiment(news_result.get("articles", []))
    print("\n2. Sentiment analysis")
    pprint(
        {
            "overall_sentiment": sentiment_result.get("overall_sentiment"),
            "positive_score": sentiment_result.get("positive_score"),
            "negative_score": sentiment_result.get("negative_score"),
            "neutral_score": sentiment_result.get("neutral_score"),
            "error": sentiment_result.get("error"),
        }
    )

    processed_result = process_stock_news(symbol)
    print("\n3. Processed news intelligence")
    pprint(
        {
            "symbol": processed_result.get("symbol"),
            "overall_sentiment": processed_result.get("overall_sentiment"),
            "news_frequency_count": processed_result.get("news_frequency_count"),
            "repeated_headline_count": processed_result.get("repeated_headline_count"),
            "hype_score": processed_result.get("hype_score"),
            "hype_label": processed_result.get("hype_label"),
            "top_headlines": processed_result.get("top_headlines"),
            "error": processed_result.get("error"),
        }
    )


def main() -> None:
    for symbol in TEST_SYMBOLS:
        run_single_symbol_test(symbol)


if __name__ == "__main__":
    main()
