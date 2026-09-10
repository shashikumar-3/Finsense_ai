import {
  Activity,
  BadgeIndianRupee,
  BrainCircuit,
  BriefcaseBusiness,
  CandlestickChart,
  CircleUserRound,
  Landmark,
  Radar,
  Sparkles,
} from 'lucide-react'

export const navItems = [
  { label: 'Home', path: '/home', icon: CandlestickChart },
  { label: 'Stocks', path: '/stocks', icon: BadgeIndianRupee },
  { label: 'Analytics', path: '/analytics', icon: Activity },
  { label: 'Insights', path: '/insights', icon: BrainCircuit },
  { label: 'Reports', path: '/reports', icon: Radar },
  { label: 'Profile', path: '/profile', icon: BriefcaseBusiness },
]

export const heroMetrics = [
  {
    label: 'Decision confidence',
    value: '91%',
    change: '+8.2%',
    detail: 'Up after stronger sector breadth and calmer volatility.',
  },
  {
    label: 'Wealth projection',
    value: '₹18.4L',
    change: '+₹1.2L',
    detail: 'Projected portfolio value by age 35 from current plan.',
  },
  {
    label: 'Portfolio risk',
    value: 'Moderate',
    change: '-12 pts',
    detail: 'Reduced concentration risk after diversification actions.',
  },
]

export const allocationData = [
  { name: 'Tech', value: 42, color: '#60a5fa' },
  { name: 'Banking', value: 18, color: '#5eead4' },
  { name: 'Healthcare', value: 14, color: '#fbbf24' },
  { name: 'Energy', value: 9, color: '#fb7185' },
  { name: 'Cash', value: 17, color: '#94a3b8' },
]

export const trendData = [
  { month: 'Jan', confidence: 68, wealth: 8.5, risk: 41 },
  { month: 'Feb', confidence: 72, wealth: 9.3, risk: 37 },
  { month: 'Mar', confidence: 76, wealth: 10.4, risk: 33 },
  { month: 'Apr', confidence: 80, wealth: 11.8, risk: 31 },
  { month: 'May', confidence: 84, wealth: 13.1, risk: 29 },
  { month: 'Jun', confidence: 88, wealth: 14.9, risk: 27 },
  { month: 'Jul', confidence: 91, wealth: 18.4, risk: 24 },
]

export const spotlightCards = [
  {
    title: 'Stock movement explainer',
    text: 'INFY softened 3.2% after muted deal commentary and weak IT sector sentiment despite stable earnings quality.',
    tag: 'Why it moved',
    accent: 'from-sky/30 to-sky/5',
  },
  {
    title: 'Hype vs reality engine',
    text: 'Short-term chatter is elevated, but balance sheet strength and margin resilience still support a long-term bullish posture.',
    tag: 'Core USP',
    accent: 'from-aqua/30 to-aqua/5',
  },
  {
    title: 'Economic ripple simulator',
    text: 'A 50 bps rate hike improves private bank margins while pressuring real estate and rate-sensitive consumption.',
    tag: 'Macro scenario',
    accent: 'from-gold/30 to-gold/5',
  },
]

export const insightFeed = [
  {
    title: 'Behavior pattern detected',
    summary: 'You bought momentum names after social spikes three times this quarter.',
    severity: 'Watchlist',
  },
  {
    title: 'Future plan alert',
    summary: 'Increasing SIP by ₹8,000 lifts your 10-year target probability from 61% to 79%.',
    severity: 'Opportunity',
  },
  {
    title: 'Portfolio concentration',
    summary: 'Technology exposure remains above your comfort band and may amplify earnings-season swings.',
    severity: 'Risk',
  },
]

export const analyticsStats = [
  {
    title: 'Hype score',
    value: '74 / 100',
    description: 'News velocity and social mention intensity remain elevated.',
    icon: Sparkles,
  },
  {
    title: 'Fundamental strength',
    value: '88 / 100',
    description: 'Healthy cash flow, disciplined debt, and durable earnings growth.',
    icon: BadgeIndianRupee,
  },
  {
    title: 'Technical posture',
    value: '67 / 100',
    description: 'Momentum is positive, though RSI is nearing overheated territory.',
    icon: Activity,
  },
]

export const radarData = [
  { metric: 'Sentiment', value: 74 },
  { metric: 'Earnings', value: 89 },
  { metric: 'Valuation', value: 64 },
  { metric: 'Momentum', value: 67 },
  { metric: 'Liquidity', value: 81 },
  { metric: 'Governance', value: 86 },
]

export const futureProjection = [
  { year: '2026', baseline: 6.4, optimized: 7.1 },
  { year: '2027', baseline: 8.1, optimized: 9.6 },
  { year: '2028', baseline: 10.2, optimized: 12.8 },
  { year: '2029', baseline: 12.6, optimized: 16.4 },
  { year: '2030', baseline: 15.1, optimized: 20.7 },
  { year: '2031', baseline: 18.4, optimized: 25.3 },
]

export const reportCards = [
  {
    title: 'Quarterly intelligence memo',
    text: 'A polished snapshot of portfolio health, macro signals, and capital allocation suggestions.',
    status: 'Ready',
  },
  {
    title: 'Behavioral risk dossier',
    text: 'Highlights recurring biases, late-entry habits, and suggested correction rituals.',
    status: 'Updated 2h ago',
  },
  {
    title: 'Goal acceleration report',
    text: 'Models how savings, return assumptions, and expense discipline affect major milestones.',
    status: 'Ready',
  },
]

export const profileSummary = {
  name: 'Riya Shah',
  role: 'Growth Investor',
  location: 'Bengaluru, India',
  riskBand: 'Balanced',
  goal: 'Financial freedom by 35',
}

export const profileHighlights = [
  { label: 'Net worth path', value: 'On track', icon: Landmark },
  { label: 'Decision discipline', value: 'Strong', icon: BrainCircuit },
  { label: 'Portfolio resilience', value: 'Improving', icon: BriefcaseBusiness },
]

export const profileAccountItems = [
  { label: 'Membership', key: 'membership', icon: CircleUserRound },
  { label: 'Plan status', key: 'planStatus', icon: Landmark },
  { label: 'Joined', key: 'joinedOn', icon: CandlestickChart },
]

export const settingsGroups = [
  {
    title: 'Platform experience',
    items: [
      { name: 'Adaptive dark mode', enabled: true },
      { name: 'Compact dashboard density', enabled: false },
      { name: 'Motion-enhanced transitions', enabled: true },
    ],
  },
  {
    title: 'Intelligence preferences',
    items: [
      { name: 'Behavioral alerts', enabled: true },
      { name: 'Macro ripple scenarios', enabled: true },
      { name: 'High-risk trading warnings', enabled: false },
    ],
  },
]
