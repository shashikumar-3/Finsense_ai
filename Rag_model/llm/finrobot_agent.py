"""FinRobot-style analyst orchestration for FinSense AI.

This module keeps the integration lightweight: it applies FinRobot's agent
pattern over the existing market/news/RAG document, then optionally asks an LLM
to turn the structured reasoning into a final user-facing answer.
"""

from __future__ import annotations

import json
import html
import os
import re
import sys
import time
from typing import Any
from pathlib import Path

import requests
from dotenv import load_dotenv


ROOT_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(ROOT_ENV_PATH)


def _safe_number(value: Any, digits: int = 2) -> str:
    try:
        if value is None:
            return "unknown"
        return str(round(float(value), digits))
    except (TypeError, ValueError):
        return "unknown"


def _clean_article_summary(value: Any, headline: str = "") -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = " ".join(text.split()).strip()
    if not text:
        return ""
    normalized_text = re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()
    normalized_headline = re.sub(r"[^a-z0-9]+", " ", str(headline or "").lower()).strip()
    if normalized_text == normalized_headline or (
        normalized_headline
        and normalized_text.startswith(normalized_headline)
        and len(normalized_text) <= len(normalized_headline) + 80
    ):
        return ""
    return text


def build_agent_context(document: dict[str, Any], query: str) -> dict[str, Any]:
    raw_query = str(query or '').strip()
    latest_marker = 'Latest user question:'
    latest_query = raw_query.split(latest_marker, 1)[1].strip() if latest_marker in raw_query else raw_query
    if document.get("type") == "strength":
        result = document.get("strength") or {}
        components = result.get("components") or {}
        technical = components.get("technical") or {}
        news = components.get("news") or {}
        articles = (news.get("values") or {}).get("articles") or []
        news_status = (news.get("values") or {}).get("status") or "unavailable"
        technical_values = technical.get("values") or {}
        market_facts = {
            "symbol": document.get("symbol"),
            "price": technical_values.get("price") or technical_values.get("close"),
            "timestamp": technical_values.get("date") or technical_values.get("retrieved_at"),
            "trend": technical_values.get("trend"),
            "rsi": technical_values.get("rsi"),
            "sma_20": technical_values.get("sma_20"),
            "sma_50": technical_values.get("sma_50"),
            "sma_200": technical_values.get("sma_200"),
            "macd": technical_values.get("macd"),
            "volume": technical_values.get("volume"),
            "volume_average": technical_values.get("volume_average"),
        }
        return {
            "query": latest_query,
            "conversation_context": raw_query if raw_query != latest_query else None,
            "data_cot": [
                f"Stock: {document.get('symbol')}",
                f"Overall deterministic status: {result.get('status')}",
                f"Overall score: {(result.get('overall') or {}).get('score')}",
                f"Price: {_safe_number(market_facts.get('price'))}",
                f"Trend: {market_facts.get('trend') or 'Unknown'}",
                f"RSI: {_safe_number(market_facts.get('rsi'))}",
                f"Fundamental component: {json.dumps(components.get('fundamentals') or {}, ensure_ascii=False)}",
                f"Technical component: {json.dumps(components.get('technical') or {}, ensure_ascii=False)}",
                f"News status: {news_status}",
                f"News component: {json.dumps(news, ensure_ascii=False)}",
                f"Hype component: {json.dumps(components.get('hype') or {}, ensure_ascii=False)}",
                f"Recent event risk: {json.dumps(result.get('event_risk') or {}, ensure_ascii=False)}",
            ],
            "concept_cot": [
                "Explain the deterministic component results; do not recalculate or invent scores.",
                "Historical or unavailable news must not be described as current evidence.",
                "Do not provide guaranteed returns or personalized buy/sell instructions.",
            ],
            "thesis_cot": result.get("limitations") or [],
            "market_facts": market_facts,
            "strength_components": components,
            "strength_comparison": result.get("comparison") or {},
            "top_headlines": [
                {**article, "news_status": news_status}
                for article in articles[:5]
                if isinstance(article, dict)
            ],
            "event_risk": result.get("event_risk") or {},
        }

    if document.get("type") == "portfolio":
        facts = document.get("facts") or {}
        computed = facts.get("computed") or {}
        risk = facts.get("risk") or {}
        return {
            "query": latest_query,
            "conversation_context": raw_query if raw_query != latest_query else None,
            "data_cot": [
                f"Portfolio: {facts.get('portfolio', {}).get('name') or 'Unnamed portfolio'}",
                f"Base currency: {facts.get('portfolio', {}).get('baseCurrency') or 'Unavailable'}",
                f"Verified ledger holdings: {json.dumps(facts.get('ledger') or [], ensure_ascii=False)}",
                f"Computed portfolio summary: {json.dumps(computed, ensure_ascii=False)}",
                f"Computed historical risk: {json.dumps(risk, ensure_ascii=False)}",
            ],
            "concept_cot": [
                "Treat all supplied ledger values and computed metrics as authoritative inputs; do not recalculate or invent missing values.",
                "Explain concentration as an exposure observation, not a prediction or personalized recommendation.",
                "If a metric is unavailable, say it is unavailable and explain the supplied limitation.",
            ],
            "thesis_cot": [
                "Separate verified facts, computed analysis, and AI interpretation.",
                "Do not provide guaranteed returns, personalized financial advice, or unsupported buy/sell instructions.",
                "Use cautious, educational decision-support language.",
            ],
            "top_headlines": [],
        }

    market = document.get("market") or {}
    news = document.get("news") or {}
    analysis = document.get("analysis") or {}
    raw_headlines = news.get("top_headlines") or []
    raw_articles = news.get("articles") or []
    article_lookup = {
        str(item.get("headline") or "").strip().lower(): item
        for item in raw_articles
        if isinstance(item, dict) and item.get("headline")
    }
    headlines = []
    for item in (raw_headlines or raw_articles):
        if not isinstance(item, dict) or not item.get("headline"):
            continue
        richer = article_lookup.get(str(item.get("headline")).strip().lower(), {})
        headlines.append({
            **richer,
            **item,
            "summary": item.get("summary") or richer.get("summary"),
            "url": item.get("url") or richer.get("url"),
            "source": item.get("source") or richer.get("source"),
            "published_date": item.get("published_date") or richer.get("published_date"),
        })
    freshness = news.get("freshness") or {}
    if news.get("is_current") is True or freshness.get("status") == "current":
        news_status = "current"
    elif news.get("is_valid") and (
        news.get("historical_only")
        or news.get("is_current") is False
        or freshness.get("status") == "historical"
        or news.get("freshness_status") == "stale"
    ):
        news_status = "historical"
    else:
        news_status = "unavailable"

    if news_status == "current":
        sentiment_label = f"Current news sentiment: {news.get('overall_sentiment') or 'Unknown'}"
        news_summary = analysis.get("news_summary") or "Current news summary unavailable."
    elif news_status == "historical":
        sentiment_label = f"Historical news sentiment (not current): {news.get('overall_sentiment') or 'Unknown'}"
        news_summary = analysis.get("news_summary") or "Historical news summary unavailable."
        news_summary = f"Historical context only; do not treat as current: {news_summary}"
    else:
        sentiment_label = "Current news sentiment: unavailable"
        news_summary = "Current news is unavailable; do not infer sentiment or catalysts."

    data_cot = [
        f"Stock: {document.get('symbol')}",
        f"Company: {document.get('company_name')}",
        f"Market validity: {bool(market.get('is_valid'))}",
        f"Price: {_safe_number(market.get('price'))}",
        f"Trend: {market.get('trend') or 'Unknown'}",
        f"RSI: {_safe_number(market.get('rsi'))}",
        f"News status: {news_status}",
        f"News validity: {bool(news.get('is_valid'))}",
        sentiment_label,
        f"Hype label: {news.get('hype_label') or 'Unknown'}",
    ]

    concept_cot = [
        analysis.get("recommendation") or "Recommendation unavailable.",
        analysis.get("market_summary") or "Market summary unavailable.",
        news_summary,
    ]

    thesis_cot = [
        "Use the evidence to explain the setup, risks, and next checks.",
        "Do not provide guaranteed returns or personalized financial advice.",
        "Prefer cautious, decision-support language.",
    ]

    return {
        "query": latest_query,
        "conversation_context": raw_query if raw_query != latest_query else None,
        "market_facts": {
            "symbol": document.get("symbol"),
            "price": market.get("price"),
            "previous_close": market.get("previous_close"),
            "timestamp": market.get("timestamp") or market.get("technical_snapshot_date"),
            "rsi": market.get("rsi"),
            "trend": market.get("trend"),
            "sma_20": market.get("sma_20"),
            "sma_50": market.get("sma_50"),
            "sma_200": market.get("sma_200"),
            "ema_20": market.get("ema_20"),
            "macd": market.get("macd"),
            "volume": market.get("volume"),
            "volume_average": market.get("volume_average"),
        },
        "data_cot": data_cot,
        "concept_cot": concept_cot,
        "thesis_cot": thesis_cot,
        "top_headlines": [
            {
                "headline": item.get("headline"),
                "source": item.get("source"),
                "sentiment": item.get("sentiment"),
                "published_date": item.get("published_date"),
                "summary": item.get("summary"),
                "url": item.get("url"),
                "news_status": news_status,
            }
            for item in headlines[:5]
        ],
    }


