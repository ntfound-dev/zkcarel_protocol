"use client"

import type { WalletContextType } from "@/hooks/wallet/use-wallet"
import * as React from "react"
import {
  getPortfolioAnalytics,
  getPortfolioBalance,
  getPortfolioOHLCV,
  type AnalyticsResponse,
  type BalanceResponse,
  type PortfolioOHLCVPoint,
} from "@/lib/api"
import type { ChartPoint } from "@/components/portfolio/mini-chart"
import {
  assetMeta,
  deriveChartPnlFallback,
  isPnlOutlier,
  resolveAssetChain,
  sanitizePercent,
  sanitizeUsdValue,
  type PortfolioAsset,
  type PortfolioSnapshot,
} from "@/lib/portfolio-utils"

type WalletContext = WalletContextType

type UsePortfolioDataParams = {
  selectedPeriod: string
  wallet: WalletContext
}

type UsePortfolioDataResult = {
  displayData: PortfolioSnapshot
  chartData: ChartPoint[]
  hasAnalytics: boolean
  isPositive: boolean
  pnlSign: string
  bestPerformer: PortfolioAsset | null
}

export function usePortfolioData({
  selectedPeriod,
  wallet,
}: UsePortfolioDataParams): UsePortfolioDataResult {
  const [analytics, setAnalytics] = React.useState<AnalyticsResponse | null>(null)
  const [portfolioBalance, setPortfolioBalance] = React.useState<BalanceResponse | null>(null)
  const [chartData, setChartData] = React.useState<ChartPoint[]>([])

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
    const periodConfig =
      selectedPeriod === "24H"
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
          const label =
            selectedPeriod === "24H"
              ? date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
              : date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
          const tooltipLabel =
            selectedPeriod === "24H"
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

  const derived = React.useMemo(() => {
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

    const periodKey: "pnl_24h" | "pnl_7d" | "pnl_30d" | "pnl_all_time" =
      selectedPeriod === "24H"
        ? "pnl_24h"
        : selectedPeriod === "7D"
        ? "pnl_7d"
        : selectedPeriod === "30D"
        ? "pnl_30d"
        : "pnl_all_time"

    const hasAnalytics = Boolean(analytics)
    const totalValue = analytics ? safeNumber(analytics.portfolio.total_value_usd, 0) : 0
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

    const rawPnlValue = analytics ? safeNumber(analytics.portfolio[periodKey], 0) : 0
    const hasStarknetWallet = Boolean(effectiveStarknetAddress)
    const hasEvmWallet = Boolean(wallet.evmAddress)
    const hasBtcWallet = Boolean(wallet.btcAddress)

    const portfolioLookup = new Map<
      string,
      { amount: number; value: number; price: number; change: number }
    >()
    if (portfolioBalance) {
      for (const item of portfolioBalance.balances) {
        const symbol = item.token.toUpperCase()
        portfolioLookup.set(symbol, {
          amount: safeNumber(item.amount, 0),
          value: safeNumber(item.value_usd, 0),
          price: safeNumber(item.price, 0),
          change: safeNumber(item.change_24h, 0),
        })
      }
    }

    const walletBalanceEntries = Object.entries(wallet.balance ?? {}).map(([symbol, amount]) => ({
      symbol: symbol.toUpperCase(),
      amount: safeNumber(amount, 0),
    }))
    const walletHoldings = walletBalanceEntries.filter((entry) => entry.amount > 0)
    const walletHasHoldings = walletHoldings.length > 0

    const symbols = new Set<string>()
    if (walletHasHoldings) {
      for (const entry of walletHoldings) symbols.add(entry.symbol)
    }
    if (portfolioBalance) {
      for (const item of portfolioBalance.balances) symbols.add(item.token.toUpperCase())
    }
    if (!walletHasHoldings && !portfolioBalance && analytics) {
      for (const item of analytics.portfolio.allocation) symbols.add(item.asset.toUpperCase())
    }

    const assetsRaw: PortfolioAsset[] = Array.from(symbols).map((symbol) => {
      const meta = assetMeta[symbol] || { name: symbol, icon: "•" }
      const chain = resolveAssetChain(symbol)
      const chainLinked =
        (chain === "starknet" && hasStarknetWallet) ||
        (chain === "evm" && hasEvmWallet) ||
        (chain === "bitcoin" && hasBtcWallet)
      const overrideAmount = onchainAmountOverride[symbol]
      const portfolioItem = portfolioLookup.get(symbol)
      const backendAmount = portfolioItem ? safeNumber(portfolioItem.amount, 0) : 0
      const walletAmount = safeNumber(wallet.balance?.[symbol], 0)
      const amount = chainLinked
        ? overrideAmount !== null && Number.isFinite(overrideAmount)
          ? overrideAmount
          : Math.max(walletAmount, backendAmount)
        : Math.max(walletAmount, backendAmount)

      const backendValue = portfolioItem ? safeNumber(portfolioItem.value, 0) : 0
      const backendPrice = portfolioItem ? safeNumber(portfolioItem.price, 0) : 0
      const inferredPrice =
        backendAmount > 0 && backendValue > 0 ? backendValue / backendAmount : 0
      const derivedPrice =
        backendPrice > 0
          ? backendPrice
          : inferredPrice > 0
          ? inferredPrice
          : backendValue > 0 && amount > 0
          ? backendValue / amount
          : 0
      const value = derivedPrice > 0 ? amount * derivedPrice : backendValue
      const change = portfolioItem ? sanitizePercent(portfolioItem.change) : 0

      return {
        symbol,
        name: meta.name,
        icon: meta.icon,
        amount,
        value: sanitizeUsdValue(value),
        percent: 0,
        change,
      }
    })
    if (!walletHasHoldings && !portfolioBalance && analytics) {
      for (const item of analytics.portfolio.allocation) {
        const symbol = item.asset.toUpperCase()
        if (symbols.has(symbol)) continue
        const meta = assetMeta[symbol] || { name: symbol, icon: "•" }
        assetsRaw.push({
          symbol,
          name: meta.name,
          icon: meta.icon,
          amount: 0,
          value: sanitizeUsdValue(safeNumber(item.value_usd, 0)),
          percent: 0,
          change: 0,
        })
      }
    }

    const totalValueFromAssets = assetsRaw.reduce((sum, asset) => sum + asset.value, 0)
    const resolvedTotalValue = totalValueFromAssets > 0 ? totalValueFromAssets : totalValue
    const chartPnlFallback = deriveChartPnlFallback(chartData)
    const pnlOutlier = hasAnalytics && isPnlOutlier(rawPnlValue, resolvedTotalValue)
    const pnlValue = pnlOutlier ? chartPnlFallback : rawPnlValue
    const initialValueEstimate = resolvedTotalValue - pnlValue
    const pnlPercent = initialValueEstimate > 0 ? (pnlValue / initialValueEstimate) * 100 : 0
    let assets = assetsRaw.map((asset) => ({
      ...asset,
      percent: 0,
    }))
    const totalAmount = assets.reduce((sum, asset) => sum + (asset.amount || 0), 0)
    const useAmountPercent = resolvedTotalValue <= 0 && totalAmount > 0
    assets = assets
      .map((asset) => ({
        ...asset,
        percent: useAmountPercent
          ? (asset.amount / totalAmount) * 100
          : resolvedTotalValue > 0
          ? (asset.value / resolvedTotalValue) * 100
          : 0,
      }))
      .sort((a, b) => b.value - a.value)

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

    return {
      displayData,
      hasAnalytics,
      isPositive,
      pnlSign,
      bestPerformer,
    }
  }, [analytics, chartData, portfolioBalance, selectedPeriod, wallet])

  return {
    displayData: derived.displayData,
    chartData,
    hasAnalytics: derived.hasAnalytics,
    isPositive: derived.isPositive,
    pnlSign: derived.pnlSign,
    bestPerformer: derived.bestPerformer,
  }
}
