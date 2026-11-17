import unittest
from unittest.mock import patch

from Rag_model.pipeline import rag_service


class CachedStockBatchTests(unittest.TestCase):
    def test_cached_batch_reads_each_symbol_in_one_service_process(self):
        with patch.object(
            rag_service,
            "get_stock",
            side_effect=lambda symbol, **_: {"symbol": symbol, "found": True},
        ) as get_stock:
            result = rag_service.get_cached_stocks(["RELIANCE", "TCS"], include_news=True)

        self.assertEqual(result, [
            {"symbol": "RELIANCE", "found": True},
            {"symbol": "TCS", "found": True},
        ])
        self.assertEqual(get_stock.call_count, 2)
        self.assertTrue(all(call.kwargs["cached_only"] for call in get_stock.call_args_list))

    def test_batch_can_refresh_stale_or_missing_records(self):
        with patch.object(
            rag_service,
            "get_stock",
            side_effect=lambda symbol, **_: {"symbol": symbol, "found": True},
        ) as get_stock:
            rag_service.get_cached_stocks(["RELIANCE"], include_news=True, cached_only=False)

        self.assertFalse(get_stock.call_args_list[0].kwargs["cached_only"])


if __name__ == "__main__":
    unittest.main()
