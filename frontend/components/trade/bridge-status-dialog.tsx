"use client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { PendingBtcDepositState } from "@/lib/trading-types"
import { buildGardenOrderExplorerUrl, buildTxExplorerUrl, formatBtcFromSats } from "@/lib/trading-utils"
import { Loader2 } from "lucide-react"

type BridgeStatusDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  pendingBtcDeposit: PendingBtcDepositState | null
  pendingStatusClassName: string
  pendingStatusLabel: string
  pendingSourceLabel: string
  pendingIsFinalized: boolean
  pendingGardenOrderExplorerUrl: string
  btcDepositExplorerUrl: string
  pendingCanClaimRefund: boolean
  pendingOrderStatus: string
  trackedPendingBtcOrders: PendingBtcDepositState[]
  finalizedStatuses: Set<string>
  walletBtcAddress: string | null
  btcProviderLabel: string
  isSendingBtcDeposit: boolean
  isClaimingRefund: boolean
  onSendBtcDeposit: () => void
  onPollGardenBridgeOrder: (bridgeId: string, destinationChain: string) => void
  onOpenExternalUrl: (url: string) => void
  onClaimRefund: () => void
  onRemoveTrackedOrder: (bridgeId: string) => void
  onSetPendingBtcDeposit: (order: PendingBtcDepositState) => void
}

