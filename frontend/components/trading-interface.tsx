"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import { useNotifications } from "@/hooks/use-notifications"
import { useWallet } from "@/hooks/use-wallet"
import { useLivePrices } from "@/hooks/use-live-prices"
import {
  autoSubmitPrivacyAction,
  executeBridge,
  executeSwap,
  getBridgeQuote,
  getGardenOrderInstantRefundHash,
  getGardenOrderById,
  getOwnedNfts,
  getPortfolioBalance,
  preparePrivateExecution,
  getRewardsPoints,
  getSwapQuote,
  type NFTItem,
  type PrivacyVerificationPayload,
} from "@/lib/api"
import {
  bigintWeiToUnitNumber,
  decimalToU256Parts,
  estimateEvmNetworkFeeWei,
  estimateStarkgateDepositFeeWei,
  invokeStarknetCallsFromWallet,
  invokeStarknetCallFromWallet,
  parseEstimatedMinutes,
  providerIdToFeltHex,
  getConnectedEvmAddressFromWallet,
  sendEvmTransactionFromWallet,
  sendEvmStarkgateEthDepositFromWallet,
  toHexFelt,
  unitNumberToScaledBigInt,
} from "@/lib/onchain-trade"
import { executeHideViaRelayer } from "@/lib/privacy-relayer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { 
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { 
  ArrowDownUp, ChevronDown, Clock, Zap, Shield, Settings2, Check, Loader2, X, 
  Eye, EyeOff, ChevronUp, Info, Gift, Sparkles
} from "lucide-react"

type QuoteState = {
  type: "swap" | "bridge"
  toAmount: string
  fee: number
  feeUnit?: "token" | "usd"
  protocolFee?: number
  networkFee?: number
  mevFee?: number
  estimatedTime: string
  priceImpact?: string
  provider?: string
  normalizedByLivePrice?: boolean
  bridgeSourceAmount?: number
  bridgeConvertedAmount?: number
  onchainCalls?: Array<{
    contractAddress: string
    entrypoint: string
    calldata: string[]
  }>
}

type QuoteCacheEntry = {
  expiresAt: number
  quote: QuoteState
  toAmount: string
  quoteError: string | null
}

type PendingBtcDepositState = {
  bridgeId: string
  depositAddress: string
  amountSats: number
  destinationChain: string
  status?: string
  txHash?: string | null
  sourceInitiateTxHash?: string | null
  destinationInitiateTxHash?: string | null
  destinationRedeemTxHash?: string | null
  refundTxHash?: string | null
  instantRefundTx?: string | null
  instantRefundHash?: string | null
  lastUpdatedAt?: number
}

type GardenOrderProgress = {
  status: string
  sourceInitiateTxHash: string
  destinationInitiateTxHash: string
  destinationRedeemTxHash: string
  sourceRefundTxHash: string
  destinationRefundTxHash: string
  instantRefundTx: string
  isCompleted: boolean
  isRefunded: boolean
  isExpired: boolean
  isRefundable: boolean
}

const TradePreviewDialog = dynamic(
  () => import("@/components/trade-preview-dialog").then((mod) => mod.TradePreviewDialog),
  { ssr: false }
)

const tokenCatalog = [
  { symbol: "BTC", name: "Bitcoin", icon: "₿", price: 0, network: "Bitcoin Testnet" },
  { symbol: "ETH", name: "Ethereum", icon: "Ξ", price: 0, network: "Ethereum Sepolia" },
  { symbol: "STRK", name: "StarkNet", icon: "◈", price: 0, network: "Starknet Sepolia" },
  { symbol: "CAREL", name: "Carel Protocol", icon: "◇", price: 0, network: "Starknet Sepolia" },
  { symbol: "USDC", name: "USD Coin", icon: "$", price: 0, network: "Starknet Sepolia" },
  { symbol: "USDT", name: "Tether", icon: "₮", price: 0, network: "Starknet Sepolia" },
  { symbol: "WBTC", name: "Wrapped BTC", icon: "₿", price: 0, network: "Starknet Sepolia" },
]

const slippagePresets = ["0.1", "0.3", "0.5", "1.0"]
const MEV_FEE_RATE = 0.01
const STARKNET_STRK_GAS_RESERVE = 0.02
const QUOTE_CACHE_TTL_MS = 20_000
const MAX_QUOTE_CACHE_ENTRIES = 120
const TRADE_PRIVACY_PAYLOAD_KEY = "trade_privacy_garaga_payload_v2"
const DEV_AUTO_GARAGA_PAYLOAD_ENABLED =
  process.env.NODE_ENV !== "production" &&
  (process.env.NEXT_PUBLIC_ENABLE_DEV_GARAGA_AUTOFILL || "false").toLowerCase() === "true"
const HIDE_BALANCE_FALLBACK_TO_PUBLIC_ENABLED =
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_FALLBACK_TO_PUBLIC || "false").toLowerCase() === "true"
const PRIVATE_ACTION_EXECUTOR_ADDRESS =
  (process.env.NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim()
const HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED =
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED || "false").toLowerCase() ===
    "true" && PRIVATE_ACTION_EXECUTOR_ADDRESS.length > 0
const HIDE_BALANCE_RELAYER_POOL_ENABLED =
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_ENABLED || "false").toLowerCase() === "true"
const HIDE_BALANCE_EXECUTOR_KIND = (
  process.env.NEXT_PUBLIC_HIDE_BALANCE_EXECUTOR_KIND || ""
)
  .trim()
  .toLowerCase()
const HIDE_BALANCE_SHIELDED_POOL_V2 =
  HIDE_BALANCE_EXECUTOR_KIND === "shielded_pool_v2" ||
  HIDE_BALANCE_EXECUTOR_KIND === "shielded-v2" ||
  HIDE_BALANCE_EXECUTOR_KIND === "v2"
const HIDE_BALANCE_SHIELDED_POOL_V3 =
  HIDE_BALANCE_EXECUTOR_KIND === "shielded_pool_v3" ||
  HIDE_BALANCE_EXECUTOR_KIND === "shielded-v3" ||
  HIDE_BALANCE_EXECUTOR_KIND === "v3"
const HIDE_BALANCE_SHIELDED_POOL = HIDE_BALANCE_SHIELDED_POOL_V2 || HIDE_BALANCE_SHIELDED_POOL_V3
const HIDE_BALANCE_MIN_NOTE_AGE_SECS = Number.parseInt(
  process.env.NEXT_PUBLIC_HIDE_BALANCE_MIN_NOTE_AGE_SECS || "3600",
  10
)
const MIN_WAIT_MS =
  (Number.isFinite(HIDE_BALANCE_MIN_NOTE_AGE_SECS) && HIDE_BALANCE_MIN_NOTE_AGE_SECS > 0
    ? HIDE_BALANCE_MIN_NOTE_AGE_SECS
    : 3600) * 1000
const HIDE_STRK_DENOM_OPTIONS = [
  { id: "1", amount: "1" },
  { id: "5", amount: "5" },
  { id: "10", amount: "10" },
  { id: "50", amount: "50" },
  { id: "100", amount: "100" },
] as const
const BRIDGE_TO_STRK_DISABLED_MESSAGE =
  "Bridge to STRK is currently disabled. Use Starknet L2 Swap for STRK pairs."
const UNSUPPORTED_BRIDGE_PAIR_MESSAGE =
  "Bridge pair is not supported on current testnet routes. Supported pairs: ETH↔BTC, BTC↔WBTC, and ETH↔WBTC (Ethereum↔Starknet)."

const CAREL_PROTOCOL_ADDRESS = process.env.NEXT_PUBLIC_CAREL_PROTOCOL_ADDRESS || ""
const STARKNET_SWAP_CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_SWAP_CONTRACT_ADDRESS ||
  process.env.NEXT_PUBLIC_CAREL_PROTOCOL_ADDRESS ||
  ""
const STARKNET_BRIDGE_AGGREGATOR_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_BRIDGE_AGGREGATOR_ADDRESS ||
  ""
const STARKNET_ZK_PRIVACY_ROUTER_ADDRESS =
  process.env.NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS ||
  process.env.NEXT_PUBLIC_PRIVACY_ROUTER_ADDRESS ||
  ""
const STARKGATE_ETH_BRIDGE_ADDRESS =
  process.env.NEXT_PUBLIC_STARKGATE_ETH_BRIDGE_ADDRESS ||
  "0x8453FC6Cd1bCfE8D4dFC069C400B433054d47bDc"
const STARKGATE_ETH_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_STARKGATE_ETH_TOKEN_ADDRESS ||
  "0x0000000000000000000000000000000000455448"
const GARDEN_STARKNET_APPROVE_SELECTOR =
  "0x219209e083275171774dab1df80982e9df2096516f06319c5c6d71ae0a8480c"
const GARDEN_STARKNET_INITIATE_SELECTOR =
  "0x2aed25fcd0101fcece997d93f9d0643dfa3fbd4118cae16bf7d6cd533577c28"
const BTC_TESTNET_EXPLORER_BASE_URL =
  process.env.NEXT_PUBLIC_BTC_TESTNET_EXPLORER_URL || "https://mempool.space/testnet4"
const GARDEN_ORDER_EXPLORER_BASE_URL =
  process.env.NEXT_PUBLIC_GARDEN_ORDER_EXPLORER_URL || "https://testnet-explorer.garden.finance/order"
const BTC_TESTNET_FAUCET_URL =
  process.env.NEXT_PUBLIC_BTC_TESTNET_FAUCET_URL || "https://testnet4.info/"
const BTC_VAULT_ADDRESS = (process.env.NEXT_PUBLIC_BTC_VAULT_ADDRESS || "").trim()

const STARKNET_TOKEN_ADDRESS: Record<string, string> = {
  CAREL:
    process.env.NEXT_PUBLIC_TOKEN_CAREL_ADDRESS ||
    "0x0517f60f4ec4e1b2b748f0f642dfdcb32c0ddc893f777f2b595a4e4f6df51545",
  BTC:
    process.env.NEXT_PUBLIC_TOKEN_BTC_ADDRESS ||
    "",
  WBTC:
    process.env.NEXT_PUBLIC_TOKEN_WBTC_ADDRESS ||
    process.env.NEXT_PUBLIC_TOKEN_BTC_ADDRESS ||
    "",
  ETH: process.env.NEXT_PUBLIC_TOKEN_ETH_ADDRESS || "0x3",
  STRK:
    process.env.NEXT_PUBLIC_TOKEN_STRK_ADDRESS ||
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  USDT: process.env.NEXT_PUBLIC_TOKEN_USDT_ADDRESS || "0x5",
  USDC: process.env.NEXT_PUBLIC_TOKEN_USDC_ADDRESS || "0x6",
}

const TOKEN_DECIMALS: Record<string, number> = {
  BTC: 8,
  WBTC: 8,
  USDT: 6,
  USDC: 6,
  ETH: 18,
  STRK: 18,
  CAREL: 18,
}
const U256_MAX_LOW_HEX = "0xffffffffffffffffffffffffffffffff"
const U256_MAX_HIGH_HEX = "0xffffffffffffffffffffffffffffffff"

