import unittest
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import requests

from Rag_model.news import fetch_news


class NewsFreshnessTests(unittest.TestCase):
    def setUp(self):
        self._state_directory = tempfile.TemporaryDirectory()
        self._state_patch = patch.object(
            fetch_news,
            "NEWS_PROVIDER_STATE_PATH",
            Path(self._state_directory.name) / "provider-state.json",
        )
        self._state_patch.start()
        self.addCleanup(self._state_patch.stop)
        self.addCleanup(self._state_directory.cleanup)

    def test_tcs_uses_company_alias_and_can_fall_back_to_labeled_historical_news(self):
        terms = fetch_news.build_search_terms("TCS")
        self.assertEqual(terms["company_name"], "Tata Consultancy Services")

        now = datetime.now(timezone.utc)
        historical_article = {
            "headline": "TCS historical results context",
            "source": "Test Source",
            "url": "https://example.test/tcs-history",
            "published_date": (now - timedelta(days=14)).isoformat(),
            "summary": "Historical TCS context.",
        }

        def mocked_range(*args, max_age_days, **kwargs):
            return [] if max_age_days == 7 else [historical_article]

        with patch.object(fetch_news, "_fetch_newsapi_articles_for_range", side_effect=mocked_range), patch.dict(
            fetch_news.os.environ,
            {"NEWSAPI_API_KEY": "test-only", "NEWS_PROVIDER": "newsapi"},
            clear=False,
        ):
            result = fetch_news._fetch_from_newsapi("TCS", 10)

        self.assertTrue(result["is_valid"])
        self.assertTrue(result["historical_only"])
        self.assertEqual(result["freshness"]["status"], "historical")
        self.assertEqual(result["articles"][0]["published_date"], historical_article["published_date"])

    def test_working_stock_keeps_current_news_status(self):
        now = datetime.now(timezone.utc)
        current_article = {
            "headline": "Reliance current market update",
            "source": "Test Source",
            "url": "https://example.test/reliance-current",
            "published_date": (now - timedelta(hours=2)).isoformat(),
            "summary": "Current Reliance context.",
        }

        with patch.object(fetch_news, "_fetch_newsapi_articles_for_range", return_value=[current_article]), patch.dict(
            fetch_news.os.environ,
            {"NEWSAPI_API_KEY": "test-only", "NEWS_PROVIDER": "newsapi"},
            clear=False,
        ):
            result = fetch_news._fetch_from_newsapi("RELIANCE", 10)

        self.assertTrue(result["is_valid"])
        self.assertFalse(result["historical_only"])
        self.assertEqual(result["freshness"]["status"], "current")

    def test_clean_articles_filters_invalid_and_old_news_sorts_newest_first_and_deduplicates(self):
        now = datetime.now(timezone.utc)
        articles = [
            {"headline": "Older", "url": "https://example.test/old", "source": "Source", "published_date": (now - timedelta(days=2)).isoformat()},
            {"headline": "Newest", "url": "https://example.test/new", "source": "Source", "published_date": (now - timedelta(hours=1)).isoformat()},
            {"headline": "Duplicate", "url": "https://example.test/new", "source": "Other", "published_date": (now - timedelta(hours=2)).isoformat()},
            {"headline": "Newest", "url": "https://mirror.example.test/new", "source": "Mirror", "published_date": (now - timedelta(minutes=30)).isoformat()},
            {"headline": "Too old", "url": "https://example.test/stale", "source": "Source", "published_date": (now - timedelta(days=8)).isoformat()},
            {"headline": "Invalid date", "url": "https://example.test/invalid", "source": "Source", "published_date": "not-a-date"},
        ]
        result = fetch_news._clean_articles(articles)
        self.assertEqual([article["headline"] for article in result], ["Newest", "Older"])

    def test_finnhub_invalid_timestamp_is_not_allowed_to_escape_or_become_current(self):
        parsed = fetch_news._parse_finnhub_article({"headline": "Broken", "url": "https://example.test", "datetime": "not-a-timestamp"})
        self.assertIsNone(parsed["published_date"])
        self.assertEqual(fetch_news._clean_articles([parsed]), [])

    def test_provider_failure_returns_truthful_empty_result(self):
        response = requests.Response()
        response.status_code = 429
        response.reason = "Too Many Requests"
        error = requests.HTTPError(response=response)

        with patch.object(fetch_news.requests, "get", side_effect=error), patch.dict(
            fetch_news.os.environ,
            {"FINNHUB_API_KEY": "test-only", "NEWS_PROVIDER": "finnhub"},
            clear=False,
        ):
            result = fetch_news.get_stock_news("RELIANCE")

        self.assertFalse(result["is_valid"])
        self.assertEqual(result["articles"], [])
        self.assertIn("429", result["error"])
        self.assertEqual(result["freshness"]["status"], "unavailable")

    def test_newsapi_malformed_json_is_reported_as_provider_failure(self):
        response = requests.Response()
        response.status_code = 200
        response._content = b"not-json"
        response.headers["content-type"] = "application/json"
        with patch.object(fetch_news.requests, "get", return_value=response), patch.object(
            fetch_news,
            "_fetch_google_news_articles",
            return_value=[],
        ), patch.dict(
            fetch_news.os.environ,
            {"NEWSAPI_API_KEY": "test-only", "NEWS_PROVIDER": "newsapi", "NEWS_ALLOW_FINNHUB_FALLBACK": "false"},
            clear=False,
        ):
            result = fetch_news.get_stock_news("RELIANCE")
        self.assertFalse(result["is_valid"])
        self.assertEqual(result["articles"], [])
        self.assertEqual(result["provider"], "newsapi")

    def test_newsapi_connection_failure_uses_google_fallback_when_available(self):
        historical_article = {
            "headline": "Reliance fallback market update",
            "source": "Google News",
            "url": "https://example.test/reliance-fallback",
            "published_date": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat(),
            "summary": "Fallback article for a provider outage.",
        }

        with patch.object(fetch_news.requests, "get", side_effect=requests.ConnectionError("network unavailable")), patch.object(
            fetch_news,
            "_fetch_google_news_articles",
            side_effect=lambda _symbol, _limit, max_age_days=7: [historical_article] if max_age_days > 7 else [],
        ), patch.dict(
            fetch_news.os.environ,
            {"NEWSAPI_API_KEY": "test-only", "NEWS_PROVIDER": "newsapi", "NEWS_ALLOW_FINNHUB_FALLBACK": "false"},
            clear=False,
        ):
            result = fetch_news.get_stock_news("RELIANCE")

        self.assertTrue(result["is_valid"])
        self.assertEqual(result["provider"], "google_news")
        self.assertTrue(result["historical_only"])
        self.assertEqual(result["article_count"], 1)

    def test_newsapi_426_stops_historical_retries_and_uses_fallback(self):
        response = requests.Response()
        response.status_code = 426
        response.reason = "Upgrade Required"
        response._content = b'{"status":"error","code":"apiKeyExhausted","message":"Upgrade required"}'
        response.headers["content-type"] = "application/json"
        historical_article = {
            "headline": "Historical TCS results context",
            "source": "Google News",
            "url": "https://example.test/tcs-history",
            "published_date": (datetime.now(timezone.utc) - timedelta(days=14)).isoformat(),
            "summary": "Historical TCS context.",
        }

        def google_fallback(_symbol, _limit, max_age_days=7):
            return [historical_article] if max_age_days > 7 else []

        with patch.object(fetch_news.requests, "get", return_value=response) as request, patch.object(
            fetch_news,
            "_fetch_google_news_articles",
            side_effect=google_fallback,
        ), patch.dict(
            fetch_news.os.environ,
            {"NEWSAPI_API_KEY": "test-only", "NEWS_PROVIDER": "newsapi", "NEWS_ALLOW_FINNHUB_FALLBACK": "false"},
            clear=False,
        ):
            result = fetch_news.get_stock_news("TCS")

        self.assertTrue(result["is_valid"])
        self.assertEqual(result["provider"], "google_news")
        self.assertTrue(result["historical_only"])
        self.assertEqual(result["freshness"]["status"], "historical")
        self.assertEqual(request.call_count, 1)

    def test_newsapi_426_response_body_is_retained_only_in_diagnostic_exception(self):
        response = requests.Response()
        response.status_code = 426
        response.reason = "Upgrade Required"
        response._content = b'{"status":"error","code":"apiKeyExhausted","message":"Upgrade required"}'
        response.headers["content-type"] = "application/json"

        with self.assertRaises(fetch_news._NewsApiAccessRestriction) as raised:
            with patch.object(fetch_news.requests, "get", return_value=response):
                fetch_news._fetch_newsapi_query("TCS", "test-only", "2026-10-20")

        self.assertIn("Upgrade required", raised.exception.detail)

    def test_newsapi_429_persists_cooldown_and_does_not_retry_quota(self):
        response = requests.Response()
        response.status_code = 429
        response.reason = "Too Many Requests"
        response.headers["Retry-After"] = "120"
        article = {
            "headline": "Reliance fallback headline",
            "source": "Google News",
            "url": "https://example.test/reliance-fallback",
            "published_date": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(),
            "summary": "Fallback article.",
        }

        with tempfile.TemporaryDirectory() as directory, patch.object(
            fetch_news, "NEWS_PROVIDER_STATE_PATH", Path(directory) / "provider-state.json"
        ), patch.object(fetch_news.requests, "get", return_value=response) as request, patch.object(
            fetch_news, "_fetch_google_news_articles", return_value=[article]
        ), patch.dict(
            fetch_news.os.environ,
            {"NEWSAPI_API_KEY": "test-only", "NEWS_PROVIDER": "newsapi"},
            clear=False,
        ):
            first = fetch_news._fetch_from_newsapi("RELIANCE", 10)
            self.assertTrue(first["is_valid"])
            self.assertEqual(first["provider"], "google_news")
            self.assertEqual(request.call_count, 1)

            request.reset_mock()
            second = fetch_news._fetch_from_newsapi("RELIANCE", 10)
            self.assertTrue(second["is_valid"])
            self.assertEqual(second["provider"], "google_news")
            request.assert_not_called()

            state = fetch_news._read_provider_state()
            self.assertEqual(state["newsapi"]["reason"], "rate_limited")
            self.assertGreater(state["newsapi"]["cooldown_until"], time.time())

    def test_missing_news_credentials_returns_unavailable_without_provider_call(self):
        with patch.dict(
            fetch_news.os.environ,
            {"NEWSAPI_API_KEY": "", "FINNHUB_API_KEY": ""},
            clear=False,
        ), patch.object(fetch_news.requests, "get") as request:
            result = fetch_news.get_stock_news("TCS")

        self.assertFalse(result["is_valid"])
        self.assertEqual(result["freshness"]["status"], "unavailable")
        request.assert_not_called()

    def test_news_result_limit_is_bounded_to_three_through_seven(self):
        captured = []

        def fake_fetch(symbol, limit):
            captured.append(limit)
            return {"is_valid": False, "articles": [], "freshness": {"status": "unavailable"}}

        with patch.object(fetch_news, "_fetch_from_newsapi", side_effect=fake_fetch), patch.dict(
            fetch_news.os.environ,
            {"NEWSAPI_API_KEY": "test-only", "NEWS_PROVIDER": "newsapi"},
            clear=False,
        ):
            fetch_news.get_stock_news("TCS", limit=99)
            fetch_news.get_stock_news("TCS", limit=1)

        self.assertEqual(captured, [7, 3])

    def test_thin_newsapi_result_is_supplemented_by_google_and_capped_at_seven(self):
        now = datetime.now(timezone.utc)
        articles = [
            {
                "headline": f"TCS company update {index}",
                "source": "Test Source",
                "url": f"https://example.test/tcs-{index}",
                "published_date": (now - timedelta(hours=index)).isoformat(),
                "summary": "TCS stock earnings and market update.",
            }
            for index in range(3)
        ]
        with patch.object(fetch_news, "_fetch_newsapi_articles_for_range", return_value=articles[:1]), patch.object(
            fetch_news, "_fetch_google_news_articles", return_value=articles[1:]
        ), patch.dict(
            fetch_news.os.environ,
            {"NEWSAPI_API_KEY": "test-only", "NEWS_PROVIDER": "newsapi"},
            clear=False,
        ):
            result = fetch_news._fetch_from_newsapi("TCS", 7)

        self.assertTrue(result["is_valid"])
        self.assertEqual(result["article_count"], 3)
        self.assertEqual([article["headline"] for article in result["articles"]], [
            "TCS company update 0", "TCS company update 1", "TCS company update 2"
        ])


if __name__ == "__main__":
    unittest.main()
