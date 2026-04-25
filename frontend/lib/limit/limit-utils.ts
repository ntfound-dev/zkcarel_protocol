import type { PrivacyVerificationPayload } from "@/lib/api"
import { getTokenMetaBySymbols, LIMIT_ORDER_SYMBOLS } from "@/lib/token-config"
import { toHexFelt } from "@/lib/onchain-trade"
import { HIDE_BALANCE_NOTE_VERSION } from "@/lib/trade/trading-utils"

export const tokenCatalog = getTokenMetaBySymbols(LIMIT_ORDER_SYMBOLS).map((token) => ({
  symbol: token.symbol,
  name: token.name,
  icon: token.icon,
  price: 0,
  change: 0,
}))

export type TokenItem = (typeof tokenCatalog)[number]

export const expiryOptions = [
  { label: "1 day", value: "1d" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
]

export const pricePresets = [
  { label: "-5%", value: -5 },
  { label: "-10%", value: -10 },
  { label: "-25%", value: -25 },
  { label: "-50%", value: -50 },
]

export const sellPresets = [
  { label: "+5%", value: 5 },
  { label: "+10%", value: 10 },
  { label: "+25%", value: 25 },
  { label: "+50%", value: 50 },
]

export type UiOrder = {
  id: string
  type: "buy" | "sell"
  token: string
  fromToken: string
  amount: string
  price: string
  expiry: string
  status: "active" | "filled" | "cancelled"
  createdAt: string
  requestSource: "manual" | "ai"
}

export type ChartCandle = {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
}

export const stableSymbols = new Set(["USDT", "USDC"])

export type UsdtTierOption = { minUsdt: number; bonusPercent: number }

export const USDT_POINTS_TIER_OPTIONS: UsdtTierOption[] = [
  { minUsdt: 5, bonusPercent: 5 },
  { minUsdt: 10, bonusPercent: 10 },
  { minUsdt: 50, bonusPercent: 20 },
  { minUsdt: 100, bonusPercent: 30 },
  { minUsdt: 250, bonusPercent: 50 },
]

export const usdtTierBonusPercent = (usdtEquivalentVolume: number): number => {
  if (!Number.isFinite(usdtEquivalentVolume) || usdtEquivalentVolume <= 0) return 0
  if (usdtEquivalentVolume >= 250) return 50
  if (usdtEquivalentVolume >= 100) return 30
  if (usdtEquivalentVolume >= 50) return 20
  if (usdtEquivalentVolume >= 10) return 10
  if (usdtEquivalentVolume >= 5) return 5
  return 0
}

export const STARKNET_LIMIT_ORDER_BOOK_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_LIMIT_ORDER_BOOK_ADDRESS ||
  process.env.NEXT_PUBLIC_LIMIT_ORDER_BOOK_ADDRESS ||
  ""

export const STARKNET_TOKEN_ADDRESS_MAP: Record<string, string> = {
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

export const TOKEN_DECIMALS: Record<string, number> = {
  CAREL: 18,
  STRK: 18,
  ETH: 18,
  BTC: 8,
  WBTC: 8,
  USDT: 6,
  USDC: 6,
}

export const DEV_AUTO_GARAGA_PAYLOAD_ENABLED =
  process.env.NODE_ENV !== "production" &&
  (process.env.NEXT_PUBLIC_ENABLE_DEV_GARAGA_AUTOFILL || "false").toLowerCase() === "true"

type HideBalanceNoteVersion = "v4"

export type PendingHideNoteRecord = {
  note_version: HideBalanceNoteVersion
  note_commitment: string
  note_deposit_tx_hash?: string
  nullifier?: string
  executor_address?: string
  verifier?: string
  root?: string
  proof?: string[]
  public_inputs?: string[]
  noir_inputs?: Record<string, unknown>
  denom_id?: string
  token_symbol?: string
  target_token_symbol?: string
  amount?: string
  deposited_at_unix: number
  spendable_at_unix?: number
}

const LIMIT_PRIVACY_PAYLOAD_KEY = "limit_privacy_garaga_payload_v4"
export const LIMIT_PRIVACY_PAYLOAD_UPDATED_EVENT = "limit-privacy-payload-updated"
const LIMIT_PRIVACY_PENDING_NOTES_KEY = "limit_privacy_pending_notes_v4"
export const LIMIT_PRIVACY_PENDING_NOTES_UPDATED_EVENT = "limit-privacy-pending-notes-updated"

export const PRIVATE_ACTION_EXECUTOR_ADDRESS =
  (process.env.NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim()
export const HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED =
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED || "false").toLowerCase() ===
    "true" && PRIVATE_ACTION_EXECUTOR_ADDRESS.length > 0
export const HIDE_BALANCE_RELAYER_POOL_ENABLED =
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_ENABLED || "false").toLowerCase() ===
    "true" &&
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_LIMIT_ENABLED || "false").toLowerCase() ===
    "true"

