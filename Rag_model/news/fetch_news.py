"""News fetching helpers for the FinSense AI news engine."""

from __future__ import annotations

import os
import re
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from html import unescape
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv


DEFAULT_ARTICLE_LIMIT = 10
NEWSAPI_FETCH_PAGE_SIZE = 50
REQUEST_TIMEOUT_SECONDS = 20
PRIMARY_NEWS_LOOKBACK_DAYS = 11
FALLBACK_NEWS_LOOKBACK_DAYS = 30
GOOGLE_NEWS_FETCH_LIMIT = 12
ROOT_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"

load_dotenv(ROOT_ENV_PATH)

SYMBOL_ALIASES = {
    "RELIANCE": "Reliance Industries",
    "TCS": "Tata Consultancy Services",
    "INFY": "Infosys",
    "HDFCBANK": "HDFC Bank",
    "ICICIBANK": "ICICI Bank",
    "SBIN": "State Bank of India",
    "LT": "Larsen & Toubro",
}

TRUSTED_SOURCE_KEYWORDS = {
    "moneycontrol": 1.4,
    "economic times": 1.4,
    "livemint": 1.3,
    "mint": 1.2,
    "business standard": 1.3,
    "financial express": 1.2,
    "cnbc tv18": 1.3,
    "reuters": 1.3,
    "bloomberg": 1.3,
    "the hindu businessline": 1.2,
    "ndtv profit": 1.2,
}

FINANCE_TERMS = (
    "stock",
    "stocks",
    "share",
    "shares",
    "nse",
    "bse",
    "market",
    "earnings",
    "results",
    "profit",
    "loss",
    "target",
    "brokerage",
    "deal",
    "stake",
    "acquisition",
    "buyback",
    "dividend",
)

NOISE_PATTERNS = (
    "horoscope",
    "sports",
    "celebrity",
    "movie",
    "cricket",
    "lifestyle",
    "recipe",
    "travel",
    "weather",
    "crypto",
    "bitcoin",
    "ethereum",
)

BLOCKED_URL_PATTERNS = (
    "consent.yahoo.com",
)

GENERIC_ROUNDUP_PATTERNS = (
    "stocks to buy or sell today",
    "remain in focus",
    "gainers & losers",
    "gainers and losers",
    "top laggard",
    "among shares that may remain in focus",
    "stocks including",
    "big movers",
    "top 10 most-valued firms",
)


def normalize_symbol(symbol: str) -> str:
    cleaned = (symbol or "").strip().upper()
    if not cleaned:
        return ""
    if cleaned.endswith(".NS"):
        return cleaned
    return f"{cleaned}.NS"


def base_symbol(symbol: str) -> str:
    normalized = normalize_symbol(symbol)
    return normalized.removesuffix(".NS")


def build_search_terms(symbol: str) -> dict[str, str]:
    base = base_symbol(symbol)
    company_name = SYMBOL_ALIASES.get(base, base.replace("&", " AND "))
    strict_query = (
        f'("{company_name}" OR "{base}") AND '
        "(NSE OR BSE OR stock OR shares OR earnings OR results OR profit OR target OR brokerage OR market)"
    )
    broad_query = (
        f'("{company_name}" OR "{base}") AND '
        "(India OR Indian market OR NSE OR stock OR shares)"
    )

    return {
        "base_symbol": base,
        "company_name": company_name,
        "strict_query": strict_query,
        "broad_query": broad_query,
    }


def _empty_news_result(symbol: str, error: str) -> dict[str, Any]:
    return {
        "symbol": normalize_symbol(symbol),
        "is_valid": False,
        "provider": None,
        "article_count": 0,
        "articles": [],
        "error": error,
    }


def _safe_request_error(provider: str, error: requests.RequestException) -> str:
    """Return a user-safe provider error without URLs, query strings, or API keys."""

    status_code = getattr(error.response, "status_code", None)
    reason = getattr(error.response, "reason", None)

    if status_code:
        detail = f"{status_code}"
        if reason:
            detail = f"{detail} {reason}"
        return f"{provider} request failed: {detail}."

    return f"{provider} request failed. Please retry later."


def _parse_newsapi_article(article: dict[str, Any]) -> dict[str, Any]:
    published_at = article.get("publishedAt")
    published_date = None

    if published_at:
      try:
          published_date = datetime.fromisoformat(
              published_at.replace("Z", "+00:00")
          ).astimezone(timezone.utc).isoformat()
      except ValueError:
          published_date = published_at

    return {
        "headline": article.get("title"),
        "source": (article.get("source") or {}).get("name"),
        "published_date": published_date,
        "summary": article.get("description") or article.get("content"),
        "url": article.get("url"),
        "content": article.get("content"),
    }


