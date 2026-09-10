"""Manual test runner for the FinSense AI market engine."""

from __future__ import annotations

from pprint import pprint

try:
    from .scanner import scan_stocks
    from .stocks import get_historical_data, get_stock_info
    from .technicals import calculate_technicals
except ImportError:
    from scanner import scan_stocks
    from stocks import get_historical_data, get_stock_info
    from technicals import calculate_technicals


TEST_SYMBOLS = ["RELIANCE.NS", "TCS.NS", "INFY.NS"]


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
