"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { useLivePrices } from "@/hooks/use-live-prices"
import type { PriceSource } from "@/lib/price-config"

const tokens = [
  { symbol: "BTC", name: "Bitcoin", icon: "₿" },
  { symbol: "ETH", name: "Ethereum", icon: "Ξ" },
  { symbol: "STRK", name: "Starknet", icon: "◈" },
  { symbol: "USDC", name: "USD Coin", icon: "⭕" },
  { symbol: "USDT", name: "Tether", icon: "₮" },
  { symbol: "CAREL", name: "ZkCarel", icon: "◇" },
]

const formatPrice = (value?: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—"
  if (value >= 1000) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  if (value >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
  return `$${value.toFixed(6)}`
}

const sourceBadge = (source?: PriceSource) => {
  switch (source) {
    case "ws":
      return { label: "Live", className: "bg-success/20 text-success" }
    case "coingecko":
      return { label: "CG", className: "bg-primary/20 text-primary" }
    default:
      return { label: "Fallback", className: "bg-muted text-muted-foreground" }
  }
}

export function MarketTicker() {
  const trackedTokens = React.useMemo(() => tokens.map((token) => token.symbol), [])
  const fallback = React.useMemo(() => ({ CAREL: 1, USDC: 1, USDT: 1 }), [])
  const { prices, changes, sources, status } = useLivePrices(trackedTokens, {
    fallbackPrices: fallback,
  })

  return (
    <section className="w-full">
      <div className="p-4 rounded-2xl glass border border-border/60">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Live Market</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/20 text-secondary">
              WS: {status.websocket}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            Updated {status.lastRefresh ? new Date(status.lastRefresh).toLocaleTimeString() : "—"}
          </span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {tokens.map((token) => {
            const price = prices[token.symbol]
            const change = changes[token.symbol]
            const badge = sourceBadge(sources[token.symbol])
            const isPositive = Number.isFinite(change) ? Number(change) >= 0 : true
            return (
              <div
                key={token.symbol}
                className="min-w-[160px] flex-shrink-0 rounded-xl border border-border bg-surface/40 px-3 py-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{token.icon}</span>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{token.symbol}</p>
                      <p className="text-[10px] text-muted-foreground">{token.name}</p>
                    </div>
                  </div>
                  <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold", badge.className)}>
                    {badge.label}
                  </span>
                </div>
                <div className="mt-3">
                  <p className="text-lg font-bold text-foreground">{formatPrice(price)}</p>
                  <p className={cn("text-xs", isPositive ? "text-success" : "text-destructive")}>
                    {Number.isFinite(change) ? `${isPositive ? "+" : ""}${change.toFixed(2)}%` : "—"}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
