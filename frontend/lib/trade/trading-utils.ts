import type { PrivacyVerificationPayload } from "@/lib/api"
import type {
  BridgeRewardsSnapshot,
  GardenOrderProgress,
  PendingBtcDepositState,
  PendingHideNoteRecord,
  QuoteState,
} from "@/lib/trading-types"
import { decimalToU256Parts, toHexFelt } from "@/lib/onchain-trade"

export const MEV_FEE_RATE = 0.01
// Keep STRK to pay Starknet L2 fees. Too-low reserve causes Argent/Ready multicall to revert
// with `u256_sub Overflow` when the fee token transfer is charged.
export const STARKNET_STRK_GAS_RESERVE = 10
// If backend on-chain quotes diverge too much from live USD prices (common on testnets),
// normalize the displayed output amount to avoid showing unrealistic profit/loss.
export const LIVE_PRICE_NORMALIZATION_THRESHOLD = 0.1
export const QUOTE_CACHE_TTL_MS = 20_000
export const MAX_QUOTE_CACHE_ENTRIES = 120
export const ALLOWANCE_CACHE_TTL_MS = 15_000
export const TRADE_PRIVACY_PAYLOAD_KEY = "trade_privacy_garaga_payload_v4"
export const TRADE_PRIVACY_PENDING_NOTES_KEY = "trade_privacy_pending_notes_v4"
export const TRADE_PRIVACY_PENDING_NOTES_UPDATED_EVENT = "trade-privacy-pending-notes-updated"
export const TRADE_PENDING_BTC_DEPOSIT_KEY = "trade_pending_btc_deposit_v1"
export const TRADE_PENDING_BTC_DEPOSITS_KEY = "trade_pending_btc_deposits_v1"
export const TRADE_BRIDGE_REWARDS_KEY = "trade_bridge_rewards_v1"
export const DEV_AUTO_GARAGA_PAYLOAD_ENABLED =
  process.env.NODE_ENV !== "production" &&
  (process.env.NEXT_PUBLIC_ENABLE_DEV_GARAGA_AUTOFILL || "false").toLowerCase() === "true"
export const HIDE_BALANCE_FALLBACK_TO_PUBLIC_ENABLED =
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_FALLBACK_TO_PUBLIC || "false").toLowerCase() === "true"
export const PRIVATE_ACTION_EXECUTOR_ADDRESS =
  (process.env.NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim()
export const HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED =
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED || "false").toLowerCase() ===
    "true" && PRIVATE_ACTION_EXECUTOR_ADDRESS.length > 0
export const HIDE_BALANCE_RELAYER_POOL_ENABLED =
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_ENABLED || "false").toLowerCase() === "true"
export const HIDE_BALANCE_EXECUTOR_KIND = (
  process.env.NEXT_PUBLIC_HIDE_BALANCE_EXECUTOR_KIND || ""
)
  .trim()
  .toLowerCase()
export const HIDE_BALANCE_SHIELDED_POOL_V4 =
  HIDE_BALANCE_EXECUTOR_KIND === "shielded_pool_v4" ||
  HIDE_BALANCE_EXECUTOR_KIND === "shielded-v4" ||
  HIDE_BALANCE_EXECUTOR_KIND === "v4"
export const HIDE_BALANCE_SHIELDED_POOL = HIDE_BALANCE_SHIELDED_POOL_V4
export const HIDE_BALANCE_PRIVATE_SWAP_BLOCK_REASON = null
export const HIDE_BALANCE_NOTE_VERSION = HIDE_BALANCE_SHIELDED_POOL_V4 ? "v4" : undefined
export const HIDE_BALANCE_MIN_NOTE_AGE_SECS_RAW =
  process.env.NEXT_PUBLIC_HIDE_BALANCE_MIN_NOTE_AGE_SECS ||
  process.env.NEXT_PUBLIC_AI_HIDE_MIN_NOTE_AGE_SECS ||
  "60"
export const HIDE_BALANCE_MIN_NOTE_AGE_SECS = Number.parseInt(HIDE_BALANCE_MIN_NOTE_AGE_SECS_RAW, 10)
export const HIDE_BALANCE_MIN_NOTE_AGE_MS =
  (Number.isFinite(HIDE_BALANCE_MIN_NOTE_AGE_SECS) && HIDE_BALANCE_MIN_NOTE_AGE_SECS > 0
    ? HIDE_BALANCE_MIN_NOTE_AGE_SECS
    : 60) * 1000

export const CAREL_PROTOCOL_ADDRESS = process.env.NEXT_PUBLIC_CAREL_PROTOCOL_ADDRESS || ""
export const STARKNET_SWAP_CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_SWAP_CONTRACT_ADDRESS ||
  process.env.NEXT_PUBLIC_CAREL_PROTOCOL_ADDRESS ||
  ""
export const STARKNET_BRIDGE_AGGREGATOR_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_BRIDGE_AGGREGATOR_ADDRESS ||
  ""
export const STARKNET_ZK_PRIVACY_ROUTER_ADDRESS =
  process.env.NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS ||
  process.env.NEXT_PUBLIC_PRIVACY_ROUTER_ADDRESS ||
  ""
export const STARKGATE_ETH_BRIDGE_ADDRESS =
  process.env.NEXT_PUBLIC_STARKGATE_ETH_BRIDGE_ADDRESS ||
  "0x8453FC6Cd1bCfE8D4dFC069C400B433054d47bDc"
