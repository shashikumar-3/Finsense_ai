import unittest

from Rag_model.llm.finrobot_agent import _build_prompt, build_agent_context, generate_finrobot_response


def stock_document(news):
    return {
        "symbol": "TCS.NS",
        "company_name": "Tata Consultancy Services",
        "market": {"is_valid": True, "price": 4000, "trend": "Bullish", "rsi": 55},
        "analysis": {
            "recommendation": "Review the setup with valuation and risk limits.",
            "market_summary": "Technical indicators are available.",
            "news_summary": "News context is available.",
        },
        "news": news,
    }


class FinrobotContextTests(unittest.TestCase):
    def test_strength_context_includes_visible_technical_facts_for_explanation(self):
        document = {
            "type": "strength",
            "symbol": "KOTAKBANK.NS",
            "strength": {
                "status": "available",
                "overall": {"score": 62.1},
                "components": {
                    "fundamentals": {"score": 77, "values": {"sector": "Financial Services"}},
                    "technical": {"score": 60, "values": {"close": 2100.5, "date": "2026-11-12", "rsi": 75.9, "trend": "Bullish"}},
                    "news": {"values": {"status": "current", "articles": []}},
                    "hype": {"score": 47.5},
                },
            },
        }
        context = build_agent_context(document, "Explain this analysis")
        self.assertIn("Price: 2100.5", context["data_cot"])
        self.assertIn("RSI: 75.9", context["data_cot"])
    def test_current_news_reaches_prompt_with_summary_date_and_url(self):
        news = {
            "is_valid": True,
            "is_current": True,
            "freshness": {"status": "current", "max_age_days": 7},
            "overall_sentiment": "Positive",
            "hype_label": "Low",
            "top_headlines": [{
                "headline": "TCS wins a new contract",
                "source": "Test Source",
                "published_date": "2026-10-20T10:00:00+00:00",
                "summary": "The contract may support order visibility.",
                "url": "https://example.test/tcs-contract",
                "sentiment": "Positive",
            }],
        }

        context = build_agent_context(stock_document(news), "Assess TCS")
        prompt = _build_prompt(context)

        self.assertIn("TCS wins a new contract", prompt)
        self.assertIn("The contract may support order visibility.", prompt)
        self.assertIn("2026-10-20T10:00:00+00:00", prompt)
        self.assertIn("https://example.test/tcs-contract", prompt)
        self.assertIn("News status: current", prompt)
        self.assertIn("Current news sentiment: Positive", prompt)

    def test_historical_news_is_explicit_and_not_described_as_current(self):
        news = {
            "is_valid": True,
            "is_current": False,
            "historical_only": True,
            "freshness": {"status": "historical", "max_age_days": 30},
            "overall_sentiment": "Positive",
            "top_headlines": [{
                "headline": "Older TCS context",
                "source": "Test Source",
                "published_date": "2026-10-01T10:00:00+00:00",
                "summary": "Historical context.",
                "url": "https://example.test/tcs-old",
                "sentiment": "Positive",
            }],
        }

        prompt = _build_prompt(build_agent_context(stock_document(news), "Assess TCS"))

        self.assertIn("News status: historical", prompt)
        self.assertIn("Historical news sentiment (not current): Positive", prompt)
        self.assertIn("Historical context only; do not treat as current", prompt)

    def test_missing_news_fallback_discloses_the_limitation(self):
        news = {
            "is_valid": False,
            "freshness": {"status": "unavailable"},
            "error": "No recent news was found.",
            "top_headlines": [],
        }

        result = generate_finrobot_response(stock_document(news), "Assess TCS", fast=True)

        self.assertIn("Current news is unavailable", result["answer"])
        self.assertNotIn("Recent news sentiment is", result["answer"])

    def test_fallback_answers_the_latest_question_and_ends_with_next_step(self):
        news = {
            "is_valid": True,
            "is_current": True,
            "freshness": {"status": "current"},
            "overall_sentiment": "Neutral",
            "top_headlines": [],
        }
        result = generate_finrobot_response(
            stock_document(news),
            "Previous conversation for TCS.NS: user: What is the outlook? assistant: It is mixed.\n\nLatest user question: What are the key risks right now?",
            fast=True,
        )
        self.assertIn("main near-term risk", result["answer"])
        self.assertIn("Suggested next step\n-", result["answer"])
        self.assertEqual(result["reasoning_context"]["query"], "What are the key risks right now?")

    def test_fallback_does_not_invent_debt_data(self):
        result = generate_finrobot_response(
            stock_document({"is_valid": False, "freshness": {"status": "unavailable"}}),
            "What about its debt?",
            fast=True,
        )
        self.assertIn("does not include a verified debt", result["answer"])
        self.assertIn("Suggested next step\n-", result["answer"])

    def test_fallback_lists_actual_headline_for_news_follow_up(self):
        news = {
            "is_valid": True,
            "is_current": True,
            "freshness": {"status": "current"},
            "overall_sentiment": "Neutral",
            "top_headlines": [{
                "headline": "Anant Raj Analyst Meet",
                "source": "Test Source",
                "published_date": "2026-11-05T10:00:00+00:00",
                "summary": "The company discussed its project pipeline.",
                "url": "https://example.test/article",
            }],
        }
        result = generate_finrobot_response(stock_document(news), "Can you show me the headlines and explain them?", fast=True)
        self.assertIn("Anant Raj Analyst Meet", result["answer"])
        self.assertIn("project pipeline", result["answer"])
        self.assertIn("https://example.test/article", result["answer"])

    def test_first_headline_without_body_is_not_presented_as_verified_article_content(self):
        news = {
            "is_valid": True,
            "is_current": True,
            "freshness": {"status": "current"},
            "top_headlines": [{"headline": "Results update", "source": "Test Source"}],
        }
        result = generate_finrobot_response(stock_document(news), "What is the impact of the first article?", fast=True)
        self.assertIn("article body or a reliable summary was not retrieved", result["answer"])
        self.assertIn("Suggested next step\n-", result["answer"])

    def test_short_term_question_uses_technical_evidence_and_hypothetical_levels(self):
        news = {"is_valid": True, "is_current": True, "freshness": {"status": "current"}, "overall_sentiment": "Neutral", "top_headlines": []}
        document = stock_document(news)
        document["market"].update({
            "price": 100.0,
            "timestamp": "2026-11-05T15:30:00+00:00",
            "sma_20": 105.0,
            "sma_50": 110.0,
            "macd": {"macd": -1.2, "signal": -0.8},
            "volume": 1000,
            "volume_average": 2000,
        })
        result = generate_finrobot_response(document, "Can this stock move 2–3% in a week or should I wait?", fast=True)
        self.assertIn("Short-term view", result["answer"])
        self.assertIn("Hypothetical +2%: 102.00", result["answer"])
        self.assertIn("Hypothetical +3%: 103.00", result["answer"])
        self.assertIn("arithmetic scenarios, not forecasts", result["answer"])
        self.assertIn("Suggested next step\n-", result["answer"])


if __name__ == "__main__":
    unittest.main()
