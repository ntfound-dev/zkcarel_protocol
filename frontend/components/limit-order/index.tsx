"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Info,
  Expand,
  X,
  AlertCircle,
  Gift,
  Sparkles,
  Eye,
  EyeOff,
} from "lucide-react"
import { useNotifications } from "@/hooks/notifications/use-notifications"
import { useWallet } from "@/hooks/wallet/use-wallet"
import { useLimitActions } from "@/hooks/limit/use-limit-actions"
import { useLimitHideActions } from "@/hooks/limit/use-limit-hide-actions"
import type { PrivacyVerificationPayload } from "@/lib/api"
import {
  AI_LIMIT_ORDER_SOURCES_UPDATED_EVENT,
  loadAiLimitOrderSourceIds,
} from "@/lib/ai-execution-source"
import { useLivePrices } from "@/hooks/price/use-live-prices"
import { useOrderUpdates, type OrderUpdate } from "@/hooks/limit/use-order-updates"
import { useLimitData } from "@/hooks/limit/use-limit-data"
import { CandlestickChart } from "@/components/limit-order/candlestick-chart"
import { ChartFullscreenModal } from "@/components/limit-order/ChartFullscreenModal"
import { ConfirmOrderDialog } from "@/components/limit-order/ConfirmOrderDialog"
import { HideBalanceLimitDialog } from "@/components/limit-order/HideBalanceLimitDialog"
import {
  DEV_AUTO_GARAGA_PAYLOAD_ENABLED,
  HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED,
  HIDE_BALANCE_RELAYER_POOL_ENABLED,
  LIMIT_PRIVACY_PAYLOAD_UPDATED_EVENT,
  LIMIT_PRIVACY_PENDING_NOTES_UPDATED_EVENT,
  STARKNET_LIMIT_ORDER_BOOK_ADDRESS,
  STARKNET_TOKEN_ADDRESS_MAP,
  TOKEN_DECIMALS,
  USDT_POINTS_TIER_OPTIONS,
  loadPendingHideNotes,
  loadTradePrivacyPayload,
  pricePresets,
  sellPresets,
  stableSymbols,
  tokenCatalog,
  expiryOptions,
  usdtTierBonusPercent,
  type UsdtTierOption,
  type TokenItem,
  type UiOrder,
  type PendingHideNoteRecord,
} from "@/lib/limit-utils"

const withOrderSourceLabel = (orders: UiOrder[]): UiOrder[] => {
  const aiOrderIds = loadAiLimitOrderSourceIds()
  return orders.map((order) => ({
    ...order,
    requestSource: aiOrderIds.has(order.id.trim().toLowerCase()) ? "ai" : "manual",
  }))
}

