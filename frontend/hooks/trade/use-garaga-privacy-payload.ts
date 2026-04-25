import * as React from "react"
import type { PrivacyVerificationPayload } from "@/lib/api"
import type { PendingHideNoteRecord, TokenWithBalance } from "@/lib/trading-types"
import type { useNotifications } from "@/hooks/notifications/use-notifications"
import type { WalletContextType } from "@/hooks/wallet/use-wallet"
import type { StarknetInvokeCall } from "@/lib/onchain-trade"
import { resolveNoirInputs } from "@/lib/privacy/noir-inputs"

const isHideNoteDepositRequiredMessage = (message?: string): boolean => {
  const normalized = (message || "").trim().toLowerCase()
  if (!normalized) return false
  return (
    normalized.includes("hide note baru dibuat") ||
    normalized.includes("deposit note dulu sebelum generate garaga payload") ||
    normalized.includes("deposit note dulu")
  )
}

type GaragaPrivacyHelpers = {
  loadTradePrivacyPayload: () => PrivacyVerificationPayload | undefined
  loadPendingHideNotes: () => PendingHideNoteRecord[]
  isHidePayload: (payload: PrivacyVerificationPayload | undefined) => boolean
  hasCompleteHideSpendPayload: (payload: PrivacyVerificationPayload | undefined) => boolean
  inferHideRootFromPublicInputs: (inputs: string[]) => string | undefined
  normalizeHexArray: (value: unknown) => string[]
  resolveTokenDecimals: (symbol: string) => number
  persistTradePrivacyPayload: (payload: PrivacyVerificationPayload) => void
  createDevTradePrivacyPayload: () => PrivacyVerificationPayload
  autoSubmitPrivacyAction: (payload: {
    verifier: string
    submit_onchain: boolean
    tx_context: Record<string, unknown>
  }) => Promise<{
    payload?: PrivacyVerificationPayload
    tx_hash?: string
  }>
  chainFromNetwork: (network: string) => string
}

type GaragaPrivacyFlags = {
  DEV_AUTO_GARAGA_PAYLOAD_ENABLED: boolean
  HIDE_BALANCE_NOTE_VERSION?: string
}

type UseGaragaPrivacyPayloadParams = {
  fromAmount: string
  fromToken: TokenWithBalance
  toToken: TokenWithBalance
  inferredHideDenomId: string
  actionCall?: StarknetInvokeCall
  notifications: ReturnType<typeof useNotifications>
  receiveAddress: string
  wallet: WalletContextType
  autoPrivacyPayloadPromiseRef: React.MutableRefObject<
    Promise<PrivacyVerificationPayload | undefined> | null
  >
  manuallySelectedHideNoteRef: React.MutableRefObject<{
    commitment: string
    nullifier: string
  } | null>
  setHasTradePrivacyPayload: React.Dispatch<React.SetStateAction<boolean>>
  setIsAutoPrivacyProvisioning: React.Dispatch<React.SetStateAction<boolean>>
  helpers: GaragaPrivacyHelpers
  flags: GaragaPrivacyFlags
}

