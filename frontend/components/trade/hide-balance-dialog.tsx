"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Countdown } from "@/components/trade/trade-countdown"
import { cn } from "@/lib/utils"
import type { PrivacyVerificationPayload } from "@/lib/api"
import type { PendingHideNoteRecord, TokenCatalogItem } from "@/lib/trading-types"
import type { useNotifications } from "@/hooks/notifications/use-notifications"
import {
  HIDE_BALANCE_NOTE_VERSION,
  PRIVATE_ACTION_EXECUTOR_ADDRESS,
  formatRemainingDuration,
  inferUsdtTierFromDenomId,
  inferHideRootFromPublicInputs,
  loadPendingHideNotes,
  loadTradePrivacyPayload,
  normalizeExecutorAddress,
  normalizeHexArray,
  persistTradePrivacyPayload,
  shortenAddress,
  upsertPendingHideNote,
} from "@/lib/trading-utils"
import { EyeOff, Loader2 } from "lucide-react"

type HideBalanceDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  hideBalanceOnchain: boolean
  hasTradePrivacyPayload: boolean
  hideMixingWindowBlocked: boolean
  hideMixingWindowRemainingMs: number
  isAutoPrivacyProvisioning: boolean
  devAutoGaragaPayloadEnabled: boolean
  hideBalanceShieldedPool: boolean
  hideBalancePrivateSwapBlockReason: string | null
  activeHideRecipient: string
  hasTrackedActiveHideNote: boolean
  activeHideNoteAmountText: string
  activeHideNoteTokenSymbol: string
  fromAmount: string
  fromTokenSymbol: string
  toTokenSymbol: string
  hideUsdtTierLockEnabled: boolean
  selectedHideUsdtTier: { minUsdt: number; bonusPercent: number }
  hideUsdtTierMin: number
  usdtEquivalentVolume: number
  activeUsdtPointsTier: { bonusPercent: number } | null
  usdtPointsTierOptions: ReadonlyArray<{ minUsdt: number; bonusPercent: number }>
  pendingHideNotesActive: PendingHideNoteRecord[]
  nowMsSnapshot: number
  activeExecutorNormalized: string
  activePendingHideNoteSwapKey: string | null
  swapState: string
  isCancellingHideNote: boolean
  notifications: ReturnType<typeof useNotifications>
  tokenCatalog: TokenCatalogItem[]
  setHideUsdtTierMin: (value: number) => void
  clearManuallySelectedHideNote: () => void
  clearTradePrivacyPayload: () => void
  setHasTradePrivacyPayload: (value: boolean) => void
  setPendingHideNotes: (notes: PendingHideNoteRecord[]) => void
  setFromTokenSymbol: (symbol: string) => void
  setToTokenSymbol: (symbol: string) => void
  setFromAmount: (value: string) => void
  setActivePendingHideNoteSwapKey: (value: string | null) => void
  resolveHideFixedAmountText: (args: {
    executorAddress?: string
    tokenSymbol?: string
    denomId?: string
    fallbackAmount?: string
    fallbackKind?: "usd" | "token"
  }) => Promise<string>
  manualSelectedHideNoteRetryRef: React.MutableRefObject<number>
  confirmTradeRef: React.MutableRefObject<() => void>
  handleCancelHideNoteWithdraw: (noteOverride?: PendingHideNoteRecord) => void
  markManuallySelectedHideNote: (noteCommitment?: string, noteNullifier?: string) => void
}

