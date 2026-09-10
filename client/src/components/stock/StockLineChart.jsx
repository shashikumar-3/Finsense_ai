import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const tooltipStyle = {
  background: 'rgba(8, 15, 17, 0.96)',
  border: '1px solid rgba(71, 85, 105, 0.45)',
  borderRadius: '14px',
  color: '#e2e8f0',
  boxShadow: '0 18px 36px rgba(2, 6, 23, 0.35)',
}

function formatXAxisLabel(datetime, activeRange) {
  const date = new Date(datetime)
  if (Number.isNaN(date.getTime())) {
    return datetime
  }

  if (activeRange === '1d' || activeRange === '1w') {
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  }

  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function formatTooltipLabel(datetime) {
  const date = new Date(datetime)
  return Number.isNaN(date.getTime())
    ? datetime
    : date.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
}

function getPriceDomain(data) {
  const values = data.map((point) => point.close).filter((value) => Number.isFinite(value) && value > 0)

  if (!values.length) {
    return ['auto', 'auto']
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const spread = max - min
  const padding = spread > 0 ? spread * 0.12 : Math.max(min * 0.01, 1)

  return [Math.max(min - padding, 0), max + padding]
}

function getTickInterval(activeRange) {
  if (activeRange === '1d') {
    return 11
  }

  if (activeRange === '1w') {
    return 7
  }

  return 'preserveStartEnd'
}

export default function StockLineChart({
  points,
  rangeOptions,
  activeRange,
  onRangeChange,
  terminalUrl,
}) {
  const data = points
    .filter((point) => Number.isFinite(point.close) && point.close > 0)
    .map((point) => ({
      ...point,
      label: formatXAxisLabel(point.datetime, activeRange),
    }))

  const lastClose = data[data.length - 1]?.close
  const firstClose = data[0]?.close
  const isPositive = Number.isFinite(firstClose) && Number.isFinite(lastClose) ? lastClose >= firstClose : true
  const strokeColor = isPositive ? '#19d3c5' : '#ff7a59'
  const priceDomain = getPriceDomain(data)

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#050b0f]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <p className="text-slate-400">
            Price <span className="ml-2 font-semibold text-white">{Number(lastClose || 0).toFixed(2)}</span>
          </p>
        </div>
      </div>

      <div className="chart-wrapper h-[420px] w-full px-3 py-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 36 }}>
            <CartesianGrid vertical={false} stroke="rgba(51, 65, 85, 0.35)" />
            <XAxis
              dataKey="label"
              interval={getTickInterval(activeRange)}
              minTickGap={28}
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              orientation="right"
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              domain={priceDomain}
              tickFormatter={(value) => Number(value).toFixed(2)}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(value, payload) => formatTooltipLabel(payload?.[0]?.payload?.datetime || value)}
              formatter={(value) => [`Rs ${Number(value).toFixed(2)}`, 'Price']}
            />
            <Line type="monotone" dataKey="close" stroke={strokeColor} strokeWidth={2.8} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-4">
        <div className="flex flex-wrap gap-3">
          {rangeOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => onRangeChange(option.value)}
              className={`inline-flex min-w-12 justify-center rounded-full border px-4 py-2 text-sm font-medium transition ${
                activeRange === option.value
                  ? 'border-slate-400 bg-white/8 text-white'
                  : 'border-white/10 text-slate-400 hover:border-slate-500 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <a
          href={terminalUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-cyan/40 hover:text-white"
        >
          Terminal
        </a>
      </div>
    </div>
  )
}
