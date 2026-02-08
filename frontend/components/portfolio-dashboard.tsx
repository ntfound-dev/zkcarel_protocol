"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, PieChart, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getPortfolioAnalytics, getPortfolioOHLCV, getTransactionsHistory, type AnalyticsResponse, type PortfolioOHLCVPoint, type Transaction } from "@/lib/api"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type PortfolioAsset = {
  symbol: string
  name: string
  icon: string
  value: number
  percent: number
  change: number
}

type PortfolioSnapshot = {
  totalValue: number
  pnl: number
  pnlPercent: number
  period: string
  assets: PortfolioAsset[]
}

const assetMeta: Record<string, { name: string; icon: string }> = {
  BTC: { name: "Bitcoin", icon: "₿" },
  ETH: { name: "Ethereum", icon: "Ξ" },
  CAREL: { name: "ZkCarel", icon: "◇" },
  STRK: { name: "StarkNet", icon: "◈" },
  USDT: { name: "Tether", icon: "₮" },
  USDC: { name: "USD Coin", icon: "⭕" },
}

const defaultPortfolioData: PortfolioSnapshot = {
  totalValue: 100000,
  pnl: 12450,
  pnlPercent: 24.5,
  period: "7D",
  assets: [
    { symbol: "BTC", name: "Bitcoin", icon: "₿", value: 45000, percent: 45, change: 5.2 },
    { symbol: "ETH", name: "Ethereum", icon: "Ξ", value: 25000, percent: 25, change: -2.1 },
    { symbol: "CAREL", name: "ZkCarel", icon: "◇", value: 15000, percent: 15, change: 15.8 },
    { symbol: "STRK", name: "StarkNet", icon: "◈", value: 10000, percent: 10, change: 8.3 },
    { symbol: "Other", name: "Other Assets", icon: "•", value: 5000, percent: 5, change: 1.2 },
  ],
}

type ChartPoint = { label: string; value: number }

function MiniChart({ data }: { data: ChartPoint[] }) {
  const safeData = data.length > 1 ? data : data.length === 1 ? [data[0], data[0]] : []
  if (safeData.length === 0) {
    return <div className="h-40 w-full rounded-xl bg-surface/30" />
  }

  const maxValue = Math.max(...safeData.map(d => d.value))
  const minValue = Math.min(...safeData.map(d => d.value))
  const range = maxValue - minValue || 1
  
  const points = safeData.map((d, i) => {
    const x = (i / (safeData.length - 1)) * 100
    const y = 100 - ((d.value - minValue) / range) * 80
    return `${x},${y}`
  }).join(" ")

  const areaPoints = `0,100 ${points} 100,100`

  return (
    <div className="relative h-40 w-full">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
        {/* Gradient Area */}
        <defs>
          <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--neon-purple)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--neon-purple)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--neon-purple)" />
            <stop offset="50%" stopColor="var(--neon-cyan)" />
            <stop offset="100%" stopColor="var(--neon-purple)" />
          </linearGradient>
        </defs>
        
        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map((y) => (
          <line
            key={y}
            x1="0"
            y1={y}
            x2="100"
            y2={y}
            stroke="var(--border)"
            strokeWidth="0.5"
            strokeDasharray="2,2"
          />
        ))}
        
        {/* Area fill */}
        <polygon
          points={areaPoints}
          fill="url(#chartGradient)"
        />
        
        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke="url(#lineGradient)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Data points */}
        {safeData.map((d, i) => {
          const x = (i / (safeData.length - 1)) * 100
          const y = 100 - ((d.value - minValue) / range) * 80
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r="2"
              fill="var(--neon-cyan)"
              className="animate-pulse-glow"
            />
          )
        })}
      </svg>
      
      {/* X-axis labels */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-between text-xs text-muted-foreground px-1">
        {safeData.map((d, i) => (
          <span key={`${d.label}-${i}`}>{d.label}</span>
        ))}
      </div>
    </div>
  )
}

