"""Multi-stock scanner for FinSense AI."""

from __future__ import annotations

from typing import Any

try:
    from .stocks import get_historical_data, get_stock_info, normalize_symbol
    from .technicals import calculate_technicals
except ImportError:
    from stocks import get_historical_data, get_stock_info, normalize_symbol
    from technicals import calculate_technicals


def analyze_stock(symbol: str) -> dict[str, Any]:
    """Run the full market analysis pipeline for one stock."""

    normalized_symbol = normalize_symbol(symbol)
    stock_info = get_stock_info(normalized_symbol)

    if not stock_info.get("is_valid"):
        return {
            "symbol": normalized_symbol,
            "is_valid": False,
            "error": stock_info.get("error", "Unable to fetch stock information."),
        }

    historical_data = get_historical_data(normalized_symbol)
    if historical_data.empty:
        return {
            "symbol": normalized_symbol,
            "is_valid": False,
            "error": "Historical data is not available.",
        }

    technicals = calculate_technicals(historical_data)
    if not technicals.get("is_valid"):
        return {
            "symbol": normalized_symbol,
            "is_valid": False,
            "error": technicals.get("error", "Technical analysis failed."),
        }

    return {
        "symbol": normalized_symbol,
        "is_valid": True,
        "price": stock_info.get("current_price"),
        "previous_close": stock_info.get("previous_close"),
        "day_high": stock_info.get("day_high"),
        "day_low": stock_info.get("day_low"),
        "volume": stock_info.get("volume"),
        "market_cap": stock_info.get("market_cap"),
        "pe_ratio": stock_info.get("pe_ratio"),
        "sector": stock_info.get("sector"),
        "industry": stock_info.get("industry"),
        "rsi": technicals.get("rsi"),
        "trend": technicals.get("trend"),
        "sma_20": technicals.get("sma_20"),
        "sma_50": technicals.get("sma_50"),
        "sma_200": technicals.get("sma_200"),
        "ema_20": technicals.get("ema_20"),
        "macd": technicals.get("macd"),
        "bollinger_bands": technicals.get("bollinger_bands"),
        "volume_average": technicals.get("volume_average"),
        "historical_rows": len(historical_data),
        "technical_snapshot_date": technicals.get("date"),
    }


def scan_stocks(symbols: list[str]) -> list[dict[str, Any]]:
    """Run the analysis engine over many NSE stocks without failing the full batch."""

    results: list[dict[str, Any]] = []

    for symbol in symbols:
        try:
            results.append(analyze_stock(symbol))
        except Exception as error:
            results.append(
                {
                    "symbol": normalize_symbol(symbol),
                    "is_valid": False,
                    "error": f"Unexpected scanner failure: {error}",
                }
            )

    return results