/**
 * Handles `chainFromNetwork` logic.
 *
 * @param network - Input used by `chainFromNetwork` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const chainFromNetwork = (network: string) => {
  const key = network.trim().toLowerCase()
  if (key.includes("bitcoin")) return "bitcoin"
  if (key.includes("ethereum")) return "ethereum"
  if (key.includes("starknet")) return "starknet"
  return key
}

/**
 * Checks conditions for `isBridgeToStrkDisabledRoute`.
 *
 * @param fromChain - Input used by `isBridgeToStrkDisabledRoute` to compute state, payload, or request behavior.
 * @param toChain - Input used by `isBridgeToStrkDisabledRoute` to compute state, payload, or request behavior.
 * @param toSymbol - Input used by `isBridgeToStrkDisabledRoute` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const isBridgeToStrkDisabledRoute = (fromChain: string, toChain: string, toSymbol: string) =>
  fromChain !== "starknet" && toChain === "starknet" && toSymbol.trim().toUpperCase() === "STRK"

const isBridgePairSupportedForCurrentRoutes = (
  fromChain: string,
  toChain: string,
  fromSymbol: string,
  toSymbol: string
) => {
  const from = fromSymbol.trim().toUpperCase()
  const to = toSymbol.trim().toUpperCase()
  return (
    (fromChain === "ethereum" && toChain === "bitcoin" && from === "ETH" && to === "BTC") ||
    (fromChain === "bitcoin" && toChain === "ethereum" && from === "BTC" && to === "ETH") ||
    (fromChain === "bitcoin" && toChain === "starknet" && from === "BTC" && to === "WBTC") ||
    (fromChain === "starknet" && toChain === "bitcoin" && from === "WBTC" && to === "BTC") ||
    (fromChain === "ethereum" && toChain === "starknet" && from === "ETH" && to === "WBTC") ||
    (fromChain === "starknet" && toChain === "ethereum" && from === "WBTC" && to === "ETH")
  )
}

const convertAmountByUsdPrice = (
  amount: number,
  fromPrice: number,
  toPrice: number
): number | null => {
  if (!Number.isFinite(amount) || amount <= 0) return null
  if (!Number.isFinite(fromPrice) || fromPrice <= 0) return null
  if (!Number.isFinite(toPrice) || toPrice <= 0) return null
  return (amount * fromPrice) / toPrice
}

/**
 * Parses or transforms values for `normalizeFeltAddress`.
 *
 * @param value - Input used by `normalizeFeltAddress` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const normalizeFeltAddress = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (!trimmed.startsWith("0x")) return trimmed.toLowerCase()
  try {
    return `0x${BigInt(trimmed).toString(16)}`
  } catch {
    return trimmed.toLowerCase()
  }
}

const normalizeHexArray = (value: unknown): string[] => {
  if (typeof value === "string") {
    return value
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  }
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
}

const loadTradePrivacyPayload = (): PrivacyVerificationPayload | undefined => {
  if (typeof window === "undefined") return undefined
  const raw = window.localStorage.getItem(TRADE_PRIVACY_PAYLOAD_KEY)
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as PrivacyVerificationPayload & {
      nullifiers?: unknown
      commitments?: unknown
    }
    const proof = normalizeHexArray(parsed.proof)
    const publicInputs = normalizeHexArray(parsed.public_inputs)
    if (!proof.length || !publicInputs.length) return undefined
    const nullifierCandidates = normalizeHexArray(parsed.nullifiers)
    const commitmentCandidates = normalizeHexArray(parsed.commitments)
    const nullifier = parsed.nullifier?.trim() || nullifierCandidates[0] || undefined
    const commitment = parsed.commitment?.trim() || commitmentCandidates[0] || undefined
    const isLikelyMockPayload =
      proof.length === 1 &&
      publicInputs.length === 1 &&
      proof[0]?.toLowerCase() === "0x1" &&
      publicInputs[0]?.toLowerCase() === "0x1"
    if (isLikelyMockPayload) {
      // Drop legacy/dev mock payload so hide-balance requires real proof input.
      window.localStorage.removeItem(TRADE_PRIVACY_PAYLOAD_KEY)
      return undefined
    }
    return {
      verifier: (parsed.verifier || "garaga").trim() || "garaga",
      note_version:
        typeof parsed.note_version === "string" && parsed.note_version.trim().length > 0
          ? parsed.note_version.trim()
          : undefined,
      root:
        typeof parsed.root === "string" && parsed.root.trim().length > 0
          ? parsed.root.trim()
          : undefined,
      nullifier,
      commitment,
      recipient:
        typeof parsed.recipient === "string" && parsed.recipient.trim().length > 0
          ? parsed.recipient.trim()
          : undefined,
      note_commitment:
        typeof parsed.note_commitment === "string" && parsed.note_commitment.trim().length > 0
          ? parsed.note_commitment.trim()
          : undefined,
      denom_id:
        typeof parsed.denom_id === "string" && parsed.denom_id.trim().length > 0
          ? parsed.denom_id.trim()
          : undefined,
      spendable_at_unix:
        typeof parsed.spendable_at_unix === "number" &&
        Number.isFinite(parsed.spendable_at_unix) &&
        parsed.spendable_at_unix > 0
          ? Math.floor(parsed.spendable_at_unix)
          : undefined,
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
  const normalizedPayload: PrivacyVerificationPayload = { ...payload }
  if (
    HIDE_BALANCE_SHIELDED_POOL_V3 &&
    normalizedPayload.note_version?.trim().toLowerCase() === "v3" &&
    typeof normalizedPayload.spendable_at_unix !== "number"
  ) {
    normalizedPayload.spendable_at_unix = Math.floor((Date.now() + MIN_WAIT_MS) / 1000)
  }
  window.localStorage.setItem(TRADE_PRIVACY_PAYLOAD_KEY, JSON.stringify(normalizedPayload))
  window.dispatchEvent(new Event("trade-privacy-payload-updated"))
}

/**
 * Updates state for `clearTradePrivacyPayload`.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const clearTradePrivacyPayload = () => {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(TRADE_PRIVACY_PAYLOAD_KEY)
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
  const cryptoApi =
    typeof globalThis !== "undefined" && "crypto" in globalThis ? globalThis.crypto : undefined
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes)
  } else {
    const seed = `${Date.now()}-${Math.random()}`
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = seed.charCodeAt(i % seed.length) & 0xff
    }
  }
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  const normalized = hex.replace(/^0+/, "") || "1"
  return `0x${normalized}`
}

const createDevTradePrivacyPayload = (): PrivacyVerificationPayload => ({
  verifier: "garaga",
  note_version: HIDE_BALANCE_SHIELDED_POOL_V3 ? "v3" : undefined,
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
      "NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS is not configured. On-chain Hide Balance swap requires privacy router address."
    )
  }
  const nullifier = payload.nullifier?.trim() || ""
  const commitment = payload.commitment?.trim() || ""
  const proof = normalizeHexArray(payload.proof)
  const publicInputs = normalizeHexArray(payload.public_inputs)
  if (!nullifier || !commitment || !proof.length || !publicInputs.length) {
    throw new Error(
      "On-chain Hide Balance requires complete Garaga payload (nullifier, commitment, proof, public_inputs)."
    )
  }
  return {
    contractAddress: router,
    entrypoint: "submit_private_action",
    calldata: [
      nullifier,
      commitment,
      String(proof.length),
      ...proof,
      String(publicInputs.length),
      ...publicInputs,
    ],
  }
}

/**
 * Checks conditions for `isSameFeltAddress`.
 *
 * @param left - Input used by `isSameFeltAddress` to compute state, payload, or request behavior.
 * @param right - Input used by `isSameFeltAddress` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const isSameFeltAddress = (left: string, right: string) => {
  const a = normalizeFeltAddress(left)
  const b = normalizeFeltAddress(right)
  if (!a || !b) return false
  return a === b
}

const resolveTokenAddress = (symbol: string): string => {
  const key = symbol.toUpperCase()
  return STARKNET_TOKEN_ADDRESS[key] || ""
}

const resolveTokenDecimals = (symbol: string): number => {
  const key = symbol.toUpperCase()
  return TOKEN_DECIMALS[key] ?? 18
}

const normalizeHexNumberish = (value: string): string => {
  const raw = (value || "").trim()
  if (!raw) return "0x0"
  if (raw.startsWith("0x") || raw.startsWith("0X")) {
    const compact = raw.slice(2).replace(/^0+/, "")
    return `0x${(compact || "0").toLowerCase()}`
  }
  if (/^\d+$/.test(raw)) {
    return `0x${BigInt(raw).toString(16)}`
  }
  return raw.toLowerCase()
}

const limitBridgeApprovalToExactAmount = (
  calldata: string[],
  amountText: string,
  tokenSymbol: string
): { calldata: string[]; limited: boolean } => {
  if (!Array.isArray(calldata) || calldata.length < 3) {
    return { calldata, limited: false }
  }
  const low = normalizeHexNumberish(calldata[1] || "")
  const high = normalizeHexNumberish(calldata[2] || "")
  if (low !== U256_MAX_LOW_HEX || high !== U256_MAX_HIGH_HEX) {
    return { calldata, limited: false }
  }

  let exactLow = "0x0"
  let exactHigh = "0x0"
  try {
    ;[exactLow, exactHigh] = decimalToU256Parts(amountText, resolveTokenDecimals(tokenSymbol))
  } catch {
    return { calldata, limited: false }
  }

  const exactLowNorm = normalizeHexNumberish(exactLow)
  const exactHighNorm = normalizeHexNumberish(exactHigh)
  if (exactLowNorm === "0x0" && exactHighNorm === "0x0") {
    return { calldata, limited: false }
  }

  const next = [...calldata]
  next[1] = exactLow
  next[2] = exactHigh
  return { calldata: next, limited: true }
}

const isStarknetEntrypointMissingError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "")
  return /(requested entrypoint does not exist|entrypoint does not exist|entry point .* not found|entrypoint .* not found|entry_point_not_found)/i.test(
    message
  )
}

const normalizeGardenStarknetEntrypoint = (rawSelectorOrEntrypoint: string): string => {
  const normalized = (rawSelectorOrEntrypoint || "").trim().toLowerCase()
  if (!normalized) return rawSelectorOrEntrypoint
  if (normalized === GARDEN_STARKNET_APPROVE_SELECTOR) return "approve"
  if (normalized === GARDEN_STARKNET_INITIATE_SELECTOR) return "initiate"
  return rawSelectorOrEntrypoint
}

/**
 * Parses or transforms values for `formatTokenAmount`.
 *
 * @param value - Input used by `formatTokenAmount` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const formatTokenAmount = (value: number, maxFractionDigits = 8) => {
  if (!Number.isFinite(value)) return "—"
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  })
}

const shortenAddress = (addr?: string | null) => {
  const value = (addr || "").trim()
  if (!value) return "-"
  if (value.length <= 14) return value
  return `${value.slice(0, 8)}...${value.slice(-6)}`
}

const formatRemainingDuration = (remainingMs: number) => {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000))
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`
}

/**
 * Handles `estimatedBridgeTimeByProvider` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const estimatedBridgeTimeByProvider = (provider?: string) => {
  const key = (provider || "").trim().toLowerCase()
  if (!key) return "~15-20 min"
  if (key.includes("garden")) return "~25-35 min"
  if (key.includes("starkgate")) return "~10-15 min"
  if (key.includes("atomiq")) return "~20-30 min"
  if (key.includes("layerswap")) return "~15-20 min"
  return "~15-20 min"
}

const normalizeEstimatedTimeLabel = ({
  raw,
  provider,
  includeSwapLeg,
}: {
  raw?: unknown
  provider?: string
  includeSwapLeg?: boolean
}) => {
  const parseMinuteRange = (value: string): [number, number] | null => {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return null
    const rangeMatch = normalized.match(/(\d+)\s*-\s*(\d+)\s*min/)
    if (rangeMatch) {
      const min = Number.parseInt(rangeMatch[1], 10)
      const max = Number.parseInt(rangeMatch[2], 10)
      if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min) {
        return [min, max]
      }
    }
    const singleMatch = normalized.match(/(\d+)\s*min/)
    if (singleMatch) {
      const minute = Number.parseInt(singleMatch[1], 10)
      if (Number.isFinite(minute) && minute > 0) {
        return [minute, minute]
      }
    }
    return null
  }

  let base =
    typeof raw === "string" && raw.trim().length > 0
      ? raw.trim()
      : estimatedBridgeTimeByProvider(provider)
  if (includeSwapLeg) {
    const parsed = parseMinuteRange(base)
    if (parsed) {
      const [baseMin, baseMax] = parsed
      return `~${baseMin + 2}-${baseMax + 3} min total`
    }
    if (!/total/i.test(base)) {
      return `${base} total`
    }
  }
  return base
}

/**
 * Parses or transforms values for `formatBtcFromSats`.
 *
 * @param value - Input used by `formatBtcFromSats` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const formatBtcFromSats = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0.00000000 BTC"
  return `${(value / 100_000_000).toFixed(8)} BTC`
}

const parseGardenOrderProgress = (orderPayload: unknown): GardenOrderProgress => {
  const statusRaw = pickNestedString(orderPayload, ["status"]).toLowerCase()
  const sourceInitiateTxHash =
    pickNestedString(orderPayload, ["source_swap", "initiate_tx_hash"]) ||
    pickNestedString(orderPayload, ["source_swap", "initiateTxHash"])
  const destinationInitiateTxHash =
    pickNestedString(orderPayload, ["destination_swap", "initiate_tx_hash"]) ||
    pickNestedString(orderPayload, ["destination_swap", "initiateTxHash"])
  const destinationRedeemTxHash =
    pickNestedString(orderPayload, ["destination_swap", "redeem_tx_hash"]) ||
    pickNestedString(orderPayload, ["destination_swap", "redeemTxHash"])
  const sourceRefundTxHash =
    pickNestedString(orderPayload, ["source_swap", "refund_tx_hash"]) ||
    pickNestedString(orderPayload, ["source_swap", "refundTxHash"])
  const destinationRefundTxHash =
    pickNestedString(orderPayload, ["destination_swap", "refund_tx_hash"]) ||
    pickNestedString(orderPayload, ["destination_swap", "refundTxHash"])
  const instantRefundTx =
    pickNestedString(orderPayload, ["source_swap", "instant_refund_tx"]) ||
    pickNestedString(orderPayload, ["source_swap", "instantRefundTx"])

  const isCompleted =
    !!destinationRedeemTxHash ||
    statusRaw === "completed" ||
    statusRaw === "redeemed" ||
    statusRaw === "success"
  const isRefunded =
    !!sourceRefundTxHash ||
    !!destinationRefundTxHash ||
    statusRaw === "refunded" ||
    statusRaw === "refund_completed"
  const isExpired = statusRaw === "expired"
  const isRefundable =
    !isCompleted &&
    !isRefunded &&
    (isExpired || statusRaw === "failed" || statusRaw === "cancelled" || !!instantRefundTx)

  /**
   * Handles `status` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const status = (() => {
    if (isCompleted) return "completed"
    if (isRefunded) return "refunded"
    if (isExpired) return "expired"
    if (statusRaw === "failed" || statusRaw === "cancelled") return "failed"
    if (statusRaw === "initiated" || sourceInitiateTxHash || destinationInitiateTxHash) {
      return "initiated"
    }
    if (statusRaw === "in-progress" || statusRaw === "in_progress") return "processing"
    if (statusRaw) return statusRaw
    return "pending"
  })()

  return {
    status,
    sourceInitiateTxHash,
    destinationInitiateTxHash,
    destinationRedeemTxHash,
    sourceRefundTxHash,
    destinationRefundTxHash,
    instantRefundTx,
    isCompleted,
    isRefunded,
    isExpired,
    isRefundable,
  }
}

const broadcastBtcRawTransaction = async (rawTxHex: string): Promise<string> => {
  const endpoint = `${BTC_TESTNET_EXPLORER_BASE_URL.replace(/\/$/, "")}/api/tx`
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
    },
    body: rawTxHex.trim(),
  })
  const payload = (await response.text()).trim()
  if (!response.ok) {
    throw new Error(payload || `Failed to broadcast refund tx (${response.status})`)
  }
  return payload
}

/**
 * Parses or transforms values for `formatMultiplier`.
 *
 * @param value - Input used by `formatMultiplier` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const formatMultiplier = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "1x"
  const rounded = Math.round(value)
  if (Math.abs(value - rounded) < 0.01) return `${rounded}x`
  return `${value.toFixed(2)}x`
}

/**
 * Handles `stableKeyNumber` logic.
 *
 * @param value - Input used by `stableKeyNumber` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const stableKeyNumber = (value: number, fractionDigits = 8) => {
  if (!Number.isFinite(value)) return "0"
  return value.toFixed(fractionDigits)
}

/**
 * Parses or transforms values for `sanitizeDecimalInput`.
 *
 * @param raw - Input used by `sanitizeDecimalInput` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const sanitizeDecimalInput = (raw: string, maxDecimals = 18) => {
  const cleaned = raw.replace(/,/g, "").replace(/[^\d.]/g, "")
  if (!cleaned) return ""
  const firstDot = cleaned.indexOf(".")
  if (firstDot === -1) {
    const noLeading = cleaned.replace(/^0+(?=\d)/, "")
    return noLeading || "0"
  }
  const intPartRaw = cleaned.slice(0, firstDot).replace(/\./g, "")
  const fracRaw = cleaned.slice(firstDot + 1).replace(/\./g, "")
  const intPart = intPartRaw.replace(/^0+(?=\d)/, "") || "0"
  const fracPart = fracRaw.slice(0, Math.max(0, maxDecimals))
  return `${intPart}.${fracPart}`
}

/**
 * Handles `trimDecimalZeros` logic.
 *
 * @param raw - Input used by `trimDecimalZeros` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const trimDecimalZeros = (raw: string) =>
  raw
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "")
    .replace(/\.$/, "")

/**
 * Parses or transforms values for `normalizeTokenAmountDisplay`.
 *
 * @param raw - Input used by `normalizeTokenAmountDisplay` to compute state, payload, or request behavior.
 * @param symbol - Input used by `normalizeTokenAmountDisplay` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const normalizeTokenAmountDisplay = (raw: string | number, symbol: string) => {
  const parsed =
    typeof raw === "number" ? raw : Number.parseFloat(String(raw).replace(/,/g, ""))
  if (!Number.isFinite(parsed) || parsed < 0) return ""
  const maxDecimals = Math.min(resolveTokenDecimals(symbol), 8)
  return trimDecimalZeros(parsed.toFixed(Math.max(0, maxDecimals)))
}

const parseLiquidityMaxFromQuoteError = (message: string, expectedSymbol: string): number | null => {
  if (!message) return null
  const expected = expectedSymbol.trim().toUpperCase()
  if (!expected) return null
  const rangeMatch = message.match(/range of\s+([0-9]+)\s+to\s+([0-9]+)/i)
  if (rangeMatch) {
    const maxUnits = Number.parseFloat(rangeMatch[2] || "")
    const decimals = resolveTokenDecimals(expected)
    if (Number.isFinite(maxUnits) && maxUnits >= 0) {
      return maxUnits / 10 ** decimals
    }
  }
  const patterns = [
    /maks sekitar\s+([0-9]+(?:[.,][0-9]+)?)\s+([a-z0-9]+)/i,
    /max(?:imum)?\s+around\s+([0-9]+(?:[.,][0-9]+)?)\s+([a-z0-9]+)/i,
  ]
  for (const pattern of patterns) {
    const match = message.match(pattern)
    if (!match) continue
    const amountRaw = (match[1] || "").replace(",", ".")
    const symbolRaw = (match[2] || "").trim().toUpperCase()
    if (!amountRaw || symbolRaw !== expected) continue
    const parsed = Number.parseFloat(amountRaw)
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed
    }
  }
  return null
}

const pickNestedString = (value: unknown, path: Array<string>): string => {
  let current: any = value
  for (const segment of path) {
    if (!current || typeof current !== "object") return ""
    current = current[segment]
  }
  return typeof current === "string" ? current.trim() : ""
}

const buildGardenOrderExplorerUrl = (orderId: string): string => {
  const normalizedOrderId = orderId.trim()
  if (!normalizedOrderId) return ""
  const base = GARDEN_ORDER_EXPLORER_BASE_URL.trim().replace(/\/$/, "")
  if (!base) return ""
  return `${base}/${encodeURIComponent(normalizedOrderId)}`
}

const buildGardenOrderExplorerLinks = (
  orderId: string
): Array<{ label: string; url: string }> | undefined => {
  const url = buildGardenOrderExplorerUrl(orderId)
  if (!url) return undefined
  return [{ label: "Open Garden Explorer", url }]
}

// Internal helper that supports compact address display in notifications.
function shortAddress(value: string, head = 6, tail = 4): string {
  const normalized = (value || "").trim()
  if (!normalized) return "-"
  if (normalized.length <= head + tail + 3) return normalized
  return `${normalized.slice(0, head)}...${normalized.slice(-tail)}`
}

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

type TokenWithBalance = (typeof tokenCatalog)[number] & { balance: number }

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
          <p className="text-sm text-muted-foreground mt-1">
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
  const [seedPrices, setSeedPrices] = React.useState<Record<string, number>>({})
  const { prices: livePrices, sources: priceSources, status: priceStatus } = useLivePrices(
    React.useMemo(() => tokenCatalog.map((token) => token.symbol), []),
    {
      seedPrices,
      fallbackPrices: { CAREL: 1, USDC: 1, USDT: 1 },
    }
  )

  const resolveTokenBalance = React.useCallback(
    (token: { symbol: string; network: string }) => {
      const symbol = token.symbol.toUpperCase()
      const chain = chainFromNetwork(token.network)
      const backendBalance = wallet.balance[symbol] ?? 0

      if (symbol === "ETH" && chain === "ethereum" && wallet.evmAddress) {
        return wallet.onchainBalance.ETH ?? backendBalance
      }
      if (chain === "starknet") {
        if (symbol === "STRK") {
          return wallet.onchainBalance.STRK_L2 ?? backendBalance
        }
        if (symbol === "CAREL") {
          return wallet.onchainBalance.CAREL ?? backendBalance
        }
        if (symbol === "USDC") {
          return wallet.onchainBalance.USDC ?? backendBalance
        }
        if (symbol === "USDT") {
          return wallet.onchainBalance.USDT ?? backendBalance
        }
        if (symbol === "WBTC") {
          if (
            typeof wallet.onchainBalance.WBTC === "number" &&
            Number.isFinite(wallet.onchainBalance.WBTC)
          ) {
            return wallet.onchainBalance.WBTC
          }
          if (
            typeof wallet.balance.WBTC === "number" &&
            Number.isFinite(wallet.balance.WBTC)
          ) {
            return wallet.balance.WBTC
          }
          return backendBalance
        }
      }
      if (symbol === "BTC" && chain === "bitcoin" && wallet.btcAddress) {
        return wallet.onchainBalance.BTC ?? backendBalance
      }
      return backendBalance
    },
    [
      wallet.balance,
      wallet.btcAddress,
      wallet.evmAddress,
      wallet.onchainBalance.BTC,
      wallet.onchainBalance.CAREL,
      wallet.onchainBalance.ETH,
      wallet.onchainBalance.STRK_L2,
      wallet.onchainBalance.USDC,
      wallet.onchainBalance.USDT,
      wallet.onchainBalance.WBTC,
    ]
  )

  const resolveTokenPrice = React.useCallback(
    (symbol: string) => {
      const upper = symbol.toUpperCase()
      const direct = Number(livePrices[upper])
      const directValid = Number.isFinite(direct) && direct > 0
      const btc = Number(livePrices.BTC)
      const btcValid = Number.isFinite(btc) && btc > 0
      const wbtc = Number(livePrices.WBTC)
      const wbtcValid = Number.isFinite(wbtc) && wbtc > 0

      if (upper === "WBTC") {
        if (directValid && btcValid) {
          const ratio = direct / btc
          if (ratio < 0.5 || ratio > 2) {
            return btc
          }
          return direct
        }
        if (btcValid) {
          return btc
        }
        if (wbtcValid) {
          return wbtc
        }
      }

      if (upper === "BTC") {
        if (directValid && wbtcValid) {
          const ratio = wbtc / direct
          if (ratio < 0.5 || ratio > 2) {
            return wbtc
          }
          return direct
        }
        if (directValid) {
          return direct
        }
        if (wbtcValid) {
          return wbtc
        }
      }

      if (directValid) {
        return direct
      }
      return 0
    },
    [livePrices]
  )

  const tokens = React.useMemo<TokenWithBalance[]>(() => {
    return tokenCatalog.map((token) => ({
      ...token,
      balance: resolveTokenBalance(token),
      price: resolveTokenPrice(token.symbol),
    }))
  }, [resolveTokenBalance, resolveTokenPrice])

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
  const quoteCacheRef = React.useRef<Map<string, QuoteCacheEntry>>(new Map())
  const quoteRequestSeqRef = React.useRef(0)
  const [activeNft, setActiveNft] = React.useState<NFTItem | null>(null)
  const [stakePointsMultiplier, setStakePointsMultiplier] = React.useState(1)
  
  // Unified privacy toggle: UI masking and on-chain hide-balance flow.
  const [balanceHidden, setBalanceHidden] = React.useState(false)
  const [hasTradePrivacyPayload, setHasTradePrivacyPayload] = React.useState(false)
  const [isAutoPrivacyProvisioning, setIsAutoPrivacyProvisioning] = React.useState(false)
  const [nowMs, setNowMs] = React.useState(() => Date.now())
  const [hideStrkDenomId, setHideStrkDenomId] = React.useState<string>("10")
  const autoPrivacyPayloadPromiseRef = React.useRef<Promise<PrivacyVerificationPayload | undefined> | null>(null)
  // Hide Balance (Garaga) is only enabled for Starknet <-> Starknet swap flow.
  const hideBalanceSupportedForCurrentPair =
    chainFromNetwork(fromToken.network) === "starknet" &&
    chainFromNetwork(toToken.network) === "starknet"
  const hideBalanceOnchain = hideBalanceSupportedForCurrentPair && balanceHidden
  const hideStrkDenomEnabled =
    hideBalanceOnchain && HIDE_BALANCE_SHIELDED_POOL_V3 && fromToken.symbol.toUpperCase() === "STRK"
  const selectedHideStrkDenom =
    HIDE_STRK_DENOM_OPTIONS.find((option) => option.id === hideStrkDenomId) ||
    HIDE_STRK_DENOM_OPTIONS[0]
  
  // Settings state
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [mevProtectionEnabled, setMevProtectionEnabled] = React.useState(false)
  const mevProtection = mode === "private" && mevProtectionEnabled
  const [slippage, setSlippage] = React.useState("0.5")
  const [customSlippage, setCustomSlippage] = React.useState("")
  const [receiveAddress, setReceiveAddress] = React.useState("")
  const [isReceiveAddressManual, setIsReceiveAddressManual] = React.useState(false)
  const [xverseUserId, setXverseUserId] = React.useState("")
  const [btcVaultCopied, setBtcVaultCopied] = React.useState(false)
  const [pendingBtcDeposit, setPendingBtcDeposit] = React.useState<PendingBtcDepositState | null>(null)
  const [isSendingBtcDeposit, setIsSendingBtcDeposit] = React.useState(false)
  const [isClaimingRefund, setIsClaimingRefund] = React.useState(false)
  const lastGardenOrderStatusRef = React.useRef<Record<string, string>>({})
  React.useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  React.useEffect(() => {
    if (!hideStrkDenomEnabled) return
    const targetAmount = selectedHideStrkDenom.amount
    if (fromAmount === targetAmount) return
    setFromAmount(targetAmount)
  }, [hideStrkDenomEnabled, selectedHideStrkDenom.amount, fromAmount])
  const refreshTradePrivacyPayload = React.useCallback(() => {
    setHasTradePrivacyPayload(Boolean(loadTradePrivacyPayload()))
  }, [])
  const resolveHideBalancePrivacyPayload = React.useCallback(async (): Promise<PrivacyVerificationPayload | undefined> => {
    const cachedPayload = loadTradePrivacyPayload()
    if (cachedPayload) {
      setHasTradePrivacyPayload(true)
      return cachedPayload
    }
    const recipientForPayload = (receiveAddress || "").trim() || undefined

    if (autoPrivacyPayloadPromiseRef.current) {
      return autoPrivacyPayloadPromiseRef.current
    }

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
        notifications.addNotification({
          type: "info",
          title: "Dev Garaga payload generated",
          message: "Payload mock dibuat otomatis untuk local test. Ganti ke proof real untuk testnet production.",
        })
        return generated
      }

      if (!wallet.isConnected) return undefined

      setIsAutoPrivacyProvisioning(true)
      try {
        const response = await autoSubmitPrivacyAction({
          verifier: "garaga",
          submit_onchain: false,
          tx_context: {
            flow:
              chainFromNetwork(fromToken.network) !== chainFromNetwork(toToken.network)
                ? "bridge"
                : "swap",
            from_token: fromToken.symbol,
            to_token: toToken.symbol,
            amount: fromAmount,
            recipient: recipientForPayload,
            from_network: fromToken.network,
            to_network: toToken.network,
            note_version: HIDE_BALANCE_SHIELDED_POOL_V3 ? "v3" : undefined,
            denom_id: hideStrkDenomEnabled ? selectedHideStrkDenom.id : undefined,
          },
        })
        const payload: PrivacyVerificationPayload = {
          verifier: (response.payload?.verifier || "garaga").trim() || "garaga",
          note_version: response.payload?.note_version?.trim() || undefined,
          root: response.payload?.root?.trim() || undefined,
          nullifier: response.payload?.nullifier?.trim(),
          commitment: response.payload?.commitment?.trim(),
          recipient: response.payload?.recipient?.trim() || recipientForPayload,
          note_commitment: response.payload?.note_commitment?.trim() || undefined,
          denom_id:
            response.payload?.denom_id?.trim() ||
            (hideStrkDenomEnabled ? selectedHideStrkDenom.id : undefined),
          spendable_at_unix:
            typeof response.payload?.spendable_at_unix === "number" &&
            Number.isFinite(response.payload.spendable_at_unix)
              ? Math.floor(response.payload.spendable_at_unix)
              : undefined,
          proof: normalizeHexArray(response.payload?.proof),
          public_inputs: normalizeHexArray(response.payload?.public_inputs),
        }
        const proof = normalizeHexArray(payload.proof)
        const publicInputs = normalizeHexArray(payload.public_inputs)
        if (!payload.nullifier || !payload.commitment || !proof.length || !publicInputs.length) {
          throw new Error("Auto Garaga payload tidak lengkap dari backend.")
        }
        if (
          proof.length === 1 &&
          publicInputs.length === 1 &&
          proof[0]?.toLowerCase() === "0x1" &&
          publicInputs[0]?.toLowerCase() === "0x1"
        ) {
          throw new Error("Auto Garaga payload backend masih dummy (0x1).")
        }

        const normalizedPayload: PrivacyVerificationPayload = {
          verifier: payload.verifier,
          note_version: payload.note_version,
          root: payload.root,
          nullifier: payload.nullifier,
          commitment: payload.commitment,
          recipient: payload.recipient,
          note_commitment: payload.note_commitment,
          denom_id: payload.denom_id,
          spendable_at_unix: payload.spendable_at_unix,
          proof,
          public_inputs: publicInputs,
        }
        persistTradePrivacyPayload(normalizedPayload)
        setHasTradePrivacyPayload(true)
        notifications.addNotification({
          type: "success",
          title: "Garaga payload ready",
          message: "Payload Hide Balance berhasil disiapkan otomatis.",
        })
        if (response.tx_hash) {
          notifications.addNotification({
            type: "info",
            title: "Privacy tx submitted",
            message: `Privacy tx ${response.tx_hash.slice(0, 12)}...`,
            txHash: response.tx_hash,
            txNetwork: "starknet",
          })
        }
        return normalizedPayload
      } catch (error) {
        notifications.addNotification({
          type: "error",
          title: "Auto Garaga payload failed",
          message:
            error instanceof Error
              ? error.message
              : "Gagal menyiapkan payload Garaga otomatis.",
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
    fromAmount,
    fromToken.network,
    fromToken.symbol,
    hideStrkDenomEnabled,
    notifications,
    receiveAddress,
    selectedHideStrkDenom.id,
    toToken.network,
    toToken.symbol,
    wallet.isConnected,
  ])

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
        return { label: "Fallback", className: "bg-muted text-muted-foreground", visible: true }
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
  }, [hideBalanceSupportedForCurrentPair, balanceHidden])

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
    /**
     * Handles `syncPayload` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const syncPayload = () => refreshTradePrivacyPayload()
    syncPayload()
    window.addEventListener("focus", syncPayload)
    window.addEventListener("trade-privacy-payload-updated", syncPayload)
    return () => {
      window.removeEventListener("focus", syncPayload)
      window.removeEventListener("trade-privacy-payload-updated", syncPayload)
    }
  }, [refreshTradePrivacyPayload])

  React.useEffect(() => {
    let active = true
    if (!wallet.isConnected) return
    ;(async () => {
      try {
        const response = await getPortfolioBalance()
        if (!active) return
        const updated: Record<string, number> = {}
        response.balances.forEach((item) => {
          const price = item.amount > 0 ? item.value_usd / item.amount : item.price
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
  }, [wallet.isConnected, wallet.address, wallet.starknetAddress, wallet.evmAddress, wallet.btcAddress])

  React.useEffect(() => {
    const amountValue = Number.parseFloat(fromAmount || "0")
    if (!amountValue || amountValue <= 0) {
      setToAmount("")
      setQuote(null)
      setQuoteError(null)
      setLiquidityMaxFromQuote(null)
      return
    }
    if (!isCrossChain && fromSymbol.toUpperCase() === toSymbol.toUpperCase()) {
      setToAmount(normalizeTokenAmountDisplay(fromAmount, toSymbol))
      setQuote(null)
      setQuoteError("Select a different destination token.")
      setLiquidityMaxFromQuote(null)
      return
    }
    if (bridgeToStrkDisabled) {
      setToAmount("")
      setQuote(null)
      setQuoteError(BRIDGE_TO_STRK_DISABLED_MESSAGE)
      setLiquidityMaxFromQuote(null)
      return
    }
    if (isCrossChain && !bridgePairSupported) {
      setToAmount("")
      setQuote(null)
      setQuoteError(UNSUPPORTED_BRIDGE_PAIR_MESSAGE)
      setLiquidityMaxFromQuote(null)
      return
    }
    const slippageValue = Number(customSlippage || slippage || "0.5")
    const tradeMode = mevProtection ? "private" : "transparent"
    const quoteCacheKey = [
      isCrossChain ? "bridge" : "swap",
      fromChain,
      toChain,
      fromSymbol,
      toSymbol,
      stableKeyNumber(amountValue, 8),
      stableKeyNumber(slippageValue, 4),
      tradeMode,
    ].join("|")

    let cancelled = false
    const requestSeq = ++quoteRequestSeqRef.current
    /**
     * Checks conditions for `isStale`.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const isStale = () => cancelled || requestSeq !== quoteRequestSeqRef.current
    const timer = setTimeout(async () => {
      setIsQuoteLoading(true)
      setQuoteError(null)
      const now = Date.now()
      const cached = quoteCacheRef.current.get(quoteCacheKey)
      if (cached && cached.expiresAt > now) {
        if (!isStale()) {
          setToAmount(cached.toAmount)
          setQuote(cached.quote)
          setQuoteError(cached.quoteError)
          setLiquidityMaxFromQuote(
            parseLiquidityMaxFromQuoteError(cached.quoteError || "", fromSymbol)
          )
          setIsQuoteLoading(false)
        }
        return
      }
      if (cached) {
        quoteCacheRef.current.delete(quoteCacheKey)
      }

      /**
       * Updates state for `saveQuoteToCache`.
       *
       * @param nextQuote - Input used by `saveQuoteToCache` to compute state, payload, or request behavior.
       * @param nextToAmount - Input used by `saveQuoteToCache` to compute state, payload, or request behavior.
       * @param nextQuoteError - Input used by `saveQuoteToCache` to compute state, payload, or request behavior.
       *
       * @returns Result consumed by caller flow, UI state updates, or async chaining.
       * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
       */
      const saveQuoteToCache = (nextQuote: QuoteState, nextToAmount: string, nextQuoteError: string | null) => {
        quoteCacheRef.current.set(quoteCacheKey, {
          expiresAt: Date.now() + QUOTE_CACHE_TTL_MS,
          quote: nextQuote,
          toAmount: nextToAmount,
          quoteError: nextQuoteError,
        })
        while (quoteCacheRef.current.size > MAX_QUOTE_CACHE_ENTRIES) {
          const oldest = quoteCacheRef.current.keys().next().value
          if (!oldest) break
          quoteCacheRef.current.delete(oldest)
        }
      }

      try {
        if (isCrossChain) {
          setLiquidityMaxFromQuote(null)
          const response = await getBridgeQuote({
            from_chain: fromChain,
            to_chain: toChain,
            token: fromSymbol,
            to_token: toSymbol,
            amount: fromAmount,
          })
          if (isStale()) return
          let protocolFee = Number(response.fee || 0)
          let networkFee = 0
          if (fromChain === "ethereum" && toChain === "starknet" && fromSymbol.toUpperCase() === "ETH") {
            const [estimatedFeeWei, estimatedNetworkFeeWei] = await Promise.all([
              estimateStarkgateDepositFeeWei(STARKGATE_ETH_BRIDGE_ADDRESS),
              estimateEvmNetworkFeeWei(BigInt(210000)),
            ])
            if (!isStale() && estimatedFeeWei !== null) {
              protocolFee = bigintWeiToUnitNumber(estimatedFeeWei, 18)
            }
            if (!isStale() && estimatedNetworkFeeWei !== null) {
              networkFee = bigintWeiToUnitNumber(estimatedNetworkFeeWei, 18)
            }
          }
          if (isStale()) return
          const mevFee = mevProtection ? amountValue * MEV_FEE_RATE : 0
          const bridgeFee = protocolFee + networkFee + mevFee
          const estimatedReceiveRaw = Number(response.estimated_receive || 0)
          const bridgeToSwapAmount = estimatedReceiveRaw * (1 - 0.003)
          const slippageFactor = 1 - slippageValue / 100
          const bridgeProviderKey = (response.bridge_provider || "").trim().toLowerCase()
          const shouldProjectCrossTokenAmount =
            fromSymbol !== toSymbol &&
            toChain === "starknet" &&
            bridgeProviderKey !== "garden"
          const bridgeConvertedAmount =
            shouldProjectCrossTokenAmount
              ? convertAmountByUsdPrice(
                  bridgeToSwapAmount * (Number.isFinite(slippageFactor) && slippageFactor > 0 ? slippageFactor : 1),
                  fromPrice,
                  toPrice
                )
              : null
          const displayToAmount =
            shouldProjectCrossTokenAmount
              ? Number.isFinite(bridgeConvertedAmount ?? NaN)
                ? normalizeTokenAmountDisplay(bridgeConvertedAmount as number, toSymbol)
                : ""
              : normalizeTokenAmountDisplay(response.estimated_receive, toSymbol)
          const estimatedTimeLabel = normalizeEstimatedTimeLabel({
            raw: response.estimated_time,
            provider: response.bridge_provider,
            includeSwapLeg: shouldProjectCrossTokenAmount,
          })
          const bridgeQuote: QuoteState = {
            type: "bridge",
            toAmount: displayToAmount,
            fee: bridgeFee,
            feeUnit: "token",
            protocolFee,
            networkFee,
            mevFee,
            estimatedTime: estimatedTimeLabel,
            provider: response.bridge_provider,
            priceImpact:
              amountValue > 0 && fromPrice > 0 && Number.parseFloat(displayToAmount || "0") > 0 && toPrice > 0
                ? `${Math.max(
                    0,
                    ((amountValue * fromPrice - Number.parseFloat(displayToAmount || "0") * toPrice) /
                      (amountValue * fromPrice)) *
                      100
                  ).toFixed(2)}%`
                : undefined,
            bridgeSourceAmount: estimatedReceiveRaw,
            bridgeConvertedAmount: bridgeConvertedAmount ?? undefined,
          }
          const bridgeQuoteError =
            shouldProjectCrossTokenAmount && !displayToAmount
              ? "Cross-token estimate is not available yet (destination live price not loaded)."
              : null
          setToAmount(displayToAmount)
          setQuote(bridgeQuote)
          setQuoteError(bridgeQuoteError)
          setLiquidityMaxFromQuote(
            parseLiquidityMaxFromQuoteError(bridgeQuoteError || "", fromSymbol)
          )
          saveQuoteToCache(bridgeQuote, displayToAmount, bridgeQuoteError)
        } else {
          const response = await getSwapQuote({
            from_token: fromSymbol,
            to_token: toSymbol,
            amount: fromAmount,
            slippage: slippageValue,
            mode: tradeMode,
          })
          if (isStale()) return
          const onchainCalls =
            Array.isArray(response.onchain_calls) && response.onchain_calls.length > 0
              ? response.onchain_calls
                  .filter((call) => {
                    return (
                      call &&
                      typeof call.contract_address === "string" &&
                      typeof call.entrypoint === "string" &&
                      Array.isArray(call.calldata)
                    )
                  })
                  .map((call) => ({
                    contractAddress: call.contract_address.trim(),
                    entrypoint: call.entrypoint.trim(),
                    calldata: call.calldata.map((item) => String(item)),
                  }))
                  .filter(
                    (call) =>
                      !!call.contractAddress &&
                      !!call.entrypoint &&
                      call.calldata.every((item) => typeof item === "string" && item.trim().length > 0)
                  )
              : undefined
          const hasPreparedOnchainCalls = Array.isArray(onchainCalls) && onchainCalls.length > 0
          const backendToAmountRaw = Number(response.to_amount || 0)
          const slippageFactor =
            Number.isFinite(slippageValue) && slippageValue >= 0
              ? Math.max(0, 1 - slippageValue / 100)
              : 1
          const liveReferenceToAmount = convertAmountByUsdPrice(
            amountValue * 0.997 * slippageFactor,
            fromPrice,
            toPrice
          )
          const hasLiveReference =
            Number.isFinite(liveReferenceToAmount ?? NaN) && (liveReferenceToAmount ?? 0) > 0
          const backendDeviatesTooMuch =
            hasLiveReference &&
            (!Number.isFinite(backendToAmountRaw) ||
              backendToAmountRaw <= 0 ||
              backendToAmountRaw > (liveReferenceToAmount as number) * 1.35 ||
              backendToAmountRaw < (liveReferenceToAmount as number) * 0.65)
          const normalizedByLivePrice = !hasPreparedOnchainCalls && Boolean(backendDeviatesTooMuch)
          const normalizedToAmount = normalizedByLivePrice
            ? normalizeTokenAmountDisplay(liveReferenceToAmount as number, toSymbol)
            : normalizeTokenAmountDisplay(response.to_amount, toSymbol)
          const protocolFee = Number(response.fee || 0)
          const mevFee = mevProtection ? amountValue * MEV_FEE_RATE : 0
          const fallbackPriceImpact = `${Math.max(
            0,
            (1 - 0.997 * slippageFactor) * 100
          ).toFixed(2)}%`
          const swapQuote: QuoteState = {
            type: "swap",
            toAmount: normalizedToAmount,
            fee: protocolFee + mevFee,
            feeUnit: "usd",
            protocolFee,
            mevFee,
            estimatedTime:
              typeof response.estimated_time === "string" && response.estimated_time.trim().length > 0
                ? response.estimated_time.trim()
                : "~1-2 min",
            priceImpact: normalizedByLivePrice ? fallbackPriceImpact : response.price_impact,
            normalizedByLivePrice,
            onchainCalls,
          }
          setToAmount(swapQuote.toAmount)
          setQuote(swapQuote)
          setQuoteError(null)
          setLiquidityMaxFromQuote(null)
          saveQuoteToCache(swapQuote, swapQuote.toAmount, null)
        }
      } catch (error) {
        if (isStale()) return
        const message = error instanceof Error ? error.message : "Failed to fetch quote"
        setQuoteError(message)
        setLiquidityMaxFromQuote(parseLiquidityMaxFromQuoteError(message, fromSymbol))
        setToAmount("")
        setQuote(null)
      } finally {
        if (!isStale()) {
          setIsQuoteLoading(false)
        }
      }
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    fromAmount,
    bridgeToStrkDisabled,
    bridgePairSupported,
    fromChain,
    fromPrice,
    fromSymbol,
    isCrossChain,
    mevProtection,
    slippage,
    toChain,
    toPrice,
    toSymbol,
    customSlippage,
  ])

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
  const normalizedStakeMultiplier =
    Number.isFinite(stakePointsMultiplier) && stakePointsMultiplier > 0 ? stakePointsMultiplier : 1
  const effectivePointsMultiplier = normalizedStakeMultiplier * nftPointsMultiplier
  const pointsEarned =
    basePointsEarned === null
      ? null
      : Math.max(0, Math.floor(basePointsEarned * effectivePointsMultiplier))
  const showPointsMultiplier = normalizedStakeMultiplier > 1 || nftPointsMultiplier > 1
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
  const bridgeProviderKey = (quote?.provider || "").trim().toLowerCase()
  const isStarkgateBridgeRoute = quote?.type === "bridge" && bridgeProviderKey === "starkgate"
  const bridgeProtocolFeeLabel = isStarkgateBridgeRoute ? "StarkGate Fee" : "Bridge Fee"
  const bridgeNetworkFeeLabel = isStarkgateBridgeRoute ? "Network Gas (est.)" : "Network Fee (est.)"
  const showPendingBtcDeposit = Boolean(pendingBtcDeposit)
  const pendingOrderStatus = (
    pendingBtcDeposit?.status ||
    (pendingBtcDeposit?.txHash ? "processing" : "pending_deposit")
  )
    .trim()
    .toLowerCase()
  const pendingIsFinalized =
    pendingOrderStatus === "completed" || pendingOrderStatus === "refunded"
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
  React.useEffect(() => {
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
  }, [fromAmount, fromToken.symbol, maxExecutableFromAllLimits, onchainBalanceUnavailable])
  const resolvedReceiveAddress = (receiveAddress || preferredReceiveAddress).trim()
  const hasValidQuote = hasQuote && !quoteError
  const hasPreparedOnchainSwapCalls =
    quote?.type === "swap" && Array.isArray(quote.onchainCalls) && quote.onchainCalls.length > 0
  const hasFallbackPositiveBalance =
    Number.isFinite(fromToken.balance) && fromToken.balance > 0
  const activeTradePrivacyPayload = hideBalanceOnchain ? loadTradePrivacyPayload() : undefined
  const activeHideRecipient =
    HIDE_BALANCE_SHIELDED_POOL_V3 && hideBalanceOnchain
      ? (activeTradePrivacyPayload?.recipient || "").trim()
      : ""
  const activeHideRecipientMismatched =
    !!activeHideRecipient &&
    !!resolvedReceiveAddress &&
    normalizeFeltAddress(activeHideRecipient) !== normalizeFeltAddress(resolvedReceiveAddress)
  const privacySpendableAtMs =
    typeof activeTradePrivacyPayload?.spendable_at_unix === "number" &&
    Number.isFinite(activeTradePrivacyPayload.spendable_at_unix)
      ? activeTradePrivacyPayload.spendable_at_unix * 1000
      : null
  const hideMixingWindowRemainingMs =
    hideBalanceOnchain && HIDE_BALANCE_SHIELDED_POOL_V3 && privacySpendableAtMs
      ? Math.max(0, privacySpendableAtMs - nowMs)
      : 0
  const hideMixingWindowBlocked =
    hideBalanceOnchain && HIDE_BALANCE_SHIELDED_POOL_V3 && hideMixingWindowRemainingMs > 0
  const executeDisabledReason =
    !wallet.isConnected
      ? "Connect your wallet first."
      : !hasPositiveAmount
      ? "Enter a valid amount."
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
      : hideMixingWindowBlocked
      ? `Hide Balance note masih dalam mixing window. Tunggu ${formatRemainingDuration(
          hideMixingWindowRemainingMs
        )}.`
      : null
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

  const submitOnchainSwapTx = React.useCallback(
    async (
      privacyPayload?: PrivacyVerificationPayload,
      hideBalanceForTx: boolean = hideBalanceOnchain
    ) => {
    const fromChain = chainFromNetwork(fromToken.network)
    const toChain = chainFromNetwork(toToken.network)
    if (fromChain !== "starknet" || toChain !== "starknet") {
      throw new Error(
        "On-chain swap signing currently supports Starknet pairs only. Use Starknet ↔ Starknet pair or bridge mode."
      )
    }
    if (
      fromToken.symbol.toUpperCase() === "WBTC" ||
      toToken.symbol.toUpperCase() === "WBTC"
    ) {
      const wbtcAddress = resolveTokenAddress("WBTC")
      if (!wbtcAddress) {
        throw new Error(
          "NEXT_PUBLIC_TOKEN_WBTC_ADDRESS is not set. Configure the real Starknet WBTC token address."
        )
      }
    }
    if (isSwapContractEventOnly) {
      throw new Error(
        "Current swap contract is event-only and does not move real tokens yet. Enable/deploy the real swap router first."
      )
    }
    let preparedCalls = quote?.type === "swap" ? quote.onchainCalls || [] : []
    if (!preparedCalls.length) {
      const slippageValue = Number(activeSlippage || "0.5")
      const refreshedQuote = await getSwapQuote({
        from_token: fromToken.symbol,
        to_token: toToken.symbol,
        amount: fromAmount,
        slippage: Number.isFinite(slippageValue) && slippageValue >= 0 ? slippageValue : 0.5,
        mode: mevProtection ? "private" : "transparent",
      })
      const refreshedCalls =
        Array.isArray(refreshedQuote.onchain_calls) && refreshedQuote.onchain_calls.length > 0
          ? refreshedQuote.onchain_calls
              .filter((call) => {
                return (
                  call &&
                  typeof call.contract_address === "string" &&
                  typeof call.entrypoint === "string" &&
                  Array.isArray(call.calldata)
                )
              })
              .map((call) => ({
                contractAddress: call.contract_address.trim(),
                entrypoint: call.entrypoint.trim(),
                calldata: call.calldata.map((item) => String(item)),
              }))
              .filter(
                (call) =>
                  !!call.contractAddress &&
                  !!call.entrypoint &&
                  call.calldata.every((item) => typeof item === "string" && item.trim().length > 0)
              )
          : []
      if (!refreshedCalls.length) {
        throw new Error(
          "Swap quote does not include on-chain calldata yet. Refresh quote and try again."
        )
      }
      preparedCalls = refreshedCalls
      setQuote((prev) =>
        prev && prev.type === "swap"
          ? {
              ...prev,
              onchainCalls: refreshedCalls,
            }
          : prev
      )
    }

    if (hideBalanceForTx) {
      const resolvedPayload = privacyPayload || (await resolveHideBalancePrivacyPayload())
      if (!resolvedPayload) {
        throw new Error(
          "Garaga payload belum siap untuk Hide Balance. Coba lagi, atau cek backend auto-proof config."
        )
      }

      let usedPrivateExecutor = false
      if (HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED) {
        const swapActionIndex = preparedCalls.findIndex((call) => call.entrypoint === "execute_swap")
        if (swapActionIndex >= 0) {
          try {
            const swapActionCall = preparedCalls[swapActionIndex]
            const preparedPrivate = await preparePrivateExecution({
              verifier: (resolvedPayload.verifier || "garaga").trim() || "garaga",
              flow: "swap",
              action_entrypoint: swapActionCall.entrypoint,
              action_calldata: swapActionCall.calldata,
              tx_context: {
                flow: "swap",
                from_token: fromToken.symbol,
                to_token: toToken.symbol,
                amount: fromAmount,
                recipient:
                  resolvedPayload?.recipient ||
                  (receiveAddress || preferredReceiveAddress).trim() ||
                  undefined,
                from_network: fromToken.network,
                to_network: toToken.network,
                note_version: HIDE_BALANCE_SHIELDED_POOL_V3 ? "v3" : undefined,
                denom_id:
                  resolvedPayload?.denom_id ||
                  (hideStrkDenomEnabled ? selectedHideStrkDenom.id : undefined),
                note_commitment: resolvedPayload?.note_commitment,
                spendable_at_unix: resolvedPayload?.spendable_at_unix,
                nullifier: resolvedPayload?.nullifier,
              },
            })
            const preparedPayload: PrivacyVerificationPayload = {
              verifier: (preparedPrivate.payload?.verifier || "garaga").trim() || "garaga",
              note_version: preparedPrivate.payload?.note_version?.trim() || undefined,
              root: preparedPrivate.payload?.root?.trim() || undefined,
              nullifier: preparedPrivate.payload?.nullifier?.trim(),
              commitment: preparedPrivate.payload?.commitment?.trim(),
              recipient:
                resolvedPayload?.recipient ||
                (receiveAddress || preferredReceiveAddress).trim() ||
                undefined,
              note_commitment: preparedPrivate.payload?.note_commitment?.trim() || undefined,
              denom_id:
                preparedPrivate.payload?.denom_id?.trim() ||
                (hideStrkDenomEnabled ? selectedHideStrkDenom.id : undefined),
              spendable_at_unix:
                typeof preparedPrivate.payload?.spendable_at_unix === "number" &&
                Number.isFinite(preparedPrivate.payload.spendable_at_unix)
                  ? Math.floor(preparedPrivate.payload.spendable_at_unix)
                  : undefined,
              proof: normalizeHexArray(preparedPrivate.payload?.proof),
              public_inputs: normalizeHexArray(preparedPrivate.payload?.public_inputs),
            }
            persistTradePrivacyPayload(preparedPayload)
            setHasTradePrivacyPayload(true)

            const prefixCalls =
              swapActionIndex > 0 ? preparedCalls.slice(0, swapActionIndex) : []
            const executorCalls = preparedPrivate.onchain_calls
              .filter(
                (call) =>
                  call &&
                  typeof call.contract_address === "string" &&
                  typeof call.entrypoint === "string" &&
                  Array.isArray(call.calldata)
              )
              .map((call) => ({
                contractAddress: call.contract_address.trim(),
                entrypoint: call.entrypoint.trim(),
                calldata: call.calldata.map((item) => String(item)),
              }))
              .filter(
                (call) =>
                  !!call.contractAddress &&
                  !!call.entrypoint &&
                  call.calldata.every((item) => typeof item === "string" && item.trim().length > 0)
              )
            if (!executorCalls.length) {
              throw new Error("prepare-private-execution returned empty onchain_calls")
            }
            preparedCalls = [...prefixCalls, ...executorCalls]
            usedPrivateExecutor = true
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
      }

      if (!usedPrivateExecutor) {
        const hasPrivacyCall = preparedCalls.some(
          (call) =>
            call.entrypoint === "submit_private_action" &&
            isSameFeltAddress(call.contractAddress, STARKNET_ZK_PRIVACY_ROUTER_ADDRESS)
        )
        if (!hasPrivacyCall) {
          const privacyCall = buildHideBalancePrivacyCall(resolvedPayload)
          preparedCalls = [privacyCall, ...preparedCalls]
        }
      }
    }

    if (process.env.NODE_ENV !== "production") {
      notifications.addNotification({
        type: "info",
        title: "Prepared Starknet calls",
        message: preparedCalls.map((call) => call.entrypoint).join(" -> "),
      })
    }

    const starknetCalls = preparedCalls.map((call) => ({
      contractAddress: call.contractAddress,
      entrypoint: call.entrypoint,
      calldata: call.calldata,
    }))

    try {
      return await invokeStarknetCallsFromWallet(starknetCalls, starknetProviderHint)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "")
      const isAllowanceFailure = /insufficient allowance/i.test(message)
      if (!isAllowanceFailure) {
        throw error
      }

      const approveIndex = starknetCalls.findIndex(
        (call) => call.entrypoint.toLowerCase() === "approve"
      )
      const hasExecuteSwap = starknetCalls.some(
        (call) => call.entrypoint.toLowerCase() === "execute_swap"
      )
      if (approveIndex < 0 || !hasExecuteSwap) {
        throw error
      }

      const approveCall = starknetCalls[approveIndex]
      const remainingCalls = starknetCalls.filter((_, index) => index !== approveIndex)
      if (!approveCall || remainingCalls.length === 0) {
        throw error
      }

      notifications.addNotification({
        type: "warning",
        title: "Retry swap with separate approval",
        message:
          "Wallet multicall hit allowance issue. Approve will be sent first, then swap execution.",
      })

      await invokeStarknetCallsFromWallet([approveCall], starknetProviderHint)
      return invokeStarknetCallsFromWallet(remainingCalls, starknetProviderHint)
    }
    },
    [
      activeSlippage,
      fromAmount,
      fromToken.network,
      fromToken.symbol,
      hideBalanceOnchain,
      hideStrkDenomEnabled,
      isSwapContractEventOnly,
      mevProtection,
      notifications,
      preferredReceiveAddress,
      quote,
      receiveAddress,
      selectedHideStrkDenom.id,
      starknetProviderHint,
      toToken.network,
      toToken.symbol,
      resolveHideBalancePrivacyPayload,
    ]
  )

  const ensureHideV3NoteDeposited = React.useCallback(
    async (payload: PrivacyVerificationPayload): Promise<number> => {
      const executorAddress = PRIVATE_ACTION_EXECUTOR_ADDRESS.trim()
      if (!executorAddress) {
        throw new Error(
          "NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS belum di-set untuk hide note deposit."
        )
      }

      const tokenSymbol = fromToken.symbol.toUpperCase()
      const tokenAddress = resolveTokenAddress(tokenSymbol).trim()
      if (!tokenAddress) {
        throw new Error(`Token address for ${tokenSymbol} is not configured.`)
      }

      const noteCommitment = (payload.note_commitment || payload.commitment || "").trim()
      if (!noteCommitment) {
        throw new Error("Hide note commitment missing in privacy payload.")
      }

      const denomId = (
        payload.denom_id ||
        (hideStrkDenomEnabled ? selectedHideStrkDenom.id : "")
      ).trim()
      if (!denomId) {
        throw new Error("Hide denom_id missing in privacy payload.")
      }

      const denomAmountText =
        HIDE_STRK_DENOM_OPTIONS.find((item) => item.id === denomId)?.amount || fromAmount
      const [amountLow, amountHigh] = decimalToU256Parts(
        denomAmountText,
        resolveTokenDecimals(tokenSymbol)
      )

      const approvalCall = {
        contractAddress: tokenAddress,
        entrypoint: "approve",
        calldata: [executorAddress, amountLow, amountHigh],
      }
      const depositCall = {
        contractAddress: executorAddress,
        entrypoint: "deposit_fixed_v3",
        calldata: [tokenAddress, toHexFelt(denomId), toHexFelt(noteCommitment)],
      }

      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message: `Confirm hide note approval ${denomAmountText} ${tokenSymbol}.`,
      })
      await invokeStarknetCallsFromWallet([approvalCall], starknetProviderHint)

      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message: "Confirm hide note deposit transaction.",
      })
      const depositTxHash = await invokeStarknetCallsFromWallet([depositCall], starknetProviderHint)

      const spendableAtUnix = Math.floor((Date.now() + MIN_WAIT_MS) / 1000)
      persistTradePrivacyPayload({
        ...payload,
        note_version: "v3",
        note_commitment: noteCommitment,
        denom_id: denomId,
        spendable_at_unix: spendableAtUnix,
      })
      setHasTradePrivacyPayload(true)

      notifications.addNotification({
        type: "success",
        title: "Hide note deposited",
        message: `Note deposit submitted (${depositTxHash.slice(0, 10)}...). Tunggu mixing window sebelum swap hide.`,
        txHash: depositTxHash,
        txNetwork: "starknet",
      })
      return spendableAtUnix
    },
    [
      fromAmount,
      fromToken.symbol,
      hideStrkDenomEnabled,
      notifications,
      selectedHideStrkDenom.id,
      starknetProviderHint,
    ]
  )

  const submitOnchainBridgeTx = React.useCallback(async () => {
    const fromChain = chainFromNetwork(fromToken.network)
    const toChain = chainFromNetwork(toToken.network)
    if (isBridgeToStrkDisabledRoute(fromChain, toChain, toToken.symbol)) {
      throw new Error(BRIDGE_TO_STRK_DISABLED_MESSAGE)
    }
    if (!isBridgePairSupportedForCurrentRoutes(fromChain, toChain, fromToken.symbol, toToken.symbol)) {
      throw new Error(UNSUPPORTED_BRIDGE_PAIR_MESSAGE)
    }
    const recipient = (receiveAddress || preferredReceiveAddress).trim()
    if (fromChain === "ethereum") {
      if (fromToken.symbol.toUpperCase() !== "ETH") {
        throw new Error(
          "Bridge Ethereum -> Starknet via StarkGate saat ini hanya mendukung ETH native."
        )
      }
      if (toChain !== "starknet") {
        throw new Error("Ethereum source bridge currently supports Starknet destination only.")
      }
      if (!recipient) {
        throw new Error("Starknet recipient address is required for StarkGate bridge.")
      }
      // Refresh fee right before submit to reduce mismatch with MetaMask preview.
      const estimatedFeeWei = await estimateStarkgateDepositFeeWei(STARKGATE_ETH_BRIDGE_ADDRESS)
      const quotedProtocolFeeWei =
        quote?.type === "bridge" && typeof quote.protocolFee === "number" && quote.protocolFee > 0
          ? unitNumberToScaledBigInt(quote.protocolFee, 18)
          : null
      return sendEvmStarkgateEthDepositFromWallet({
        bridgeAddress: STARKGATE_ETH_BRIDGE_ADDRESS,
        tokenAddress: STARKGATE_ETH_TOKEN_ADDRESS,
        amountEth: fromAmount,
        l2Recipient: recipient,
        feeWei: estimatedFeeWei ?? quotedProtocolFeeWei,
      })
    }

    if (fromChain !== "starknet") {
      throw new Error(
        "On-chain bridge signing currently supports Ethereum/Starknet sources only. Native BTC source must create an order first, then deposit to the Garden address."
      )
    }
    if (toChain === "ethereum") {
      throw new Error(
        "STRK/Starknet -> ETH Sepolia withdrawal is not fully supported end-to-end in this UI. The stable on-chain path currently is ETH Sepolia -> Starknet Sepolia only."
      )
    }

    if (!STARKNET_BRIDGE_AGGREGATOR_ADDRESS) {
      throw new Error(
        "NEXT_PUBLIC_STARKNET_BRIDGE_AGGREGATOR_ADDRESS is not set. Configure Starknet bridge aggregator address in frontend/.env.local."
      )
    }
    const activeBridgeQuote =
      quote?.type === "bridge"
        ? quote
        : await getBridgeQuote({
            from_chain: chainFromNetwork(fromToken.network),
            to_chain: chainFromNetwork(toToken.network),
            token: fromToken.symbol,
            to_token: toToken.symbol,
            amount: fromAmount,
          })

    const providerId = providerIdToFeltHex(
      (activeBridgeQuote as any).provider || (activeBridgeQuote as any).bridge_provider || ""
    )
    const [costLow, costHigh] = decimalToU256Parts(
      String((activeBridgeQuote as any).fee ?? 0),
      resolveTokenDecimals(fromToken.symbol)
    )
    const [amountLow, amountHigh] = decimalToU256Parts(fromAmount, resolveTokenDecimals(fromToken.symbol))
    const estimatedTime = parseEstimatedMinutes((activeBridgeQuote as any).estimatedTime || (activeBridgeQuote as any).estimated_time)

    return invokeStarknetCallFromWallet(
      {
        contractAddress: STARKNET_BRIDGE_AGGREGATOR_ADDRESS,
        entrypoint: "execute_bridge",
        calldata: [providerId, costLow, costHigh, toHexFelt(estimatedTime), amountLow, amountHigh],
      },
      starknetProviderHint
    )
  }, [
    fromAmount,
    fromToken.network,
    fromToken.symbol,
    preferredReceiveAddress,
    quote,
    receiveAddress,
    starknetProviderHint,
    toToken.network,
    toToken.symbol,
  ])

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

  const pollGardenBridgeOrder = React.useCallback(
    async (bridgeId: string, destinationChain: string) => {
      const maxAttempts = 18
      const intervalMs = 10_000
      const txNetwork: "btc" | "evm" | "starknet" =
        destinationChain === "bitcoin"
          ? "btc"
          : destinationChain === "ethereum"
          ? "evm"
          : "starknet"
      const orderExplorerLinks = buildGardenOrderExplorerLinks(bridgeId)

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, intervalMs))
        }
        try {
          const orderResponse = await getGardenOrderById(bridgeId)
          const orderPayload = (orderResponse as any)?.result ?? orderResponse
          const progress = parseGardenOrderProgress(orderPayload)
          const previousStatus = lastGardenOrderStatusRef.current[bridgeId]
          const didStatusChange = previousStatus !== progress.status
          lastGardenOrderStatusRef.current[bridgeId] = progress.status

          setPendingBtcDeposit((prev) =>
            prev && prev.bridgeId === bridgeId
              ? {
                  ...prev,
                  status: progress.status,
                  sourceInitiateTxHash: progress.sourceInitiateTxHash || null,
                  destinationInitiateTxHash: progress.destinationInitiateTxHash || null,
                  destinationRedeemTxHash: progress.destinationRedeemTxHash || null,
                  refundTxHash:
                    progress.sourceRefundTxHash ||
                    progress.destinationRefundTxHash ||
                    prev.refundTxHash ||
                    null,
                  instantRefundTx: progress.instantRefundTx || prev.instantRefundTx || null,
                  lastUpdatedAt: Date.now(),
                }
              : prev
          )

          if (progress.isCompleted) {
            const txHash =
              progress.destinationRedeemTxHash ||
              progress.destinationInitiateTxHash ||
              progress.sourceInitiateTxHash
            if (didStatusChange) {
              notifications.addNotification({
                type: "success",
                title: "Bridge completed",
                message: `Order ${bridgeId.slice(0, 10)}... selesai di chain tujuan.`,
                txHash: txHash || undefined,
                txNetwork,
                txExplorerUrls: orderExplorerLinks,
              })
            }
            setPendingBtcDeposit((prev) => (prev && prev.bridgeId === bridgeId ? null : prev))
            delete lastGardenOrderStatusRef.current[bridgeId]
            await Promise.allSettled([wallet.refreshPortfolio(), wallet.refreshOnchainBalances()])
            const [nftState, rewardsState] = await Promise.allSettled([
              getOwnedNfts({ force: true }),
              getRewardsPoints({ force: true }),
            ])
            if (nftState.status === "fulfilled") {
              const now = Math.floor(Date.now() / 1000)
              const usable = nftState.value.find((nft) => !nft.used && (!nft.expiry || nft.expiry > now))
              setActiveNft((prev) => {
                if (usable) return usable
                if (prev && !prev.used && (!prev.expiry || prev.expiry > now)) return prev
                return null
              })
            }
            if (rewardsState.status === "fulfilled") {
              const parsedMultiplier = Number(rewardsState.value.multiplier)
              setStakePointsMultiplier(
                Number.isFinite(parsedMultiplier) && parsedMultiplier > 0 ? parsedMultiplier : 1
              )
            }
            return
          }

          if (progress.isRefunded) {
            const refundTxHash =
              progress.sourceRefundTxHash || progress.destinationRefundTxHash || undefined
            if (didStatusChange) {
              notifications.addNotification({
                type: "success",
                title: "Refund completed",
                message: `Order ${bridgeId.slice(0, 10)}... has been refunded.`,
                txHash: refundTxHash,
                txNetwork: "btc",
                txExplorerUrls: orderExplorerLinks,
              })
            }
            lastGardenOrderStatusRef.current[bridgeId] = "refunded"
            await wallet.refreshOnchainBalances()
            return
          }

          if (progress.isExpired && didStatusChange) {
            notifications.addNotification({
              type: "warning",
              title: "Order expired",
              message: `Order ${bridgeId.slice(0, 10)}... expired. Click Claim Refund to process BTC return.`,
              txExplorerUrls: orderExplorerLinks,
            })
          }

          if (
            didStatusChange &&
            (progress.status === "initiated" || progress.status === "processing")
          ) {
            notifications.addNotification({
              type: "info",
              title: "Bridge processing",
              message: `Order ${bridgeId.slice(0, 10)}... is waiting for settlement.`,
              txExplorerUrls: orderExplorerLinks,
            })
          }
        } catch {
          // ignore transient polling errors
        }
      }

      const status = lastGardenOrderStatusRef.current[bridgeId]
      if (status !== "completed" && status !== "refunded") {
        notifications.addNotification({
          type: "info",
          title: "Bridge still processing",
          message: `Order ${bridgeId.slice(0, 10)}... masih diproses solver. Cek lagi beberapa menit.`,
          txExplorerUrls: orderExplorerLinks,
        })
      }
    },
    [notifications, wallet]
  )

  const handleSendBtcDepositFromWallet = React.useCallback(async () => {
    if (!pendingBtcDeposit) return
    if (pendingBtcDeposit.amountSats <= 0) {
      notifications.addNotification({
        type: "warning",
        title: "Invalid BTC amount",
        message: "Deposit amount from order is invalid. Create a new bridge order.",
      })
      return
    }

    setIsSendingBtcDeposit(true)
    try {
      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message: "Approve BTC transfer in UniSat/Xverse popup.",
      })
      const txHash = await wallet.sendBtcTransaction(
        pendingBtcDeposit.depositAddress,
        pendingBtcDeposit.amountSats
      )
      setPendingBtcDeposit((prev) =>
        prev
          ? {
              ...prev,
              txHash,
              status: "processing",
              lastUpdatedAt: Date.now(),
            }
          : prev
      )
      lastGardenOrderStatusRef.current[pendingBtcDeposit.bridgeId] = "processing"
      notifications.addNotification({
        type: "success",
        title: "BTC deposit submitted",
        message: `Deposit tx ${txHash.slice(0, 12)}... sent to Garden address.`,
        txHash,
        txNetwork: "btc",
      })
      void pollGardenBridgeOrder(pendingBtcDeposit.bridgeId, pendingBtcDeposit.destinationChain)
      await wallet.refreshOnchainBalances()
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Send BTC failed",
        message: error instanceof Error ? error.message : "Failed to send BTC deposit transaction.",
      })
    } finally {
      setIsSendingBtcDeposit(false)
    }
  }, [notifications, pendingBtcDeposit, pollGardenBridgeOrder, wallet])

  const handleClaimInstantRefund = React.useCallback(async () => {
    if (!pendingBtcDeposit) return
    setIsClaimingRefund(true)
    try {
      const orderLabel = pendingBtcDeposit.bridgeId.slice(0, 10)
      const instantRefundTx = (pendingBtcDeposit.instantRefundTx || "").trim()

      if (instantRefundTx) {
        notifications.addNotification({
          type: "info",
          title: "Broadcasting refund tx",
          message: `Broadcasting instant refund tx for order ${orderLabel}...`,
        })
        const refundTxHash = await broadcastBtcRawTransaction(instantRefundTx)
        setPendingBtcDeposit((prev) =>
          prev && prev.bridgeId === pendingBtcDeposit.bridgeId
            ? {
                ...prev,
                status: "refunded",
                refundTxHash,
                lastUpdatedAt: Date.now(),
              }
            : prev
        )
        notifications.addNotification({
          type: "success",
          title: "Refund submitted",
          message: `Refund tx ${refundTxHash.slice(0, 12)}... broadcast successfully.`,
          txHash: refundTxHash,
          txNetwork: "btc",
        })
        await wallet.refreshOnchainBalances()
        void pollGardenBridgeOrder(pendingBtcDeposit.bridgeId, pendingBtcDeposit.destinationChain)
        return
      }

      const refundResponse = await getGardenOrderInstantRefundHash(pendingBtcDeposit.bridgeId)
      const instantRefundHash =
        typeof refundResponse?.result === "string" ? refundResponse.result.trim() : ""
      if (!instantRefundHash) {
        throw new Error("Garden did not return an instant refund hash for this order.")
      }
      let copied = false
      try {
        await navigator.clipboard.writeText(instantRefundHash)
        copied = true
      } catch {
        copied = false
      }
      setPendingBtcDeposit((prev) =>
        prev && prev.bridgeId === pendingBtcDeposit.bridgeId
          ? {
              ...prev,
              instantRefundHash,
              lastUpdatedAt: Date.now(),
            }
          : prev
      )
      notifications.addNotification({
        type: "info",
        title: "Instant refund hash ready",
        message: copied
          ? `Refund hash for order ${orderLabel}... copied. Continue refund flow in wallet/Garden.`
          : `Refund hash for order ${orderLabel}... ready. Copy the hash from the panel and continue refund.`,
      })
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Claim refund failed",
        message: error instanceof Error ? error.message : "Unable to process instant refund.",
      })
    } finally {
      setIsClaimingRefund(false)
    }
  }, [notifications, pendingBtcDeposit, pollGardenBridgeOrder, wallet])

  /**
   * Handles `confirmTrade` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const confirmTrade = async () => {
    setPreviewOpen(false)
    setSwapState("confirming")
    setSwapState("processing")
    let tradeFinalized = true
    let submittedSwapTxHash: string | null = null
    const requestedHideBalance = hideBalanceOnchain
    const tradePrivacyPayload = requestedHideBalance
      ? await resolveHideBalancePrivacyPayload()
      : undefined
    const effectiveHideBalance = requestedHideBalance && !!tradePrivacyPayload

    try {
      if (
        requestedHideBalance &&
        HIDE_BALANCE_SHIELDED_POOL_V3 &&
        typeof tradePrivacyPayload?.spendable_at_unix === "number"
      ) {
        const remainingMs = Math.max(
          0,
          tradePrivacyPayload.spendable_at_unix * 1000 - Date.now()
        )
        if (remainingMs > 0) {
          throw new Error(
            `Hide Balance note masih dalam mixing window. Tunggu ${formatRemainingDuration(
              remainingMs
            )} sebelum execute.`
          )
        }
      }
      if (requestedHideBalance && !tradePrivacyPayload) {
        if (!HIDE_BALANCE_FALLBACK_TO_PUBLIC_ENABLED) {
          throw new Error(
            "Garaga payload belum siap untuk Hide Balance. Cek konfigurasi auto-proof backend lalu coba lagi."
          )
        }
        notifications.addNotification({
          type: "warning",
          title: "Hide Balance unavailable",
          message:
            "Proof belum siap. Transaksi dilanjutkan dalam mode publik supaya tidak blok user.",
        })
      }
      if (effectiveHideBalance && HIDE_BALANCE_SHIELDED_POOL && !HIDE_BALANCE_RELAYER_POOL_ENABLED) {
        throw new Error(
          "Hide Balance strict mode aktif: relayer pool harus enabled. Public wallet path diblok untuk cegah kebocoran data swap di explorer."
        )
      }
      if (isCrossChain) {
        const recipient = (receiveAddress || preferredReceiveAddress).trim()
        const sourceChain = chainFromNetwork(fromToken.network)
        const toChain = chainFromNetwork(toToken.network)
        if (isBridgeToStrkDisabledRoute(sourceChain, toChain, toToken.symbol)) {
          throw new Error(BRIDGE_TO_STRK_DISABLED_MESSAGE)
        }
        if (!isBridgePairSupportedForCurrentRoutes(sourceChain, toChain, fromToken.symbol, toToken.symbol)) {
          throw new Error(UNSUPPORTED_BRIDGE_PAIR_MESSAGE)
        }
        const xverseHint = xverseUserId.trim() || undefined
        const recipientFallbackFromXverse =
          toChain === "bitcoin" && !recipient ? xverseHint : undefined
        let sourceOwner =
          sourceChain === "ethereum"
            ? wallet.evmAddress || undefined
            : sourceChain === "starknet"
            ? wallet.starknetAddress || wallet.address || undefined
            : sourceChain === "bitcoin"
            ? wallet.btcAddress || undefined
            : undefined
        if (sourceChain === "ethereum") {
          sourceOwner = await getConnectedEvmAddressFromWallet()
        }
        if (!recipient && !recipientFallbackFromXverse) {
          throw new Error(`Recipient ${toChain} address is required.`)
        }

        const isSourceBitcoin = sourceChain === "bitcoin"
        const isGardenProvider = ((quote?.provider || "").trim().toLowerCase() === "garden")
        const isGardenSourceSigningFlow =
          isGardenProvider && (sourceChain === "ethereum" || sourceChain === "starknet")
        const txNetwork: "btc" | "evm" | "starknet" =
          sourceChain === "ethereum" ? "evm" : sourceChain === "bitcoin" ? "btc" : "starknet"
        const bridgePayloadBase = {
          from_chain: sourceChain,
          to_chain: toChain,
          token: fromToken.symbol,
          to_token: toToken.symbol,
          estimated_out_amount: quote?.toAmount || toAmount || undefined,
          amount: fromAmount,
          recipient,
          source_owner: sourceOwner,
          xverse_user_id:
            sourceChain === "bitcoin" || toChain === "bitcoin" ? xverseHint : undefined,
          mode: mevProtection ? "private" : "transparent",
          hide_balance: effectiveHideBalance,
          privacy: effectiveHideBalance ? tradePrivacyPayload : undefined,
        }
        let onchainTxHash: string | null = null
        let btcDepositTxHash: string | null = null
        let btcAutoSendAttempted = false
        let btcAutoSendSucceeded = false
        let gardenStarknetCalls: Array<{
          contractAddress: string
          entrypoint: string
          calldata: string[]
        }> | null = null
        let response: Awaited<ReturnType<typeof executeBridge>>

        if (isSourceBitcoin) {
          notifications.addNotification({
            type: "info",
            title: "Create BTC bridge order",
            message:
              "Submitting Garden order. After the order is created, send BTC to the provided deposit address.",
          })
          response = await executeBridge(bridgePayloadBase)
        } else if (isGardenSourceSigningFlow) {
          notifications.addNotification({
            type: "info",
            title: "Create Garden order",
            message: "Creating order and preparing source-chain transaction for wallet signature.",
          })
          const createOrderResponse = await executeBridge(bridgePayloadBase)
          const orderId = (createOrderResponse.bridge_id || "").trim()
          if (!orderId) {
            throw new Error("Garden order id is missing. Please retry bridge creation.")
          }
          notifications.addNotification({
            type: "info",
            title: "Garden order created",
            message: `Order ${orderId.slice(0, 10)}... created. Continue with wallet signature.`,
            txExplorerUrls: buildGardenOrderExplorerLinks(orderId),
          })

          if (sourceChain === "ethereum") {
            notifications.addNotification({
              type: "info",
              title: "Wallet signature required",
              message: "Confirm Garden source transaction in MetaMask.",
            })
            if (createOrderResponse.evm_approval_transaction) {
              await sendEvmTransactionFromWallet(createOrderResponse.evm_approval_transaction)
            }
            if (!createOrderResponse.evm_initiate_transaction) {
              throw new Error("Garden initiate transaction is missing for Ethereum source flow.")
            }
            onchainTxHash = await sendEvmTransactionFromWallet(
              createOrderResponse.evm_initiate_transaction
            )
          } else {
            notifications.addNotification({
              type: "info",
              title: "Wallet signature required",
              message: "Confirm Garden source transaction in your Starknet wallet.",
            })
            const starknetCalls: Array<{
              contractAddress: string
              entrypoint: string
              calldata: string[]
            }> = []
            let approvalWasLimited = false
            if (createOrderResponse.starknet_approval_transaction) {
              const approvalTx = createOrderResponse.starknet_approval_transaction
              const safeApproval = limitBridgeApprovalToExactAmount(
                approvalTx.calldata || [],
                fromAmount,
                fromToken.symbol
              )
              approvalWasLimited = safeApproval.limited
              starknetCalls.push({
                contractAddress: approvalTx.to,
                entrypoint: normalizeGardenStarknetEntrypoint(approvalTx.selector),
                calldata: safeApproval.calldata,
              })
            }
            if (createOrderResponse.starknet_initiate_transaction) {
              starknetCalls.push({
                contractAddress: createOrderResponse.starknet_initiate_transaction.to,
                entrypoint: normalizeGardenStarknetEntrypoint(
                  createOrderResponse.starknet_initiate_transaction.selector
                ),
                calldata: createOrderResponse.starknet_initiate_transaction.calldata || [],
              })
            }
            if (!starknetCalls.length) {
              throw new Error("Garden initiate transaction is missing for Starknet source flow.")
            }
            if (approvalWasLimited) {
              notifications.addNotification({
                type: "info",
                title: "Approval safety enabled",
                message: `Approval limited to exact ${fromAmount} ${fromToken.symbol} (not unlimited).`,
              })
            }
            gardenStarknetCalls = starknetCalls
            if (starknetCalls.length > 1) {
              const approvalCall = starknetCalls[0]
              const initiateCall = starknetCalls[starknetCalls.length - 1]
              const approvalSpender = String(approvalCall?.calldata?.[0] || "").trim()
              notifications.addNotification({
                type: "info",
                title: "Wallet warning may appear",
                message:
                  `Some wallets flag any approve call as high risk. This approval is limited to exact ${fromAmount} ${fromToken.symbol} ` +
                  `(spender ${shortAddress(approvalSpender)}).`,
              })
              notifications.addNotification({
                type: "info",
                title: "Wallet signature required",
                message: `Confirm bridge approval for ${fromAmount} ${fromToken.symbol}.`,
              })
              await invokeStarknetCallsFromWallet([approvalCall], starknetProviderHint)
              notifications.addNotification({
                type: "info",
                title: "Wallet signature required",
                message: `Confirm bridge initiate ${fromAmount} ${fromToken.symbol} -> ${toToken.symbol}.`,
              })
              onchainTxHash = await invokeStarknetCallsFromWallet([initiateCall], starknetProviderHint)
            } else {
              onchainTxHash = await invokeStarknetCallsFromWallet(starknetCalls, starknetProviderHint)
            }
          }

          notifications.addNotification({
            type: "info",
            title: "Bridge pending",
            message: `Bridge ${fromAmount} ${fromToken.symbol} submitted on-chain (${onchainTxHash.slice(0, 10)}...).`,
            txHash: onchainTxHash,
            txNetwork,
          })
          if (!onchainTxHash) {
            throw new Error("Bridge on-chain tx hash is missing after wallet signature.")
          }

          const submitGardenFinalize = async (txHash: string) => {
            return executeBridge({
              ...bridgePayloadBase,
              existing_bridge_id: orderId,
              onchain_tx_hash: txHash,
            })
          }
          try {
            response = await submitGardenFinalize(onchainTxHash)
          } catch (finalizeError) {
            if (
              sourceChain === "starknet" &&
              gardenStarknetCalls &&
              gardenStarknetCalls.length >= 2 &&
              isStarknetEntrypointMissingError(finalizeError)
            ) {
              notifications.addNotification({
                type: "warning",
                title: "Retrying bridge submit",
                message:
                  "Bridge multicall hit ENTRYPOINT_NOT_FOUND. Retrying with split signatures (approve then initiate).",
              })
              const approvalCall = gardenStarknetCalls[0]
              const initiateCall = gardenStarknetCalls[gardenStarknetCalls.length - 1]
              notifications.addNotification({
                type: "info",
                title: "Wallet signature required",
                message: `Confirm bridge approval for ${fromAmount} ${fromToken.symbol}.`,
              })
              await invokeStarknetCallsFromWallet([approvalCall], starknetProviderHint)
              notifications.addNotification({
                type: "info",
                title: "Wallet signature required",
                message: `Confirm bridge initiate ${fromAmount} ${fromToken.symbol} -> ${toToken.symbol}.`,
              })
              const retryOnchainTxHash = await invokeStarknetCallsFromWallet(
                [initiateCall],
                starknetProviderHint
              )
              notifications.addNotification({
                type: "info",
                title: "Bridge pending",
                message: `Bridge ${fromAmount} ${fromToken.symbol} retry submitted (${retryOnchainTxHash.slice(0, 10)}...).`,
                txHash: retryOnchainTxHash,
                txNetwork,
              })
              response = await submitGardenFinalize(retryOnchainTxHash)
            } else {
              throw finalizeError
            }
          }
        } else {
          notifications.addNotification({
            type: "info",
            title: "Wallet signature required",
            message:
              sourceChain === "ethereum"
                ? "Confirm bridge transaction in MetaMask (StarkGate). Final value in MetaMask includes amount + L1 message fee + gas, so it may differ slightly from the UI estimate."
                : "Confirm bridge transaction in your Starknet wallet.",
          })
          onchainTxHash = await submitOnchainBridgeTx()
          notifications.addNotification({
            type: "info",
            title: "Bridge pending",
            message: `Bridge ${fromAmount} ${fromToken.symbol} submitted on-chain (${onchainTxHash.slice(0, 10)}...).`,
            txHash: onchainTxHash,
            txNetwork,
          })
          response = await executeBridge({
            ...bridgePayloadBase,
            onchain_tx_hash: onchainTxHash || undefined,
          })
        }
        const normalizedStatus = (response.status || "").toLowerCase()
        const isBridgeFinalized = normalizedStatus === "completed" || normalizedStatus === "success"
        const gardenOrderExplorerLinks =
          isGardenProvider && response.bridge_id
            ? buildGardenOrderExplorerLinks(response.bridge_id)
            : undefined
        tradeFinalized = isBridgeFinalized
        if (response.privacy_tx_hash) {
          notifications.addNotification({
            type: "info",
            title: "Garaga verification submitted",
            message: `Privacy tx ${response.privacy_tx_hash.slice(0, 12)}... was submitted on Starknet.`,
            txHash: response.privacy_tx_hash,
            txNetwork: "starknet",
          })
        }

        if (sourceChain === "bitcoin" && response.deposit_address) {
          const parsedAmountSats = Number.parseInt(String(response.deposit_amount || "0"), 10)
          const amountSats = Number.isFinite(parsedAmountSats) && parsedAmountSats > 0 ? parsedAmountSats : 0
          const btcAmountDisplay =
            amountSats > 0
              ? formatBtcFromSats(amountSats)
              : "required amount"
          setPendingBtcDeposit({
            bridgeId: response.bridge_id,
            depositAddress: response.deposit_address,
            amountSats,
            destinationChain: toChain,
            status: "pending_deposit",
            txHash: null,
            sourceInitiateTxHash: null,
            destinationInitiateTxHash: null,
            destinationRedeemTxHash: null,
            refundTxHash: null,
            instantRefundTx: null,
            instantRefundHash: null,
            lastUpdatedAt: Date.now(),
          })
          lastGardenOrderStatusRef.current[response.bridge_id] = "pending_deposit"
          notifications.addNotification({
            type: "info",
            title: "Bridge order created",
            message: `Order ${response.bridge_id.slice(0, 10)}... ready. Send ${btcAmountDisplay} to ${response.deposit_address} to continue settlement.`,
            txExplorerUrls: gardenOrderExplorerLinks,
          })

          if (wallet.btcAddress && amountSats > 0) {
            btcAutoSendAttempted = true
            setIsSendingBtcDeposit(true)
            try {
              notifications.addNotification({
                type: "info",
                title: "Wallet signature required",
                message: "Approve BTC transfer in UniSat/Xverse popup.",
              })
              btcDepositTxHash = await wallet.sendBtcTransaction(response.deposit_address, amountSats)
              btcAutoSendSucceeded = true
              setPendingBtcDeposit((prev) =>
                prev && prev.bridgeId === response.bridge_id
                  ? {
                      ...prev,
                      txHash: btcDepositTxHash,
                      status: "processing",
                      lastUpdatedAt: Date.now(),
                    }
                  : prev
              )
              lastGardenOrderStatusRef.current[response.bridge_id] = "processing"
              notifications.addNotification({
                type: "success",
                title: "BTC deposit submitted",
                message: `Deposit tx ${btcDepositTxHash.slice(0, 12)}... sent to Garden address.`,
                txHash: btcDepositTxHash,
                txNetwork: "btc",
              })
              void pollGardenBridgeOrder(response.bridge_id, toChain)
              await wallet.refreshOnchainBalances()
            } catch (depositError) {
              notifications.addNotification({
                type: "warning",
                title: "Auto-send BTC skipped",
                message:
                  depositError instanceof Error
                    ? `${depositError.message} Continue with manual send via Send BTC button.`
                    : "Popup wallet dibatalkan/gagal. Continue with manual send via Send BTC button.",
              })
            } finally {
              setIsSendingBtcDeposit(false)
            }
          } else if (!wallet.btcAddress) {
            notifications.addNotification({
              type: "warning",
              title: "BTC wallet not connected",
              message: "Connect UniSat/Xverse first to send BTC deposit on-chain.",
            })
          }
        } else if (sourceChain === "bitcoin") {
          setPendingBtcDeposit(null)
          notifications.addNotification({
            type: "warning",
            title: "Deposit address missing",
            message: "Order was created, but BTC deposit address is not available yet. Refresh quote and submit again.",
          })
        }

        if (!isBridgeFinalized && isGardenProvider && response.bridge_id && sourceChain !== "bitcoin") {
          void pollGardenBridgeOrder(response.bridge_id, toChain)
        }
        if (!isSourceBitcoin || isBridgeFinalized) {
          notifications.addNotification({
            type: isBridgeFinalized ? "success" : "info",
            title: isBridgeFinalized ? "Bridge completed" : "Bridge submitted",
            message: isBridgeFinalized
              ? `Bridge ${fromAmount} ${fromToken.symbol} to ${toToken.symbol} completed.`
              : `Bridge ${fromAmount} ${fromToken.symbol} is still processing settlement to ${toToken.network}.`,
            txHash: onchainTxHash || undefined,
            txNetwork,
            txExplorerUrls: gardenOrderExplorerLinks,
          })
        } else if (btcAutoSendSucceeded) {
          notifications.addNotification({
            type: "info",
            title: "Bridge processing",
            message: `Order ${response.bridge_id.slice(0, 10)}... BTC deposit received. Waiting for settlement.`,
            txHash: btcDepositTxHash || undefined,
            txNetwork: "btc",
            txExplorerUrls: gardenOrderExplorerLinks,
          })
        } else if (btcAutoSendAttempted) {
          notifications.addNotification({
            type: "warning",
            title: "Deposit not sent yet",
            message: `Order ${response.bridge_id.slice(0, 10)}... was created, but BTC deposit has not been sent yet.`,
            txExplorerUrls: gardenOrderExplorerLinks,
          })
        }
        const bridgeEstimatedPoints = Number(response.estimated_points_earned || 0)
        const bridgeDiscountPercent = Number(response.nft_discount_percent || 0)
        const bridgeDiscountSaved = Number(response.fee_discount_saved || 0)
        const bridgeAiBonusPercent = Number(response.ai_level_points_bonus_percent || 0)
        const bridgePointsPending = !!response.points_pending
        const bridgePointsLabel =
          Number.isFinite(bridgeEstimatedPoints) && bridgeEstimatedPoints > 0
            ? `Points +${bridgeEstimatedPoints.toFixed(2)} (estimated${bridgePointsPending ? ", pending settlement" : ""})`
            : "Points +0 (estimated)"
        const bridgeDiscountLabel =
          Number.isFinite(bridgeDiscountPercent) && bridgeDiscountPercent > 0
            ? `NFT discount ${bridgeDiscountPercent.toFixed(2)}% active (fee saved ${bridgeDiscountSaved.toFixed(8)} ${fromToken.symbol}).`
            : "NFT discount not active on this bridge."
        const bridgeAiBonusLabel =
          Number.isFinite(bridgeAiBonusPercent) && bridgeAiBonusPercent > 0
            ? `AI level bridge bonus +${bridgeAiBonusPercent.toFixed(2)}% active.`
            : "AI level bridge bonus not active (Level 1)."
        notifications.addNotification({
          type: "info",
          title: "Points & Discount",
          message: `${bridgePointsLabel}. ${bridgeDiscountLabel} ${bridgeAiBonusLabel}`,
        })
      } else {
        const slippageValue = Number(activeSlippage || "0.5")
        const toTokenDecimals = TOKEN_DECIMALS[toToken.symbol.toUpperCase()] ?? 6
        const minAmountPrecision = Math.min(8, Math.max(6, toTokenDecimals))
        const minAmountOut = (
          Number.parseFloat(toAmount || "0") * (1 - slippageValue / 100)
        ).toFixed(minAmountPrecision)
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20
        const recipient = (receiveAddress || preferredReceiveAddress).trim() || undefined
        const submittedPrivacyPayload =
          effectiveHideBalance ? loadTradePrivacyPayload() || tradePrivacyPayload : undefined
        const swapRequestRecipient = effectiveHideBalance ? undefined : recipient
        let response: Awaited<ReturnType<typeof executeSwap>>
        let finalTxHash: string | undefined

        if (effectiveHideBalance && HIDE_BALANCE_RELAYER_POOL_ENABLED) {
          notifications.addNotification({
            type: "info",
            title: "Submitting private swap",
            message: "Submitting hide-mode swap through Starknet relayer pool.",
          })
          try {
            if (HIDE_BALANCE_SHIELDED_POOL) {
              response = await executeSwap({
                from_token: fromToken.symbol,
                to_token: toToken.symbol,
                amount: fromAmount,
                min_amount_out: minAmountOut,
                slippage: slippageValue,
                deadline,
                recipient: swapRequestRecipient,
                mode: mevProtection ? "private" : "transparent",
                hide_balance: true,
                privacy: submittedPrivacyPayload,
              })
              finalTxHash = response.tx_hash
              submittedSwapTxHash = response.tx_hash || null
            } else {
              const fromTokenAddress = resolveTokenAddress(fromToken.symbol).trim()
              if (!fromTokenAddress) {
                throw new Error(
                  `Token address for ${fromToken.symbol} is not configured for hide-mode relayer execution.`
                )
              }
              const currentCalls =
                quote?.type === "swap" && Array.isArray(quote.onchainCalls) ? quote.onchainCalls : []
              let swapActionCall = currentCalls.find((call) => call.entrypoint === "execute_swap")
              if (!swapActionCall) {
                const refreshedQuote = await getSwapQuote({
                  from_token: fromToken.symbol,
                  to_token: toToken.symbol,
                  amount: fromAmount,
                  slippage: slippageValue,
                  mode: mevProtection ? "private" : "transparent",
                })
                const refreshedCalls = Array.isArray(refreshedQuote.onchain_calls)
                  ? refreshedQuote.onchain_calls
                      .filter(
                        (call) =>
                          call &&
                          typeof call.contract_address === "string" &&
                          typeof call.entrypoint === "string" &&
                          Array.isArray(call.calldata)
                      )
                      .map((call) => ({
                        contractAddress: call.contract_address.trim(),
                        entrypoint: call.entrypoint.trim(),
                        calldata: call.calldata.map((item) => String(item)),
                      }))
                  : []
                swapActionCall = refreshedCalls.find((call) => call.entrypoint === "execute_swap")
              }
              if (!swapActionCall) {
                throw new Error("Unable to build execute_swap calldata for hide relayer path.")
              }

              const relayed = await executeHideViaRelayer({
                flow: "swap",
                actionCall: swapActionCall,
                tokenAddress: fromTokenAddress,
                amount: fromAmount,
                tokenDecimals: TOKEN_DECIMALS[fromToken.symbol.toUpperCase()] ?? 18,
                providerHint: starknetProviderHint,
                verifier: (submittedPrivacyPayload?.verifier || "garaga").trim() || "garaga",
                deadline,
                txContext: {
                  flow: "swap",
                  from_token: fromToken.symbol,
                  to_token: toToken.symbol,
                  amount: fromAmount,
                  recipient: submittedPrivacyPayload?.recipient || recipient,
                  from_network: fromToken.network,
                  to_network: toToken.network,
                  note_version: HIDE_BALANCE_SHIELDED_POOL_V3 ? "v3" : undefined,
                  denom_id:
                    submittedPrivacyPayload?.denom_id ||
                    (hideStrkDenomEnabled ? selectedHideStrkDenom.id : undefined),
                  note_commitment: submittedPrivacyPayload?.note_commitment,
                  spendable_at_unix: submittedPrivacyPayload?.spendable_at_unix,
                  nullifier: submittedPrivacyPayload?.nullifier,
                },
              })
              persistTradePrivacyPayload(relayed.privacyPayload)
              setHasTradePrivacyPayload(true)

              response = await executeSwap({
                from_token: fromToken.symbol,
                to_token: toToken.symbol,
                amount: fromAmount,
                min_amount_out: minAmountOut,
                slippage: slippageValue,
                deadline,
                recipient: swapRequestRecipient,
                onchain_tx_hash: relayed.txHash,
                mode: mevProtection ? "private" : "transparent",
                hide_balance: true,
                privacy: relayed.privacyPayload,
              })
              finalTxHash = response.tx_hash
              submittedSwapTxHash = response.tx_hash || relayed.txHash || null
            }
            if (finalTxHash) {
              notifications.addNotification({
                type: "info",
                title: "Private swap pending",
                message: `Hide swap ${fromAmount} ${fromToken.symbol} submitted (${finalTxHash.slice(0, 10)}...).`,
                txHash: finalTxHash,
                txNetwork: "starknet",
              })
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error || "")
            if (/request timeout|failed to fetch|network error|network_error/i.test(message)) {
              throw new Error(
                "Backend API tidak terhubung. Jalankan backend di port 8080 dulu, lalu retry private swap."
              )
            }
            if (/swap requires onchain_tx_hash/i.test(message)) {
              throw new Error(
                "Backend relayer hide-mode belum aktif (masih minta onchain_tx_hash). Set HIDE_BALANCE_RELAYER_POOL_ENABLED=true lalu restart backend."
              )
            }
            const noteDepositPayload =
              submittedPrivacyPayload || tradePrivacyPayload || loadTradePrivacyPayload()
            const payloadLooksV3 =
              (noteDepositPayload?.note_version || "").trim().toLowerCase() === "v3"
            if (
              (HIDE_BALANCE_SHIELDED_POOL_V3 ||
                payloadLooksV3 ||
                /hide balance v3/i.test(message)) &&
              /note belum terdaftar/i.test(message) &&
              noteDepositPayload
            ) {
              try {
                const spendableAtUnix = await ensureHideV3NoteDeposited(noteDepositPayload)
                const remainingMs = Math.max(0, spendableAtUnix * 1000 - Date.now())
                throw new Error(
                  `Hide note berhasil dideposit. Tunggu ${formatRemainingDuration(
                    remainingMs
                  )} sebelum retry private swap.`
                )
              } catch (depositError) {
                const depositMessage =
                  depositError instanceof Error ? depositError.message : String(depositError || "")
                throw new Error(
                  `Hide note belum terdaftar dan auto-deposit gagal. Detail: ${depositMessage}`
                )
              }
            }
            throw new Error(
              `Hide relayer unavailable. Wallet fallback diblok agar detail swap tidak bocor di explorer. Detail: ${message}`
            )
          }
        } else {
          notifications.addNotification({
            type: "info",
            title: "Wallet signature required",
            message: "Confirm swap transaction in your Starknet wallet.",
          })
          const onchainTxHash = await submitOnchainSwapTx(tradePrivacyPayload, effectiveHideBalance)
          submittedSwapTxHash = onchainTxHash
          finalTxHash = onchainTxHash

          notifications.addNotification({
            type: "info",
            title: "Swap pending",
            message: `Swap ${fromAmount} ${fromToken.symbol} submitted on-chain (${onchainTxHash.slice(0, 10)}...).`,
            txHash: onchainTxHash,
            txNetwork: "starknet",
          })

          response = await executeSwap({
            from_token: fromToken.symbol,
            to_token: toToken.symbol,
            amount: fromAmount,
            min_amount_out: minAmountOut,
            slippage: slippageValue,
            deadline,
            recipient: swapRequestRecipient,
            onchain_tx_hash: onchainTxHash || undefined,
            mode: mevProtection ? "private" : "transparent",
            hide_balance: effectiveHideBalance,
            privacy: submittedPrivacyPayload,
          })
        }

        notifications.addNotification({
          type: "success",
          title: "Swap completed",
          message: `Swap ${fromAmount} ${fromToken.symbol} → ${response.to_amount} ${toToken.symbol}`,
          txHash: finalTxHash,
          txNetwork: "starknet",
        })
        const swapEstimatedPoints = Number(response.estimated_points_earned || 0)
        const swapDiscountPercent = Number(response.nft_discount_percent || 0)
        const swapDiscountSaved = Number(response.fee_discount_saved || 0)
        const pointsLabel =
          Number.isFinite(swapEstimatedPoints) && swapEstimatedPoints > 0
            ? `Points +${swapEstimatedPoints.toFixed(2)} (estimasi)`
            : "Points +0 (estimasi)"
        const discountLabel =
          Number.isFinite(swapDiscountPercent) && swapDiscountPercent > 0
            ? `NFT discount ${swapDiscountPercent.toFixed(2)}% aktif (hemat fee ${swapDiscountSaved.toFixed(8)} ${fromToken.symbol}).`
            : "NFT discount tidak aktif di swap ini."
        notifications.addNotification({
          type: "info",
          title: "Points & Discount",
          message: `${pointsLabel}. ${discountLabel}`,
        })
        if (response.privacy_tx_hash) {
          notifications.addNotification({
            type: "info",
            title: "Garaga verification submitted",
            message: `Privacy tx ${response.privacy_tx_hash.slice(0, 12)}... was submitted on Starknet.`,
            txHash: response.privacy_tx_hash,
            txNetwork: "starknet",
          })
        }
      }
      await Promise.allSettled([wallet.refreshPortfolio(), wallet.refreshOnchainBalances()])
      const [nftState, rewardsState] = await Promise.allSettled([
        getOwnedNfts({ force: true }),
        getRewardsPoints({ force: true }),
      ])
      if (nftState.status === "fulfilled") {
        const now = Math.floor(Date.now() / 1000)
        const usable = nftState.value.find((nft) => !nft.used && (!nft.expiry || nft.expiry > now))
        setActiveNft((prev) => {
          if (usable) return usable
          if (prev && !prev.used && (!prev.expiry || prev.expiry > now)) return prev
          return null
        })
      }
      if (rewardsState.status === "fulfilled") {
        const parsedMultiplier = Number(rewardsState.value.multiplier)
        setStakePointsMultiplier(
          Number.isFinite(parsedMultiplier) && parsedMultiplier > 0 ? parsedMultiplier : 1
        )
      }
      if (tradeFinalized) {
        setSwapState("success")
      }
    } catch (error) {
      if (isCrossChain && error instanceof Error && error.message.toLowerCase().includes("xverse")) {
        notifications.addNotification({
          type: "error",
          title: "BTC address not found",
          message:
            "We could not resolve your BTC address. Check the Xverse User ID (if used) or enter a receive address manually.",
        })
      }
      const timeoutCode =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code || "").toUpperCase()
          : ""
      const isTimeoutError =
        timeoutCode === "TIMEOUT" ||
        (error instanceof Error && error.message.toLowerCase().includes("timeout"))
      if (!isCrossChain && submittedSwapTxHash && isTimeoutError) {
        notifications.addNotification({
          type: "warning",
          title: "Swap still processing",
          message: `Swap sudah submit on-chain (${submittedSwapTxHash.slice(0, 10)}...), tapi respons backend timeout. Cek explorer atau riwayat transaksi.`,
          txHash: submittedSwapTxHash,
          txNetwork: "starknet",
        })
        setSwapState("success")
        return
      }
      notifications.addNotification({
        type: "error",
        title: "Trade failed",
        message: error instanceof Error ? error.message : "Failed to execute trade",
      })
      setSwapState("error")
    } finally {
      if (hideBalanceOnchain) {
        clearTradePrivacyPayload()
        setHasTradePrivacyPayload(false)
      }
      setTimeout(() => {
        setSwapState("idle")
      }, 2500)
    }
  }

  return (
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
                    clearTradePrivacyPayload()
                    void resolveHideBalancePrivacyPayload()
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
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Zap className="h-3 w-3 text-secondary" />
              Best Route via {quote?.type === "bridge" ? (quote.provider || "Bridge") : "Auto"}
            </span>
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

        {/* Settings Panel - Collapsible */}
        <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen} className="mt-3 sm:mt-4">
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between p-3 rounded-xl bg-surface/30 border border-border/50 hover:border-primary/30 transition-colors">
              <span className="text-sm font-medium text-foreground flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Trade Settings
              </span>
              {settingsOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-4 p-4 rounded-xl bg-surface/20 border border-border/30">
            {/* MEV Protection */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                <span className="text-sm text-foreground">MEV Protection</span>
              </div>
              <button 
                onClick={() => setMevProtectionEnabled((prev) => !prev)}
                disabled={mode !== "private"}
                className={cn(
                  "w-11 h-6 rounded-full transition-colors relative",
                  mode !== "private" && "opacity-50 cursor-not-allowed",
                  mevProtection ? "bg-primary" : "bg-muted"
                )}
              >
                <span className={cn(
                  "absolute top-1 w-4 h-4 rounded-full bg-background transition-transform",
                  mevProtection ? "left-6" : "left-1"
                )} />
              </button>
            </div>
            {mode !== "private" && (
              <p className="text-xs text-muted-foreground">
                Aktif hanya di Private Mode. Saat mode biasa, selalu Disabled.
              </p>
            )}

            {hideBalanceOnchain && (
              hasTradePrivacyPayload ? (
                <p className="text-xs text-warning">
                  {hideMixingWindowBlocked
                    ? `On-chain Hide Balance aktif. Mixing window berjalan: ${formatRemainingDuration(
                        hideMixingWindowRemainingMs
                      )}.`
                    : "On-chain Hide Balance aktif (ikon mata kanan atas)."}
                </p>
              ) : (
                <p className="text-xs text-warning">
                  {isAutoPrivacyProvisioning
                    ? "Menyiapkan payload Garaga otomatis..."
                    : DEV_AUTO_GARAGA_PAYLOAD_ENABLED
                    ? "Hide Balance aktif. Sistem akan auto-generate payload mock (dev mode) saat execute."
                    : "Hide Balance aktif. Sistem akan menyiapkan payload Garaga otomatis saat Execute Trade."}
                </p>
              )
            )}
            {hideBalanceOnchain && HIDE_BALANCE_SHIELDED_POOL_V3 && activeHideRecipient && (
              <p className="text-xs text-muted-foreground">
                Recipient note V3 terkunci: {shortenAddress(activeHideRecipient)}
              </p>
            )}
            {hideBalanceOnchain &&
              HIDE_BALANCE_SHIELDED_POOL_V3 &&
              hasTradePrivacyPayload &&
              activeHideRecipientMismatched && (
                <p className="text-xs text-warning">
                  Receive address saat ini berbeda dari recipient note V3. Eksekusi tetap memakai
                  recipient yang terkunci di note.
                </p>
              )}
            {hideStrkDenomEnabled && (
              <div>
                <label className="text-sm text-foreground mb-2 block">
                  Hide Denomination (STRK)
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {HIDE_STRK_DENOM_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      onClick={() => setHideStrkDenomId(option.id)}
                      className={cn(
                        "py-2 rounded-lg text-xs font-medium transition-all border",
                        hideStrkDenomId === option.id
                          ? "bg-primary/20 text-primary border-primary"
                          : "bg-surface text-muted-foreground border-border hover:border-primary/50"
                      )}
                    >
                      {option.amount}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Denom note V3: {selectedHideStrkDenom.amount} STRK.
                </p>
              </div>
            )}

            {/* Slippage Tolerance */}
            <div>
              <label className="text-sm text-foreground mb-2 block">Slippage Tolerance</label>
              <div className="flex gap-2">
                {slippagePresets.map((val) => (
                  <button
                    key={val}
                    onClick={() => { setSlippage(val); setCustomSlippage(""); }}
                    className={cn(
                      "flex-1 py-2 rounded-lg text-xs font-medium transition-all",
                      slippage === val && !customSlippage
                        ? "bg-primary/20 text-primary border border-primary"
                        : "bg-surface text-muted-foreground border border-border hover:border-primary/50"
                    )}
                  >
                    {val}%
                  </button>
                ))}
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={customSlippage}
                    inputMode="decimal"
                    onChange={(e) => {
                      const sanitized = sanitizeDecimalInput(e.target.value, 2)
                      if (!sanitized) {
                        setCustomSlippage("")
                        return
                      }
                      const parsed = Number(sanitized)
                      if (!Number.isFinite(parsed)) return
                      setCustomSlippage(String(Math.min(parsed, 50)))
                    }}
                    placeholder="Auto"
                    className="w-full py-2 px-2 rounded-lg text-xs font-medium bg-surface text-foreground border border-border focus:border-primary outline-none text-center"
                  />
                  {customSlippage && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span>}
                </div>
              </div>
            </div>

            {/* Estimated Amount Received */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface/50">
              <span className="text-sm text-muted-foreground">Estimated Received</span>
              <span className="text-sm font-medium text-foreground">
                {toAmount ? `${Number.parseFloat(toAmount).toFixed(4)} ${toToken.symbol}` : "—"}
              </span>
            </div>
            {quote?.type === "bridge" && bridgeTokenMismatch && (
              <div className="p-3 rounded-lg bg-warning/10 border border-warning/30">
                <p className="text-xs text-foreground">
                  Original bridge quote:{" "}
                  <span className="font-medium">
                    {formatTokenAmount(quote.bridgeSourceAmount ?? 0, 8)} {fromToken.symbol}
                  </span>
                  . The {toToken.symbol} above value is the live conversion estimate (already includes assumed swap fee + slippage).
                </p>
              </div>
            )}

            {/* Receive Address */}
            <div>
              <label className="text-sm text-foreground mb-2 block">Receive Address</label>
              <input
                type="text"
                value={receiveAddress}
                onChange={(e) => {
                  setIsReceiveAddressManual(true)
                  setReceiveAddress(e.target.value)
                }}
                className="w-full py-2 px-3 rounded-lg text-sm bg-surface text-foreground border border-border focus:border-primary outline-none"
              />
              {isCrossChain && (
                <p className="mt-2 text-xs text-muted-foreground">
                  If you use UniSat, enter BTC receive address manually. Xverse User ID is optional only for Xverse-managed BTC.
                </p>
              )}
            </div>

            {isCrossChain && targetChain === "bitcoin" && (
              <div>
                <label className="text-sm text-foreground mb-2 block">Xverse User ID (optional)</label>
                <input
                  type="text"
                  value={xverseUserId}
                  onChange={(e) => setXverseUserId(e.target.value)}
                  placeholder="Use if BTC address is managed by Xverse"
                  className="w-full py-2 px-3 rounded-lg text-sm bg-surface text-foreground border border-border focus:border-primary outline-none"
                />
              </div>
            )}

            {isCrossChain && sourceChain === "bitcoin" && (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-primary/10 border border-primary/30 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">BTC Vault Address (Testnet)</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={handleCopyBtcVaultAddress}
                      disabled={!BTC_VAULT_ADDRESS}
                    >
                      {btcVaultCopied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <p className="font-mono text-xs text-foreground break-all">
                    {BTC_VAULT_ADDRESS ||
                      "Set NEXT_PUBLIC_BTC_VAULT_ADDRESS di frontend/.env.local"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => openExternalUrl(BTC_TESTNET_FAUCET_URL)}
                    >
                      Open BTC Testnet Faucet
                    </Button>
                    {btcVaultExplorerUrl && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => openExternalUrl(btcVaultExplorerUrl)}
                      >
                        View Vault on Explorer
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    For Garden quickstart flow, click Execute Trade first to create an order and
                    get a dynamic BTC deposit address (`result.to`). The vault address in this panel
                    is for tester reference only.
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    If faucet is unavailable, fallback top-up can use ETH Sepolia to BTC Testnet bridge,
                    then continue deposit to the Garden order BTC address.
                  </p>
                </div>
              </div>
            )}

            {/* Transaction Fee Breakdown */}
            <div className="space-y-2 p-3 rounded-lg bg-surface/50">
              {quote?.type === "bridge" ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{bridgeProtocolFeeLabel}</span>
                    <span className="text-sm text-foreground">{protocolFeeDisplay}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{bridgeNetworkFeeLabel}</span>
                    <span className="text-sm text-foreground">{networkFeeDisplay}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">MEV Fee ({mevFeePercent}%)</span>
                    <span className="text-sm text-foreground">{mevFeeDisplay}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-2">
                    <span className="text-sm font-medium text-foreground">Total Fee</span>
                    <span className="text-sm font-medium text-foreground">{feeDisplayLabel}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Provider</span>
                    <span className="text-sm text-foreground">{routeLabel}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Protocol Fee</span>
                    <span className="text-sm text-foreground">{protocolFeeDisplay}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">MEV Fee ({mevFeePercent}%)</span>
                    <span className="text-sm text-foreground">{mevFeeDisplay}</span>
                  </div>
                  {hasNftDiscount && (
                    <div className="flex items-center justify-between text-success">
                      <span className="text-sm flex items-center gap-1">
                        <Sparkles className="h-3 w-3" />
                        NFT Discount
                      </span>
                      <span className="text-sm">-{discountPercent}%</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between border-t border-border pt-2">
                    <span className="text-sm font-medium text-foreground">Total Fee</span>
                    <span className="text-sm font-medium text-foreground">
                      {feeDisplayLabel}
                    </span>
                  </div>
                  {hasNftDiscount && feeSavingsUsd > 0 && (
                    <div className="flex items-center justify-between text-success">
                      <span className="text-xs">Fee saved (NFT)</span>
                      <span className="text-xs">-${feeSavingsUsd.toFixed(2)}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Points Estimate */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-accent/10 border border-accent/20">
              <div>
                <span className="text-sm text-foreground flex items-center gap-2">
                  <Gift className="h-4 w-4 text-accent" />
                  Estimated Points
                </span>
                {basePointsEarned !== null && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Base +{basePointsEarned}
                    {normalizedStakeMultiplier > 1 ? ` × Stake ${formatMultiplier(normalizedStakeMultiplier)}` : ""}
                    {nftPointsMultiplier > 1 ? ` × NFT ${formatMultiplier(nftPointsMultiplier)}` : ""}
                  </p>
                )}
              </div>
              <span className="text-sm font-bold text-accent">{pointsEarned === null ? "—" : `+${pointsEarned}`}</span>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* NFT Discount Counter */}
        {hasNftDiscount && (
          <div className="mt-3 sm:mt-4 p-3 rounded-xl bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                NFT Discount Active
              </span>
              <span className="text-xs text-muted-foreground">{discountPercent}% off fees</span>
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
              {nftPointsMultiplier > 1 ? ` • NFT: ${formatMultiplier(nftPointsMultiplier)}` : ""}
            </p>
          </div>
        )}

        {showPendingBtcDeposit && pendingBtcDeposit && (
          <div className="mt-3 p-3 rounded-xl bg-primary/10 border border-primary/30 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">
                {pendingIsFinalized ? "BTC Bridge Status (Garden)" : "Pending BTC Deposit (Garden)"}
              </p>
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
            <p className="text-xs text-foreground break-all">
              Send{" "}
              <span className="font-semibold">
                {formatBtcFromSats(pendingBtcDeposit.amountSats)}
              </span>{" "}
              to{" "}
              <span className="font-mono">{pendingBtcDeposit.depositAddress}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={handleSendBtcDepositFromWallet}
                disabled={
                  isSendingBtcDeposit ||
                  !wallet.btcAddress ||
                  pendingBtcDeposit.amountSats <= 0 ||
                  pendingIsFinalized ||
                  !!pendingBtcDeposit.txHash
                }
                className="h-8 px-3 text-xs"
              >
                {isSendingBtcDeposit ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Waiting signature...
                  </span>
                ) : pendingBtcDeposit.txHash ? (
                  "Deposit Sent"
                ) : (
                  `Send BTC (${btcProviderLabel})`
                )}
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
              {pendingCanClaimRefund && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-3 text-xs"
                  onClick={handleClaimInstantRefund}
                  disabled={isClaimingRefund}
                >
                  {isClaimingRefund ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Claiming...
                    </span>
                  ) : (
                    "Claim Refund"
                  )}
                </Button>
              )}
              {btcDepositExplorerUrl && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-3 text-xs"
                  onClick={() => openExternalUrl(btcDepositExplorerUrl)}
                >
                  View Deposit Address
                </Button>
              )}
            </div>
            {!wallet.btcAddress && (
              <p className="text-[11px] text-warning">
                Connect BTC wallet first so the send button can be used.
              </p>
            )}
            {wallet.btcAddress && !isSendingBtcDeposit && !pendingBtcDeposit.txHash && (
              <p className="text-[11px] text-muted-foreground">
                Click Send button to show signature popup in {btcProviderLabel}.
              </p>
            )}
            {pendingBtcDeposit.txHash && (
              <p className="text-[11px] text-success break-all">
                Last deposit tx: {pendingBtcDeposit.txHash}
              </p>
            )}
            {pendingBtcDeposit.sourceInitiateTxHash && (
              <p className="text-[11px] text-muted-foreground break-all">
                Source initiate tx: {pendingBtcDeposit.sourceInitiateTxHash}
              </p>
            )}
            {pendingBtcDeposit.destinationInitiateTxHash && (
              <p className="text-[11px] text-muted-foreground break-all">
                Destination initiate tx: {pendingBtcDeposit.destinationInitiateTxHash}
              </p>
            )}
            {pendingBtcDeposit.destinationRedeemTxHash && (
              <p className="text-[11px] text-success break-all">
                Destination redeem tx: {pendingBtcDeposit.destinationRedeemTxHash}
              </p>
            )}
            {pendingBtcDeposit.refundTxHash && (
              <p className="text-[11px] text-success break-all">
                Refund tx: {pendingBtcDeposit.refundTxHash}
              </p>
            )}
            {pendingBtcDeposit.instantRefundHash && (
              <p className="text-[11px] text-muted-foreground break-all">
                Instant refund hash: {pendingBtcDeposit.instantRefundHash}
              </p>
            )}
            {(pendingOrderStatus === "expired" || pendingOrderStatus === "failed") && (
              <p className="text-[11px] text-warning">
                Order is already {pendingOrderStatus}. Use Claim Refund button to process BTC return.
              </p>
            )}
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
        {swapState === "idle" && executeDisabledReason && (
          <p className="hidden md:block text-center text-xs text-warning mt-2">{executeDisabledReason}</p>
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
          {swapState === "idle" && executeDisabledReason && (
            <p className="text-center text-[11px] text-warning mt-2">{executeDisabledReason}</p>
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
    </div>
  )
}
