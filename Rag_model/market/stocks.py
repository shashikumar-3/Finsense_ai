"""Market data access helpers for FinSense AI.

This module is intentionally focused on raw stock data collection so it can be
reused by scanners, FastAPI routes, background jobs, and future RAG pipelines.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd
import yfinance as yf


# yfinance's default user-cache location can be unavailable on restricted
# Windows environments. Keep its small timezone cache inside the project data
# directory so quote and company-metadata retrieval can proceed normally.
YFINANCE_CACHE_DIR = Path(__file__).resolve().parents[2] / "data" / "yfinance_cache"
YFINANCE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
try:
    yf.set_tz_cache_location(str(YFINANCE_CACHE_DIR))
except Exception:
    # Metadata/quote retrieval remains best-effort if a provider version does
    # not expose the cache configuration hook.
    pass


INFO_FIELDS = {
    "current_price": ("last_price", "regularMarketPrice", "currentPrice"),
    "previous_close": ("previous_close", "regularMarketPreviousClose", "previousClose"),
    "day_high": ("day_high", "regularMarketDayHigh", "dayHigh"),
    "day_low": ("day_low", "regularMarketDayLow", "dayLow"),
    "volume": ("last_volume", "regularMarketVolume", "volume"),
    "market_cap": ("market_cap", "marketCap"),
}

HISTORY_PERIOD = "1y"
INFO_HISTORY_PERIOD = "1mo"


def normalize_symbol(symbol: str) -> str:
    """Normalize Indian stock symbols for Yahoo Finance.

    Examples:
    - RELIANCE -> RELIANCE.NS
    - RELIANCE.NS -> RELIANCE.NS
    """

    cleaned = (symbol or "").strip().upper()
    if not cleaned:
        return ""
    if cleaned.endswith(".NS"):
        return cleaned
    return f"{cleaned}.NS"


def _coalesce(info: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = info.get(key)
        if value is not None:
            return value
    return None


def _empty_history_frame() -> pd.DataFrame:
    return pd.DataFrame(columns=["Date", "Open", "High", "Low", "Close", "Volume"])


def _safe_fast_info_dict(ticker: yf.Ticker) -> dict[str, Any]:
    try:
        fast_info = ticker.fast_info
        return dict(fast_info.items()) if fast_info else {}
    except Exception:
        return {}


def validate_symbol(symbol: str) -> bool:
    """Return True when Yahoo Finance can provide data for the symbol."""

    normalized_symbol = normalize_symbol(symbol)
    if not normalized_symbol:
        return False

    try:
        ticker = yf.Ticker(normalized_symbol)
        history = ticker.history(period="5d", interval="1d", auto_adjust=False)
        return not history.empty
    except Exception:
        return False


def get_stock_info(symbol: str) -> dict[str, Any]:
    """Fetch current market snapshot and company metadata for one NSE stock."""

    normalized_symbol = normalize_symbol(symbol)
    if not normalized_symbol:
        return {
            "symbol": symbol,
            "is_valid": False,
            "error": "Symbol is required.",
        }

    try:
        ticker = yf.Ticker(normalized_symbol)
        fast_info = _safe_fast_info_dict(ticker)
        history = ticker.history(period=INFO_HISTORY_PERIOD, interval="1d", auto_adjust=False)
        # Yahoo exposes company classification and broader metadata through
        # `info`, while `fast_info` is intentionally limited to quote fields.
        # Keep this best-effort: a metadata failure must not invalidate a
        # usable market quote.
        try:
            company_info = dict(ticker.info or {})
        except Exception:
            company_info = {}

        if history.empty and not fast_info:
            return {
                "symbol": normalized_symbol,
                "is_valid": False,
                "error": "Invalid or unsupported NSE symbol.",
            }

        latest_close = None
        previous_close = None
        if not history.empty:
            latest_close = history["Close"].iloc[-1]
            if len(history) > 1:
                previous_close = history["Close"].iloc[-2]

        return {
            "symbol": normalized_symbol,
            "is_valid": True,
            "current_price": _coalesce(fast_info, *INFO_FIELDS["current_price"]) or latest_close,
            "previous_close": _coalesce(fast_info, *INFO_FIELDS["previous_close"]) or previous_close,
            "day_high": _coalesce(fast_info, *INFO_FIELDS["day_high"]),
            "day_low": _coalesce(fast_info, *INFO_FIELDS["day_low"]),
            "volume": _coalesce(fast_info, *INFO_FIELDS["volume"]),
            "market_cap": _coalesce(fast_info, *INFO_FIELDS["market_cap"]),
            "pe_ratio": _coalesce(company_info, "trailingPE", "forwardPE"),
            "sector": company_info.get("sector"),
            "industry": company_info.get("industry"),
            "company_name": company_info.get("longName") or company_info.get("shortName") or company_info.get("displayName"),
            "website": company_info.get("website"),
            "country": company_info.get("country"),
            "currency": company_info.get("currency") or company_info.get("financialCurrency"),
            "enterprise_value": company_info.get("enterpriseValue"),
            "shares_outstanding": company_info.get("sharesOutstanding"),
            "float_shares": company_info.get("floatShares"),
            "beta": company_info.get("beta"),
            "forward_pe": company_info.get("forwardPE"),
            "price_to_book": company_info.get("priceToBook"),
            "price_to_sales": company_info.get("priceToSalesTrailing12Months"),
            "metadata_source": "Yahoo Finance",
            "metadata_status": "available" if company_info.get("sector") or company_info.get("industry") else "unavailable",
        }
    except Exception as error:
        return {
            "symbol": normalized_symbol,
            "is_valid": False,
            "error": f"Failed to fetch stock info: {error}",
        }


def get_historical_data(symbol: str) -> pd.DataFrame:
    """Fetch full daily price history for one NSE stock.

    Yahoo Finance returns as much history as it has available. In practice this
    can span multiple decades for large Indian stocks.
    """

    normalized_symbol = normalize_symbol(symbol)
    if not normalized_symbol:
        return _empty_history_frame()

    try:
        ticker = yf.Ticker(normalized_symbol)
        history = ticker.history(period=HISTORY_PERIOD, interval="1d", auto_adjust=False)

        if history.empty:
            return _empty_history_frame()

        history = history.reset_index()
        history["Date"] = pd.to_datetime(history["Date"]).dt.tz_localize(None)

        required_columns = ["Date", "Open", "High", "Low", "Close", "Volume"]
        cleaned = history[required_columns].copy()
        cleaned = cleaned.dropna(subset=["Date", "Open", "High", "Low", "Close"])
        cleaned = cleaned.sort_values("Date").reset_index(drop=True)
        return cleaned
    except Exception:
        return _empty_history_frame()
