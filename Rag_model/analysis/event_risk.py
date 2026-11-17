"""Conservative, evidence-linked recent-event risk classification."""

from __future__ import annotations

from typing import Any


EVENT_RULES = (
    ("financial_results", ("quarterly results", "annual results", "earnings", "net profit", "revenue")),
    ("regulatory_legal", ("sebi", "regulator", "court", "legal", "investigation", "penalty", "lawsuit")),
    ("management_change", ("resigns", "resignation", "appoints", "appointed", "chief executive", "chief financial")),
    ("capital_action", ("dividend", "buyback", "stock split", "bonus issue")),
    ("debt_liquidity", ("default", "debt", "liquidity", "credit rating downgrade")),
    ("operational_incident", ("cyber", "fire", "shutdown", "outage", "disruption")),
    ("contract_or_order", ("order win", "contract", "deal", "acquisition")),
)


def classify_event(headline: Any) -> str | None:
    text = str(headline or "").lower()
    if not text:
        return None
    for category, keywords in EVENT_RULES:
        if any(keyword in text for keyword in keywords):
            return category
    return None


def build_event_risk(articles: list[dict[str, Any]] | None) -> dict[str, Any]:
    evidence = []
    for article in articles or []:
        category = article.get("event_category") or classify_event(article.get("headline"))
        if category in {"regulatory_legal", "debt_liquidity", "operational_incident", "management_change"}:
            evidence.append({
                "category": category,
                "headline": article.get("headline"),
                "published_date": article.get("published_date"),
                "source": article.get("source"),
                "url": article.get("url"),
            })
    if not articles:
        return {"status": "unavailable", "level": "unavailable", "evidence": [], "warnings": ["No validated news evidence is available."]}
    return {
        "status": "available",
        "level": "elevated" if evidence else "no_specific_event_flag",
        "evidence": evidence,
        "warnings": ["Event risk is evidence monitoring, not a prediction of price movement."],
    }