const HIDE_BALANCE_MIN_NOTE_AGE_SECS_RAW =
  process.env.NEXT_PUBLIC_HIDE_BALANCE_MIN_NOTE_AGE_SECS ||
  process.env.NEXT_PUBLIC_AI_HIDE_MIN_NOTE_AGE_SECS ||
  "60"
const HIDE_BALANCE_MIN_NOTE_AGE_SECS = Number.parseInt(HIDE_BALANCE_MIN_NOTE_AGE_SECS_RAW, 10)
export const HIDE_BALANCE_MIN_NOTE_AGE_MS =
  (Number.isFinite(HIDE_BALANCE_MIN_NOTE_AGE_SECS) && HIDE_BALANCE_MIN_NOTE_AGE_SECS > 0
    ? HIDE_BALANCE_MIN_NOTE_AGE_SECS
    : 60) * 1000

const STARKNET_ZK_PRIVACY_ROUTER_ADDRESS =
  process.env.NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS ||
  process.env.NEXT_PUBLIC_PRIVACY_ROUTER_ADDRESS ||
  ""

const normalizeFeltAddress = (value?: string) => {
  const trimmed = (value || "").trim()
  if (!trimmed) return ""
  if (!trimmed.startsWith("0x")) return trimmed.toLowerCase()
  try {
    return `0x${BigInt(trimmed).toString(16)}`
  } catch {
    return trimmed.toLowerCase()
  }
}

const normalizeExecutorAddress = (value?: string) => {
  const trimmed = (value || "").trim()
  if (!trimmed) return ""
  return normalizeFeltAddress(trimmed)
}

const CURRENT_HIDE_EXECUTOR_NORMALIZED = normalizeExecutorAddress(PRIVATE_ACTION_EXECUTOR_ADDRESS)

export const normalizeHexArray = (values?: string[] | null): string[] => {
  if (!Array.isArray(values)) return []
  return values
    .map((value) => (typeof value === "string" ? value.trim() : String(value ?? "").trim()))
    .filter((value) => value.length > 0)
}

