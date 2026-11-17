import unittest

from Rag_model.analysis.fundamentals import build_statement_summary, free_cash_flow, growth, margin, ratio


class FundamentalCalculationTests(unittest.TestCase):
    def test_growth_uses_absolute_previous_denominator(self):
        self.assertAlmostEqual(growth(120, -100), 2.2)
        self.assertIsNone(growth(100, 0))

    def test_ratios_and_cash_flow_are_safe(self):
        self.assertAlmostEqual(margin(25, 100), 0.25)
        self.assertAlmostEqual(ratio(50, 200), 0.25)
        self.assertAlmostEqual(free_cash_flow(100, -30), 70)
        self.assertIsNone(ratio(1, 0))

    def test_statement_summary_preserves_annual_and_quarterly_periods(self):
        result = build_statement_summary(
            annual=[{"period": "2025-03-31", "revenue": 100, "net_profit": 10}],
            quarterly=[{"period": "2025-09-30", "revenue": 30, "net_profit": 4}, {"period": "2024-09-30", "revenue": 20, "net_profit": 2}],
        )
        self.assertEqual(result["status"], "available")
        self.assertEqual(result["annual_results"][0]["period_type"], "annual")
        self.assertEqual(result["annual_results"][0]["source"], "Yahoo Finance")
        self.assertAlmostEqual(result["quarterly_results"][0]["revenue_growth"], 0.5)
        self.assertAlmostEqual(result["quarterly_results"][0]["net_profit_margin"], 4 / 30)

    def test_missing_periods_are_unavailable_not_zero(self):
        result = build_statement_summary()
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["annual_results"], [])
        self.assertEqual(result["quarterly_results"], [])


if __name__ == "__main__":
    unittest.main()
