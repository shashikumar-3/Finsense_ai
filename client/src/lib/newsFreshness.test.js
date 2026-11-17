import { describe, expect, it } from 'vitest'
import { isCurrentNews, needsNewsRefresh, newsDisplayState } from './newsFreshness'

describe('news freshness decisions', () => {
  it('accepts a valid current news payload', () => {
    const news = { is_valid: true, is_current: true, articles: [{ headline: 'Current' }] }
    expect(isCurrentNews(news)).toBe(true)
    expect(needsNewsRefresh(news)).toBe(false)
    expect(newsDisplayState(news)).toBe('current')
  })

  it('refreshes stale cached articles instead of treating them as current', () => {
    const news = { is_valid: true, is_current: false, freshness_status: 'stale', articles: [{ headline: 'Old' }] }
    expect(needsNewsRefresh(news)).toBe(true)
    expect(newsDisplayState(news)).toBe('historical')
  })

  it('refreshes invalid or empty news payloads', () => {
    expect(needsNewsRefresh({ is_valid: false, articles: [] })).toBe(true)
    expect(needsNewsRefresh({ is_valid: true, is_current: true, articles: [] })).toBe(true)
    expect(newsDisplayState({ is_valid: false, articles: [] })).toBe('unavailable')
  })
})