export const loadTradePrivacyPayload = (): PrivacyVerificationPayload | undefined => {
  if (typeof window === "undefined") return undefined
  try {
    const raw = window.localStorage.getItem(LIMIT_PRIVACY_PAYLOAD_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as PrivacyVerificationPayload
    const inferredNoteVersion =
      typeof parsed.note_version === "string" ? parsed.note_version.trim().toLowerCase() : ""
    if (inferredNoteVersion && inferredNoteVersion !== "v4") {
      window.localStorage.removeItem(LIMIT_PRIVACY_PAYLOAD_KEY)
      return undefined
    }
    const nullifier = parsed.nullifier?.trim()
    const commitment = parsed.commitment?.trim()
    const proof = normalizeHexArray(parsed.proof)
    const publicInputs = normalizeHexArray(parsed.public_inputs)
    const noirInputs =
      parsed.noir_inputs && typeof parsed.noir_inputs === "object" && !Array.isArray(parsed.noir_inputs)
        ? (parsed.noir_inputs as Record<string, unknown>)
        : undefined
    if (!nullifier || !commitment || proof.length === 0 || publicInputs.length === 0) return undefined
    if (
      proof.length === 1 &&
      publicInputs.length === 1 &&
      proof[0]?.toLowerCase() === "0x1" &&
      publicInputs[0]?.toLowerCase() === "0x1"
    ) {
      window.localStorage.removeItem(LIMIT_PRIVACY_PAYLOAD_KEY)
      return undefined
    }
    const payloadExecutorAddress = parsed.executor_address?.trim() || undefined
    const payloadExecutorNormalized = normalizeExecutorAddress(payloadExecutorAddress)
    if (
      CURRENT_HIDE_EXECUTOR_NORMALIZED &&
      payloadExecutorNormalized &&
      payloadExecutorNormalized !== CURRENT_HIDE_EXECUTOR_NORMALIZED
    ) {
      window.localStorage.removeItem(LIMIT_PRIVACY_PAYLOAD_KEY)
      return undefined
    }
    return {
      verifier: (parsed.verifier || "garaga").trim() || "garaga",
      note_version: parsed.note_version?.trim() || HIDE_BALANCE_NOTE_VERSION || "v4",
      executor_address: payloadExecutorAddress,
      root: parsed.root?.trim() || undefined,
      nullifier,
      commitment,
      recipient: parsed.recipient?.trim() || undefined,
      note_commitment: parsed.note_commitment?.trim() || undefined,
      noir_inputs: noirInputs,
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
export const persistTradePrivacyPayload = (payload: PrivacyVerificationPayload) => {
  if (typeof window === "undefined") return
  window.localStorage.setItem(LIMIT_PRIVACY_PAYLOAD_KEY, JSON.stringify(payload))
  window.dispatchEvent(new Event(LIMIT_PRIVACY_PAYLOAD_UPDATED_EVENT))
}

export const clearTradePrivacyPayload = () => {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(LIMIT_PRIVACY_PAYLOAD_KEY)
  window.dispatchEvent(new Event(LIMIT_PRIVACY_PAYLOAD_UPDATED_EVENT))
}

export const loadPendingHideNotes = (): PendingHideNoteRecord[] => {
  if (typeof window === "undefined") return []
  const raw = window.localStorage.getItem(LIMIT_PRIVACY_PENDING_NOTES_KEY)
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
          note_deposit_tx_hash:
            typeof (item as { note_deposit_tx_hash?: unknown }).note_deposit_tx_hash === "string"
              ? String((item as { note_deposit_tx_hash?: string }).note_deposit_tx_hash || "").trim() ||
                undefined
              : undefined,
          nullifier:
            typeof item.nullifier === "string" ? item.nullifier.trim() || undefined : undefined,
          executor_address:
            typeof item.executor_address === "string"
              ? item.executor_address.trim() || undefined
              : undefined,
          verifier: typeof item.verifier === "string" ? item.verifier.trim() || undefined : undefined,
          root: typeof item.root === "string" ? item.root.trim() || undefined : undefined,
          proof: proof.length > 0 ? proof : undefined,
          public_inputs: publicInputs.length > 0 ? publicInputs : undefined,
          noir_inputs: noirInputs,
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
    const filtered = mapped.filter((item) => {
      const noteExecutorNormalized = normalizeExecutorAddress(item.executor_address)
      return (
        !CURRENT_HIDE_EXECUTOR_NORMALIZED ||
        !noteExecutorNormalized ||
        noteExecutorNormalized === CURRENT_HIDE_EXECUTOR_NORMALIZED
      )
    })
    if (filtered.length !== mapped.length) {
      window.localStorage.setItem(LIMIT_PRIVACY_PENDING_NOTES_KEY, JSON.stringify(filtered))
    }
    return filtered.sort((a, b) => b.deposited_at_unix - a.deposited_at_unix)
  } catch {
    return []
  }
}

export const persistPendingHideNotes = (items: PendingHideNoteRecord[]) => {
  if (typeof window === "undefined") return
  window.localStorage.setItem(LIMIT_PRIVACY_PENDING_NOTES_KEY, JSON.stringify(items))
  window.dispatchEvent(new Event(LIMIT_PRIVACY_PENDING_NOTES_UPDATED_EVENT))
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
    noir_inputs:
      note.noir_inputs && typeof note.noir_inputs === "object" && !Array.isArray(note.noir_inputs)
        ? note.noir_inputs
        : existing?.noir_inputs &&
          typeof existing.noir_inputs === "object" &&
          !Array.isArray(existing.noir_inputs)
        ? existing.noir_inputs
        : undefined,
    root: (note.root || "").trim() || (existing?.root || "").trim() || undefined,
    verifier: (note.verifier || "").trim() || (existing?.verifier || "").trim() || undefined,
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

export const formatRemainingDuration = (remainingMs: number) => {
  const safeMs = Math.max(0, remainingMs)
  const totalSeconds = Math.ceil(safeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

export const inferUsdtTierFromDenomId = (denomId: string): number => {
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
export const buildHideBalancePrivacyCall = (
  payload: PrivacyVerificationPayload,
  actionType: string = "LIMIT"
) => {
  const router = STARKNET_ZK_PRIVACY_ROUTER_ADDRESS.trim()
  if (!router) {
    throw new Error(
      "NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS is not configured. Hide Balance requires privacy router address."
    )
  }
  const root = payload.root?.trim() || ""
  const nullifier = payload.nullifier?.trim() || ""
  const commitment = (payload.commitment || payload.note_commitment || "").trim()
  const proof = normalizeHexArray(payload.proof).map((value) => toHexFelt(value))
  const publicInputs = normalizeHexArray(payload.public_inputs).map((value) => toHexFelt(value))
  if (!root || !nullifier || !proof.length || !publicInputs.length) {
    throw new Error(
      "Hide Balance (v4) requires root, nullifier, proof, and public_inputs."
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
 * Parses or transforms values for `formatDateTime`.
 *
 * @param value - Input used by `formatDateTime` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export const formatDateTime = (value: string) => {
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
export const expiryToSeconds = (expiry: string) => {
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
export const generateClientOrderId = () => {
  // Starknet felt must be < 251 bits, so use 31 random bytes.
  const bytes = new Uint8Array(31)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
  return `0x${hex}`
}
