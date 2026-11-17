"""Pure financial-statement normalization and calculation helpers.

The provider adapter supplies Yahoo Finance rows to this module.  These
functions deliberately return ``None`` when an input is missing or unsuitable;
missing financial evidence must never be represented as zero.
"""

from __future__ import annotations

import math
from typing import Any, Iterable


def number(value: Any) -> float | None:
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def growth(current: Any, previous: Any) -> float | None:
    current_value, previous_value = number(current), number(previous)
    if current_value is None or previous_value is None or previous_value == 0:
        return None
    return (current_value - previous_value) / abs(previous_value)


def ratio(numerator: Any, denominator: Any) -> float | None:
    numerator_value, denominator_value = number(numerator), number(denominator)
    if numerator_value is None or denominator_value in (None, 0):
        return None
    return numerator_value / denominator_value


def margin(profit: Any, revenue: Any) -> float | None:
    return ratio(profit, revenue)


def free_cash_flow(operating_cash_flow: Any, capital_expenditure: Any) -> float | None:
    operating, capex = number(operating_cash_flow), number(capital_expenditure)
    if operating is None or capex is None:
        return None
    # Yahoo commonly reports capital expenditure as a negative cash flow.
    return operating + capex if capex < 0 else operating - capex


def _row_value(record: dict[str, Any], *names: str) -> float | None:
    for name in names:
        if name in record:
            value = number(record[name])
            if value is not None:
                return value
    return None


def normalize_period_records(records: Iterable[dict[str, Any]], period_type: str, source: str = "Yahoo Finance") -> list[dict[str, Any]]:
    """Normalize statement records while preserving reporting periods and units."""
    normalized: list[dict[str, Any]] = []
    for record in records:
        period = record.get("period") or record.get("date") or record.get("end_date")
        if not period:
            continue
        revenue = _row_value(record, "revenue", "total_revenue", "Total Revenue")
        operating_profit = _row_value(record, "operating_profit", "operating_income", "Operating Income")
        net_profit = _row_value(record, "net_profit", "net_income", "Net Income", "Net Income Common Stockholders")
        eps = _row_value(record, "eps", "diluted_eps", "Diluted EPS")
        item = {
            "period": str(period),
            "period_type": period_type,
            "source": source,
            "currency": record.get("currency"),
            "revenue": revenue,
            "operating_profit": operating_profit,
            "net_profit": net_profit,
            "eps": eps,
            "operating_margin": margin(operating_profit, revenue),
            "net_profit_margin": margin(net_profit, revenue),
        }
        normalized.append(item)

    normalized.sort(key=lambda item: item["period"], reverse=True)
    for index, item in enumerate(normalized):
        previous = normalized[index + 1] if index + 1 < len(normalized) else None
        item["revenue_growth"] = growth(item["revenue"], previous.get("revenue") if previous else None)
        item["net_profit_growth"] = growth(item["net_profit"], previous.get("net_profit") if previous else None)
    return normalized


def build_statement_summary(annual: Iterable[dict[str, Any]] = (), quarterly: Iterable[dict[str, Any]] = (), warnings: list[str] | None = None) -> dict[str, Any]:
    annual_records = normalize_period_records(annual, "annual")
    quarterly_records = normalize_period_records(quarterly, "quarterly")
    result_warnings = list(warnings or [])
    if not annual_records:
        result_warnings.append("Annual financial statements are unavailable from the current provider.")
    if not quarterly_records:
        result_warnings.append("Quarterly financial statements are unavailable from the current provider.")
    return {
        "annual_results": annual_records,
        "quarterly_results": quarterly_records,
        "status": "available" if annual_records or quarterly_records else "unavailable",
        "warnings": result_warnings,
    }