export function HideBalanceDialog({
  open,
  onOpenChange,
  hideBalanceOnchain,
  hasTradePrivacyPayload,
  hideMixingWindowBlocked,
  hideMixingWindowRemainingMs,
  isAutoPrivacyProvisioning,
  devAutoGaragaPayloadEnabled,
  hideBalanceShieldedPool,
  hideBalancePrivateSwapBlockReason,
  activeHideRecipient,
  hasTrackedActiveHideNote,
  activeHideNoteAmountText,
  activeHideNoteTokenSymbol,
  fromAmount,
  fromTokenSymbol,
  toTokenSymbol,
  hideUsdtTierLockEnabled,
  selectedHideUsdtTier,
  hideUsdtTierMin,
  usdtEquivalentVolume,
  activeUsdtPointsTier,
  usdtPointsTierOptions,
  pendingHideNotesActive,
  nowMsSnapshot,
  activeExecutorNormalized,
  activePendingHideNoteSwapKey,
  swapState,
  isCancellingHideNote,
  notifications,
  tokenCatalog,
  setHideUsdtTierMin,
  clearManuallySelectedHideNote,
  clearTradePrivacyPayload,
  setHasTradePrivacyPayload,
  setPendingHideNotes,
  setFromTokenSymbol,
  setToTokenSymbol,
  setFromAmount,
  setActivePendingHideNoteSwapKey,
  resolveHideFixedAmountText,
  manualSelectedHideNoteRetryRef,
  confirmTradeRef,
  handleCancelHideNoteWithdraw,
  markManuallySelectedHideNote,
}: HideBalanceDialogProps) {
  const usesDirectTierTokenAmount = fromTokenSymbol.trim().toUpperCase() === "CAREL"
  const lockedTierAmountText = usesDirectTierTokenAmount
    ? String(selectedHideUsdtTier.minUsdt)
    : fromAmount || "0"
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg glass-strong border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <EyeOff className="h-4 w-4" />
            Hide Balance
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
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
                  : devAutoGaragaPayloadEnabled
                  ? "Hide Balance aktif. Sistem akan auto-generate payload mock (dev mode) saat execute."
                  : "Hide Balance aktif. Sistem akan menyiapkan payload Garaga otomatis saat Execute Trade."}
              </p>
            )
          )}
          {hideBalanceOnchain && hideBalancePrivateSwapBlockReason && (
            <p className="text-xs text-warning">
              {hideBalancePrivateSwapBlockReason}
            </p>
          )}
          {hideBalanceOnchain && hideBalanceShieldedPool && activeHideRecipient && (
            <p className="text-xs text-muted-foreground">
              Recipient note terkunci: {shortenAddress(activeHideRecipient)}
            </p>
          )}
          {hideBalanceOnchain &&
            hideBalanceShieldedPool &&
            hasTrackedActiveHideNote &&
            activeHideNoteAmountText && (
              <p className="text-xs text-muted-foreground">
                Nominal note terkunci: {activeHideNoteAmountText}{" "}
                {activeHideNoteTokenSymbol || fromTokenSymbol.toUpperCase()}
              </p>
            )}
          {hideBalanceOnchain && (
            <div>
              <label className="text-sm text-foreground mb-2 block">Hide Tier (USDT)</label>
              <div className="grid grid-cols-5 gap-2">
                {usdtPointsTierOptions.map((option) => {
                  const unlocked = usdtEquivalentVolume >= option.minUsdt
                  const selected = hideUsdtTierLockEnabled && selectedHideUsdtTier.minUsdt === option.minUsdt
                  return (
                    <button
                      key={option.minUsdt}
                      type="button"
                      disabled={!hideUsdtTierLockEnabled}
                      onClick={() => {
                        if (!hideUsdtTierLockEnabled) return
                        const previousTier = hideUsdtTierMin
                        setHideUsdtTierMin(option.minUsdt)
                        if (previousTier !== option.minUsdt) {
                          clearManuallySelectedHideNote()
                          clearTradePrivacyPayload()
                          setHasTradePrivacyPayload(false)
                        }
                      }}
                      className={cn(
                        "py-2 rounded-lg text-center text-[11px] font-medium border transition-all",
                        selected
                          ? "bg-primary/20 border-primary text-primary"
                          : unlocked
                          ? "bg-success/10 border-success/40 text-success"
                          : "bg-surface text-muted-foreground border-border",
                        hideUsdtTierLockEnabled ? "hover:border-primary/60" : "cursor-default"
                      )}
                    >
                      <div>${option.minUsdt}</div>
                      <div>+{option.bonusPercent}%</div>
                    </button>
                  )
                })}
              </div>
              {hideUsdtTierLockEnabled ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Nominal hide dikunci ke tier ${selectedHideUsdtTier.minUsdt}:{" "}
                  {usesDirectTierTokenAmount ? "" : "~"}
                  {lockedTierAmountText} {fromTokenSymbol} • Bonus +{selectedHideUsdtTier.bonusPercent}%.
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  Volume saat ini: ${usdtEquivalentVolume.toFixed(2)} • Tier aktif: +
                  {(activeUsdtPointsTier?.bonusPercent || 0).toFixed(0)}% points.
                </p>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">
                Tier ini khusus mode hide (swap privat), tetap memakai NFT discount + multiplier stake.
              </p>
            </div>
          )}

          {hideBalanceOnchain && pendingHideNotesActive.length > 0 && (
            <div className="mt-2 p-3 rounded-xl border border-border/70 bg-surface/40 space-y-2">
              <p className="text-xs font-semibold text-foreground">
                Pending Hide Notes ({pendingHideNotesActive.length})
              </p>
              <div className="space-y-2 max-h-64 overflow-auto pr-1">
                {pendingHideNotesActive.map((note) => {
                  const noteCommitment = (note.note_commitment || "").trim()
                  const noteNullifier = (note.nullifier || "").trim()
                  const spendableAt = Number(note.spendable_at_unix || 0)
                  const spendableAtMs = spendableAt > 0 ? spendableAt * 1000 : 0
                  const remainingMs =
                    spendableAtMs > 0 ? Math.max(0, spendableAtMs - nowMsSnapshot) : 0
                  const isReady = remainingMs <= 0
                  const noteActionKey = `${noteCommitment}:${noteNullifier}`
                  const noteSourceTokenSymbol = (note.token_symbol || "STRK").trim().toUpperCase()
                  const noteExecutorNormalized = normalizeExecutorAddress(note.executor_address)
                  const noteExecutorMismatch =
                    !!noteExecutorNormalized &&
                    !!activeExecutorNormalized &&
                    noteExecutorNormalized !== activeExecutorNormalized
                  const noteTargetTokenSymbol = (note.target_token_symbol || "").trim().toUpperCase()
                  const displayTargetToken = noteTargetTokenSymbol || toTokenSymbol.toUpperCase()
                  const noteMissingSwapMetadata = !noteNullifier
                  const noteUseBlocked =
                    !!hideBalancePrivateSwapBlockReason ||
                    noteMissingSwapMetadata ||
                    noteExecutorMismatch
                  const isActiveNoteSwap =
                    activePendingHideNoteSwapKey === noteActionKey &&
                    (swapState === "confirming" || swapState === "processing")
                  return (
                    <div
                      key={noteActionKey}
                      className="rounded-lg border border-border/60 bg-background/40 p-2"
                    >
                      <p className="text-[11px] text-muted-foreground break-all">
                        {noteCommitment.slice(0, 12)}...{noteCommitment.slice(-6)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {note.amount || "?"} {noteSourceTokenSymbol} → {displayTargetToken} •{" "}
                        {isReady ? "Ready now" : (
                          <>
                            Ready in <Countdown targetMs={spendableAtMs} />
                          </>
                        )}
                      </p>
                      {noteMissingSwapMetadata && (
                        <p className="text-[11px] text-warning">
                          Metadata note belum lengkap untuk swap (nullifier).
                        </p>
                      )}
                      {noteExecutorMismatch && (
                        <p className="text-[11px] text-warning">
                          Note memakai executor lama. Swap diblok untuk note ini; gunakan Withdraw
                          atau pilih note lain.
                        </p>
                      )}
                      {hideBalancePrivateSwapBlockReason && (
                        <p className="text-[11px] text-warning">
                          {hideBalancePrivateSwapBlockReason}
                        </p>
                      )}
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-8 text-[11px]"
                          disabled={
                            swapState !== "idle" ||
                            !!activePendingHideNoteSwapKey ||
                            noteUseBlocked ||
                            !isReady
                          }
                          onClick={() => {
                            void (async () => {
                              setActivePendingHideNoteSwapKey(noteActionKey)
                              try {
                                if (noteUseBlocked) {
                                  notifications.addNotification({
                                    type: "warning",
                                    title: "Use note blocked",
                                    message: hideBalancePrivateSwapBlockReason
                                      ? hideBalancePrivateSwapBlockReason
                                      : noteExecutorMismatch
                                      ? "Selected note uses old executor and cannot be swapped on current relayer. Withdraw it or choose another note."
                                      : "Note belum punya metadata lengkap untuk swap.",
                                  })
                                  setActivePendingHideNoteSwapKey(null)
                                  return
                                }
                                const currentPayload = loadTradePrivacyPayload()
                                const currentCommitment = (
                                  currentPayload?.note_commitment ||
                                  currentPayload?.commitment ||
                                  ""
                                )
                                  .trim()
                                  .toLowerCase()
                                const selectedCommitment = noteCommitment.trim().toLowerCase()
                                const isSameActiveNote =
                                  !!currentCommitment && currentCommitment === selectedCommitment
                                const currentProof = normalizeHexArray(currentPayload?.proof)
                                const currentPublicInputs = normalizeHexArray(
                                  currentPayload?.public_inputs
                                )
                                const noteProof = normalizeHexArray(note.proof)
                                const notePublicInputs = normalizeHexArray(note.public_inputs)
                                const noteRoot =
                                  (note.root || "").trim() ||
                                  inferHideRootFromPublicInputs(notePublicInputs)
                                const selectedProof =
                                  noteProof.length > 0
                                    ? noteProof
                                    : isSameActiveNote && currentProof.length > 0
                                    ? currentProof
                                    : undefined
                                const selectedPublicInputs =
                                  notePublicInputs.length > 0
                                    ? notePublicInputs
                                    : isSameActiveNote && currentPublicInputs.length > 0
                                    ? currentPublicInputs
                                    : undefined
                                const payload: PrivacyVerificationPayload = {
                                  verifier:
                                    (note.verifier || currentPayload?.verifier || "garaga").trim() ||
                                    "garaga",
                                  note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
                                  executor_address:
                                    note.executor_address ||
                                    PRIVATE_ACTION_EXECUTOR_ADDRESS ||
                                    undefined,
                                  note_commitment: noteCommitment,
                                  commitment: noteCommitment,
                                  nullifier: note.nullifier || currentPayload?.nullifier,
                                  denom_id: note.denom_id,
                                  spendable_at_unix: note.spendable_at_unix,
                                  root:
                                    noteRoot ||
                                    (isSameActiveNote
                                      ? (currentPayload?.root || "").trim() ||
                                        inferHideRootFromPublicInputs(currentPublicInputs)
                                      : undefined),
                                  proof: selectedProof,
                                  public_inputs: selectedPublicInputs,
                                }
                                persistTradePrivacyPayload(payload)
                                markManuallySelectedHideNote(noteCommitment, note.nullifier)
                                const selectedTokenSymbol = noteSourceTokenSymbol
                                const selectedTargetTokenSymbol = noteTargetTokenSymbol
                                const currentFromSymbol = fromTokenSymbol.toUpperCase()
                                const currentToSymbol = toTokenSymbol.toUpperCase()
                                const resolvedTargetForNote =
                                  selectedTargetTokenSymbol || currentToSymbol
                                const selectedAmountText = (note.amount || "").trim()
                                if (
                                  selectedTokenSymbol &&
                                  (selectedTokenSymbol !== (note.token_symbol || "").trim().toUpperCase() ||
                                    resolvedTargetForNote !==
                                      (note.target_token_symbol || "").trim().toUpperCase())
                                ) {
                                  upsertPendingHideNote({
                                    ...note,
                                    token_symbol: selectedTokenSymbol,
                                    target_token_symbol: resolvedTargetForNote,
                                  })
                                  setPendingHideNotes(loadPendingHideNotes())
                                }
                                if (
                                  selectedTokenSymbol &&
                                  selectedTokenSymbol !== currentFromSymbol &&
                                  tokenCatalog.some(
                                    (token) => token.symbol.toUpperCase() === selectedTokenSymbol
                                  )
                                ) {
                                  setFromTokenSymbol(selectedTokenSymbol)
                                }
                                if (
                                  selectedTargetTokenSymbol &&
                                  selectedTargetTokenSymbol !== currentToSymbol &&
                                  selectedTargetTokenSymbol !== selectedTokenSymbol &&
                                  tokenCatalog.some(
                                    (token) => token.symbol.toUpperCase() === selectedTargetTokenSymbol
                                  )
                                ) {
                                  setToTokenSymbol(selectedTargetTokenSymbol)
                                }
                                let resolvedNoteAmountText = selectedAmountText
                                const noteDenomId = (note.denom_id || "").trim()
                                if (noteDenomId) {
                                  resolvedNoteAmountText =
                                    (await resolveHideFixedAmountText({
                                      executorAddress:
                                        note.executor_address || PRIVATE_ACTION_EXECUTOR_ADDRESS,
                                      tokenSymbol:
                                        selectedTokenSymbol || fromTokenSymbol.toUpperCase(),
                                      denomId: noteDenomId,
                                      fallbackAmount: selectedAmountText,
                                      fallbackKind: "token",
                                    })) || ""
                                }
                                if (!resolvedNoteAmountText) {
                                  resolvedNoteAmountText = selectedAmountText
                                }
                                if (resolvedNoteAmountText) {
                                  setFromAmount(resolvedNoteAmountText)
                                  if (resolvedNoteAmountText !== selectedAmountText) {
                                    upsertPendingHideNote({
                                      ...note,
                                      amount: resolvedNoteAmountText,
                                      token_symbol: selectedTokenSymbol || note.token_symbol,
                                      target_token_symbol:
                                        selectedTargetTokenSymbol || note.target_token_symbol,
                                    })
                                    setPendingHideNotes(loadPendingHideNotes())
                                  }
                                }
                                if ((note.denom_id || "").trim()) {
                                  setHideUsdtTierMin(
                                    inferUsdtTierFromDenomId((note.denom_id || "").trim())
                                  )
                                }
                                setHasTradePrivacyPayload(true)
                                manualSelectedHideNoteRetryRef.current = 0
                                notifications.addNotification({
                                  type: "info",
                                  title: "Submitting private swap",
                                  message:
                                    "Active note dipilih. Menjalankan Swap Privat now.",
                                })
                                onOpenChange(false)
                                window.setTimeout(() => {
                                  confirmTradeRef.current?.()
                                }, 0)
                              } catch (error) {
                                setActivePendingHideNoteSwapKey(null)
                                notifications.addNotification({
                                  type: "error",
                                  title: "Use note failed",
                                  message:
                                    error instanceof Error
                                      ? error.message
                                      : "Failed to prepare selected hide note.",
                                })
                              }
                            })()
                          }}
                        >
                          {isActiveNoteSwap ? (
                            <span className="inline-flex items-center gap-1">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Processing...
                            </span>
                          ) : (
                            "Swap Privat now"
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 text-[11px]"
                          disabled={isCancellingHideNote || swapState !== "idle"}
                          onClick={() => {
                            clearManuallySelectedHideNote()
                            void handleCancelHideNoteWithdraw(note)
                          }}
                        >
                          Withdraw
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
