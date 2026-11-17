import unittest

from Rag_model.analysis.event_risk import build_event_risk, classify_event


class EventRiskTests(unittest.TestCase):
    def test_only_conservative_known_event_terms_are_classified(self):
        self.assertEqual(classify_event("Company announces SEBI investigation"), "regulatory_legal")
        self.assertIsNone(classify_event("Company shares trade higher"))

    def test_risk_keeps_article_evidence_and_does_not_create_a_score(self):
        result = build_event_risk([{"headline": "Company reports cyber incident", "published_date": "2026-10-20"}])
        self.assertEqual(result["level"], "elevated")
        self.assertEqual(result["evidence"][0]["category"], "operational_incident")
        self.assertNotIn("score", result)

    def test_empty_news_is_unavailable(self):
        self.assertEqual(build_event_risk([])["status"], "unavailable")


if __name__ == "__main__":
    unittest.main()
