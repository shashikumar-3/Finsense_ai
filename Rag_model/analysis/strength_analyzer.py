"""Deterministic Hype-versus-Reality analysis built on existing providers.

Scores are heuristic 0-100 indicators, not forecasts. Missing components are
excluded from the weighted result and never silently converted to zero.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

import yfinance as yf

try:
    from .fundamentals import build_statement_summary
    from .event_risk import build_event_risk, classify_event
except ImportError:
    from analysis.fundamentals import build_statement_summary
    from analysis.event_risk import build_event_risk, classify_event

try:
    from ..market.stocks import get_historical_data, normalize_symbol
    from ..market.technicals import calculate_technicals
    from ..news.news_processor import process_stock_news
except ImportError:
    from market.stocks import get_historical_data, normalize_symbol
    from market.technicals import calculate_technicals
    from news.news_processor import process_stock_news


def _number(value: Any) -> float | None:
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def _score(value: float | None, rules: list[tuple[float, float]], inverse: bool = False) -> float | None:
    if value is None:
        return None
    for threshold, score in rules:
        if (value <= threshold) if inverse else (value >= threshold):
            return score
    return 20.0 if inverse else 20.0


def _component(name: str, score: float | None, values: dict[str, Any], evidence: list[str], warnings: list[str]) -> dict[str, Any]:
    return {
        "name": name,
        "status": "available" if score is not None else "insufficient_data",
        "score": round(score, 2) if score is not None else None,
        "values": values,
        "evidence": evidence,
        "warnings": warnings,
    }


def fetch_fundamentals(symbol: str) -> dict[str, Any]:
    """Read provider-supplied ratios and statement periods without inventing gaps."""
    try:
        ticker = yf.Ticker(normalize_symbol(symbol))
        info = dict(ticker.info or {})
    except Exception as error:
        return {"status": "unavailable", "metrics": {}, "warnings": [f"Fundamental provider unavailable: {error}"]}

    keys = {
        "revenue_growth": "revenueGrowth", "earnings_growth": "earningsGrowth",
        "profit_margin": "profitMargins", "operating_margin": "operatingMargins",
        "roe": "returnOnEquity", "roa": "returnOnAssets", "debt_to_equity": "debtToEquity",
        "interest_coverage": "interestCoverage", "operating_cash_flow": "operatingCashflow",
        "free_cash_flow": "freeCashflow", "pe_ratio": "trailingPE", "price_to_book": "priceToBook",
        "market_cap": "marketCap", "enterprise_value": "enterpriseValue", "shares_outstanding": "sharesOutstanding",
        "float_shares": "floatShares", "week_52_high": "fiftyTwoWeekHigh", "week_52_low": "fiftyTwoWeekLow",
        "average_volume": "averageVolume", "beta": "beta", "forward_pe": "forwardPE",
        "price_to_sales": "priceToSalesTrailing12Months", "peg_ratio": "pegRatio", "ev_to_ebitda": "enterpriseToEbitda",
        "ev_to_revenue": "enterpriseToRevenue", "revenue": "totalRevenue", "gross_profit": "grossProfits",
        "operating_income": "operatingIncome", "net_income": "netIncomeToCommon", "eps": "trailingEps",
        "gross_margin": "grossMargins", "dividend_yield": "dividendYield", "annual_dividend_rate": "dividendRate",
        "payout_ratio": "payoutRatio", "current_ratio": "currentRatio", "quick_ratio": "quickRatio",
        "total_cash": "totalCash", "total_debt": "totalDebt", "debt_to_equity_ratio": "debtToEquity",
        "quarterly_revenue_growth": "quarterlyRevenueGrowth", "quarterly_earnings_growth": "quarterlyEarningsGrowth",
    }
    metrics = {name: _number(info.get(key)) for name, key in keys.items()}
    sector = info.get("sector")
    financial_sector = any(term in str(sector).lower() for term in ("financial", "bank", "insurance"))
    available = sum(value is not None for value in metrics.values())
    statement_warnings: list[str] = []
    try:
        annual = _statement_records(getattr(ticker, "income_stmt", None), info)
    except Exception as error:
        annual = []
        statement_warnings.append(f"Annual financial statements could not be retrieved: {error}")
    try:
        quarterly = _statement_records(getattr(ticker, "quarterly_income_stmt", None), info)
    except Exception as error:
        quarterly = []
        statement_warnings.append(f"Quarterly financial statements could not be retrieved: {error}")
    statement_summary = build_statement_summary(annual, quarterly, statement_warnings)
    available_fields = sorted([key for key, value in metrics.items() if value is not None] + [key for key, value in {
        "sector": sector, "industry": info.get("industry"), "company_name": info.get("longName") or info.get("shortName"),
        "website": info.get("website"), "country": info.get("country"), "currency": info.get("currency") or info.get("financialCurrency"),
    }.items() if value not in (None, '')])
    return {
        "status": "available" if available else "insufficient_data",
        "sector": sector,
        "industry": info.get("industry"),
        "company_name": info.get("longName") or info.get("shortName") or info.get("displayName"),
        "website": info.get("website"),
        "country": info.get("country"),
        "financial_sector": financial_sector,
        "currency": info.get("currency") or info.get("financialCurrency"),
        "period": info.get("lastFiscalYearEnd") or info.get("mostRecentQuarter"),
        "metrics": metrics,
        "annual_results": statement_summary.get("annual_results", []),
        "quarterly_results": statement_summary.get("quarterly_results", []),
        "statement_status": statement_summary.get("status"),
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "warnings": (statement_summary.get("warnings") or []) + ([] if available else ["Yahoo Finance did not provide usable fundamental metrics."]),
        "data_source": "Yahoo Finance",
        "available_fields": available_fields,
        "missing_fields": sorted(set(keys) - set(available_fields)),
    }


def _statement_records(frame: Any, info: dict[str, Any]) -> list[dict[str, Any]]:
    """Convert a yfinance statement frame to provider-neutral row records."""
    if frame is None or getattr(frame, "empty", True):
        return []
    raw_columns = getattr(frame, "columns", None)
    raw_index = getattr(frame, "index", None)
    # Pandas Index/DataFrame objects do not have a scalar truth value.  Avoid
    # `value or []`, which raises the DatetimeIndex ambiguity error.
    columns = list(raw_columns) if raw_columns is not None else []
    index = list(raw_index) if raw_index is not None else []
    records: list[dict[str, Any]] = []
    for column in columns:
        record: dict[str, Any] = {"period": str(column), "currency": info.get("currency") or info.get("financialCurrency")}
        for row in index:
            try:
                value = frame.loc[row, column]
            except Exception:
                continue
            record[str(row).strip().lower().replace(" ", "_")] = value
        records.append(record)
    return records


def score_fundamentals(data: dict[str, Any]) -> dict[str, Any]:
    m = data.get("metrics") or {}
    parts: list[float] = []
    evidence: list[str] = []
    warnings = list(data.get("warnings") or [])
    for key, label, rules in [
        ("revenue_growth", "Revenue growth", [(0.15, 85), (0.05, 65), (0.0, 50)]),
        ("earnings_growth", "Earnings growth", [(0.15, 85), (0.05, 65), (0.0, 50)]),
        ("profit_margin", "Profit margin", [(0.20, 85), (0.10, 65), (0.0, 45)]),
        ("operating_margin", "Operating margin", [(0.20, 85), (0.10, 65), (0.0, 45)]),
        ("roe", "Return on equity", [(0.20, 85), (0.12, 65), (0.0, 45)]),
        ("interest_coverage", "Interest coverage", [(8, 85), (3, 65), (1, 45)]),
    ]:
        value = m.get(key)
        if value is not None:
            parts.append(_score(value, rules) or 0)
            evidence.append(f"{label}: {value}")
    if not data.get("financial_sector"):
        value = m.get("debt_to_equity")
        if value is not None:
            parts.append(_score(value, [(50, 85), (100, 65), (200, 45)], inverse=True) or 0)
            evidence.append(f"Debt/equity: {value}")
        else:
            warnings.append("Debt/equity unavailable for a non-financial company.")
        for key, label in (("operating_cash_flow", "Operating cash flow"), ("free_cash_flow", "Free cash flow")):
            if m.get(key) is not None:
                evidence.append(f"{label}: {m[key]}")
    else:
        warnings.append("Debt/equity and cash-flow tests are not applied as industrial-company tests to financial sectors.")
    if m.get("pe_ratio") is not None:
        evidence.append(f"Trailing P/E: {m['pe_ratio']} (valuation context, not business quality)")
    score = sum(parts) / len(parts) if len(parts) >= 3 else None
    if score is None:
        warnings.append("At least three usable quality metrics are required for a fundamental score.")
    values = {
        **m,
        "sector": data.get("sector"),
        "industry": data.get("industry"),
        "company_name": data.get("company_name"),
        "website": data.get("website"),
        "country": data.get("country"),
        "period": data.get("period"),
        "currency": data.get("currency"),
        "annual_results": data.get("annual_results", []),
        "quarterly_results": data.get("quarterly_results", []),
        "statement_status": data.get("statement_status", "unavailable"),
        "retrieved_at": data.get("retrieved_at"),
        "data_source": data.get("data_source", "Yahoo Finance"),
        "available_fields": data.get("available_fields", []),
        "missing_fields": data.get("missing_fields", []),
    }
    return _component("Fundamental strength", score, values, evidence, warnings)


def score_technicals(history) -> dict[str, Any]:
    technicals = calculate_technicals(history)
    if not technicals.get("is_valid"):
        return _component("Technical strength", None, {}, [], [technicals.get("error", "Technical data unavailable.")])
    parts: list[float] = []
    evidence: list[str] = []
    trend = technicals.get("trend")
    trend_score = {"Bullish": 80, "Sideways": 50, "Bearish": 20}.get(trend)
    if trend_score is not None:
        parts.append(trend_score); evidence.append(f"Trend: {trend}")
    rsi = _number(technicals.get("rsi"))
    if rsi is not None:
        parts.append(70 if 45 <= rsi <= 65 else 55 if 35 <= rsi <= 70 else 30)
        evidence.append(f"RSI: {rsi}")
    macd = technicals.get("macd") or {}
    histogram = _number(macd.get("histogram"))
    if histogram is not None:
        parts.append(70 if histogram > 0 else 30)
        evidence.append(f"MACD histogram: {histogram}")
    score = sum(parts) / len(parts) if len(parts) >= 2 else None
    warnings = [] if score is not None else ["Insufficient valid indicator history for a technical score."]
    return _component("Technical strength", score, technicals, evidence, warnings)


def score_news(news: dict[str, Any]) -> dict[str, Any]:
    status = (news.get("freshness") or {}).get("status")
    if not news.get("is_valid"):
        return _component(
            "News and sentiment",
            None,
            {
                "status": "unavailable",
                "article_count": 0,
                "articles": [],
                "provider_error": news.get("provider_error") or news.get("error"),
            },
            [],
            ["Current news is temporarily unavailable."],
        )
    sentiment = str(news.get("overall_sentiment") or "").lower()
    articles = [
        {**article, "event_category": article.get("event_category") or classify_event(article.get("headline"))}
        for article in (news.get("top_headlines") or [])
        if isinstance(article, dict)
    ]
    score = {"positive": 75.0, "neutral": 50.0, "negative": 25.0}.get(sentiment)
    if status == "historical" or news.get("historical_only"):
        return _component("News and sentiment", score, {"status": "historical", "article_count": news.get("news_frequency_count", 0), "articles": articles}, [f"Historical sentiment: {sentiment or 'unknown'}"], ["Historical news is not current evidence."])
    return _component("News and sentiment", score, {"status": "current", "article_count": news.get("news_frequency_count", 0), "articles": articles}, [f"Current sentiment: {sentiment or 'unknown'}"], [])


def detect_hype(history, news: dict[str, Any]) -> dict[str, Any]:
    signals: list[dict[str, Any]] = []
    if history is not None and len(history) >= 21:
        closes = history["Close"].astype(float)
        change = _number(closes.iloc[-1] / closes.iloc[-21] - 1)
        if change is not None:
            signals.append({"name": "20-session price change", "value": change, "score": 80 if change >= 0.15 else 65 if change >= 0.08 else 30, "baseline": "20 sessions"})
        if "Volume" in history:
            volume = history["Volume"].astype(float)
            baseline = _number(volume.iloc[-21:-1].mean())
            latest = _number(volume.iloc[-1])
            if baseline and latest is not None and baseline > 0:
                ratio = latest / baseline
                signals.append({"name": "Latest volume ratio", "value": ratio, "score": 80 if ratio >= 2 else 65 if ratio >= 1.5 else 30, "baseline": "prior 20-session average"})
    article_count = _number(news.get("news_frequency_count"))
    if article_count is not None and news.get("is_current") is True:
        signals.append({"name": "Current article volume", "value": article_count, "score": 70 if article_count >= 8 else 45, "baseline": "current provider limit; not social-media measurement"})
    if len(signals) < 2:
        return {"status": "insufficient_evidence", "score": None, "category": "Insufficient evidence", "signals": signals, "warnings": ["At least two reliable attention or momentum signals are required."]}
    score = sum(item["score"] for item in signals) / len(signals)
    category = "Elevated attention" if score >= 65 else "Ordinary attention"
    return {"status": "available", "score": round(score, 2), "category": category, "signals": signals, "warnings": ["Social-media attention is not measured."]}


def compare_components(fundamental: dict[str, Any], technical: dict[str, Any], news: dict[str, Any], hype: dict[str, Any]) -> dict[str, Any]:
    fs, hs = fundamental.get("score"), hype.get("score")
    ts = technical.get("score")
    if hs is None or fs is None:
        classification = "Insufficient evidence"
    elif hs >= 65 and fs < 50:
        classification = "Attention exceeds demonstrated business strength"
    elif fs >= 65 and hs < 50:
        classification = "Business strength exceeds current attention"
    elif fs >= 60 and hs >= 50:
        classification = "Strength and attention broadly aligned"
    elif ts is not None and ts >= 65 and fs < 60:
        classification = "Momentum without sufficient fundamental confirmation"
    else:
        classification = "Mixed evidence"
    evidence = [f"Fundamental score: {fs}", f"Hype score: {hs}", f"Technical score: {ts}"]
    return {"classification": classification, "evidence": evidence, "contradictory_evidence": news.get("evidence", []), "limitations": ["This is an analytical comparison, not a valuation conclusion or recommendation."]}


def analyze_strength(symbol: str) -> dict[str, Any]:
    normalized = normalize_symbol(symbol)
    fundamentals_raw = fetch_fundamentals(normalized)
    fundamentals = score_fundamentals(fundamentals_raw)
    history = get_historical_data(normalized)
    technical = score_technicals(history)
    try:
        news_raw = process_stock_news(normalized)
    except Exception as error:
        news_raw = {"is_valid": False, "error": f"News processing failed: {error}", "top_headlines": []}
    news = score_news(news_raw)
    hype = detect_hype(history, news_raw)
    comparison = compare_components(fundamentals, technical, news, hype)
    event_risk = build_event_risk((news.get("values") or {}).get("articles") or [])
    news.setdefault("values", {})["event_risk"] = event_risk
    components = {"fundamentals": fundamentals, "technical": technical, "news": news, "hype": hype}
    weights = {"fundamentals": 0.35, "technical": 0.30, "news": 0.20, "hype": 0.15}
    eligible = [(key, component["score"], weights[key]) for key, component in components.items() if component.get("score") is not None]
    weight_total = sum(weight for _, _, weight in eligible)
    overall = sum(score * weight for _, score, weight in eligible) / weight_total if len(eligible) >= 2 and weight_total >= 0.5 else None
    return {
        "symbol": normalized,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "available" if overall is not None else "insufficient_data",
        "overall": {"score": round(overall, 2) if overall is not None else None, "eligible_components": [key for key, _, _ in eligible], "effective_weights": {key: round(weight / weight_total, 4) for key, _, weight in eligible}, "explanation": "Weighted eligible component scores; missing components are excluded and weights are renormalized."},
        "components": components,
        "comparison": comparison,
        "event_risk": event_risk,
        "limitations": ["Scores are heuristics based on available provider data and are not forecasts or investment advice."],
    }