def _parse_finnhub_article(article: dict[str, Any]) -> dict[str, Any]:
    published_timestamp = article.get("datetime")
    published_date = None
    if published_timestamp:
        published_date = datetime.fromtimestamp(
            int(published_timestamp), tz=timezone.utc
        ).isoformat()

    return {
        "headline": article.get("headline"),
        "source": article.get("source"),
        "published_date": published_date,
        "summary": article.get("summary"),
        "url": article.get("url"),
    }


def _clean_articles(articles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    cleaned_articles: list[dict[str, Any]] = []

    for article in articles:
        headline = (article.get("headline") or "").strip()
        url = (article.get("url") or "").strip()
        source = (article.get("source") or "").strip()

        if not headline or not url:
            continue

        dedupe_key = f"{headline.lower()}::{url.lower()}"
        if dedupe_key in seen:
            continue

        seen.add(dedupe_key)
        cleaned_articles.append(
            {
                "headline": headline,
                "source": source or "Unknown",
                "published_date": article.get("published_date"),
                "summary": (article.get("summary") or "").strip(),
                "url": url,
                "content": (article.get("content") or "").strip(),
            }
        )

    return cleaned_articles


def _normalize_text(text: str) -> str:
    lowered = (text or "").lower()
    lowered = re.sub(r"\s+", " ", lowered)
    return lowered.strip()


def _contains_company_reference(article: dict[str, Any], base: str, company_name: str) -> bool:
    text = _normalize_text(
        " ".join(
            [
                article.get("headline") or "",
                article.get("summary") or "",
                article.get("content") or "",
            ]
        )
    )
    company_tokens = [
        _normalize_text(base),
        _normalize_text(company_name),
    ]
    return any(token and token in text for token in company_tokens)


def _contains_noise(article: dict[str, Any]) -> bool:
    text = _normalize_text(
        " ".join(
            [
                article.get("headline") or "",
                article.get("summary") or "",
                article.get("content") or "",
            ]
        )
    )
    return any(pattern in text for pattern in NOISE_PATTERNS)


def _has_blocked_url(article: dict[str, Any]) -> bool:
    url = _normalize_text(article.get("url") or "")
    return any(pattern in url for pattern in BLOCKED_URL_PATTERNS)


def _source_quality_boost(source: str) -> float:
    normalized_source = _normalize_text(source)
    for keyword, boost in TRUSTED_SOURCE_KEYWORDS.items():
        if keyword in normalized_source:
            return boost
    return 0.0


def _compute_relevance_score(article: dict[str, Any], base: str, company_name: str) -> float:
    headline = _normalize_text(article.get("headline") or "")
    summary = _normalize_text(article.get("summary") or "")
    content = _normalize_text(article.get("content") or "")
    combined = " ".join([headline, summary, content]).strip()

    score = 0.0
    base_token = _normalize_text(base)
    company_token = _normalize_text(company_name)

    if company_token and company_token in headline:
        score += 4.0
    if base_token and base_token in headline:
        score += 3.0
    if company_token and company_token in summary:
        score += 2.0
    if base_token and base_token in summary:
        score += 1.5

    finance_hits = sum(1 for term in FINANCE_TERMS if term in combined)
    score += min(finance_hits * 0.35, 2.0)

    score += _source_quality_boost(article.get("source") or "")

    published_date = article.get("published_date")
    if published_date:
        try:
            published_at = datetime.fromisoformat(published_date.replace("Z", "+00:00"))
            age_hours = max(
                0.0,
                (datetime.now(timezone.utc) - published_at).total_seconds() / 3600.0,
            )
            if age_hours <= 24:
                score += 1.6
            elif age_hours <= 72:
                score += 1.0
            elif age_hours <= 168:
                score += 0.5
        except ValueError:
            pass

    if any(pattern in headline for pattern in GENERIC_ROUNDUP_PATTERNS):
        score -= 2.3

    if headline.count(",") >= 2:
        score -= 0.8

    return round(score, 4)


def _rank_and_filter_newsapi_articles(
    articles: list[dict[str, Any]], symbol: str, limit: int
) -> list[dict[str, Any]]:
    terms = build_search_terms(symbol)
    base = terms["base_symbol"]
    company_name = terms["company_name"]

    scored_articles: list[dict[str, Any]] = []

    for article in _clean_articles(articles):
        if _contains_noise(article):
            continue
        if _has_blocked_url(article):
            continue
        if not _contains_company_reference(article, base, company_name):
            continue

        relevance_score = _compute_relevance_score(article, base, company_name)
        if relevance_score < 2.2:
            continue

        scored_articles.append(
            {
                "headline": article.get("headline"),
                "source": article.get("source"),
                "published_date": article.get("published_date"),
                "summary": article.get("summary"),
                "url": article.get("url"),
                "relevance_score": relevance_score,
            }
        )

    scored_articles.sort(
        key=lambda article: (
            article.get("relevance_score", 0.0),
            article.get("published_date") or "",
        ),
        reverse=True,
    )

    return scored_articles[:limit]


def _fetch_newsapi_query(query: str, api_key: str, from_date: str) -> list[dict[str, Any]]:
    response = requests.get(
        "https://newsapi.org/v2/everything",
        params={
            "q": query,
            "language": "en",
            "searchIn": "title,description",
            "sortBy": "publishedAt",
            "pageSize": NEWSAPI_FETCH_PAGE_SIZE,
            "from": from_date,
            "apiKey": api_key,
        },
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    payload = response.json()

    if payload.get("status") != "ok":
        raise requests.RequestException(
            payload.get("message", "NewsAPI returned an unsuccessful response.")
        )

    return [_parse_newsapi_article(article) for article in payload.get("articles", [])]


def _parse_google_news_item(item: ET.Element) -> dict[str, Any]:
    title = (item.findtext("title") or "").strip()
    link = (item.findtext("link") or "").strip()
    published_raw = (item.findtext("pubDate") or "").strip()

    source = "Google News"
    headline = title
    if " - " in title:
        headline, source = title.rsplit(" - ", 1)

    published_date = None
    if published_raw:
        try:
            published_date = datetime.strptime(
                published_raw, "%a, %d %b %Y %H:%M:%S %Z"
            ).replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            published_date = published_raw

    return {
        "headline": unescape(headline.strip()),
        "source": unescape(source.strip()) or "Google News",
        "published_date": published_date,
        "summary": unescape((item.findtext("description") or "").strip()),
        "url": link,
        "content": "",
    }


def _fetch_google_news_query(query: str) -> list[dict[str, Any]]:
    encoded_query = urllib.parse.quote_plus(query)
    response = requests.get(
        f"https://news.google.com/rss/search?q={encoded_query}&hl=en-IN&gl=IN&ceid=IN:en",
        timeout=REQUEST_TIMEOUT_SECONDS,
        headers={
            "User-Agent": "Mozilla/5.0",
        },
    )
    response.raise_for_status()

    root = ET.fromstring(response.content)
    channel = root.find("channel")
    if channel is None:
        return []

    parsed_articles = []
    for item in channel.findall("item")[:GOOGLE_NEWS_FETCH_LIMIT]:
        parsed_articles.append(_parse_google_news_item(item))

    return parsed_articles


def _fetch_newsapi_articles_for_range(
    symbol: str, api_key: str, from_date: str, limit: int
) -> list[dict[str, Any]]:
    terms = build_search_terms(symbol)
    parsed_articles: list[dict[str, Any]] = []
    parsed_articles.extend(
        _fetch_newsapi_query(terms["strict_query"], api_key, from_date)
    )
    parsed_articles.extend(
        _fetch_newsapi_query(terms["broad_query"], api_key, from_date)
    )
    return _rank_and_filter_newsapi_articles(parsed_articles, symbol, limit)


def _fetch_google_news_articles(symbol: str, limit: int) -> list[dict[str, Any]]:
    terms = build_search_terms(symbol)
    queries = [
        f'"{terms["company_name"]}" NSE BSE stock India',
        f'"{terms["base_symbol"]}" NSE BSE stock India',
    ]

    parsed_articles: list[dict[str, Any]] = []
    for query in queries:
        parsed_articles.extend(_fetch_google_news_query(query))

    return _rank_and_filter_newsapi_articles(parsed_articles, symbol, limit)


def _fetch_from_newsapi(symbol: str, limit: int) -> dict[str, Any]:
    api_key = os.getenv("NEWSAPI_API_KEY")
    if not api_key:
        return _empty_news_result(symbol, "NEWSAPI_API_KEY is not configured.")

    try:
        primary_from_date = (
            datetime.now(timezone.utc) - timedelta(days=PRIMARY_NEWS_LOOKBACK_DAYS)
        ).date().isoformat()
        ranked_articles = _fetch_newsapi_articles_for_range(
            symbol, api_key, primary_from_date, limit
        )

        if not ranked_articles:
            fallback_from_date = (
                datetime.now(timezone.utc) - timedelta(days=FALLBACK_NEWS_LOOKBACK_DAYS)
            ).date().isoformat()
            ranked_articles = _fetch_newsapi_articles_for_range(
                symbol, api_key, fallback_from_date, limit
            )

        if not ranked_articles:
            ranked_articles = _fetch_google_news_articles(symbol, limit)

        if not ranked_articles:
            return _empty_news_result(
                symbol,
                "No relevant stock news was found in the last 10-day, 30-day, or Google News fallback windows.",
            )

        return {
            "symbol": normalize_symbol(symbol),
            "is_valid": True,
            "provider": "newsapi",
            "article_count": len(ranked_articles),
            "articles": ranked_articles,
            "error": None,
        }
    except requests.RequestException as error:
        return _empty_news_result(symbol, _safe_request_error("NewsAPI", error))


def _fetch_from_finnhub(symbol: str, limit: int) -> dict[str, Any]:
    api_key = os.getenv("FINNHUB_API_KEY")
    if not api_key:
        return _empty_news_result(symbol, "FINNHUB_API_KEY is not configured.")

    base = base_symbol(symbol)
    symbol_candidates = [normalize_symbol(symbol), base, f"NSE:{base}"]
    today = datetime.now(timezone.utc).date()
    from_date = (today - timedelta(days=30)).isoformat()
    to_date = today.isoformat()

    for candidate in symbol_candidates:
        try:
            response = requests.get(
                "https://finnhub.io/api/v1/company-news",
                params={
                    "symbol": candidate,
                    "from": from_date,
                    "to": to_date,
                    "token": api_key,
                },
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            payload = response.json()

            if not isinstance(payload, list):
                continue

            parsed_articles = [_parse_finnhub_article(article) for article in payload]
            cleaned_articles = _clean_articles(parsed_articles)[:limit]

            if cleaned_articles:
                return {
                    "symbol": normalize_symbol(symbol),
                    "is_valid": True,
                    "provider": "finnhub",
                    "article_count": len(cleaned_articles),
                    "articles": cleaned_articles,
                    "error": None,
                }
        except requests.RequestException:
            continue

    return _empty_news_result(symbol, "No recent news articles were found.")


def get_stock_news(symbol: str, limit: int = DEFAULT_ARTICLE_LIMIT) -> dict[str, Any]:
    """Fetch recent stock-related news for one NSE symbol."""

    normalized_symbol = normalize_symbol(symbol)
    if not normalized_symbol:
        return _empty_news_result(symbol, "Symbol is required.")

    has_newsapi_key = bool(os.getenv("NEWSAPI_API_KEY"))
    has_finnhub_key = bool(os.getenv("FINNHUB_API_KEY"))

    if not has_newsapi_key and not has_finnhub_key:
        return _empty_news_result(
            normalized_symbol,
            "No news provider key is configured. Set NEWSAPI_API_KEY or FINNHUB_API_KEY.",
        )

    provider = (os.getenv("NEWS_PROVIDER") or "").strip().lower()
    allow_finnhub_fallback = (
        (os.getenv("NEWS_ALLOW_FINNHUB_FALLBACK") or "false").strip().lower()
        == "true"
    )

    if provider == "finnhub" and has_finnhub_key:
        result = _fetch_from_finnhub(normalized_symbol, limit)
        if result.get("is_valid"):
            return result
        if has_newsapi_key:
            return _fetch_from_newsapi(normalized_symbol, limit)
        return result

    if provider == "newsapi":
        result = _fetch_from_newsapi(normalized_symbol, limit)
        if result.get("is_valid"):
            return result
        if allow_finnhub_fallback and has_finnhub_key:
            return _fetch_from_finnhub(normalized_symbol, limit)
        return result

    result = _fetch_from_newsapi(normalized_symbol, limit)
    if result.get("is_valid"):
        return result
    if allow_finnhub_fallback and has_finnhub_key:
        return _fetch_from_finnhub(normalized_symbol, limit)
    return result
