"use client"

import { createPrivacyNote, fetchPrivacyFixedAmount, resolvePrivacyNoirInputs } from "@/lib/api"
import { PRIVATE_ACTION_EXECUTOR_ADDRESS, resolveTokenAddress } from "@/lib/trade/trading-utils"

type NoirInputsContext = {
  flow?: string
  from_token?: string
  to_token?: string
  amount?: string
  recipient?: string
  from_network?: string
  to_network?: string
  note_version?: string
  root?: string
  action_hash?: string
  note_commitment?: string
  note_deposit_tx_hash?: string
  nullifier?: string
  denom_id?: string
  note_token?: string
  chain_id?: string
  contract_address?: string
}

type ResolveNoirInputsOptions = {
  existing?: Record<string, unknown>
  context: NoirInputsContext
  timeoutMs?: number
}

type NoirInputsProvider = (context: NoirInputsContext) => unknown | Promise<unknown>

const NOIR_INPUTS_URL = (process.env.NEXT_PUBLIC_NOIR_INPUTS_URL || "").trim()
const DEFAULT_NOIR_INPUTS_ENDPOINT = NOIR_INPUTS_URL || "/api/v1/privacy/noir-inputs"
const NOIR_INPUTS_STORAGE_PREFIX = "noir_inputs:"
const DEFAULT_TIMEOUT_MS = 30_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(typeof value === "string" ? value : "Unknown error")

const pickString = (value: Record<string, unknown> | undefined, keys: string[]): string | undefined => {
  if (!value) return undefined
  for (const key of keys) {
    const candidate = value[key]
    if (isNonEmptyString(candidate)) return candidate.trim()
  }
  return undefined
}

const looksLikeHexFelt = (value: string): boolean => {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (!trimmed.startsWith("0x") && !trimmed.startsWith("0X")) return false
  return trimmed.length > 2
}

const normalizeNoirInputs = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  const direct = value.noir_inputs
  if (isRecord(direct)) return direct
  const camel = value.noirInputs
  if (isRecord(camel)) return camel
  const payload = value.payload
  if (isRecord(payload) && isRecord(payload.noir_inputs)) return payload.noir_inputs as Record<string, unknown>
  if (isRecord(payload) && isRecord(payload.noirInputs)) return payload.noirInputs as Record<string, unknown>
  const data = value.data
  if (isRecord(data) && isRecord(data.noir_inputs)) return data.noir_inputs as Record<string, unknown>
  if (isRecord(data) && isRecord(data.noirInputs)) return data.noirInputs as Record<string, unknown>
  const context = value.context
  if (isRecord(context) && isRecord(context.noir_inputs)) return context.noir_inputs as Record<string, unknown>
  if (isRecord(context) && isRecord(context.noirInputs)) return context.noirInputs as Record<string, unknown>
  const markerKeys = [
    "note_secret",
    "note_amount",
    "note_token",
    "merkle_path",
    "merkle_index",
    "nullifier",
    "action_hash",
  ]
  if (markerKeys.some((key) => key in value)) return value
  return undefined
}

const SEED_NOIR_INPUT_KEYS = new Set([
  "note_secret",
  "noteSecret",
  "note_amount",
  "noteAmount",
  "note_token",
  "noteToken",
  "token",
  "note_commitment",
  "noteCommitment",
  "nullifier",
  "note_deposit_tx_hash",
  "noteDepositTxHash",
  "deposit_tx_hash",
  "denom_id",
  "denomId",
])

const sanitizeSeedNoirInputs = (
  value: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!value) return undefined
  const next: Record<string, unknown> = {}
  for (const [key, candidate] of Object.entries(value)) {
    if (!SEED_NOIR_INPUT_KEYS.has(key)) continue
    next[key] = candidate
  }
  return Object.keys(next).length > 0 ? next : undefined
}