export const STARKGATE_ETH_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_STARKGATE_ETH_TOKEN_ADDRESS ||
  "0x0000000000000000000000000000000000455448"
export const GARDEN_STARKNET_APPROVE_SELECTOR =
  "0x219209e083275171774dab1df80982e9df2096516f06319c5c6d71ae0a8480c"
export const GARDEN_STARKNET_INITIATE_SELECTOR =
  "0x2aed25fcd0101fcece997d93f9d0643dfa3fbd4118cae16bf7d6cd533577c28"
export const ETHERSCAN_SEPOLIA_BASE_URL =
  process.env.NEXT_PUBLIC_ETHERSCAN_SEPOLIA_URL || "https://sepolia.etherscan.io"
export const STARKSCAN_SEPOLIA_BASE_URL =
  process.env.NEXT_PUBLIC_STARKNET_EXPLORER_URL ||
  process.env.NEXT_PUBLIC_STARKSCAN_SEPOLIA_URL ||
  "https://sepolia.voyager.online"
export const BTC_TESTNET_EXPLORER_BASE_URL =
  process.env.NEXT_PUBLIC_BTC_TESTNET_EXPLORER_URL || "https://mempool.space/testnet4"
export const GARDEN_ORDER_EXPLORER_BASE_URL =
  process.env.NEXT_PUBLIC_GARDEN_ORDER_EXPLORER_URL || "https://testnet-explorer.garden.finance/order"
export const BTC_TESTNET_FAUCET_URL =
  process.env.NEXT_PUBLIC_BTC_TESTNET_FAUCET_URL || "https://testnet4.info/"
export const BTC_VAULT_ADDRESS = (process.env.NEXT_PUBLIC_BTC_VAULT_ADDRESS || "").trim()
export const BRIDGE_TO_STRK_DISABLED_MESSAGE =
  "Bridge to STRK is currently disabled. Use Starknet L2 Swap for STRK pairs."
export const UNSUPPORTED_BRIDGE_PAIR_MESSAGE =
  "Bridge pair is not supported on current testnet routes. Supported pairs: ETH↔BTC, BTC↔WBTC, and ETH↔WBTC (Ethereum↔Starknet)."

