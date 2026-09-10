import { useMemo, useState } from 'react'

function scalePrice(value, min, max, height, padTop, padBottom) {
  if (max === min) {
    return (height - padBottom + padTop) / 2
  }

  const plotHeight = height - padTop - padBottom
  return padTop + ((max - value) / (max - min)) * plotHeight
}

function formatPrice(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : '--'
}

function formatDate(datetime, activeRange) {
  const date = new Date(datetime)
  if (Number.isNaN(date.getTime())) {
    return datetime
  }

  if (activeRange === '1d' || activeRange === '1w') {
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  }

  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function axisTicks(min, max, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return []
  }

  if (min === max) {
    return [min]
  }

  const step = (max - min) / (count - 1)
  return Array.from({ length: count }, (_, idx) => min + step * idx)
}

function getLabelIndexes(length, activeRange) {
  if (!length) {
    return []
  }

  const markers =
    activeRange === '1d'
      ? [0, 0.2, 0.4, 0.6, 0.8, 1]
      : activeRange === '1w'
        ? [0, 0.2, 0.4, 0.6, 0.8, 1]
        : [0, 0.2, 0.4, 0.6, 0.8, 1]

  return Array.from(new Set(markers.map((ratio) => Math.min(length - 1, Math.floor((length - 1) * ratio)))))
}

function getCandleWidth(activeRange) {
  if (activeRange === '1d') {
    return { min: 4.8, max: 6.2, ratio: 0.5 }
  }

  if (activeRange === '1w') {
    return { min: 4.4, max: 5.8, ratio: 0.46 }
  }

  return { min: 4.2, max: 5.6, ratio: 0.42 }
}

export default function StockCandlestickChart({
  points,
  rangeOptions,
  activeRange,
  onRangeChange,
  terminalUrl,
}) {
  const [hoverIndex, setHoverIndex] = useState(null)
  const width = 1100
  const height = 520
  const padLeft = 18
  const padRight = 64
  const padTop = 20
  const padBottom = 68

  const { minPrice, maxPrice, candles, labelIndexes } = useMemo(() => {
    const safePoints = points.filter(
      (point) =>
        Number.isFinite(point.open) &&
        Number.isFinite(point.high) &&
        Number.isFinite(point.low) &&
        Number.isFinite(point.close) &&
        point.open > 0 &&
        point.high > 0 &&
        point.low > 0 &&
        point.close > 0,
    )
    const lows = safePoints.map((point) => point.low)
    const highs = safePoints.map((point) => point.high)
    const rawMin = lows.length ? Math.min(...lows) : 0
    const rawMax = highs.length ? Math.max(...highs) : 0
    const spread = rawMax - rawMin
    const padding = spread > 0 ? spread * 0.1 : Math.max(rawMin * 0.01, 1)
    const minPrice = Math.max(rawMin - padding, 0)
    const maxPrice = rawMax + padding

    return {
      minPrice,
      maxPrice,
      candles: safePoints,
      labelIndexes: getLabelIndexes(safePoints.length, activeRange),
    }
  }, [activeRange, points])

  const plotWidth = width - padLeft - padRight
  const candleGap = Math.max(plotWidth / Math.max(candles.length, 1), 4.2)
  const widthConfig = getCandleWidth(activeRange)
  const candleWidth = Math.min(Math.max(candleGap * widthConfig.ratio, widthConfig.min), widthConfig.max)
  const ticks = axisTicks(minPrice, maxPrice)
  const activeCandle = hoverIndex === null ? candles[candles.length - 1] : candles[hoverIndex]

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#050b0f]">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 text-sm">
        <div className="flex flex-wrap items-center gap-7">
          <p className="text-slate-400">
            Price <span className="ml-2 font-semibold text-emerald-400">{formatPrice(activeCandle?.close)}</span>
          </p>
          <p className="text-slate-400">
            O <span className="ml-1 font-semibold text-slate-200">{formatPrice(activeCandle?.open)}</span>
          </p>
          <p className="text-slate-400">
            H <span className="ml-1 font-semibold text-emerald-400">{formatPrice(activeCandle?.high)}</span>
          </p>
          <p className="text-slate-400">
            L <span className="ml-1 font-semibold text-slate-200">{formatPrice(activeCandle?.low)}</span>
          </p>
          <p className="text-slate-400">
            C <span className="ml-1 font-semibold text-emerald-400">{formatPrice(activeCandle?.close)}</span>
          </p>
        </div>
      </div>

      <div className="h-[520px] w-full px-3">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full">
          {ticks.map((tick) => {
            const y = scalePrice(tick, minPrice, maxPrice, height, padTop, padBottom)
            return (
              <g key={tick}>
                <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="rgba(51,65,85,0.35)" />
                <text x={width - 8} y={y + 4} fill="#64748b" fontSize="11" textAnchor="end">
                  {formatPrice(tick)}
                </text>
              </g>
            )
          })}

          {candles.map((candle, idx) => {
            const x = padLeft + candleGap * idx + candleGap / 2
            const openY = scalePrice(candle.open, minPrice, maxPrice, height, padTop, padBottom)
            const closeY = scalePrice(candle.close, minPrice, maxPrice, height, padTop, padBottom)
            const highY = scalePrice(candle.high, minPrice, maxPrice, height, padTop, padBottom)
            const lowY = scalePrice(candle.low, minPrice, maxPrice, height, padTop, padBottom)
            const isBullish = candle.close >= candle.open
            const bodyY = Math.min(openY, closeY)
            const bodyHeight = Math.max(Math.abs(openY - closeY), activeRange === '1d' ? 2.8 : 2.4)
            const color = isBullish ? '#19d3c5' : '#ff7a59'

            return (
              <g key={`${candle.datetime}-${idx}`} onMouseEnter={() => setHoverIndex(idx)} onMouseLeave={() => setHoverIndex(null)}>
                <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth={activeRange === '1d' ? '1.4' : '1.3'} />
                <rect
                  x={x - candleWidth / 2}
                  y={bodyY}
                  width={candleWidth}
                  height={bodyHeight}
                  fill={color}
                  rx="1"
                />
                <rect
                  x={x - candleGap / 2}
                  y={padTop}
                  width={candleGap}
                  height={height - padTop - padBottom}
                  fill="transparent"
                />
              </g>
            )
          })}

          <line
            x1={padLeft}
            y1={height - padBottom + 4}
            x2={width - padRight}
            y2={height - padBottom + 4}
            stroke="rgba(51,65,85,0.6)"
          />

          {labelIndexes.map((index) => {
            const candle = candles[index]
            if (!candle) {
              return null
            }

            const x = padLeft + candleGap * index + candleGap / 2
            return (
              <text key={`${candle.datetime}-label`} x={x} y={height - 22} fill="#64748b" fontSize="11" textAnchor="middle">
                {formatDate(candle.datetime, activeRange)}
              </text>
            )
          })}
        </svg>
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
