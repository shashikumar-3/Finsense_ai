import { useEffect, useRef } from 'react'

const SCRIPT_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'

export default function TradingViewWidget({ symbol, theme = 'dark' }) {
  const containerRef = useRef(null)

  useEffect(() => {
    const host = containerRef.current
    if (!host) {
      return
    }

    host.innerHTML = ''
    const widgetRoot = document.createElement('div')
    widgetRoot.className = 'tradingview-widget-container__widget h-full w-full'
    host.appendChild(widgetRoot)

    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.type = 'text/javascript'
    script.async = true
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: 'D',
      timezone: 'Asia/Kolkata',
      theme,
      style: '1',
      locale: 'en',
      allow_symbol_change: false,
      hide_side_toolbar: false,
      withdateranges: true,
      save_image: false,
      studies: [],
      support_host: 'https://www.tradingview.com',
    })

    host.appendChild(script)

    return () => {
      host.innerHTML = ''
    }
  }, [symbol, theme])

  return (
    <div className="h-[520px] w-full overflow-hidden rounded-3xl border border-white/10 bg-slate-950/40">
      <div ref={containerRef} className="tradingview-widget-container h-full w-full" />
    </div>
  )
}

