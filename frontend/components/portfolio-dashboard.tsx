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
const MAX_PNL_RATIO_TO_PORTFOLIO = 50
const MAX_ABS_PNL_WITHOUT_PORTFOLIO = 1_000_000
type AssetChain = "starknet" | "evm" | "bitcoin" | "other"

const resolveAssetChain = (symbol: string): AssetChain => {
  const normalized = symbol.toUpperCase()
  if (["STRK", "CAREL", "USDC", "USDT", "WBTC"].includes(normalized)) return "starknet"
  if (normalized === "ETH") return "evm"
  if (normalized === "BTC") return "bitcoin"
  return "other"
}

/**
 * Parses or transforms values for `sanitizeUsdValue`.
 *
 * @param value - Input used by `sanitizeUsdValue` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const sanitizeUsdValue = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(value, MAX_ASSET_VALUE_USD)
}

/**
 * Parses or transforms values for `sanitizePercent`.
 *
 * @param value - Input used by `sanitizePercent` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const sanitizePercent = (value: number) => {
  if (!Number.isFinite(value)) return 0
  const capped = Math.max(-9999, Math.min(9999, value))
  return Number(capped.toFixed(2))
}

// Internal helper that supports `deriveChartPnlFallback` operations.
const deriveChartPnlFallback = (data: ChartPoint[]) => {
  if (data.length < 2) return 0
  const first = Number(data[0]?.value)
  const last = Number(data[data.length - 1]?.value)
  if (!Number.isFinite(first) || !Number.isFinite(last)) return 0
  return last - first
}

// Internal helper that supports `isPnlOutlier` operations.
const isPnlOutlier = (pnlValue: number, portfolioValue: number) => {
  if (!Number.isFinite(pnlValue)) return true
  if (portfolioValue > 0) {
    return Math.abs(pnlValue) > portfolioValue * MAX_PNL_RATIO_TO_PORTFOLIO
  }
  return Math.abs(pnlValue) > MAX_ABS_PNL_WITHOUT_PORTFOLIO
}

/**
 * Parses or transforms values for `formatUsd`.
 *
 * @param value - Input used by `formatUsd` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const formatUsd = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "$0.00"
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * Parses or transforms values for `formatUsdCompact`.
 *
 * @param value - Input used by `formatUsdCompact` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const formatUsdCompact = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "$0"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * Parses or transforms values for `formatPercent`.
 *
 * @param value - Input used by `formatPercent` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const formatPercent = (value: number) => `${sanitizePercent(value)}%`

/**
 * Parses or transforms values for `formatTokenAmount`.
 *
 * @param value - Input used by `formatTokenAmount` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
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

/**
 * Handles `MiniChart` logic.
 *
 * @param data - Input used by `MiniChart` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
type ChartPoint = { label: string; value: number; tooltipLabel?: string }

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
            <feGaussianBlur stdDeviation="1.3" result="blur" />
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
          strokeWidth="1.35"
          strokeDasharray="2 2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <polyline
          points={linePoints}
          fill="none"
          stroke={`url(#chartLine-${chartUid})`}
          strokeWidth="2.2"
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

/**
 * Handles `AssetRow` logic.
 *
 * @param asset - Input used by `AssetRow` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
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

/**
 * Handles `PortfolioDashboard` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
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
    /**
     * Handles `loadPortfolio` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
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
          const tooltipLabel = selectedPeriod === "24H"
            ? date.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : date.toLocaleDateString("en-US", {
                weekday: "short",
                year: "numeric",
                month: "short",
                day: "numeric",
              })
          return { label, tooltipLabel, value: point.close }
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

    /**
     * Parses or transforms values for `formatRelativeTime`.
     *
     * @param iso - Input used by `formatRelativeTime` to compute state, payload, or request behavior.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
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

    /**
     * Parses or transforms values for `parseNumber`.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const parseNumber = (value?: string | number | null) => {
      if (value === null || value === undefined) return 0
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : 0
    }

    /**
     * Handles `loadTransactions` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
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

  /**
   * Handles `safeNumber` logic.
   *
   * @param value - Input used by `safeNumber` to compute state, payload, or request behavior.
   * @param fallback - Input used by `safeNumber` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
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

  const rawPnlValue = analytics
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
  const chartPnlFallback = deriveChartPnlFallback(chartData)
  const pnlOutlier = hasAnalytics && isPnlOutlier(rawPnlValue, resolvedTotalValue)
  const pnlValue = pnlOutlier ? chartPnlFallback : rawPnlValue
  const initialValueEstimate = resolvedTotalValue - pnlValue
  const pnlPercent = initialValueEstimate > 0
    ? (pnlValue / initialValueEstimate) * 100
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
    pnl: Number.isFinite(pnlValue) ? Number(pnlValue.toFixed(2)) : 0,
    pnlPercent: sanitizePercent(pnlPercent),
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
        <h2 className="text-2xl font-bold text-foreground carel-tech-heading">Portfolio Overview</h2>
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
        <div className="p-6 rounded-2xl glass border border-border hover:border-primary/50 transition-all duration-300 flex flex-col">
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

          <MiniChart data={chartData} className="flex-1 min-h-[260px]" />
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