def _build_prompt(context: dict[str, Any]) -> str:
    return "\n".join(
        [
            "You are FinSense AI, a supervised financial decision-intelligence analyst.",
            "Use this FinRobot-style reasoning stack to answer the user's question.",
            "Write in plain text only.",
            "Use short plain-text section labels such as Answer, Evidence, Risks, and Suggested next step.",
            "Use bullets for multiple facts. Keep each bullet short and put a blank line between sections.",
            "Answer the latest question first. Use the prior conversation only to resolve follow-ups; never repeat a data dump.",
            "Keep the answer compact and readable in 2 to 4 short paragraphs.",
            "End with one grounded Suggested next step based only on the supplied data. If a required metric is unavailable, say so and suggest what to check.",
            "",
            f"User question: {context.get('query')}",
            f"Prior conversation context: {context.get('conversation_context') or 'None'}",
            "",
            "Data-CoT:",
            *[f"- {item}" for item in context.get("data_cot", [])],
            "",
            "Concept-CoT:",
            *[f"- {item}" for item in context.get("concept_cot", [])],
            "",
            "Thesis-CoT rules:",
            *[f"- {item}" for item in context.get("thesis_cot", [])],
            "",
            "News context (respect the status and publication dates):",
            *[
                f"- [{item.get('news_status', 'unknown')}] {item.get('headline')} "
                f"({item.get('sentiment') or 'Unknown'} via {item.get('source') or 'Unknown'}; "
                f"published {item.get('published_date') or 'unknown'}; "
                f"summary: {item.get('summary') or 'unavailable'}; "
                f"source URL: {item.get('url') or 'unavailable'})"
                for item in context.get("top_headlines", [])
                if item.get("headline")
            ],
            "",
            "Return a concise direct answer to the latest question, then explain the relevant evidence and finish with a practical suggested next step.",
        ]
    )


