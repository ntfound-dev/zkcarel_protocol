"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Countdown } from "@/components/trade/trade-countdown"
import { type PendingHideNoteRecord } from "@/lib/limit-utils"

type HideBalanceLimitDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  usdtTierOptions: Array<{ minUsdt: number; bonusPercent: number }>
  selectedHideTier: { minUsdt: number; bonusPercent: number }
  onSelectTier: (minUsdt: number) => void
  hideTierLockedAmount: number | null
  fromTokenSymbol: string
  hasTradePrivacyPayload: boolean
  isAutoPrivacyProvisioning: boolean
  pendingHideNotes: PendingHideNoteRecord[]
  pendingNoteActionCommitment: string | null
  isSubmitting: boolean
  onUsePendingHideNote: (note: PendingHideNoteRecord) => void
  onWithdrawPendingHideNote: (note: PendingHideNoteRecord) => void
}

export function HideBalanceLimitDialog({
  open,
  onOpenChange,
  usdtTierOptions,
  selectedHideTier,
  onSelectTier,
  hideTierLockedAmount,
  fromTokenSymbol,
  hasTradePrivacyPayload,
  isAutoPrivacyProvisioning,
  pendingHideNotes,
  pendingNoteActionCommitment,
  isSubmitting,
  onUsePendingHideNote,
  onWithdrawPendingHideNote,
}: HideBalanceLimitDialogProps) {
  const [countdownTick, setCountdownTick] = React.useState(0)
  const nextCountdownAtMs = React.useMemo(() => {
    const now = Date.now()
    const upcoming = pendingHideNotes
      .map((note) => Number(note.spendable_at_unix || 0) * 1000)
      .filter((timestamp) => Number.isFinite(timestamp) && timestamp > now)
    if (upcoming.length === 0) return null
    return Math.min(...upcoming)
  }, [pendingHideNotes, countdownTick])

  React.useEffect(() => {
    if (!nextCountdownAtMs || !Number.isFinite(nextCountdownAtMs)) return
    const delay = Math.max(0, nextCountdownAtMs - Date.now())
    if (delay <= 0) {
      setCountdownTick(Date.now())
      return
    }
    const timer = window.setTimeout(() => {
      setCountdownTick(Date.now())
    }, Math.min(delay, 2_147_483_647))
    return () => window.clearTimeout(timer)
  }, [nextCountdownAtMs])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              {usdtTierOptions.map((option) => {
                const selected = selectedHideTier.minUsdt === option.minUsdt
                return (
                  <button
                    key={option.minUsdt}
                    type="button"
                    onClick={() => onSelectTier(option.minUsdt)}
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
            <p className="text-[11px] text-muted-foreground">
              Nominal hide dikunci ke tier ${selectedHideTier.minUsdt}: ~
              {hideTierLockedAmount && Number.isFinite(hideTierLockedAmount)
                ? Number(hideTierLockedAmount).toLocaleString(undefined, {
                    maximumFractionDigits: 6,
                  })
                : "—"}{" "}
              {fromTokenSymbol.toUpperCase()} • Bonus +{selectedHideTier.bonusPercent}%.
            </p>
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
          {pendingHideNotes.length > 0 && (
            <div className="space-y-2 rounded-lg border border-border bg-surface/40 p-3">
              <p className="text-[11px] font-medium text-foreground">
                Pending Hide Notes ({pendingHideNotes.length})
              </p>
              {pendingHideNotes.map((note) => {
                const spendableAtMs = Number(note.spendable_at_unix || 0) * 1000
                const remainingMs =
                  spendableAtMs > 0 ? Math.max(0, spendableAtMs - Date.now()) : 0
                const isReady = remainingMs <= 0
                const isNoteSubmitting = pendingNoteActionCommitment === note.note_commitment
                const fromSymbol = (note.token_symbol || "Token").toUpperCase()
                const toSymbol = (note.target_token_symbol || "Token").toUpperCase()
                return (
                  <div key={note.note_commitment} className="rounded-md border border-border/60 p-2">
                    <p className="text-[10px] font-mono text-muted-foreground">
                      {note.note_commitment.slice(0, 12)}...{note.note_commitment.slice(-6)}
                    </p>
                    <p className="text-[11px] text-foreground">
                      {(note.amount || "—").trim()} {fromSymbol} → {toSymbol} •{" "}
                      {isReady ? (
                        "Ready now"
                      ) : (
                        <>
                          Ready in <Countdown targetMs={spendableAtMs} />
                        </>
                      )}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        type="button"
                        className="h-7 flex-1 text-[11px]"
                        disabled={!isReady || isSubmitting || isNoteSubmitting}
                        onClick={() => onUsePendingHideNote(note)}
                      >
                        {isNoteSubmitting ? "Processing..." : "Private Order now"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-7 flex-1 text-[11px]"
                        disabled={isSubmitting || isNoteSubmitting}
                        onClick={() => onWithdrawPendingHideNote(note)}
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
  )
}
