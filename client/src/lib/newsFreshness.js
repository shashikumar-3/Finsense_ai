export function isCurrentNews(news) {
  if (news?.is_current === false || news?.freshness_status === 'stale' || news?.historical_only) return false
  return news?.is_current === true || news?.freshness?.status === 'current'
}

export function newsDisplayState(news) {
  if (isCurrentNews(news)) return 'current'
  if (news?.historical_only || news?.freshness_status === 'stale') return 'historical'
  return 'unavailable'
}

export function needsNewsRefresh(news) {
  const articles = news?.articles || news?.top_headlines || []
  return !isCurrentNews(news) || news?.is_valid === false || articles.length === 0
}
