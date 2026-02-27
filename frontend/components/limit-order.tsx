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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Info,
  Expand,
  X,
  Check,
  AlertCircle,
  Gift,
  Sparkles,
  Eye,
  EyeOff,
} from "lucide-react"
import { useNotifications } from "@/hooks/use-notifications"
import { useWallet } from "@/hooks/use-wallet"
import {
  autoSubmitPrivacyAction,
  cancelLimitOrder,
  createLimitOrder,
  getMarketDepth,
  getOwnedNfts,
  getPortfolioBalance,
  preparePrivateExecution,
  getRewardsPoints,
  getTokenOHLCV,
  listLimitOrders,
  type NFTItem,
  type PrivacyVerificationPayload,
} from "@/lib/api"
import {
  decimalToU256Parts,
  invokeStarknetCallsFromWallet,
  toHexFelt,
} from "@/lib/onchain-trade"
import { executeHideViaRelayer } from "@/lib/privacy-relayer"
import { useLivePrices } from "@/hooks/use-live-prices"
import { useOrderUpdates, type OrderUpdate } from "@/hooks/use-order-updates"

const tokenCatalog = [
  { symbol: "STRK", name: "StarkNet", icon: "◈", price: 0, change: 0 },
  { symbol: "CAREL", name: "Carel Protocol", icon: "◐", price: 0, change: 0 },
  { symbol: "USDT", name: "Tether", icon: "₮", price: 0, change: 0 },
  { symbol: "USDC", name: "USD Coin", icon: "⭕", price: 0, change: 0 },
]

type TokenItem = (typeof tokenCatalog)[number]

const expiryOptions = [
  { label: "1 day", value: "1d" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
]

const pricePresets = [
  { label: "-5%", value: -5 },
  { label: "-10%", value: -10 },
  { label: "-25%", value: -25 },
  { label: "-50%", value: -50 },
]

const sellPresets = [
  { label: "+5%", value: 5 },
  { label: "+10%", value: 10 },
  { label: "+25%", value: 25 },
  { label: "+50%", value: 50 },
]

type UiOrder = {
  id: string
  type: "buy" | "sell"
  token: string
  fromToken: string
  amount: string
  price: string
  expiry: string
  status: "active" | "filled" | "cancelled"
  createdAt: string
}

type ChartCandle = {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
}

const stableSymbols = new Set(["USDT", "USDC"])
const STARKNET_LIMIT_ORDER_BOOK_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_LIMIT_ORDER_BOOK_ADDRESS ||
  process.env.NEXT_PUBLIC_LIMIT_ORDER_BOOK_ADDRESS ||
  ""

const STARKNET_TOKEN_ADDRESS_MAP: Record<string, string> = {
  CAREL:
    process.env.NEXT_PUBLIC_TOKEN_CAREL_ADDRESS ||
    process.env.NEXT_PUBLIC_CAREL_TOKEN_ADDRESS ||
    "0x1",
  STRK: process.env.NEXT_PUBLIC_TOKEN_STRK_ADDRESS || "0x4",
  ETH: process.env.NEXT_PUBLIC_TOKEN_ETH_ADDRESS || "0x3",
  BTC:
    process.env.NEXT_PUBLIC_TOKEN_BTC_ADDRESS ||
    "0x496bef3ed20371382fbe0ca6a5a64252c5c848f9f1f0cccf8110fc4def912d5",
  WBTC:
    process.env.NEXT_PUBLIC_TOKEN_WBTC_ADDRESS ||
    process.env.NEXT_PUBLIC_TOKEN_BTC_ADDRESS ||
    "0x496bef3ed20371382fbe0ca6a5a64252c5c848f9f1f0cccf8110fc4def912d5",
  USDT: process.env.NEXT_PUBLIC_TOKEN_USDT_ADDRESS || "0x5",
  USDC: process.env.NEXT_PUBLIC_TOKEN_USDC_ADDRESS || "0x6",
}

const TOKEN_DECIMALS: Record<string, number> = {
  CAREL: 18,
  STRK: 18,
  ETH: 18,
  BTC: 8,
  WBTC: 8,
  USDT: 6,
  USDC: 6,
}

const TRADE_PRIVACY_PAYLOAD_KEY = "trade_privacy_garaga_payload_v2"
const DEV_AUTO_GARAGA_PAYLOAD_ENABLED =
  process.env.NODE_ENV !== "production" &&
  (process.env.NEXT_PUBLIC_ENABLE_DEV_GARAGA_AUTOFILL || "false").toLowerCase() === "true"
const STARKNET_ZK_PRIVACY_ROUTER_ADDRESS =
  process.env.NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS ||
  process.env.NEXT_PUBLIC_PRIVACY_ROUTER_ADDRESS ||
  ""
const PRIVATE_ACTION_EXECUTOR_ADDRESS =
  (process.env.NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim()
const HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED =
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED || "false").toLowerCase() ===
    "true" && PRIVATE_ACTION_EXECUTOR_ADDRESS.length > 0
const HIDE_BALANCE_RELAYER_POOL_ENABLED =
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_ENABLED || "false").toLowerCase() === "true" &&
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_LIMIT_ENABLED || "false").toLowerCase() === "true"

const normalizeHexArray = (values?: string[] | null): string[] => {
  if (!Array.isArray(values)) return []
  return values
    .map((value) => (typeof value === "string" ? value.trim() : String(value ?? "").trim()))
    .filter((value) => value.length > 0)
}

