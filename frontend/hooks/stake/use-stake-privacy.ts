"use client"

import * as React from "react"
import type { PrivacyVerificationPayload } from "@/lib/api"
import type { useNotifications } from "@/hooks/notifications/use-notifications"
import type { WalletContextType } from "@/hooks/wallet/use-wallet"
import { autoSubmitPrivacyAction, preparePrivateExit } from "@/lib/api"
import { resolveNoirInputs } from "@/lib/privacy/noir-inputs"
import {
  decimalToU256Parts,
  invokeStarknetCallFromWallet,
  invokeStarknetCallsFromWallet,
  readStarknetShieldedPoolFixedAmountFromWallet,
  toHexFelt,
} from "@/lib/onchain-trade"
import { HIDE_BALANCE_NOTE_VERSION, isStarknetEntrypointMissingError } from "@/lib/trade/trading-utils"

export const STAKE_PRIVACY_PAYLOAD_KEY = "stake_privacy_garaga_payload_v4"
export const STAKE_PRIVACY_PAYLOAD_UPDATED_EVENT = "stake-privacy-payload-updated"
export const STAKE_PRIVACY_PENDING_NOTES_KEY = "stake_privacy_pending_notes_v4"
export const STAKE_PRIVACY_PENDING_NOTES_UPDATED_EVENT = "stake-privacy-pending-notes-updated"
export const DEV_AUTO_GARAGA_PAYLOAD_ENABLED =
  process.env.NODE_ENV !== "production" &&
  (process.env.NEXT_PUBLIC_ENABLE_DEV_GARAGA_AUTOFILL || "false").toLowerCase() === "true"
export const STARKNET_ZK_PRIVACY_ROUTER_ADDRESS =
  process.env.NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS ||
  process.env.NEXT_PUBLIC_PRIVACY_ROUTER_ADDRESS ||
  ""
export const PRIVATE_ACTION_EXECUTOR_ADDRESS =
  (process.env.NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim()
export const HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED =
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED || "false").toLowerCase() ===
    "true" && PRIVATE_ACTION_EXECUTOR_ADDRESS.length > 0
export const HIDE_BALANCE_RELAYER_POOL_ENABLED =
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_ENABLED || "false").toLowerCase() === "true"
export const HIDE_BALANCE_RELAYER_APPROVE_MAX =
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_RELAYER_APPROVE_MAX || "false").toLowerCase() === "true"
const HIDE_BALANCE_MIN_NOTE_AGE_SECS_RAW =
  process.env.NEXT_PUBLIC_HIDE_BALANCE_MIN_NOTE_AGE_SECS ||
  process.env.NEXT_PUBLIC_AI_HIDE_MIN_NOTE_AGE_SECS ||
  "60"
const HIDE_BALANCE_MIN_NOTE_AGE_SECS = Number.parseInt(HIDE_BALANCE_MIN_NOTE_AGE_SECS_RAW, 10)
export const HIDE_BALANCE_MIN_NOTE_AGE_MS =
  (Number.isFinite(HIDE_BALANCE_MIN_NOTE_AGE_SECS) && HIDE_BALANCE_MIN_NOTE_AGE_SECS > 0
    ? HIDE_BALANCE_MIN_NOTE_AGE_SECS
    : 60) * 1000

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
  denom_id?: string
  token_symbol?: string
  target_token_symbol?: string
  amount?: string
  deposited_at_unix: number
  spendable_at_unix?: number
}