def _fallback_response(context: dict[str, Any]) -> str:
    data = context.get("data_cot", [])
    concepts = context.get("concept_cot", [])

    fields = {
        item.split(": ", 1)[0]: item.split(": ", 1)[1]
        for item in data
        if ": " in item
    }

    stock = fields.get("Stock", "This stock")
    price = fields.get("Price", "unavailable")
    trend = fields.get("Trend", "Unknown")
    rsi = fields.get("RSI", "unknown")
    query = str(context.get("query") or "").strip()
    query_lower = query.lower()
    sentiment = fields.get(
        "Current news sentiment",
        fields.get("Historical news sentiment (not current)", fields.get("Sentiment", "Unknown")),
    )
    news_status = fields.get("News status", "unavailable")
    headlines = [item for item in (context.get("top_headlines") or []) if isinstance(item, dict) and item.get("headline")]
    market_facts = context.get("market_facts") or {}
    recommendation = (
        concepts[0]
        if concepts
        else "The current signal is unavailable."
    )

    news_sentence = (
        f"Current news sentiment is {sentiment.lower()}."
        if news_status == "current"
        else "Current news is unavailable, so this assessment relies on the available market and analytical data only."
    )

    trend_text = trend.lower()
    asks_for_headlines = any(term in query_lower for term in ("headline", "headlines", "article", "articles", "news about", "latest news"))
    asks_for_first_article = any(term in query_lower for term in ("first article", "first headline", "headline 1", "article 1"))
    short_term_terms = (
        "buy now", "buy or wait", "short-term", "short term", "in a week", "next week",
        "2%", "3%", "2–3%", "2-3%", "entry", "enter", "stop-loss", "stop loss",
        "trading opportunity", "trade", "upside", "downside",
    )
    is_short_term = any(term in query_lower for term in short_term_terms)
    strength_components = context.get("strength_components") or {}
    is_strength_explanation = bool(strength_components) and any(
        term in query_lower for term in ("explain", "analysis", "overall", "score", "component")
    )

    if is_strength_explanation:
        fundamentals = strength_components.get("fundamentals") or {}
        technical = strength_components.get("technical") or {}
        news_component = strength_components.get("news") or {}
        hype = strength_components.get("hype") or {}
        fundamental_values = fundamentals.get("values") or {}
        technical_values = technical.get("values") or {}
        news_values = news_component.get("values") or {}
        comparison = context.get("strength_comparison") or {}
        evidence = []
        if fundamentals.get("score") is not None:
            evidence.append(f"- Score: {fundamentals['score']}/100")
        for label, key in (("Sector", "sector"), ("Reporting period", "period"), ("Revenue growth", "revenue_growth"), ("Profit margin", "profit_margin"), ("ROE", "roe")):
            if fundamental_values.get(key) not in (None, ""):
                evidence.append(f"- {label}: {fundamental_values[key]}")
        technical_evidence = []
        if technical.get("score") is not None:
            technical_evidence.append(f"- Score: {technical['score']}/100")
        for label, key in (("Price", "close"), ("Trend", "trend"), ("RSI", "rsi"), ("SMA 20", "sma_20"), ("SMA 50", "sma_50"), ("SMA 200", "sma_200")):
            if technical_values.get(key) not in (None, ""):
                technical_evidence.append(f"- {label}: {technical_values[key]}")
        news_evidence = [
            f"- Score: {news_component.get('score')}/100" if news_component.get("score") is not None else "- Score: unavailable",
            f"- Status: {news_values.get('status') or 'unavailable'}",
            f"- Sentiment: {fields.get('Current news sentiment', 'Unavailable')}",
            f"- Articles: {len(headlines)}",
        ]
        hype_evidence = [f"- Score: {hype.get('score')}/100"] if hype.get("score") is not None else ["- Score: unavailable"]
        answer = (
            f"Analysis for {stock}\n\n"
            f"Overall view\n- {recommendation}\n- Weighted score: {fields.get('Overall score', 'Unavailable')}/100\n"
            f"- Components used: {', '.join(key for key, value in strength_components.items() if value.get('score') is not None) or 'none'}\n\n"
            "Fundamental evidence\n" + "\n".join(evidence or ["- Fundamental details are unavailable."]) + "\n\n"
            "Technical evidence\n" + "\n".join(technical_evidence or ["- Technical details are unavailable."]) + "\n\n"
            "News and sentiment\n" + "\n".join(news_evidence) + "\n\n"
            "Hype and attention\n" + "\n".join(hype_evidence) + "\n\n"
            f"Interpretation\n- {comparison.get('classification') or 'The components provide mixed or incomplete evidence.'}\n"
            "- Scores summarize available evidence; they are not probabilities or guaranteed returns."
        )
        next_step = "Review the dated headlines and the latest reporting-period fundamentals together; treat unavailable or historical fields as limitations rather than assumptions."
    elif is_short_term:
        price_value = market_facts.get("price")
        try:
            price_number = float(price_value)
        except (TypeError, ValueError):
            price_number = None
        rsi_value = market_facts.get("rsi")
        try:
            rsi_number = float(rsi_value)
        except (TypeError, ValueError):
            rsi_number = None
        sma_20 = _safe_number(market_facts.get("sma_20"))
        sma_50 = _safe_number(market_facts.get("sma_50"))
        macd = market_facts.get("macd") or {}
        macd_value = _safe_number(macd.get("macd"))
        macd_signal = _safe_number(macd.get("signal"))
        volume = market_facts.get("volume")
        volume_average = market_facts.get("volume_average")
        price_text = _safe_number(price_number) if price_number is not None else price
        timestamp = market_facts.get("timestamp") or "timestamp unavailable"

        bullish = []
        bearish = []
        confirmations = []
        if trend.lower() in {"bullish", "uptrend"}:
            bullish.append(f"the recorded trend is {trend.lower()}")
        elif trend.lower() not in {"unknown", "unavailable"}:
            bearish.append(f"the recorded trend is {trend.lower()}")
        if rsi_number is not None:
            if rsi_number < 30:
                bullish.append(f"RSI is {rsi_number:.2f}, an oversold reading that needs price confirmation")
                bearish.append("an oversold RSI can remain oversold during a continuing decline")
            elif rsi_number > 70:
                bearish.append(f"RSI is {rsi_number:.2f}, an overbought reading")
            else:
                confirmations.append(f"RSI is {rsi_number:.2f}, so it is not by itself an extreme signal")
        if price_number is not None:
            for label, moving_average in (("SMA20", market_facts.get("sma_20")), ("SMA50", market_facts.get("sma_50"))):
                if isinstance(moving_average, (int, float)):
                    (bullish if price_number > moving_average else bearish).append(
                        f"price is {'above' if price_number > moving_average else 'below'} {label} ({float(moving_average):.2f})"
                    )
        if macd_value != "unknown" and macd_signal != "unknown":
            confirmations.append(f"MACD is {macd_value} versus signal {macd_signal}; a crossover or continued separation needs confirmation")
        if isinstance(volume, (int, float)) and isinstance(volume_average, (int, float)) and volume_average > 0:
            confirmations.append(f"volume is {float(volume):.0f} versus an average of {float(volume_average):.0f}")
        else:
            confirmations.append("relative volume is unavailable")

        if price_number is None:
            answer = f"I cannot give a short-term trading analysis for {stock} because the latest verified price is unavailable."
            next_step = "Refresh the market snapshot before evaluating a one-week move."
        else:
            hypothetical = (
                f"- Retrieved price: {price_number:.2f} at {timestamp}\n"
                f"- Hypothetical +2%: {price_number * 1.02:.2f}\n"
                f"- Hypothetical +3%: {price_number * 1.03:.2f}\n"
                f"- Hypothetical -2%: {price_number * 0.98:.2f}\n"
                f"- Hypothetical -3%: {price_number * 0.97:.2f}\n"
                "These are arithmetic scenarios, not forecasts."
            )
            answer = (
                f"Short-term view for {stock}\n"
                "I cannot confirm that it will move 2–3% in a week, and the available evidence is not enough to guarantee an entry.\n\n"
                "Bullish evidence\n"
                f"- {('; '.join(bullish)) if bullish else 'No verified bullish technical condition is available.'}\n\n"
                "Bearish evidence\n"
                f"- {('; '.join(bearish)) if bearish else 'No verified bearish technical condition is available.'}\n\n"
                "Hypothetical price levels\n"
                f"{hypothetical}\n\n"
                "Confirmation signals\n"
                f"- {'; '.join(confirmations)}\n"
                f"- {news_sentence}"
            )
            next_step = "Use a defined entry, stop-loss, and target only after you choose them from your own risk plan; those levels were not supplied, so I will not invent them."
    elif asks_for_first_article:
        if not headlines:
            answer = f"I cannot identify a first article for {stock} because no validated news article is available in the current stock context."
            next_step = "Refresh the stock news and try again when a dated article is available."
        else:
            article = headlines[0]
            headline = str(article.get("headline"))
            source = article.get("source") or "Unknown source"
            published = article.get("published_date") or "publication date unavailable"
            summary = _clean_article_summary(article.get("summary"), headline)
            url = article.get("url") or ""
            answer = f"The first available headline is \"{headline}\" from {source}, published {published}."
            if summary:
                answer += f" The retrieved summary says: {summary}"
            else:
                answer += " I can see the headline metadata, but the article body or a reliable summary was not retrieved, so I cannot verify what the full article says or its precise impact."
            if url:
                answer += f" Source: {url}"
            next_step = "Treat any impact discussion as interpretation until the full article or a verified company release is available."
    elif asks_for_headlines:
        if not headlines:
            answer = f"I could not retrieve usable news articles for {stock}. The provider returned no validated headlines, so I cannot explain the news or its impact."
            next_step = "Refresh the stock intelligence and try again; do not infer a catalyst from unavailable coverage."
        else:
            rendered = []
            for index, article in enumerate(headlines[:5], 1):
                headline = str(article.get("headline"))
                source = article.get("source") or "Unknown source"
                published = article.get("published_date") or "publication date unavailable"
                summary = _clean_article_summary(article.get("summary"), headline)
                detail = f"{headline} — {source}, {published}."
                detail += f" Available summary: {summary}" if summary else " Only the headline metadata is available; the article body was not retrieved."
                if article.get("url"):
                    detail += f" Source: {article.get('url')}"
                rendered.append(f"{index}. {detail}")
            answer = f"I found {len(headlines)} available article{'s' if len(headlines) != 1 else ''} for {stock}:\n" + "\n".join(rendered)
            next_step = "Ask about a specific headline, such as the first article, and I will separate the retrieved facts from the possible market interpretation."
    elif any(term in query_lower for term in ("risk", "danger", "concern", "downside")):
        answer = (
            f"The main near-term risk for {stock} is that its {trend_text} setup can remain weak; "
            f"the latest RSI is {rsi}. {news_sentence}"
        )
        next_step = "Review support levels, valuation, and any current company-specific news before changing your position."
    elif any(term in query_lower for term in ("news", "sentiment", "headline", "coverage")):
        answer = f"For {stock}, {news_sentence}"
        next_step = "Open the dated headlines and check whether they are recent enough to support your decision; do not treat historical coverage as a current catalyst."
    elif any(term in query_lower for term in ("debt", "financial position", "balance sheet", "fundamental")):
        answer = (
            f"The current market snapshot places {stock} at {price} with a {trend_text} trend, but it does not include a verified debt or balance-sheet figure. "
            "I will not infer financial health from price action alone."
        )
        next_step = "Review the available annual and quarterly statements for debt, cash flow, margins, and interest coverage before drawing a fundamental conclusion."
    elif any(term in query_lower for term in ("buy", "wait", "outlook", "short-term", "short term")):
        asks_direct_buy = any(term in query_lower for term in ("can i buy", "should i buy", "right time to buy", "buy this stock"))
        if asks_direct_buy:
            answer = (
                f"Buy decision for {stock}\n"
                f"- Current setup: {trend_text} at a last analysed price of {price}, with RSI {rsi}.\n"
                f"- Evidence limitation: {news_sentence}\n"
                f"- Assessment: the available snapshot does not establish a verified entry signal or guarantee that buying now is suitable. {recommendation}"
            )
            next_step = "Define your maximum loss and wait for confirmation from price action and valuation; I will not invent an entry, stop-loss, or probability from missing data."
        else:
            answer = (
                f"Market outlook for {stock}\n"
                f"- Current setup: {trend_text} at a last analysed price of {price}, with RSI {rsi}.\n"
                f"- News context: {news_sentence}\n"
                f"- Interpretation: {recommendation}"
            )
            next_step = "Compare this snapshot with the latest verified valuation, fundamentals, and dated news before treating it as a decision signal."
    elif any(term in query_lower for term in ("compare", "performance", "why", "explain", "concerning")):
        answer = (
            f"Based on the available evidence, {stock} is {trend_text} with price {price} and RSI {rsi}. "
            f"{recommendation} {news_sentence}"
        )
        next_step = "Compare the latest price trend with the company’s verified fundamentals and dated news before deciding whether the setup has improved or deteriorated."
    else:
        answer = (
            f"For your question about {stock}: it is currently {trend_text}, with a last analysed price of {price} and RSI {rsi}. "
            f"{news_sentence} {recommendation}"
        )
        next_step = "Tell me which part you want to examine next—risk, debt, valuation, technical trend, or news—and I will keep the answer tied to this stock’s available data."

    return f"Answer\n{answer}\n\nSuggested next step\n- {next_step}"