export function BridgeStatusDialog({
  open,
  onOpenChange,
  pendingBtcDeposit,
  pendingStatusClassName,
  pendingStatusLabel,
  pendingSourceLabel,
  pendingIsFinalized,
  pendingGardenOrderExplorerUrl,
  btcDepositExplorerUrl,
  pendingCanClaimRefund,
  pendingOrderStatus,
  trackedPendingBtcOrders,
  finalizedStatuses,
  walletBtcAddress,
  btcProviderLabel,
  isSendingBtcDeposit,
  isClaimingRefund,
  onSendBtcDeposit,
  onPollGardenBridgeOrder,
  onOpenExternalUrl,
  onClaimRefund,
  onRemoveTrackedOrder,
  onSetPendingBtcDeposit,
}: BridgeStatusDialogProps) {
  return (
    <Dialog open={open && Boolean(pendingBtcDeposit)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl glass-strong border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span>BTC Bridge Status (Garden)</span>
            {pendingBtcDeposit?.bridgeId ? (
              <span className="text-[11px] font-normal text-muted-foreground">
                Order {pendingBtcDeposit.bridgeId.slice(0, 10)}...
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>
        {pendingBtcDeposit ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/60 bg-background/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">Current order</span>
                <span className="text-[11px] font-mono text-foreground">
                  {pendingBtcDeposit.bridgeId.slice(0, 10)}...
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="rounded-md border border-border/60 bg-background/40 p-2">
                  <p className="text-[10px] text-muted-foreground">Status</p>
                  <p className={cn("text-xs font-medium", pendingStatusClassName)}>
                    {pendingStatusLabel}
                  </p>
                </div>
                <div className="rounded-md border border-border/60 bg-background/40 p-2">
                  <p className="text-[10px] text-muted-foreground">Source</p>
                  <p className="text-xs font-medium text-foreground">{pendingSourceLabel}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-background/40 p-2">
                  <p className="text-[10px] text-muted-foreground">Deposit amount</p>
                  <p className="text-xs font-medium text-foreground">
                    {formatBtcFromSats(pendingBtcDeposit.amountSats)} BTC
                  </p>
                </div>
              </div>
              <div className="rounded-md border border-border/60 bg-background/40 p-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Deposit address</p>
                <p className="mt-1 text-[11px] font-mono text-foreground break-all">
                  {pendingBtcDeposit.depositAddress}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Button
                type="button"
                onClick={onSendBtcDeposit}
                disabled={
                  isSendingBtcDeposit ||
                  !walletBtcAddress ||
                  pendingBtcDeposit.amountSats <= 0 ||
                  pendingIsFinalized ||
                  !!pendingBtcDeposit.txHash
                }
                className="h-8 px-3 text-xs"
              >
                {isSendingBtcDeposit ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Waiting...
                  </span>
                ) : pendingBtcDeposit.txHash ? (
                  "Deposit Sent"
                ) : (
                  `Send BTC (${btcProviderLabel})`
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-8 px-3 text-xs"
                onClick={() =>
                  onPollGardenBridgeOrder(
                    pendingBtcDeposit.bridgeId,
                    pendingBtcDeposit.destinationChain
                  )
                }
                disabled={pendingIsFinalized}
              >
                Refresh Status
              </Button>
              {trackedPendingBtcOrders.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-3 text-xs"
                  onClick={() => {
                    for (const order of trackedPendingBtcOrders) {
                      const normalized = (order.status || "").trim().toLowerCase()
                      if (finalizedStatuses.has(normalized)) continue
                      onPollGardenBridgeOrder(order.bridgeId, order.destinationChain)
                    }
                  }}
                >
                  Refresh All
                </Button>
              )}
              {pendingGardenOrderExplorerUrl && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-3 text-xs"
                  onClick={() => onOpenExternalUrl(pendingGardenOrderExplorerUrl)}
                >
                  Open Garden Order
                </Button>
              )}
              {btcDepositExplorerUrl && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-3 text-xs"
                  onClick={() => onOpenExternalUrl(btcDepositExplorerUrl)}
                >
                  View Deposit Address
                </Button>
              )}
              {pendingCanClaimRefund && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-3 text-xs"
                  onClick={onClaimRefund}
                  disabled={isClaimingRefund}
                >
                  {isClaimingRefund ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Claiming...
                    </span>
                  ) : (
                    "Claim Refund"
                  )}
                </Button>
              )}
            </div>

            {!walletBtcAddress && (
              <p className="text-[11px] text-warning">
                Connect BTC wallet first so the send button can be used.
              </p>
            )}
            {walletBtcAddress && !isSendingBtcDeposit && !pendingBtcDeposit.txHash && (
              <p className="text-[11px] text-muted-foreground">
                Click Send BTC to open signature popup in {btcProviderLabel}.
              </p>
            )}

            {(pendingBtcDeposit.txHash ||
              pendingBtcDeposit.burnTxHash ||
              pendingBtcDeposit.sourceInitiateTxHash ||
              pendingBtcDeposit.destinationInitiateTxHash ||
              pendingBtcDeposit.destinationRedeemTxHash ||
              pendingBtcDeposit.refundTxHash ||
              pendingBtcDeposit.instantRefundHash) && (
              <div className="space-y-1.5 rounded-lg border border-border/60 bg-background/30 p-2.5">
                <p className="text-[11px] font-medium text-foreground">Transaction refs</p>
                {pendingBtcDeposit.burnTxHash && (
                  <div className="space-y-1">
                    <p className="text-[11px] text-secondary break-all">
                      Burn tx: {pendingBtcDeposit.burnTxHash}
                    </p>
                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-6 px-2 text-[10px]"
                        onClick={() =>
                          onOpenExternalUrl(
                            buildTxExplorerUrl(pendingBtcDeposit.burnTxHash as string, "starknet")
                          )
                        }
                      >
                        Open Burn Tx
                      </Button>
                    </div>
                  </div>
                )}
                {pendingBtcDeposit.txHash && (
                  <p className="text-[11px] text-success break-all">
                    Deposit tx: {pendingBtcDeposit.txHash}
                  </p>
                )}
                {pendingBtcDeposit.sourceInitiateTxHash && (
                  <p className="text-[11px] text-muted-foreground break-all">
                    Source tx: {pendingBtcDeposit.sourceInitiateTxHash}
                  </p>
                )}
                {pendingBtcDeposit.destinationInitiateTxHash && (
                  <p className="text-[11px] text-muted-foreground break-all">
                    Destination initiate tx: {pendingBtcDeposit.destinationInitiateTxHash}
                  </p>
                )}
                {pendingBtcDeposit.destinationRedeemTxHash && (
                  <p className="text-[11px] text-success break-all">
                    Destination redeem tx: {pendingBtcDeposit.destinationRedeemTxHash}
                  </p>
                )}
                {pendingBtcDeposit.refundTxHash && (
                  <p className="text-[11px] text-success break-all">
                    Refund tx: {pendingBtcDeposit.refundTxHash}
                  </p>
                )}
                {pendingBtcDeposit.instantRefundHash && (
                  <p className="text-[11px] text-muted-foreground break-all">
                    Instant refund hash: {pendingBtcDeposit.instantRefundHash}
                  </p>
                )}
              </div>
            )}

            {(pendingOrderStatus === "expired" || pendingOrderStatus === "failed") && (
              <p className="text-[11px] text-warning">
                Order is already {pendingOrderStatus}. Use Claim Refund to process BTC return.
              </p>
            )}

            {trackedPendingBtcOrders.length > 0 && (
              <div className="space-y-2 rounded-lg border border-border/60 bg-background/30 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium text-foreground">Tracked Orders</p>
                  <span className="text-[10px] text-muted-foreground">
                    {trackedPendingBtcOrders.length} total
                  </span>
                </div>
                <div className="space-y-1.5 max-h-44 overflow-auto pr-1">
                  {trackedPendingBtcOrders.map((order) => {
                    const rawStatus = (order.status || (order.txHash ? "processing" : "pending_deposit"))
                      .trim()
                      .toLowerCase()
                    const sourceLabel = order.requestSource === "ai" ? "AI" : "Manual"
                    const statusLabel =
                      rawStatus === "pending_deposit"
                        ? "Pending deposit"
                        : rawStatus === "initiated" || rawStatus === "processing"
                        ? "Processing"
                        : rawStatus === "expired"
                        ? "Expired"
                        : rawStatus === "refunded"
                        ? "Refunded"
                        : rawStatus === "completed"
                        ? "Completed"
                        : rawStatus === "failed"
                        ? "Failed"
                        : rawStatus || "Pending"
                    const statusClass =
                      rawStatus === "completed" || rawStatus === "refunded"
                        ? "text-success"
                        : rawStatus === "expired" || rawStatus === "failed"
                        ? "text-warning"
                        : "text-muted-foreground"
                    const isActive = order.bridgeId === pendingBtcDeposit.bridgeId
                    return (
                      <div
                        key={order.bridgeId}
                        className={cn(
                          "rounded-md border px-2 py-1.5",
                          isActive ? "border-primary/50 bg-primary/10" : "border-border/60 bg-background/40"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-[11px] font-mono text-foreground truncate">
                                {order.bridgeId.slice(0, 10)}...
                              </p>
                              {isActive && (
                                <span className="rounded px-1.5 py-0.5 text-[9px] font-medium bg-primary/20 text-primary">
                                  Active
                                </span>
                              )}
                            </div>
                            <p className={cn("text-[10px]", statusClass)}>{statusLabel}</p>
                            <p className="text-[10px] text-muted-foreground">Source: {sourceLabel}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            {!isActive && (
                              <Button
                                type="button"
                                variant="outline"
                                className="h-6 px-2 text-[10px]"
                                onClick={() => onSetPendingBtcDeposit(order)}
                              >
                                Track
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => onOpenExternalUrl(buildGardenOrderExplorerUrl(order.bridgeId))}
                            >
                              Open
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => onRemoveTrackedOrder(order.bridgeId)}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