const U256_MASK_128 = (BigInt(1) << BigInt(128)) - BigInt(1)

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
    const payloadExecutorAddress = parsed.executor_address?.trim() || undefined
    const payloadExecutorNormalized = normalizeExecutorAddress(payloadExecutorAddress)
    if (
      CURRENT_HIDE_EXECUTOR_NORMALIZED &&
      payloadExecutorNormalized &&
      payloadExecutorNormalized !== CURRENT_HIDE_EXECUTOR_NORMALIZED
    ) {
      window.localStorage.removeItem(STAKE_PRIVACY_PAYLOAD_KEY)
      return undefined
    }
    return {
      verifier: (parsed.verifier || "garaga").trim() || "garaga",
      note_version: parsed.note_version?.trim() || undefined,
      executor_address: payloadExecutorAddress,
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

export const persistTradePrivacyPayload = (payload: PrivacyVerificationPayload) => {
  if (typeof window === "undefined") return
  window.localStorage.setItem(STAKE_PRIVACY_PAYLOAD_KEY, JSON.stringify(payload))
  window.dispatchEvent(new Event(STAKE_PRIVACY_PAYLOAD_UPDATED_EVENT))
}

export const clearTradePrivacyPayload = () => {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(STAKE_PRIVACY_PAYLOAD_KEY)
  window.dispatchEvent(new Event(STAKE_PRIVACY_PAYLOAD_UPDATED_EVENT))
}

export const loadPendingHideNotes = (): PendingHideNoteRecord[] => {
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
          note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
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
    const filtered = mapped.filter((item) => {
      const noteExecutorNormalized = normalizeExecutorAddress(item.executor_address)
      return (
        !CURRENT_HIDE_EXECUTOR_NORMALIZED ||
        !noteExecutorNormalized ||
        noteExecutorNormalized === CURRENT_HIDE_EXECUTOR_NORMALIZED
      )
    })
    if (filtered.length !== mapped.length) {
      window.localStorage.setItem(STAKE_PRIVACY_PENDING_NOTES_KEY, JSON.stringify(filtered))
    }
    return filtered.sort((a, b) => b.deposited_at_unix - a.deposited_at_unix)
  } catch {
    return []
  }
}