/**
 * Handles `LimitOrder` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function LimitOrder() {
  const notifications = useNotifications()
  const wallet = useWallet()
  const { prices: livePrices, changes: liveChanges } = useLivePrices(
    React.useMemo(() => tokenCatalog.map((token: TokenItem) => token.symbol), []),
    { fallbackPrices: { CAREL: 1, USDC: 1, USDT: 1, WBTC: 68000 } }
  )
  const [tokens, setTokens] = React.useState<TokenItem[]>(tokenCatalog)
  const [selectedToken, setSelectedToken] = React.useState(tokens[0])
  const [payToken, setPayToken] = React.useState(
    tokenCatalog.find((token: TokenItem) => token.symbol === "USDT") ??
      tokenCatalog[tokenCatalog.length - 1]
  )
  const [receiveToken, setReceiveToken] = React.useState(
    tokenCatalog.find((token: TokenItem) => token.symbol === "USDT") ??
      tokenCatalog[tokenCatalog.length - 1]
  )
  const [orderType, setOrderType] = React.useState<"buy" | "sell">("buy")
  const [amount, setAmount] = React.useState("")
  const [price, setPrice] = React.useState("")
  const [expiry, setExpiry] = React.useState(expiryOptions[2].value)
  const [chartModalOpen, setChartModalOpen] = React.useState(false)
  const [chartPeriod, setChartPeriod] = React.useState("24H")
  const [showConfirmDialog, setShowConfirmDialog] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [submitSuccess, setSubmitSuccess] = React.useState(false)
  const [balanceHidden, setBalanceHidden] = React.useState(false)
  const [hideBalancePopupOpen, setHideBalancePopupOpen] = React.useState(false)
  const [hideUsdtTierMin, setHideUsdtTierMin] = React.useState<number>(10)
  const [hasTradePrivacyPayload, setHasTradePrivacyPayload] = React.useState(false)
  const [pendingHideNotes, setPendingHideNotes] = React.useState<PendingHideNoteRecord[]>([])
  const [pendingNoteActionCommitment, setPendingNoteActionCommitment] = React.useState<string | null>(null)
  const [isAutoPrivacyProvisioning, setIsAutoPrivacyProvisioning] = React.useState(false)
  const autoPrivacyPayloadPromiseRef = React.useRef<Promise<PrivacyVerificationPayload | undefined> | null>(null)
  const manuallySelectedHideNoteRef = React.useRef<{
    noteCommitment: string
    nullifier?: string
  } | null>(null)
  const starknetProviderHint = React.useMemo<"starknet" | "argentx" | "braavos">(() => {
    if (wallet.provider === "argentx" || wallet.provider === "braavos") {
      return wallet.provider
    }
    return "starknet"
  }, [wallet.provider])
  const {
    activeNftDiscount,
    chartCandles,
    orderBook,
    orders,
    refreshOrders,
    setOrders,
    stakePointsMultiplier,
  } = useLimitData({
    wallet,
    livePrices,
    liveChanges,
    tokens,
    setTokens,
    selectedTokenSymbol: selectedToken.symbol,
    chartPeriod,
    withOrderSourceLabel,
  })

  const refreshTradePrivacyPayload = React.useCallback(() => {
    setHasTradePrivacyPayload(Boolean(loadTradePrivacyPayload()))
  }, [])

  const refreshPendingHideNotes = React.useCallback(() => {
    setPendingHideNotes(loadPendingHideNotes())
  }, [])

  const setManuallySelectedHideNote = React.useCallback(
    (noteCommitment?: string, nullifier?: string) => {
      const normalizedCommitment = (noteCommitment || "").trim().toLowerCase()
      const normalizedNullifier = (nullifier || "").trim().toLowerCase()
      if (!normalizedCommitment && !normalizedNullifier) {
        manuallySelectedHideNoteRef.current = null
        return
      }
      manuallySelectedHideNoteRef.current = {
        noteCommitment: normalizedCommitment,
        nullifier: normalizedNullifier || undefined,
      }
    },
    []
  )

  const clearManuallySelectedHideNote = React.useCallback(() => {
    manuallySelectedHideNoteRef.current = null
  }, [])

  const isManuallySelectedHideNote = React.useCallback(
    (noteCommitment?: string, nullifier?: string) => {
      const selected = manuallySelectedHideNoteRef.current
      if (!selected) return false
      const normalizedCommitment = (noteCommitment || "").trim().toLowerCase()
      const normalizedNullifier = (nullifier || "").trim().toLowerCase()
      const commitmentMatch =
        !!selected.noteCommitment &&
        !!normalizedCommitment &&
        selected.noteCommitment === normalizedCommitment
      const nullifierMatch =
        !!selected.nullifier && !!normalizedNullifier && selected.nullifier === normalizedNullifier
      return commitmentMatch || nullifierMatch
    },
    []
  )

  React.useEffect(() => {
    const fallbackStable = tokens.find((token) => stableSymbols.has(token.symbol)) || tokens[0]
    const nextSelected = tokens.find((token) => token.symbol === selectedToken.symbol) || tokens[0]
    const nextPay = tokens.find((token) => token.symbol === payToken.symbol) || fallbackStable
    const nextReceive =
      tokens.find((token) => token.symbol === receiveToken.symbol) || fallbackStable
    setSelectedToken(nextSelected)
    setPayToken(nextPay)
    setReceiveToken(nextReceive)
  }, [payToken.symbol, receiveToken.symbol, selectedToken.symbol, tokens])

  React.useEffect(() => {
    refreshTradePrivacyPayload()
    window.addEventListener(LIMIT_PRIVACY_PAYLOAD_UPDATED_EVENT, refreshTradePrivacyPayload)
    return () => {
      window.removeEventListener(LIMIT_PRIVACY_PAYLOAD_UPDATED_EVENT, refreshTradePrivacyPayload)
    }
  }, [refreshTradePrivacyPayload])

  React.useEffect(() => {
    refreshPendingHideNotes()
    window.addEventListener(LIMIT_PRIVACY_PENDING_NOTES_UPDATED_EVENT, refreshPendingHideNotes)
    return () => {
      window.removeEventListener(LIMIT_PRIVACY_PENDING_NOTES_UPDATED_EVENT, refreshPendingHideNotes)
    }
  }, [refreshPendingHideNotes])

  const applyOrderUpdate = React.useCallback((update: OrderUpdate) => {
    setOrders((prev) =>
      prev.map((order) => {
        if (order.id !== update.order_id) return order
        const status = update.status === "filled"
          ? "filled"
          : update.status === "cancelled" || update.status === "expired"
          ? "cancelled"
          : "active"
        return { ...order, status }
      })
    )
  }, [])

  useOrderUpdates(wallet.token, {
    enabled: wallet.isConnected,
    onUpdate: applyOrderUpdate,
  })

  React.useEffect(() => {
    const handleAiOrderSourceUpdated = () => {
      void refreshOrders()
    }
    window.addEventListener(AI_LIMIT_ORDER_SOURCES_UPDATED_EVENT, handleAiOrderSourceUpdated)
    return () => {
      window.removeEventListener(AI_LIMIT_ORDER_SOURCES_UPDATED_EVENT, handleAiOrderSourceUpdated)
    }
  }, [refreshOrders])

  /**
   * Handles `handlePricePreset` logic.
   *
   * @param percentage - Input used by `handlePricePreset` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handlePricePreset = (percentage: number) => {
    const marketPrice = selectedToken.price
    const newPrice = marketPrice * (1 + percentage / 100)
    setPrice(newPrice.toFixed(2))
  }

  const marketPrice = selectedToken.price
  const hasMarketPrice = marketPrice > 0
  const chartHigh =
    chartCandles.length > 0 ? Math.max(...chartCandles.map((candle) => candle.high)) : null
  const chartLow =
    chartCandles.length > 0 ? Math.min(...chartCandles.map((candle) => candle.low)) : null
  const currentPrice = Number.parseFloat(price) || 0
  const targetPriceChange = hasMarketPrice
    ? ((currentPrice - marketPrice) / marketPrice * 100).toFixed(2)
    : null
  const targetPriceChangeValue =
    targetPriceChange === null ? null : Number.parseFloat(targetPriceChange)
  const marketChangeValue =
    Number.isFinite(selectedToken.change) && Math.abs(selectedToken.change) < 90
      ? selectedToken.change
      : null
  const bids = orderBook.bids
  const asks = orderBook.asks
  const resolveAvailableBalance = React.useCallback(
    (symbol: string) => {
      const upper = symbol.toUpperCase()
      if (upper === "STRK") return wallet.onchainBalance.STRK_L2 ?? wallet.balance.STRK ?? 0
      if (upper === "CAREL") return wallet.onchainBalance.CAREL ?? wallet.balance.CAREL ?? 0
      if (upper === "USDC") return wallet.onchainBalance.USDC ?? wallet.balance.USDC ?? 0
      if (upper === "USDT") return wallet.onchainBalance.USDT ?? wallet.balance.USDT ?? 0
      if (upper === "WBTC") return wallet.onchainBalance.WBTC ?? wallet.balance.WBTC ?? 0
      if (upper === "BTC") return wallet.onchainBalance.BTC ?? wallet.balance.BTC ?? 0
      return wallet.balance[upper] ?? 0
    },
    [
      wallet.balance,
      wallet.onchainBalance.BTC,
      wallet.onchainBalance.CAREL,
      wallet.onchainBalance.STRK_L2,
      wallet.onchainBalance.USDC,
      wallet.onchainBalance.USDT,
      wallet.onchainBalance.WBTC,
    ]
  )

  const resolveUsdPrice = React.useCallback(
    (symbol: string): number => {
      const upper = symbol.toUpperCase()
      if (stableSymbols.has(upper)) return 1
      const tokenPrice =
        tokens.find((token) => token.symbol.toUpperCase() === upper)?.price ?? 0
      return Number.isFinite(tokenPrice) && tokenPrice > 0 ? tokenPrice : 0
    },
    [tokens]
  )

  const fromTokenForOrder = orderType === "buy" ? payToken.symbol : selectedToken.symbol
  const selectedHideTier =
    USDT_POINTS_TIER_OPTIONS.find(
      (option: UsdtTierOption) => option.minUsdt === hideUsdtTierMin
    ) ||
    USDT_POINTS_TIER_OPTIONS[1]
  const hideTierFromTokenPrice = resolveUsdPrice(fromTokenForOrder)
  const hideTierLockedAmount =
    balanceHidden && hideTierFromTokenPrice > 0
      ? selectedHideTier.minUsdt / hideTierFromTokenPrice
      : null
  const pendingHideNotesActive = React.useMemo(
    () =>
      pendingHideNotes.filter((note) => {
        const commitment = (note.note_commitment || "").trim()
        return commitment.length > 0
      }),
    [pendingHideNotes]
  )
  const hidePayloadStatusLabel = hasTradePrivacyPayload
    ? "payload ready"
    : isAutoPrivacyProvisioning
    ? "preparing payload"
    : "payload auto on submit"
  const hideBalanceCompactSummary = `Tier $${selectedHideTier.minUsdt} (+${selectedHideTier.bonusPercent}%) • ${hidePayloadStatusLabel} • ${pendingHideNotesActive.length} pending notes • Click for details`

  const {
    resolveHideBalancePrivacyPayload,
    ensureHideNoteDeposited,
    handleUsePendingHideNote,
    handleWithdrawPendingHideNote,
  } = useLimitHideActions({
    amount,
    price,
    expiry,
    orderType,
    payTokenSymbol: payToken.symbol,
    selectedTokenSymbol: selectedToken.symbol,
    receiveTokenSymbol: receiveToken.symbol,
    tokens,
    hideUsdtTierMin,
    notifications,
    wallet,
    starknetProviderHint,
    resolveUsdPrice,
    resolveAvailableBalance,
    setOrderType,
    setPayToken,
    setSelectedToken,
    setReceiveToken,
    setAmount,
    setHideUsdtTierMin,
    setBalanceHidden,
    setHasTradePrivacyPayload,
    setPendingHideNotes,
    setIsAutoPrivacyProvisioning,
    setPendingNoteActionCommitment,
    setManuallySelectedHideNote,
    clearManuallySelectedHideNote,
    isManuallySelectedHideNote,
    autoPrivacyPayloadPromiseRef,
    tokenAddressMap: STARKNET_TOKEN_ADDRESS_MAP,
    tokenDecimals: TOKEN_DECIMALS,
    devAutoPayloadEnabled: DEV_AUTO_GARAGA_PAYLOAD_ENABLED,
  })

  const { handleSubmitOrder, confirmOrder, cancelOrder } = useLimitActions({
    notifications,
    wallet,
    resolveHideBalancePrivacyPayload,
    ensureHideNoteDeposited,
    isManuallySelectedHideNote,
    clearManuallySelectedHideNote,
    setHasTradePrivacyPayload,
    setPendingHideNotes,
    setOrders,
    setShowConfirmDialog,
    setSubmitSuccess,
    setIsSubmitting,
    setAmount,
    setPrice,
    isSubmitting,
    balanceHidden,
    orderType,
    amount,
    price,
    expiry,
    payTokenSymbol: payToken.symbol,
    selectedTokenSymbol: selectedToken.symbol,
    receiveTokenSymbol: receiveToken.symbol,
    selectedHideTier,
    resolveAvailableBalance,
    starknetProviderHint,
    starknetLimitOrderBookAddress: STARKNET_LIMIT_ORDER_BOOK_ADDRESS,
    tokenAddressMap: STARKNET_TOKEN_ADDRESS_MAP,
    tokenDecimals: TOKEN_DECIMALS,
    hideBalanceRelayerPoolEnabled: HIDE_BALANCE_RELAYER_POOL_ENABLED,
    hideBalancePrivateExecutorEnabled: HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED,
  })

  React.useEffect(() => {
    if (!balanceHidden) return
    if (!Number.isFinite(hideTierLockedAmount || Number.NaN) || (hideTierLockedAmount || 0) <= 0) return

    const decimals = TOKEN_DECIMALS[fromTokenForOrder.toUpperCase()] ?? 18
    const precision = Math.min(decimals >= 10 ? 8 : 6, 8)
    const nextAmount = Number(hideTierLockedAmount).toFixed(precision).replace(/\.?0+$/, "")
    if (!nextAmount) return

    const currentAmount = Number.parseFloat(amount || "0")
    const drift = Math.abs(currentAmount - Number(hideTierLockedAmount))
    const tolerance = Math.max(Number(hideTierLockedAmount) * 1e-6, 1e-8)
    if (!Number.isFinite(currentAmount) || drift > tolerance) {
      setAmount(nextAmount)
    }
  }, [amount, balanceHidden, fromTokenForOrder, hideTierLockedAmount])

  /**
   * Handles `handleAmountPreset` logic.
   *
   * @param percent - Input used by `handleAmountPreset` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleAmountPreset = (percent: number) => {
    const balance = orderType === "buy" ? resolveAvailableBalance(payToken.symbol) : resolveAvailableBalance(selectedToken.symbol)
    setAmount((balance * percent / 100).toString())
  }

  const amountValue = Number.parseFloat(amount) || 0
  const estimatedUsdValue =
    orderType === "buy"
      ? amountValue
      : amountValue * (Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : marketPrice)
  const pointsUsdBasis = balanceHidden ? selectedHideTier.minUsdt : estimatedUsdValue
  const activeDiscountPercent = activeNftDiscount?.discount ?? 0
  const discountRate = activeDiscountPercent > 0 ? Math.min(activeDiscountPercent, 100) / 100 : 0
  const normalizedStakeMultiplier =
    Number.isFinite(stakePointsMultiplier) && stakePointsMultiplier > 0 ? stakePointsMultiplier : 1
  const nftPointsMultiplier = 1 + discountRate
  const hideUsdtTierBonus = balanceHidden ? selectedHideTier.bonusPercent : usdtTierBonusPercent(estimatedUsdValue)
  const hideUsdtTierMultiplier = 1 + hideUsdtTierBonus / 100
  const effectivePointsMultiplier =
    normalizedStakeMultiplier * nftPointsMultiplier * hideUsdtTierMultiplier
  const rawLimitFeeUsd = Math.max(0, estimatedUsdValue) * 0.002
  const limitFeeUsd = rawLimitFeeUsd * (1 - discountRate)
  const feeSavedUsd = Math.max(0, rawLimitFeeUsd - limitFeeUsd)
  const basePoints = Math.max(0, pointsUsdBasis) * 12
  const estimatedPoints =
    basePoints > 0 ? Math.floor(basePoints * effectivePointsMultiplier) : 0
  const isBtcBuyComingSoon = orderType === "buy" && selectedToken.symbol === "BTC"

  return (
    <>
      <section id="limit-order" className="py-12">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/20 border border-primary/30 mb-4">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary">Testnet Active</span>
            </div>
            <h2 className="text-3xl font-bold text-foreground mb-2">Limit Order</h2>
            <p className="text-muted-foreground">Set your price and execute trades automatically</p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Chart Section */}
            <div className="lg:col-span-2 p-6 rounded-2xl glass-strong border border-border">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="gap-2 bg-transparent">
                        <span className="text-xl">{selectedToken.icon}</span>
                        <span className="font-bold">{selectedToken.symbol}</span>
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="glass-strong border-border">
                      {tokens.map((token) => (
                        <DropdownMenuItem
                          key={token.symbol}
                          onClick={() => setSelectedToken(token)}
                          className="flex items-center gap-2"
                        >
                          <span className="text-lg">{token.icon}</span>
                          <div>
                            <p className="font-medium">{token.symbol}</p>
                            <p className="text-xs text-muted-foreground">{token.name}</p>
                          </div>
                          <span className="ml-auto">
                            {token.price > 0 ? `$${token.price.toLocaleString()}` : "—"}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  
                  <div>
                    <p className="text-2xl font-bold text-foreground">
                      {hasMarketPrice ? `$${selectedToken.price.toLocaleString()}` : "—"}
                    </p>
                    <p className={cn(
                      "text-sm flex items-center gap-1",
                      marketChangeValue === null
                        ? "text-muted-foreground"
                        : marketChangeValue >= 0
                        ? "text-success"
                        : "text-destructive"
                    )}>
                      {marketChangeValue === null ? (
                        "—"
                      ) : marketChangeValue >= 0 ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : (
                        <TrendingDown className="h-3 w-3" />
                      )}
                      {marketChangeValue === null ? "" : `${marketChangeValue >= 0 ? "+" : ""}${marketChangeValue.toFixed(2)}%`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex gap-2">
                    {["5M", "15M", "1H", "24H", "7D", "30D"].map((period) => (
                      <button
                        key={period}
                        onClick={() => setChartPeriod(period)}
                        className={cn(
                          "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                          chartPeriod === period
                            ? "bg-primary/20 text-primary"
                            : "text-muted-foreground hover:text-foreground hover:bg-surface"
                        )}
                      >
                        {period}
                      </button>
                    ))}
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon"
                    onClick={() => setChartModalOpen(true)}
                  >
                    <Expand className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Chart Visualization */}
              <div className="h-64 rounded-xl bg-surface/30 relative overflow-hidden">
                <CandlestickChart
                  candles={chartCandles}
                  viewBoxHeight={200}
                  gradientId="chartGradientLimit"
                  showPriceLine
                  currentPrice={currentPrice}
                  marketPrice={marketPrice}
                />
                <div className="absolute top-4 left-4 text-xs text-muted-foreground">
                  High: {chartHigh !== null ? `$${chartHigh.toLocaleString()}` : "—"}
                </div>
                <div className="absolute bottom-4 left-4 text-xs text-muted-foreground">
                  Low: {chartLow !== null ? `$${chartLow.toLocaleString()}` : "—"}
                </div>
                {currentPrice > 0 && (
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 bg-secondary/20 px-2 py-1 rounded text-xs text-secondary">
                    Target: ${currentPrice.toLocaleString()}
                  </div>
                )}
                {chartCandles.length <= 1 && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                    No price data
                  </div>
                )}
              </div>

              {/* Order Book Preview */}
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div className="p-3 rounded-lg bg-success/10 border border-success/20">
                  <p className="text-xs text-muted-foreground mb-2">Bids</p>
                  {bids.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No bids</p>
                  ) : (
                    <div className="space-y-1">
                      {bids.map((level, i) => (
                        <div key={`${level.price}-${i}`} className="flex justify-between text-xs">
                          <span className="text-success">${level.price.toLocaleString()}</span>
                          <span className="text-muted-foreground">{level.amount.toFixed(3)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <p className="text-xs text-muted-foreground mb-2">Asks</p>
                  {asks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No asks</p>
                  ) : (
                    <div className="space-y-1">
                      {asks.map((level, i) => (
                        <div key={`${level.price}-${i}`} className="flex justify-between text-xs">
                          <span className="text-destructive">${level.price.toLocaleString()}</span>
                          <span className="text-muted-foreground">{level.amount.toFixed(3)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 p-3 rounded-lg bg-surface/40 border border-border">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground">Active Orders</p>
                  <span className="text-xs text-muted-foreground">{orders.length}</span>
                </div>
                {orders.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No active orders</p>
                ) : (
                  <div className="space-y-1.5">
                    {orders.slice(0, 4).map((order) => (
                      <div
                        key={`mini-${order.id}`}
                        className="flex items-center justify-between text-xs gap-2"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-foreground">
                            {order.type === "buy" ? "BUY" : "SELL"} {order.amount} {order.token}
                          </span>
                          {order.requestSource === "ai" ? (
                            <span className="rounded px-1.5 py-0.5 text-[9px] font-medium bg-primary/20 text-primary">
                              AI
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            ${Number(order.price).toLocaleString()}
                          </span>
                          {order.status === "active" ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => cancelOrder(order.id)}
                              className="h-5 w-5 text-muted-foreground hover:text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Order Form */}
            <div className="p-6 rounded-2xl glass-strong border border-border">
              <Tabs value={orderType} onValueChange={(value) => setOrderType(value as "buy" | "sell")}>
                <TabsList className="grid w-full grid-cols-2 mb-6">
                  <TabsTrigger value="buy" className="data-[state=active]:bg-success/20 data-[state=active]:text-success">
                    Buy
                  </TabsTrigger>
                  <TabsTrigger value="sell" className="data-[state=active]:bg-destructive/20 data-[state=active]:text-destructive">
                    Sell
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="buy" className="space-y-4">
                  {/* Token Selection */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-2 block">Token</label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-transparent">
                          <div className="flex items-center gap-2">
                            <span>{selectedToken.icon}</span>
                            <span>{selectedToken.symbol}</span>
                          </div>
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="glass-strong border-border w-full">
                        {tokens.map((token: TokenItem) => (
                          <DropdownMenuItem
                            key={token.symbol}
                            onClick={() => setSelectedToken(token)}
                            className="flex items-center gap-2"
                          >
                            <span>{token.icon}</span>
                            <span>{token.symbol}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Buy Price */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-foreground">Buy Price</label>
                      <span className="text-xs text-muted-foreground">Market: ${marketPrice.toLocaleString()}</span>
                    </div>
                    <input
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <div className="flex gap-2 mt-2">
                      {pricePresets.map((preset: { label: string; value: number }) => (
                        <button
                          key={preset.label}
                          onClick={() => handlePricePreset(preset.value)}
                          className="flex-1 px-2 py-1 text-xs rounded-md bg-surface text-muted-foreground hover:text-foreground hover:bg-surface/80 transition-colors"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    {currentPrice > 0 && (
                      <p className={cn(
                        "text-xs mt-2",
                        (targetPriceChangeValue ?? 0) < 0
                          ? "text-success"
                          : "text-muted-foreground"
                      )}>
                        {(targetPriceChangeValue ?? 0) < 0
                          ? targetPriceChange
                          : `+${targetPriceChange}`}% dari market
                      </p>
                    )}
                  </div>

                  {/* Pay With */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-2 block">Pay with</label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-transparent">
                          <div className="flex items-center gap-2">
                            <span>{payToken.icon}</span>
                            <span>{payToken.symbol}</span>
                          </div>
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="glass-strong border-border">
                        {tokens
                          .filter((token: TokenItem) => token.symbol === "USDT" || token.symbol === "USDC")
                          .map((token: TokenItem) => (
                          <DropdownMenuItem
                            key={token.symbol}
                            onClick={() => setPayToken(token)}
                            className="flex items-center gap-2"
                          >
                            <span>{token.icon}</span>
                            <span>{token.symbol}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Amount */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-foreground">Amount</label>
                      <span className="text-xs text-muted-foreground">
                        Balance: {balanceHidden ? "••••••" : resolveAvailableBalance(payToken.symbol).toLocaleString()} {payToken.symbol}
                      </span>
                    </div>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <div className="flex gap-2 mt-2">
                      {[25, 50, 75, 100].map((percent) => (
                        <button
                          key={percent}
                          onClick={() => handleAmountPreset(percent)}
                          className="flex-1 px-2 py-1 text-xs rounded-md bg-surface text-muted-foreground hover:text-foreground hover:bg-surface/80 transition-colors"
                        >
                          {percent}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Expiry */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-2 block">Expiry</label>
                    <div className="grid grid-cols-3 gap-2">
                      {expiryOptions.map((option: { label: string; value: string }) => (
                        <button
                          key={option.value}
                          onClick={() => setExpiry(option.value)}
                          className={cn(
                            "px-3 py-2 text-xs font-medium rounded-lg transition-colors",
                            expiry === option.value
                              ? "bg-primary/20 text-primary border border-primary"
                              : "bg-surface text-muted-foreground border border-border hover:border-primary/50"
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Estimated Total */}
                  {currentPrice > 0 && Number.parseFloat(amount) > 0 && (
                    <div className="p-3 rounded-lg bg-surface/50 border border-border">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Estimated receive</span>
                        <span className="font-medium text-foreground">
                          {(Number.parseFloat(amount) / currentPrice).toFixed(6)} {selectedToken.symbol}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm mt-1">
                        <span className="text-muted-foreground">Total pay</span>
                        <span className="font-medium text-foreground">
                          {amount} {payToken.symbol}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Info */}
                  <div className="p-3 rounded-lg bg-secondary/10 border border-secondary/20">
                    <div className="flex items-start gap-2">
                      <Info className="h-4 w-4 text-secondary flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-foreground">
                        Order will execute automatically when market price reaches your target
                      </p>
                    </div>
                  </div>

                  {isBtcBuyComingSoon && (
                    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-400/30">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-300 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-foreground">
                          Buy BTC via Limit Order is still <span className="font-semibold">Coming Soon</span>.
                          Please use another token pair for now.
                        </p>
                      </div>
                    </div>
                  )}

                  {(estimatedUsdValue > 0 || activeDiscountPercent > 0) && (
                    <div className="space-y-2 p-3 rounded-lg bg-surface/50 border border-border">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Protocol Fee (0.20%)</span>
                        <span className="text-sm text-foreground">${limitFeeUsd.toFixed(2)}</span>
                      </div>
                      {activeDiscountPercent > 0 && (
                        <div className="flex items-center justify-between text-success">
                          <span className="text-sm flex items-center gap-1">
                            <Sparkles className="h-3 w-3" />
                            NFT Discount
                          </span>
                          <span className="text-sm">-{activeDiscountPercent}%</span>
                        </div>
                      )}
                      {feeSavedUsd > 0 && (
                        <div className="flex items-center justify-between text-success">
                          <span className="text-xs">Fee saved</span>
                          <span className="text-xs">-${feeSavedUsd.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between border-t border-border pt-2">
                        <span className="text-sm font-medium text-foreground flex items-center gap-2">
                          <Gift className="h-4 w-4 text-accent" />
                          Estimated Points
                        </span>
                        <span className="text-sm font-bold text-accent">
                          {estimatedPoints > 0 ? `+${estimatedPoints}` : "—"}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Points are awarded when the order is filled.
                        {balanceHidden && hideUsdtTierBonus > 0
                          ? ` Hide tier +${hideUsdtTierBonus.toFixed(0)}% aktif.`
                          : ""}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between rounded-lg border border-border bg-surface/40 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">Hide Balance</p>
                        <p className="text-[11px] text-muted-foreground">Add Garaga privacy proof in the same on-chain transaction.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setBalanceHidden((prev) => !prev)}
                        className={cn(
                          "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
                          balanceHidden
                            ? "border-primary/70 bg-primary/20 text-primary"
                            : "border-border bg-surface text-muted-foreground"
                        )}
                      >
                        {balanceHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {balanceHidden && (
                      <button
                        type="button"
                        onClick={() => setHideBalancePopupOpen(true)}
                        className="w-full rounded-lg border border-border bg-surface/30 px-3 py-2 text-left transition-colors hover:border-primary/50"
                      >
                        <p className="text-[11px] text-muted-foreground">{hideBalanceCompactSummary}</p>
                      </button>
                    )}
                  </div>

                  {/* Submit Button */}
                  <Button 
                    onClick={handleSubmitOrder}
                    disabled={isBtcBuyComingSoon || isAutoPrivacyProvisioning}
                    className="w-full py-6 bg-success hover:bg-success/90 text-success-foreground font-bold"
                  >
                    {isBtcBuyComingSoon ? "Coming Soon (BTC Buy)" : "Create Buy Order"}
                  </Button>
                </TabsContent>

                <TabsContent value="sell" className="space-y-4">
                  {/* Token Selection */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-2 block">Token</label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-transparent">
                          <div className="flex items-center gap-2">
                            <span>{selectedToken.icon}</span>
                            <span>{selectedToken.symbol}</span>
                          </div>
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="glass-strong border-border w-full">
                        {tokens.map((token) => (
                          <DropdownMenuItem
                            key={token.symbol}
                            onClick={() => setSelectedToken(token)}
                            className="flex items-center gap-2"
                          >
                            <span>{token.icon}</span>
                            <span>{token.symbol}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Sell Price */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-foreground">Sell Price</label>
                      <span className="text-xs text-muted-foreground">Market: ${marketPrice.toLocaleString()}</span>
                    </div>
                    <input
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <div className="flex gap-2 mt-2">
                      {sellPresets.map((preset: { label: string; value: number }) => (
                        <button
                          key={preset.label}
                          onClick={() => handlePricePreset(preset.value)}
                          className="flex-1 px-2 py-1 text-xs rounded-md bg-surface text-muted-foreground hover:text-foreground hover:bg-surface/80 transition-colors"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Receive In */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-2 block">Receive in</label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-transparent">
                          <div className="flex items-center gap-2">
                            <span>{receiveToken.icon}</span>
                            <span>{receiveToken.symbol}</span>
                          </div>
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="glass-strong border-border">
                        {tokens
                          .filter((token: TokenItem) => token.symbol === "USDT" || token.symbol === "USDC")
                          .map((token: TokenItem) => (
                          <DropdownMenuItem
                            key={token.symbol}
                            onClick={() => setReceiveToken(token)}
                            className="flex items-center gap-2"
                          >
                            <span>{token.icon}</span>
                            <span>{token.symbol}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Amount */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-foreground">Amount</label>
                      <span className="text-xs text-muted-foreground">
                        Balance: {balanceHidden ? "••••••" : resolveAvailableBalance(selectedToken.symbol).toLocaleString()} {selectedToken.symbol}
                      </span>
                    </div>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <div className="flex gap-2 mt-2">
                      {[25, 50, 75, 100].map((percent) => (
                        <button
                          key={percent}
                          onClick={() => handleAmountPreset(percent)}
                          className="flex-1 px-2 py-1 text-xs rounded-md bg-surface text-muted-foreground hover:text-foreground hover:bg-surface/80 transition-colors"
                        >
                          {percent}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Expiry */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-2 block">Expiry</label>
                    <div className="grid grid-cols-3 gap-2">
                      {expiryOptions.map((option: { label: string; value: string }) => (
                        <button
                          key={option.value}
                          onClick={() => setExpiry(option.value)}
                          className={cn(
                            "px-3 py-2 text-xs font-medium rounded-lg transition-colors",
                            expiry === option.value
                              ? "bg-primary/20 text-primary border border-primary"
                              : "bg-surface text-muted-foreground border border-border hover:border-primary/50"
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Estimated Total */}
                  {currentPrice > 0 && Number.parseFloat(amount) > 0 && (
                    <div className="p-3 rounded-lg bg-surface/50 border border-border">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Estimated receive</span>
                        <span className="font-medium text-foreground">
                          {(Number.parseFloat(amount) * currentPrice).toLocaleString()} {receiveToken.symbol}
                        </span>
                      </div>
                    </div>
                  )}

                  {(estimatedUsdValue > 0 || activeDiscountPercent > 0) && (
                    <div className="space-y-2 p-3 rounded-lg bg-surface/50 border border-border">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Protocol Fee (0.20%)</span>
                        <span className="text-sm text-foreground">${limitFeeUsd.toFixed(2)}</span>
                      </div>
                      {activeDiscountPercent > 0 && (
                        <div className="flex items-center justify-between text-success">
                          <span className="text-sm flex items-center gap-1">
                            <Sparkles className="h-3 w-3" />
                            NFT Discount
                          </span>
                          <span className="text-sm">-{activeDiscountPercent}%</span>
                        </div>
                      )}
                      {feeSavedUsd > 0 && (
                        <div className="flex items-center justify-between text-success">
                          <span className="text-xs">Fee saved</span>
                          <span className="text-xs">-${feeSavedUsd.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between border-t border-border pt-2">
                        <span className="text-sm font-medium text-foreground flex items-center gap-2">
                          <Gift className="h-4 w-4 text-accent" />
                          Estimated Points
                        </span>
                        <span className="text-sm font-bold text-accent">
                          {estimatedPoints > 0 ? `+${estimatedPoints}` : "—"}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Points are awarded when the order is filled.
                        {balanceHidden && hideUsdtTierBonus > 0
                          ? ` Hide tier +${hideUsdtTierBonus.toFixed(0)}% aktif.`
                          : ""}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between rounded-lg border border-border bg-surface/40 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">Hide Balance</p>
                        <p className="text-[11px] text-muted-foreground">Add Garaga privacy proof in the same on-chain transaction.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setBalanceHidden((prev) => !prev)}
                        className={cn(
                          "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
                          balanceHidden
                            ? "border-primary/70 bg-primary/20 text-primary"
                            : "border-border bg-surface text-muted-foreground"
                        )}
                      >
                        {balanceHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {balanceHidden && (
                      <button
                        type="button"
                        onClick={() => setHideBalancePopupOpen(true)}
                        className="w-full rounded-lg border border-border bg-surface/30 px-3 py-2 text-left transition-colors hover:border-primary/50"
                      >
                        <p className="text-[11px] text-muted-foreground">{hideBalanceCompactSummary}</p>
                      </button>
                    )}
                  </div>

                  {/* Submit Button */}
                  <Button 
                    onClick={handleSubmitOrder}
                    disabled={isAutoPrivacyProvisioning}
                    className="w-full py-6 bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold"
                  >
                    Create Sell Order
                  </Button>
                </TabsContent>
              </Tabs>
            </div>
          </div>

        </div>
      </section>

      <HideBalanceLimitDialog
        open={hideBalancePopupOpen}
        onOpenChange={setHideBalancePopupOpen}
        usdtTierOptions={USDT_POINTS_TIER_OPTIONS}
        selectedHideTier={selectedHideTier}
        onSelectTier={setHideUsdtTierMin}
        hideTierLockedAmount={hideTierLockedAmount}
        fromTokenSymbol={fromTokenForOrder}
        hasTradePrivacyPayload={hasTradePrivacyPayload}
        isAutoPrivacyProvisioning={isAutoPrivacyProvisioning}
        pendingHideNotes={pendingHideNotesActive}
        pendingNoteActionCommitment={pendingNoteActionCommitment}
        isSubmitting={isSubmitting}
        onUsePendingHideNote={(note) => void handleUsePendingHideNote(note, confirmOrder)}
        onWithdrawPendingHideNote={(note) => void handleWithdrawPendingHideNote(note)}
      />

      {/* Full Chart Modal */}
      <ChartFullscreenModal
        open={chartModalOpen}
        onOpenChange={setChartModalOpen}
        tokenIcon={selectedToken.icon}
        tokenSymbol={selectedToken.symbol}
        chartCandles={chartCandles}
        chartPeriod={chartPeriod}
        onChartPeriodChange={setChartPeriod}
      />

      {/* Confirm Order Dialog */}
      <ConfirmOrderDialog
        open={showConfirmDialog}
        onOpenChange={setShowConfirmDialog}
        submitSuccess={submitSuccess}
        orderType={orderType}
        tokenSymbol={selectedToken.symbol}
        targetPrice={currentPrice}
        amount={amount}
        amountTokenSymbol={orderType === "buy" ? payToken.symbol : selectedToken.symbol}
        expiryLabel={
          expiryOptions.find((option: { label: string; value: string }) => option.value === expiry)
            ?.label
        }
        balanceHidden={balanceHidden}
        selectedHideTier={selectedHideTier}
        isSubmitting={isSubmitting}
        onConfirm={() => void confirmOrder()}
      />
    </>
  )
}
