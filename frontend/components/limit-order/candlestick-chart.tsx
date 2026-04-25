"use client"

import * as React from "react"

type ChartCandle = {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
}

type CandlestickChartProps = {
  candles: ChartCandle[]
  viewBoxHeight: number
  gradientId: string
  showPriceLine?: boolean
  currentPrice?: number
  marketPrice?: number
  className?: string
}

const CANDLE_BULL = "#00d48a"
const CANDLE_BEAR = "#ff5a6f"

export const CandlestickChart = React.memo(
  ({
    candles,
    viewBoxHeight,
    gradientId,
    showPriceLine = false,
    currentPrice = 0,
    className = "w-full h-full",
  }: CandlestickChartProps) => {
    const chartHeight = viewBoxHeight
    const chartScale = React.useMemo(() => {
      if (candles.length <= 1) return null
      const maxVal = Math.max(...candles.map((candle) => candle.high))
      const minVal = Math.min(...candles.map((candle) => candle.low))
      const range = maxVal - minVal || 1
      const paddingTop = Math.max(8, Math.floor(chartHeight * 0.04))
      const paddingBottom = paddingTop
      const drawableHeight = chartHeight - paddingTop - paddingBottom
      const yFor = (price: number) =>
        chartHeight - paddingBottom - ((price - minVal) / range) * drawableHeight
      const clampY = (y: number) =>
        Math.min(chartHeight - paddingBottom, Math.max(paddingTop, y))
      const candleStep = 800 / candles.length
      const candleWidth = Math.max(2, candleStep * 0.55)

      return { yFor, clampY, candleStep, candleWidth }
    }, [candles, chartHeight])

    return (
      <svg className={className} viewBox={`0 0 800 ${viewBoxHeight}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
        </defs>
        {chartScale ? (
          <>
            {(() => {
              const { yFor, candleStep, candleWidth } = chartScale

              return candles.map((candle, idx) => {
                const x = idx * candleStep + candleStep / 2
                const openY = yFor(candle.open)
                const closeY = yFor(candle.close)
                const highY = yFor(candle.high)
                const lowY = yFor(candle.low)
                const bodyTop = Math.min(openY, closeY)
                const bodyHeight = Math.max(Math.abs(openY - closeY), 1)
                const isBullish = candle.close >= candle.open
                const color = isBullish ? CANDLE_BULL : CANDLE_BEAR

                return (
                  <g key={`${candle.timestamp}-${idx}`}>
                    <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth="1" />
                    <rect
                      x={x - candleWidth / 2}
                      y={bodyTop}
                      width={candleWidth}
                      height={bodyHeight}
                      fill={color}
                      opacity="0.95"
                    />
                  </g>
                )
              })
            })()}
          </>
        ) : null}
        {showPriceLine && currentPrice > 0 && chartScale ? (
          (() => {
            const priceY = chartScale.clampY(chartScale.yFor(currentPrice))
            return (
              <line
                x1="0"
                y1={priceY}
                x2="800"
                y2={priceY}
                stroke="hsl(var(--secondary))"
                strokeWidth="1"
                strokeDasharray="5,5"
              />
            )
          })()
        ) : null}
      </svg>
    )
  }
)

CandlestickChart.displayName = "CandlestickChart"
