"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TrendingUp, Coins, Info, Clock, Check, AlertCircle, Wallet, Eye, EyeOff } from "lucide-react"
import { useWallet } from "@/hooks/use-wallet"
import { useNotifications } from "@/hooks/use-notifications"
import { useLivePrices } from "@/hooks/use-live-prices"
import {
  autoSubmitPrivacyAction,
  getOwnedNfts,
  preparePrivateExecution,
  getStakePools,
  getStakePositions,
  stakeClaim,
  stakeDeposit,
  stakeWithdraw,
  type NFTItem,
  type PrivacyVerificationPayload,
} from "@/lib/api"
import {
  decimalToU256Parts,
  invokeStarknetCallsFromWallet,
  readStarknetShieldedPoolV3FixedAmountFromWallet,
  toHexFelt,
} from "@/lib/onchain-trade"

const poolMeta: Record<string, { name: string; icon: string; type: string; gradient: string }> = {
  USDT: { name: "Tether", icon: "₮", type: "Stablecoin", gradient: "from-green-400 to-emerald-600" },
  USDC: { name: "USD Coin", icon: "⭕", type: "Stablecoin", gradient: "from-blue-400 to-cyan-600" },
  WBTC: { name: "Wrapped Bitcoin", icon: "₿", type: "Crypto", gradient: "from-orange-400 to-amber-600" },
  BTC: { name: "Bitcoin", icon: "₿", type: "Crypto", gradient: "from-orange-400 to-amber-600" },
  ETH: { name: "Ethereum", icon: "Ξ", type: "Crypto", gradient: "from-purple-400 to-indigo-600" },
  STRK: { name: "StarkNet", icon: "◈", type: "Crypto", gradient: "from-pink-400 to-rose-600" },
  CAREL: { name: "Carel Protocol", icon: "◐", type: "Crypto", gradient: "from-violet-400 to-purple-600" },
}

type UsdtTierOption = { minUsdt: number; bonusPercent: number }

const USDT_POINTS_TIER_OPTIONS: UsdtTierOption[] = [
  { minUsdt: 5, bonusPercent: 5 },
  { minUsdt: 10, bonusPercent: 10 },
  { minUsdt: 50, bonusPercent: 20 },
  { minUsdt: 100, bonusPercent: 30 },
  { minUsdt: 250, bonusPercent: 50 },
]

const STARKNET_STAKING_CAREL_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_STAKING_CAREL_ADDRESS ||
  process.env.NEXT_PUBLIC_STAKING_CAREL_ADDRESS ||
  ""
const STARKNET_STAKING_STABLECOIN_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_STAKING_STABLECOIN_ADDRESS ||
  process.env.NEXT_PUBLIC_STAKING_STABLECOIN_ADDRESS ||
  ""
const STARKNET_STAKING_BTC_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_STAKING_BTC_ADDRESS ||
  process.env.NEXT_PUBLIC_STAKING_BTC_ADDRESS ||
  ""
const TOKEN_CAREL_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_CAREL_ADDRESS ||
  "0x0517f60f4ec4e1b2b748f0f642dfdcb32c0ddc893f777f2b595a4e4f6df51545"
const TOKEN_USDC_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_USDC_ADDRESS ||
  "0x0179cc8cb5ea0b143e17d649e8ad60d80c45c8132c4cf162d57eaf8297f529d8"
const TOKEN_USDT_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_USDT_ADDRESS ||
  "0x030fcbfd1f83fb2d697ad8bdd52e1d55a700b876bed1f4507875539581ed53e5"
const TOKEN_WBTC_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_WBTC_ADDRESS ||
  process.env.NEXT_PUBLIC_TOKEN_BTC_ADDRESS ||
  ""
const TOKEN_STRK_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_STRK_ADDRESS ||
  "0x04718f5a0Fc34cC1AF16A1cdee98fFB20C31f5cD61D6Ab07201858f4287c938D"

const POOL_DECIMALS: Record<string, number> = {
  CAREL: 18,
  USDC: 6,
  USDT: 6,
  WBTC: 8,
  STRK: 18,
  BTC: 8,
}

const STAKE_PRIVACY_PAYLOAD_KEY = "stake_privacy_garaga_payload_v2"
const STAKE_PRIVACY_PAYLOAD_UPDATED_EVENT = "stake-privacy-payload-updated"
const STAKE_PRIVACY_PENDING_NOTES_KEY = "stake_privacy_pending_notes_v3"
const STAKE_PRIVACY_PENDING_NOTES_UPDATED_EVENT = "stake-privacy-pending-notes-updated"
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
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_ENABLED || "false").toLowerCase() === "true"
const HIDE_BALANCE_RELAYER_APPROVE_MAX =
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_RELAYER_APPROVE_MAX || "false").toLowerCase() === "true"
const HIDE_BALANCE_MIN_NOTE_AGE_SECS_RAW =
  process.env.NEXT_PUBLIC_HIDE_BALANCE_MIN_NOTE_AGE_SECS ||
  process.env.NEXT_PUBLIC_AI_HIDE_MIN_NOTE_AGE_SECS ||
  "60"
const HIDE_BALANCE_MIN_NOTE_AGE_SECS = Number.parseInt(HIDE_BALANCE_MIN_NOTE_AGE_SECS_RAW, 10)
const HIDE_BALANCE_MIN_NOTE_AGE_MS =
  (Number.isFinite(HIDE_BALANCE_MIN_NOTE_AGE_SECS) && HIDE_BALANCE_MIN_NOTE_AGE_SECS > 0
    ? HIDE_BALANCE_MIN_NOTE_AGE_SECS
    : 60) * 1000
const U256_MAX_LOW_HEX = "0xffffffffffffffffffffffffffffffff"
const U256_MAX_HIGH_HEX = "0xffffffffffffffffffffffffffffffff"
const U256_MASK_128 = (BigInt(1) << BigInt(128)) - BigInt(1)

const scaledBigIntToDecimalString = (value: bigint, decimals: number): string => {
  if (decimals <= 0) return value.toString()
  const base = BigInt(10) ** BigInt(decimals)
  const whole = value / base
  const fraction = value % base
  if (fraction === BigInt(0)) return whole.toString()
  const fractionRaw = fraction
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "")
  return `${whole.toString()}.${fractionRaw}`
}

const toU256HexPartsFromBigInt = (value: bigint): [string, string] => {
  const safe = value < BigInt(0) ? BigInt(0) : value
  const low = safe & U256_MASK_128
  const high = safe >> BigInt(128)
  return [toHexFelt(low), toHexFelt(high)]
}

const normalizeHexArray = (values?: string[] | null): string[] => {
  if (!Array.isArray(values)) return []
  return values
    .map((value) => (typeof value === "string" ? value.trim() : String(value ?? "").trim()))
    .filter((value) => value.length > 0)
}

