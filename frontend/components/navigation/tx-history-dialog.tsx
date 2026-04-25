"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Clock, CheckCircle, Loader2, XCircle } from "lucide-react"
import type { UiTx } from "@/lib/navigation-utils"

type TxFilterOption = { id: string; label: string }
type TxHistoryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  txFilter: string
  onTxFilterChange: (value: string) => void
  txFilters: TxFilterOption[]
  txHistory: UiTx[]
  txHistoryLoading: boolean
  shortenAddress: (value?: string | null) => string
  txExplorerLinks: (hash?: string, network?: "starknet" | "evm" | "btc") => Array<{ label: string; url: string }>
}

export function TxHistoryDialog({
  open,
  onOpenChange,
  txFilter,
  onTxFilterChange,
  txFilters,
  txHistory,
  txHistoryLoading,
  shortenAddress,
  txExplorerLinks,
}: TxHistoryDialogProps) {
  const filteredTxHistory = txHistory.filter((tx) => {
    if (txFilter === "all") return true
    return tx.status === txFilter
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong border-border max-w-2xl">
        <DialogHeader>
          <DialogTitle>Transaction History</DialogTitle>
          <DialogDescription>View all your recent transactions</DialogDescription>
        </DialogHeader>
        <Tabs value={txFilter} onValueChange={onTxFilterChange} className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-4">
            {txFilters.map((filter) => (
              <TabsTrigger key={filter.id} value={filter.id} className="text-xs">
                {filter.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={txFilter} className="space-y-2 max-h-96 overflow-y-auto">
            {txHistoryLoading ? (
              <div className="text-center py-8">
                <Loader2 className="h-8 w-8 mx-auto mb-2 text-muted-foreground animate-spin" />
                <p className="text-sm text-muted-foreground">Loading transactions...</p>
              </div>
            ) : filteredTxHistory.length === 0 ? (
              <div className="text-center py-8">
                <Clock className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
                <p className="text-sm text-muted-foreground">No transactions found</p>
              </div>
            ) : (
              filteredTxHistory.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-surface/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center",
                        tx.status === "completed" && "bg-success/20",
                        tx.status === "pending" && "bg-secondary/20",
                        tx.status === "failed" && "bg-destructive/20"
                      )}
                    >
                      {tx.status === "completed" && (
                        <CheckCircle className="h-5 w-5 text-success" />
                      )}
                      {tx.status === "pending" && (
                        <Loader2 className="h-5 w-5 text-secondary animate-spin" />
                      )}
                      {tx.status === "failed" && (
                        <XCircle className="h-5 w-5 text-destructive" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium capitalize">
                          {tx.type} {tx.from || "—"} {tx.to ? `→ ${tx.to}` : ""}
                        </p>
                        {tx.requestSource === "ai" ? (
                          <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            AI
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">{tx.time || "—"}</p>
                      {tx.txHash && (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-[10px] font-mono text-primary">
                            {shortenAddress(tx.txHash)}
                          </span>
                          {txExplorerLinks(tx.txHash, tx.txNetwork).map((link) => (
                            <a
                              key={`${tx.id}-${link.url}`}
                              href={link.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] text-primary hover:underline"
                            >
                              {link.label}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">{tx.value || "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {tx.amount || "—"} {tx.from || ""}
                    </p>
                  </div>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
