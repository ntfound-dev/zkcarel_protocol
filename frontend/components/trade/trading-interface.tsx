"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/providers/theme-provider"
import { useNotifications } from "@/hooks/notifications/use-notifications"
import { useWallet } from "@/hooks/wallet/use-wallet"
import { useLivePrices } from "@/hooks/price/use-live-prices"
import { usePageVisibility } from "@/hooks/system/use-page-visibility"
import { useGaragaPrivacyPayload } from "@/hooks/trade/use-garaga-privacy-payload"
import { useGardenBridgePolling } from "@/hooks/trade/use-garden-bridge-polling"
import { useTradeQuote } from "@/hooks/trade/use-trade-quote"
import { useTradeExecution } from "@/hooks/trade/use-trade-execution"
import { useTokenCatalog } from "@/hooks/trade/use-token-catalog"
import { useOnchainActions } from "@/hooks/trade/use-onchain-actions"
import { useHideActions } from "@/hooks/trade/use-hide-actions"
import { useBtcActions } from "@/hooks/trade/use-btc-actions"
import { BridgeStatusDialog } from "@/components/trade/bridge-status-dialog"
import { HideBalanceDialog } from "@/components/trade/hide-balance-dialog"
import { TradeResultDialog } from "@/components/trade/trade-result-dialog"
import { TradeSettingsDialog } from "@/components/trade/trade-settings-dialog"
import {
  autoSubmitPrivacyAction,
  executeBridge,
  executeSwap,
  getGardenOrderById,
  getOwnedNfts,
  getPortfolioBalance,
  getRewardsPoints,
  getSwapQuote,
  type NFTItem,
  type PrivacyVerificationPayload,
} from "@/lib/api"
import type {
  BridgeRewardsSnapshot,
  PendingBtcDepositState,
  PendingHideNoteRecord,
  QuoteState,
  TokenWithBalance,
  TradeResultPopupState,
} from "@/lib/trading-types"
import {
  invokeStarknetCallsFromWallet,
  readStarknetShieldedPoolFixedAmountFromWallet,
  getConnectedEvmAddressFromWallet,
  sendEvmTransactionFromWallet,
  type StarknetInvokeCall,
} from "@/lib/onchain-trade"
import { executeHideViaRelayer } from "@/lib/privacy-relayer"
import {
  BRIDGE_TO_STRK_DISABLED_MESSAGE,
  BTC_TESTNET_EXPLORER_BASE_URL,
  BTC_VAULT_ADDRESS,
  CAREL_PROTOCOL_ADDRESS,
  DEV_AUTO_GARAGA_PAYLOAD_ENABLED,
  FINALIZED_GARDEN_ORDER_STATUSES,
  HIDE_BALANCE_FALLBACK_TO_PUBLIC_ENABLED,
  HIDE_BALANCE_NOTE_VERSION,
  HIDE_BALANCE_PRIVATE_SWAP_BLOCK_REASON,
  HIDE_BALANCE_RELAYER_POOL_ENABLED,
  HIDE_BALANCE_SHIELDED_POOL,
  MEV_FEE_RATE,
  PRIVATE_ACTION_EXECUTOR_ADDRESS,
  STARKNET_STRK_GAS_RESERVE,
  STARKNET_SWAP_CONTRACT_ADDRESS,
  TRADE_PRIVACY_PENDING_NOTES_UPDATED_EVENT,
  UNSUPPORTED_BRIDGE_PAIR_MESSAGE,
  buildGardenOrderExplorerLinks,
  buildGardenOrderExplorerUrl,
  chainFromNetwork,
  clearTradePrivacyPayload,
  computeMinimumAmountOut,
  computeTradeDeadlineSeconds,
  createDevTradePrivacyPayload,
  formatBtcFromSats,
  formatMultiplier,
  formatRemainingDuration,
  formatTokenAmount,
  hasCompleteHideSpendPayload,
  estimatedBridgeTimeByProvider,
  inferHideDenomIdFromUsd,
  inferHideRootFromPublicInputs,
  isBridgePairSupportedForCurrentRoutes,
  isBridgeToStrkDisabledRoute,
  isSameFeltAddress,
  isStarknetEntrypointMissingError,
  isHidePayload,
  loadBridgeRewardsSnapshot,
  loadPendingBtcDeposit,
  loadPendingBtcDeposits,
  loadPendingHideNotes,
  loadTradePrivacyPayload,
  limitBridgeApprovalToExactAmount,
  normalizeExecutorAddress,
  normalizeGardenStarknetEntrypoint,
  normalizeHexArray,
  parseGardenOrderProgress,
  persistBridgeRewardsSnapshot,
  persistPendingBtcDeposit,
  persistPendingBtcDeposits,
  persistTradePrivacyPayload,
  pickActivePendingBtcDeposit,
  removePendingHideNote,
  resolveTokenAddress,
  resolveTokenDecimals,
  resolveTradeSlippage,
  sanitizeDecimalInput,
  unwrapGardenOrderPayload,
  upsertPendingBtcDepositList,
  usdtTierBonusPercent,
} from "@/lib/trading-utils"
import { tradeTokenCatalog as tokenCatalog } from "@/lib/token-config"
import { TradeErrorBoundary } from "@/components/trade/trade-error-boundary"
import { Countdown } from "@/components/trade/trade-countdown"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { 
  ArrowDownUp, ChevronDown, Clock, Zap, Settings2, Check, Loader2, X, 
  Eye, EyeOff, Info, Gift, Sparkles
} from "lucide-react"

const TradePreviewDialog = dynamic(
  () =>
    import("@/components/trade/trade-preview-dialog").then((mod) => mod.TradePreviewDialog),
  { ssr: false }
)

const slippagePresets = ["0.1", "0.3", "0.5", "1.0"]
const USDT_POINTS_TIER_OPTIONS = [
  { minUsdt: 5, bonusPercent: 5 },
  { minUsdt: 10, bonusPercent: 10 },
  { minUsdt: 50, bonusPercent: 20 },
  { minUsdt: 100, bonusPercent: 30 },
  { minUsdt: 250, bonusPercent: 50 },
] as const
interface TokenSelectorProps {
  selectedToken: TokenWithBalance
  onSelect: (token: TokenWithBalance) => void
  tokens: TokenWithBalance[]
  label: string
  amount: string
  onAmountChange: (value: string) => void
  readOnly?: boolean
  hideBalance?: boolean
  maxTradeBalance?: number
}

