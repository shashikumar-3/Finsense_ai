import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from Rag_model.pipeline import retrieve


class NewsRefreshDecisionTests(unittest.TestCase):
    def test_empty_cached_news_refreshes_even_when_market_cache_is_fresh(self):
        now = datetime.now(timezone.utc).isoformat()
        existing = {
            "symbol": "VBL.NS",
            "document": {
                "symbol": "VBL.NS",
                "market": {"metadata_status": "available", "sector": "Consumer Defensive"},
                "news": {"is_valid": False, "articles": [], "is_current": False},
                "refresh_metadata": {"market_updated_at": now, "news_updated_at": now},
            },
        }
        refreshed = {"symbol": "VBL.NS", "found": True}

        with patch.object(retrieve, "get_item_by_symbol", return_value=existing), patch.object(
            retrieve, "upsert_single_stock", return_value=refreshed
        ) as upsert:
            result = retrieve.get_stock("VBL", include_news=True)

        self.assertEqual(result, refreshed)
        self.assertTrue(upsert.call_args.kwargs["refresh_news"])

    def test_thin_current_news_cache_refreshes_for_provider_supplement(self):
        now = datetime.now(timezone.utc).isoformat()
        existing = {
            "symbol": "TCS.NS",
            "document": {
                "symbol": "TCS.NS",
                "market": {"metadata_status": "available", "sector": "Technology"},
                "news": {"is_valid": True, "is_current": True, "articles": [{"headline": "One"}]},
                "refresh_metadata": {"market_updated_at": now, "news_updated_at": now},
            },
        }

        with patch.object(retrieve, "get_item_by_symbol", return_value=existing), patch.object(
            retrieve, "upsert_single_stock", return_value={"symbol": "TCS.NS", "found": True}
        ) as upsert:
            retrieve.get_stock("TCS", include_news=True)

        self.assertTrue(upsert.call_args.kwargs["refresh_news"])


if __name__ == "__main__":
    unittest.main()
