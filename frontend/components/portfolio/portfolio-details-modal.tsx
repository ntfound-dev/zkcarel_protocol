"use client"
import { PieChart } from "lucide-react"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  formatPercent,
  formatTokenAmount,
  formatUsd,
  formatUsdCompact,
  type PortfolioAsset,
  type PortfolioSnapshot,
  type UiTransaction,
} from "@/lib/portfolio-utils"

type TxSummary = {
  pending: number
  inbound: number
  outbound: number
  hide: number
}

type PortfolioDetailsModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  hasAnalytics: boolean
  displayData: PortfolioSnapshot
  bestPerformer: PortfolioAsset | null
  isPositive: boolean
  pnlSign: string
  txSummary: TxSummary
  transactions: UiTransaction[]
}

export function PortfolioDetailsModal({
  open,
  onOpenChange,
  hasAnalytics,
  displayData,
  bestPerformer,
  isPositive,
  pnlSign,
  txSummary,
  transactions,
}: PortfolioDetailsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong bg-background/95 backdrop-blur-xl border-border max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <PieChart className="h-5 w-5 text-primary" />
            Portfolio Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-surface/50 border border-border min-w-0">
              <p className="text-xs text-muted-foreground">Total Value</p>
              <p
                className="text-base md:text-lg font-bold text-foreground truncate"
                title={hasAnalytics ? formatUsd(displayData.totalValue) : "—"}
              >
                {hasAnalytics ? formatUsdCompact(displayData.totalValue) : "—"}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-surface/50 border border-border min-w-0">
              <p className="text-xs text-muted-foreground">Total PnL</p>
              <p
                className={cn(
                  "text-base md:text-lg font-bold truncate",
                  isPositive ? "text-success" : "text-destructive"
                )}
                title={hasAnalytics ? `${pnlSign}${formatUsd(Math.abs(displayData.pnl))}` : "—"}
              >
                {hasAnalytics ? `${pnlSign}${formatUsdCompact(Math.abs(displayData.pnl))}` : "—"}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-surface/50 border border-border min-w-0">
              <p className="text-xs text-muted-foreground">Assets</p>
              <p className="text-lg font-bold text-foreground">
                {hasAnalytics ? displayData.assets.length : "—"}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-surface/50 border border-border min-w-0">
              <p className="text-xs text-muted-foreground">Best Performer</p>
              <p
                className={cn(
                  "text-base md:text-lg font-bold truncate",
                  bestPerformer && bestPerformer.change >= 0 ? "text-success" : "text-destructive"
                )}
                title={
                  bestPerformer
                    ? `${bestPerformer.symbol} ${bestPerformer.change >= 0 ? "+" : ""}${formatPercent(bestPerformer.change)}`
                    : "—"
                }
              >
                {bestPerformer
                  ? `${bestPerformer.symbol} ${bestPerformer.change >= 0 ? "+" : ""}${formatPercent(bestPerformer.change)}`
                  : "—"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="p-2 rounded-lg bg-success/10 border border-success/30 text-center">
              <p className="text-[10px] text-muted-foreground">In</p>
              <p className="text-sm font-semibold text-success">{txSummary.inbound}</p>
            </div>
            <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/30 text-center">
              <p className="text-[10px] text-muted-foreground">Out</p>
              <p className="text-sm font-semibold text-destructive">{txSummary.outbound}</p>
            </div>
            <div className="p-2 rounded-lg bg-secondary/10 border border-secondary/30 text-center">
              <p className="text-[10px] text-muted-foreground">Pending</p>
              <p className="text-sm font-semibold text-secondary">{txSummary.pending}</p>
            </div>
            <div className="p-2 rounded-lg bg-primary/10 border border-primary/30 text-center min-w-0">
              <p className="text-[10px] text-muted-foreground">Hide Tx</p>
              <p className="text-sm font-semibold text-primary">{txSummary.hide}</p>
            </div>
          </div>

          {/* Asset Breakdown */}
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">Asset Breakdown</h3>
            <div className="space-y-3">
              {displayData.assets.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">No asset data</div>
              ) : (
                displayData.assets.map((asset) => {
                  const amount = "amount" in asset ? Number(asset.amount ?? 0) : 0
                  return (
                    <div
                      key={asset.symbol}
                      className="flex items-center justify-between p-3 rounded-lg bg-surface/30 border border-border"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center text-lg border border-border">
                          {asset.icon}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">{asset.symbol}</p>
                          <p className="text-xs text-muted-foreground truncate">{asset.name}</p>
                        </div>
                      </div>
                      <div className="text-right min-w-[96px] shrink-0">
                        <p className="text-xs text-muted-foreground">
                          {formatTokenAmount(amount)} {asset.symbol}
                        </p>
                        <p className="font-medium text-foreground break-words">{formatUsd(asset.value)}</p>
                        {asset.change !== 0 && (
                          <p className={cn("text-xs", asset.change >= 0 ? "text-success" : "text-destructive")}>
                            {asset.change >= 0 ? "+" : ""}
                            {formatPercent(asset.change)}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Transaction History */}
          <div>
            <div className="mb-3">
              <h3 className="text-sm font-medium text-foreground">Recent Transactions</h3>
              <p className="text-[11px] text-muted-foreground">
                Shows latest on-chain records with IN/OUT movement and pending status.
              </p>
            </div>
            <div className="space-y-2">
              {transactions.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">No recent transactions</div>
              ) : (
                transactions.map((tx) => {
                  const txKind = tx.type.toLowerCase().replace(/^private_/, "")
                  return (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-surface/30 border border-border"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
                            (txKind === "buy" || txKind === "stake") && "bg-success/20 text-success",
                            (txKind === "sell" || txKind === "unstake") && "bg-destructive/20 text-destructive",
                            (txKind === "swap" ||
                              txKind === "bridge" ||
                              txKind === "claim" ||
                              txKind === "limit_order") &&
                              "bg-secondary/20 text-secondary"
                          )}
                        >
                          {tx.type[0]}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="font-medium text-foreground truncate" title={`${tx.type} ${tx.asset}`}>
                              {tx.type} {tx.asset}
                            </p>
                            {tx.requestSource === "ai" ? (
                              <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary shrink-0">
                                AI
                              </span>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            {tx.amountIn > 0 && (
                              <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">
                                OUT {formatTokenAmount(tx.amountIn)} {tx.tokenIn || "?"}
                              </span>
                            )}
                            {tx.amountOut > 0 && (
                              <span className="rounded bg-success/15 px-1.5 py-0.5 text-success">
                                IN {formatTokenAmount(tx.amountOut)} {tx.tokenOut || "?"}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{tx.time}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0 min-w-[110px]">
                        <p className="font-medium text-foreground">{tx.value}</p>
                        <div className="mt-1 flex items-center justify-end gap-1">
                          <span
                            className={cn(
                              "text-[10px] rounded px-1.5 py-0.5 border",
                              tx.visibility === "Hide"
                                ? "border-primary/40 bg-primary/15 text-primary"
                                : "border-border bg-surface/60 text-muted-foreground"
                            )}
                          >
                            {tx.visibility}
                          </span>
                          <span
                            className={cn(
                              "text-[10px] rounded px-1.5 py-0.5 border",
                              tx.status === "Completed"
                                ? "border-success/40 bg-success/15 text-success"
                                : "border-secondary/40 bg-secondary/15 text-secondary"
                            )}
                          >
                            {tx.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