const persistPendingHideNotes = (items: PendingHideNoteRecord[]) => {
  if (typeof window === "undefined") return
  window.localStorage.setItem(STAKE_PRIVACY_PENDING_NOTES_KEY, JSON.stringify(items))
  window.dispatchEvent(new Event(STAKE_PRIVACY_PENDING_NOTES_UPDATED_EVENT))
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

export const buildHideBalancePrivacyCall = (
  payload: PrivacyVerificationPayload,
  actionType: string = "STAKING"
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

type PoolLike = { symbol: string; userBalance: number }

type UseStakePrivacyParams<TPool extends PoolLike> = {
  notifications: ReturnType<typeof useNotifications>
  wallet: WalletContextType
  pools: TPool[]
  selectedPool: TPool | null
  stakeAmount: string
  hideUsdtTierMin: number
  setHideUsdtTierMin: React.Dispatch<React.SetStateAction<number>>
  setSelectedPool: React.Dispatch<React.SetStateAction<TPool | null>>
  setStakeAmount: React.Dispatch<React.SetStateAction<string>>
  setBalanceHidden: React.Dispatch<React.SetStateAction<boolean>>
  setHasTradePrivacyPayload: React.Dispatch<React.SetStateAction<boolean>>
  setPendingHideNotes: React.Dispatch<React.SetStateAction<PendingHideNoteRecord[]>>
  setIsAutoPrivacyProvisioning: React.Dispatch<React.SetStateAction<boolean>>
  setPendingNoteActionCommitment: React.Dispatch<React.SetStateAction<string | null>>
  setManuallySelectedHideNote: (noteCommitment?: string, nullifier?: string) => void
  clearManuallySelectedHideNote: () => void
  isManuallySelectedHideNote: (noteCommitment?: string, nullifier?: string) => boolean
  autoPrivacyPayloadPromiseRef: React.MutableRefObject<
    Promise<PrivacyVerificationPayload | undefined> | null
  >
  resolvePoolTokenAddress: (symbol: string) => string
  resolvePoolUsdPrice: (symbol: string) => number
  poolDecimals: Record<string, number>
  starknetProviderHint: "starknet" | "argentx" | "braavos"
}

export const useStakePrivacy = <TPool extends PoolLike>({
  notifications,
  wallet,
  pools,
  selectedPool,
  stakeAmount,
  hideUsdtTierMin,
  setHideUsdtTierMin,
  setSelectedPool,
  setStakeAmount,
  setBalanceHidden,
  setHasTradePrivacyPayload,
  setPendingHideNotes,
  setIsAutoPrivacyProvisioning,
  setPendingNoteActionCommitment,
  setManuallySelectedHideNote,
  clearManuallySelectedHideNote,
  isManuallySelectedHideNote,
  autoPrivacyPayloadPromiseRef,
  resolvePoolTokenAddress,
  resolvePoolUsdPrice,
  poolDecimals,
  starknetProviderHint,
}: UseStakePrivacyParams<TPool>) => {
  const resolveHideBalancePrivacyPayload = React.useCallback(
    async (txContext?: {
      flow?: string
      fromToken?: string
      toToken?: string
      amount?: string
    }): Promise<PrivacyVerificationPayload | undefined> => {
      if (autoPrivacyPayloadPromiseRef.current) return autoPrivacyPayloadPromiseRef.current

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
          const noirInputs = await resolveNoirInputs({
            existing: cachedPayload?.noir_inputs,
            context: {
              flow: txContext?.flow || "stake",
              from_token: txContext?.fromToken || selectedPool?.symbol,
              to_token: txContext?.toToken || selectedPool?.symbol,
              amount: txContext?.amount || stakeAmount || undefined,
              from_network: "starknet",
              to_network: "starknet",
              note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
              denom_id: String(hideUsdtTierMin),
              note_commitment: cachedPayload?.note_commitment || cachedPayload?.commitment,
              note_deposit_tx_hash: cachedPayload?.note_deposit_tx_hash,
              nullifier: cachedPayload?.nullifier,
              root: cachedPayload?.root,
              spendable_at_unix: cachedPayload?.spendable_at_unix,
            },
          })
          if (!noirInputs) {
            throw new Error(
              "Noir inputs belum tersedia. Aktifkan sumber noir_inputs (window.noirInputsProvider atau NEXT_PUBLIC_NOIR_INPUTS_URL)."
            )
          }
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
              noir_inputs: noirInputs,
              note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
              denom_id: String(hideUsdtTierMin),
              note_commitment: cachedPayload?.note_commitment || cachedPayload?.commitment,
              note_deposit_tx_hash: cachedPayload?.note_deposit_tx_hash,
              nullifier: cachedPayload?.nullifier,
              root: cachedPayload?.root,
              spendable_at_unix: cachedPayload?.spendable_at_unix,
            },
          })
          const responseProof = normalizeHexArray(response.payload?.proof)
          const responsePublicInputs = normalizeHexArray(response.payload?.public_inputs)
          const responseNoirInputs =
            (response.payload as PrivacyVerificationPayload | undefined)?.noir_inputs || noirInputs
          const payload: PrivacyVerificationPayload = {
            verifier: (response.payload?.verifier || "garaga").trim() || "garaga",
            note_version:
              response.payload?.note_version?.trim() || HIDE_BALANCE_NOTE_VERSION || "v4",
            executor_address: response.payload?.executor_address?.trim() || undefined,
            root: response.payload?.root?.trim() || undefined,
            nullifier: response.payload?.nullifier?.trim(),
            commitment: response.payload?.commitment?.trim(),
            recipient: response.payload?.recipient?.trim() || undefined,
            note_commitment:
              response.payload?.note_commitment?.trim() ||
              response.payload?.commitment?.trim() ||
              undefined,
            note_deposit_tx_hash: cachedPayload?.note_deposit_tx_hash,
            noir_inputs: responseNoirInputs,
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
            note_deposit_tx_hash: payload.note_deposit_tx_hash,
            noir_inputs: responseNoirInputs,
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
            message:
              error instanceof Error
                ? error.message
                : "Unable to prepare Garaga payload automatically.",
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
    },
    [
      hideUsdtTierMin,
      notifications,
      selectedPool?.symbol,
      setHasTradePrivacyPayload,
      setIsAutoPrivacyProvisioning,
      stakeAmount,
      wallet.isConnected,
    ]
  )

  const ensureHideNoteDeposited = React.useCallback(
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
      const defaultExecutor = (PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim()
      const payloadExecutor = (payload.executor_address || "").trim()
      const executorAddress =
        HIDE_BALANCE_NOTE_VERSION === "v4" && defaultExecutor
          ? defaultExecutor
          : (payloadExecutor || defaultExecutor || "").trim()
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
      const denomId = (payload.denom_id || String(hideUsdtTierMin)).trim()
      if (!denomId) {
        throw new Error("Hide denom_id missing in privacy payload.")
      }

      const decimals = poolDecimals[tokenSymbol] ?? 18
      let fixedAmountText = (amountText || "").trim()
      try {
        const fixedAmountRaw = await readStarknetShieldedPoolFixedAmountFromWallet(
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
          throw new Error(
            `Cannot derive fixed amount for ${tokenSymbol}: token price is unavailable.`
          )
        }
        const precision = Math.min(decimals >= 10 ? 8 : 6, 8)
        fixedAmountText = (hideUsdtTierMin / tokenPriceUsd)
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
      const approvalCall = {
        contractAddress: tokenAddress,
        entrypoint: "approve",
        calldata: [executorAddress, approvalLow, approvalHigh],
      }
      const depositCall = {
        contractAddress: executorAddress,
        entrypoint: "deposit_fixed_v4",
        calldata: [tokenAddress, toHexFelt(denomId), toHexFelt(noteCommitment), "0x0"],
      }
      let txHash = ""
      try {
        txHash = await invokeStarknetCallsFromWallet(
          [approvalCall, depositCall],
          starknetProviderHint
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "")
        if (/multicall/i.test(message) || isStarknetEntrypointMissingError(error)) {
          notifications.addNotification({
            type: "warning",
            title: "Multicall gagal",
            message:
              "Wallet multicall gagal. Coba ulang dengan dua tanda tangan: approve dulu, lalu deposit.",
          })
          try {
            await invokeStarknetCallFromWallet(approvalCall, starknetProviderHint)
            txHash = await invokeStarknetCallFromWallet(depositCall, starknetProviderHint)
          } catch (sequentialError) {
            if (isStarknetEntrypointMissingError(sequentialError)) {
              throw new Error(
                `Entrypoint deposit tidak ditemukan di executor ${executorAddress}. Pastikan PRIVATE_ACTION_EXECUTOR_ADDRESS menunjuk ShieldedPool v4.`
              )
            }
            throw sequentialError
          }
        } else {
          throw error
        }
      }

      const spendableAtUnix =
        Math.floor(Date.now() / 1000) + Math.floor(HIDE_BALANCE_MIN_NOTE_AGE_MS / 1000)
      persistTradePrivacyPayload({
        ...payload,
        note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
        executor_address: executorAddress,
        note_commitment: noteCommitment,
        note_deposit_tx_hash: txHash,
        commitment: payload.commitment || noteCommitment,
        nullifier,
        denom_id: denomId,
        spendable_at_unix: spendableAtUnix,
      })
      setHasTradePrivacyPayload(true)
      upsertPendingHideNote({
        note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
        note_commitment: noteCommitment,
        note_deposit_tx_hash: txHash,
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
      hideUsdtTierMin,
      notifications,
      pools,
      poolDecimals,
      resolvePoolTokenAddress,
      resolvePoolUsdPrice,
      setHasTradePrivacyPayload,
      setPendingHideNotes,
      starknetProviderHint,
    ]
  )

  const handleUsePendingHideNote = React.useCallback(
    async (
      note: PendingHideNoteRecord,
      confirmStake: (options?: {
        manualExecuteFromPendingNote?: boolean
        overridePayload?: PrivacyVerificationPayload
        overridePoolSymbol?: string
        overrideAmount?: string
      }) => Promise<void>
    ) => {
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
        note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
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
    },
    [
      notifications,
      pools,
      setBalanceHidden,
      setHasTradePrivacyPayload,
      setHideUsdtTierMin,
      setManuallySelectedHideNote,
      setPendingNoteActionCommitment,
      setSelectedPool,
      setStakeAmount,
    ]
  )

  const handleWithdrawPendingHideNote = React.useCallback(
    async (note: PendingHideNoteRecord) => {
      const noteCommitment = (note.note_commitment || "").trim()
      if (!noteCommitment) return
      const noteNullifier = (note.nullifier || "").trim()
      if (!noteNullifier) {
        notifications.addNotification({
          type: "error",
          title: "Withdraw failed",
          message: "Nullifier tidak tersedia untuk note ini.",
        })
        return
      }
      const root = (note.root || "").trim()
      if (!root) {
        notifications.addNotification({
          type: "error",
          title: "Withdraw failed",
          message: "Root tidak tersedia untuk note ini.",
        })
        return
      }
      const defaultExecutor = (PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim()
      const payloadExecutor = (note.executor_address || "").trim()
      const executorAddress =
        HIDE_BALANCE_NOTE_VERSION === "v4" && defaultExecutor
          ? defaultExecutor
          : (payloadExecutor || defaultExecutor || "").trim()
      if (!executorAddress) {
        notifications.addNotification({
          type: "error",
          title: "Withdraw failed",
          message: "Executor address is missing for this note.",
        })
        return
      }
      const tokenSymbol = (note.token_symbol || "").trim().toUpperCase()
      const tokenAddress = resolvePoolTokenAddress(tokenSymbol).trim()
      if (!tokenAddress) {
        notifications.addNotification({
          type: "error",
          title: "Withdraw failed",
          message: `Token address untuk ${tokenSymbol || "note"} tidak tersedia.`,
        })
        return
      }
      const amountText = (note.amount || "").trim()
      if (!amountText) {
        notifications.addNotification({
          type: "error",
          title: "Withdraw failed",
          message: "Jumlah note tidak tersedia untuk private exit.",
        })
        return
      }
      const decimals = poolDecimals[tokenSymbol] ?? 18
      const [amountLow, amountHigh] = decimalToU256Parts(amountText, decimals)
      const recipientAddress = (wallet.starknetAddress || wallet.address || "").trim()
      if (!recipientAddress) {
        notifications.addNotification({
          type: "error",
          title: "Withdraw failed",
          message: "Alamat Starknet wallet belum tersedia.",
        })
        return
      }
      try {
        const preparedExit = await preparePrivateExit({
          verifier: (note.verifier || "garaga").trim() || "garaga",
          executor_address: executorAddress,
          root,
          nullifier: noteNullifier,
          note_commitment: noteCommitment,
          denom_id: (note.denom_id || "").trim() || undefined,
          token: tokenAddress,
          amount_low: amountLow,
          amount_high: amountHigh,
          recipient: recipientAddress,
          tx_context: {
            flow: "exit",
            note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
            root,
            nullifier: noteNullifier,
            recipient: recipientAddress,
            note_commitment: noteCommitment,
            denom_id: (note.denom_id || "").trim() || undefined,
            from_token: tokenSymbol,
            amount: amountText,
          },
        })
        const exitCalls = preparedExit.onchain_calls
          .filter((call) => {
            return (
              typeof call.contract_address === "string" &&
              call.contract_address.trim().length > 0 &&
              typeof call.entrypoint === "string" &&
              call.entrypoint.trim().length > 0
            )
          })
          .map((call) => ({
            contractAddress: call.contract_address.trim(),
            entrypoint: call.entrypoint.trim(),
            calldata: Array.isArray(call.calldata) ? call.calldata.map((item) => String(item)) : [],
          }))
        if (exitCalls.length === 0) {
          throw new Error("prepare-private-exit returned empty onchain_calls")
        }
        notifications.addNotification({
          type: "info",
          title: "Wallet signature required",
          message: `Confirm private exit for ${amountText} ${tokenSymbol} in your Starknet wallet.`,
        })
        const txHash = await invokeStarknetCallsFromWallet(exitCalls, starknetProviderHint)
        removePendingHideNote(noteCommitment, noteNullifier)
        if (isManuallySelectedHideNote(noteCommitment, noteNullifier)) {
          clearManuallySelectedHideNote()
        }
        clearTradePrivacyPayload()
        setHasTradePrivacyPayload(false)
        setBalanceHidden(false)
        notifications.addNotification({
          type: "success",
          title: "Withdraw submitted",
          message: `Private exit submitted (${txHash.slice(0, 10)}...).`,
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
    [
      clearManuallySelectedHideNote,
      isManuallySelectedHideNote,
      notifications,
      poolDecimals,
      resolvePoolTokenAddress,
      setBalanceHidden,
      setHasTradePrivacyPayload,
      starknetProviderHint,
      wallet.address,
      wallet.starknetAddress,
    ]
  )

  return {
    resolveHideBalancePrivacyPayload,
    ensureHideNoteDeposited,
    handleUsePendingHideNote,
    handleWithdrawPendingHideNote,
  }
}
