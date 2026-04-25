"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertCircle, Check } from "lucide-react"

type ConfirmOrderDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  submitSuccess: boolean
  orderType: "buy" | "sell"
  tokenSymbol: string
  targetPrice: number
  amount: string
  amountTokenSymbol: string
  expiryLabel?: string
  balanceHidden: boolean
  selectedHideTier: { minUsdt: number; bonusPercent: number }
  isSubmitting: boolean
  onConfirm: () => void
}

export function ConfirmOrderDialog({
  open,
  onOpenChange,
  submitSuccess,
  orderType,
  tokenSymbol,
  targetPrice,
  amount,
  amountTokenSymbol,
  expiryLabel,
  balanceHidden,
  selectedHideTier,
  isSubmitting,
  onConfirm,
}: ConfirmOrderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md glass-strong border-border">
        <DialogHeader>
          <DialogTitle>Confirm Order</DialogTitle>
        </DialogHeader>

        {submitSuccess ? (
          <div className="py-8 text-center">
            <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
              <Check className="h-8 w-8 text-success" />
            </div>
            <p className="text-lg font-medium text-foreground">Order Created Successfully!</p>
            <p className="text-sm text-muted-foreground mt-2">
              Your order will be executed when target price is reached
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-4">
              <div className="p-4 rounded-xl bg-surface/50 border border-border">
                <div className="flex justify-between mb-2">
                  <span className="text-muted-foreground">Type</span>
                  <span
                    className={cn(
                      "font-medium",
                      orderType === "buy" ? "text-success" : "text-destructive"
                    )}
                  >
                    {orderType === "buy" ? "Buy" : "Sell"}
                  </span>
                </div>
                <div className="flex justify-between mb-2">
                  <span className="text-muted-foreground">Token</span>
                  <span className="font-medium text-foreground">{tokenSymbol}</span>
                </div>
                <div className="flex justify-between mb-2">
                  <span className="text-muted-foreground">Target Price</span>
                  <span className="font-medium text-foreground">
                    ${Number(targetPrice).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between mb-2">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-medium text-foreground">
                    {amount} {amountTokenSymbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Expiry</span>
                  <span className="font-medium text-foreground">{expiryLabel || "—"}</span>
                </div>
                <div className="flex justify-between mt-2">
                  <span className="text-muted-foreground">Hide Balance</span>
                  <span
                    className={cn(
                      "font-medium",
                      balanceHidden ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    {balanceHidden ? "ON" : "OFF"}
                  </span>
                </div>
                {balanceHidden ? (
                  <div className="flex justify-between mt-2">
                    <span className="text-muted-foreground">Hide Tier</span>
                    <span className="font-medium text-primary">
                      ${selectedHideTier.minUsdt} (+{selectedHideTier.bonusPercent}%)
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="p-3 rounded-lg bg-secondary/10 border border-secondary/20">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-secondary flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-foreground">
                    This order is testnet-only and does not use real funds
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
                Batal
              </Button>
              <Button
                onClick={onConfirm}
                disabled={isSubmitting}
                className={cn(
                  "flex-1",
                  orderType === "buy" ? "bg-success hover:bg-success/90" : "bg-destructive hover:bg-destructive/90"
                )}
              >
                {isSubmitting ? "Processing..." : "Confirm"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