export const STARKNET_TOKEN_ADDRESS: Record<string, string> = {
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

export const TOKEN_DECIMALS: Record<string, number> = {
  BTC: 8,
  WBTC: 8,
  USDT: 6,
  USDC: 6,
  ETH: 18,
  STRK: 18,
  CAREL: 18,
}
export const U256_MAX_LOW_HEX = "0xffffffffffffffffffffffffffffffff"
export const U256_MAX_HIGH_HEX = "0xffffffffffffffffffffffffffffffff"
export type TxExplorerNetwork = "starknet" | "evm" | "btc"

/**
 * Handles `chainFromNetwork` logic.
 *
 * @param network - Input used by `chainFromNetwork` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export const chainFromNetwork = (network: string) => {
  const key = network.trim().toLowerCase()
  if (key.includes("bitcoin")) return "bitcoin"
  if (key.includes("ethereum")) return "ethereum"
  if (key.includes("starknet")) return "starknet"
  return key
}

export const buildTxExplorerUrl = (txHash: string, network: TxExplorerNetwork) => {
  const normalizedHash = txHash.trim()
  if (!normalizedHash) return ""
  if (network === "starknet") {
    const base = STARKSCAN_SEPOLIA_BASE_URL.trim().replace(/\/$/, "")
    return base ? `${base}/tx/${normalizedHash}` : ""
  }
  if (network === "evm") {
    const base = ETHERSCAN_SEPOLIA_BASE_URL.trim().replace(/\/$/, "")
    return base ? `${base}/tx/${normalizedHash}` : ""
  }
  const btcHash = normalizedHash.startsWith("0x") ? normalizedHash.slice(2) : normalizedHash
  const base = BTC_TESTNET_EXPLORER_BASE_URL.trim().replace(/\/$/, "")
  return base ? `${base}/tx/${btcHash}` : ""
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
export const isBridgeToStrkDisabledRoute = (fromChain: string, toChain: string, toSymbol: string) =>
  fromChain !== "starknet" && toChain === "starknet" && toSymbol.trim().toUpperCase() === "STRK"

export const isBridgePairSupportedForCurrentRoutes = (
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

export const convertAmountByUsdPrice = (
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
export const normalizeFeltAddress = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (!trimmed.startsWith("0x")) return trimmed.toLowerCase()
  try {
    return `0x${BigInt(trimmed).toString(16)}`
  } catch {
    return trimmed.toLowerCase()
  }
}

export const normalizeExecutorAddress = (value?: string) => {
  const trimmed = (value || "").trim()
  if (!trimmed) return ""
  return normalizeFeltAddress(trimmed)
}

const CURRENT_HIDE_EXECUTOR_NORMALIZED = normalizeExecutorAddress(PRIVATE_ACTION_EXECUTOR_ADDRESS)

export const normalizeHexArray = (value: unknown): string[] => {
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

export const parseApproveCallAllowance = (call: {
  contractAddress: string
  calldata: string[]
}) => {
  const spender = String(call.calldata?.[0] || "").trim()
  const low = String(call.calldata?.[1] || "0").trim()
  const high = String(call.calldata?.[2] || "0").trim()
  let amount = BigInt(0)
  try {
    amount = BigInt(low || "0") + (BigInt(high || "0") << BigInt(128))
  } catch {
    amount = BigInt(0)
  }
  return {
    tokenAddress: call.contractAddress.trim(),
    spender,
    amount,
  }
}

export const inferHideRootFromPublicInputs = (publicInputs: string[]): string | undefined => {
  const root = publicInputs[0]?.trim()
  return root && root.length > 0 ? root : undefined
}

export const isHidePayload = (payload: PrivacyVerificationPayload | undefined): boolean =>
  (payload?.note_version || "").trim().toLowerCase() === "v4" ||
  (HIDE_BALANCE_SHIELDED_POOL_V4 && !!(payload?.executor_address || "").trim())

export const hasCompleteHideSpendPayload = (payload: PrivacyVerificationPayload | undefined): boolean => {
  if (!isHidePayload(payload)) return false
  const noteCommitment = (payload?.note_commitment || payload?.commitment || "").trim()
  const nullifier = (payload?.nullifier || "").trim()
  const proof = normalizeHexArray(payload?.proof)
  const publicInputs = normalizeHexArray(payload?.public_inputs)
  const root = (payload?.root || "").trim() || inferHideRootFromPublicInputs(publicInputs)
  return (
    noteCommitment.length > 0 &&
    nullifier.length > 0 &&
    !!root &&
    root.length > 0 &&
    proof.length > 0 &&
    publicInputs.length > 0
  )
}

export const usdtTierBonusPercent = (usdtEquivalentVolume: number): number => {
  if (!Number.isFinite(usdtEquivalentVolume) || usdtEquivalentVolume <= 0) return 0
  if (usdtEquivalentVolume >= 250) return 50
  if (usdtEquivalentVolume >= 100) return 30
  if (usdtEquivalentVolume >= 50) return 20
  if (usdtEquivalentVolume >= 10) return 10
  if (usdtEquivalentVolume >= 5) return 5
  return 0
}

export const inferHideDenomIdFromUsd = (usdtEquivalentVolume: number): string => {
  if (!Number.isFinite(usdtEquivalentVolume) || usdtEquivalentVolume <= 0) return "1"
  if (usdtEquivalentVolume >= 250) return "250"
  if (usdtEquivalentVolume >= 100) return "100"
  if (usdtEquivalentVolume >= 50) return "50"
  if (usdtEquivalentVolume >= 10) return "10"
  if (usdtEquivalentVolume >= 5) return "5"
  return "1"
}

export const inferUsdtTierFromDenomId = (denomId: string): number => {
  const parsed = Number.parseFloat((denomId || "").trim())
  if (!Number.isFinite(parsed) || parsed <= 0) return 5
  if (parsed >= 250) return 250
  if (parsed >= 100) return 100
  if (parsed >= 50) return 50
  if (parsed >= 10) return 10
  if (parsed >= 5) return 5
  return 5
}

export const loadTradePrivacyPayload = (): PrivacyVerificationPayload | undefined => {
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
    const inferredNoteVersion =
      typeof parsed.note_version === "string" && parsed.note_version.trim().length > 0
        ? parsed.note_version.trim()
        : undefined
    const inferredNoteVersionLower = (inferredNoteVersion || "").toLowerCase()
    if (inferredNoteVersionLower && inferredNoteVersionLower !== "v4") {
      window.localStorage.removeItem(TRADE_PRIVACY_PAYLOAD_KEY)
      return undefined
    }
    const hasShieldedMetadata =
      (parsed.executor_address || "").trim().length > 0 &&
      ((parsed.root || "").trim().length > 0 ||
        (parsed.note_commitment || parsed.commitment || "").trim().length > 0)
    const inferredV4 = inferredNoteVersionLower === "v4" || (!inferredNoteVersionLower && hasShieldedMetadata)
    if ((!proof.length || !publicInputs.length) && !inferredV4) return undefined
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
    const noteCommitment =
      typeof parsed.note_commitment === "string" && parsed.note_commitment.trim().length > 0
        ? parsed.note_commitment.trim()
        : inferredV4 && commitment
        ? commitment
        : undefined
    const payloadExecutorAddress =
      typeof parsed.executor_address === "string" && parsed.executor_address.trim().length > 0
        ? parsed.executor_address.trim()
        : undefined
    const noirInputs =
      parsed.noir_inputs && typeof parsed.noir_inputs === "object" && !Array.isArray(parsed.noir_inputs)
        ? (parsed.noir_inputs as Record<string, unknown>)
        : undefined
    const payloadExecutorNormalized = normalizeExecutorAddress(payloadExecutorAddress)
    if (
      CURRENT_HIDE_EXECUTOR_NORMALIZED &&
      payloadExecutorNormalized &&
      payloadExecutorNormalized !== CURRENT_HIDE_EXECUTOR_NORMALIZED
    ) {
      window.localStorage.removeItem(TRADE_PRIVACY_PAYLOAD_KEY)
      return undefined
    }
    const normalizedNoteCommitment = (noteCommitment || "").trim().toLowerCase()
    const normalizedNullifier = (nullifier || "").trim().toLowerCase()
    let hasTrackedPendingNote = false
    let pendingNoteDepositTxHash: string | undefined
    let pendingNoteSpendableAtUnix: number | undefined
    const pendingNotesRaw = window.localStorage.getItem(TRADE_PRIVACY_PENDING_NOTES_KEY)
    if (pendingNotesRaw && (normalizedNoteCommitment || normalizedNullifier)) {
      try {
        const pendingNotes = JSON.parse(pendingNotesRaw) as unknown
        if (Array.isArray(pendingNotes)) {
          hasTrackedPendingNote = pendingNotes.some((entry) => {
            if (!entry || typeof entry !== "object") return false
            const item = entry as Record<string, unknown>
            const entryCommitment =
              typeof item.note_commitment === "string"
                ? item.note_commitment.trim().toLowerCase()
                : ""
            const entryNullifier =
              typeof item.nullifier === "string" ? item.nullifier.trim().toLowerCase() : ""
            const matched =
              (!!normalizedNoteCommitment && entryCommitment === normalizedNoteCommitment) ||
              (!!normalizedNullifier && entryNullifier === normalizedNullifier)
            if (matched) {
              if (!pendingNoteDepositTxHash) {
                const rawTx = item.note_deposit_tx_hash
                if (typeof rawTx === "string" && rawTx.trim()) {
                  pendingNoteDepositTxHash = rawTx.trim()
                }
              }
              if (!pendingNoteSpendableAtUnix) {
                const rawSpendable = item.spendable_at_unix
                if (typeof rawSpendable === "number" && Number.isFinite(rawSpendable)) {
                  pendingNoteSpendableAtUnix = Math.floor(rawSpendable)
                }
              }
            }
            return matched
          })
        }
      } catch {
        hasTrackedPendingNote = false
      }
    }
    return {
      verifier: (parsed.verifier || "garaga").trim() || "garaga",
      note_version:
        inferredNoteVersion ||
        (inferredV4 ? (HIDE_BALANCE_NOTE_VERSION || "v4") : undefined),
      executor_address: payloadExecutorAddress,
      root:
        typeof parsed.root === "string" && parsed.root.trim().length > 0
          ? parsed.root.trim()
          : inferHideRootFromPublicInputs(publicInputs),
      nullifier,
      commitment,
      recipient:
        typeof parsed.recipient === "string" && parsed.recipient.trim().length > 0
          ? parsed.recipient.trim()
          : undefined,
      note_commitment: noteCommitment,
      note_deposit_tx_hash:
        typeof (parsed as { note_deposit_tx_hash?: unknown }).note_deposit_tx_hash === "string"
          ? String((parsed as { note_deposit_tx_hash?: string }).note_deposit_tx_hash || "").trim() ||
            pendingNoteDepositTxHash ||
            undefined
          : pendingNoteDepositTxHash,
      noir_inputs: noirInputs,
      denom_id:
        typeof parsed.denom_id === "string" && parsed.denom_id.trim().length > 0
          ? parsed.denom_id.trim()
          : undefined,
      spendable_at_unix:
        typeof parsed.spendable_at_unix === "number" &&
        Number.isFinite(parsed.spendable_at_unix) &&
        parsed.spendable_at_unix > 0 &&
        hasTrackedPendingNote
          ? Math.floor(parsed.spendable_at_unix)
          : pendingNoteSpendableAtUnix,
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
export const persistTradePrivacyPayload = (payload: PrivacyVerificationPayload) => {
  if (typeof window === "undefined") return
  const normalizedPayload: PrivacyVerificationPayload = { ...payload }
  if (isHidePayload(normalizedPayload) && typeof normalizedPayload.spendable_at_unix !== "number") {
    const existing = loadTradePrivacyPayload()
    const currentNoteCommitment = (
      normalizedPayload.note_commitment ||
      normalizedPayload.commitment ||
      ""
    )
      .trim()
      .toLowerCase()
    const currentNullifier = (normalizedPayload.nullifier || "").trim().toLowerCase()
    const existingNoteCommitment = (
      existing?.note_commitment ||
      existing?.commitment ||
      ""
    )
      .trim()
      .toLowerCase()
    const existingNullifier = (existing?.nullifier || "").trim().toLowerCase()
    const sameNote =
      !!currentNoteCommitment &&
      currentNoteCommitment === existingNoteCommitment &&
      !!currentNullifier &&
      currentNullifier === existingNullifier
    const sameTrackedNote = loadPendingHideNotes().some((note) => {
      const noteCommitment = (note.note_commitment || "").trim().toLowerCase()
      const noteNullifier = (note.nullifier || "").trim().toLowerCase()
      return (
        (!!currentNoteCommitment && noteCommitment === currentNoteCommitment) ||
        (!!currentNullifier && noteNullifier === currentNullifier)
      )
    })
    if (
      sameNote &&
      sameTrackedNote &&
      typeof existing?.spendable_at_unix === "number" &&
      Number.isFinite(existing.spendable_at_unix) &&
      existing.spendable_at_unix > 0
    ) {
      normalizedPayload.spendable_at_unix = Math.floor(existing.spendable_at_unix)
    } else if ("spendable_at_unix" in normalizedPayload) {
      delete normalizedPayload.spendable_at_unix
    }
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
export const clearTradePrivacyPayload = () => {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(TRADE_PRIVACY_PAYLOAD_KEY)
  window.dispatchEvent(new Event("trade-privacy-payload-updated"))
}

export const loadPendingHideNotes = (): PendingHideNoteRecord[] => {
  if (typeof window === "undefined") return []
  const raw = window.localStorage.getItem(TRADE_PRIVACY_PENDING_NOTES_KEY)
  if (!raw) return []
  try {
    const parsedRaw: unknown = JSON.parse(raw)
    if (!Array.isArray(parsedRaw)) return []
    const mapped: Array<PendingHideNoteRecord | null> = parsedRaw.map((entry) => {
      if (!entry || typeof entry !== "object") return null
      const item = entry as Record<string, unknown>
      const noteCommitment =
        typeof item.note_commitment === "string" ? item.note_commitment.trim() : ""
      if (!noteCommitment) return null
      const depositedAt =
        typeof item.deposited_at_unix === "number" && Number.isFinite(item.deposited_at_unix)
          ? Math.floor(item.deposited_at_unix)
          : Math.floor(Date.now() / 1000)
      const spendableAt =
        typeof item.spendable_at_unix === "number" && Number.isFinite(item.spendable_at_unix)
          ? Math.floor(item.spendable_at_unix)
          : depositedAt + Math.floor(HIDE_BALANCE_MIN_NOTE_AGE_MS / 1000)
      const proof = normalizeHexArray((item as { proof?: unknown }).proof)
      const publicInputs = normalizeHexArray((item as { public_inputs?: unknown }).public_inputs)
      const noirInputs =
        (item as { noir_inputs?: unknown }).noir_inputs &&
        typeof (item as { noir_inputs?: unknown }).noir_inputs === "object" &&
        !Array.isArray((item as { noir_inputs?: unknown }).noir_inputs)
          ? ((item as { noir_inputs?: unknown }).noir_inputs as Record<string, unknown>)
          : undefined
      const parsedNoteVersion =
        typeof item.note_version === "string" ? item.note_version.trim().toLowerCase() : ""
      if (parsedNoteVersion && parsedNoteVersion !== "v4") return null
      const normalizedNoteVersion = HIDE_BALANCE_NOTE_VERSION || "v4"
      return {
        note_version: normalizedNoteVersion as "v4",
        note_commitment: noteCommitment,
        nullifier: typeof item.nullifier === "string" ? item.nullifier.trim() || undefined : undefined,
        executor_address:
          typeof item.executor_address === "string"
            ? item.executor_address.trim() || undefined
            : undefined,
        verifier:
          typeof (item as { verifier?: unknown }).verifier === "string"
            ? String((item as { verifier?: string }).verifier || "").trim() || undefined
            : undefined,
        root:
          typeof (item as { root?: unknown }).root === "string"
            ? String((item as { root?: string }).root || "").trim() || undefined
            : undefined,
        proof: proof.length > 0 ? proof : undefined,
        public_inputs: publicInputs.length > 0 ? publicInputs : undefined,
        noir_inputs: noirInputs,
        note_deposit_tx_hash:
          typeof (item as { note_deposit_tx_hash?: unknown }).note_deposit_tx_hash === "string"
            ? String((item as { note_deposit_tx_hash?: string }).note_deposit_tx_hash || "").trim() ||
              undefined
            : undefined,
        denom_id: typeof item.denom_id === "string" ? item.denom_id.trim() || undefined : undefined,
        token_symbol:
          typeof item.token_symbol === "string" ? item.token_symbol.trim() || undefined : undefined,
        target_token_symbol:
          typeof item.target_token_symbol === "string"
            ? item.target_token_symbol.trim() || undefined
            : typeof item.to_token_symbol === "string"
            ? item.to_token_symbol.trim() || undefined
            : undefined,
        amount: typeof item.amount === "string" ? item.amount.trim() || undefined : undefined,
        deposited_at_unix: depositedAt,
        spendable_at_unix: spendableAt,
      }
    })
    const notes = mapped.filter((item): item is PendingHideNoteRecord => item !== null)
    const filtered = notes.filter((item) => {
      const noteExecutorNormalized = normalizeExecutorAddress(item.executor_address)
      return (
        !CURRENT_HIDE_EXECUTOR_NORMALIZED ||
        !noteExecutorNormalized ||
        noteExecutorNormalized === CURRENT_HIDE_EXECUTOR_NORMALIZED
      )
    })
    if (filtered.length !== notes.length) {
      window.localStorage.setItem(TRADE_PRIVACY_PENDING_NOTES_KEY, JSON.stringify(filtered))
    }
    return filtered.sort((a, b) => b.deposited_at_unix - a.deposited_at_unix)
  } catch {
    return []
  }
}

export const persistPendingHideNotes = (items: PendingHideNoteRecord[]) => {
  if (typeof window === "undefined") return
  window.localStorage.setItem(TRADE_PRIVACY_PENDING_NOTES_KEY, JSON.stringify(items))
  window.dispatchEvent(new Event(TRADE_PRIVACY_PENDING_NOTES_UPDATED_EVENT))
}

export const upsertPendingHideNote = (note: PendingHideNoteRecord) => {
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
    proof:
      normalizeHexArray(note.proof).length > 0
        ? normalizeHexArray(note.proof)
        : normalizeHexArray(existing?.proof).length > 0
        ? normalizeHexArray(existing?.proof)
        : undefined,
    public_inputs:
      normalizeHexArray(note.public_inputs).length > 0
        ? normalizeHexArray(note.public_inputs)
        : normalizeHexArray(existing?.public_inputs).length > 0
        ? normalizeHexArray(existing?.public_inputs)
        : undefined,
    root:
      (note.root || "").trim() ||
      (existing?.root || "").trim() ||
      undefined,
    verifier:
      (note.verifier || "").trim() ||
      (existing?.verifier || "").trim() ||
      undefined,
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

export const removePendingHideNote = (noteCommitment?: string, nullifier?: string) => {
  if (typeof window === "undefined") return
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

export const FINALIZED_GARDEN_ORDER_STATUSES = new Set([
  "completed",
  "refunded",
  "failed",
  "cancelled",
  "expired",
])

const normalizePendingBtcDepositState = (
  parsed: Partial<PendingBtcDepositState> | null | undefined
): PendingBtcDepositState | null => {
  if (!parsed) return null
  const bridgeId = typeof parsed.bridgeId === "string" ? parsed.bridgeId.trim() : ""
  const depositAddress = typeof parsed.depositAddress === "string" ? parsed.depositAddress.trim() : ""
  const amountSats = Number.parseInt(String(parsed.amountSats || "0"), 10)
  const destinationChain =
    typeof parsed.destinationChain === "string" ? parsed.destinationChain.trim() : ""
  if (!bridgeId || !depositAddress || !destinationChain || !Number.isFinite(amountSats) || amountSats < 0) {
    return null
  }
  return {
    bridgeId,
    depositAddress,
    amountSats,
    destinationChain,
    requestSource:
      parsed.requestSource === "ai" || parsed.requestSource === "manual"
        ? parsed.requestSource
        : "manual",
    burnTxHash: typeof parsed.burnTxHash === "string" ? parsed.burnTxHash : null,
    status: typeof parsed.status === "string" ? parsed.status : undefined,
    txHash: typeof parsed.txHash === "string" ? parsed.txHash : null,
    sourceInitiateTxHash:
      typeof parsed.sourceInitiateTxHash === "string" ? parsed.sourceInitiateTxHash : null,
    destinationInitiateTxHash:
      typeof parsed.destinationInitiateTxHash === "string" ? parsed.destinationInitiateTxHash : null,
    destinationRedeemTxHash:
      typeof parsed.destinationRedeemTxHash === "string" ? parsed.destinationRedeemTxHash : null,
    refundTxHash: typeof parsed.refundTxHash === "string" ? parsed.refundTxHash : null,
    instantRefundTx: typeof parsed.instantRefundTx === "string" ? parsed.instantRefundTx : null,
    instantRefundHash: typeof parsed.instantRefundHash === "string" ? parsed.instantRefundHash : null,
    lastUpdatedAt:
      typeof parsed.lastUpdatedAt === "number" && Number.isFinite(parsed.lastUpdatedAt)
        ? parsed.lastUpdatedAt
        : undefined,
  }
}

export const loadPendingBtcDeposit = (): PendingBtcDepositState | null => {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(TRADE_PENDING_BTC_DEPOSIT_KEY)
  if (!raw) return null
  try {
    const parsed = normalizePendingBtcDepositState(JSON.parse(raw) as Partial<PendingBtcDepositState>)
    if (!parsed) return null
    const normalizedStatus =
      typeof parsed.status === "string" ? parsed.status.trim().toLowerCase() : ""
    if (FINALIZED_GARDEN_ORDER_STATUSES.has(normalizedStatus)) {
      // Completed/failed historical orders should not block current bridge UI on reload.
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export const persistPendingBtcDeposit = (payload: PendingBtcDepositState | null) => {
  if (typeof window === "undefined") return
  if (!payload) {
    window.localStorage.removeItem(TRADE_PENDING_BTC_DEPOSIT_KEY)
    return
  }
  window.localStorage.setItem(TRADE_PENDING_BTC_DEPOSIT_KEY, JSON.stringify(payload))
}

export const loadPendingBtcDeposits = (): PendingBtcDepositState[] => {
  if (typeof window === "undefined") return []
  const raw = window.localStorage.getItem(TRADE_PENDING_BTC_DEPOSITS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const items: PendingBtcDepositState[] = []
    for (const record of parsed) {
      const normalized = normalizePendingBtcDepositState(record as Partial<PendingBtcDepositState>)
      if (!normalized) continue
      const id = normalized.bridgeId.trim().toLowerCase()
      if (!id || seen.has(id)) continue
      seen.add(id)
      items.push(normalized)
    }
    return items.sort((a, b) => {
      const aTs = typeof a.lastUpdatedAt === "number" ? a.lastUpdatedAt : 0
      const bTs = typeof b.lastUpdatedAt === "number" ? b.lastUpdatedAt : 0
      return bTs - aTs
    })
  } catch {
    return []
  }
}

export const persistPendingBtcDeposits = (items: PendingBtcDepositState[]) => {
  if (typeof window === "undefined") return
  if (!Array.isArray(items) || items.length === 0) {
    window.localStorage.removeItem(TRADE_PENDING_BTC_DEPOSITS_KEY)
    return
  }
  const normalized = items
    .map((item) => normalizePendingBtcDepositState(item))
    .filter((item): item is PendingBtcDepositState => !!item)
    .slice(0, 20)
  if (normalized.length === 0) {
    window.localStorage.removeItem(TRADE_PENDING_BTC_DEPOSITS_KEY)
    return
  }
  window.localStorage.setItem(TRADE_PENDING_BTC_DEPOSITS_KEY, JSON.stringify(normalized))
}

export const upsertPendingBtcDepositList = (
  items: PendingBtcDepositState[],
  next: PendingBtcDepositState
): PendingBtcDepositState[] => {
  const normalizedNext = normalizePendingBtcDepositState(next)
  if (!normalizedNext) return items
  const id = normalizedNext.bridgeId.trim().toLowerCase()
  const withoutCurrent = items.filter((item) => item.bridgeId.trim().toLowerCase() !== id)
  const merged = [{ ...normalizedNext, lastUpdatedAt: Date.now() }, ...withoutCurrent]
  return merged.slice(0, 20)
}

export const pickActivePendingBtcDeposit = (
  items: PendingBtcDepositState[]
): PendingBtcDepositState | null => {
  for (const item of items) {
    const status = (item.status || "").trim().toLowerCase()
    if (!FINALIZED_GARDEN_ORDER_STATUSES.has(status)) {
      return item
    }
  }
  return null
}

export const loadBridgeRewardsSnapshot = (): BridgeRewardsSnapshot | null => {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(TRADE_BRIDGE_REWARDS_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<BridgeRewardsSnapshot>
    const estimatedPoints = Number(parsed.estimatedPoints || 0)
    const discountPercent = Number(parsed.discountPercent || 0)
    const aiBonusPercent = Number(parsed.aiBonusPercent || 0)
    const pointsPending = Boolean(parsed.pointsPending)
    const updatedAt =
      typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
        ? parsed.updatedAt
        : Date.now()
    return {
      estimatedPoints: Number.isFinite(estimatedPoints) ? estimatedPoints : 0,
      discountPercent: Number.isFinite(discountPercent) ? discountPercent : 0,
      aiBonusPercent: Number.isFinite(aiBonusPercent) ? aiBonusPercent : 0,
      pointsPending,
      updatedAt,
    }
  } catch {
    return null
  }
}

export const persistBridgeRewardsSnapshot = (payload: BridgeRewardsSnapshot | null) => {
  if (typeof window === "undefined") return
  if (!payload) {
    window.localStorage.removeItem(TRADE_BRIDGE_REWARDS_KEY)
    return
  }
  window.localStorage.setItem(TRADE_BRIDGE_REWARDS_KEY, JSON.stringify(payload))
}

/**
 * Handles `randomHexFelt` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export const randomHexFelt = () => {
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

export const createDevTradePrivacyPayload = (): PrivacyVerificationPayload => ({
  verifier: "garaga",
  note_version: HIDE_BALANCE_NOTE_VERSION,
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
export const buildHideBalancePrivacyCall = (
  payload: PrivacyVerificationPayload,
  actionType: string = "SWAP"
) => {
  const router = STARKNET_ZK_PRIVACY_ROUTER_ADDRESS.trim()
  if (!router) {
    throw new Error(
      "NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS is not configured. On-chain Hide Balance swap requires privacy router address."
    )
  }
  const root = payload.root?.trim() || ""
  const nullifier = payload.nullifier?.trim() || ""
  const commitment = (payload.commitment || payload.note_commitment || "").trim()
  const proof = normalizeHexArray(payload.proof).map((value) => toHexFelt(value))
  const publicInputs = normalizeHexArray(payload.public_inputs).map((value) => toHexFelt(value))
  if (!root || !nullifier || !proof.length || !publicInputs.length) {
    throw new Error(
      "On-chain Hide Balance (v4) requires root, nullifier, proof, and public_inputs."
    )
  }
  const nullifiers = [toHexFelt(nullifier)]
  const commitments = commitment ? [toHexFelt(commitment)] : []
  return {
    contractAddress: router,
    entrypoint: "submit_action",
    calldata: [
      toHexFelt(actionType),
      toHexFelt(root),
      "0x0",
      String(nullifiers.length),
      ...nullifiers,
      String(commitments.length),
      ...commitments,
      String(publicInputs.length),
      ...publicInputs,
      String(proof.length),
      ...proof,
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
export const isSameFeltAddress = (left: string, right: string) => {
  const a = normalizeFeltAddress(left)
  const b = normalizeFeltAddress(right)
  if (!a || !b) return false
  return a === b
}

export const resolveTokenAddress = (symbol: string): string => {
  const key = symbol.toUpperCase()
  return STARKNET_TOKEN_ADDRESS[key] || ""
}

export const resolveTokenDecimals = (symbol: string): number => {
  const key = symbol.toUpperCase()
  return TOKEN_DECIMALS[key] ?? 18
}

export const normalizeHexNumberish = (value: string): string => {
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

export const limitBridgeApprovalToExactAmount = (
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

export const isStarknetEntrypointMissingError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "")
  return /(requested entrypoint does not exist|entrypoint does not exist|entry point .* not found|entrypoint .* not found|entry_point_not_found)/i.test(
    message
  )
}

export const normalizeGardenStarknetEntrypoint = (rawSelectorOrEntrypoint: string): string => {
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
export const formatTokenAmount = (value: number, maxFractionDigits = 8) => {
  if (!Number.isFinite(value)) return "—"
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  })
}

export const shortenAddress = (addr?: string | null) => {
  const value = (addr || "").trim()
  if (!value) return "-"
  if (value.length <= 14) return value
  return `${value.slice(0, 8)}...${value.slice(-6)}`
}

export const formatRemainingDuration = (remainingMs: number) => {
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
export const estimatedBridgeTimeByProvider = (provider?: string) => {
  const key = (provider || "").trim().toLowerCase()
  if (!key) return "~15-20 min"
  if (key.includes("garden")) return "~25-35 min"
  if (key.includes("starkgate")) return "~10-15 min"
  if (key.includes("atomiq")) return "~20-30 min"
  if (key.includes("layerswap")) return "~15-20 min"
  return "~15-20 min"
}

export const normalizeEstimatedTimeLabel = ({
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
export const formatBtcFromSats = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0.00000000 BTC"
  return `${(value / 100_000_000).toFixed(8)} BTC`
}

export const parseGardenOrderProgress = (orderPayload: unknown): GardenOrderProgress => {
  const statusRaw = pickNestedString(orderPayload, ["status"]).toLowerCase()
  const sourceLegStatus = pickNestedString(orderPayload, ["source_swap", "status"]).toLowerCase()
  const destinationLegStatus = pickNestedString(orderPayload, ["destination_swap", "status"]).toLowerCase()
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
    statusRaw === "success" ||
    destinationLegStatus === "completed" ||
    destinationLegStatus === "redeemed" ||
    destinationLegStatus === "success"
  const isRefunded =
    !!sourceRefundTxHash ||
    !!destinationRefundTxHash ||
    statusRaw === "refunded" ||
    statusRaw === "refund_completed" ||
    sourceLegStatus === "refunded" ||
    destinationLegStatus === "refunded"
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

export const broadcastBtcRawTransaction = async (rawTxHex: string): Promise<string> => {
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

export const unwrapGardenOrderPayload = (payload: unknown): unknown => {
  const first = (payload as { result?: unknown } | null)?.result ?? payload
  const second = (first as { result?: unknown } | null)?.result ?? first
  return second
}

/**
 * Parses or transforms values for `formatMultiplier`.
 *
 * @param value - Input used by `formatMultiplier` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export const formatMultiplier = (value: number) => {
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
export const stableKeyNumber = (value: number, fractionDigits = 8) => {
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
export const sanitizeDecimalInput = (raw: string, maxDecimals = 18) => {
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
export const trimDecimalZeros = (raw: string) =>
  raw
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "")
    .replace(/\.$/, "")

export const scaledBigIntToDecimalString = (value: bigint, decimals: number): string => {
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

/**
 * Parses or transforms values for `normalizeTokenAmountDisplay`.
 *
 * @param raw - Input used by `normalizeTokenAmountDisplay` to compute state, payload, or request behavior.
 * @param symbol - Input used by `normalizeTokenAmountDisplay` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export const normalizeTokenAmountDisplay = (raw: string | number, symbol: string) => {
  const parsed =
    typeof raw === "number" ? raw : Number.parseFloat(String(raw).replace(/,/g, ""))
  if (!Number.isFinite(parsed) || parsed < 0) return ""
  const maxDecimals = Math.min(resolveTokenDecimals(symbol), 8)
  return trimDecimalZeros(parsed.toFixed(Math.max(0, maxDecimals)))
}

export const parseLiquidityMaxFromQuoteError = (message: string, expectedSymbol: string): number | null => {
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

export const pickNestedString = (value: unknown, path: Array<string>): string => {
  let current: any = value
  for (const segment of path) {
    if (!current || typeof current !== "object") return ""
    current = current[segment]
  }
  return typeof current === "string" ? current.trim() : ""
}

export const buildGardenOrderExplorerUrl = (orderId: string): string => {
  const normalizedOrderId = orderId.trim()
  if (!normalizedOrderId) return ""
  const base = GARDEN_ORDER_EXPLORER_BASE_URL.trim().replace(/\/$/, "")
  if (!base) return ""
  return `${base}/${encodeURIComponent(normalizedOrderId)}`
}

export const buildGardenOrderExplorerLinks = (
  orderId: string
): Array<{ label: string; url: string }> | undefined => {
  const url = buildGardenOrderExplorerUrl(orderId)
  if (!url) return undefined
  return [{ label: "Open Garden Explorer", url }]
}

export const computeTradeDeadlineSeconds = () => Math.floor(Date.now() / 1000) + 60 * 20

export const computeMinimumAmountOut = (toAmount: string, slippageValue: number) => {
  const parsedAmount = Number.parseFloat(toAmount || "0")
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return "0"
  const slippageFactor =
    Number.isFinite(slippageValue) && slippageValue >= 0 ? Math.max(0, 1 - slippageValue / 100) : 1
  const decimals = Math.min(8, Math.max(6, (toAmount.split(".")[1] || "").length))
  return (parsedAmount * slippageFactor).toFixed(decimals)
}

export const resolveTradeSlippage = (activeSlippage: string, quote: QuoteState | null) => {
  const parsed = Number(activeSlippage || "")
  if (Number.isFinite(parsed) && parsed >= 0) {
    return { value: parsed, label: activeSlippage.trim() || parsed.toFixed(2) }
  }
  if (quote?.priceImpact) {
    const impactValue = Number(String(quote.priceImpact).replace("%", ""))
    if (Number.isFinite(impactValue) && impactValue > 0) {
      return { value: impactValue, label: impactValue.toFixed(2) }
    }
  }
  return { value: 0.5, label: "0.5" }
}
