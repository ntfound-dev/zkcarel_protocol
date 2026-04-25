"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Handles `MiniChart` logic.
 *
 * @param data - Input used by `MiniChart` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export type ChartPoint = { label: string; value: number; tooltipLabel?: string }

const formatExactUsd = (value: number) => {
  if (!Number.isFinite(value)) return "$0.00"
  const abs = Math.abs(value)
  const formatted = abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${value < 0 ? "-" : ""}$${formatted}`
}

function MiniChart({ data, className }: { data: ChartPoint[]; className?: string }) {
  const chartUid = React.useId().replace(/:/g, "")
  const chartRef = React.useRef<HTMLDivElement>(null)
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null)
  const safeData = data.length > 1 ? data : data.length === 1 ? [data[0], data[0]] : []

  React.useEffect(() => {
    if (hoveredIndex === null) return
    if (hoveredIndex >= safeData.length) {
      setHoveredIndex(null)
    }
  }, [hoveredIndex, safeData.length])

  if (safeData.length === 0) {
    return <div className={cn("h-full min-h-[220px] w-full rounded-xl bg-surface/30", className)} />
  }

  const chartTop = 8
  const chartBottom = 92
  const chartHeight = chartBottom - chartTop
  const maxValue = Math.max(...safeData.map((d) => d.value))
  const minValue = Math.min(...safeData.map((d) => d.value))
  const baseRange = maxValue - minValue || 1
  const padding = baseRange * 0.12
  const yMin = minValue - padding
  const yMax = maxValue + padding
  const yRange = yMax - yMin || 1

  const xAt = (index: number) => (index / Math.max(1, safeData.length - 1)) * 100
  const yAt = (value: number) => chartBottom - ((value - yMin) / yRange) * chartHeight

  const movingAverage = safeData.map((_, index) => {
    const from = Math.max(0, index - 2)
    const segment = safeData.slice(from, index + 1)
    const avg = segment.reduce((sum, point) => sum + point.value, 0) / segment.length
    return avg
  })

  const linePoints = safeData.map((point, index) => `${xAt(index)},${yAt(point.value)}`).join(" ")
  const maPoints = movingAverage.map((value, index) => `${xAt(index)},${yAt(value)}`).join(" ")
  const areaPoints = `0,${chartBottom} ${linePoints} 100,${chartBottom}`

  const gridY = [chartTop, chartTop + chartHeight * 0.25, chartTop + chartHeight * 0.5, chartTop + chartHeight * 0.75, chartBottom]
  const gridX = safeData.map((_, index) => xAt(index))

  const hoveredPoint = hoveredIndex !== null ? safeData[hoveredIndex] : null
  const hoveredX = hoveredIndex !== null ? xAt(hoveredIndex) : null
  const hoveredY = hoveredIndex !== null ? yAt(safeData[hoveredIndex].value) : null

  const handlePointerMove = (clientX: number) => {
    const container = chartRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const index = Math.round(ratio * Math.max(0, safeData.length - 1))
    setHoveredIndex(index)
  }

  return (
    <div
      ref={chartRef}
      className={cn("relative h-full min-h-[220px] w-full", className)}
      onMouseLeave={() => setHoveredIndex(null)}
      onMouseMove={(event) => handlePointerMove(event.clientX)}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <defs>
          <linearGradient id={`chartArea-${chartUid}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#a855f7" stopOpacity="0.42" />
            <stop offset="58%" stopColor="#7c3aed" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`chartLine-${chartUid}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#9333ea" />
            <stop offset="50%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
          <filter id={`chartGlow-${chartUid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="0.9" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {gridY.map((y, index) => (
          <line
            key={`gy-${index}`}
            x1="0"
            y1={y}
            x2="100"
            y2={y}
            stroke="var(--border)"
            strokeWidth="0.5"
            strokeDasharray="1.2 2.8"
            opacity="0.85"
          />
        ))}
        {gridX.map((x, index) => (
          <line
            key={`gx-${index}`}
            x1={x}
            y1={chartTop}
            x2={x}
            y2={chartBottom}
            stroke="var(--border)"
            strokeWidth="0.45"
            strokeDasharray="1.2 3.2"
            opacity="0.45"
          />
        ))}

        <polygon points={areaPoints} fill={`url(#chartArea-${chartUid})`} />
        <polygon points={areaPoints} fill="#8b5cf6" opacity="0.08" filter={`url(#chartGlow-${chartUid})`} />

        <polyline
          points={maPoints}
          fill="none"
          stroke="#a78bfa"
          strokeOpacity="0.5"
          strokeWidth="0.95"
          strokeDasharray="2 2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <polyline
          points={linePoints}
          fill="none"
          stroke={`url(#chartLine-${chartUid})`}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#chartGlow-${chartUid})`}
        />

        {hoveredX !== null && (
          <line
            x1={hoveredX}
            y1={chartTop}
            x2={hoveredX}
            y2={chartBottom}
            stroke="#22d3ee"
            strokeWidth="0.9"
            strokeDasharray="1.5 2"
            opacity="0.7"
          />
        )}

        {safeData.map((point, index) => {
          const x = xAt(index)
          const y = yAt(point.value)
          const isHovered = hoveredIndex === index
          return (
            <g key={`node-${index}`}>
              <circle
                cx={x}
                cy={y}
                r={isHovered ? 4.8 : 3.8}
                fill="#22d3ee"
                opacity={isHovered ? 0.32 : 0.18}
                filter={`url(#chartGlow-${chartUid})`}
              />
              <circle
                cx={x}
                cy={y}
                r={isHovered ? 2.5 : 2.2}
                fill="#67e8f9"
                stroke="#a855f7"
                strokeWidth="0.6"
              />
            </g>
          )
        })}
      </svg>

      {hoveredPoint && hoveredX !== null && hoveredY !== null && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 rounded-lg border border-primary/40 bg-[#070d16e6] px-3 py-2 shadow-[0_8px_28px_rgba(2,6,23,0.65)]"
          style={{
            left: `${hoveredX}%`,
            top: `calc(${hoveredY}% - 58px)`,
          }}
        >
          <p className="text-[10px] text-muted-foreground">{hoveredPoint.tooltipLabel || hoveredPoint.label}</p>
          <p className="text-xs font-semibold text-foreground">{formatExactUsd(hoveredPoint.value)}</p>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex justify-between px-1 text-xs text-muted-foreground">
        {safeData.map((point, index) => (
          <span key={`${point.label}-${index}`}>{point.label}</span>
        ))}
      </div>
    </div>
  )
}

const MemoizedMiniChart = React.memo(MiniChart)
MemoizedMiniChart.displayName = "MiniChart"

export { MemoizedMiniChart as MiniChart }
