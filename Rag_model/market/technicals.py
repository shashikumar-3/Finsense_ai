"""Technical analysis helpers for FinSense AI market engine."""

from __future__ import annotations

from typing import Any

import pandas as pd

try:
    import pandas_ta as ta
except ImportError:
    ta = None


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _get_first_matching_value(row: pd.Series, prefixes: tuple[str, ...]) -> Any:
    for prefix in prefixes:
        for column_name in row.index:
            if str(column_name).startswith(prefix):
                return row.get(column_name)
    return None


def _derive_trend(close: float | None, sma_20: float | None, sma_50: float | None, sma_200: float | None) -> str:
    if close is None:
        return "Unknown"

    bullish = all(value is not None for value in (sma_20, sma_50, sma_200)) and close > sma_20 > sma_50 > sma_200
    bearish = all(value is not None for value in (sma_20, sma_50, sma_200)) and close < sma_20 < sma_50 < sma_200

    if bullish:
        return "Bullish"
    if bearish:
        return "Bearish"
    return "Sideways"


def calculate_technicals(df: pd.DataFrame) -> dict[str, Any]:
    """Calculate reusable technical indicators from OHLCV history."""

    if ta is None:
        return {
            "is_valid": False,
            "error": "pandas_ta is not installed in the current environment.",
        }

    required_columns = {"Date", "Open", "High", "Low", "Close", "Volume"}
    if df is None or df.empty or not required_columns.issubset(df.columns):
        return {
            "is_valid": False,
            "error": "Historical data is empty or missing required columns.",
        }

    working_df = df.copy()
    working_df["Date"] = pd.to_datetime(working_df["Date"])
    working_df = working_df.sort_values("Date").reset_index(drop=True)

    close = working_df["Close"]
    high = working_df["High"]
    low = working_df["Low"]
    volume = working_df["Volume"]

    working_df["rsi"] = ta.rsi(close, length=14)
    working_df["sma_20"] = ta.sma(close, length=20)
    working_df["sma_50"] = ta.sma(close, length=50)
    working_df["sma_200"] = ta.sma(close, length=200)
    working_df["ema_20"] = ta.ema(close, length=20)

    macd_df = ta.macd(close, fast=12, slow=26, signal=9)
    bbands_df = ta.bbands(close, length=20, std=2)

    if macd_df is not None:
        working_df = pd.concat([working_df, macd_df], axis=1)
    if bbands_df is not None:
        working_df = pd.concat([working_df, bbands_df], axis=1)

    working_df["volume_average"] = ta.sma(volume, length=20)

    latest = working_df.iloc[-1]

    close_value = _to_float(latest.get("Close"))
    sma_20 = _to_float(latest.get("sma_20"))
    sma_50 = _to_float(latest.get("sma_50"))
    sma_200 = _to_float(latest.get("sma_200"))

    macd_value = _to_float(_get_first_matching_value(latest, ("MACD_",)))
    macd_histogram = _to_float(_get_first_matching_value(latest, ("MACDh_",)))
    macd_signal = _to_float(_get_first_matching_value(latest, ("MACDs_",)))

    upper_band = _to_float(_get_first_matching_value(latest, ("BBU_",)))
    middle_band = _to_float(_get_first_matching_value(latest, ("BBM_",)))
    lower_band = _to_float(_get_first_matching_value(latest, ("BBL_",)))

    return {
        "is_valid": True,
        "date": latest["Date"].strftime("%Y-%m-%d"),
        "close": close_value,
        "rsi": _to_float(latest.get("rsi")),
        "sma_20": sma_20,
        "sma_50": sma_50,
        "sma_200": sma_200,
        "ema_20": _to_float(latest.get("ema_20")),
        "macd": {
            "macd": macd_value,
            "signal": macd_signal,
            "histogram": macd_histogram,
        },
        "bollinger_bands": {
            "upper": upper_band,
            "middle": middle_band,
            "lower": lower_band,
        },
        "volume_average": _to_float(latest.get("volume_average")),
        "trend": _derive_trend(close_value, sma_20, sma_50, sma_200),
    }