const mergeSeedNoirInputs = (
  ...values: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined => {
  const next: Record<string, unknown> = {}
  for (const value of values) {
    const sanitized = sanitizeSeedNoirInputs(value)
    if (!sanitized) continue
    Object.assign(next, sanitized)
  }
  return Object.keys(next).length > 0 ? next : undefined
}

const resolveNoteTokenAddress = (
  context: NoirInputsContext,
  existing?: Record<string, unknown>
): string => {
  const existingToken = pickString(existing, ["note_token", "noteToken", "token"])
  if (existingToken) return existingToken
  const contextToken = (context.note_token || "").trim()
  if (contextToken) return contextToken
  const fromToken = (context.from_token || "").trim()
  if (looksLikeHexFelt(fromToken)) return fromToken
  const toToken = (context.to_token || "").trim()
  if (looksLikeHexFelt(toToken)) return toToken
  const symbol = fromToken || toToken
  if (!symbol) return ""
  return resolveTokenAddress(symbol).trim()
}

const resolveDenomId = (context: NoirInputsContext, existing?: Record<string, unknown>) => {
  const existingDenom = pickString(existing, ["denom_id", "denomId"])
  return existingDenom || (context.denom_id || "").trim()
}

const selectCacheKey = (context: NoirInputsContext): string | undefined => {
  const commitment = (context.note_commitment || "").trim()
  if (commitment) return commitment.toLowerCase()
  const nullifier = (context.nullifier || "").trim()
  if (nullifier) return nullifier.toLowerCase()
  return undefined
}

const getWindowProvider = (): NoirInputsProvider | undefined => {
  if (typeof window === "undefined") return undefined
  const win = window as unknown as {
    noirInputsProvider?: NoirInputsProvider
    NOIR_INPUTS_PROVIDER?: NoirInputsProvider
  }
  return win.noirInputsProvider || win.NOIR_INPUTS_PROVIDER
}

const withDefaults = (context: NoirInputsContext): NoirInputsContext => {
  const next: NoirInputsContext = { ...context }
  if (!next.note_version) next.note_version = "v4"
  if (!next.contract_address) {
    const executor = (process.env.NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim()
    if (executor) next.contract_address = executor
  }
  if (!next.chain_id) {
    const chainId =
      (process.env.NEXT_PUBLIC_STARKNET_CHAIN_ID || "").trim() ||
      (process.env.NEXT_PUBLIC_STARKNET_CHAIN_ID_TEXT || "").trim()
    if (chainId) next.chain_id = chainId
  }
  return next
}

const loadCachedNoirInputs = (cacheKey: string): Record<string, unknown> | undefined => {
  if (typeof window === "undefined") return undefined
  try {
    const raw = window.localStorage.getItem(`${NOIR_INPUTS_STORAGE_PREFIX}${cacheKey}`)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as unknown
    return normalizeNoirInputs(parsed)
  } catch {
    return undefined
  }
}

const persistCachedNoirInputs = (cacheKey: string, inputs: Record<string, unknown>) => {
  if (typeof window === "undefined") return
  try {
    const safeInputs = sanitizeSeedNoirInputs(inputs)
    if (!safeInputs) return
    window.localStorage.setItem(`${NOIR_INPUTS_STORAGE_PREFIX}${cacheKey}`, JSON.stringify(safeInputs))
  } catch {
    // ignore storage errors
  }
}

const fetchNoirInputs = async (
  context: NoirInputsContext,
  existing: Record<string, unknown> | undefined,
  timeoutMs: number
): Promise<Record<string, unknown> | undefined> => {
  const txContext: Record<string, unknown> = { ...context }
  if (existing && Object.keys(existing).length > 0) {
    txContext.noir_inputs = existing
  }
  const data = await resolvePrivacyNoirInputs(
    { tx_context: txContext },
    {
      endpoint: DEFAULT_NOIR_INPUTS_ENDPOINT,
      timeoutMs,
    }
  )
  return normalizeNoirInputs(data)
}

const maybeCreateAutoNoirNote = async (
  context: NoirInputsContext,
  existing: Record<string, unknown> | undefined
): Promise<Record<string, unknown> | undefined> => {
  const noteVersion = (context.note_version || "v4").trim().toLowerCase()
  if (noteVersion && noteVersion !== "v4") return undefined

  const existingSecret = pickString(existing, ["note_secret", "noteSecret"])
  if (existingSecret) return undefined

  const denomId = resolveDenomId(context, existing)
  if (!denomId) {
    throw new Error("Hide denom_id belum tersedia untuk generate noir_inputs otomatis.")
  }

  const tokenAddress = resolveNoteTokenAddress(context, existing)
  if (!tokenAddress) {
    throw new Error("Token address belum tersedia untuk generate noir_inputs otomatis.")
  }

  const fixed = await fetchPrivacyFixedAmount({
    executor_address: PRIVATE_ACTION_EXECUTOR_ADDRESS || undefined,
    token: tokenAddress,
    denom_id: denomId,
  })
  const amountLow = BigInt(fixed.amount_low)
  const amountHigh = BigInt(fixed.amount_high || "0")
  if (amountHigh > 0n) {
    throw new Error("Hide fixed amount terlalu besar untuk auto-generated noir note.")
  }

  const noteAmount = amountLow.toString()
  const note = await createPrivacyNote({
    note_amount: noteAmount,
    note_token: tokenAddress,
  })

  return {
    note_secret: note.note_secret,
    note_amount: noteAmount,
    note_token: tokenAddress,
    note_commitment: note.note_commitment,
    nullifier: note.nullifier,
  }
}

export async function resolveNoirInputs({
  existing,
  context,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ResolveNoirInputsOptions): Promise<Record<string, unknown> | undefined> {
  const preparedContext = withDefaults(context)
  let seedInputs = mergeSeedNoirInputs(normalizeNoirInputs(existing))
  const cacheKey = selectCacheKey(preparedContext)

  if (cacheKey) {
    seedInputs = mergeSeedNoirInputs(seedInputs, loadCachedNoirInputs(cacheKey))
  }

  let lastError: Error | undefined
  try {
    const fetched = await fetchNoirInputs(preparedContext, seedInputs, timeoutMs)
    if (fetched) {
      if (cacheKey) persistCachedNoirInputs(cacheKey, fetched)
      return fetched
    }
  } catch (error) {
    lastError = toError(error)
  }

  const provider = getWindowProvider()
  if (provider) {
    try {
      const provided = await provider(preparedContext)
      seedInputs = mergeSeedNoirInputs(seedInputs, normalizeNoirInputs(provided))
      const fetched = await fetchNoirInputs(preparedContext, seedInputs, timeoutMs)
      if (fetched) {
        if (cacheKey) persistCachedNoirInputs(cacheKey, fetched)
        return fetched
      }
    } catch (error) {
      lastError = toError(error)
    }
  }

  const autoNoteInputs = await maybeCreateAutoNoirNote(preparedContext, seedInputs)
  if (autoNoteInputs) {
    seedInputs = mergeSeedNoirInputs(seedInputs, autoNoteInputs)
    const autoCommitment = pickString(autoNoteInputs, ["note_commitment", "noteCommitment"]) || ""
    const autoNullifier = pickString(autoNoteInputs, ["nullifier"]) || ""
    const hasDepositTxHash = isNonEmptyString(preparedContext.note_deposit_tx_hash)
    if (!hasDepositTxHash) {
      throw new Error(
        "Hide note baru dibuat. Deposit note dulu sebelum generate Garaga payload."
      )
    }
    const autoContext: NoirInputsContext = {
      ...preparedContext,
      note_commitment: autoCommitment || preparedContext.note_commitment,
      nullifier: autoNullifier || preparedContext.nullifier,
    }
    try {
      const fetchedAfterCreate = await fetchNoirInputs(autoContext, seedInputs, timeoutMs)
      if (fetchedAfterCreate) {
        const autoCacheKey = selectCacheKey(autoContext)
        if (autoCacheKey) persistCachedNoirInputs(autoCacheKey, fetchedAfterCreate)
        return fetchedAfterCreate
      }
    } catch (error) {
      lastError = toError(error)
    }
  }

  if (lastError) {
    throw lastError
  }

  return undefined
}
