import { tokenMetaCatalog } from "@/lib/token-config"

export type PortfolioAsset = {
  symbol: string
  name: string
  icon: string
  amount: number
  value: number
  percent: number
  change: number
}

export type PortfolioSnapshot = {
  totalValue: number
  pnl: number
  pnlPercent: number
  period: string
  assets: PortfolioAsset[]
}

export type UiTransaction = {
  id: string
  type: string
  asset: string
  amount: string
  value: string
  time: string
  status: string
  visibility: "Hide" | "Public"
  requestSource: "manual" | "ai"
  amountIn: number
  amountOut: number
  tokenIn: string
  tokenOut: string
  usdValue: number
}

export const assetMeta: Record<string, { name: string; icon: string }> = tokenMetaCatalog.reduce(
  (acc, token) => {
    acc[token.symbol] = { name: token.name, icon: token.icon }
    return acc
  },
  {} as Record<string, { name: string; icon: string }>
)

const MAX_ASSET_VALUE_USD = 1_000_000
const MAX_PNL_RATIO_TO_PORTFOLIO = 50
const MAX_ABS_PNL_WITHOUT_PORTFOLIO = 1_000_000

export type AssetChain = "starknet" | "evm" | "bitcoin" | "other"

export const resolveAssetChain = (symbol: string): AssetChain => {
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
export const sanitizeUsdValue = (value: number) => {
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
export const sanitizePercent = (value: number) => {
  if (!Number.isFinite(value)) return 0
  const capped = Math.max(-9999, Math.min(9999, value))
  return Number(capped.toFixed(2))
}

// Internal helper that supports `deriveChartPnlFallback` operations.
export const deriveChartPnlFallback = (data: Array<{ value: number }>) => {
  if (data.length < 2) return 0
  const first = Number(data[0]?.value)
  const last = Number(data[data.length - 1]?.value)
  if (!Number.isFinite(first) || !Number.isFinite(last)) return 0
  return last - first
}

// Internal helper that supports `isPnlOutlier` operations.
export const isPnlOutlier = (pnlValue: number, portfolioValue: number) => {
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
export const formatUsd = (value: number) => {
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
export const formatUsdCompact = (value: number) => {
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
export const formatPercent = (value: number) => `${sanitizePercent(value)}%`

/**
 * Parses or transforms values for `formatTokenAmount`.
 *
 * @param value - Input used by `formatTokenAmount` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export const formatTokenAmount = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0"
  if (value >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  if (value >= 1) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 })
}
