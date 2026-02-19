"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, PieChart, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  getPortfolioAnalytics,
  getPortfolioBalance,
  getPortfolioOHLCV,
  getTransactionsHistory,
  type AnalyticsResponse,
  type BalanceResponse,
  type PortfolioOHLCVPoint,
  type Transaction,
} from "@/lib/api"
import { useWallet } from "@/hooks/use-wallet"
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
  WBTC: { name: "Wrapped Bitcoin", icon: "₿" },
  ETH: { name: "Ethereum", icon: "Ξ" },
  CAREL: { name: "Carel Protocol", icon: "◇" },
  STRK: { name: "StarkNet", icon: "◈" },
  USDT: { name: "Tether", icon: "₮" },
  USDC: { name: "USD Coin", icon: "⭕" },
}

const MAX_ASSET_VALUE_USD = 1_000_000
type AssetChain = "starknet" | "evm" | "bitcoin" | "other"

const resolveAssetChain = (symbol: string): AssetChain => {
  const normalized = symbol.toUpperCase()
  if (["STRK", "CAREL", "USDC", "USDT", "WBTC"].includes(normalized)) return "starknet"
  if (normalized === "ETH") return "evm"
  if (normalized === "BTC") return "bitcoin"
  return "other"
}

const sanitizeUsdValue = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(value, MAX_ASSET_VALUE_USD)
}

const sanitizePercent = (value: number) => {
  if (!Number.isFinite(value)) return 0
  const capped = Math.max(-9999, Math.min(9999, value))
  return Number(capped.toFixed(2))
}

const formatUsd = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "$0.00"
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

const formatUsdCompact = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "$0"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value)
}

const formatPercent = (value: number) => `${sanitizePercent(value)}%`

const formatTokenAmount = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0"
  if (value >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  if (value >= 1) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 })
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
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-full bg-surface flex items-center justify-center text-xl border border-border">
          {asset.icon}
        </div>
        <div className="min-w-0">
          <p className="font-medium text-foreground truncate">{asset.symbol}</p>
          <p className="text-xs text-muted-foreground truncate">{asset.name}</p>
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
          <p className="text-xs text-muted-foreground mt-1 text-center">{formatPercent(asset.percent)}</p>
        </div>
        <div className="text-right min-w-[110px] shrink-0">
          <p className="font-medium text-foreground break-words">{formatUsd(asset.value)}</p>
          <p className={cn(
            "text-xs flex items-center justify-end gap-1",
            isPositive ? "text-success" : "text-destructive"
          )}>
            {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {isPositive ? "+" : ""}{formatPercent(asset.change)}
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
  visibility: "Hide" | "Public"
  amountIn: number
  amountOut: number
  tokenIn: string
  tokenOut: string
  usdValue: number
}