def _is_usable_answer(answer: str) -> bool:
    normalized = " ".join((answer or "").split())

    blocked_fragments = (
        "cot rules",
        "data-cot",
        "concept-cot",
        "paragraph 1:",
    )

    return (
        len(normalized) >= 120
        and normalized.count(" ") >= 18
        and not any(
            fragment in normalized.lower()
            for fragment in blocked_fragments
        )
        and normalized[-1:] in {".", "!", "?"}
    )


def _call_openai_compatible(prompt: str) -> str:
    api_key = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY")
    base_url = (
        os.getenv("LLM_BASE_URL")
        or "https://api.openai.com/v1"
    ).rstrip("/")
    model = os.getenv("LLM_MODEL") or "gpt-4o-mini"

    if not api_key:
        raise RuntimeError(
            "LLM_API_KEY or OPENAI_API_KEY is not configured."
        )

    response = requests.post(
        f"{base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a careful financial analyst.",
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ],
            "temperature": float(
                os.getenv("LLM_TEMPERATURE") or 0.2
            ),
            "max_tokens": int(
                os.getenv("LLM_MAX_TOKENS") or 350
            ),
        },
        timeout=45,
    )

    response.raise_for_status()

    payload = response.json()

    return payload["choices"][0]["message"]["content"].strip()