const loadTradePrivacyPayload = (): PrivacyVerificationPayload | undefined => {
  if (typeof window === "undefined") return undefined
  try {
    const raw = window.localStorage.getItem(TRADE_PRIVACY_PAYLOAD_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as PrivacyVerificationPayload
    const nullifier = parsed.nullifier?.trim()
    const commitment = parsed.commitment?.trim()
    const proof = normalizeHexArray(parsed.proof)
    const publicInputs = normalizeHexArray(parsed.public_inputs)
    if (!nullifier || !commitment || proof.length === 0 || publicInputs.length === 0) return undefined
    if (
      proof.length === 1 &&
      publicInputs.length === 1 &&
      proof[0]?.toLowerCase() === "0x1" &&
      publicInputs[0]?.toLowerCase() === "0x1"
    ) {
      window.localStorage.removeItem(TRADE_PRIVACY_PAYLOAD_KEY)
      return undefined
    }
    return {
      verifier: (parsed.verifier || "garaga").trim() || "garaga",
      nullifier,
      commitment,
      proof,
      public_inputs: publicInputs,
    }
  } catch {
    return undefined
  }
}

/**
 * Handles `persistTradePrivacyPayload` logic.
 *
 * @param payload - Input used by `persistTradePrivacyPayload` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const persistTradePrivacyPayload = (payload: PrivacyVerificationPayload) => {
  if (typeof window === "undefined") return
  window.localStorage.setItem(TRADE_PRIVACY_PAYLOAD_KEY, JSON.stringify(payload))
  window.dispatchEvent(new Event("trade-privacy-payload-updated"))
}

/**
 * Handles `randomHexFelt` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const randomHexFelt = () => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `0x${hex.replace(/^0+/, "") || "1"}`
}

const createDevTradePrivacyPayload = (): PrivacyVerificationPayload => ({
  verifier: "garaga",
  nullifier: randomHexFelt(),
  commitment: randomHexFelt(),
  proof: ["0x1"],
  public_inputs: ["0x1"],
})

/**
 * Builds inputs required by `buildHideBalancePrivacyCall`.
 *
 * @param payload - Input used by `buildHideBalancePrivacyCall` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const buildHideBalancePrivacyCall = (payload: PrivacyVerificationPayload) => {
  const router = STARKNET_ZK_PRIVACY_ROUTER_ADDRESS.trim()
  if (!router) {
    throw new Error(
      "NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS is not configured. Hide Balance requires privacy router address."
    )
  }
  const nullifier = payload.nullifier?.trim() || ""
  const commitment = payload.commitment?.trim() || ""
  const proof = normalizeHexArray(payload.proof)
  const publicInputs = normalizeHexArray(payload.public_inputs)
  if (!nullifier || !commitment || !proof.length || !publicInputs.length) {
    throw new Error(
      "Hide Balance requires complete Garaga payload (nullifier, commitment, proof, public_inputs)."
    )
  }
  return {
    contractAddress: router,
    entrypoint: "submit_private_action",
    calldata: [nullifier, commitment, String(proof.length), ...proof, String(publicInputs.length), ...publicInputs],
  }
}

/**
 * Parses or transforms values for `formatDateTime`.
 *
 * @param value - Input used by `formatDateTime` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const formatDateTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
}

/**
 * Handles `expiryToSeconds` logic.
 *
 * @param expiry - Input used by `expiryToSeconds` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const expiryToSeconds = (expiry: string) => {
  switch (expiry) {
    case "1d":
      return 24 * 60 * 60
    case "7d":
      return 7 * 24 * 60 * 60
    case "30d":
      return 30 * 24 * 60 * 60
    default:
      return 7 * 24 * 60 * 60
  }
}

/**
 * Builds inputs required by `generateClientOrderId`.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const generateClientOrderId = () => {
  // Starknet felt must be < 251 bits, so use 31 random bytes.
  const bytes = new Uint8Array(31)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
  return `0x${hex}`
}

const CANDLE_BULL = "#00d48a"
const CANDLE_BEAR = "#ff5a6f"

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
    React.useMemo(() => tokenCatalog.map((token) => token.symbol), []),
    { fallbackPrices: { CAREL: 1, USDC: 1, USDT: 1 } }
  )
  const [tokens, setTokens] = React.useState<TokenItem[]>(tokenCatalog)
  const [selectedToken, setSelectedToken] = React.useState(tokens[0])
  const [payToken, setPayToken] = React.useState(
    tokenCatalog.find((token) => token.symbol === "USDT") ?? tokenCatalog[tokenCatalog.length - 1]
  )
  const [receiveToken, setReceiveToken] = React.useState(
    tokenCatalog.find((token) => token.symbol === "USDT") ?? tokenCatalog[tokenCatalog.length - 1]
  )
  const [orderType, setOrderType] = React.useState<"buy" | "sell">("buy")
  const [amount, setAmount] = React.useState("")
  const [price, setPrice] = React.useState("")
  const [expiry, setExpiry] = React.useState(expiryOptions[2].value)
  const [chartModalOpen, setChartModalOpen] = React.useState(false)
  const [chartPeriod, setChartPeriod] = React.useState("24H")
  const [orders, setOrders] = React.useState<UiOrder[]>([])
  const [showConfirmDialog, setShowConfirmDialog] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [submitSuccess, setSubmitSuccess] = React.useState(false)
  const [balanceHidden, setBalanceHidden] = React.useState(false)
  const [hasTradePrivacyPayload, setHasTradePrivacyPayload] = React.useState(false)
  const [isAutoPrivacyProvisioning, setIsAutoPrivacyProvisioning] = React.useState(false)
  const autoPrivacyPayloadPromiseRef = React.useRef<Promise<PrivacyVerificationPayload | undefined> | null>(null)
  const [chartCandles, setChartCandles] = React.useState<ChartCandle[]>([])
  const [activeNftDiscount, setActiveNftDiscount] = React.useState<NFTItem | null>(null)
  const [stakePointsMultiplier, setStakePointsMultiplier] = React.useState(1)
  const [orderBook, setOrderBook] = React.useState<{ bids: Array<{ price: number; amount: number }>; asks: Array<{ price: number; amount: number }> }>({
    bids: [],
    asks: [],
  })
  const starknetProviderHint = React.useMemo<"starknet" | "argentx" | "braavos">(() => {
    if (wallet.provider === "argentx" || wallet.provider === "braavos") {
      return wallet.provider
    }
    return "starknet"
  }, [wallet.provider])

  const refreshTradePrivacyPayload = React.useCallback(() => {
    setHasTradePrivacyPayload(Boolean(loadTradePrivacyPayload()))
  }, [])

  const resolveHideBalancePrivacyPayload = React.useCallback(async (): Promise<PrivacyVerificationPayload | undefined> => {
    if (autoPrivacyPayloadPromiseRef.current) return autoPrivacyPayloadPromiseRef.current

    /**
     * Handles `task` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const task = (async () => {
      if (DEV_AUTO_GARAGA_PAYLOAD_ENABLED) {
        const generated = createDevTradePrivacyPayload()
        persistTradePrivacyPayload(generated)
        setHasTradePrivacyPayload(true)
        return generated
      }

      if (!wallet.isConnected) return undefined

      setIsAutoPrivacyProvisioning(true)
      try {
        const response = await autoSubmitPrivacyAction({
          verifier: "garaga",
          submit_onchain: false,
          tx_context: {
            flow: "limit_order",
            from_token: orderType === "buy" ? payToken.symbol : selectedToken.symbol,
            to_token: orderType === "buy" ? selectedToken.symbol : receiveToken.symbol,
            amount,
            from_network: "starknet",
            to_network: "starknet",
          },
        })
        const payload: PrivacyVerificationPayload = {
          verifier: (response.payload?.verifier || "garaga").trim() || "garaga",
          nullifier: response.payload?.nullifier?.trim(),
          commitment: response.payload?.commitment?.trim(),
          proof: normalizeHexArray(response.payload?.proof),
          public_inputs: normalizeHexArray(response.payload?.public_inputs),
        }
        const proof = normalizeHexArray(payload.proof)
        const publicInputs = normalizeHexArray(payload.public_inputs)
        if (!payload.nullifier || !payload.commitment || !proof.length || !publicInputs.length) {
          throw new Error("Auto Garaga payload is incomplete from backend.")
        }
        if (
          proof.length === 1 &&
          publicInputs.length === 1 &&
          proof[0]?.toLowerCase() === "0x1" &&
          publicInputs[0]?.toLowerCase() === "0x1"
        ) {
          throw new Error("Auto Garaga payload from backend is still dummy (0x1).")
        }
        const normalizedPayload: PrivacyVerificationPayload = {
          verifier: payload.verifier,
          nullifier: payload.nullifier,
          commitment: payload.commitment,
          proof,
          public_inputs: publicInputs,
        }
        persistTradePrivacyPayload(normalizedPayload)
        setHasTradePrivacyPayload(true)
        return normalizedPayload
      } catch (error) {
        notifications.addNotification({
          type: "error",
          title: "Auto Garaga payload failed",
          message: error instanceof Error ? error.message : "Unable to prepare Garaga payload automatically.",
        })
        return undefined
      } finally {
        setIsAutoPrivacyProvisioning(false)
      }
    })()

    autoPrivacyPayloadPromiseRef.current = task
    try {
      return await task
    } finally {
      autoPrivacyPayloadPromiseRef.current = null
    }
  }, [
    amount,
    notifications,
    orderType,
    payToken.symbol,
    receiveToken.symbol,
    selectedToken.symbol,
    wallet.isConnected,
  ])

  React.useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const response = await getPortfolioBalance()
        if (!active) return
        setTokens((prev) =>
          prev.map((token) => {
            const match = response.balances.find((item) => item.token.toUpperCase() === token.symbol)
            if (!match) return token
            const nextPrice = match.amount > 0 ? match.value_usd / match.amount : match.price
            return { ...token, price: nextPrice }
          })
        )
      } catch {
        // keep existing prices
      }
    })()

    return () => {
      active = false
    }
  }, [])

  React.useEffect(() => {
    if (!livePrices || Object.keys(livePrices).length === 0) return
    setTokens((prev) =>
      prev.map((token) => {
        const price = livePrices[token.symbol]
        const change = liveChanges[token.symbol]
        if (!Number.isFinite(price)) return token
        return {
          ...token,
          price,
          change: Number.isFinite(change) ? change : token.change,
        }
      })
    )
  }, [livePrices, liveChanges])

  React.useEffect(() => {
    const fallbackStable = tokens.find((token) => stableSymbols.has(token.symbol)) || tokens[0]
    const nextSelected = tokens.find((token) => token.symbol === selectedToken.symbol) || tokens[0]
    const nextPay = tokens.find((token) => token.symbol === payToken.symbol) || fallbackStable
    const nextReceive =
      tokens.find((token) => token.symbol === receiveToken.symbol) || fallbackStable
    setSelectedToken(nextSelected)
    setPayToken(nextPay)
    setReceiveToken(nextReceive)
  }, [tokens])

  React.useEffect(() => {
    let active = true
    if (!wallet.isConnected) {
      setActiveNftDiscount(null)
      setStakePointsMultiplier(1)
      return
    }

    /**
     * Handles `loadRewardsContext` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const loadRewardsContext = async (force = false) => {
      try {
        const [nfts, rewards] = await Promise.all([
          getOwnedNfts({ force }),
          getRewardsPoints({ force }),
        ])
        if (!active) return
        const now = Math.floor(Date.now() / 1000)
        const usable = nfts
          .filter((nft) => !nft.used && (!nft.expiry || nft.expiry > now))
          .sort((a, b) => (b.discount || 0) - (a.discount || 0))[0]
        setActiveNftDiscount(usable || null)
        const parsedMultiplier = Number(rewards.multiplier)
        setStakePointsMultiplier(
          Number.isFinite(parsedMultiplier) && parsedMultiplier > 0 ? parsedMultiplier : 1
        )
      } catch {
        if (!active) return
        setActiveNftDiscount(null)
        setStakePointsMultiplier(1)
      }
    }

    void loadRewardsContext()
    const timer = window.setInterval(() => {
      void loadRewardsContext(true)
    }, 20_000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [wallet.isConnected, wallet.address, wallet.starknetAddress, wallet.evmAddress, wallet.btcAddress])

  React.useEffect(() => {
    refreshTradePrivacyPayload()
    window.addEventListener("trade-privacy-payload-updated", refreshTradePrivacyPayload)
    return () => {
      window.removeEventListener("trade-privacy-payload-updated", refreshTradePrivacyPayload)
    }
  }, [refreshTradePrivacyPayload])

  /**
   * Handles `intervalForPeriod` logic.
   *
   * @param period - Input used by `intervalForPeriod` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const intervalForPeriod = (period: string) => {
    switch (period) {
      case "5M":
        return { interval: "5m", limit: 72 }
      case "15M":
        return { interval: "15m", limit: 96 }
      case "1H":
        return { interval: "1h", limit: 24 }
      case "24H":
        return { interval: "1h", limit: 24 }
      case "7D":
        return { interval: "1d", limit: 7 }
      case "30D":
        return { interval: "1d", limit: 30 }
      case "1Y":
        return { interval: "1d", limit: 365 }
      default:
        return { interval: "1h", limit: 24 }
    }
  }

  React.useEffect(() => {
    let active = true
    const { interval, limit } = intervalForPeriod(chartPeriod)
    ;(async () => {
      try {
        let response
        try {
          response = await getTokenOHLCV({
            token: selectedToken.symbol,
            interval,
            limit,
            source: "coingecko",
          })
        } catch {
          response = await getTokenOHLCV({
            token: selectedToken.symbol,
            interval,
            limit,
          })
        }
        if (!active) return
        const candles = response.data
          .map((candle) => {
            const open = Number(candle.open)
            const high = Number(candle.high)
            const low = Number(candle.low)
            const close = Number(candle.close)
            const parsedTs = new Date(candle.timestamp).getTime()
            return {
              timestamp: Number.isFinite(parsedTs) ? parsedTs : Date.now(),
              open,
              high,
              low,
              close,
            } as ChartCandle
          })
          .filter(
            (candle) =>
              Number.isFinite(candle.open) &&
              Number.isFinite(candle.high) &&
              Number.isFinite(candle.low) &&
              Number.isFinite(candle.close) &&
              candle.high > 0 &&
              candle.low > 0
          )
        if (candles.length >= 2) {
          const latest = candles[candles.length - 1].close
          const prev = candles[candles.length - 2].close
          const change = prev > 0 ? ((latest - prev) / prev) * 100 : 0
          setTokens((prevTokens) =>
            prevTokens.map((token) =>
              token.symbol === selectedToken.symbol ? { ...token, price: latest, change } : token
            )
          )
          setChartCandles(candles)
        }
      } catch {
        if (!active) return
        setChartCandles([])
      }
    })()

    return () => {
      active = false
    }
  }, [selectedToken.symbol, chartPeriod])

  React.useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const response = await getMarketDepth(selectedToken.symbol, 3)
        if (!active) return
        setOrderBook({ bids: response.bids, asks: response.asks })
      } catch {
        if (!active) return
        setOrderBook({ bids: [], asks: [] })
      }
    })()

    return () => {
      active = false
    }
  }, [selectedToken.symbol])

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
    let active = true
    ;(async () => {
      try {
        const response = await listLimitOrders(1, 10, "active")
        if (!active) return
        const mapped = response.items.map((order) => {
          const isBuy = stableSymbols.has(order.from_token.toUpperCase())
          return {
            id: order.order_id,
            type: isBuy ? "buy" : "sell",
            token: isBuy ? order.to_token : order.from_token,
            fromToken: order.from_token,
            amount: order.amount,
            price: order.price,
            expiry: order.expiry,
            status:
              order.status === 2
                ? "filled"
                : order.status === 3 || order.status === 4
                ? "cancelled"
                : "active",
            createdAt: formatDateTime(order.created_at),
          } as UiOrder
        })
        setOrders(mapped)
      } catch {
        if (!active) return
        setOrders([])
      }
    })()

    return () => {
      active = false
    }
  }, [])

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

  const estimatedTotal = currentPrice * (Number.parseFloat(amount) || 0)
  const amountValue = Number.parseFloat(amount) || 0
  const estimatedUsdValue =
    orderType === "buy"
      ? amountValue
      : amountValue * (Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : marketPrice)
  const activeDiscountPercent = activeNftDiscount?.discount ?? 0
  const discountRate = activeDiscountPercent > 0 ? Math.min(activeDiscountPercent, 100) / 100 : 0
  const normalizedStakeMultiplier =
    Number.isFinite(stakePointsMultiplier) && stakePointsMultiplier > 0 ? stakePointsMultiplier : 1
  const nftPointsMultiplier = 1 + discountRate
  const effectivePointsMultiplier = normalizedStakeMultiplier * nftPointsMultiplier
  const rawLimitFeeUsd = Math.max(0, estimatedUsdValue) * 0.002
  const limitFeeUsd = rawLimitFeeUsd * (1 - discountRate)
  const feeSavedUsd = Math.max(0, rawLimitFeeUsd - limitFeeUsd)
  const basePoints = Math.max(0, estimatedUsdValue) * 12
  const estimatedPoints =
    basePoints > 0 ? Math.floor(basePoints * effectivePointsMultiplier) : 0
  const isBtcBuyComingSoon = orderType === "buy" && selectedToken.symbol === "BTC"

  /**
   * Handles `handleSubmitOrder` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleSubmitOrder = () => {
    setShowConfirmDialog(true)
  }

  /**
   * Handles `confirmOrder` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const confirmOrder = async () => {
    if (isBtcBuyComingSoon) {
      notifications.addNotification({
        type: "info",
        title: "Coming Soon",
        message: "Limit Order BTC Buy is still in final integration.",
      })
      return
    }
    setIsSubmitting(true)
    try {
      const effectiveHideBalance = balanceHidden
      const fromToken = orderType === "buy" ? payToken.symbol : selectedToken.symbol
      const toToken = orderType === "buy" ? selectedToken.symbol : receiveToken.symbol
      if (fromToken.toUpperCase() === toToken.toUpperCase()) {
        throw new Error("Source and destination tokens cannot be the same.")
      }
      const fromTokenAddress = STARKNET_TOKEN_ADDRESS_MAP[fromToken.toUpperCase()]
      const toTokenAddress = STARKNET_TOKEN_ADDRESS_MAP[toToken.toUpperCase()]
      if (!fromTokenAddress || !toTokenAddress) {
        throw new Error("Token pair is not supported for Starknet on-chain limit orders.")
      }
      if (!STARKNET_LIMIT_ORDER_BOOK_ADDRESS) {
        throw new Error(
          "NEXT_PUBLIC_STARKNET_LIMIT_ORDER_BOOK_ADDRESS is not set. Configure the limit order contract address in frontend/.env.local."
        )
      }
      const clientOrderId = generateClientOrderId()
      const [amountLow, amountHigh] = decimalToU256Parts(amount, TOKEN_DECIMALS[fromToken.toUpperCase()] || 18)
      const [priceLow, priceHigh] = decimalToU256Parts(price, 18)
      const expiryTs = Math.floor(Date.now() / 1000) + expiryToSeconds(expiry)
      const resolvedPrivacyPayload = effectiveHideBalance
        ? await resolveHideBalancePrivacyPayload()
        : undefined
      if (effectiveHideBalance && !resolvedPrivacyPayload) {
        throw new Error("Garaga payload is not ready for Hide Balance. Check backend auto-proof config.")
      }

      const createOrderCall = {
        contractAddress: STARKNET_LIMIT_ORDER_BOOK_ADDRESS,
        entrypoint: "create_limit_order",
        calldata: [
          clientOrderId,
          fromTokenAddress,
          toTokenAddress,
          amountLow,
          amountHigh,
          priceLow,
          priceHigh,
          toHexFelt(expiryTs),
        ],
      }
      let payloadForBackend = resolvedPrivacyPayload
      let preparedCalls = [createOrderCall]
      const useRelayerPoolHide = effectiveHideBalance && HIDE_BALANCE_RELAYER_POOL_ENABLED
      if (effectiveHideBalance && resolvedPrivacyPayload && !useRelayerPoolHide) {
        let usedPrivateExecutor = false
        if (HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED) {
          try {
            const preparedPrivate = await preparePrivateExecution({
              verifier: (resolvedPrivacyPayload.verifier || "garaga").trim() || "garaga",
              flow: "limit",
              action_entrypoint: createOrderCall.entrypoint,
              action_calldata: createOrderCall.calldata,
              tx_context: {
                flow: "limit_order",
                from_token: fromToken,
                to_token: toToken,
                amount,
                from_network: "starknet",
                to_network: "starknet",
              },
            })
            payloadForBackend = {
              verifier: (preparedPrivate.payload?.verifier || "garaga").trim() || "garaga",
              nullifier: preparedPrivate.payload?.nullifier?.trim(),
              commitment: preparedPrivate.payload?.commitment?.trim(),
              proof: normalizeHexArray(preparedPrivate.payload?.proof),
              public_inputs: normalizeHexArray(preparedPrivate.payload?.public_inputs),
            }
            persistTradePrivacyPayload(payloadForBackend)
            setHasTradePrivacyPayload(true)
            preparedCalls = preparedPrivate.onchain_calls.map((call) => ({
              contractAddress: call.contract_address,
              entrypoint: call.entrypoint,
              calldata: call.calldata.map((item) => String(item)),
            }))
            usedPrivateExecutor = preparedCalls.length > 0
          } catch (error) {
            notifications.addNotification({
              type: "warning",
              title: "Private executor fallback",
              message:
                error instanceof Error
                  ? `Using legacy privacy call path: ${error.message}`
                  : "Using legacy privacy call path.",
            })
          }
        }
        if (!usedPrivateExecutor) {
          preparedCalls = [buildHideBalancePrivacyCall(resolvedPrivacyPayload), createOrderCall]
        }
      }
      let onchainTxHash: string | undefined
      if (!useRelayerPoolHide) {
        notifications.addNotification({
          type: "info",
          title: "Wallet signature required",
          message: "Confirm create limit order transaction in your Starknet wallet.",
        })
        onchainTxHash = await invokeStarknetCallsFromWallet(
          preparedCalls,
          starknetProviderHint
        )
        notifications.addNotification({
          type: "info",
          title: "Order pending",
          message: `Order ${orderType === "buy" ? "buy" : "sell"} ${amount} ${selectedToken.symbol} submitted on-chain.`,
          txHash: onchainTxHash,
          txNetwork: "starknet",
        })
      } else {
        notifications.addNotification({
          type: "info",
          title: "Submitting private order",
          message: "Submitting hide-mode limit order via Starknet relayer pool.",
        })
        const relayed = await executeHideViaRelayer({
          flow: "limit",
          actionCall: createOrderCall,
          tokenAddress: fromTokenAddress,
          amount,
          tokenDecimals: TOKEN_DECIMALS[fromToken.toUpperCase()] || 18,
          providerHint: starknetProviderHint,
          verifier: (payloadForBackend?.verifier || "garaga").trim() || "garaga",
          txContext: {
            flow: "limit_order",
            from_token: fromToken,
            to_token: toToken,
            amount,
            from_network: "starknet",
            to_network: "starknet",
          },
        })
        onchainTxHash = relayed.txHash
        payloadForBackend = relayed.privacyPayload
        persistTradePrivacyPayload(payloadForBackend)
        setHasTradePrivacyPayload(true)
      }
      let response: Awaited<ReturnType<typeof createLimitOrder>>
      try {
        response = await createLimitOrder({
          from_token: fromToken,
          to_token: toToken,
          amount,
          price,
          expiry,
          recipient: null,
          client_order_id: clientOrderId,
          onchain_tx_hash: onchainTxHash,
          hide_balance: effectiveHideBalance,
          privacy: effectiveHideBalance ? payloadForBackend : undefined,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "")
        if (useRelayerPoolHide) {
          throw new Error(
            `Hide relayer unavailable. Wallet fallback is disabled so order details never leak in explorer. Detail: ${message}`
          )
        }
        throw error
      }
      if (response.privacy_tx_hash) {
        notifications.addNotification({
          type: "info",
          title: "Garaga verification submitted",
          message: `Privacy tx ${response.privacy_tx_hash.slice(0, 12)}... was submitted on Starknet.`,
          txHash: response.privacy_tx_hash,
          txNetwork: "starknet",
        })
      }

      const newOrder: UiOrder = {
        id: response.order_id,
        type: orderType,
        token: selectedToken.symbol,
        fromToken,
        amount,
        price,
        expiry,
        status: "active",
        createdAt: "Just now",
      }

      setOrders((prev) => [newOrder, ...prev])
      setSubmitSuccess(true)
      notifications.addNotification({
        type: "success",
        title: "Order created",
        message: `Order ${orderType === "buy" ? "buy" : "sell"} ${amount} ${selectedToken.symbol} created successfully`,
        txHash: onchainTxHash || response.privacy_tx_hash,
        txNetwork: "starknet",
      })
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Failed to create order",
        message: error instanceof Error ? error.message : "Unexpected error while creating order",
      })
    } finally {
      setIsSubmitting(false)
      setTimeout(() => {
        setShowConfirmDialog(false)
        setSubmitSuccess(false)
        setAmount("")
        setPrice("")
      }, 1500)
    }
  }

  /**
   * Runs `cancelOrder` and handles related side effects.
   *
   * @param orderId - Input used by `cancelOrder` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const cancelOrder = async (orderId: string) => {
    try {
      const effectiveHideBalance = balanceHidden
      const useRelayerPoolHide = effectiveHideBalance && HIDE_BALANCE_RELAYER_POOL_ENABLED
      const targetOrder = orders.find((order) => order.id === orderId)
      if (!STARKNET_LIMIT_ORDER_BOOK_ADDRESS) {
        throw new Error(
          "NEXT_PUBLIC_STARKNET_LIMIT_ORDER_BOOK_ADDRESS is not set. Configure the limit order contract address in frontend/.env.local."
        )
      }
      const resolvedPrivacyPayload = effectiveHideBalance
        ? await resolveHideBalancePrivacyPayload()
        : undefined
      if (effectiveHideBalance && !resolvedPrivacyPayload) {
        throw new Error("Garaga payload is not ready for Hide Balance. Check backend auto-proof config.")
      }
      const cancelCall = {
        contractAddress: STARKNET_LIMIT_ORDER_BOOK_ADDRESS,
        entrypoint: "cancel_limit_order",
        calldata: [orderId],
      }
      let payloadForBackend = resolvedPrivacyPayload
      let preparedCalls = [cancelCall]
      if (effectiveHideBalance && resolvedPrivacyPayload && !useRelayerPoolHide) {
        let usedPrivateExecutor = false
        if (HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED) {
          try {
            const preparedPrivate = await preparePrivateExecution({
              verifier: (resolvedPrivacyPayload.verifier || "garaga").trim() || "garaga",
              flow: "limit",
              action_entrypoint: cancelCall.entrypoint,
              action_calldata: cancelCall.calldata,
              tx_context: {
                flow: "limit_order_cancel",
                from_network: "starknet",
                to_network: "starknet",
              },
            })
            payloadForBackend = {
              verifier: (preparedPrivate.payload?.verifier || "garaga").trim() || "garaga",
              nullifier: preparedPrivate.payload?.nullifier?.trim(),
              commitment: preparedPrivate.payload?.commitment?.trim(),
              proof: normalizeHexArray(preparedPrivate.payload?.proof),
              public_inputs: normalizeHexArray(preparedPrivate.payload?.public_inputs),
            }
            persistTradePrivacyPayload(payloadForBackend)
            setHasTradePrivacyPayload(true)
            preparedCalls = preparedPrivate.onchain_calls.map((call) => ({
              contractAddress: call.contract_address,
              entrypoint: call.entrypoint,
              calldata: call.calldata.map((item) => String(item)),
            }))
            usedPrivateExecutor = preparedCalls.length > 0
          } catch (error) {
            notifications.addNotification({
              type: "warning",
              title: "Private executor fallback",
              message:
                error instanceof Error
                  ? `Using legacy privacy call path: ${error.message}`
                  : "Using legacy privacy call path.",
            })
          }
        }
        if (!usedPrivateExecutor) {
          preparedCalls = [buildHideBalancePrivacyCall(resolvedPrivacyPayload), cancelCall]
        }
      }
      let onchainTxHash: string | undefined
      if (!useRelayerPoolHide) {
        notifications.addNotification({
          type: "info",
          title: "Wallet signature required",
          message: "Confirm cancel limit order transaction in your Starknet wallet.",
        })
        onchainTxHash = await invokeStarknetCallsFromWallet(
          preparedCalls,
          starknetProviderHint
        )
      } else {
        notifications.addNotification({
          type: "info",
          title: "Submitting private cancel",
          message: "Submitting hide-mode cancel via Starknet relayer pool.",
        })
        const cancelTokenSymbol = (targetOrder?.fromToken || targetOrder?.token || payToken.symbol).toUpperCase()
        const cancelTokenAddress = STARKNET_TOKEN_ADDRESS_MAP[cancelTokenSymbol]
        if (!cancelTokenAddress) {
          throw new Error(
            `Token address for ${cancelTokenSymbol} is not configured for hide-mode relayer execution.`
          )
        }
        const cancelAmount = String(targetOrder?.amount || "1")
        const relayed = await executeHideViaRelayer({
          flow: "limit",
          actionCall: cancelCall,
          tokenAddress: cancelTokenAddress,
          amount: cancelAmount,
          tokenDecimals: TOKEN_DECIMALS[cancelTokenSymbol] || 18,
          providerHint: starknetProviderHint,
          verifier: (payloadForBackend?.verifier || "garaga").trim() || "garaga",
          txContext: {
            flow: "limit_order_cancel",
            from_network: "starknet",
            to_network: "starknet",
          },
        })
        onchainTxHash = relayed.txHash
        payloadForBackend = relayed.privacyPayload
        persistTradePrivacyPayload(payloadForBackend)
        setHasTradePrivacyPayload(true)
      }
      try {
        await cancelLimitOrder(orderId, {
          onchain_tx_hash: onchainTxHash,
          hide_balance: effectiveHideBalance,
          privacy: effectiveHideBalance ? payloadForBackend : undefined,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "")
        if (useRelayerPoolHide) {
          throw new Error(
            `Hide relayer unavailable. Wallet fallback is disabled so order details never leak in explorer. Detail: ${message}`
          )
        }
        throw error
      }
      setOrders((prev) => prev.filter((order) => order.id !== orderId))
      notifications.addNotification({
        type: "success",
        title: "Order cancelled",
        message: "Order cancelled successfully",
        txHash: onchainTxHash,
        txNetwork: "starknet",
      })
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Failed to cancel",
        message: error instanceof Error ? error.message : "Unable to cancel order",
      })
    }
  }

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
                <svg className="w-full h-full" viewBox="0 0 800 200" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="chartGradientLimit" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {chartCandles.length > 1 ? (
                    <>
                      {(() => {
                        const maxVal = Math.max(...chartCandles.map((candle) => candle.high))
                        const minVal = Math.min(...chartCandles.map((candle) => candle.low))
                        const range = maxVal - minVal || 1
                        const chartHeight = 200
                        const paddingTop = 8
                        const paddingBottom = 8
                        const drawableHeight = chartHeight - paddingTop - paddingBottom
                        /**
                         * Handles `yFor` logic.
                         *
                         * @param price - Input used by `yFor` to compute state, payload, or request behavior.
                         *
                         * @returns Result consumed by caller flow, UI state updates, or async chaining.
                         * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
                         */
                        const yFor = (price: number) =>
                          chartHeight -
                          paddingBottom -
                          ((price - minVal) / range) * drawableHeight
                        const candleStep = 800 / chartCandles.length
                        const candleWidth = Math.max(2, candleStep * 0.55)

                        return chartCandles.map((candle, idx) => {
                          const x = idx * candleStep + candleStep / 2
                          const openY = yFor(candle.open)
                          const closeY = yFor(candle.close)
                          const highY = yFor(candle.high)
                          const lowY = yFor(candle.low)
                          const bodyTop = Math.min(openY, closeY)
                          const bodyHeight = Math.max(Math.abs(openY - closeY), 1)
                          const isBullish = candle.close >= candle.open
                          const color = isBullish ? CANDLE_BULL : CANDLE_BEAR

                          return (
                            <g key={`${candle.timestamp}-${idx}`}>
                              <line
                                x1={x}
                                y1={highY}
                                x2={x}
                                y2={lowY}
                                stroke={color}
                                strokeWidth="1"
                              />
                              <rect
                                x={x - candleWidth / 2}
                                y={bodyTop}
                                width={candleWidth}
                                height={bodyHeight}
                                fill={color}
                                opacity="0.95"
                              />
                            </g>
                          )
                        })
                      })()}
                    </>
                  ) : null}
                  {/* Price line indicator */}
                  {currentPrice > 0 && marketPrice > 0 && (
                    <line
                      x1="0"
                      y1={200 - (currentPrice / marketPrice) * 100}
                      x2="800"
                      y2={200 - (currentPrice / marketPrice) * 100}
                      stroke="hsl(var(--secondary))"
                      strokeWidth="1"
                      strokeDasharray="5,5"
                    />
                  )}
                </svg>
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
                        <span className="text-foreground">
                          {order.type === "buy" ? "BUY" : "SELL"} {order.amount} {order.token}
                        </span>
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
                      {pricePresets.map((preset) => (
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
                        {tokens.filter(t => t.symbol === "USDT" || t.symbol === "USDC").map((token) => (
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
                      {expiryOptions.map((option) => (
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
                      <p className="text-[11px] text-muted-foreground">
                        {hasTradePrivacyPayload
                          ? "Garaga payload is ready."
                          : isAutoPrivacyProvisioning
                          ? "Preparing Garaga payload..."
                          : "Garaga payload will be auto-prepared on submit."}
                      </p>
                    )}
                  </div>

                  {/* Submit Button */}
                  <Button 
                    onClick={handleSubmitOrder}
                    disabled={!price || !amount || isBtcBuyComingSoon || isAutoPrivacyProvisioning}
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
                      {sellPresets.map((preset) => (
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
                        {tokens.filter(t => t.symbol === "USDT" || t.symbol === "USDC").map((token) => (
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
                      {expiryOptions.map((option) => (
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
                      <p className="text-[11px] text-muted-foreground">
                        {hasTradePrivacyPayload
                          ? "Garaga payload is ready."
                          : isAutoPrivacyProvisioning
                          ? "Preparing Garaga payload..."
                          : "Garaga payload will be auto-prepared on submit."}
                      </p>
                    )}
                  </div>

                  {/* Submit Button */}
                  <Button 
                    onClick={handleSubmitOrder}
                    disabled={!price || !amount || isAutoPrivacyProvisioning}
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

      {/* Full Chart Modal */}
      <Dialog open={chartModalOpen} onOpenChange={setChartModalOpen}>
        <DialogContent className="max-w-4xl glass-strong border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-xl">{selectedToken.icon}</span>
              {selectedToken.symbol}/USD
            </DialogTitle>
          </DialogHeader>
          <div className="h-96 rounded-xl bg-surface/30 relative overflow-hidden">
            <svg className="w-full h-full" viewBox="0 0 800 300" preserveAspectRatio="none">
              <defs>
                <linearGradient id="chartGradientFull" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                </linearGradient>
              </defs>
              {chartCandles.length > 1 ? (
                <>
                  {(() => {
                    const maxVal = Math.max(...chartCandles.map((candle) => candle.high))
                    const minVal = Math.min(...chartCandles.map((candle) => candle.low))
                    const range = maxVal - minVal || 1
                    const chartHeight = 300
                    const paddingTop = 10
                    const paddingBottom = 10
                    const drawableHeight = chartHeight - paddingTop - paddingBottom
                    /**
                     * Handles `yFor` logic.
                     *
                     * @param price - Input used by `yFor` to compute state, payload, or request behavior.
                     *
                     * @returns Result consumed by caller flow, UI state updates, or async chaining.
                     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
                     */
                    const yFor = (price: number) =>
                      chartHeight -
                      paddingBottom -
                      ((price - minVal) / range) * drawableHeight
                    const candleStep = 800 / chartCandles.length
                    const candleWidth = Math.max(2, candleStep * 0.55)

                    return chartCandles.map((candle, idx) => {
                      const x = idx * candleStep + candleStep / 2
                      const openY = yFor(candle.open)
                      const closeY = yFor(candle.close)
                      const highY = yFor(candle.high)
                      const lowY = yFor(candle.low)
                      const bodyTop = Math.min(openY, closeY)
                      const bodyHeight = Math.max(Math.abs(openY - closeY), 1)
                      const isBullish = candle.close >= candle.open
                      const color = isBullish ? CANDLE_BULL : CANDLE_BEAR

                      return (
                        <g key={`${candle.timestamp}-${idx}`}>
                          <line
                            x1={x}
                            y1={highY}
                            x2={x}
                            y2={lowY}
                            stroke={color}
                            strokeWidth="1"
                          />
                          <rect
                            x={x - candleWidth / 2}
                            y={bodyTop}
                            width={candleWidth}
                            height={bodyHeight}
                            fill={color}
                            opacity="0.95"
                          />
                        </g>
                      )
                    })
                  })()}
                </>
              ) : null}
            </svg>
            {chartCandles.length <= 1 && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                No price data
              </div>
            )}
          </div>
          <div className="flex justify-center gap-2">
            {["5M", "15M", "1H", "24H", "7D", "30D", "1Y"].map((period) => (
              <button
                key={period}
                onClick={() => setChartPeriod(period)}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                  chartPeriod === period
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface"
                )}
              >
                {period}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm Order Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="max-w-md glass-strong border-border">
          <DialogHeader>
            <DialogTitle>Confirm Order</DialogTitle>
          </DialogHeader>
          
          {submitSuccess ? (
            <div className="py-8 text-center">
              <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
                <Check className="h-8 w-8 text-success" />
              </div>
              <p className="text-lg font-medium text-foreground">Order Created Successfully!</p>
              <p className="text-sm text-muted-foreground mt-2">Your order will be executed when target price is reached</p>
            </div>
          ) : (
            <>
              <div className="space-y-4 py-4">
                <div className="p-4 rounded-xl bg-surface/50 border border-border">
                  <div className="flex justify-between mb-2">
                    <span className="text-muted-foreground">Type</span>
                    <span className={cn(
                      "font-medium",
                      orderType === "buy" ? "text-success" : "text-destructive"
                    )}>
                      {orderType === "buy" ? "Buy" : "Sell"}
                    </span>
                  </div>
                  <div className="flex justify-between mb-2">
                    <span className="text-muted-foreground">Token</span>
                    <span className="font-medium text-foreground">{selectedToken.symbol}</span>
                  </div>
                  <div className="flex justify-between mb-2">
                    <span className="text-muted-foreground">Target Price</span>
                    <span className="font-medium text-foreground">${currentPrice.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between mb-2">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-medium text-foreground">{amount} {orderType === "buy" ? payToken.symbol : selectedToken.symbol}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expiry</span>
                    <span className="font-medium text-foreground">{expiryOptions.find(e => e.value === expiry)?.label}</span>
                  </div>
                  <div className="flex justify-between mt-2">
                    <span className="text-muted-foreground">Hide Balance</span>
                    <span className={cn("font-medium", balanceHidden ? "text-primary" : "text-muted-foreground")}>
                      {balanceHidden ? "ON" : "OFF"}
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-secondary/10 border border-secondary/20">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-secondary flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-foreground">
                      This order is testnet-only and does not use real funds
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setShowConfirmDialog(false)}
                  className="flex-1"
                >
                  Batal
                </Button>
                <Button
                  onClick={confirmOrder}
                  disabled={isSubmitting}
                  className={cn(
                    "flex-1",
                    orderType === "buy" ? "bg-success hover:bg-success/90" : "bg-destructive hover:bg-destructive/90"
                  )}
                >
                  {isSubmitting ? "Processing..." : "Confirm"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