export const useGaragaPrivacyPayload = ({
  fromAmount,
  fromToken,
  toToken,
  inferredHideDenomId,
  actionCall,
  notifications,
  receiveAddress,
  wallet,
  autoPrivacyPayloadPromiseRef,
  manuallySelectedHideNoteRef,
  setHasTradePrivacyPayload,
  setIsAutoPrivacyProvisioning,
  helpers,
  flags,
}: UseGaragaPrivacyPayloadParams) => {
  const {
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
  } = helpers
  const { DEV_AUTO_GARAGA_PAYLOAD_ENABLED, HIDE_BALANCE_NOTE_VERSION } = flags

  return React.useCallback(async () => {
    const cachedPayload = loadTradePrivacyPayload()
    const manualSelection = manuallySelectedHideNoteRef.current
    const manualSelectedPendingNote = manualSelection
      ? loadPendingHideNotes().find((note) => {
          const noteCommitment = (note.note_commitment || "").trim().toLowerCase()
          const noteNullifier = (note.nullifier || "").trim().toLowerCase()
          const sameCommitment =
            !!manualSelection.commitment &&
            !!noteCommitment &&
            noteCommitment === manualSelection.commitment
          const sameNullifier =
            !!manualSelection.nullifier &&
            !!noteNullifier &&
            noteNullifier === manualSelection.nullifier
          return sameCommitment || sameNullifier
        })
      : undefined
    const manualSelectedCommitment = (
      manualSelectedPendingNote?.note_commitment ||
      manualSelection?.commitment ||
      ""
    )
      .trim()
      .toLowerCase()
    const manualSelectedNullifier = (
      manualSelectedPendingNote?.nullifier ||
      manualSelection?.nullifier ||
      ""
    )
      .trim()
      .toLowerCase()
    const manualSelectedExecutor = (manualSelectedPendingNote?.executor_address || "").trim()
    const manualSelectedRoot = (manualSelectedPendingNote?.root || "").trim()
    const manualSelectedDenomId = (manualSelectedPendingNote?.denom_id || "").trim()
    const manualSelectedSpendableAtUnix =
      typeof manualSelectedPendingNote?.spendable_at_unix === "number" &&
      Number.isFinite(manualSelectedPendingNote.spendable_at_unix)
        ? Math.floor(manualSelectedPendingNote.spendable_at_unix)
        : undefined
    const manualSelectionLocked = !!manualSelectedCommitment || !!manualSelectedNullifier
    const cachedPayloadIsHide = isHidePayload(cachedPayload)
    const lockedNoteNullifier =
      manualSelectedNullifier || (cachedPayload?.nullifier || "").trim().toLowerCase()
    const lockedNoteCommitment = (
      manualSelectedCommitment ||
      cachedPayload?.note_commitment ||
      cachedPayload?.commitment ||
      ""
    )
      .trim()
      .toLowerCase()
    let lockedPendingNote = manualSelectedPendingNote
    if (!lockedPendingNote && cachedPayloadIsHide) {
      lockedPendingNote = loadPendingHideNotes().find((note) => {
        const noteCommitment = (note.note_commitment || "").trim().toLowerCase()
        const noteNullifier = (note.nullifier || "").trim().toLowerCase()
        return (
          (!!lockedNoteCommitment && noteCommitment === lockedNoteCommitment) ||
          (!!lockedNoteNullifier && noteNullifier === lockedNoteNullifier)
        )
      })
    }
    const lockedNoteToken = (lockedPendingNote?.token_symbol || "").trim().toUpperCase()
    const currentToken = fromToken.symbol.toUpperCase()
    const lockedNoteAmount = Number.parseFloat((lockedPendingNote?.amount || "").trim() || "NaN")
    const currentAmount = Number.parseFloat(fromAmount || "NaN")
    const lockedTokenMismatch =
      !!lockedNoteToken && !!currentToken && lockedNoteToken !== currentToken
    const lockedAmountMismatch =
      Number.isFinite(lockedNoteAmount) &&
      lockedNoteAmount > 0 &&
      Number.isFinite(currentAmount) &&
      Math.abs(currentAmount - lockedNoteAmount) >
        Math.max(1e-9, Math.pow(10, -Math.min(6, resolveTokenDecimals(fromToken.symbol))))
    const cachedPayloadNoteMismatch =
      cachedPayloadIsHide && !manualSelectionLocked && (lockedTokenMismatch || lockedAmountMismatch)
    const cachedPayloadStillMixing =
      cachedPayloadIsHide &&
      !manualSelectionLocked &&
      typeof cachedPayload?.spendable_at_unix === "number" &&
      Number.isFinite(cachedPayload.spendable_at_unix) &&
      cachedPayload.spendable_at_unix * 1000 > Date.now()
    const shouldReuseCachedNote =
      cachedPayloadIsHide && !manualSelectionLocked && !cachedPayloadNoteMismatch && !cachedPayloadStillMixing
    const hasLockedNote =
      (shouldReuseCachedNote || manualSelectionLocked) &&
      !!lockedNoteNullifier &&
      !!lockedNoteCommitment
    const selectedExecutorAddress =
      manualSelectedExecutor ||
      (shouldReuseCachedNote ? (cachedPayload?.executor_address || "").trim() : "") ||
      undefined
    // For manually selected notes, always regenerate proof against current pair/quote context.
    const forceRefreshForManualSelectedNote = Boolean(manuallySelectedHideNoteRef.current)
    if (
      hasCompleteHideSpendPayload(cachedPayload) &&
      shouldReuseCachedNote &&
      !forceRefreshForManualSelectedNote
    ) {
      setHasTradePrivacyPayload(true)
      return {
        ...cachedPayload,
        root:
          (cachedPayload?.root || "").trim() ||
          inferHideRootFromPublicInputs(normalizeHexArray(cachedPayload?.public_inputs)) ||
          undefined,
      }
    }
    if (cachedPayload && !cachedPayloadIsHide) {
      setHasTradePrivacyPayload(true)
      return cachedPayload
    }
    if (cachedPayload && !wallet.isConnected) {
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
        const flow =
          chainFromNetwork(fromToken.network) !== chainFromNetwork(toToken.network)
            ? "bridge"
            : "swap"
        const noirInputs = await resolveNoirInputs({
          existing:
            manualSelectedPendingNote?.noir_inputs ||
            (shouldReuseCachedNote ? cachedPayload?.noir_inputs : undefined),
          context: {
            flow,
            from_token: fromToken.symbol,
            to_token: toToken.symbol,
            amount: fromAmount,
            recipient: recipientForPayload,
            from_network: fromToken.network,
            to_network: toToken.network,
            contract_address: selectedExecutorAddress,
            executor_address: selectedExecutorAddress,
            note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
            denom_id: inferredHideDenomId || (shouldReuseCachedNote ? cachedPayload?.denom_id : undefined),
            note_commitment:
              manualSelectedCommitment ||
              (!shouldReuseCachedNote
                ? undefined
                : cachedPayload?.note_commitment || cachedPayload?.commitment),
            note_deposit_tx_hash:
              manualSelectedPendingNote?.note_deposit_tx_hash ||
              (shouldReuseCachedNote ? cachedPayload?.note_deposit_tx_hash : undefined),
            nullifier:
              manualSelectedNullifier || (shouldReuseCachedNote ? cachedPayload?.nullifier : undefined),
          },
        })
        if (!noirInputs) {
          throw new Error(
            "Noir inputs belum tersedia. Aktifkan sumber noir_inputs (window.noirInputsProvider atau NEXT_PUBLIC_NOIR_INPUTS_URL)."
          )
        }
        const normalizedActionCalldata = Array.isArray(actionCall?.calldata)
          ? actionCall.calldata.map((value) => String(value))
          : undefined
        const response = await autoSubmitPrivacyAction({
          verifier: "garaga",
          submit_onchain: false,
          tx_context: {
            flow,
            from_token: fromToken.symbol,
            to_token: toToken.symbol,
            amount: fromAmount,
            recipient: recipientForPayload,
            from_network: fromToken.network,
            to_network: toToken.network,
            contract_address: selectedExecutorAddress,
            executor_address: selectedExecutorAddress,
            noir_inputs: noirInputs,
            note_version: HIDE_BALANCE_NOTE_VERSION,
            action_target: actionCall?.contractAddress?.trim() || undefined,
            action_selector: actionCall?.entrypoint?.trim() || undefined,
            action_calldata: normalizedActionCalldata,
            approval_token: normalizedActionCalldata?.[5]?.trim() || undefined,
            approval_amount_low: normalizedActionCalldata?.[7]?.trim() || undefined,
            approval_amount_high: normalizedActionCalldata?.[8]?.trim() || undefined,
            payout_token: normalizedActionCalldata?.[6]?.trim() || undefined,
            min_payout_low: normalizedActionCalldata?.[3]?.trim() || undefined,
            min_payout_high: normalizedActionCalldata?.[4]?.trim() || undefined,
            denom_id: inferredHideDenomId || (shouldReuseCachedNote ? cachedPayload?.denom_id : undefined),
            note_commitment:
              manualSelectedCommitment ||
              (!shouldReuseCachedNote
                ? undefined
                : cachedPayload?.note_commitment || cachedPayload?.commitment),
            note_deposit_tx_hash:
              manualSelectedPendingNote?.note_deposit_tx_hash ||
              (shouldReuseCachedNote ? cachedPayload?.note_deposit_tx_hash : undefined),
            nullifier:
              manualSelectedNullifier || (shouldReuseCachedNote ? cachedPayload?.nullifier : undefined),
            spendable_at_unix:
              manualSelectedSpendableAtUnix ||
              (shouldReuseCachedNote ? cachedPayload?.spendable_at_unix : undefined),
          },
        })
        const responseProof = normalizeHexArray(response.payload?.proof)
        const responsePublicInputs = normalizeHexArray(response.payload?.public_inputs)
        const responseRoot =
          response.payload?.root?.trim() || inferHideRootFromPublicInputs(responsePublicInputs)
        const responseNoirInputs =
          (response.payload as PrivacyVerificationPayload | undefined)?.noir_inputs || noirInputs
        const payload: PrivacyVerificationPayload = {
          verifier: (response.payload?.verifier || "garaga").trim() || "garaga",
          note_version:
            response.payload?.note_version?.trim() ||
            cachedPayload?.note_version?.trim() ||
            HIDE_BALANCE_NOTE_VERSION,
          executor_address: response.payload?.executor_address?.trim() || undefined,
          root:
            responseRoot ||
            (shouldReuseCachedNote ? cachedPayload?.root?.trim() : undefined) ||
            undefined,
          nullifier:
            response.payload?.nullifier?.trim() ||
            (shouldReuseCachedNote ? cachedPayload?.nullifier?.trim() : undefined),
          commitment:
            response.payload?.commitment?.trim() ||
            (shouldReuseCachedNote ? cachedPayload?.commitment?.trim() : undefined),
          recipient: response.payload?.recipient?.trim() || recipientForPayload,
          note_commitment:
            response.payload?.note_commitment?.trim() ||
            (shouldReuseCachedNote ? cachedPayload?.note_commitment?.trim() : undefined) ||
            (shouldReuseCachedNote ? cachedPayload?.commitment?.trim() : undefined) ||
            undefined,
          note_deposit_tx_hash:
            manualSelectedPendingNote?.note_deposit_tx_hash ||
            (shouldReuseCachedNote ? cachedPayload?.note_deposit_tx_hash : undefined),
          noir_inputs: responseNoirInputs,
          denom_id:
            response.payload?.denom_id?.trim() ||
            cachedPayload?.denom_id?.trim() ||
            inferredHideDenomId,
          spendable_at_unix:
            typeof response.payload?.spendable_at_unix === "number" &&
            Number.isFinite(response.payload.spendable_at_unix)
              ? Math.floor(response.payload.spendable_at_unix)
              : shouldReuseCachedNote && typeof cachedPayload?.spendable_at_unix === "number"
              ? Math.floor(cachedPayload.spendable_at_unix)
              : undefined,
          proof: responseProof,
          public_inputs: responsePublicInputs,
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
          executor_address: manualSelectedExecutor || payload.executor_address,
          root: manualSelectedRoot || payload.root,
          nullifier: manualSelectedNullifier || payload.nullifier,
          commitment: manualSelectedCommitment || payload.commitment,
          recipient: payload.recipient,
          note_commitment: manualSelectedCommitment || payload.note_commitment,
          note_deposit_tx_hash: payload.note_deposit_tx_hash,
          noir_inputs: responseNoirInputs,
          denom_id: manualSelectedDenomId || payload.denom_id,
          spendable_at_unix: manualSelectedSpendableAtUnix || payload.spendable_at_unix,
          proof,
          public_inputs: publicInputs,
        }
        if (hasLockedNote) {
          const returnedNullifier = (normalizedPayload.nullifier || "").trim().toLowerCase()
          const returnedCommitment = (
            normalizedPayload.note_commitment ||
            normalizedPayload.commitment ||
            ""
          )
            .trim()
            .toLowerCase()
          if (returnedNullifier !== lockedNoteNullifier) {
            throw new Error(
              "Generated payload tidak cocok dengan note terpilih (nullifier mismatch). Pilih note lain atau withdraw note ini."
            )
          }
          if (returnedCommitment && returnedCommitment !== lockedNoteCommitment) {
            throw new Error(
              "Generated payload tidak cocok dengan note terpilih (commitment mismatch). Pilih note lain atau withdraw note ini."
            )
          }
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
        const resolvedError =
          error instanceof Error
            ? error
            : new Error("Gagal menyiapkan payload Garaga otomatis.")
        if (isHideNoteDepositRequiredMessage(resolvedError.message)) {
          setHasTradePrivacyPayload(false)
          return undefined
        }
        notifications.addNotification({
          type: "error",
          title: "Auto Garaga payload failed",
          message: resolvedError.message,
        })
        if (cachedPayload && !hasLockedNote && shouldReuseCachedNote) {
          // Fallback: keep active cached note payload so execute path can continue.
          // Backend will regenerate proof when payload is incomplete.
          return cachedPayload
        }
        throw resolvedError
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
    inferredHideDenomId,
    actionCall,
    notifications,
    receiveAddress,
    toToken.network,
    toToken.symbol,
    wallet.isConnected,
    helpers,
    flags,
  ])
}