def _call_gemini(prompt: str) -> str:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("LLM_API_KEY")
    model = os.getenv("LLM_MODEL") or "gemini-1.5-flash"

    timeout_seconds = max(
        int(os.getenv("LLM_TIMEOUT_SECONDS") or 45),
        15,
    )

    retry_count = max(
        int(os.getenv("LLM_RETRY_COUNT") or 1),
        1,
    )

    max_output_tokens = int(
        os.getenv("LLM_MAX_TOKENS") or 350
    )

    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY or LLM_API_KEY is not configured."
        )

    last_error: Exception | None = None

    for attempt in range(retry_count):
        try:
            response = requests.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                params={
                    "key": api_key,
                },
                json={
                    "contents": [
                        {
                            "parts": [
                                {
                                    "text": prompt,
                                }
                            ]
                        }
                    ],
                    "generationConfig": {
                        "maxOutputTokens": 1000,
                        "thinkingConfig": {
                            "thinkingBudget": 0
                        },
                    },
                },
                timeout=timeout_seconds,
            )

            response.raise_for_status()

            payload = response.json()

            # ---------------------------------------------------------
            # GEMINI DIAGNOSTICS
            # ---------------------------------------------------------
            candidates = payload.get("candidates") or []

            if not candidates:
                raise RuntimeError(
                    f"Gemini returned no candidates: {payload}"
                )

            candidate = candidates[0]

            finish_reason = candidate.get("finishReason")
            usage = payload.get("usageMetadata")

            print("\n========== GEMINI DEBUG ==========", file=sys.stderr)
            print("MODEL:", model, file=sys.stderr)
            print("FINISH REASON:", finish_reason, file=sys.stderr)
            print("USAGE:", usage, file=sys.stderr)
            print("MAX OUTPUT TOKENS:", max_output_tokens, file=sys.stderr)
            print("==================================\n", file=sys.stderr)

            content = candidate.get("content") or {}
            parts = content.get("parts") or []

            if not parts:
                raise RuntimeError(
                    f"Gemini returned no text parts. "
                    f"Finish reason: {finish_reason}"
                )

            answer = "".join(
                part.get("text", "")
                for part in parts
                if isinstance(part, dict)
            ).strip()

            if not answer:
                raise RuntimeError(
                    f"Gemini returned empty text. "
                    f"Finish reason: {finish_reason}"
                )

            print("GEMINI ANSWER LENGTH:", len(answer), file=sys.stderr)

            return answer

        except Exception as error:
            last_error = error

            print(
                f"[GEMINI ERROR] Attempt {attempt + 1}/{retry_count}: "
                f"{error}",
                file=sys.stderr,
            )

            if attempt >= retry_count - 1:
                break

            time.sleep(1.5 * (attempt + 1))

    raise RuntimeError(
        str(last_error)
        if last_error
        else "Gemini request failed."
    )


