import unittest
from datetime import datetime
from unittest.mock import patch

import pandas as pd

from Rag_model.analysis.strength_analyzer import (
    compare_components,
    detect_hype,
    score_fundamentals,
    score_news,
    score_technicals,
)


class StrengthAnalyzerTests(unittest.TestCase):
    def test_fundamentals_require_evidence_and_do_not_score_missing_as_zero(self):
        result = score_fundamentals({"metrics": {"revenue_growth": 0.2, "roe": 0.2}, "warnings": []})
        self.assertIsNone(result["score"])
        self.assertEqual(result["status"], "insufficient_data")

    def test_financial_sector_does_not_apply_industrial_debt_rule(self):
        result = score_fundamentals({"financial_sector": True, "sector": "Financial Services", "metrics": {"revenue_growth": 0.2, "profit_margin": 0.2, "roe": 0.2}, "warnings": []})
        self.assertIsNotNone(result["score"])
        self.assertTrue(any("financial sectors" in warning for warning in result["warnings"]))

    def test_news_statuses_are_distinct(self):
        current = score_news({"is_valid": True, "is_current": True, "freshness": {"status": "current"}, "overall_sentiment": "Positive"})
        historical = score_news({"is_valid": True, "historical_only": True, "freshness": {"status": "historical"}, "overall_sentiment": "Positive"})
        unavailable = score_news({"is_valid": False, "error": "Provider unavailable"})
        self.assertEqual(current["values"]["status"], "current")
        self.assertEqual(historical["values"]["status"], "historical")
        self.assertIsNone(unavailable["score"])
        self.assertIn("Current news is temporarily unavailable.", unavailable["warnings"])
        self.assertEqual(unavailable["values"]["provider_error"], "Provider unavailable")

    def test_hype_requires_two_signals(self):
        history = pd.DataFrame({"Close": [100] * 10, "Volume": [100] * 10})
        result = detect_hype(history, {})
        self.assertEqual(result["status"], "insufficient_evidence")

    def test_comparison_does_not_force_missing_components(self):
        result = compare_components({"score": None}, {"score": 80}, {"score": None, "evidence": []}, {"score": 75})
        self.assertEqual(result["classification"], "Insufficient evidence")


if __name__ == "__main__":
    unittest.main()