const loadTradePrivacyPayload = (): PrivacyVerificationPayload | undefined => {
  if (typeof window === "undefined") return undefined
  try {
    const raw = window.localStorage.getItem(STAKE_PRIVACY_PAYLOAD_KEY)
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
      window.localStorage.removeItem(STAKE_PRIVACY_PAYLOAD_KEY)
      return undefined
    }
    return {
      verifier: (parsed.verifier || "garaga").trim() || "garaga",
      note_version: parsed.note_version?.trim() || undefined,
      executor_address: parsed.executor_address?.trim() || undefined,
      root: parsed.root?.trim() || undefined,
      nullifier,
      commitment,
      recipient: parsed.recipient?.trim() || undefined,
      note_commitment: parsed.note_commitment?.trim() || undefined,
      denom_id: parsed.denom_id?.trim() || undefined,
      spendable_at_unix:
        typeof parsed.spendable_at_unix === "number" &&
        Number.isFinite(parsed.spendable_at_unix)
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
  window.localStorage.setItem(STAKE_PRIVACY_PAYLOAD_KEY, JSON.stringify(payload))
  window.dispatchEvent(new Event(STAKE_PRIVACY_PAYLOAD_UPDATED_EVENT))
}

const clearTradePrivacyPayload = () => {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(STAKE_PRIVACY_PAYLOAD_KEY)
  window.dispatchEvent(new Event(STAKE_PRIVACY_PAYLOAD_UPDATED_EVENT))
}

const loadPendingHideNotes = (): PendingHideNoteRecord[] => {
  if (typeof window === "undefined") return []
  const raw = window.localStorage.getItem(STAKE_PRIVACY_PENDING_NOTES_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const mapped = parsed
      .map((entry): PendingHideNoteRecord | null => {
        if (!entry || typeof entry !== "object") return null
        const item = entry as Record<string, unknown>
        const noteCommitment =
          typeof item.note_commitment === "string" ? item.note_commitment.trim() : ""
        if (!noteCommitment) return null
        return {
          note_version: "v3",
          note_commitment: noteCommitment,
          nullifier: typeof item.nullifier === "string" ? item.nullifier.trim() || undefined : undefined,
          executor_address:
            typeof item.executor_address === "string"
              ? item.executor_address.trim() || undefined
              : undefined,
          verifier: typeof item.verifier === "string" ? item.verifier.trim() || undefined : undefined,
          root: typeof item.root === "string" ? item.root.trim() || undefined : undefined,
          proof: normalizeHexArray((item.proof as string[] | undefined) || []),
          public_inputs: normalizeHexArray((item.public_inputs as string[] | undefined) || []),
          denom_id: typeof item.denom_id === "string" ? item.denom_id.trim() || undefined : undefined,
          token_symbol:
            typeof item.token_symbol === "string" ? item.token_symbol.trim() || undefined : undefined,
          target_token_symbol:
            typeof item.target_token_symbol === "string"
              ? item.target_token_symbol.trim() || undefined
              : undefined,
          amount: typeof item.amount === "string" ? item.amount.trim() || undefined : undefined,
          deposited_at_unix:
            typeof item.deposited_at_unix === "number" && Number.isFinite(item.deposited_at_unix)
              ? Math.floor(item.deposited_at_unix)
              : Math.floor(Date.now() / 1000),
          spendable_at_unix:
            typeof item.spendable_at_unix === "number" && Number.isFinite(item.spendable_at_unix)
              ? Math.floor(item.spendable_at_unix)
              : (typeof item.deposited_at_unix === "number" && Number.isFinite(item.deposited_at_unix)
                  ? Math.floor(item.deposited_at_unix)
                  : Math.floor(Date.now() / 1000)) + Math.floor(HIDE_BALANCE_MIN_NOTE_AGE_MS / 1000),
        }
      })
      .filter((item): item is PendingHideNoteRecord => item !== null)
    return mapped.sort((a, b) => b.deposited_at_unix - a.deposited_at_unix)
  } catch {
    return []
  }
}

const persistPendingHideNotes = (items: PendingHideNoteRecord[]) => {
  if (typeof window === "undefined") return
  window.localStorage.setItem(STAKE_PRIVACY_PENDING_NOTES_KEY, JSON.stringify(items))
  window.dispatchEvent(new Event(STAKE_PRIVACY_PENDING_NOTES_UPDATED_EVENT))
}

const upsertPendingHideNote = (note: PendingHideNoteRecord) => {
  const items = loadPendingHideNotes()
  const normalizedCommitment = note.note_commitment.trim().toLowerCase()
  const normalizedNullifier = (note.nullifier || "").trim().toLowerCase()
  const existing = items.find((item) => {
    const sameCommitment = item.note_commitment.trim().toLowerCase() === normalizedCommitment
    const sameNullifier =
      normalizedNullifier.length > 0 &&
      (item.nullifier || "").trim().toLowerCase() === normalizedNullifier
    return sameCommitment || sameNullifier
  })
  const merged: PendingHideNoteRecord = {
    ...(existing || {}),
    ...note,
  }
  const next = [
    merged,
    ...items.filter((item) => {
      const sameCommitment = item.note_commitment.trim().toLowerCase() === normalizedCommitment
      const sameNullifier =
        normalizedNullifier.length > 0 &&
        (item.nullifier || "").trim().toLowerCase() === normalizedNullifier
      return !(sameCommitment || sameNullifier)
    }),
  ]
  persistPendingHideNotes(next)
}

const removePendingHideNote = (noteCommitment?: string, nullifier?: string) => {
  const normalizedCommitment = (noteCommitment || "").trim().toLowerCase()
  const normalizedNullifier = (nullifier || "").trim().toLowerCase()
  if (!normalizedCommitment && !normalizedNullifier) return
  const items = loadPendingHideNotes()
  const next = items.filter((item) => {
    const sameCommitment =
      normalizedCommitment.length > 0 &&
      item.note_commitment.trim().toLowerCase() === normalizedCommitment
    const sameNullifier =
      normalizedNullifier.length > 0 &&
      (item.nullifier || "").trim().toLowerCase() === normalizedNullifier
    return !(sameCommitment || sameNullifier)
  })
  persistPendingHideNotes(next)
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

const formatRemainingDuration = (remainingMs: number) => {
  const safeMs = Math.max(0, remainingMs)
  const totalSeconds = Math.ceil(safeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

const inferUsdtTierFromDenomId = (denomId: string): number => {
  const parsed = Number.parseFloat((denomId || "").trim())
  if (!Number.isFinite(parsed) || parsed <= 0) return 5
  if (parsed >= 250) return 250
  if (parsed >= 100) return 100
  if (parsed >= 50) return 50
  if (parsed >= 10) return 10
  return 5
}

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
 * Parses or transforms values for `formatCompact`.
 *
 * @param value - Input used by `formatCompact` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const formatCompact = (value: number) => {
  try {
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return value.toLocaleString()
  }
}

/**
 * Handles `apyDisplayFor` logic.
 *
 * @param pool - Input used by `apyDisplayFor` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const apyDisplayFor = (pool: StakingPool) => {
  if (pool.symbol === "CAREL") return "8% - 15%"
  return `${pool.apy}%`
}

/**
 * Handles `mapStakeUiErrorMessage` logic.
 *
 * @param error - Input used by `mapStakeUiErrorMessage` to compute state, payload, or request behavior.
 * @param fallback - Input used by `mapStakeUiErrorMessage` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const mapStakeUiErrorMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : String(error ?? "")
  const normalized = message.toLowerCase()
  const operation = fallback.toLowerCase()

  if (normalized.includes("nullifier already spent")) {
    return "HIDE_NOTE_SPENT::Hide note already used. Select another pending note (or deposit a new one), then retry."
  }
  if (normalized.includes("erc20: insufficient balance")) {
    if (operation.includes("claim")) {
      return "Claim failed because staking reward liquidity is insufficient on-chain. Top up reward pool balance, then retry."
    }
    if (operation.includes("unstake")) {
      return "Unstake failed because pool liquidity is insufficient on-chain. Try a smaller amount, then retry."
    }
    if (operation.includes("stake")) {
      return "Staking failed because your wallet token balance is insufficient."
    }
    return "Transaction failed because token balance is insufficient."
  }
  if (normalized.includes("erc20: insufficient allowance")) {
    return "Token allowance is insufficient. Approve token spending first, then retry."
  }
  if (normalized.includes("argent/multicall-failed")) {
    return `Wallet multicall failed: ${message}`
  }
  return message || fallback
}

interface StakingPool {
  symbol: string
  name: string
  icon: string
  type: string
  apy: string
  apyDisplay?: string
  tvl: string
  tvlValue: number
  spotPrice: number
  minStake: string
  lockPeriod: string
  reward: string
  gradient: string
  userBalance: number
}

interface StakingPosition {
  id: string
  pool: StakingPool
  amount: number
  stakedAt: string
  rewards: number
  status: "active" | "pending" | "unlocking"
}

type PendingHideNoteRecord = {
  note_version: "v3"
  note_commitment: string
  nullifier?: string
  executor_address?: string
  verifier?: string
  root?: string
  proof?: string[]
  public_inputs?: string[]
  denom_id?: string
  token_symbol?: string
  target_token_symbol?: string
  amount?: string
  deposited_at_unix: number
  spendable_at_unix?: number
}

type ConfirmStakeOptions = {
  manualExecuteFromPendingNote?: boolean
  overridePayload?: PrivacyVerificationPayload
  overridePoolSymbol?: string
  overrideAmount?: string
}

/**
 * Runs `StakeEarn` and handles related side effects.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function StakeEarn() {
  const wallet = useWallet()
  const notifications = useNotifications()
  const [selectedPool, setSelectedPool] = React.useState<StakingPool | null>(null)
  const [stakeDialogOpen, setStakeDialogOpen] = React.useState(false)
  const [stakeAmount, setStakeAmount] = React.useState("")
  const [isStaking, setIsStaking] = React.useState(false)
  const [stakeSuccess, setStakeSuccess] = React.useState(false)
  const [claimingPositionId, setClaimingPositionId] = React.useState<string | null>(null)
  const [balanceHidden, setBalanceHidden] = React.useState(false)
  const [hideBalancePopupOpen, setHideBalancePopupOpen] = React.useState(false)
  const [hideUsdtTierMin, setHideUsdtTierMin] = React.useState<number>(10)
  const [hasTradePrivacyPayload, setHasTradePrivacyPayload] = React.useState(false)
  const [pendingHideNotes, setPendingHideNotes] = React.useState<PendingHideNoteRecord[]>([])
  const [pendingNoteActionCommitment, setPendingNoteActionCommitment] = React.useState<string | null>(null)
  const [nowMs, setNowMs] = React.useState(() => Date.now())
  const [isAutoPrivacyProvisioning, setIsAutoPrivacyProvisioning] = React.useState(false)
  const autoPrivacyPayloadPromiseRef = React.useRef<Promise<PrivacyVerificationPayload | undefined> | null>(null)
  const manuallySelectedHideNoteRef = React.useRef<{
    noteCommitment: string
    nullifier?: string
  } | null>(null)
  const [pools, setPools] = React.useState<StakingPool[]>([])
  const [positions, setPositions] = React.useState<StakingPosition[]>([])
  const [activeNftDiscount, setActiveNftDiscount] = React.useState<NFTItem | null>(null)
  const { prices: tokenPrices } = useLivePrices(Object.keys(poolMeta), {
    fallbackPrices: { CAREL: 1, USDC: 1, USDT: 1 },
  })
  const [activePositions, setActivePositions] = React.useState(0)
  const starknetProviderHint = React.useMemo<"starknet" | "argentx" | "braavos">(() => {
    if (wallet.provider === "argentx" || wallet.provider === "braavos") {
      return wallet.provider
    }
    return "starknet"
  }, [wallet.provider])

  const resolvePoolTokenAddress = React.useCallback((poolSymbol: string): string => {
    const symbol = poolSymbol.trim().toUpperCase()
    if (symbol === "CAREL") return TOKEN_CAREL_ADDRESS.trim()
    if (symbol === "USDC") return TOKEN_USDC_ADDRESS.trim()
    if (symbol === "USDT") return TOKEN_USDT_ADDRESS.trim()
    if (symbol === "WBTC") return TOKEN_WBTC_ADDRESS.trim()
    if (symbol === "STRK") return TOKEN_STRK_ADDRESS.trim()
    return ""
  }, [])

  const approveRelayerFundingForStake = React.useCallback(
    async (poolSymbol: string, amountValue: string) => {
      const symbol = poolSymbol.trim().toUpperCase()
      const tokenAddress = resolvePoolTokenAddress(symbol)
      if (!tokenAddress) {
        throw new Error(`Token address for ${symbol} is not configured for hide-mode relayer funding.`)
      }
      const executorAddress =
        (PRIVATE_ACTION_EXECUTOR_ADDRESS || STARKNET_ZK_PRIVACY_ROUTER_ADDRESS || "").trim()
      if (!executorAddress) {
        throw new Error(
          "NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS is not configured for shielded relayer mode."
        )
      }
      const [amountLow, amountHigh] = decimalToU256Parts(amountValue || "1", POOL_DECIMALS[symbol] || 18)
      const [approvalLow, approvalHigh] = HIDE_BALANCE_RELAYER_APPROVE_MAX
        ? [U256_MAX_LOW_HEX, U256_MAX_HIGH_HEX]
        : [amountLow, amountHigh]
      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message: HIDE_BALANCE_RELAYER_APPROVE_MAX
          ? `Approve one-time ${symbol} spending limit for private relayer funding.`
          : `Approve ${amountValue} ${symbol} for private relayer note funding.`,
      })
      const txHash = await invokeStarknetCallsFromWallet(
        [
          {
            contractAddress: tokenAddress,
            entrypoint: "approve",
            calldata: [executorAddress, approvalLow, approvalHigh],
          },
        ],
        starknetProviderHint
      )
      notifications.addNotification({
        type: "success",
        title: "Allowance approved",
        message: HIDE_BALANCE_RELAYER_APPROVE_MAX
          ? `Relayer allowance for ${symbol} is now active (one-time setup).`
          : `Relayer can now fund private note from your ${symbol} balance.`,
        txHash,
        txNetwork: "starknet",
      })
    },
    [notifications, resolvePoolTokenAddress, starknetProviderHint]
  )

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

  const consumeUsedHidePayload = React.useCallback(
    (payload?: PrivacyVerificationPayload) => {
      const spentCommitment = (payload?.note_commitment || payload?.commitment || "").trim()
      const spentNullifier = (payload?.nullifier || "").trim()
      removePendingHideNote(spentCommitment, spentNullifier)
      setPendingHideNotes(loadPendingHideNotes())
      if (isManuallySelectedHideNote(spentCommitment, spentNullifier)) {
        clearManuallySelectedHideNote()
      }
      clearTradePrivacyPayload()
      setHasTradePrivacyPayload(false)
    },
    [clearManuallySelectedHideNote, isManuallySelectedHideNote]
  )

  const resolveHideBalancePrivacyPayload = React.useCallback(async (txContext?: {
    flow?: string
    fromToken?: string
    toToken?: string
    amount?: string
  }): Promise<PrivacyVerificationPayload | undefined> => {
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
        const cachedPayload = loadTradePrivacyPayload()
        const response = await autoSubmitPrivacyAction({
          verifier: "garaga",
          submit_onchain: false,
          tx_context: {
            flow: txContext?.flow || "stake",
            from_token: txContext?.fromToken || selectedPool?.symbol,
            to_token: txContext?.toToken || selectedPool?.symbol,
            amount: txContext?.amount || stakeAmount || undefined,
            from_network: "starknet",
            to_network: "starknet",
            note_version: "v3",
            denom_id: String(hideUsdtTierMin),
            note_commitment: cachedPayload?.note_commitment || cachedPayload?.commitment,
            nullifier: cachedPayload?.nullifier,
            root: cachedPayload?.root,
            spendable_at_unix: cachedPayload?.spendable_at_unix,
          },
        })
        const responseProof = normalizeHexArray(response.payload?.proof)
        const responsePublicInputs = normalizeHexArray(response.payload?.public_inputs)
        const payload: PrivacyVerificationPayload = {
          verifier: (response.payload?.verifier || "garaga").trim() || "garaga",
          note_version: response.payload?.note_version?.trim() || "v3",
          executor_address: response.payload?.executor_address?.trim() || undefined,
          root: response.payload?.root?.trim() || undefined,
          nullifier: response.payload?.nullifier?.trim(),
          commitment: response.payload?.commitment?.trim(),
          recipient: response.payload?.recipient?.trim() || undefined,
          note_commitment:
            response.payload?.note_commitment?.trim() ||
            response.payload?.commitment?.trim() ||
            undefined,
          denom_id: response.payload?.denom_id?.trim() || String(hideUsdtTierMin),
          spendable_at_unix:
            typeof response.payload?.spendable_at_unix === "number" &&
            Number.isFinite(response.payload.spendable_at_unix)
              ? Math.floor(response.payload.spendable_at_unix)
              : undefined,
          proof: responseProof,
          public_inputs: responsePublicInputs,
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
          note_version: payload.note_version,
          executor_address: payload.executor_address,
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
  }, [hideUsdtTierMin, notifications, selectedPool?.symbol, stakeAmount, wallet.isConnected])

  const displayPools = React.useMemo(() => {
    if (pools.length === 0) return []
    return pools.map((pool) => ({
      ...pool,
      spotPrice: tokenPrices[pool.symbol] ?? pool.spotPrice,
    }))
  }, [pools, tokenPrices])

  React.useEffect(() => {
    let active = true
    if (!wallet.isConnected) {
      setActiveNftDiscount(null)
      return
    }

    /**
     * Handles `loadNftDiscount` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const loadNftDiscount = async (force = false) => {
      try {
        const nfts = await getOwnedNfts({ force })
        if (!active) return
        const now = Math.floor(Date.now() / 1000)
        const usable = nfts
          .filter((nft) => !nft.used && (!nft.expiry || nft.expiry > now))
          .sort((a, b) => (b.discount || 0) - (a.discount || 0))[0]
        setActiveNftDiscount(usable || null)
      } catch {
        if (!active) return
        setActiveNftDiscount(null)
      }
    }

    void loadNftDiscount()
    const timer = window.setInterval(() => {
      void loadNftDiscount(true)
    }, 20_000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [wallet.isConnected, wallet.address, wallet.starknetAddress, wallet.evmAddress, wallet.btcAddress])

  React.useEffect(() => {
    refreshTradePrivacyPayload()
    window.addEventListener(STAKE_PRIVACY_PAYLOAD_UPDATED_EVENT, refreshTradePrivacyPayload)
    return () => {
      window.removeEventListener(STAKE_PRIVACY_PAYLOAD_UPDATED_EVENT, refreshTradePrivacyPayload)
    }
  }, [refreshTradePrivacyPayload])

  React.useEffect(() => {
    refreshPendingHideNotes()
    window.addEventListener(STAKE_PRIVACY_PENDING_NOTES_UPDATED_EVENT, refreshPendingHideNotes)
    return () => {
      window.removeEventListener(STAKE_PRIVACY_PENDING_NOTES_UPDATED_EVENT, refreshPendingHideNotes)
    }
  }, [refreshPendingHideNotes])

  React.useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  React.useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const response = await getStakePools()
        if (!active) return
        const mapped = response.map((pool) => {
          const meta = poolMeta[pool.token] || {
            name: pool.token,
            icon: "●",
            type: "Crypto",
            gradient: "from-slate-400 to-slate-600",
          }
          const symbol = pool.token.toUpperCase()
          const userBalance =
            symbol === "CAREL"
              ? wallet.onchainBalance.CAREL ?? wallet.balance[symbol] ?? 0
              : symbol === "USDC"
              ? wallet.onchainBalance.USDC ?? wallet.balance[symbol] ?? 0
              : symbol === "USDT"
              ? wallet.onchainBalance.USDT ?? wallet.balance[symbol] ?? 0
              : symbol === "WBTC"
              ? wallet.onchainBalance.WBTC ?? wallet.balance[symbol] ?? 0
              : symbol === "BTC"
              ? wallet.onchainBalance.BTC ?? wallet.balance[symbol] ?? 0
              : symbol === "STRK"
              ? wallet.onchainBalance.STRK_L2 ?? wallet.balance[symbol] ?? 0
              : wallet.balance[symbol] ?? 0
          const tvlUsd = Number.isFinite(pool.tvl_usd) ? pool.tvl_usd : pool.total_staked
          return {
            symbol,
            name: meta.name,
            icon: meta.icon,
            type: meta.type,
            apy: pool.apy.toFixed(2),
            apyDisplay: symbol === "CAREL" ? "8% - 15%" : `${pool.apy.toFixed(2)}%`,
            tvl: formatCompact(tvlUsd),
            tvlValue: tvlUsd,
            spotPrice: 0,
            minStake: pool.min_stake.toString(),
            lockPeriod: pool.lock_period ? `${pool.lock_period} days` : "Flexible",
            reward: pool.token,
            gradient: meta.gradient,
            userBalance,
          } as StakingPool
        })
        setPools(mapped)
      } catch {
        if (!active) return
        setPools([])
      }
    })()

    return () => {
      active = false
    }
  }, [
    wallet.balance,
    wallet.onchainBalance.BTC,
    wallet.onchainBalance.CAREL,
    wallet.onchainBalance.STRK_L2,
    wallet.onchainBalance.USDC,
    wallet.onchainBalance.USDT,
    wallet.onchainBalance.WBTC,
  ])

  const refreshPositions = React.useCallback(async () => {
    try {
      const response = await getStakePositions()
      const poolMap = new Map(pools.map((pool) => [pool.symbol, pool]))
      const mapped = response
        .map((position) => {
          const pool = poolMap.get(position.token)
          if (!pool) return null
          return {
            id: position.position_id,
            pool,
            amount: position.amount,
            stakedAt: new Date(position.started_at * 1000).toLocaleDateString("id-ID"),
            rewards: position.rewards_earned,
            status: "active",
          } as StakingPosition
        })
        .filter((item): item is StakingPosition => item !== null)
      setPositions(mapped)
      setActivePositions(mapped.length)
    } catch {
      setPositions([])
      setActivePositions(0)
    }
  }, [pools])

  React.useEffect(() => {
    if (pools.length === 0) return
    let active = true
    ;(async () => {
      if (!active) return
      await refreshPositions()
    })()
    return () => {
      active = false
    }
  }, [pools, refreshPositions])

  /**
   * Handles `handleStake` logic.
   *
   * @param pool - Input used by `handleStake` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleStake = (pool: StakingPool) => {
    if (pool.symbol === "BTC") {
      notifications.addNotification({
        type: "info",
        title: "Not Available",
        message: "BTC staking is currently unavailable.",
      })
      return
    }
    setSelectedPool(pool)
    setStakeAmount("")
    setStakeSuccess(false)
    setStakeDialogOpen(true)
  }

  /**
   * Handles `handleAmountPreset` logic.
   *
   * @param percent - Input used by `handleAmountPreset` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleAmountPreset = (percent: number) => {
    if (selectedPool) {
      const amount = selectedPool.userBalance * percent / 100
      setStakeAmount(amount.toString())
    }
  }

  const selectedHideTier =
    USDT_POINTS_TIER_OPTIONS.find((option) => option.minUsdt === hideUsdtTierMin) ||
    USDT_POINTS_TIER_OPTIONS[1]

  const resolvePoolUsdPrice = React.useCallback(
    (poolSymbol: string): number => {
      const symbol = poolSymbol.toUpperCase()
      if (symbol === "USDT" || symbol === "USDC") return 1
      const livePrice = tokenPrices[symbol]
      if (Number.isFinite(livePrice) && livePrice > 0) return livePrice
      const fallbackPrice =
        pools.find((pool) => pool.symbol.toUpperCase() === symbol)?.spotPrice ?? 0
      return Number.isFinite(fallbackPrice) && fallbackPrice > 0 ? fallbackPrice : 0
    },
    [pools, tokenPrices]
  )

  const selectedPoolSpotUsd =
    selectedPool && selectedPool.symbol
      ? resolvePoolUsdPrice(selectedPool.symbol)
      : 0
  const hideTierLockedStakeAmount =
    balanceHidden && selectedPoolSpotUsd > 0
      ? selectedHideTier.minUsdt / selectedPoolSpotUsd
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

  const handleUsePendingHideNote = async (note: PendingHideNoteRecord) => {
    const spendableAt = Number(note.spendable_at_unix || 0)
    const remainingMs = spendableAt > 0 ? Math.max(0, spendableAt * 1000 - Date.now()) : 0
    if (remainingMs > 0) {
      notifications.addNotification({
        type: "warning",
        title: "Mixing window active",
        message: `Hide note is still mixing. Ready in ${formatRemainingDuration(remainingMs)}.`,
      })
      return
    }

    const tokenSymbol = (note.token_symbol || "").trim().toUpperCase()
    if (!tokenSymbol) {
      notifications.addNotification({
        type: "error",
        title: "Hide note invalid",
        message: "Selected note is missing token metadata.",
      })
      return
    }
    const pool = pools.find((item) => item.symbol.toUpperCase() === tokenSymbol)
    if (!pool) {
      notifications.addNotification({
        type: "error",
        title: "Unsupported pool",
        message: `Cannot execute pending note for ${tokenSymbol}.`,
      })
      return
    }

    const noteAmountText = (note.amount || "").trim()
    if (!noteAmountText || Number.parseFloat(noteAmountText) <= 0) {
      notifications.addNotification({
        type: "error",
        title: "Invalid note amount",
        message: "Selected note amount is invalid. Deposit a new note and retry.",
      })
      return
    }

    const payload: PrivacyVerificationPayload = {
      verifier: (note.verifier || "garaga").trim() || "garaga",
      note_version: "v3",
      executor_address: note.executor_address?.trim() || PRIVATE_ACTION_EXECUTOR_ADDRESS || undefined,
      root: note.root?.trim() || undefined,
      nullifier: (note.nullifier || "").trim(),
      commitment: note.note_commitment,
      note_commitment: note.note_commitment,
      denom_id: note.denom_id?.trim() || undefined,
      spendable_at_unix: note.spendable_at_unix,
      proof: normalizeHexArray(note.proof),
      public_inputs: normalizeHexArray(note.public_inputs),
    }

    persistTradePrivacyPayload(payload)
    setHasTradePrivacyPayload(true)
    setBalanceHidden(true)
    setManuallySelectedHideNote(note.note_commitment, note.nullifier)
    setSelectedPool(pool)
    setStakeAmount(noteAmountText)
    if (note.denom_id?.trim()) {
      setHideUsdtTierMin(inferUsdtTierFromDenomId(note.denom_id.trim()))
    }

    notifications.addNotification({
      type: "info",
      title: "Submitting private stake",
      message: `Running Private Stake now for ${noteAmountText} ${tokenSymbol}.`,
    })

    setPendingNoteActionCommitment(note.note_commitment)
    try {
      await confirmStake({
        manualExecuteFromPendingNote: true,
        overridePayload: payload,
        overridePoolSymbol: tokenSymbol,
        overrideAmount: noteAmountText,
      })
    } finally {
      setPendingNoteActionCommitment(null)
    }
  }

  const handleWithdrawPendingHideNote = React.useCallback(
    async (note: PendingHideNoteRecord) => {
      const noteCommitment = (note.note_commitment || "").trim()
      if (!noteCommitment) return
      const executorAddress =
        (note.executor_address || PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim()
      if (!executorAddress) {
        notifications.addNotification({
          type: "error",
          title: "Withdraw failed",
          message: "Executor address is missing for this note.",
        })
        return
      }
      try {
        notifications.addNotification({
          type: "info",
          title: "Wallet signature required",
          message: "Confirm Withdraw to return note funds to your wallet.",
        })
        const txHash = await invokeStarknetCallsFromWallet(
          [
            {
              contractAddress: executorAddress,
              entrypoint: "withdraw_note_v3",
              calldata: [toHexFelt(noteCommitment)],
            },
          ],
          starknetProviderHint
        )
        removePendingHideNote(noteCommitment, note.nullifier)
        setPendingHideNotes(loadPendingHideNotes())
        if (isManuallySelectedHideNote(noteCommitment, note.nullifier)) {
          clearManuallySelectedHideNote()
        }
        notifications.addNotification({
          type: "success",
          title: "Hide note withdrawn",
          message: `Note cancelled and funds returned (${txHash.slice(0, 10)}...).`,
          txHash,
          txNetwork: "starknet",
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "")
        notifications.addNotification({
          type: "error",
          title: "Withdraw failed",
          message,
        })
      }
    },
    [clearManuallySelectedHideNote, isManuallySelectedHideNote, notifications, starknetProviderHint]
  )

  React.useEffect(() => {
    if (!balanceHidden || !selectedPool) return
    if (!Number.isFinite(hideTierLockedStakeAmount || Number.NaN) || (hideTierLockedStakeAmount || 0) <= 0) return

    const decimals = POOL_DECIMALS[selectedPool.symbol.toUpperCase()] ?? 18
    const precision = Math.min(decimals >= 10 ? 8 : 6, 8)
    const nextAmount = Number(hideTierLockedStakeAmount).toFixed(precision).replace(/\.?0+$/, "")
    if (!nextAmount) return

    const currentAmount = Number.parseFloat(stakeAmount || "0")
    const drift = Math.abs(currentAmount - Number(hideTierLockedStakeAmount))
    const tolerance = Math.max(Number(hideTierLockedStakeAmount) * 1e-6, 1e-8)
    if (!Number.isFinite(currentAmount) || drift > tolerance) {
      setStakeAmount(nextAmount)
    }
  }, [balanceHidden, hideTierLockedStakeAmount, selectedPool, stakeAmount])

  const ensureHideV3NoteDeposited = React.useCallback(
    async ({
      payload,
      symbol,
      amountText,
    }: {
      payload: PrivacyVerificationPayload
      symbol: string
      amountText: string
    }): Promise<number> => {
      const tokenSymbol = symbol.toUpperCase()
      const tokenAddress = resolvePoolTokenAddress(tokenSymbol)
      if (!tokenAddress) {
        throw new Error(`Token address for ${tokenSymbol} is not configured for hide note deposit.`)
      }
      const executorAddress =
        (payload.executor_address || PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim()
      if (!executorAddress) {
        throw new Error(
          "NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS is not configured for hide note deposit."
        )
      }
      const noteCommitment = (payload.note_commitment || payload.commitment || "").trim()
      if (!noteCommitment) {
        throw new Error("Hide note commitment missing in privacy payload.")
      }
      const nullifier = (payload.nullifier || "").trim()
      if (!nullifier) {
        throw new Error("Hide nullifier missing in privacy payload.")
      }
      const denomId = (payload.denom_id || String(selectedHideTier.minUsdt)).trim()
      if (!denomId) {
        throw new Error("Hide denom_id missing in privacy payload.")
      }

      const decimals = POOL_DECIMALS[tokenSymbol] ?? 18
      let fixedAmountText = (amountText || "").trim()
      try {
        const fixedAmountRaw = await readStarknetShieldedPoolV3FixedAmountFromWallet(
          executorAddress,
          tokenAddress,
          denomId,
          starknetProviderHint
        )
        if (fixedAmountRaw !== null && fixedAmountRaw > BigInt(0)) {
          fixedAmountText = scaledBigIntToDecimalString(fixedAmountRaw, decimals)
        }
      } catch {
        // fallback to local estimate
      }
      const parsedAmount = Number.parseFloat(fixedAmountText || "0")
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        const tokenPriceUsd = resolvePoolUsdPrice(tokenSymbol)
        if (!Number.isFinite(tokenPriceUsd) || tokenPriceUsd <= 0) {
          throw new Error(`Cannot derive fixed amount for ${tokenSymbol}: token price is unavailable.`)
        }
        const precision = Math.min(decimals >= 10 ? 8 : 6, 8)
        fixedAmountText = (selectedHideTier.minUsdt / tokenPriceUsd)
          .toFixed(precision)
          .replace(/\.?0+$/, "")
      }
      const requiredAmount = Number.parseFloat(fixedAmountText || "0")
      if (!Number.isFinite(requiredAmount) || requiredAmount <= 0) {
        throw new Error(`Cannot deposit hide note for ${tokenSymbol}: invalid fixed amount.`)
      }
      const availableBalance =
        pools.find((pool) => pool.symbol.toUpperCase() === tokenSymbol)?.userBalance || 0
      if (Number.isFinite(availableBalance) && availableBalance + 1e-12 < requiredAmount) {
        throw new Error(
          `Insufficient ${tokenSymbol} balance for selected hide tier. Required ${requiredAmount.toFixed(
            6
          )}, available ${availableBalance.toFixed(6)}.`
        )
      }
      const [requiredLow, requiredHigh] = decimalToU256Parts(fixedAmountText, decimals)
      const requiredAmountUnits =
        BigInt(requiredLow) + (BigInt(requiredHigh) << BigInt(128))
      const approvalAmountUnits =
        (requiredAmountUnits * BigInt(10_100) + BigInt(9_999)) / BigInt(10_000)
      const [approvalLow, approvalHigh] = toU256HexPartsFromBigInt(approvalAmountUnits)

      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message: `Confirm approve (+1% buffer) + hide note deposit (${fixedAmountText} ${tokenSymbol}) in one transaction.`,
      })
      const txHash = await invokeStarknetCallsFromWallet(
        [
          {
            contractAddress: tokenAddress,
            entrypoint: "approve",
            calldata: [executorAddress, approvalLow, approvalHigh],
          },
          {
            contractAddress: executorAddress,
            entrypoint: "deposit_fixed_v3",
            calldata: [
              tokenAddress,
              toHexFelt(denomId),
              toHexFelt(noteCommitment),
              toHexFelt(nullifier),
            ],
          },
        ],
        starknetProviderHint
      )

      const spendableAtUnix =
        Math.floor(Date.now() / 1000) + Math.floor(HIDE_BALANCE_MIN_NOTE_AGE_MS / 1000)
      persistTradePrivacyPayload({
        ...payload,
        note_version: "v3",
        executor_address: executorAddress,
        note_commitment: noteCommitment,
        commitment: payload.commitment || noteCommitment,
        nullifier,
        denom_id: denomId,
        spendable_at_unix: spendableAtUnix,
      })
      setHasTradePrivacyPayload(true)
      upsertPendingHideNote({
        note_version: "v3",
        note_commitment: noteCommitment,
        nullifier,
        executor_address: executorAddress,
        verifier: (payload.verifier || "garaga").trim() || "garaga",
        root: payload.root?.trim() || undefined,
        proof: normalizeHexArray(payload.proof),
        public_inputs: normalizeHexArray(payload.public_inputs),
        denom_id: denomId,
        token_symbol: tokenSymbol,
        target_token_symbol: tokenSymbol,
        amount: fixedAmountText,
        deposited_at_unix: Math.floor(Date.now() / 1000),
        spendable_at_unix: spendableAtUnix,
      })
      setPendingHideNotes(loadPendingHideNotes())
      notifications.addNotification({
        type: "success",
        title: "Hide note deposited",
        message: `Note deposit submitted (${txHash.slice(0, 10)}...). Private stake unlocks in ${formatRemainingDuration(HIDE_BALANCE_MIN_NOTE_AGE_MS)}.`,
        txHash,
        txNetwork: "starknet",
      })
      return spendableAtUnix
    },
    [
      notifications,
      pools,
      resolvePoolTokenAddress,
      resolvePoolUsdPrice,
      selectedHideTier.minUsdt,
      starknetProviderHint,
    ]
  )

  const submitOnchainStakeTx = React.useCallback(
    async (
      poolSymbol: string,
      entrypoint: "stake" | "unstake",
      amount: string,
      privacyPayload?: PrivacyVerificationPayload
    ): Promise<{ txHash: string; privacyPayload?: PrivacyVerificationPayload }> => {
      const symbol = poolSymbol.toUpperCase()
      if (symbol === "BTC") {
        throw new Error("Native BTC staking will be enabled via Garden API.")
      }

      const decimals = POOL_DECIMALS[symbol] ?? 18
      const [amountLow, amountHigh] = decimalToU256Parts(amount, decimals)
      const isStake = entrypoint === "stake"

      const invokeWithHideMode = async (
        calls: Array<{ contractAddress: string; entrypoint: string; calldata: string[] }>
      ): Promise<{ txHash: string; privacyPayload?: PrivacyVerificationPayload }> => {
        if (!privacyPayload) {
          const txHash = await invokeStarknetCallsFromWallet(calls, starknetProviderHint)
          return { txHash }
        }

        if (HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED && calls.length > 0) {
          try {
            const actionCall = calls[calls.length - 1]
            const preCalls = calls.length > 1 ? calls.slice(0, calls.length - 1) : []
            const preparedPrivate = await preparePrivateExecution({
              verifier: (privacyPayload.verifier || "garaga").trim() || "garaga",
              flow: "stake",
              action_entrypoint: actionCall.entrypoint,
              action_calldata: actionCall.calldata,
              tx_context: {
                flow: isStake ? "stake" : "unstake",
                from_token: symbol,
                to_token: symbol,
                amount,
                from_network: "starknet",
                to_network: "starknet",
              },
            })
            const preparedPayload: PrivacyVerificationPayload = {
              verifier: (preparedPrivate.payload?.verifier || "garaga").trim() || "garaga",
              nullifier: preparedPrivate.payload?.nullifier?.trim(),
              commitment: preparedPrivate.payload?.commitment?.trim(),
              proof: normalizeHexArray(preparedPrivate.payload?.proof),
              public_inputs: normalizeHexArray(preparedPrivate.payload?.public_inputs),
            }
            persistTradePrivacyPayload(preparedPayload)
            setHasTradePrivacyPayload(true)
            const executorCalls = preparedPrivate.onchain_calls.map((call) => ({
              contractAddress: call.contract_address,
              entrypoint: call.entrypoint,
              calldata: call.calldata.map((item) => String(item)),
            }))
            const txHash = await invokeStarknetCallsFromWallet(
              [...preCalls, ...executorCalls],
              starknetProviderHint
            )
            return { txHash, privacyPayload: preparedPayload }
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

        const txHash = await invokeStarknetCallsFromWallet(
          [buildHideBalancePrivacyCall(privacyPayload), ...calls],
          starknetProviderHint
        )
        return { txHash, privacyPayload }
      }

      if (symbol === "CAREL") {
        if (!STARKNET_STAKING_CAREL_ADDRESS) {
          throw new Error(
            "NEXT_PUBLIC_STARKNET_STAKING_CAREL_ADDRESS is not set. Configure CAREL staking contract address in frontend/.env.local."
          )
        }
        if (isStake) {
          return invokeWithHideMode([
            {
              contractAddress: TOKEN_CAREL_ADDRESS,
              entrypoint: "approve",
              calldata: [STARKNET_STAKING_CAREL_ADDRESS, amountLow, amountHigh],
            },
            {
              contractAddress: STARKNET_STAKING_CAREL_ADDRESS,
              entrypoint: "stake",
              calldata: [amountLow, amountHigh],
            },
          ])
        }
        return invokeWithHideMode([
          {
            contractAddress: STARKNET_STAKING_CAREL_ADDRESS,
            entrypoint,
            calldata: [amountLow, amountHigh],
          },
        ])
      }

      if (symbol === "USDC" || symbol === "USDT" || symbol === "STRK") {
        if (!STARKNET_STAKING_STABLECOIN_ADDRESS) {
          throw new Error(
            "NEXT_PUBLIC_STARKNET_STAKING_STABLECOIN_ADDRESS is not set for stablecoin staking."
          )
        }
        const tokenAddress =
          symbol === "USDC"
            ? TOKEN_USDC_ADDRESS
            : symbol === "USDT"
            ? TOKEN_USDT_ADDRESS
            : TOKEN_STRK_ADDRESS
        if (isStake) {
          return invokeWithHideMode([
            {
              contractAddress: tokenAddress,
              entrypoint: "approve",
              calldata: [STARKNET_STAKING_STABLECOIN_ADDRESS, amountLow, amountHigh],
            },
            {
              contractAddress: STARKNET_STAKING_STABLECOIN_ADDRESS,
              entrypoint: "stake",
              calldata: [tokenAddress, amountLow, amountHigh],
            },
          ])
        }
        return invokeWithHideMode([
          {
            contractAddress: STARKNET_STAKING_STABLECOIN_ADDRESS,
            entrypoint,
            calldata: [tokenAddress, amountLow, amountHigh],
          },
        ])
      }

      if (symbol === "WBTC") {
        if (!STARKNET_STAKING_BTC_ADDRESS) {
          throw new Error(
            "NEXT_PUBLIC_STARKNET_STAKING_BTC_ADDRESS is not set for WBTC staking."
          )
        }
        if (!TOKEN_WBTC_ADDRESS) {
          throw new Error(
            "NEXT_PUBLIC_TOKEN_WBTC_ADDRESS is not set. Configure the real Starknet WBTC token address."
          )
        }
        if (isStake) {
          return invokeWithHideMode([
            {
              contractAddress: TOKEN_WBTC_ADDRESS,
              entrypoint: "approve",
              calldata: [STARKNET_STAKING_BTC_ADDRESS, amountLow, amountHigh],
            },
            {
              contractAddress: STARKNET_STAKING_BTC_ADDRESS,
              entrypoint: "stake",
              calldata: [TOKEN_WBTC_ADDRESS, amountLow, amountHigh],
            },
          ])
        }
        return invokeWithHideMode([
          {
            contractAddress: STARKNET_STAKING_BTC_ADDRESS,
            entrypoint,
            calldata: [TOKEN_WBTC_ADDRESS, amountLow, amountHigh],
          },
        ])
      }

      throw new Error(`Pool ${symbol} is not supported for on-chain staking.`)
    },
    [notifications, starknetProviderHint]
  )

  const submitOnchainClaimTx = React.useCallback(
    async (
      poolSymbol: string,
      privacyPayload?: PrivacyVerificationPayload
    ): Promise<{ txHash: string; privacyPayload?: PrivacyVerificationPayload }> => {
      const symbol = poolSymbol.toUpperCase()
      if (symbol === "BTC") {
        throw new Error("Native BTC staking will be enabled via Garden API.")
      }

      const invokeWithHideMode = async (
        calls: Array<{ contractAddress: string; entrypoint: string; calldata: string[] }>
      ): Promise<{ txHash: string; privacyPayload?: PrivacyVerificationPayload }> => {
        if (!privacyPayload) {
          const txHash = await invokeStarknetCallsFromWallet(calls, starknetProviderHint)
          return { txHash }
        }

        if (HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED && calls.length > 0) {
          try {
            const actionCall = calls[calls.length - 1]
            const preCalls = calls.length > 1 ? calls.slice(0, calls.length - 1) : []
            const preparedPrivate = await preparePrivateExecution({
              verifier: (privacyPayload.verifier || "garaga").trim() || "garaga",
              flow: "stake",
              action_entrypoint: actionCall.entrypoint,
              action_calldata: actionCall.calldata,
              tx_context: {
                flow: "stake_claim",
                from_token: symbol,
                to_token: symbol,
                from_network: "starknet",
                to_network: "starknet",
              },
            })
            const preparedPayload: PrivacyVerificationPayload = {
              verifier: (preparedPrivate.payload?.verifier || "garaga").trim() || "garaga",
              nullifier: preparedPrivate.payload?.nullifier?.trim(),
              commitment: preparedPrivate.payload?.commitment?.trim(),
              proof: normalizeHexArray(preparedPrivate.payload?.proof),
              public_inputs: normalizeHexArray(preparedPrivate.payload?.public_inputs),
            }
            persistTradePrivacyPayload(preparedPayload)
            setHasTradePrivacyPayload(true)
            const executorCalls = preparedPrivate.onchain_calls.map((call) => ({
              contractAddress: call.contract_address,
              entrypoint: call.entrypoint,
              calldata: call.calldata.map((item) => String(item)),
            }))
            const txHash = await invokeStarknetCallsFromWallet(
              [...preCalls, ...executorCalls],
              starknetProviderHint
            )
            return { txHash, privacyPayload: preparedPayload }
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

        const txHash = await invokeStarknetCallsFromWallet(
          [buildHideBalancePrivacyCall(privacyPayload), ...calls],
          starknetProviderHint
        )
        return { txHash, privacyPayload }
      }

      if (symbol === "CAREL") {
        if (!STARKNET_STAKING_CAREL_ADDRESS) {
          throw new Error(
            "NEXT_PUBLIC_STARKNET_STAKING_CAREL_ADDRESS is not set. Configure CAREL staking contract address in frontend/.env.local."
          )
        }
        return invokeWithHideMode([
          {
            contractAddress: STARKNET_STAKING_CAREL_ADDRESS,
            entrypoint: "claim_rewards",
            calldata: [],
          },
        ])
      }

      if (symbol === "USDC" || symbol === "USDT" || symbol === "STRK") {
        if (!STARKNET_STAKING_STABLECOIN_ADDRESS) {
          throw new Error(
            "NEXT_PUBLIC_STARKNET_STAKING_STABLECOIN_ADDRESS is not set for stablecoin staking."
          )
        }
        const tokenAddress =
          symbol === "USDC"
            ? TOKEN_USDC_ADDRESS
            : symbol === "USDT"
            ? TOKEN_USDT_ADDRESS
            : TOKEN_STRK_ADDRESS
        return invokeWithHideMode([
          {
            contractAddress: STARKNET_STAKING_STABLECOIN_ADDRESS,
            entrypoint: "claim_rewards",
            calldata: [tokenAddress],
          },
        ])
      }

      if (symbol === "WBTC") {
        if (!STARKNET_STAKING_BTC_ADDRESS) {
          throw new Error(
            "NEXT_PUBLIC_STARKNET_STAKING_BTC_ADDRESS is not set for WBTC staking."
          )
        }
        if (!TOKEN_WBTC_ADDRESS) {
          throw new Error(
            "NEXT_PUBLIC_TOKEN_WBTC_ADDRESS is not set. Configure the real Starknet WBTC token address."
          )
        }
        return invokeWithHideMode([
          {
            contractAddress: STARKNET_STAKING_BTC_ADDRESS,
            entrypoint: "claim_rewards",
            calldata: [TOKEN_WBTC_ADDRESS],
          },
        ])
      }

      throw new Error(`Pool ${symbol} is not supported for staking reward claim.`)
    },
    [notifications, starknetProviderHint]
  )

  /**
   * Handles `confirmStake` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const confirmStake = async (options?: ConfirmStakeOptions) => {
    const effectivePool =
      options?.overridePoolSymbol && options.overridePoolSymbol.trim()
        ? pools.find(
            (pool) => pool.symbol.toUpperCase() === options.overridePoolSymbol?.trim().toUpperCase()
          ) || null
        : selectedPool
    if (!effectivePool) return
    if (effectivePool.symbol === "BTC") {
      notifications.addNotification({
        type: "info",
        title: "Not Available",
        message: "BTC staking is currently unavailable.",
      })
      return
    }
    const effectiveAmount = (options?.overrideAmount || stakeAmount || "").trim()
    const parsedAmount = Number.parseFloat(effectiveAmount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      notifications.addNotification({
        type: "error",
        title: "Amount is required",
        message: "Set a valid stake amount before submitting.",
      })
      return
    }

    setIsStaking(true)
    try {
      const effectiveHideBalance = balanceHidden
      const useRelayerPoolHide = effectiveHideBalance && HIDE_BALANCE_RELAYER_POOL_ENABLED
      const manualPendingExecution = Boolean(options?.manualExecuteFromPendingNote)
      const shouldDepositOnly = useRelayerPoolHide && effectiveHideBalance && !manualPendingExecution

      if (shouldDepositOnly) {
        clearManuallySelectedHideNote()
        clearTradePrivacyPayload()
        setHasTradePrivacyPayload(false)
      }

      const resolvedPrivacyPayload =
        options?.overridePayload ||
        (effectiveHideBalance
        ? await resolveHideBalancePrivacyPayload({
            flow: "stake",
            fromToken: effectivePool.symbol,
            toToken: effectivePool.symbol,
            amount: effectiveAmount,
          })
        : undefined)
      if (effectiveHideBalance && !resolvedPrivacyPayload) {
        throw new Error("Garaga payload is not ready for Hide Balance. Check backend auto-proof config.")
      }
      let onchainTxHash: string | undefined
      let payloadForBackend = resolvedPrivacyPayload

      if (shouldDepositOnly && payloadForBackend) {
        await ensureHideV3NoteDeposited({
          payload: payloadForBackend,
          symbol: effectivePool.symbol,
          amountText: effectiveAmount,
        })
        throw new Error("HIDE_NOTE_READY::Hide note berhasil dideposit. Retry private stake now.")
      }

      if (!useRelayerPoolHide) {
        notifications.addNotification({
          type: "info",
          title: "Wallet signature required",
          message: "Confirm staking transaction in your Starknet wallet.",
        })
        const submitted = await submitOnchainStakeTx(
          effectivePool.symbol,
          "stake",
          effectiveAmount,
          resolvedPrivacyPayload
        )
        onchainTxHash = submitted.txHash
        payloadForBackend = submitted.privacyPayload || resolvedPrivacyPayload
        notifications.addNotification({
          type: "info",
          title: "Staking pending",
          message: `Stake ${effectiveAmount} ${effectivePool.symbol} submitted on-chain (${onchainTxHash.slice(0, 10)}...).`,
          txHash: onchainTxHash,
          txNetwork: "starknet",
        })
      } else {
        notifications.addNotification({
          type: "info",
          title: "Submitting private stake",
          message: "Submitting hide-mode stake via backend relayer pool.",
        })
      }
      let response: Awaited<ReturnType<typeof stakeDeposit>>
      try {
        response = await stakeDeposit({
          pool_id: effectivePool.symbol,
          amount: effectiveAmount,
          onchain_tx_hash: onchainTxHash,
          hide_balance: effectiveHideBalance,
          privacy: effectiveHideBalance
            ? payloadForBackend || resolvedPrivacyPayload
            : undefined,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "")
        if (/nullifier already spent/i.test(message)) {
          consumeUsedHidePayload(payloadForBackend || resolvedPrivacyPayload)
          throw new Error(
            "HIDE_NOTE_SPENT::Selected hide note was already spent. Refreshing note state and retry with a new note."
          )
        }
        if (
          useRelayerPoolHide &&
          /note belum terdaftar/i.test(message) &&
          (payloadForBackend || resolvedPrivacyPayload)
        ) {
          const payload = payloadForBackend || resolvedPrivacyPayload
          const selectedCommitment = (
            payload?.note_commitment ||
            payload?.commitment ||
            ""
          )
            .trim()
            .toLowerCase()
          const selectedNullifier = (payload?.nullifier || "").trim().toLowerCase()
          if (isManuallySelectedHideNote(selectedCommitment, selectedNullifier)) {
            throw new Error(
              "Selected hide note is not recognized by the active executor/relayer. Auto-deposit is disabled for manually selected notes. Please choose another pending note or withdraw this note."
            )
          }
          let spendableAtUnix: number | undefined
          try {
            spendableAtUnix = await ensureHideV3NoteDeposited({
              payload: payload as PrivacyVerificationPayload,
              symbol: effectivePool.symbol,
              amountText: effectiveAmount,
            })
          } catch (depositError) {
            const depositMessage =
              depositError instanceof Error ? depositError.message : String(depositError || "")
            throw new Error(
              `Hide note belum terdaftar dan auto-deposit gagal. Detail: ${depositMessage}`
            )
          }
          if (spendableAtUnix && spendableAtUnix > 0) {
            throw new Error(
              "HIDE_NOTE_READY::Hide note berhasil dideposit. Retry private stake now."
            )
          }
          throw new Error(
            "HIDE_NOTE_READY::Hide note berhasil dideposit. Retry private stake now."
          )
        }
        if (
          useRelayerPoolHide &&
          /hide note\/pool balance tidak cukup/i.test(message)
        ) {
          throw new Error(message)
        }
        if (useRelayerPoolHide) {
          throw new Error(
            `Hide relayer unavailable. Wallet fallback is disabled so stake details never leak in explorer. Detail: ${message}`
          )
        }
        throw error
      }
      const finalTxHash = response.tx_hash || onchainTxHash
      if (useRelayerPoolHide && finalTxHash) {
        notifications.addNotification({
          type: "info",
          title: "Staking pending",
          message: `Stake ${effectiveAmount} ${effectivePool.symbol} submitted on-chain (${finalTxHash.slice(0, 10)}...).`,
          txHash: finalTxHash,
          txNetwork: "starknet",
        })
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
      if (effectiveHideBalance) {
        consumeUsedHidePayload(payloadForBackend || resolvedPrivacyPayload)
      }
      await Promise.allSettled([wallet.refreshPortfolio(), wallet.refreshOnchainBalances()])
      await refreshPositions()
      setStakeSuccess(true)
      notifications.addNotification({
        type: "success",
        title: "Staking successful",
        message: `Stake ${effectiveAmount} ${effectivePool.symbol} completed successfully`,
        txHash: finalTxHash,
        txNetwork: "starknet",
      })
    } catch (error) {
      const rawMessage = mapStakeUiErrorMessage(error, "Unable to complete staking")
      if (rawMessage.startsWith("HIDE_NOTE_WAIT::")) {
        notifications.addNotification({
          type: "warning",
          title: "Mixing window active",
          message: rawMessage.replace("HIDE_NOTE_WAIT::", "").trim(),
        })
        return
      }
      if (rawMessage.startsWith("HIDE_NOTE_READY::")) {
        notifications.addNotification({
          type: "success",
          title: "Hide note deposited",
          message: rawMessage.replace("HIDE_NOTE_READY::", "").trim(),
        })
        return
      }
      if (rawMessage.startsWith("HIDE_NOTE_SPENT::")) {
        consumeUsedHidePayload(loadTradePrivacyPayload())
        notifications.addNotification({
          type: "warning",
          title: "Hide note refreshed",
          message: rawMessage.replace("HIDE_NOTE_SPENT::", "").trim(),
        })
        return
      }
      notifications.addNotification({
        type: "error",
        title: "Staking failed",
        message: rawMessage,
      })
    } finally {
      setIsStaking(false)
    }
  }

  /**
   * Handles `handleUnstake` logic.
   *
   * @param positionId - Input used by `handleUnstake` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleUnstake = async (positionId: string) => {
    const target = positions.find((pos) => pos.id === positionId)
    if (!target) return

    setPositions((prev) =>
      prev.map((p) => (p.id === positionId ? { ...p, status: "unlocking" as const } : p))
    )

    try {
      const effectiveHideBalance = balanceHidden
      const useRelayerPoolHide = effectiveHideBalance && HIDE_BALANCE_RELAYER_POOL_ENABLED
      const resolvedPrivacyPayload = effectiveHideBalance
        ? await resolveHideBalancePrivacyPayload({
            flow: "unstake",
            fromToken: target.pool.symbol,
            toToken: target.pool.symbol,
            amount: target.amount.toString(),
          })
        : undefined
      if (effectiveHideBalance && !resolvedPrivacyPayload) {
        throw new Error("Garaga payload is not ready for Hide Balance. Check backend auto-proof config.")
      }
      let onchainTxHash: string | undefined
      let payloadForBackend = resolvedPrivacyPayload
      if (!useRelayerPoolHide) {
        notifications.addNotification({
          type: "info",
          title: "Wallet signature required",
          message: "Confirm unstake transaction in your Starknet wallet.",
        })
        const submitted = await submitOnchainStakeTx(
          target.pool.symbol,
          "unstake",
          target.amount.toString(),
          resolvedPrivacyPayload
        )
        onchainTxHash = submitted.txHash
        payloadForBackend = submitted.privacyPayload || resolvedPrivacyPayload
        notifications.addNotification({
          type: "info",
          title: "Unstake pending",
          message: `${target.amount} ${target.pool.symbol} submitted on-chain (${onchainTxHash.slice(0, 10)}...).`,
          txHash: onchainTxHash,
          txNetwork: "starknet",
        })
      } else {
        notifications.addNotification({
          type: "info",
          title: "Submitting private unstake",
          message: "Submitting hide-mode unstake via Starknet relayer pool.",
        })
      }
      let response: Awaited<ReturnType<typeof stakeWithdraw>>
      try {
        response = await stakeWithdraw({
          position_id: positionId,
          amount: target.amount.toString(),
          onchain_tx_hash: onchainTxHash,
          hide_balance: effectiveHideBalance,
          privacy: effectiveHideBalance
            ? payloadForBackend || resolvedPrivacyPayload
            : undefined,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "")
        if (/nullifier already spent/i.test(message)) {
          consumeUsedHidePayload(payloadForBackend || resolvedPrivacyPayload)
          throw new Error(
            "HIDE_NOTE_SPENT::Selected hide note was already spent. Refreshing note state and retry with a new note."
          )
        }
        if (
          useRelayerPoolHide &&
          /(insufficient allowance|shielded note funding failed|deposit_fixed_for|allowance)/i.test(
            message
          )
        ) {
          await approveRelayerFundingForStake(target.pool.symbol, target.amount.toString())
          try {
            response = await stakeWithdraw({
              position_id: positionId,
              amount: target.amount.toString(),
              onchain_tx_hash: onchainTxHash,
              hide_balance: effectiveHideBalance,
              privacy: effectiveHideBalance
                ? payloadForBackend || resolvedPrivacyPayload
                : undefined,
            })
          } catch (retryError) {
            const retryMessage =
              retryError instanceof Error ? retryError.message : String(retryError || "")
            if (/nullifier already spent/i.test(retryMessage)) {
              consumeUsedHidePayload(payloadForBackend || resolvedPrivacyPayload)
              throw new Error(
                "HIDE_NOTE_SPENT::Selected hide note was already spent. Refreshing note state and retry with a new note."
              )
            }
            throw retryError
          }
        } else {
          throw error
        }
      }
      const finalTxHash = response.tx_hash || onchainTxHash
      if (useRelayerPoolHide && finalTxHash) {
        notifications.addNotification({
          type: "info",
          title: "Unstake pending",
          message: `${target.amount} ${target.pool.symbol} submitted on-chain (${finalTxHash.slice(0, 10)}...).`,
          txHash: finalTxHash,
          txNetwork: "starknet",
        })
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
      if (effectiveHideBalance) {
        consumeUsedHidePayload(payloadForBackend || resolvedPrivacyPayload)
      }
      await Promise.allSettled([wallet.refreshPortfolio(), wallet.refreshOnchainBalances()])
      await refreshPositions()
      notifications.addNotification({
        type: "success",
        title: "Unstake processing",
        message: `${target.amount} ${target.pool.symbol} is being processed`,
        txHash: finalTxHash,
        txNetwork: "starknet",
      })
    } catch (error) {
      setPositions((prev) =>
        prev.map((p) => (p.id === positionId ? { ...p, status: "active" as const } : p))
      )
      const rawMessage = mapStakeUiErrorMessage(error, "Unable to complete unstake")
      if (rawMessage.startsWith("HIDE_NOTE_SPENT::")) {
        consumeUsedHidePayload(loadTradePrivacyPayload())
        notifications.addNotification({
          type: "warning",
          title: "Hide note refreshed",
          message: rawMessage.replace("HIDE_NOTE_SPENT::", "").trim(),
        })
        return
      }
      notifications.addNotification({
        type: "error",
        title: "Unstake failed",
        message: rawMessage,
      })
    }
  }

  /**
   * Handles `handleClaim` logic.
   *
   * @param positionId - Input used by `handleClaim` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleClaim = async (positionId: string) => {
    const target = positions.find((pos) => pos.id === positionId)
    if (!target) return

    setClaimingPositionId(positionId)
    try {
      const effectiveHideBalance = balanceHidden
      const useRelayerPoolHide = effectiveHideBalance && HIDE_BALANCE_RELAYER_POOL_ENABLED
      const resolvedPrivacyPayload = effectiveHideBalance
        ? await resolveHideBalancePrivacyPayload({
            flow: "stake_claim",
            fromToken: target.pool.symbol,
            toToken: target.pool.symbol,
            amount: target.rewards.toString(),
          })
        : undefined
      if (effectiveHideBalance && !resolvedPrivacyPayload) {
        throw new Error("Garaga payload is not ready for Hide Balance. Check backend auto-proof config.")
      }
      let onchainTxHash: string | undefined
      let payloadForBackend = resolvedPrivacyPayload
      if (!useRelayerPoolHide) {
        notifications.addNotification({
          type: "info",
          title: "Wallet signature required",
          message: "Confirm claim rewards transaction in your Starknet wallet.",
        })
        const submitted = await submitOnchainClaimTx(target.pool.symbol, resolvedPrivacyPayload)
        onchainTxHash = submitted.txHash
        payloadForBackend = submitted.privacyPayload || resolvedPrivacyPayload
        notifications.addNotification({
          type: "info",
          title: "Claim pending",
          message: `Claim ${target.pool.symbol} rewards submitted on-chain (${onchainTxHash.slice(0, 10)}...).`,
          txHash: onchainTxHash,
          txNetwork: "starknet",
        })
      } else {
        notifications.addNotification({
          type: "info",
          title: "Submitting private claim",
          message: "Submitting hide-mode claim via Starknet relayer pool.",
        })
      }
      let response: Awaited<ReturnType<typeof stakeClaim>>
      try {
        response = await stakeClaim({
          position_id: positionId,
          onchain_tx_hash: onchainTxHash,
          hide_balance: effectiveHideBalance,
          privacy: effectiveHideBalance
            ? payloadForBackend || resolvedPrivacyPayload
            : undefined,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "")
        if (/nullifier already spent/i.test(message)) {
          consumeUsedHidePayload(payloadForBackend || resolvedPrivacyPayload)
          throw new Error(
            "HIDE_NOTE_SPENT::Selected hide note was already spent. Refreshing note state and retry with a new note."
          )
        }
        if (
          useRelayerPoolHide &&
          /(insufficient allowance|shielded note funding failed|deposit_fixed_for|allowance)/i.test(
            message
          )
        ) {
          await approveRelayerFundingForStake(target.pool.symbol, "1")
          try {
            response = await stakeClaim({
              position_id: positionId,
              onchain_tx_hash: onchainTxHash,
              hide_balance: effectiveHideBalance,
              privacy: effectiveHideBalance
                ? payloadForBackend || resolvedPrivacyPayload
                : undefined,
            })
          } catch (retryError) {
            const retryMessage =
              retryError instanceof Error ? retryError.message : String(retryError || "")
            if (/nullifier already spent/i.test(retryMessage)) {
              consumeUsedHidePayload(payloadForBackend || resolvedPrivacyPayload)
              throw new Error(
                "HIDE_NOTE_SPENT::Selected hide note was already spent. Refreshing note state and retry with a new note."
              )
            }
            throw retryError
          }
        } else {
          throw error
        }
      }
      const finalTxHash = response.tx_hash || onchainTxHash
      if (useRelayerPoolHide && finalTxHash) {
        notifications.addNotification({
          type: "info",
          title: "Claim pending",
          message: `Claim ${target.pool.symbol} rewards submitted on-chain (${finalTxHash.slice(0, 10)}...).`,
          txHash: finalTxHash,
          txNetwork: "starknet",
        })
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
      if (effectiveHideBalance) {
        consumeUsedHidePayload(payloadForBackend || resolvedPrivacyPayload)
      }
      await Promise.allSettled([wallet.refreshPortfolio(), wallet.refreshOnchainBalances()])
      await refreshPositions()
      notifications.addNotification({
        type: "success",
        title: "Claim completed",
        message: `Staking rewards claim confirmed for ${target.pool.symbol}.`,
        txHash: finalTxHash,
        txNetwork: "starknet",
      })
    } catch (error) {
      const rawMessage = mapStakeUiErrorMessage(error, "Unable to claim staking rewards")
      if (rawMessage.startsWith("HIDE_NOTE_SPENT::")) {
        consumeUsedHidePayload(loadTradePrivacyPayload())
        notifications.addNotification({
          type: "warning",
          title: "Hide note refreshed",
          message: rawMessage.replace("HIDE_NOTE_SPENT::", "").trim(),
        })
        return
      }
      notifications.addNotification({
        type: "error",
        title: "Claim failed",
        message: rawMessage,
      })
    } finally {
      setClaimingPositionId((current) => (current === positionId ? null : current))
    }
  }

  const totalStaked = positions.reduce((acc, p) => {
    const price = tokenPrices[p.pool.symbol] ?? 0
    return acc + (p.amount * price)
  }, 0)

  const totalRewards = positions.reduce((acc, p) => {
    const price = tokenPrices[p.pool.symbol] ?? 0
    return acc + (p.rewards * price)
  }, 0)

  const currentCarelStake = positions
    .filter((p) => p.pool.symbol === "CAREL")
    .reduce((acc, p) => acc + p.amount, 0)
  const pointsMultiplier =
    currentCarelStake >= 10_000 ? 5 : currentCarelStake >= 1_000 ? 3 : currentCarelStake >= 100 ? 2 : 1
  const activeDiscountPercent = activeNftDiscount?.discount ?? 0
  const activeDiscountMaxUsage = activeNftDiscount?.max_usage
  const activeDiscountUsed = activeNftDiscount?.used_in_period ?? 0
  const activeDiscountRemainingUsage =
    typeof activeDiscountMaxUsage === "number"
      ? Math.max(0, activeDiscountMaxUsage - activeDiscountUsed)
      : null

  const totalValueLocked = displayPools.reduce((acc, pool) => acc + pool.tvlValue, 0)

  return (
    <section id="stake" className="py-12">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/20 border border-primary/30 mb-4">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-primary">Testnet Active</span>
          </div>
          <h2 className="text-3xl font-bold text-foreground mb-2">Stake & Earn</h2>
          <p className="text-muted-foreground">Earn passive income from your crypto assets</p>
        </div>

        {/* Stats */}
        <div className="grid md:grid-cols-4 gap-6 mb-8">
          <div className="p-6 rounded-xl glass border border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">Total Value Locked</p>
            </div>
            <p className="text-2xl font-bold text-foreground">
              {totalValueLocked > 0 ? `$${formatCompact(totalValueLocked)}` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Based on pool totals</p>
          </div>

          <div className="p-6 rounded-xl glass border border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-secondary/20 flex items-center justify-center">
                <Coins className="h-5 w-5 text-secondary" />
              </div>
              <p className="text-sm text-muted-foreground">Active Positions</p>
            </div>
            <p className="text-2xl font-bold text-foreground">
              {activePositions > 0 ? activePositions.toLocaleString() : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Active positions</p>
          </div>

          <div className="p-6 rounded-xl glass border border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-accent" />
              </div>
              <p className="text-sm text-muted-foreground">Your Total Staked</p>
            </div>
            <p className="text-2xl font-bold text-foreground">
              {balanceHidden ? "••••••" : totalStaked > 0 ? `$${totalStaked.toLocaleString()}` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{positions.length} active positions</p>
          </div>

          <div className="p-6 rounded-xl glass border border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-success" />
              </div>
              <p className="text-sm text-muted-foreground">Total Rewards</p>
            </div>
            <p className="text-2xl font-bold text-success">
              {balanceHidden ? "••••••" : totalRewards > 0 ? `$${totalRewards.toFixed(2)}` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Ready to claim</p>
          </div>
        </div>

        {/* Info Banner */}
        <div className="mb-8 p-4 rounded-xl bg-secondary/10 border border-secondary/20">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-secondary flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Testnet Mode</p>
              <p className="text-xs text-muted-foreground mt-1">
                Staking uses testnet tokens. Rewards follow testnet contracts and may change based on pool conditions.
              </p>
              <p className="text-xs text-foreground mt-2">
                Active points multiplier: <span className="text-primary font-semibold">{pointsMultiplier}x</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Your CAREL stake: {currentCarelStake.toLocaleString(undefined, { maximumFractionDigits: 4 })} CAREL
              </p>
              <p className="text-xs text-foreground mt-2">
                NFT discount while staking:{" "}
                <span className={cn("font-semibold", activeDiscountPercent > 0 ? "text-success" : "text-muted-foreground")}>
                  {activeDiscountPercent > 0 ? `% active` : "inactive"}
                </span>
              </p>
              {activeDiscountPercent > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Usage in current period: {activeDiscountUsed}
                  {typeof activeDiscountRemainingUsage === "number" ? ` • remaining ${activeDiscountRemainingUsage}` : ""}
                </p>
              )}
              <div className="mt-3 rounded-lg border border-border bg-surface/40 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Hide Balance</p>
                    <p className="text-[11px] text-muted-foreground">
                      Use Garaga privacy call before stake/unstake execution.
                    </p>
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
                    className="mt-2 w-full rounded-lg border border-border bg-surface/30 px-3 py-2 text-left transition-colors hover:border-primary/50"
                  >
                    <p className="text-[11px] text-muted-foreground">{hideBalanceCompactSummary}</p>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Staking Pools */}
        <div className="space-y-6">
          {displayPools.length === 0 ? (
            <div className="p-6 rounded-xl glass border border-border text-center text-muted-foreground">
              No staking pools available
            </div>
          ) : (
            <>
              {/* Stablecoins Section */}
              <div>
                <h3 className="text-lg font-bold text-foreground mb-4">Stablecoins</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  {displayPools
                    .filter((pool) => pool.type === "Stablecoin")
                    .map((pool) => (
                      <StakingCard
                        key={pool.symbol}
                        pool={pool}
                        onStake={() => handleStake(pool)}
                        balanceHidden={balanceHidden}
                      />
                    ))}
                </div>
              </div>

              {/* Cryptocurrencies Section */}
              <div>
                <h3 className="text-lg font-bold text-foreground mb-4">Cryptocurrencies</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  {displayPools
                    .filter((pool) => pool.type === "Crypto")
                    .map((pool) => (
                      <StakingCard
                        key={pool.symbol}
                        pool={pool}
                        onStake={() => handleStake(pool)}
                        balanceHidden={balanceHidden}
                      />
                    ))}
                </div>
              </div>

            </>
          )}
        </div>

        {/* Your Staking Positions */}
        <div className="mt-12 p-6 rounded-2xl glass-strong border border-border">
          <h3 className="text-lg font-bold text-foreground mb-4">Your Staking Positions</h3>
          
          {positions.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-full bg-muted/20 flex items-center justify-center mx-auto mb-4">
                <Clock className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground">No staking positions yet</p>
              <p className="text-sm text-muted-foreground mt-2">
                Stake your tokens to start earning rewards
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {positions.map((position) => (
                <div key={position.id} className="p-4 rounded-xl bg-surface/50 border border-border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center",
                        position.pool.gradient
                      )}>
                        <span className="text-xl text-white">{position.pool.icon}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-foreground">{position.pool.symbol}</h4>
                          <span className={cn(
                            "px-2 py-0.5 text-xs rounded-full",
                            position.status === "active" ? "bg-success/20 text-success" :
                            position.status === "unlocking" ? "bg-secondary/20 text-secondary" :
                            "bg-muted/20 text-muted-foreground"
                          )}>
                            {position.status === "active" ? "Active" : 
                             position.status === "unlocking" ? "Unlocking..." : "Pending"}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {balanceHidden ? `•••••• ${position.pool.symbol} staked` : `${position.amount} ${position.pool.symbol} staked`}
                        </p>
                        <p className="text-xs text-muted-foreground">{position.stakedAt}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">APY</p>
                        <p className="text-lg font-bold text-success">{position.pool.apyDisplay ?? apyDisplayFor(position.pool)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Rewards</p>
                        <p className="text-lg font-bold text-foreground">
                          {balanceHidden ? `•••••• ${position.pool.symbol}` : `${position.rewards.toFixed(4)} ${position.pool.symbol}`}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleClaim(position.id)}
                          disabled={claimingPositionId === position.id}
                          className="text-foreground"
                        >
                          {claimingPositionId === position.id ? "Claiming..." : "Claim"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleUnstake(position.id)}
                          disabled={position.status === "unlocking" || claimingPositionId === position.id}
                          className="text-muted-foreground"
                        >
                          {position.status === "unlocking" ? "Unlocking..." : "Unstake"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={hideBalancePopupOpen} onOpenChange={setHideBalancePopupOpen}>
        <DialogContent className="max-w-lg glass-strong border-border max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Hide Balance</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              Add Garaga privacy proof in the same on-chain transaction.
            </p>
            <div className="space-y-2 rounded-lg border border-border bg-surface/40 p-3">
              <p className="text-xs text-foreground">Hide Tier (USDT)</p>
              <div className="grid grid-cols-5 gap-2">
                {USDT_POINTS_TIER_OPTIONS.map((option) => {
                  const selected = selectedHideTier.minUsdt === option.minUsdt
                  return (
                    <button
                      key={option.minUsdt}
                      type="button"
                      onClick={() => setHideUsdtTierMin(option.minUsdt)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-[10px] transition-colors",
                        selected
                          ? "border-primary bg-primary/20 text-primary"
                          : "border-border bg-surface text-muted-foreground hover:border-primary/50"
                      )}
                    >
                      <div>${option.minUsdt}</div>
                      <div>+{option.bonusPercent}%</div>
                    </button>
                  )
                })}
              </div>
              {selectedPool && (
                <p className="text-[11px] text-muted-foreground">
                  Nominal hide stake dikunci ke tier ${selectedHideTier.minUsdt}: ~
                  {hideTierLockedStakeAmount && Number.isFinite(hideTierLockedStakeAmount)
                    ? Number(hideTierLockedStakeAmount).toLocaleString(undefined, {
                        maximumFractionDigits: 6,
                      })
                    : "—"}{" "}
                  {selectedPool.symbol} • Bonus +{selectedHideTier.bonusPercent}%.
                </p>
              )}
            </div>
            <div className="rounded-lg border border-border bg-surface/40 p-3">
              <p className="text-[11px] text-muted-foreground">
                {hasTradePrivacyPayload
                  ? "Garaga payload is ready."
                  : isAutoPrivacyProvisioning
                  ? "Preparing Garaga payload..."
                  : "Garaga payload will be auto-prepared on submit."}
              </p>
            </div>
            {pendingHideNotesActive.length > 0 && (
              <div className="space-y-2 rounded-lg border border-border bg-surface/40 p-3">
                <p className="text-[11px] font-medium text-foreground">
                  Pending Hide Notes ({pendingHideNotesActive.length})
                </p>
                {pendingHideNotesActive.map((note) => {
                  const spendableAt = Number(note.spendable_at_unix || 0)
                  const remainingMs =
                    spendableAt > 0 ? Math.max(0, spendableAt * 1000 - nowMs) : 0
                  const isReady = remainingMs <= 0
                  const isNoteSubmitting =
                    pendingNoteActionCommitment === note.note_commitment
                  const fromSymbol = (note.token_symbol || "Token").toUpperCase()
                  const toSymbol = (note.target_token_symbol || fromSymbol).toUpperCase()
                  return (
                    <div key={note.note_commitment} className="rounded-md border border-border/60 p-2">
                      <p className="text-[10px] font-mono text-muted-foreground">
                        {note.note_commitment.slice(0, 12)}...{note.note_commitment.slice(-6)}
                      </p>
                      <p className="text-[11px] text-foreground">
                        {(note.amount || "—").trim()} {fromSymbol} → {toSymbol} •{" "}
                        {isReady ? "Ready now" : `Ready in ${formatRemainingDuration(remainingMs)}`}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <Button
                          type="button"
                          className="h-7 flex-1 text-[11px]"
                          onClick={() => void handleUsePendingHideNote(note)}
                          disabled={!isReady || isStaking || isNoteSubmitting}
                        >
                          {isNoteSubmitting ? "Processing..." : "Private Stake now"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-7 flex-1 text-[11px]"
                          onClick={() => void handleWithdrawPendingHideNote(note)}
                          disabled={isStaking || isNoteSubmitting}
                        >
                          Withdraw
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Stake Dialog */}
      <Dialog open={stakeDialogOpen} onOpenChange={setStakeDialogOpen}>
        <DialogContent className="max-w-md glass-strong border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedPool && (
                <>
                  <div className={cn(
                    "w-8 h-8 rounded-full bg-gradient-to-br flex items-center justify-center",
                    selectedPool.gradient
                  )}>
                    <span className="text-lg text-white">{selectedPool.icon}</span>
                  </div>
                  Stake {selectedPool.symbol}
                </>
              )}
            </DialogTitle>
          </DialogHeader>

          {stakeSuccess ? (
            <div className="py-8 text-center">
              <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
                <Check className="h-8 w-8 text-success" />
              </div>
              <p className="text-lg font-medium text-foreground">Staking Successful!</p>
              <p className="text-sm text-muted-foreground mt-2">
                {stakeAmount} {selectedPool?.symbol} has been staked
              </p>
              <Button
                onClick={() => setStakeDialogOpen(false)}
                className="mt-4"
              >
                Close
              </Button>
            </div>
          ) : (
            <Tabs defaultValue="stake">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="stake">Stake</TabsTrigger>
                <TabsTrigger value="info">Pool Info</TabsTrigger>
              </TabsList>

              <TabsContent value="stake" className="space-y-4">
                {selectedPool && (
                  <>
                    <div className="p-4 rounded-xl bg-surface/50 border border-border">
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-muted-foreground">APY</span>
                        <span className="text-lg font-bold text-success">{selectedPool.apyDisplay ?? apyDisplayFor(selectedPool)}</span>
                      </div>
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-muted-foreground">Lock Period</span>
                        <span className="text-sm font-medium text-foreground">{selectedPool.lockPeriod}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Min. Stake</span>
                        <span className="text-sm font-medium text-foreground">{selectedPool.minStake} {selectedPool.symbol}</span>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between mb-2">
                        <label className="text-sm font-medium text-foreground">Amount</label>
                        <span className="text-xs text-muted-foreground">
                          Balance: {balanceHidden ? "••••••" : selectedPool.userBalance.toLocaleString()} {selectedPool.symbol}
                        </span>
                      </div>
                      <input
                        type="number"
                        value={stakeAmount}
                        onChange={(e) => setStakeAmount(e.target.value)}
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

                    {balanceHidden && (
                      <button
                        type="button"
                        onClick={() => setHideBalancePopupOpen(true)}
                        className="w-full rounded-lg border border-border bg-surface/40 px-3 py-2 text-left transition-colors hover:border-primary/50"
                      >
                        <p className="text-[11px] text-muted-foreground">{hideBalanceCompactSummary}</p>
                      </button>
                    )}

                    {Number.parseFloat(stakeAmount) > 0 && (
                      <div className="p-3 rounded-lg bg-success/10 border border-success/20">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Estimated Reward/Month</span>
                          <span className="font-medium text-success">
                            {(Number.parseFloat(stakeAmount) * Number.parseFloat(selectedPool.apy) / 100 / 12).toFixed(4)} {selectedPool.symbol}
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                      <p className="text-xs text-foreground">
                        {activeDiscountPercent > 0
                          ? `NFT discount ${activeDiscountPercent}% is active. Usage decreases only after successful on-chain stake/unstake transactions.`
                          : "NFT discount is inactive. Mint an NFT tier to activate discount usage."}
                      </p>
                    </div>

                    <div className="p-3 rounded-lg bg-secondary/10 border border-secondary/20">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-secondary flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-foreground">
                          Testnet token. Rewards follow testnet contracts.
                        </p>
                      </div>
                    </div>

                    <Button
                      onClick={() => void confirmStake()}
                      disabled={
                        !stakeAmount ||
                        Number.parseFloat(stakeAmount) < Number.parseFloat(selectedPool.minStake) ||
                        isStaking ||
                        isAutoPrivacyProvisioning
                      }
                      className="w-full bg-primary hover:bg-primary/90"
                    >
                      {isAutoPrivacyProvisioning
                        ? "Preparing Hide Balance..."
                        : isStaking
                        ? "Processing..."
                        : `Stake ${selectedPool.symbol}`}
                    </Button>
                  </>
                )}
              </TabsContent>

              <TabsContent value="info" className="space-y-4">
                {selectedPool && (
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-surface/50 border border-border">
                      <h4 className="font-medium text-foreground mb-3">Pool Details</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Total Staked</span>
                          <span className="text-sm font-medium text-foreground">{selectedPool.tvl}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">APY</span>
                          <span className="text-sm font-medium text-success">{selectedPool.apyDisplay ?? apyDisplayFor(selectedPool)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Lock Period</span>
                          <span className="text-sm font-medium text-foreground">{selectedPool.lockPeriod}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Min. Stake</span>
                          <span className="text-sm font-medium text-foreground">{selectedPool.minStake} {selectedPool.symbol}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Reward Token</span>
                          <span className="text-sm font-medium text-foreground">{selectedPool.reward}</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-surface/50 border border-border">
                      <h4 className="font-medium text-foreground mb-3">How It Works</h4>
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        <li className="flex items-start gap-2">
                          <span className="text-primary">1.</span>
                          Stake your tokens in the pool
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-primary">2.</span>
                          Rewards accumulate every block
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-primary">3.</span>
                          Claim rewards anytime
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-primary">4.</span>
                          Unstake after lock period is complete
                        </li>
                      </ul>
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}

/**
 * Handles `StakingCard` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function StakingCard({
  pool,
  onStake,
  balanceHidden,
}: {
  pool: StakingPool
  onStake: () => void
  balanceHidden: boolean
}) {
  return (
    <div className="p-6 rounded-xl glass border border-border hover:border-primary/30 transition-all group">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={cn("w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center", pool.gradient)}>
            <span className="text-2xl text-white">{pool.icon}</span>
          </div>
          <div>
            <h4 className="font-bold text-foreground">{pool.symbol}</h4>
            <p className="text-sm text-muted-foreground">{pool.name}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">APY</p>
          <p className="text-2xl font-bold text-success">{pool.apyDisplay ?? apyDisplayFor(pool)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <p className="text-xs text-muted-foreground">Total Staked</p>
          <p className="text-sm font-medium text-foreground">{pool.tvl}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Harga Spot</p>
          <p className="text-sm font-medium text-foreground">
            {pool.spotPrice > 0 ? `$${pool.spotPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Min. Stake</p>
          <p className="text-sm font-medium text-foreground">
            {pool.minStake} {pool.symbol}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Lock Period</p>
          <p className="text-sm font-medium text-foreground">{pool.lockPeriod}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Your Balance</p>
          <p className="text-sm font-medium text-foreground">
            {balanceHidden ? "••••••" : pool.userBalance.toLocaleString()}
          </p>
        </div>
      </div>

      <Button
        onClick={onStake}
        className="w-full bg-primary hover:bg-primary/90"
      >
        Stake {pool.symbol}
      </Button>
    </div>
  )
}