def _call_ollama(prompt: str) -> str:
    base_url = (
        os.getenv("OLLAMA_BASE_URL")
        or "http://localhost:11434"
    ).rstrip("/")

    model = os.getenv("LLM_MODEL") or "llama3.1"

    response = requests.post(
        f"{base_url}/api/generate",
        json={
            "model": model,
            "prompt": prompt,
            "stream": False,
        },
        timeout=60,
    )

    response.raise_for_status()

    return response.json().get("response", "").strip()


def generate_finrobot_response(
    document: dict[str, Any],
    query: str,
    fast: bool = False,
) -> dict[str, Any]:

    context = build_agent_context(document, query)
    prompt = _build_prompt(context)

    provider = (
        os.getenv("LLM_PROVIDER")
        or "fallback"
    ).strip().lower()

    model = os.getenv("LLM_MODEL") or provider

    try:
        if fast:
            answer = _fallback_response(context)
            provider = "deterministic"
            model = "market-snapshot-v2"

        elif provider in {
            "openai",
            "openai-compatible",
            "groq",
            "together",
        }:
            answer = _call_openai_compatible(prompt)

        elif provider == "gemini":
            answer = _call_gemini(prompt)

        elif provider == "ollama":
            answer = _call_ollama(prompt)

        else:
            answer = _fallback_response(context)
            provider = "fallback"
            model = "deterministic"

        # -------------------------------------------------------------
        # DO NOT silently replace Gemini output.
        # Just warn us if the response is too short.
        # -------------------------------------------------------------
        if provider == "gemini" and not _is_usable_answer(answer):
            print(
                f"[LLM WARNING] Gemini returned a short/unusable response: "
                f"{len(answer)} characters",
                file=sys.stderr,
            )

    except Exception as error:
        answer = _fallback_response(context)

        provider = "fallback"
        model = "deterministic"

        context["llm_error"] = str(error)

        print(f"[LLM ERROR] {error}", file=sys.stderr)

    return {
        "provider": provider,
        "model": model,
        "architecture": "finrobot_style_data_concept_thesis_cot",
        "answer": answer,
        "reasoning_context": context,
    }


def dumps_response(payload: dict[str, Any]) -> str:
    return json.dumps(
        payload,
        ensure_ascii=False,
    )
