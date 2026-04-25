"use client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { TradeResultPopupState } from "@/lib/trading-types"
import { Check, X } from "lucide-react"

type TradeResultDialogProps = {
  tradeResultPopup: TradeResultPopupState | null
  onClose: () => void
  onOpenChange: (open: boolean) => void
}

export function TradeResultDialog({
  tradeResultPopup,
  onClose,
  onOpenChange,
}: TradeResultDialogProps) {
  return (
    <Dialog
      open={Boolean(tradeResultPopup)}
      onOpenChange={(open) => {
        onOpenChange(open)
        if (!open) {
          onClose()
        }
      }}
    >
      <DialogContent className="max-w-md glass-strong border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {tradeResultPopup?.status === "success" ? (
              <Check className="h-4 w-4 text-success" />
            ) : (
              <X className="h-4 w-4 text-destructive" />
            )}
            {tradeResultPopup?.title || "Transaction Status"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-foreground leading-relaxed">
            {tradeResultPopup?.message}
          </p>
          {tradeResultPopup?.txHash ? (
            <div className="rounded-lg border border-border bg-surface/40 p-2">
              <p className="text-[11px] text-muted-foreground mb-1">Transaction Hash</p>
              <p className="text-xs font-mono break-all text-foreground">
                {tradeResultPopup.txHash}
              </p>
            </div>
          ) : null}
          <Button type="button" className="w-full" onClick={onClose}>
            OK
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
