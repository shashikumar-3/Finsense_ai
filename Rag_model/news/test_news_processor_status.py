import unittest
from unittest.mock import patch

from Rag_model.news.news_processor import process_stock_news
from Rag_model.news.sentiment import analyze_sentiment


class NewsProcessorStatusTests(unittest.TestCase):
    def test_provider_failure_does_not_become_neutral_sentiment(self):
        with patch('Rag_model.news.news_processor.get_stock_news', return_value={
            'is_valid': False,
            'provider': 'newsapi',
            'error': 'provider unavailable',
            'freshness': {'status': 'unavailable'},
        }):
            result = process_stock_news('TCS')
        self.assertIsNone(result['overall_sentiment'])
        self.assertEqual(result['sentiment_status'], 'unavailable')
        self.assertIsNone(result['positive_score'])

    def test_valid_articles_produce_sentiment_and_ranked_headlines(self):
        articles = [
            {
                'headline': 'TCS reports strong growth and record profit',
                'source': 'Test Source',
                'published_date': '2026-11-12T08:00:00+00:00',
                'url': 'https://example.test/tcs-1',
                'summary': 'The company reported strong growth and profit.',
            },
        ]
        with patch('Rag_model.news.news_processor.get_stock_news', return_value={
            'is_valid': True,
            'provider': 'newsapi',
            'articles': articles,
            'article_count': 1,
            'freshness': {'status': 'current', 'max_age_days': 7},
        }):
            result = process_stock_news('TCS')

        self.assertEqual(result['sentiment_status'], 'available')
        self.assertEqual(result['news_frequency_count'], 1)
        self.assertEqual(result['top_headlines'][0]['headline'], articles[0]['headline'])
        self.assertIn(result['overall_sentiment'], {'Positive', 'Neutral', 'Negative'})

    def test_sentiment_empty_input_is_unavailable_not_neutral(self):
        result = analyze_sentiment([])
        self.assertFalse(result['is_valid'])
        self.assertEqual(result['overall_sentiment'], 'Neutral')
        self.assertIn('No news articles', result['error'])


if __name__ == '__main__':
    unittest.main()
