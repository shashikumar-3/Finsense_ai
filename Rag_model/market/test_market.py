"""Manual test runner for the FinSense AI market engine."""

from __future__ import annotations

from pprint import pprint
import unittest
from unittest.mock import patch

import pandas as pd

try:
    from .scanner import scan_stocks
    from .stocks import get_historical_data, get_stock_info
    from .technicals import calculate_technicals
except ImportError:
    from scanner import scan_stocks
    from stocks import get_historical_data, get_stock_info
    from technicals import calculate_technicals


TEST_SYMBOLS = ["RELIANCE.NS", "TCS.NS", "INFY.NS"]


class FakeTicker:
    fast_info = {"last_price": 100, "previous_close": 99, "last_volume": 1000, "market_cap": 1000000}
    info = {
        "longName": "Example Industries Limited",
        "sector": "Industrials",
        "industry": "Specialty Industrial Machinery",
        "currency": "INR",
        "trailingPE": 18.2,
    }

    def history(self, **kwargs):
        return pd.DataFrame({"Close": [99, 100]})


class StockMetadataTests(unittest.TestCase):
    def test_company_metadata_is_normalized_from_yahoo_info(self):
        with patch("Rag_model.market.stocks.yf.Ticker", return_value=FakeTicker()):
            result = get_stock_info("EXAMPLE")
        self.assertEqual(result["sector"], "Industrials")
        self.assertEqual(result["industry"], "Specialty Industrial Machinery")
        self.assertEqual(result["company_name"], "Example Industries Limited")
        self.assertEqual(result["metadata_source"], "Yahoo Finance")


def run_single_stock_test(symbol: str) -> None:
    print("=" * 80)
    print(f"Testing symbol: {symbol}")

    stock_info = get_stock_info(symbol)
    print("\n1. Stock info")
    pprint(stock_info)

    historical_data = get_historical_data(symbol)
    print("\n2. Historical data")
    print(f"Rows fetched: {len(historical_data)}")
    if not historical_data.empty:
        print(historical_data.tail(3).to_string(index=False))

    technicals = calculate_technicals(historical_data)
    print("\n3. Technical analysis")
    pprint(technicals)


def run_scanner_test() -> None:
    print("=" * 80)
    print("4. Batch scanner output")
    results = scan_stocks(TEST_SYMBOLS)
    for result in results:
        pprint(result)
        print("-" * 80)


def main() -> None:
    for symbol in TEST_SYMBOLS:
        run_single_stock_test(symbol)
    run_scanner_test()


if __name__ == "__main__":
    main()
