import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const tooltipStyle = {
  background: 'rgba(8, 15, 35, 0.92)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  borderRadius: '16px',
  color: '#e2e8f0',
}

export function TrendChart({ data }) {
  return (
    <div className="chart-wrapper h-80">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="wealthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#5eead4" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#5eead4" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Area type="monotone" dataKey="wealth" stroke="#5eead4" fill="url(#wealthFill)" strokeWidth={3} />
          <Line type="monotone" dataKey="confidence" stroke="#60a5fa" strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function AllocationChart({ data }) {
  return (
    <div className="chart-wrapper h-72">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            innerRadius={70}
            outerRadius={96}
            paddingAngle={4}
            dataKey="value"
            stroke="transparent"
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ScoreRadar({ data }) {
  return (
    <div className="chart-wrapper h-80">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data}>
          <PolarGrid stroke="rgba(148, 163, 184, 0.18)" />
          <PolarAngleAxis dataKey="metric" tick={{ fill: '#cbd5e1', fontSize: 12 }} />
          <Radar dataKey="value" stroke="#5eead4" fill="#5eead4" fillOpacity={0.28} />
          <Tooltip contentStyle={tooltipStyle} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function FutureChart({ data }) {
  return (
    <div className="chart-wrapper h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={10}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="year" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="baseline" radius={[8, 8, 0, 0]} fill="#334155" />
          <Bar dataKey="optimized" radius={[8, 8, 0, 0]} fill="#60a5fa" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ConfidenceChart({ data }) {
  return (
    <div className="chart-wrapper h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Line type="monotone" dataKey="confidence" stroke="#fbbf24" strokeWidth={3} dot={{ r: 4, fill: '#fbbf24' }} />
          <Line type="monotone" dataKey="risk" stroke="#fb7185" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