export function PortfolioDashboard() {
  const wallet = useWallet()
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const [selectedPeriod, setSelectedPeriod] = React.useState("7D")
  const [analytics, setAnalytics] = React.useState<AnalyticsResponse | null>(null)
  const [portfolioBalance, setPortfolioBalance] = React.useState<BalanceResponse | null>(null)
  const [chartData, setChartData] = React.useState<ChartPoint[]>([])
  const [transactions, setTransactions] = React.useState<UiTransaction[]>([])

  React.useEffect(() => {
    let active = true
    const loadPortfolio = async () => {
      try {
        const [analyticsRes, balanceRes] = await Promise.all([
          getPortfolioAnalytics().catch(() => null),
          getPortfolioBalance().catch(() => null),
        ])
        if (!active) return
        setAnalytics(analyticsRes)
        setPortfolioBalance(balanceRes)
      } catch {
        if (!active) return
        setAnalytics(null)
        setPortfolioBalance(null)
      }
    }
    void loadPortfolio()
    const interval = window.setInterval(() => {
      void loadPortfolio()
    }, 30000)

    return () => {
      active = false
      window.clearInterval(interval)
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
        setChartData(mapped)
      } catch {
        if (!active) return
        setChartData([])
      }
    })()

    return () => {
      active = false
    }
  }, [selectedPeriod])

  React.useEffect(() => {
    if (!detailsOpen) return
    let active = true
    let pollingTimer: number | undefined

    const formatRelativeTime = (iso: string) => {
      const date = new Date(iso)
      const timeMs = date.getTime()
      if (!Number.isFinite(timeMs) || Number.isNaN(timeMs)) return "—"
      const safeDiffMs = Math.max(0, Date.now() - timeMs)
      const minutes = Math.floor(safeDiffMs / 60000)
      if (minutes < 1) return "just now"
      if (minutes < 60) return `${minutes} min ago`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
      const days = Math.floor(hours / 24)
      return `${days} day${days === 1 ? "" : "s"} ago`
    }

    const parseNumber = (value?: string | number | null) => {
      if (value === null || value === undefined) return 0
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : 0
    }

    const loadTransactions = async () => {
      try {
        const response = await getTransactionsHistory({ page: 1, limit: 20 })
        if (!active) return
        const mapped = response.items.map((tx: Transaction) => {
	          const txType = (tx.tx_type || "").trim()
	          const txTypeLower = txType.toLowerCase()
	          const blockNumber = Number(tx.block_number || 0)
	          const hasOnchainBlock = Number.isFinite(blockNumber) && blockNumber > 0
	          const isCompleted = hasOnchainBlock || Boolean(tx.processed)
	          const tokenLabel = tx.token_out
	            ? `${tx.token_in || ""} → ${tx.token_out}`
	            : tx.token_in || tx.tx_type
          const amountIn = parseNumber(tx.amount_in)
          const amountOut = parseNumber(tx.amount_out)
          const amount = parseNumber(tx.amount_in || tx.amount_out || 0)
          const usdValue = parseNumber(tx.usd_value)
          const tokenIn = String(tx.token_in || "").toUpperCase()
          const tokenOut = String(tx.token_out || "").toUpperCase()
          const visibility: UiTransaction["visibility"] = txTypeLower.includes("private")
            ? "Hide"
            : "Public"
          return {
            id: tx.tx_hash,
            type: txType.toUpperCase(),
            asset: tokenLabel.trim() || tx.tx_type,
            amount: amount ? amount.toString() : "—",
            value: usdValue ? `$${usdValue.toLocaleString()}` : "—",
            time: formatRelativeTime(tx.timestamp),
	            status: isCompleted ? "Completed" : "Pending",
            visibility,
            amountIn,
            amountOut,
            tokenIn,
            tokenOut,
            usdValue,
          }
        })
        setTransactions(mapped)
      } catch {
        if (!active) return
        setTransactions([])
      }
    }

    void loadTransactions()
    pollingTimer = window.setInterval(() => {
      void loadTransactions()
    }, 12000)

    return () => {
      active = false
      if (pollingTimer) window.clearInterval(pollingTimer)
    }
  }, [detailsOpen])

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

  const hasAnalytics = Boolean(analytics)
  const totalValue = analytics
    ? safeNumber(analytics.portfolio.total_value_usd, 0)
    : 0
  const effectiveStarknetAddress =
    wallet.starknetAddress || (wallet.network === "starknet" ? wallet.address : null)
  const onchainAmountOverride: Record<string, number | null> = {
    STRK: effectiveStarknetAddress ? wallet.onchainBalance.STRK_L2 : null,
    CAREL: effectiveStarknetAddress ? wallet.onchainBalance.CAREL : null,
    USDC: effectiveStarknetAddress ? wallet.onchainBalance.USDC : null,
    USDT: effectiveStarknetAddress ? wallet.onchainBalance.USDT : null,
    WBTC: effectiveStarknetAddress ? wallet.onchainBalance.WBTC : null,
    ETH: wallet.evmAddress ? wallet.onchainBalance.ETH : null,
    BTC: wallet.btcAddress ? wallet.onchainBalance.BTC : null,
  }

  const pnlValue = analytics
    ? safeNumber(analytics.portfolio[periodKey], 0)
    : 0
  const hasStarknetWallet = Boolean(effectiveStarknetAddress)
  const hasEvmWallet = Boolean(wallet.evmAddress)
  const hasBtcWallet = Boolean(wallet.btcAddress)

  const assetsRaw: PortfolioAsset[] = portfolioBalance
    ? portfolioBalance.balances.map((item) => {
        const symbol = item.token.toUpperCase()
        const meta = assetMeta[symbol] || { name: symbol, icon: "•" }
        const chain = resolveAssetChain(symbol)
        const chainLinked =
          (chain === "starknet" && hasStarknetWallet) ||
          (chain === "evm" && hasEvmWallet) ||
          (chain === "bitcoin" && hasBtcWallet)
        const overrideAmount = onchainAmountOverride[symbol]
        const backendAmount = Number(item.amount || 0)
        const amount = chainLinked
          ? (overrideAmount !== null && Number.isFinite(overrideAmount) ? overrideAmount : backendAmount)
          : backendAmount
        const backendValue = Number(item.value_usd || 0)
        const fallbackPrice = Number(item.price || 0)
        const inferredPrice = backendAmount > 0 ? backendValue / backendAmount : 0
        const price = Number.isFinite(fallbackPrice) && fallbackPrice > 0 ? fallbackPrice : inferredPrice
        const value = chainLinked
          ? (Number.isFinite(price) && price > 0 ? amount * price : 0)
          : backendValue
        return {
          symbol,
          name: meta.name,
          icon: meta.icon,
          value: sanitizeUsdValue(value),
          percent: 0,
          change: sanitizePercent(Number(item.change_24h || 0)),
        }
      })
    : analytics
    ? analytics.portfolio.allocation.map((item) => {
        const meta = assetMeta[item.asset] || { name: item.asset, icon: "•" }
        return {
          symbol: item.asset,
          name: meta.name,
          icon: meta.icon,
          value: sanitizeUsdValue(safeNumber(item.value_usd, 0)),
          percent: 0,
          change: 0,
        }
      })
    : []

  const totalValueFromAssets = assetsRaw.reduce((sum, asset) => sum + asset.value, 0)
  const resolvedTotalValue = totalValueFromAssets > 0 ? totalValueFromAssets : totalValue
  const pnlPercent = resolvedTotalValue > 0
    ? (pnlValue / resolvedTotalValue) * 100
    : 0
  const assets = assetsRaw.map((asset) => ({
    ...asset,
    percent: resolvedTotalValue > 0 ? (asset.value / resolvedTotalValue) * 100 : 0,
  }))

  const bestPerformer = assets.reduce<PortfolioAsset | null>((best, asset) => {
    if (!best) return asset
    return asset.change > best.change ? asset : best
  }, null)

  const displayData: PortfolioSnapshot = {
    totalValue: sanitizeUsdValue(resolvedTotalValue),
    pnl: pnlValue,
    pnlPercent: Number.isFinite(pnlPercent) ? Number(pnlPercent.toFixed(2)) : 0,
    period: selectedPeriod,
    assets,
  }

  const isPositive = hasAnalytics ? displayData.pnl >= 0 : true
  const pnlSign = displayData.pnl >= 0 ? "+" : "-"
  const txSummary = React.useMemo(() => {
    const pending = transactions.filter((tx) => tx.status === "Pending").length
    const inbound = transactions.filter((tx) => tx.amountOut > 0).length
    const outbound = transactions.filter((tx) => tx.amountIn > 0).length
    const hide = transactions.filter((tx) => tx.visibility === "Hide").length
    return { pending, inbound, outbound, hide }
  }, [transactions])

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
              {hasAnalytics ? `${pnlSign}${formatUsd(Math.abs(displayData.pnl))}` : "—"}
            </span>
            <span className={cn(
              "text-sm font-medium pb-1 flex items-center gap-1",
              isPositive ? "text-success" : "text-destructive"
            )}>
              {hasAnalytics ? (
                <>
                  {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {isPositive ? "+" : ""}{displayData.pnlPercent}%
                </>
              ) : (
                "—"
              )}
            </span>
          </div>

          <MiniChart data={chartData} />
        </div>

        {/* Asset Allocation */}
        <div className="p-6 rounded-2xl glass border border-border hover:border-primary/50 transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">Asset Allocation</span>
            </div>
            <span className="text-2xl font-bold text-foreground">
              {hasAnalytics ? formatUsd(displayData.totalValue) : "—"}
            </span>
          </div>

          <div className="space-y-1">
            {displayData.assets.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No portfolio data</div>
            ) : (
              displayData.assets.map((asset) => (
                <AssetRow key={asset.symbol} asset={asset} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Portfolio Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="glass-strong bg-background/95 backdrop-blur-xl border-border max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <PieChart className="h-5 w-5 text-primary" />
              Portfolio Details
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-surface/50 border border-border min-w-0">
                <p className="text-xs text-muted-foreground">Total Value</p>
                <p
                  className="text-base md:text-lg font-bold text-foreground truncate"
                  title={hasAnalytics ? formatUsd(displayData.totalValue) : "—"}
                >
                  {hasAnalytics ? formatUsdCompact(displayData.totalValue) : "—"}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-surface/50 border border-border min-w-0">
                <p className="text-xs text-muted-foreground">Total PnL</p>
                <p
                  className={cn(
                    "text-base md:text-lg font-bold truncate",
                    isPositive ? "text-success" : "text-destructive"
                  )}
                  title={hasAnalytics ? `${pnlSign}${formatUsd(Math.abs(displayData.pnl))}` : "—"}
                >
                  {hasAnalytics ? `${pnlSign}${formatUsdCompact(Math.abs(displayData.pnl))}` : "—"}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-surface/50 border border-border min-w-0">
                <p className="text-xs text-muted-foreground">Assets</p>
                <p className="text-lg font-bold text-foreground">
                  {hasAnalytics ? displayData.assets.length : "—"}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-surface/50 border border-border min-w-0">
                <p className="text-xs text-muted-foreground">Best Performer</p>
                <p className={cn(
                  "text-base md:text-lg font-bold truncate",
                  bestPerformer && bestPerformer.change >= 0 ? "text-success" : "text-destructive"
                )} title={bestPerformer ? `${bestPerformer.symbol} ${bestPerformer.change >= 0 ? "+" : ""}${formatPercent(bestPerformer.change)}` : "—"}>
                  {bestPerformer ? `${bestPerformer.symbol} ${bestPerformer.change >= 0 ? "+" : ""}${formatPercent(bestPerformer.change)}` : "—"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="p-2 rounded-lg bg-success/10 border border-success/30 text-center">
                <p className="text-[10px] text-muted-foreground">In</p>
                <p className="text-sm font-semibold text-success">{txSummary.inbound}</p>
              </div>
              <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/30 text-center">
                <p className="text-[10px] text-muted-foreground">Out</p>
                <p className="text-sm font-semibold text-destructive">{txSummary.outbound}</p>
              </div>
              <div className="p-2 rounded-lg bg-secondary/10 border border-secondary/30 text-center">
                <p className="text-[10px] text-muted-foreground">Pending</p>
                <p className="text-sm font-semibold text-secondary">{txSummary.pending}</p>
              </div>
              <div className="p-2 rounded-lg bg-primary/10 border border-primary/30 text-center min-w-0">
                <p className="text-[10px] text-muted-foreground">Hide Tx</p>
                <p className="text-sm font-semibold text-primary">
                  {txSummary.hide}
                </p>
              </div>
            </div>

            {/* Asset Breakdown */}
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">Asset Breakdown</h3>
              <div className="space-y-3">
                {displayData.assets.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">No asset data</div>
                ) : (
                  displayData.assets.map((asset) => (
                    <div key={asset.symbol} className="flex items-center justify-between p-3 rounded-lg bg-surface/30 border border-border">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center text-lg border border-border">
                          {asset.icon}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">{asset.symbol}</p>
                          <p className="text-xs text-muted-foreground truncate">{asset.name}</p>
                        </div>
                      </div>
                      <div className="text-right min-w-[96px] shrink-0">
                        <p className="font-medium text-foreground break-words">{formatUsd(asset.value)}</p>
                        {asset.change !== 0 && (
                          <p className={cn("text-xs", asset.change >= 0 ? "text-success" : "text-destructive")}>
                            {asset.change >= 0 ? "+" : ""}{formatPercent(asset.change)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Transaction History */}
            <div>
              <div className="mb-3">
                <h3 className="text-sm font-medium text-foreground">Recent Transactions</h3>
                <p className="text-[11px] text-muted-foreground">
                  Shows latest on-chain records with IN/OUT movement and pending status.
                </p>
              </div>
	              <div className="space-y-2">
	                {transactions.length === 0 ? (
	                  <div className="text-center py-6 text-muted-foreground">No recent transactions</div>
	                ) : (
	                  transactions.map((tx) => {
	                    const txKind = tx.type.toLowerCase().replace(/^private_/, "")
	                    return (
	                      <div key={tx.id} className="flex items-center justify-between p-3 rounded-lg bg-surface/30 border border-border">
	                        <div className="flex items-center gap-3 min-w-0">
	                          <div className={cn(
	                            "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
	                            (txKind === "buy" || txKind === "stake") && "bg-success/20 text-success",
	                            (txKind === "sell" || txKind === "unstake") && "bg-destructive/20 text-destructive",
	                            (txKind === "swap" || txKind === "bridge" || txKind === "claim" || txKind === "limit_order") && "bg-secondary/20 text-secondary"
	                          )}>
	                            {tx.type[0]}
	                          </div>
	                          <div className="min-w-0">
	                            <p className="font-medium text-foreground truncate" title={`${tx.type} ${tx.asset}`}>
	                              {tx.type} {tx.asset}
	                            </p>
	                            <div className="flex flex-wrap items-center gap-2 text-[11px]">
	                              {tx.amountIn > 0 && (
	                                <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">
	                                  OUT {formatTokenAmount(tx.amountIn)} {tx.tokenIn || "?"}
	                                </span>
	                              )}
	                              {tx.amountOut > 0 && (
	                                <span className="rounded bg-success/15 px-1.5 py-0.5 text-success">
	                                  IN {formatTokenAmount(tx.amountOut)} {tx.tokenOut || "?"}
	                                </span>
	                              )}
	                            </div>
	                            <p className="text-xs text-muted-foreground">{tx.time}</p>
	                          </div>
	                        </div>
	                        <div className="text-right shrink-0 min-w-[110px]">
	                          <p className="font-medium text-foreground">{tx.value}</p>
	                          <div className="mt-1 flex items-center justify-end gap-1">
	                            <span className={cn(
	                              "text-[10px] rounded px-1.5 py-0.5 border",
	                              tx.visibility === "Hide"
	                                ? "border-primary/40 bg-primary/15 text-primary"
	                                : "border-border bg-surface/60 text-muted-foreground"
	                            )}>
	                              {tx.visibility}
	                            </span>
	                            <span className={cn(
	                              "text-[10px] rounded px-1.5 py-0.5 border",
	                              tx.status === "Completed"
	                                ? "border-success/40 bg-success/15 text-success"
	                                : "border-secondary/40 bg-secondary/15 text-secondary"
	                            )}>
	                              {tx.status}
	                            </span>
	                          </div>
	                        </div>
	                      </div>
	                    )
	                  })
	                )}
	              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