/**
 * Handles `TokenSelector` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function TokenSelector({
  selectedToken,
  onSelect,
  tokens,
  label,
  amount,
  onAmountChange,
  readOnly,
  hideBalance,
  maxTradeBalance,
}: TokenSelectorProps) {
  const hasPrice = selectedToken.price > 0
  const usdValue = Number.parseFloat(amount || "0") * selectedToken.price
  const tokenDecimals = resolveTokenDecimals(selectedToken.symbol)
  const availableBalanceForTrade =
    typeof maxTradeBalance === "number" && Number.isFinite(maxTradeBalance)
      ? Math.max(0, Math.min(maxTradeBalance, selectedToken.balance))
      : selectedToken.balance
  
  return (
    <div className="p-3 sm:p-4 rounded-xl glass border border-border hover:border-primary/50 transition-all duration-300">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">
          Balance: {hideBalance ? "••••••" : `${selectedToken.balance.toLocaleString()} ${selectedToken.symbol}`}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="outline" 
              className="gap-2 border-primary/30 hover:border-primary/60 bg-surface/50 text-foreground"
            >
              <span className="text-xl">{selectedToken.icon}</span>
              <div className="text-left">
                <span className="font-bold block">{selectedToken.symbol}</span>
                <span className="text-[10px] text-muted-foreground">{selectedToken.network}</span>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-52 sm:w-56 glass-strong border-border">
            {tokens.map((token) => (
              <DropdownMenuItem
                key={token.symbol}
                onClick={() => onSelect(token)}
                className={cn(
                  "flex items-center gap-3 cursor-pointer",
                  token.symbol === selectedToken.symbol && "bg-primary/20"
                )}
              >
                <span className="text-lg">{token.icon}</span>
                <div className="flex flex-col flex-1">
                  <span className="font-medium text-foreground">{token.symbol}</span>
                  <span className="text-xs text-muted-foreground">{token.name} ({token.network})</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {hideBalance ? "••••" : token.balance.toLocaleString()}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex-1 text-right">
          <div
            className={cn(
              "rounded-lg border border-border bg-surface/40 px-3 py-2 transition-colors",
              !readOnly && "focus-within:border-primary/70"
            )}
          >
            <input
              type="text"
              value={amount}
              inputMode={readOnly ? undefined : "decimal"}
              autoComplete="off"
              spellCheck={false}
              aria-label={`${label} amount`}
              onChange={(e) => {
                if (readOnly) return
                onAmountChange(sanitizeDecimalInput(e.target.value, tokenDecimals))
              }}
              readOnly={readOnly}
              placeholder="0.0"
              className={cn(
                "w-full bg-transparent text-right text-xl sm:text-2xl font-bold text-foreground outline-none placeholder:text-muted-foreground/50",
                readOnly && "cursor-default"
              )}
            />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            ≈ {hasPrice
              ? `$${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : "—"}
          </p>
        </div>
      </div>
      {!readOnly && (
        <div className="grid grid-cols-4 gap-1.5 sm:gap-2 mt-3">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              onClick={() =>
                onAmountChange(
                  sanitizeDecimalInput(String((availableBalanceForTrade * pct) / 100), tokenDecimals)
                )
              }
              className="flex-1 py-1 text-xs font-medium text-muted-foreground hover:text-primary border border-border hover:border-primary/50 rounded-md transition-colors"
            >
              {pct === 100 ? "MAX" : `${pct}%`}
            </button>
          ))}
        </div>
      )}
      </div>
  )
}

/**
 * Handles `SimpleRouteVisualization` logic.
 *
 * @param fromToken - Input used by `SimpleRouteVisualization` to compute state, payload, or request behavior.
 * @param toToken - Input used by `SimpleRouteVisualization` to compute state, payload, or request behavior.
 * @param isCrossChain - Input used by `SimpleRouteVisualization` to compute state, payload, or request behavior.
 * @param toToken - Input used by `SimpleRouteVisualization` to compute state, payload, or request behavior.
 * @param isCrossChain - Input used by `SimpleRouteVisualization` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function SimpleRouteVisualization({ fromToken, toToken, isCrossChain }: { fromToken: TokenWithBalance, toToken: TokenWithBalance, isCrossChain: boolean }) {
  return (
    <div className="flex items-center justify-center gap-2 py-3 text-sm">
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/30">
        <span>{fromToken.icon}</span>
        <span className="font-medium text-foreground">{fromToken.symbol}</span>
        <span className="text-[10px] text-muted-foreground">({fromToken.network})</span>
      </div>
      <div className="flex items-center gap-1 text-muted-foreground">
        <span className="text-xs">{isCrossChain ? "Bridge" : "Swap"}</span>
        <span>→</span>
      </div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/10 border border-secondary/30">
        <span>{toToken.icon}</span>
        <span className="font-medium text-foreground">{toToken.symbol}</span>
        <span className="text-[10px] text-muted-foreground">({toToken.network})</span>
      </div>
    </div>
  )
}

/**
 * Handles `defaultReceiveAddressForNetwork` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function defaultReceiveAddressForNetwork(
  networkLabel: string,
  addresses: {
    starknet?: string | null
    evm?: string | null
    btc?: string | null
    fallback?: string | null
  }
) {
  const chain = chainFromNetwork(networkLabel)
  if (chain === "bitcoin") return addresses.btc || ""
  if (chain === "ethereum") return addresses.evm || addresses.fallback || ""
  return addresses.starknet || addresses.fallback || ""
}

function buildHideAssetRuleMissingMessage(tokenSymbol: string, tierUsdt: number): string {
  const symbol = (tokenSymbol || "").trim().toUpperCase() || "TOKEN"
  const tier =
    Number.isFinite(tierUsdt) && tierUsdt > 0
      ? Math.trunc(tierUsdt)
      : 0
  if (tier > 0) {
    return `Hide Balance asset rule belum di-set untuk ${symbol} (tier $${tier}). Minta admin menjalankan set_asset_rule pada executor aktif, lalu retry swap.`
  }
  return `Hide Balance asset rule belum di-set untuk ${symbol}. Minta admin menjalankan set_asset_rule pada executor aktif, lalu retry swap.`
}

/**
 * Handles `TradingInterface` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function TradingInterface() {
  const { mode } = useTheme()
  const wallet = useWallet()
  const notifications = useNotifications()
  const isPageVisible = usePageVisibility()
  const [seedPrices, setSeedPrices] = React.useState<Record<string, number>>({})
  const { prices: livePrices, sources: priceSources, status: priceStatus } = useLivePrices(
    React.useMemo(() => tokenCatalog.map((token) => token.symbol), []),
    {
      seedPrices,
      fallbackPrices: { CAREL: 1, USDC: 1, USDT: 1 },
    }
  )
  const { tokens, resolveTokenPrice } = useTokenCatalog({
    tokenCatalog,
    livePrices,
    wallet,
  })

  const [fromTokenSymbol, setFromTokenSymbol] = React.useState("STRK")
  const [toTokenSymbol, setToTokenSymbol] = React.useState("WBTC")
  const fromToken = React.useMemo(() => {
    return (
      tokens.find((token) => token.symbol === fromTokenSymbol) ||
      tokens.find((token) => token.symbol === "STRK") ||
      tokens[0]
    )
  }, [fromTokenSymbol, tokens])
  const toToken = React.useMemo(() => {
    return (
      tokens.find((token) => token.symbol === toTokenSymbol) ||
      tokens.find((token) => token.symbol === "WBTC") ||
      tokens[1] ||
      tokens[0]
    )
  }, [toTokenSymbol, tokens])
  const [fromAmount, setFromAmount] = React.useState("1.0")
  const [toAmount, setToAmount] = React.useState("")
  const [swapState, setSwapState] = React.useState<"idle" | "confirming" | "processing" | "success" | "error">("idle")
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [quote, setQuote] = React.useState<QuoteState | null>(null)
  const [isQuoteLoading, setIsQuoteLoading] = React.useState(false)
  const [quoteError, setQuoteError] = React.useState<string | null>(null)
  const [liquidityMaxFromQuote, setLiquidityMaxFromQuote] = React.useState<number | null>(null)
  const [activeNft, setActiveNft] = React.useState<NFTItem | null>(null)
  const [stakePointsMultiplier, setStakePointsMultiplier] = React.useState(1)
  
  // Unified privacy toggle: UI masking and on-chain hide-balance flow.
  const [balanceHidden, setBalanceHidden] = React.useState(false)
  const [hasTradePrivacyPayload, setHasTradePrivacyPayload] = React.useState(false)
  const [pendingHideNotes, setPendingHideNotes] = React.useState<PendingHideNoteRecord[]>([])
  const [isAutoPrivacyProvisioning, setIsAutoPrivacyProvisioning] = React.useState(false)
  const [isCancellingHideNote, setIsCancellingHideNote] = React.useState(false)
  const [countdownTick, setCountdownTick] = React.useState(0)
  const [hideUsdtTierMin, setHideUsdtTierMin] = React.useState<number>(5)
  const autoPrivacyPayloadPromiseRef = React.useRef<Promise<PrivacyVerificationPayload | undefined> | null>(null)
  const manuallySelectedHideNoteRef = React.useRef<{
    commitment: string
    nullifier: string
  } | null>(null)
  // Hide Balance (Garaga) is only enabled for Starknet <-> Starknet swap flow.
  const hideBalanceSupportedForCurrentPair =
    chainFromNetwork(fromToken.network) === "starknet" &&
    chainFromNetwork(toToken.network) === "starknet"
  const hideBalanceOnchain = hideBalanceSupportedForCurrentPair && balanceHidden
  const hideUsdtTierLockEnabled = hideBalanceOnchain && HIDE_BALANCE_SHIELDED_POOL
  const selectedHideUsdtTier = React.useMemo(
    () =>
      USDT_POINTS_TIER_OPTIONS.find((option) => option.minUsdt === hideUsdtTierMin) ||
      USDT_POINTS_TIER_OPTIONS[1],
    [hideUsdtTierMin]
  )
  const inferredHideDenomId = React.useMemo(
    () => inferHideDenomIdFromUsd(selectedHideUsdtTier.minUsdt),
    [selectedHideUsdtTier.minUsdt]
  )
  
  // Settings state
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [hidePanelOpen, setHidePanelOpen] = React.useState(false)
  const [mevProtectionEnabled, setMevProtectionEnabled] = React.useState(false)
  const mevProtection = mode === "private" && mevProtectionEnabled
  const [slippage, setSlippage] = React.useState("0.5")
  const [customSlippage, setCustomSlippage] = React.useState("")
  const [receiveAddress, setReceiveAddress] = React.useState("")
  const [isReceiveAddressManual, setIsReceiveAddressManual] = React.useState(false)
  const [xverseUserId, setXverseUserId] = React.useState("")
  const [btcVaultCopied, setBtcVaultCopied] = React.useState(false)
  const [pendingBtcDeposit, setPendingBtcDeposit] = React.useState<PendingBtcDepositState | null>(null)
  const [pendingBtcDeposits, setPendingBtcDeposits] = React.useState<PendingBtcDepositState[]>([])
  const [bridgeStatusPopupOpen, setBridgeStatusPopupOpen] = React.useState(false)
  const [lastBridgeRewards, setLastBridgeRewards] = React.useState<BridgeRewardsSnapshot | null>(null)
  const [isSendingBtcDeposit, setIsSendingBtcDeposit] = React.useState(false)
  const [isClaimingRefund, setIsClaimingRefund] = React.useState(false)
  const [activePendingHideNoteSwapKey, setActivePendingHideNoteSwapKey] = React.useState<string | null>(null)
  const [tradeResultPopup, setTradeResultPopup] = React.useState<TradeResultPopupState | null>(null)
  const [hideAssetRuleStatus, setHideAssetRuleStatus] = React.useState<
    "idle" | "checking" | "ok" | "missing" | "unavailable"
  >("idle")
  const manualSelectedHideNoteRetryRef = React.useRef(0)
  const confirmTradeRef = React.useRef<() => void>(() => {})
  const refreshTradePrivacyPayload = React.useCallback(() => {
    setHasTradePrivacyPayload(Boolean(loadTradePrivacyPayload()))
  }, [])
  const refreshPendingHideNotes = React.useCallback(() => {
    setPendingHideNotes(loadPendingHideNotes())
  }, [])
  const clearManuallySelectedHideNote = React.useCallback(() => {
    manuallySelectedHideNoteRef.current = null
  }, [])
  const openTradeResultPopup = React.useCallback(
    (payload: TradeResultPopupState) => {
      setTradeResultPopup(payload)
    },
    []
  )
  const markManuallySelectedHideNote = React.useCallback(
    (noteCommitment?: string, noteNullifier?: string) => {
      const normalizedCommitment = (noteCommitment || "").trim().toLowerCase()
      const normalizedNullifier = (noteNullifier || "").trim().toLowerCase()
      if (!normalizedCommitment && !normalizedNullifier) {
        manuallySelectedHideNoteRef.current = null
        return
      }
      manuallySelectedHideNoteRef.current = {
        commitment: normalizedCommitment,
        nullifier: normalizedNullifier,
      }
    },
    []
  )
  const isManuallySelectedHideNote = React.useCallback(
    (noteCommitment?: string, noteNullifier?: string) => {
      const activeSelection = manuallySelectedHideNoteRef.current
      if (!activeSelection) return false
      const normalizedCommitment = (noteCommitment || "").trim().toLowerCase()
      const normalizedNullifier = (noteNullifier || "").trim().toLowerCase()
      const sameCommitment =
        !!activeSelection.commitment &&
        !!normalizedCommitment &&
        activeSelection.commitment === normalizedCommitment
      const sameNullifier =
        !!activeSelection.nullifier &&
        !!normalizedNullifier &&
        activeSelection.nullifier === normalizedNullifier
      return sameCommitment || sameNullifier
    },
    []
  )
  const swapActionCall = React.useMemo<StarknetInvokeCall | undefined>(() => {
    if (!quote?.onchainCalls || quote.onchainCalls.length === 0) return undefined
    const call = quote.onchainCalls.find((item) => item.entrypoint === "execute_swap")
    if (!call) return undefined
    return {
      contractAddress: call.contractAddress,
      entrypoint: call.entrypoint,
      calldata: call.calldata,
    }
  }, [quote?.onchainCalls])
  const resolveHideBalancePrivacyPayload = useGaragaPrivacyPayload({
    fromAmount,
    fromToken,
    toToken,
    inferredHideDenomId,
    actionCall: swapActionCall,
    notifications,
    receiveAddress,
    wallet,
    autoPrivacyPayloadPromiseRef,
    manuallySelectedHideNoteRef,
    setHasTradePrivacyPayload,
    setIsAutoPrivacyProvisioning,
    helpers: {
      loadTradePrivacyPayload,
      loadPendingHideNotes,
      isHidePayload,
      hasCompleteHideSpendPayload,
      inferHideRootFromPublicInputs,
      normalizeHexArray,
      resolveTokenDecimals,
      persistTradePrivacyPayload,
      createDevTradePrivacyPayload,
      autoSubmitPrivacyAction,
      chainFromNetwork,
    },
    flags: {
      DEV_AUTO_GARAGA_PAYLOAD_ENABLED,
      HIDE_BALANCE_NOTE_VERSION,
    },
  })

  /**
   * Parses or transforms values for `formatSource`.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const formatSource = (source?: string) => {
    switch (source) {
      case "ws":
        return { label: "Live", className: "bg-success/20 text-success", visible: true }
      case "coingecko":
        return { label: "CoinGecko", className: "bg-primary/20 text-primary", visible: false }
      default:
        return { label: "", className: "", visible: false }
    }
  }

  const fromSource = formatSource(priceSources[fromToken.symbol])
  const toSource = formatSource(priceSources[toToken.symbol])
  
  const discountPercent = activeNft ? activeNft.discount : 0
  const hasNftDiscount = Boolean(activeNft)

  // Detect cross-chain by normalized chain id (not raw label text).
  const sourceChain = chainFromNetwork(fromToken.network)
  const targetChain = chainFromNetwork(toToken.network)
  const isCrossChain = sourceChain !== targetChain
  const fromSymbol = fromToken.symbol
  const toSymbol = toToken.symbol
  const fromNetwork = fromToken.network
  const toNetwork = toToken.network
  const fromPrice = fromToken.price
  const toPrice = toToken.price
  const fromChain = sourceChain
  const toChain = targetChain
  const bridgeToStrkDisabled =
    isCrossChain && isBridgeToStrkDisabledRoute(fromChain, toChain, toSymbol)
  const bridgePairSupported =
    !isCrossChain ||
    isBridgePairSupportedForCurrentRoutes(fromChain, toChain, fromSymbol, toSymbol)
  const btcVaultExplorerUrl = React.useMemo(() => {
    if (!BTC_VAULT_ADDRESS) return ""
    const base = BTC_TESTNET_EXPLORER_BASE_URL.replace(/\/$/, "")
    return `${base}/address/${encodeURIComponent(BTC_VAULT_ADDRESS)}`
  }, [])
  const btcDepositExplorerUrl = React.useMemo(() => {
    if (!pendingBtcDeposit?.depositAddress) return ""
    const base = BTC_TESTNET_EXPLORER_BASE_URL.replace(/\/$/, "")
    return `${base}/address/${encodeURIComponent(pendingBtcDeposit.depositAddress)}`
  }, [pendingBtcDeposit?.depositAddress])
  const pendingGardenOrderExplorerUrl = React.useMemo(() => {
    if (!pendingBtcDeposit?.bridgeId) return ""
    return buildGardenOrderExplorerUrl(pendingBtcDeposit.bridgeId)
  }, [pendingBtcDeposit?.bridgeId])
  const trackedPendingBtcOrders = React.useMemo(() => {
    const base = [...pendingBtcDeposits]
    if (pendingBtcDeposit) {
      return upsertPendingBtcDepositList(base, pendingBtcDeposit)
    }
    return base.slice(0, 20)
  }, [pendingBtcDeposit, pendingBtcDeposits])
  const removeTrackedPendingBtcOrder = React.useCallback((bridgeId: string) => {
    const normalized = (bridgeId || "").trim().toLowerCase()
    if (!normalized) return
    setPendingBtcDeposits((prev) => {
      const next = prev.filter((item) => item.bridgeId.trim().toLowerCase() !== normalized)
      persistPendingBtcDeposits(next)
      setPendingBtcDeposit((current) => {
        if (current && current.bridgeId.trim().toLowerCase() === normalized) {
          return pickActivePendingBtcDeposit(next)
        }
        return current
      })
      return next
    })
  }, [])

  const { pollGardenBridgeOrder, lastGardenOrderStatusRef } = useGardenBridgePolling({
    isPageVisible,
    pendingBtcDeposit,
    trackedPendingBtcOrders,
    notifications,
    openTradeResultPopup,
    wallet,
    setPendingBtcDeposit,
    setPendingBtcDeposits,
    setActiveNft,
    setStakePointsMultiplier,
    helpers: {
      buildGardenOrderExplorerLinks,
      getGardenOrderById,
      unwrapGardenOrderPayload,
      parseGardenOrderProgress,
      upsertPendingBtcDepositList,
      getOwnedNfts,
      getRewardsPoints,
    },
    finalizedStatuses: FINALIZED_GARDEN_ORDER_STATUSES,
  })

  const preferredReceiveAddress = React.useMemo(
    () =>
      defaultReceiveAddressForNetwork(toToken.network, {
        starknet: wallet.starknetAddress,
        evm: wallet.evmAddress,
        btc: wallet.btcAddress,
        fallback: wallet.address,
      }),
    [toToken.network, wallet.address, wallet.starknetAddress, wallet.evmAddress, wallet.btcAddress]
  )

  React.useEffect(() => {
    setIsReceiveAddressManual(false)
  }, [toToken.network])

  React.useEffect(() => {
    if (isReceiveAddressManual) return
    setReceiveAddress(preferredReceiveAddress)
  }, [preferredReceiveAddress, isReceiveAddressManual])

  React.useEffect(() => {
    if (hideBalanceSupportedForCurrentPair || !balanceHidden) return
    setBalanceHidden(false)
    clearTradePrivacyPayload()
    setHasTradePrivacyPayload(false)
    clearManuallySelectedHideNote()
  }, [hideBalanceSupportedForCurrentPair, balanceHidden, clearManuallySelectedHideNote])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const stored = window.sessionStorage.getItem("xverse_user_id") || ""
    if (stored) {
      setXverseUserId(stored)
    }
  }, [])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    if (xverseUserId) {
      window.sessionStorage.setItem("xverse_user_id", xverseUserId)
    }
  }, [xverseUserId])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const single = loadPendingBtcDeposit()
    const list = loadPendingBtcDeposits()
    const nextList = single ? upsertPendingBtcDepositList(list, single) : list
    setPendingBtcDeposits(nextList)
    setPendingBtcDeposit(single || pickActivePendingBtcDeposit(nextList))
    setLastBridgeRewards(loadBridgeRewardsSnapshot())
  }, [])

  React.useEffect(() => {
    persistPendingBtcDeposit(pendingBtcDeposit)
    if (!pendingBtcDeposit) return
    setPendingBtcDeposits((prev) => {
      const next = upsertPendingBtcDepositList(prev, pendingBtcDeposit)
      persistPendingBtcDeposits(next)
      return next
    })
  }, [pendingBtcDeposit])

  React.useEffect(() => {
    persistPendingBtcDeposits(pendingBtcDeposits)
  }, [pendingBtcDeposits])

  React.useEffect(() => {
    if (pendingBtcDeposit) return
    const activeOrder = pickActivePendingBtcDeposit(pendingBtcDeposits)
    if (activeOrder) {
      setPendingBtcDeposit(activeOrder)
      return
    }
    setBridgeStatusPopupOpen(false)
  }, [pendingBtcDeposit, pendingBtcDeposits])

  React.useEffect(() => {
    persistBridgeRewardsSnapshot(lastBridgeRewards)
  }, [lastBridgeRewards])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    /**
     * Handles `syncPayload` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const syncPayload = () => {
      refreshTradePrivacyPayload()
      refreshPendingHideNotes()
    }
    syncPayload()
    window.addEventListener("focus", syncPayload)
    window.addEventListener("trade-privacy-payload-updated", syncPayload)
    window.addEventListener(TRADE_PRIVACY_PENDING_NOTES_UPDATED_EVENT, syncPayload)
    window.addEventListener("storage", syncPayload)
    return () => {
      window.removeEventListener("focus", syncPayload)
      window.removeEventListener("trade-privacy-payload-updated", syncPayload)
      window.removeEventListener(TRADE_PRIVACY_PENDING_NOTES_UPDATED_EVENT, syncPayload)
      window.removeEventListener("storage", syncPayload)
    }
  }, [refreshPendingHideNotes, refreshTradePrivacyPayload])

  React.useEffect(() => {
    let active = true
    if (!wallet.isConnected) return
    ;(async () => {
      try {
        const response = await getPortfolioBalance()
        if (!active) return
        const updated: Record<string, number> = {}
        response.balances.forEach((item) => {
          const valueUsd = Number(item.value_usd || 0)
          const price = item.amount > 0 ? valueUsd / item.amount : item.price
          updated[item.token.toUpperCase()] = price
        })
        setSeedPrices(updated)
      } catch {
        // keep existing prices
      }
    })()

    return () => {
      active = false
    }
  }, [wallet.isConnected])

  React.useEffect(() => {
    if (wallet.isConnected) return
    setSeedPrices({})
  }, [wallet.isConnected])

  React.useEffect(() => {
    let active = true
    if (!wallet.isConnected) {
      setActiveNft(null)
      return
    }
    ;(async () => {
      try {
        const nfts = await getOwnedNfts()
        if (!active) return
        const now = Math.floor(Date.now() / 1000)
        const usable = nfts.find((nft) => !nft.used && (!nft.expiry || nft.expiry > now))
        setActiveNft((prev) => {
          if (usable) return usable
          if (prev && !prev.used && (!prev.expiry || prev.expiry > now)) return prev
          return null
        })
      } catch {
        if (!active) return
        const now = Math.floor(Date.now() / 1000)
        setActiveNft((prev) => {
          if (prev && !prev.used && (!prev.expiry || prev.expiry > now)) return prev
          return null
        })
      }
    })()

    return () => {
      active = false
    }
  }, [wallet.isConnected])

  React.useEffect(() => {
    let active = true
    if (!wallet.isConnected) {
      setStakePointsMultiplier(1)
      return
    }
    if (!isPageVisible) return

    /**
     * Handles `loadMultiplier` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const loadMultiplier = async (force = false) => {
      try {
        const rewards = await getRewardsPoints({ force })
        if (!active) return
        const parsed = Number(rewards.multiplier)
        setStakePointsMultiplier(Number.isFinite(parsed) && parsed > 0 ? parsed : 1)
      } catch {
        if (!active) return
        setStakePointsMultiplier(1)
      }
    }

    void loadMultiplier()
    const timer = window.setInterval(() => {
      void loadMultiplier(true)
    }, 20_000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [
    isPageVisible,
    wallet.isConnected,
    wallet.address,
    wallet.starknetAddress,
    wallet.evmAddress,
    wallet.btcAddress,
  ])

  useTradeQuote({
    fromAmount,
    fromSymbol,
    toSymbol,
    fromChain,
    toChain,
    fromPrice,
    toPrice,
    isCrossChain,
    bridgeToStrkDisabled,
    bridgePairSupported,
    mevProtection,
    slippage,
    customSlippage,
    setToAmount,
    setQuote,
    setQuoteError,
    setIsQuoteLoading,
    setLiquidityMaxFromQuote,
  })

  /**
   * Handles `handleSwapTokens` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleSwapTokens = () => {
    const tempTokenSymbol = fromSymbol
    const tempAmount = fromAmount
    setFromTokenSymbol(toSymbol)
    setToTokenSymbol(tempTokenSymbol)
    setFromAmount(toAmount)
    setToAmount(tempAmount)
  }

  // Calculate trade details
  const fromValueUSD = Number.parseFloat(fromAmount || "0") * fromToken.price
  const hasQuote = Boolean(quote)
  const bridgeTokenMismatch = isCrossChain && fromToken.symbol !== toToken.symbol
  const tokenFeeDigits = ["BTC", "WBTC"].includes(fromToken.symbol.toUpperCase()) ? 8 : 6
  /**
   * Parses or transforms values for `formatTokenFeeValue`.
   *
   * @param amount - Input used by `formatTokenFeeValue` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const formatTokenFeeValue = (amount: number) => {
    const safeAmount = Math.max(0, amount)
    const minDisplayAmount = 10 ** -tokenFeeDigits
    if (safeAmount > 0 && safeAmount < minDisplayAmount) {
      return `< ${formatTokenAmount(minDisplayAmount, tokenFeeDigits)} ${fromToken.symbol}`
    }
    return `${formatTokenAmount(safeAmount, tokenFeeDigits)} ${fromToken.symbol}`
  }
  const rawFeeAmount = hasQuote ? quote?.fee ?? 0 : null
  const feeUnit = quote?.feeUnit || (quote?.type === "bridge" ? "token" : "usd")
  const discountRate = hasNftDiscount ? Math.min(Math.max(discountPercent, 0), 100) / 100 : 0
  const bridgeRewardDiscountPercent =
    isCrossChain && lastBridgeRewards
      ? Math.max(0, Number(lastBridgeRewards.discountPercent || 0))
      : 0
  const bridgeRewardAiBonusPercent =
    isCrossChain && lastBridgeRewards
      ? Math.max(0, Number(lastBridgeRewards.aiBonusPercent || 0))
      : 0
  const displayDiscountPercent = hasNftDiscount ? discountPercent : bridgeRewardDiscountPercent
  const rawProtocolFee = quote?.protocolFee
  const rawMevFee = quote?.mevFee
  const rawNetworkFee = quote?.networkFee
  const protocolFeeEffective =
    rawProtocolFee === undefined
      ? hasQuote
        ? 0
        : undefined
      : rawProtocolFee * (1 - discountRate)
  const mevFeeEffective =
    rawMevFee === undefined
      ? hasQuote
        ? 0
        : undefined
      : rawMevFee * (1 - discountRate)
  const networkFeeEffective = hasQuote ? Math.max(0, rawNetworkFee ?? 0) : 0
  const feeAmount =
    hasQuote
      ? (protocolFeeEffective ?? 0) + (mevFeeEffective ?? 0) + networkFeeEffective
      : null
  const feeUsdAmount =
    feeAmount === null
      ? null
      : feeUnit === "token"
      ? feeAmount * (fromToken.price || 0)
      : feeAmount
  const rawFeeUsdAmount =
    rawFeeAmount === null
      ? null
      : feeUnit === "token"
      ? rawFeeAmount * (fromToken.price || 0)
      : rawFeeAmount
  const feeSavingsUsd =
    rawFeeUsdAmount === null || feeUsdAmount === null
      ? 0
      : Math.max(0, rawFeeUsdAmount - feeUsdAmount)
  const feeDisplayLabel =
    feeAmount === null
      ? "—"
      : feeUnit === "token"
      ? `${formatTokenFeeValue(feeAmount)}${
          feeUsdAmount !== null && feeUsdAmount >= 0.01
            ? ` (~$${feeUsdAmount.toFixed(2)})`
            : feeUsdAmount !== null && feeUsdAmount > 0
            ? " (~<$0.01)"
            : ""
        }`
      : `$${(feeAmount ?? 0).toFixed(2)}`
  const protocolFeeDisplay =
    !hasQuote || protocolFeeEffective === undefined
      ? "—"
      : feeUnit === "token"
      ? formatTokenFeeValue(protocolFeeEffective)
      : `$${protocolFeeEffective.toFixed(2)}`
  const networkFeeDisplay =
    !hasQuote || quote?.type !== "bridge"
      ? "—"
      : formatTokenFeeValue(networkFeeEffective)
  const mevFeeDisplay =
    !hasQuote || mevFeeEffective === undefined
      ? "—"
      : feeUnit === "token"
      ? formatTokenFeeValue(mevFeeEffective)
      : `$${mevFeeEffective.toFixed(2)}`
  const mevFeePercent = mevProtection ? (MEV_FEE_RATE * 100).toFixed(1) : "0.0"
  const basePointsEarned = hasQuote ? Math.max(0, Math.floor(fromValueUSD * 10)) : null
  const nftPointsMultiplier = hasNftDiscount ? 1 + discountRate : 1
  const effectiveNftPointsMultiplier =
    hasNftDiscount || bridgeRewardDiscountPercent <= 0
      ? nftPointsMultiplier
      : 1 + Math.min(Math.max(bridgeRewardDiscountPercent, 0), 100) / 100
  const normalizedStakeMultiplier =
    Number.isFinite(stakePointsMultiplier) && stakePointsMultiplier > 0 ? stakePointsMultiplier : 1
  const hideUsdtTierBonusPercent = hideBalanceOnchain ? usdtTierBonusPercent(fromValueUSD) : 0
  const hideUsdtTierMultiplier = 1 + hideUsdtTierBonusPercent / 100
  const bridgeAiBonusMultiplier = 1 + bridgeRewardAiBonusPercent / 100
  const effectivePointsMultiplier =
    normalizedStakeMultiplier * effectiveNftPointsMultiplier * hideUsdtTierMultiplier * bridgeAiBonusMultiplier
  const pointsEarned =
    basePointsEarned === null
      ? null
      : Math.max(0, Math.floor(basePointsEarned * effectivePointsMultiplier))
  const showPointsMultiplier =
    normalizedStakeMultiplier > 1 ||
    effectiveNftPointsMultiplier > 1 ||
    hideUsdtTierBonusPercent > 0 ||
    bridgeRewardAiBonusPercent > 0
  const showDiscountBadge = displayDiscountPercent > 0
  const usdtEquivalentVolume =
    Number.isFinite(fromValueUSD) && fromValueUSD > 0 ? fromValueUSD : 0
  const activeUsdtPointsTier = hideBalanceOnchain
    ? USDT_POINTS_TIER_OPTIONS.reduce(
        (best, option) => (usdtEquivalentVolume >= option.minUsdt ? option : best),
        null as (typeof USDT_POINTS_TIER_OPTIONS)[number] | null
      )
    : null
  const estimatedTime = hasQuote
    ? (quote?.estimatedTime || "").trim() ||
      (quote?.type === "bridge" ? estimatedBridgeTimeByProvider(quote?.provider) : "~1-2 min")
    : "—"
  
  // Price Impact calculation
  const priceImpact = quote?.priceImpact
    ? Number.parseFloat(quote.priceImpact.replace("%", ""))
    : null

  const activeSlippage = customSlippage || slippage
  const routeLabel = isCrossChain ? (quote?.provider || "Bridge") : "Auto"
  const isSameTokenSwapPair = !isCrossChain && fromSymbol.toUpperCase() === toSymbol.toUpperCase()
  const isBtcGardenRoute =
    isCrossChain &&
    fromChain === "bitcoin" &&
    (routeLabel || "").trim().toLowerCase() === "garden"
  const isShadowBtcHideRoute =
    isCrossChain &&
    quote?.type === "bridge" &&
    fromChain === "bitcoin" &&
    toSymbol.trim().toUpperCase() === "WBTC" &&
    balanceHidden
  const bridgeProviderKey = (quote?.provider || "").trim().toLowerCase()
  const isStarkgateBridgeRoute = quote?.type === "bridge" && bridgeProviderKey === "starkgate"
  const bridgeProtocolFeeLabel = isStarkgateBridgeRoute ? "StarkGate Fee" : "Bridge Fee"
  const bridgeNetworkFeeLabel = isStarkgateBridgeRoute ? "Network Gas (est.)" : "Network Fee (est.)"
  const showPendingBtcDeposit =
    Boolean(pendingBtcDeposit) && isCrossChain && quote?.type === "bridge"
  const pendingOrderStatus = (
    pendingBtcDeposit?.status ||
    (pendingBtcDeposit?.txHash ? "processing" : "pending_deposit")
  )
    .trim()
    .toLowerCase()
  const pendingIsFinalized =
    pendingOrderStatus === "completed" || pendingOrderStatus === "refunded"
  const pendingAwaitingDepositOnly =
    showPendingBtcDeposit &&
    !pendingIsFinalized &&
    !pendingBtcDeposit?.txHash &&
    (pendingOrderStatus === "pending_deposit" || pendingOrderStatus === "pending" || !pendingOrderStatus)
  // Allow creating new bridge/swap transactions while previous BTC bridge order is settling.
  const pendingBtcOrderBlocking = false
  const pendingCanClaimRefund =
    Boolean(
      pendingBtcDeposit &&
        !pendingIsFinalized &&
        (pendingOrderStatus === "expired" ||
          pendingOrderStatus === "failed" ||
          pendingBtcDeposit.instantRefundTx ||
          pendingBtcDeposit.instantRefundHash)
    )
  /**
   * Handles `pendingStatusLabel` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const pendingStatusLabel = (() => {
    if (pendingOrderStatus === "pending_deposit") return "Pending deposit"
    if (pendingOrderStatus === "initiated" || pendingOrderStatus === "processing") {
      return "Processing"
    }
    if (pendingOrderStatus === "expired") return "Expired"
    if (pendingOrderStatus === "refunded") return "Refunded"
    if (pendingOrderStatus === "completed") return "Completed"
    if (pendingOrderStatus === "failed") return "Failed"
    return pendingOrderStatus || "Pending"
  })()
  const pendingStatusClassName =
    pendingOrderStatus === "completed" || pendingOrderStatus === "refunded"
      ? "text-success"
      : pendingOrderStatus === "expired" || pendingOrderStatus === "failed"
      ? "text-warning"
      : "text-muted-foreground"
  const pendingSourceLabel =
    pendingBtcDeposit?.requestSource === "ai" ? "AI Bridge" : "Manual Bridge"
  const isSwapContractEventOnly = React.useMemo(() => {
    const forcedEventOnly = (process.env.NEXT_PUBLIC_SWAP_CONTRACT_EVENT_ONLY || "").toLowerCase()
    if (forcedEventOnly === "1" || forcedEventOnly === "true") {
      return true
    }
    return isSameFeltAddress(STARKNET_SWAP_CONTRACT_ADDRESS, CAREL_PROTOCOL_ADDRESS)
  }, [])
  const isStarknetPairSwap = !isCrossChain && fromChain === "starknet" && toChain === "starknet"
  const fromAmountValue = Number.parseFloat(fromAmount || "0")
  const hasPositiveAmount = Number.isFinite(fromAmountValue) && fromAmountValue > 0
  const shouldRequireLiveStarknetBalance =
    sourceChain === "starknet" &&
    ["STRK", "CAREL", "USDC", "USDT", "WBTC"].includes(fromToken.symbol.toUpperCase())
  /**
   * Handles `fromTokenLiveBalance` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const fromTokenLiveBalance = (() => {
    const symbol = fromToken.symbol.toUpperCase()
    if (!shouldRequireLiveStarknetBalance) return null
    if (symbol === "STRK") return wallet.onchainBalance.STRK_L2 ?? wallet.balance.STRK ?? null
    if (symbol === "CAREL") return wallet.onchainBalance.CAREL ?? wallet.balance.CAREL ?? null
    if (symbol === "USDC") return wallet.onchainBalance.USDC ?? wallet.balance.USDC ?? null
    if (symbol === "USDT") return wallet.onchainBalance.USDT ?? wallet.balance.USDT ?? null
    if (symbol === "WBTC") return wallet.onchainBalance.WBTC ?? wallet.balance.WBTC ?? null
    return null
  })()
  const onchainBalanceUnavailable =
    shouldRequireLiveStarknetBalance &&
    (fromTokenLiveBalance === null || fromTokenLiveBalance === undefined)
  const needsStarknetGasReserve =
    fromToken.symbol.toUpperCase() === "STRK" && sourceChain === "starknet"
  const effectiveFromBalance =
    shouldRequireLiveStarknetBalance && typeof fromTokenLiveBalance === "number"
      ? Math.max(fromTokenLiveBalance, fromToken.balance || 0)
      : fromToken.balance || 0
  const maxSpendableFromBalance = Math.max(
    0,
    effectiveFromBalance - (needsStarknetGasReserve ? STARKNET_STRK_GAS_RESERVE : 0)
  )
  const maxSpendableFromLiquidity =
    typeof liquidityMaxFromQuote === "number" && Number.isFinite(liquidityMaxFromQuote)
      ? Math.max(0, liquidityMaxFromQuote)
      : null
  const maxExecutableFromAllLimits =
    maxSpendableFromLiquidity === null
      ? maxSpendableFromBalance
      : Math.max(0, Math.min(maxSpendableFromBalance, maxSpendableFromLiquidity))
  const hasInsufficientBalance = hasPositiveAmount && fromAmountValue > maxSpendableFromBalance
  const hasInsufficientLiquidityCap =
    hasPositiveAmount &&
    maxSpendableFromLiquidity !== null &&
    fromAmountValue > maxSpendableFromLiquidity + 1e-12
  const hideUsdtTierPriceUnavailable =
    hideUsdtTierLockEnabled && !(Number.isFinite(fromToken.price) && fromToken.price > 0)
  const hideAssetRuleMissingMessage = buildHideAssetRuleMissingMessage(
    fromToken.symbol,
    selectedHideUsdtTier.minUsdt
  )
  const hideAssetRuleChecking =
    hideUsdtTierLockEnabled && hideAssetRuleStatus === "checking"
  const hideAssetRuleMissing =
    hideUsdtTierLockEnabled && hideAssetRuleStatus === "missing"
  React.useEffect(() => {
    if (!hideUsdtTierLockEnabled) {
      setHideAssetRuleStatus("idle")
      return
    }
    const executorAddress = (PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim()
    const tokenAddress = resolveTokenAddress(fromToken.symbol).trim()
    const denomId = (inferredHideDenomId || "").trim()
    if (!wallet.isConnected || !executorAddress || !tokenAddress || !denomId) {
      setHideAssetRuleStatus("unavailable")
      return
    }
    let cancelled = false
    setHideAssetRuleStatus("checking")
    void (async () => {
      try {
        const fixedAmount = await readStarknetShieldedPoolFixedAmountFromWallet(
          executorAddress,
          tokenAddress,
          denomId,
          "starknet"
        )
        if (cancelled) return
        if (fixedAmount !== null && fixedAmount > BigInt(0)) {
          setHideAssetRuleStatus("ok")
          return
        }
        if (fixedAmount !== null && fixedAmount === BigInt(0)) {
          setHideAssetRuleStatus("missing")
          return
        }
        setHideAssetRuleStatus("unavailable")
      } catch {
        if (cancelled) return
        setHideAssetRuleStatus("unavailable")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    fromToken.symbol,
    hideUsdtTierLockEnabled,
    inferredHideDenomId,
    wallet.isConnected,
  ])
  React.useEffect(() => {
    if (hideUsdtTierLockEnabled) return
    if (onchainBalanceUnavailable) return
    const parsed = Number.parseFloat(fromAmount || "0")
    if (!Number.isFinite(parsed) || parsed <= 0) return
    // Keep manual input editable even when balance/liquidity currently resolves to 0.
    if (maxExecutableFromAllLimits <= 0) return
    if (parsed <= maxExecutableFromAllLimits + 1e-12) return
    const clamped = sanitizeDecimalInput(
      String(Math.max(0, maxExecutableFromAllLimits)),
      resolveTokenDecimals(fromToken.symbol)
    )
    if (clamped !== fromAmount) {
      setFromAmount(clamped)
    }
  }, [
    fromAmount,
    fromToken.symbol,
    hideUsdtTierLockEnabled,
    maxExecutableFromAllLimits,
    onchainBalanceUnavailable,
  ])
  const resolvedReceiveAddress = (receiveAddress || preferredReceiveAddress).trim()
  const hasValidQuote = hasQuote && !quoteError
  const hasPreparedOnchainSwapCalls =
    quote?.type === "swap" && Array.isArray(quote.onchainCalls) && quote.onchainCalls.length > 0
  const hasFallbackPositiveBalance =
    Number.isFinite(fromToken.balance) && fromToken.balance > 0
  const activeTradePrivacyPayload = hideBalanceOnchain ? loadTradePrivacyPayload() : undefined
  const activeHideRecipient =
    hideBalanceOnchain &&
    (HIDE_BALANCE_SHIELDED_POOL ||
      (activeTradePrivacyPayload?.note_version || "").trim().toLowerCase() === "v4")
      ? (activeTradePrivacyPayload?.recipient || "").trim()
      : ""
  const activeHidePayloadIsV4 =
    hideBalanceOnchain &&
    ((activeTradePrivacyPayload?.note_version || "").trim().toLowerCase() === "v4" ||
      HIDE_BALANCE_SHIELDED_POOL)
  const hasActiveHideV4Note =
    activeHidePayloadIsV4 &&
    !!activeTradePrivacyPayload &&
    !!(
      (activeTradePrivacyPayload.note_commitment || "").trim() ||
      (activeTradePrivacyPayload.commitment || "").trim()
    )
  const activeHideNoteCommitment = (
    activeTradePrivacyPayload?.note_commitment ||
    activeTradePrivacyPayload?.commitment ||
    ""
  )
    .trim()
    .toLowerCase()
  const activeHideNoteNullifier = (activeTradePrivacyPayload?.nullifier || "").trim().toLowerCase()
  const activeHideNoteRecord = React.useMemo(() => {
    if (!hasActiveHideV4Note) return null
    return (
      pendingHideNotes.find((note) => {
        const noteCommitment = (note.note_commitment || "").trim().toLowerCase()
        const noteNullifier = (note.nullifier || "").trim().toLowerCase()
        return (
          (!!activeHideNoteCommitment && noteCommitment === activeHideNoteCommitment) ||
          (!!activeHideNoteNullifier && noteNullifier === activeHideNoteNullifier)
        )
      }) || null
    )
  }, [activeHideNoteCommitment, activeHideNoteNullifier, hasActiveHideV4Note, pendingHideNotes])
  const activeHideTrackedNote =
    hasActiveHideV4Note && activeHideNoteRecord ? activeHideNoteRecord : null
  const hasTrackedActiveHideNote = !!activeHideTrackedNote
  const privacySpendableAtMs =
    typeof activeHideTrackedNote?.spendable_at_unix === "number" &&
    Number.isFinite(activeHideTrackedNote.spendable_at_unix)
      ? activeHideTrackedNote.spendable_at_unix * 1000
      : typeof activeTradePrivacyPayload?.spendable_at_unix === "number" &&
        Number.isFinite(activeTradePrivacyPayload.spendable_at_unix) &&
        pendingHideNotes.length === 0
      ? activeTradePrivacyPayload.spendable_at_unix * 1000
      : null
  const nowMsSnapshot = Date.now()
  const hideMixingWindowRemainingMs =
    activeHidePayloadIsV4 && privacySpendableAtMs
      ? Math.max(0, privacySpendableAtMs - nowMsSnapshot)
      : 0
  const hideMixingWindowBlocked =
    activeHidePayloadIsV4 && hideMixingWindowRemainingMs > 0
  const manualHideMixingBlocked =
    hideMixingWindowBlocked &&
    isManuallySelectedHideNote(activeHideNoteCommitment, activeHideNoteNullifier)
  const activeHideNoteTokenSymbol = (activeHideNoteRecord?.token_symbol || "").trim().toUpperCase()
  const activeHideNoteAmountText = (activeHideNoteRecord?.amount || "").trim()
  const activeExecutorNormalized = normalizeExecutorAddress(PRIVATE_ACTION_EXECUTOR_ADDRESS)
  const activeHideNoteExecutor = normalizeExecutorAddress(activeHideNoteRecord?.executor_address)
  const activeHideExecutorMismatch =
    hasActiveHideV4Note &&
    !!activeHideNoteExecutor &&
    !!activeExecutorNormalized &&
    activeHideNoteExecutor !== activeExecutorNormalized
  const pendingHideNotesActive = React.useMemo(() => {
    const now = Date.now()
    return pendingHideNotes.filter((note) => {
      const commitment = (note.note_commitment || "").trim()
      if (!commitment) return false
      const spendableAtMs =
        typeof note.spendable_at_unix === "number" && Number.isFinite(note.spendable_at_unix)
          ? note.spendable_at_unix * 1000
          : 0
      const expiredByLocalClock =
        spendableAtMs > 0 &&
        now - spendableAtMs > 12 * 60 * 60 * 1000
      return !expiredByLocalClock
    })
  }, [countdownTick, pendingHideNotes])
  const nextCountdownAtMs = React.useMemo(() => {
    const now = Date.now()
    let next: number | null = null
    if (activeHidePayloadIsV4 && privacySpendableAtMs && privacySpendableAtMs > now) {
      next = privacySpendableAtMs
    }
    for (const note of pendingHideNotesActive) {
      const spendableAt = Number(note.spendable_at_unix || 0)
      if (!Number.isFinite(spendableAt) || spendableAt <= 0) continue
      const spendableAtMs = spendableAt * 1000
      if (spendableAtMs <= now) continue
      if (next === null || spendableAtMs < next) {
        next = spendableAtMs
      }
    }
    return next
  }, [activeHidePayloadIsV4, pendingHideNotesActive, privacySpendableAtMs])
  React.useEffect(() => {
    if (!nextCountdownAtMs) return
    const delay = nextCountdownAtMs - Date.now()
    if (delay <= 0) {
      setCountdownTick((prev) => prev + 1)
      return
    }
    const timer = window.setTimeout(() => {
      setCountdownTick((prev) => prev + 1)
    }, delay + 50)
    return () => window.clearTimeout(timer)
  }, [nextCountdownAtMs])
  const walletConnectedForActions =
    wallet.isConnected || !!(wallet.starknetAddress || wallet.address || "").trim()
  const hideBalancePrivateSwapBlockedReason =
    hideBalanceOnchain && isStarknetPairSwap ? HIDE_BALANCE_PRIVATE_SWAP_BLOCK_REASON : null
  const executeDisabledReason =
    !walletConnectedForActions
      ? "Connect your wallet first."
      : isCancellingHideNote
      ? "Cancelling hide note..."
      : pendingBtcOrderBlocking
      ? "There is an active BTC bridge order still processing. Complete it in Bridge Status before creating another one."
      : !hasPositiveAmount
      ? "Enter a valid amount."
      : hideUsdtTierPriceUnavailable
      ? `Live price ${fromToken.symbol} belum tersedia untuk lock tier hide. Tunggu price feed update.`
      : hideAssetRuleChecking
      ? "Checking Hide Balance asset rule..."
      : hideAssetRuleMissing
      ? hideAssetRuleMissingMessage
      : hideBalancePrivateSwapBlockedReason
      ? hideBalancePrivateSwapBlockedReason
      : isSameTokenSwapPair
      ? "Select a different destination token."
      : onchainBalanceUnavailable && !hasFallbackPositiveBalance
      ? `On-chain ${fromToken.symbol} balance is not available yet. Wait for balance refresh.`
      : hasInsufficientBalance
      ? `Amount exceeds balance. Max ${formatTokenAmount(maxSpendableFromBalance, 6)} ${fromToken.symbol}${
          needsStarknetGasReserve ? " (gas reserve already kept)" : ""
        }.`
      : hasInsufficientLiquidityCap
      ? `Current route liquidity limits the amount. Max ${formatTokenAmount(maxExecutableFromAllLimits, 6)} ${fromToken.symbol}.`
      : isStarknetPairSwap && isSwapContractEventOnly
      ? "Real-token swap is not active yet: current contract is event-only (events + gas only)."
      : !hasValidQuote
      ? quoteError || "Quote is not ready yet."
      : isStarknetPairSwap && !hasPreparedOnchainSwapCalls
      ? "Quote on-chain calldata is not ready yet. Refresh the quote."
      : isCrossChain && !resolvedReceiveAddress
      ? "Receive address is required."
      : manualHideMixingBlocked
      ? `Hide note is still mixing. Ready in ${formatRemainingDuration(hideMixingWindowRemainingMs)}.`
      : activeHideExecutorMismatch
      ? "Active hide note uses an old executor. Pick a note on current executor or withdraw old note."
      : null
  const executeDisabledReasonNode =
    manualHideMixingBlocked && privacySpendableAtMs
      ? (
          <>
            Hide note is still mixing. Ready in{" "}
            <Countdown targetMs={privacySpendableAtMs} />
            .
          </>
        )
      : executeDisabledReason
  /**
   * Runs `executeButtonLabel` and handles related side effects.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const executeButtonLabel = (() => {
    if (swapState === "confirming") {
      return (
        <span className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          Confirming...
        </span>
      )
    }
    if (swapState === "processing") {
      return (
        <span className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          Processing {isCrossChain ? "Bridge" : "Swap"}...
        </span>
      )
    }
    if (swapState === "success") {
      return (
        <span className="flex items-center gap-2">
          <Check className="h-5 w-5" />
          {isCrossChain ? "Bridge" : "Swap"} Successful!
        </span>
      )
    }
    if (swapState === "error") {
      return (
        <span className="flex items-center gap-2">
          <X className="h-5 w-5" />
          Transaction Failed
        </span>
      )
    }
    if (isCrossChain) return "Execute Bridge"
    if (hideBalanceOnchain && (hasTrackedActiveHideNote || !activeHideTrackedNote)) {
      return "Execute Note"
    }
    return "Execute Trade"
  })()

  const starknetProviderHint = React.useMemo<"starknet" | "argentx" | "braavos">(() => {
    if (wallet.provider === "argentx" || wallet.provider === "braavos") {
      return wallet.provider
    }
    return "starknet"
  }, [wallet.provider])
  const btcProviderLabel = React.useMemo(() => {
    if (wallet.btcProvider === "xverse") return "Xverse"
    if (wallet.btcProvider === "unisat") return "UniSat"
    return "UniSat/Xverse"
  }, [wallet.btcProvider])

  const {
    readAllowanceCached,
    waitForAllowance,
    submitOnchainSwapTx,
    submitOnchainBridgeTx,
  } = useOnchainActions({
    fromToken,
    toToken,
    fromAmount,
    quote,
    activeSlippage,
    mevProtection,
    hideBalanceOnchain,
    isSwapContractEventOnly,
    receiveAddress,
    preferredReceiveAddress,
    inferredHideDenomId,
    selectedHideUsdtTier,
    starknetProviderHint,
    notifications,
    wallet,
    resolveHideBalancePrivacyPayload,
    setQuote,
    setHasTradePrivacyPayload,
  })

  const {
    resolveHideFixedAmountText,
    ensureHideNoteDeposited,
    handleCancelHideNoteWithdraw,
  } = useHideActions({
    fromToken,
    toToken,
    fromAmount,
    inferredHideDenomId,
    hideBalanceOnchain,
    starknetProviderHint,
    notifications,
    wallet,
    resolveTokenPrice,
    setFromAmount,
    setHasTradePrivacyPayload,
    setPendingHideNotes,
    setBalanceHidden,
    setIsCancellingHideNote,
    clearTradePrivacyPayload,
    clearManuallySelectedHideNote,
    isManuallySelectedHideNote,
    readAllowanceCached,
    waitForAllowance,
  })

  const { handleSendBtcDepositFromWallet, handleClaimInstantRefund } = useBtcActions({
    pendingBtcDeposit,
    notifications,
    wallet,
    setPendingBtcDeposit,
    setIsSendingBtcDeposit,
    setIsClaimingRefund,
    pollGardenBridgeOrder,
    lastGardenOrderStatusRef,
  })

  React.useEffect(() => {
    if (!hideUsdtTierLockEnabled) return
    if (manuallySelectedHideNoteRef.current) return
    let cancelled = false
    void (async () => {
      const fromSymbol = fromToken.symbol.trim().toUpperCase()
      if (fromSymbol === "CAREL") {
        const directTierAmount = sanitizeDecimalInput(
          String(selectedHideUsdtTier.minUsdt),
          resolveTokenDecimals(fromToken.symbol)
        )
        if (!cancelled && fromAmount !== directTierAmount) {
          setFromAmount(directTierAmount)
        }
        return
      }
      const targetAmount = await resolveHideFixedAmountText({
        executorAddress: PRIVATE_ACTION_EXECUTOR_ADDRESS,
        tokenSymbol: fromToken.symbol,
        denomId: inferredHideDenomId,
        fallbackAmount: String(selectedHideUsdtTier.minUsdt),
        fallbackKind: "usd",
      })
      if (cancelled || !targetAmount) return
      if (fromAmount === targetAmount) return
      setFromAmount(targetAmount)
    })()
    return () => {
      cancelled = true
    }
  }, [
    fromAmount,
    fromToken.symbol,
    hideUsdtTierLockEnabled,
    inferredHideDenomId,
    resolveHideFixedAmountText,
    selectedHideUsdtTier.minUsdt,
  ])

  const openExternalUrl = React.useCallback((url: string) => {
    if (!url || typeof window === "undefined") return
    window.open(url, "_blank", "noopener,noreferrer")
  }, [])

  const handleCopyBtcVaultAddress = React.useCallback(async () => {
    if (!BTC_VAULT_ADDRESS) {
      notifications.addNotification({
        type: "warning",
        title: "Vault address not configured",
        message: "Set NEXT_PUBLIC_BTC_VAULT_ADDRESS di frontend/.env.local.",
      })
      return
    }
    try {
      await navigator.clipboard.writeText(BTC_VAULT_ADDRESS)
      setBtcVaultCopied(true)
      window.setTimeout(() => setBtcVaultCopied(false), 1800)
      notifications.addNotification({
        type: "success",
        title: "Vault address copied",
        message: "BTC vault address copied to clipboard.",
      })
    } catch {
      notifications.addNotification({
        type: "error",
        title: "Copy failed",
        message: "Unable to copy BTC vault address.",
      })
    }
  }, [notifications])

  /**
   * Handles `handleExecuteTrade` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleExecuteTrade = () => {
    if (executeDisabledReason) return
    setPreviewOpen(true)
  }

  /**
   * Handles `confirmTrade` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const confirmTrade = useTradeExecution({
    executeDisabledReason,
    notifications,
    setActivePendingHideNoteSwapKey,
    setPreviewOpen,
    setSwapState,
    hideBalanceOnchain,
    resolveHideBalancePrivacyPayload,
    isManuallySelectedHideNote,
    isCrossChain,
    receiveAddress,
    preferredReceiveAddress,
    fromToken,
    toToken,
    fromAmount,
    toAmount,
    xverseUserId,
    wallet,
    quote,
    mevProtection,
    submitOnchainBridgeTx,
    submitOnchainSwapTx,
    starknetProviderHint,
    pollGardenBridgeOrder,
    setPendingBtcDeposit,
    setIsSendingBtcDeposit,
    setLastBridgeRewards,
    setPendingHideNotes,
    setHasTradePrivacyPayload,
    removePendingHideNote,
    openTradeResultPopup,
    clearTradePrivacyPayload,
    clearManuallySelectedHideNote,
    ensureHideNoteDeposited,
    manualSelectedHideNoteRetryRef,
    manuallySelectedHideNoteRef,
    inferredHideDenomId,
    hideUsdtTierBonusPercent,
    hideAssetRuleMissingMessage,
    setActiveNft,
    setStakePointsMultiplier,
    activeSlippage,
    lastGardenOrderStatusRef,
    helpers: {
      buildGardenOrderExplorerLinks,
      chainFromNetwork,
      computeMinimumAmountOut,
      computeTradeDeadlineSeconds,
      executeBridge,
      executeHideViaRelayer,
      executeSwap,
      formatBtcFromSats,
      formatRemainingDuration,
      getConnectedEvmAddressFromWallet,
      getOwnedNfts,
      getRewardsPoints,
      getSwapQuote,
      invokeStarknetCallsFromWallet,
      isBridgePairSupportedForCurrentRoutes,
      isBridgeToStrkDisabledRoute,
      isStarknetEntrypointMissingError,
      limitBridgeApprovalToExactAmount,
      loadPendingHideNotes,
      loadTradePrivacyPayload,
      normalizeGardenStarknetEntrypoint,
      persistTradePrivacyPayload,
      resolveTokenAddress,
      resolveTradeSlippage,
      sendEvmTransactionFromWallet,
    },
    flags: {
      BRIDGE_TO_STRK_DISABLED_MESSAGE,
      HIDE_BALANCE_FALLBACK_TO_PUBLIC_ENABLED,
      HIDE_BALANCE_RELAYER_POOL_ENABLED,
      HIDE_BALANCE_SHIELDED_POOL,
      UNSUPPORTED_BRIDGE_PAIR_MESSAGE,
    },
  })

  confirmTradeRef.current = () => {
    void confirmTrade()
  }

  return (
    <TradeErrorBoundary>
      <div className="w-full max-w-xl mx-auto px-2 sm:px-0 pb-28 md:pb-0">
        <div className="p-4 sm:p-6 rounded-xl sm:rounded-2xl glass-strong border border-border neon-border">
        {/* Header with Privacy Toggle */}
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-foreground">Unified Trade</h2>
            {fromSource.visible && (
              <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide", fromSource.className)}>
                {fromSource.label}
              </span>
            )}
            {fromToken.symbol !== toToken.symbol &&
              toSource.visible &&
              (fromSource.label !== toSource.label || !fromSource.visible) && (
                <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide", toSource.className)}>
                  {toSource.label}
                </span>
              )}
          </div>
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-secondary/15"
              title={`WebSocket ${priceStatus.websocket}`}
              aria-label={`WebSocket ${priceStatus.websocket}`}
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  priceStatus.websocket === "open"
                    ? "bg-success animate-pulse"
                    : "bg-muted-foreground"
                )}
              />
            </span>
            {hideBalanceSupportedForCurrentPair && (
              <button 
                onClick={() => {
                  const next = !balanceHidden
                  setBalanceHidden(next)
                  if (next) {
                    setHidePanelOpen(true)
                    clearTradePrivacyPayload()
                    void resolveHideBalancePrivacyPayload().catch(() => undefined)
                  } else {
                    setHidePanelOpen(false)
                  }
                  refreshTradePrivacyPayload()
                }}
                className={cn(
                  "p-2 rounded-lg transition-colors group border",
                  !balanceHidden
                    ? "border-border text-muted-foreground hover:bg-surface/50"
                    : hasTradePrivacyPayload
                    ? "bg-primary/20 border-primary/50 text-primary"
                    : "bg-warning/10 border-warning/40 text-warning hover:bg-warning/20"
                )}
                title={
                  !balanceHidden
                    ? "Hide balances"
                    : hasTradePrivacyPayload
                    ? "Show balances (on-chain hide active)"
                    : "Show balances (Garaga payload will be prepared automatically)"
                }
              >
                {balanceHidden ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Token Selectors */}
        <div className="space-y-2">
          <TokenSelector
            selectedToken={fromToken}
            onSelect={(token) => setFromTokenSymbol(token.symbol)}
            tokens={tokens}
            label="From"
            amount={fromAmount}
            onAmountChange={setFromAmount}
            readOnly={hideUsdtTierLockEnabled}
            hideBalance={balanceHidden}
            maxTradeBalance={maxExecutableFromAllLimits}
          />

          {fromToken.symbol === "BTC" && !wallet.btcAddress && (
            <div className="px-3 py-2 rounded-lg bg-warning/10 border border-warning/30">
              <p className="text-xs text-foreground">
                Source BTC membutuhkan wallet BTC testnet (UniSat/Xverse). Untuk quick test,
                gunakan pair ETH → BTC dulu.
              </p>
            </div>
          )}

          <div className="flex justify-center -my-2 relative z-10">
            <button
              onClick={handleSwapTokens}
              className="p-2 rounded-full bg-surface border border-border hover:border-primary hover:bg-primary/10 transition-all duration-300 group"
            >
              <ArrowDownUp className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </button>
          </div>

          <TokenSelector
            selectedToken={toToken}
            onSelect={(token) => setToTokenSymbol(token.symbol)}
            tokens={tokens}
            label="To"
            amount={toAmount}
            onAmountChange={setToAmount}
            readOnly
            hideBalance={balanceHidden}
          />
        </div>

        {/* Simplified Route Display */}
        <div className="mt-3 sm:mt-4 p-3 rounded-xl bg-surface/30 border border-border/50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Zap className="h-3 w-3 text-secondary" />
                Best Route via {quote?.type === "bridge" ? (quote.provider || "Bridge") : "Auto"}
              </span>
              {isShadowBtcHideRoute && (
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  <Eye className="h-3 w-3" />
                  Hide
                </span>
              )}
            </div>
            {isQuoteLoading ? (
              <span className="text-xs text-muted-foreground">Fetching quote...</span>
            ) : quoteError ? (
              <span className="text-xs text-destructive">Quote unavailable</span>
            ) : (
              <span className="text-xs text-success">Auto-selected</span>
            )}
          </div>
          <SimpleRouteVisualization fromToken={fromToken} toToken={toToken} isCrossChain={isCrossChain} />
          {!isQuoteLoading && quoteError && (
            <p className="mt-2 text-[11px] text-destructive break-words">{quoteError}</p>
          )}
          {!isQuoteLoading && quoteError && maxSpendableFromLiquidity !== null && (
            <button
              onClick={() =>
                setFromAmount(
                  sanitizeDecimalInput(
                    String(maxExecutableFromAllLimits),
                    resolveTokenDecimals(fromToken.symbol)
                  )
                )
              }
              className="mt-2 text-[11px] text-primary hover:text-primary/80 underline underline-offset-2"
            >
                  Use safe max: {formatTokenAmount(maxExecutableFromAllLimits, 6)} {fromToken.symbol}
            </button>
          )}
          {!isCrossChain && quote?.type === "swap" && quote.normalizedByLivePrice && !quoteError && (
            <p className="mt-2 text-[11px] text-warning">
              Backend quote is inconsistent with live prices. Output estimate is normalized using live USD value.
            </p>
          )}
        </div>

        <div className="mt-3 sm:mt-4 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setSettingsOpen(true)}
            className="h-11 text-sm font-semibold"
          >
            <Settings2 className="mr-2 h-4 w-4" />
            Trade Settings
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setHidePanelOpen(true)}
            disabled={!hideBalanceOnchain}
            className="h-11 text-sm font-semibold"
          >
            <EyeOff className="mr-2 h-4 w-4" />
            Hide Balance
          </Button>
        </div>

        <TradeSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          mode={mode}
          mevProtection={mevProtection}
          onToggleMevProtection={() => setMevProtectionEnabled((prev) => !prev)}
          slippagePresets={slippagePresets}
          slippage={slippage}
          customSlippage={customSlippage}
          setSlippage={setSlippage}
          setCustomSlippage={setCustomSlippage}
          toAmount={toAmount}
          toSymbol={toToken.symbol}
          receiveAddress={receiveAddress}
          onReceiveAddressChange={(value) => {
            setIsReceiveAddressManual(true)
            setReceiveAddress(value)
          }}
          quoteType={quote?.type ?? null}
          bridgeProtocolFeeLabel={bridgeProtocolFeeLabel}
          protocolFeeDisplay={protocolFeeDisplay}
          bridgeNetworkFeeLabel={bridgeNetworkFeeLabel}
          networkFeeDisplay={networkFeeDisplay}
          mevFeePercent={mevFeePercent}
          mevFeeDisplay={mevFeeDisplay}
          feeDisplayLabel={feeDisplayLabel}
          hasNftDiscount={hasNftDiscount}
          discountPercent={discountPercent}
          feeSavingsUsd={feeSavingsUsd}
          basePointsEarned={basePointsEarned}
          normalizedStakeMultiplier={normalizedStakeMultiplier}
          nftPointsMultiplier={nftPointsMultiplier}
          hideBalanceOnchain={hideBalanceOnchain}
          hideUsdtTierBonusPercent={hideUsdtTierBonusPercent}
          pointsEarned={pointsEarned}
        />

        <HideBalanceDialog
          open={hidePanelOpen}
          onOpenChange={setHidePanelOpen}
          hideBalanceOnchain={hideBalanceOnchain}
          hasTradePrivacyPayload={hasTradePrivacyPayload}
          hideMixingWindowBlocked={hideMixingWindowBlocked}
          hideMixingWindowRemainingMs={hideMixingWindowRemainingMs}
          isAutoPrivacyProvisioning={isAutoPrivacyProvisioning}
          devAutoGaragaPayloadEnabled={DEV_AUTO_GARAGA_PAYLOAD_ENABLED}
          hideBalanceShieldedPool={HIDE_BALANCE_SHIELDED_POOL}
          hideBalancePrivateSwapBlockReason={hideBalancePrivateSwapBlockedReason}
          activeHideRecipient={activeHideRecipient}
          hasTrackedActiveHideNote={hasTrackedActiveHideNote}
          activeHideNoteAmountText={activeHideNoteAmountText}
          activeHideNoteTokenSymbol={activeHideNoteTokenSymbol}
          fromAmount={fromAmount}
          fromTokenSymbol={fromToken.symbol}
          toTokenSymbol={toToken.symbol}
          hideUsdtTierLockEnabled={hideUsdtTierLockEnabled}
          selectedHideUsdtTier={selectedHideUsdtTier}
          hideUsdtTierMin={hideUsdtTierMin}
          usdtEquivalentVolume={usdtEquivalentVolume}
          activeUsdtPointsTier={activeUsdtPointsTier}
          usdtPointsTierOptions={USDT_POINTS_TIER_OPTIONS}
          pendingHideNotesActive={pendingHideNotesActive}
          nowMsSnapshot={nowMsSnapshot}
          activeExecutorNormalized={activeExecutorNormalized}
          activePendingHideNoteSwapKey={activePendingHideNoteSwapKey}
          swapState={swapState}
          isCancellingHideNote={isCancellingHideNote}
          notifications={notifications}
          tokenCatalog={tokenCatalog}
          setHideUsdtTierMin={setHideUsdtTierMin}
          clearManuallySelectedHideNote={clearManuallySelectedHideNote}
          clearTradePrivacyPayload={clearTradePrivacyPayload}
          setHasTradePrivacyPayload={setHasTradePrivacyPayload}
          setPendingHideNotes={setPendingHideNotes}
          setFromTokenSymbol={setFromTokenSymbol}
          setToTokenSymbol={setToTokenSymbol}
          setFromAmount={setFromAmount}
          setActivePendingHideNoteSwapKey={setActivePendingHideNoteSwapKey}
          resolveHideFixedAmountText={resolveHideFixedAmountText}
          manualSelectedHideNoteRetryRef={manualSelectedHideNoteRetryRef}
          confirmTradeRef={confirmTradeRef}
          handleCancelHideNoteWithdraw={handleCancelHideNoteWithdraw}
          markManuallySelectedHideNote={markManuallySelectedHideNote}
        />

        {/* NFT Discount Counter */}
        {showDiscountBadge && (
          <div className="mt-3 sm:mt-4 p-3 rounded-xl bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                NFT Discount Active
              </span>
              <span className="text-xs text-muted-foreground">
                {displayDiscountPercent.toFixed(2)}% off fees
              </span>
            </div>
          </div>
        )}
        {showPointsMultiplier && (
          <div className="mt-3 p-3 rounded-xl bg-secondary/10 border border-secondary/20">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground flex items-center gap-2">
                <Gift className="h-4 w-4 text-secondary" />
                Points Multiplier Active
              </span>
              <span className="text-xs text-secondary font-semibold">
                {formatMultiplier(effectivePointsMultiplier)}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Stake: {formatMultiplier(normalizedStakeMultiplier)}
              {effectiveNftPointsMultiplier > 1
                ? ` • NFT: ${formatMultiplier(effectiveNftPointsMultiplier)}`
                : ""}
              {hideUsdtTierBonusPercent > 0 ? ` • Hide Tier: +${hideUsdtTierBonusPercent.toFixed(0)}%` : ""}
              {bridgeRewardAiBonusPercent > 0
                ? ` • Bridge AI Bonus: +${bridgeRewardAiBonusPercent.toFixed(0)}%`
                : ""}
            </p>
          </div>
        )}

        {showPendingBtcDeposit && pendingBtcDeposit && (
          <div className="mt-3 p-3 rounded-xl bg-primary/10 border border-primary/30 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">BTC Bridge Status (Garden)</p>
              <span className="text-[11px] text-muted-foreground">
                Order {pendingBtcDeposit.bridgeId.slice(0, 10)}...
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Status</span>
              <span className={cn("text-[11px] font-medium", pendingStatusClassName)}>
                {pendingStatusLabel}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Source</span>
              <span className="text-[11px] text-foreground">{pendingSourceLabel}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Bridge details moved to popup so layout stays compact.
            </p>
            {!pendingIsFinalized && (
              <p className="text-[11px] text-secondary">
                This order can keep processing in background. New bridge transactions are still allowed.
              </p>
            )}
            {pendingAwaitingDepositOnly && (
              <p className="text-[11px] text-warning">
                This order is waiting for BTC deposit only. You can continue it in the popup, or dismiss local
                tracking and create a new bridge order.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="h-8 px-3 text-xs"
                onClick={() => setBridgeStatusPopupOpen(true)}
              >
                Open Bridge Status
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-8 px-3 text-xs"
                onClick={() =>
                  void pollGardenBridgeOrder(
                    pendingBtcDeposit.bridgeId,
                    pendingBtcDeposit.destinationChain
                  )
                }
                disabled={pendingIsFinalized}
              >
                Refresh Status
              </Button>
              {pendingGardenOrderExplorerUrl && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-3 text-xs"
                  onClick={() => openExternalUrl(pendingGardenOrderExplorerUrl)}
                >
                  Open Garden Order
                </Button>
              )}
              {pendingIsFinalized && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-3 text-xs"
                  onClick={() => removeTrackedPendingBtcOrder(pendingBtcDeposit.bridgeId)}
                >
                  Dismiss
                </Button>
              )}
              {pendingAwaitingDepositOnly && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-3 text-xs"
                  onClick={() => removeTrackedPendingBtcOrder(pendingBtcDeposit.bridgeId)}
                >
                  Dismiss Local Order
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Quick Info */}
        <div className="mt-3 sm:mt-4 grid grid-cols-3 gap-2 sm:gap-3">
          <div className="p-2.5 sm:p-3 rounded-lg bg-surface/30 text-center">
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <Clock className="h-3 w-3" /> Est. Time
            </p>
            <p className="text-sm font-medium text-foreground">{estimatedTime}</p>
          </div>
          <div className="p-2.5 sm:p-3 rounded-lg bg-surface/30 text-center">
            <p className="text-xs text-muted-foreground">Fee</p>
            <p className="text-sm font-medium text-foreground">{feeDisplayLabel}</p>
          </div>
          <div className="p-2.5 sm:p-3 rounded-lg bg-surface/30 text-center">
            <p className="text-xs text-muted-foreground">Impact</p>
            <p className={cn(
              "text-sm font-medium",
              priceImpact === null
                ? "text-muted-foreground"
                : priceImpact > 1
                ? "text-destructive"
                : "text-success"
            )}>
              {priceImpact === null ? "—" : `${priceImpact.toFixed(2)}%`}
            </p>
          </div>
        </div>

        {/* Price Impact Warning */}
        {priceImpact !== null && priceImpact > 1 && (
          <div className="mt-3 sm:mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-xs text-foreground">
                Price impact is higher than 1%. Consider reducing your trade size or splitting into multiple transactions.
              </p>
            </div>
          </div>
        )}

        {/* Execute Button */}
        <Button 
          onClick={handleExecuteTrade}
          disabled={swapState !== "idle" || !!executeDisabledReason}
          className={cn(
            "hidden md:inline-flex w-full mt-6 py-6 text-lg font-bold transition-all text-primary-foreground",
            swapState === "idle" && "bg-gradient-to-r from-primary via-accent to-primary bg-[length:200%_100%] animate-gradient hover:opacity-90",
            swapState === "confirming" && "bg-primary/80",
            swapState === "processing" && "bg-secondary/80",
            swapState === "success" && "bg-success",
            swapState === "error" && "bg-destructive"
          )}
        >
          {executeButtonLabel}
        </Button>
        {swapState === "idle" && executeDisabledReasonNode && (
          <p className="hidden md:block text-center text-xs text-warning mt-2">{executeDisabledReasonNode}</p>
        )}

        <p className="text-center text-xs text-muted-foreground mt-4">
          By trading, you agree to our Terms of Service
        </p>
      </div>

      <div className="fixed md:hidden inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto w-full max-w-xl px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
          <div className="mb-2 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">Fee: {feeDisplayLabel}</span>
            <span className="truncate text-center">Time: {estimatedTime}</span>
            <span className="truncate text-right">{pointsEarned === null ? "Pts: —" : `Pts: +${pointsEarned}`}</span>
          </div>
          <Button
            onClick={handleExecuteTrade}
            disabled={swapState !== "idle" || !!executeDisabledReason}
            className={cn(
              "w-full h-12 text-base font-semibold transition-all text-primary-foreground",
              swapState === "idle" && "bg-gradient-to-r from-primary via-accent to-primary bg-[length:200%_100%] animate-gradient hover:opacity-90",
              swapState === "confirming" && "bg-primary/80",
              swapState === "processing" && "bg-secondary/80",
              swapState === "success" && "bg-success",
              swapState === "error" && "bg-destructive"
            )}
          >
            {executeButtonLabel}
          </Button>
          {swapState === "idle" && executeDisabledReasonNode && (
            <p className="text-center text-[11px] text-warning mt-2">{executeDisabledReasonNode}</p>
          )}
        </div>
      </div>

      {previewOpen ? (
        <TradePreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          fromAmount={fromAmount}
          fromSymbol={fromToken.symbol}
          toAmount={toAmount}
          toSymbol={toToken.symbol}
          isCrossChain={isCrossChain}
          routeLabel={routeLabel}
          activeSlippage={activeSlippage}
          mevProtection={mevProtection}
          feeDisplayLabel={feeDisplayLabel}
          estimatedTime={estimatedTime}
          pointsEarned={pointsEarned}
          receiveAddress={resolvedReceiveAddress}
          requiresBtcDepositSigning={isBtcGardenRoute}
          onCancel={() => setPreviewOpen(false)}
          onConfirm={confirmTrade}
        />
      ) : null}

      <BridgeStatusDialog
        open={bridgeStatusPopupOpen}
        onOpenChange={setBridgeStatusPopupOpen}
        pendingBtcDeposit={pendingBtcDeposit}
        pendingStatusClassName={pendingStatusClassName}
        pendingStatusLabel={pendingStatusLabel}
        pendingSourceLabel={pendingSourceLabel}
        pendingIsFinalized={pendingIsFinalized}
        pendingGardenOrderExplorerUrl={pendingGardenOrderExplorerUrl}
        btcDepositExplorerUrl={btcDepositExplorerUrl}
        pendingCanClaimRefund={pendingCanClaimRefund}
        pendingOrderStatus={pendingOrderStatus}
        trackedPendingBtcOrders={trackedPendingBtcOrders}
        finalizedStatuses={FINALIZED_GARDEN_ORDER_STATUSES}
        walletBtcAddress={wallet.btcAddress || null}
        btcProviderLabel={btcProviderLabel}
        isSendingBtcDeposit={isSendingBtcDeposit}
        isClaimingRefund={isClaimingRefund}
        onSendBtcDeposit={handleSendBtcDepositFromWallet}
        onPollGardenBridgeOrder={pollGardenBridgeOrder}
        onOpenExternalUrl={openExternalUrl}
        onClaimRefund={handleClaimInstantRefund}
        onRemoveTrackedOrder={removeTrackedPendingBtcOrder}
        onSetPendingBtcDeposit={setPendingBtcDeposit}
      />

      <TradeResultDialog
        tradeResultPopup={tradeResultPopup}
        onOpenChange={(open) => {
          if (!open) {
            setTradeResultPopup(null)
          }
        }}
        onClose={() => setTradeResultPopup(null)}
      />
    </div>
    </TradeErrorBoundary>
  )
}
