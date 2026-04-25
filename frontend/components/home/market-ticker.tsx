"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { useLivePrices } from "@/hooks/price/use-live-prices"
import type { PriceSource } from "@/lib/price-config"
import { marketTickerTokens } from "@/lib/token-config"
import { formatPrice, sourceBadge } from "@/lib/price-utils"

const tokens = marketTickerTokens

type TickerCardProps = {
  symbol: string
  name: string
  icon: string
  price?: number
  change?: number
  source?: PriceSource
}

const TickerCard = React.memo(function TickerCard({
  symbol,
  name,
  icon,
  price,
  change,
  source,
}: TickerCardProps) {
  const badge = sourceBadge(source)
  const resolvedChange = typeof change === "number" ? change : null
  const isPositive = resolvedChange === null ? true : resolvedChange >= 0

  return (
    <div className="min-w-[160px] flex-shrink-0 rounded-xl border border-border bg-surface/40 px-3 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <div>
            <p className="text-sm font-semibold text-foreground carel-tech-title">{symbol}</p>
            <p className="text-[10px] text-muted-foreground">{name}</p>
          </div>
        </div>
        <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold", badge.className)}>
          {badge.label}
        </span>
      </div>
      <div className="mt-3">
        <p className="text-lg font-bold text-foreground carel-tech-title">{formatPrice(price)}</p>
        <p className={cn("text-xs", isPositive ? "text-success" : "text-destructive")}>
          {resolvedChange !== null ? `${isPositive ? "+" : ""}${resolvedChange.toFixed(2)}%` : "—"}
        </p>
      </div>
    </div>
  )
})
TickerCard.displayName = "TickerCard"

/**
 * Handles `MarketTicker` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function MarketTicker() {
  const trackedTokens = React.useMemo(() => tokens.map((token) => token.symbol), [])
  const fallback = React.useMemo(() => ({ CAREL: 1, USDC: 1, USDT: 1 }), [])
  const { prices, changes, sources, status } = useLivePrices(trackedTokens, {
    fallbackPrices: fallback,
  })
  const stripRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef({
    active: false,
    moved: false,
    startX: 0,
    startScrollLeft: 0,
  })
  const [isDragging, setIsDragging] = React.useState(false)

  const beginDrag = React.useCallback((clientX: number) => {
    const strip = stripRef.current
    if (!strip) return
    dragRef.current.active = true
    dragRef.current.moved = false
    dragRef.current.startX = clientX
    dragRef.current.startScrollLeft = strip.scrollLeft
    setIsDragging(true)
  }, [])

  const moveDrag = React.useCallback((clientX: number) => {
    const strip = stripRef.current
    if (!strip || !dragRef.current.active) return
    const deltaX = clientX - dragRef.current.startX
    if (Math.abs(deltaX) > 3) {
      dragRef.current.moved = true
    }
    strip.scrollLeft = dragRef.current.startScrollLeft - deltaX
  }, [])

  const endDrag = React.useCallback(() => {
    dragRef.current.active = false
    setIsDragging(false)
    window.setTimeout(() => {
      dragRef.current.moved = false
    }, 0)
  }, [])

  return (
    <section className="w-full">
      <div className="p-4 rounded-2xl glass border border-border/60">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase carel-tech-label">Live Market</span>
            <span
              className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-secondary/15"
              title={`WebSocket ${status.websocket}`}
              aria-label={`WebSocket ${status.websocket}`}
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  status.websocket === "open"
                    ? "bg-success animate-pulse"
                    : "bg-muted-foreground"
                )}
              />
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            Updated {status.lastRefresh ? new Date(status.lastRefresh).toLocaleTimeString() : "—"}
          </span>
        </div>
        <div
          ref={stripRef}
          className={cn(
            "flex gap-3 overflow-x-auto pb-2 select-none",
            isDragging ? "cursor-grabbing" : "cursor-grab"
          )}
          onMouseDown={(event) => beginDrag(event.clientX)}
          onMouseMove={(event) => moveDrag(event.clientX)}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          onTouchStart={(event) => beginDrag(event.touches[0]?.clientX ?? 0)}
          onTouchMove={(event) => moveDrag(event.touches[0]?.clientX ?? 0)}
          onTouchEnd={endDrag}
          onDragStart={(event) => event.preventDefault()}
        >
          {tokens.map((token) => (
            <TickerCard
              key={token.symbol}
              symbol={token.symbol}
              name={token.name}
              icon={token.icon}
              price={prices[token.symbol]}
              change={changes[token.symbol]}
              source={sources[token.symbol]}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
