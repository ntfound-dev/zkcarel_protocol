"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type TradePreviewDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  fromAmount: string
  fromSymbol: string
  toAmount: string
  toSymbol: string
  isCrossChain: boolean
  routeLabel: string
  activeSlippage: string
  mevProtection: boolean
  feeDisplayLabel: string
  estimatedTime: string
  pointsEarned: number | null
  receiveAddress: string
  requiresBtcDepositSigning?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function TradePreviewDialog({
  open,
  onOpenChange,
  fromAmount,
  fromSymbol,
  toAmount,
  toSymbol,
  isCrossChain,
  routeLabel,
  activeSlippage,
  mevProtection,
  feeDisplayLabel,
  estimatedTime,
  pointsEarned,
  receiveAddress,
  requiresBtcDepositSigning = false,
  onCancel,
  onConfirm,
}: TradePreviewDialogProps) {
  const formatAmount = React.useCallback((raw: string, maxFractionDigits = 8) => {
    const parsed = Number.parseFloat(raw)
    if (!Number.isFinite(parsed)) return raw
    return parsed.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFractionDigits,
    })
  }, [])

  const parsedToAmount = Number.parseFloat(toAmount)
  const receiveLabel =
    Number.isFinite(parsedToAmount) && parsedToAmount > 0
      ? `${parsedToAmount.toFixed(4)} ${toSymbol}`
      : "—"
  const payLabel = `${formatAmount(fromAmount)} ${fromSymbol}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong border-border max-w-[calc(100vw-1rem)] sm:max-w-md p-4 sm:p-6 overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="text-foreground">Confirm Trade</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 sm:space-y-4 py-2 sm:py-4">
          <div className="p-4 rounded-xl bg-surface/50 space-y-3">
            <div className="flex items-center justify-between gap-3 min-w-0 pr-4 sm:pr-5">
              <span className="text-sm text-muted-foreground">You Pay</span>
              <span className="font-medium text-foreground min-w-0 max-w-[70%] text-right truncate" title={payLabel}>
                {payLabel}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 min-w-0 pr-4 sm:pr-5">
              <span className="text-sm text-muted-foreground">You Receive</span>
              <span className="font-medium text-foreground min-w-0 max-w-[70%] text-right truncate" title={receiveLabel}>
                {receiveLabel}
              </span>
            </div>
            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between gap-3 min-w-0 pr-4 sm:pr-5">
                <span className="text-sm text-muted-foreground">Route</span>
                <span className="text-sm text-foreground min-w-0 max-w-[70%] text-right truncate" title={`${isCrossChain ? "Bridge" : "Swap"} via ${routeLabel}`}>
                  {isCrossChain ? "Bridge" : "Swap"} via {routeLabel}
                </span>
              </div>
              <div className="flex items-center justify-between mt-2 gap-3 min-w-0 pr-4 sm:pr-5">
                <span className="text-sm text-muted-foreground">Slippage</span>
                <span className="text-sm text-foreground min-w-0 max-w-[70%] text-right truncate">{activeSlippage}%</span>
              </div>
              <div className="flex items-center justify-between mt-2 gap-3 min-w-0 pr-4 sm:pr-5">
                <span className="text-sm text-muted-foreground">MEV Protection</span>
                <span className="text-sm text-foreground min-w-0 max-w-[70%] text-right truncate">{mevProtection ? "Enabled" : "Disabled"}</span>
              </div>
              <div className="flex items-center justify-between mt-2 gap-3 min-w-0 pr-4 sm:pr-5">
                <span className="text-sm text-muted-foreground">Fee</span>
                <span className="text-sm text-foreground min-w-0 max-w-[70%] text-right truncate" title={feeDisplayLabel}>{feeDisplayLabel}</span>
              </div>
              <div className="flex items-center justify-between mt-2 gap-3 min-w-0 pr-4 sm:pr-5">
                <span className="text-sm text-muted-foreground">Est. Time</span>
                <span className="text-sm text-foreground min-w-0 max-w-[70%] text-right truncate" title={estimatedTime}>{estimatedTime}</span>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-between pr-4 sm:pr-5">
            <span className="text-sm text-foreground">Estimated Points</span>
            <span className="font-bold text-accent">{pointsEarned === null ? "—" : `+${pointsEarned}`}</span>
          </div>

          <div className="p-3 rounded-lg bg-surface/50">
            <p className="text-xs text-muted-foreground mb-1">Receive Address</p>
            <p className="text-sm font-mono text-foreground break-all">{receiveAddress}</p>
          </div>

          {requiresBtcDepositSigning && (
            <div className="p-3 rounded-lg bg-primary/10 border border-primary/30">
              <p className="text-xs text-foreground">
                After confirmation, the app will create a Garden order, then open UniSat/Xverse popup to sign and send BTC deposit on-chain.
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 bg-transparent"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-gradient-to-r from-primary to-accent hover:opacity-90 text-primary-foreground"
              onClick={onConfirm}
            >
              {requiresBtcDepositSigning ? "Confirm & Sign BTC" : "Confirm & Sign"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