function AssetRow({ asset }: { asset: PortfolioAsset }) {
  const isPositive = asset.change >= 0
  
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0 hover:bg-primary/5 px-2 -mx-2 rounded-lg transition-colors">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-surface flex items-center justify-center text-xl border border-border">
          {asset.icon}
        </div>
        <div>
          <p className="font-medium text-foreground">{asset.symbol}</p>
          <p className="text-xs text-muted-foreground">{asset.name}</p>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="w-24">
          <div className="h-2 rounded-full bg-surface overflow-hidden">
            <div 
              className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
              style={{ width: `${asset.percent}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1 text-center">{asset.percent}%</p>
        </div>
        <div className="text-right min-w-[100px]">
          <p className="font-medium text-foreground">${asset.value.toLocaleString()}</p>
          <p className={cn(
            "text-xs flex items-center justify-end gap-1",
            isPositive ? "text-success" : "text-destructive"
          )}>
            {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {isPositive ? "+" : ""}{asset.change}%
          </p>
        </div>
      </div>
    </div>
  )
}

type UiTransaction = {
  id: string
  type: string
  asset: string
  amount: string
  value: string
  time: string
  status: string
}

const fallbackTransactions: UiTransaction[] = [
  { id: "local-1", type: "Swap", asset: "BTC → ETH", amount: "0.1", value: "$6,500", time: "2 hours ago", status: "Completed" },
  { id: "local-2", type: "Bridge", asset: "USDC", amount: "500", value: "$500", time: "1 day ago", status: "Completed" },
]

export function PortfolioDashboard() {
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const [selectedPeriod, setSelectedPeriod] = React.useState("7D")
  const [analytics, setAnalytics] = React.useState<AnalyticsResponse | null>(null)
  const [chartData, setChartData] = React.useState<ChartPoint[]>([])
  const [transactions, setTransactions] = React.useState<UiTransaction[]>(fallbackTransactions)

  React.useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const response = await getPortfolioAnalytics()
        if (!active) return
        setAnalytics(response)
      } catch {
        // keep fallback data
      }
    })()

    return () => {
      active = false
    }
  }, [])

  React.useEffect(() => {
    let active = true
    const periodConfig = selectedPeriod === "24H"
      ? { interval: "1h", limit: 24 }
      : selectedPeriod === "7D"
      ? { interval: "1d", limit: 7 }
      : selectedPeriod === "30D"
      ? { interval: "1d", limit: 30 }
      : { interval: "1w", limit: 12 }
    ;(async () => {
      try {
        const response = await getPortfolioOHLCV(periodConfig)
        if (!active) return
        const mapped = response.data.slice(-7).map((point: PortfolioOHLCVPoint) => {
          const date = new Date(point.timestamp * 1000)
          const label = selectedPeriod === "24H"
            ? date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
            : date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
          return { label, value: point.close }
        })
        if (mapped.length > 0) {
          setChartData(mapped)
        }
      } catch {
        // keep existing chart data
      }
    })()

    return () => {
      active = false
    }
  }, [selectedPeriod])

  React.useEffect(() => {
    let active = true
    const formatRelativeTime = (iso: string) => {
      const date = new Date(iso)
      const diffMs = Date.now() - date.getTime()
      const minutes = Math.floor(diffMs / 60000)
      if (minutes < 60) return `${minutes} min ago`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return `${hours} hours ago`
      const days = Math.floor(hours / 24)
      return `${days} days ago`
    }

    const parseNumber = (value?: string | number | null) => {
      if (value === null || value === undefined) return 0
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : 0
    }

    ;(async () => {
      try {
        const response = await getTransactionsHistory({ page: 1, limit: 5 })
        if (!active) return
        const mapped = response.items.map((tx: Transaction) => {
          const tokenLabel = tx.token_out
            ? `${tx.token_in || ""} → ${tx.token_out}`
            : tx.token_in || tx.tx_type
          const amount = parseNumber(tx.amount_in || tx.amount_out || 0)
          const usdValue = parseNumber(tx.usd_value)
          return {
            id: tx.tx_hash,
            type: tx.tx_type.toUpperCase(),
            asset: tokenLabel.trim() || tx.tx_type,
            amount: amount ? amount.toString() : "—",
            value: usdValue ? `$${usdValue.toLocaleString()}` : "—",
            time: formatRelativeTime(tx.timestamp),
            status: tx.processed ? "Completed" : "Pending",
          }
        })
        setTransactions(mapped.length > 0 ? mapped : fallbackTransactions)
      } catch {
        // keep fallback
      }
    })()

    return () => {
      active = false
    }
  }, [])

  const safeNumber = (value: string | number | undefined, fallback: number) => {
    if (value === undefined) return fallback
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  const periodKey: "pnl_24h" | "pnl_7d" | "pnl_30d" | "pnl_all_time" = selectedPeriod === "24H"
    ? "pnl_24h"
    : selectedPeriod === "7D"
    ? "pnl_7d"
    : selectedPeriod === "30D"
    ? "pnl_30d"
    : "pnl_all_time"

  const totalValue = analytics
    ? safeNumber(analytics.portfolio.total_value_usd, defaultPortfolioData.totalValue)
    : defaultPortfolioData.totalValue

  const pnlValue = analytics
    ? safeNumber(analytics.portfolio[periodKey], defaultPortfolioData.pnl)
    : defaultPortfolioData.pnl

  const pnlPercent = totalValue > 0
    ? (pnlValue / totalValue) * 100
    : defaultPortfolioData.pnlPercent

  const assets: PortfolioAsset[] = analytics
    ? analytics.portfolio.allocation.map((item) => {
        const meta = assetMeta[item.asset] || { name: item.asset, icon: "•" }
        return {
          symbol: item.asset,
          name: meta.name,
          icon: meta.icon,
          value: safeNumber(item.value_usd, 0),
          percent: Number.isFinite(item.percentage) ? item.percentage : 0,
          change: 0,
        }
      })
    : defaultPortfolioData.assets

  const bestPerformer = assets.reduce<PortfolioAsset | null>((best, asset) => {
    if (!best) return asset
    return asset.change > best.change ? asset : best
  }, null)

  const displayData: PortfolioSnapshot = {
    totalValue,
    pnl: pnlValue,
    pnlPercent: Number.isFinite(pnlPercent) ? Number(pnlPercent.toFixed(2)) : defaultPortfolioData.pnlPercent,
    period: selectedPeriod,
    assets,
  }

  const isPositive = displayData.pnl >= 0

  return (
    <section id="portfolio" className="py-12">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-foreground">Portfolio Overview</h2>
        <Button 
          variant="outline" 
          className="gap-2 border-primary/50 text-foreground hover:bg-primary/10 bg-transparent"
          onClick={() => setDetailsOpen(true)}
        >
          View Details <ExternalLink className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* PnL Chart */}
        <div className="p-6 rounded-2xl glass border border-border hover:border-primary/50 transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-primary" />
              <span className="font-medium text-foreground">PnL Chart</span>
            </div>
            <div className="flex gap-2">
              {["24H", "7D", "30D", "ALL"].map((period) => (
                <button
                  key={period}
                  onClick={() => setSelectedPeriod(period)}
                  className={cn(
                    "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                    period === selectedPeriod
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-end gap-2 mb-6">
            <span className={cn(
              "text-3xl font-bold",
              isPositive ? "text-success" : "text-destructive"
            )}>
              {isPositive ? "+" : ""}${displayData.pnl.toLocaleString()}
            </span>
            <span className={cn(
              "text-sm font-medium pb-1 flex items-center gap-1",
              isPositive ? "text-success" : "text-destructive"
            )}>
              {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              {isPositive ? "+" : ""}{displayData.pnlPercent}%
            </span>
          </div>

          <MiniChart data={chartData.length > 0 ? chartData : [
            { label: "Mon", value: 85000 },
            { label: "Tue", value: 87500 },
            { label: "Wed", value: 89000 },
            { label: "Thu", value: 91000 },
            { label: "Fri", value: 95000 },
            { label: "Sat", value: 93000 },
            { label: "Sun", value: 100000 },
          ]} />
        </div>

        {/* Asset Allocation */}
        <div className="p-6 rounded-2xl glass border border-border hover:border-primary/50 transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">Asset Allocation</span>
            </div>
            <span className="text-2xl font-bold text-foreground">
              ${displayData.totalValue.toLocaleString()}
            </span>
          </div>

          <div className="space-y-1">
            {displayData.assets.map((asset) => (
              <AssetRow key={asset.symbol} asset={asset} />
            ))}
          </div>
        </div>
      </div>

      {/* Portfolio Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="glass-strong border-border max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <PieChart className="h-5 w-5 text-primary" />
              Portfolio Details
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-surface/50 border border-border">
                <p className="text-xs text-muted-foreground">Total Value</p>
                <p className="text-lg font-bold text-foreground">${displayData.totalValue.toLocaleString()}</p>
              </div>
              <div className="p-4 rounded-xl bg-surface/50 border border-border">
                <p className="text-xs text-muted-foreground">Total PnL</p>
                <p className={cn("text-lg font-bold", isPositive ? "text-success" : "text-destructive")}>
                  {isPositive ? "+" : ""}${displayData.pnl.toLocaleString()}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-surface/50 border border-border">
                <p className="text-xs text-muted-foreground">Assets</p>
                <p className="text-lg font-bold text-foreground">{displayData.assets.length}</p>
              </div>
              <div className="p-4 rounded-xl bg-surface/50 border border-border">
                <p className="text-xs text-muted-foreground">Best Performer</p>
                <p className={cn(
                  "text-lg font-bold",
                  bestPerformer && bestPerformer.change >= 0 ? "text-success" : "text-destructive"
                )}>
                  {bestPerformer ? `${bestPerformer.symbol} ${bestPerformer.change >= 0 ? "+" : ""}${bestPerformer.change}%` : "—"}
                </p>
              </div>
            </div>

            {/* Asset Breakdown */}
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">Asset Breakdown</h3>
                <div className="space-y-3">
                {displayData.assets.map((asset) => (
                  <div key={asset.symbol} className="flex items-center justify-between p-3 rounded-lg bg-surface/30 border border-border">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center text-lg border border-border">
                        {asset.icon}
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{asset.symbol}</p>
                        <p className="text-xs text-muted-foreground">{asset.name}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-foreground">${asset.value.toLocaleString()}</p>
                      {asset.change !== 0 && (
                        <p className={cn("text-xs", asset.change >= 0 ? "text-success" : "text-destructive")}>
                          {asset.change >= 0 ? "+" : ""}{asset.change}%
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Transaction History */}
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">Recent Transactions</h3>
              <div className="space-y-2">
                {transactions.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between p-3 rounded-lg bg-surface/30 border border-border">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
                        (tx.type.toLowerCase() === "buy" || tx.type.toLowerCase() === "stake") && "bg-success/20 text-success",
                        (tx.type.toLowerCase() === "sell" || tx.type.toLowerCase() === "unstake") && "bg-destructive/20 text-destructive",
                        (tx.type.toLowerCase() === "swap" || tx.type.toLowerCase() === "bridge" || tx.type.toLowerCase() === "claim") && "bg-secondary/20 text-secondary"
                      )}>
                        {tx.type[0]}
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{tx.type} {tx.asset}</p>
                        <p className="text-xs text-muted-foreground">{tx.time}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-foreground">{tx.value}</p>
                      <p className="text-xs text-success">{tx.status}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
