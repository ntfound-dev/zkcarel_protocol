"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Check, Copy, Lock, QrCode, Wallet, Loader2 } from "lucide-react"
import { topUpProviders, type ReceiveTarget, type ReceiveNetworkTarget } from "@/lib/navigation-utils"

type TopUpDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  receiveTargets: ReceiveTarget[]
  activeReceiveNetwork: ReceiveNetworkTarget
  onSelectReceiveNetwork: (value: ReceiveNetworkTarget) => void
  selectedReceiveTarget: ReceiveTarget
  selectedReceiveFaucetUrl: string
  copiedReceiveNetwork: ReceiveNetworkTarget | null
  onCopyReceiveAddress: (target: ReceiveNetworkTarget) => void
  onOpenWalletDialog: () => void
  manualBtcAddress: string
  onManualBtcAddressChange: (value: string) => void
  btcManualLinkPending: boolean
  onManualBtcLink: () => void
}

export function TopUpDialog({
  open,
  onOpenChange,
  receiveTargets,
  activeReceiveNetwork,
  onSelectReceiveNetwork,
  selectedReceiveTarget,
  selectedReceiveFaucetUrl,
  copiedReceiveNetwork,
  onCopyReceiveAddress,
  onOpenWalletDialog,
  manualBtcAddress,
  onManualBtcAddressChange,
  btcManualLinkPending,
  onManualBtcLink,
}: TopUpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong border-border max-w-md">
        <DialogHeader>
          <DialogTitle>Top Up / Receive Crypto</DialogTitle>
          <DialogDescription>Add funds to your wallet</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="receive" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="receive">Receive</TabsTrigger>
            <TabsTrigger value="buy" disabled className="opacity-50">
              Buy
            </TabsTrigger>
            <TabsTrigger value="sell" disabled className="opacity-50">
              Sell
            </TabsTrigger>
          </TabsList>

          <TabsContent value="receive" className="space-y-4 pt-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Select Network
              </p>
              <div className="grid grid-cols-1 gap-2">
                {receiveTargets.map((target) => {
                  const isActive = target.key === activeReceiveNetwork
                  const hasAddress = Boolean(target.address)
                  return (
                    <button
                      key={target.key}
                      type="button"
                      onClick={() => onSelectReceiveNetwork(target.key)}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                        isActive
                          ? "border-primary bg-primary/10"
                          : "border-border bg-surface/40 hover:bg-surface/70"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-foreground">{target.label}</p>
                          <p className="text-xs text-muted-foreground">{target.chainHint}</p>
                        </div>
                        <span
                          className={cn(
                            "text-[10px] font-semibold",
                            hasAddress ? "text-success" : "text-muted-foreground"
                          )}
                        >
                          {hasAddress ? "READY" : "NOT LINKED"}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface/40 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Receive on {selectedReceiveTarget.label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Supported asset: {selectedReceiveTarget.chainHint}
                  </p>
                </div>
                <div className="h-10 w-10 rounded-lg border border-border bg-background flex items-center justify-center">
                  <QrCode className="h-5 w-5 text-muted-foreground" />
                </div>
              </div>

              {selectedReceiveTarget.address ? (
                <>
                  <code className="block break-all rounded-lg bg-background px-3 py-2 text-xs font-mono text-foreground">
                    {selectedReceiveTarget.address}
                  </code>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onCopyReceiveAddress(selectedReceiveTarget.key)}
                    >
                      {copiedReceiveNetwork === selectedReceiveTarget.key ? (
                        <Check className="h-4 w-4 mr-2 text-success" />
                      ) : (
                        <Copy className="h-4 w-4 mr-2" />
                      )}
                      Copy address
                    </Button>
                    {selectedReceiveTarget.explorerUrl && (
                      <Button type="button" variant="outline" size="sm" asChild>
                        <a
                          href={selectedReceiveTarget.explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View on {selectedReceiveTarget.explorerLabel}
                        </a>
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Send funds only from the same network to avoid losing assets.
                  </p>
                </>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    No address linked for {selectedReceiveTarget.label}. Connect wallet first before receiving funds.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={onOpenWalletDialog}>
                      <Wallet className="h-4 w-4 mr-2" />
                      Connect Wallet
                    </Button>
                  </div>
                  {selectedReceiveTarget.key === "btc" && (
                    <div className="space-y-2">
                      <p className="text-[11px] text-muted-foreground">
                        Or link BTC Testnet4 address manually:
                      </p>
                      <div className="flex gap-2">
                        <Input
                          value={manualBtcAddress}
                          onChange={(event) => onManualBtcAddressChange(event.target.value)}
                          placeholder="tb1... or m..."
                          className="h-9"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={onManualBtcLink}
                          disabled={btcManualLinkPending || !manualBtcAddress.trim()}
                        >
                          {btcManualLinkPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Link"
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-3 rounded-lg bg-secondary/10 border border-secondary/20">
              <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
                Transfer Guide
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                1) Select the target network. 2) Copy your receive address. 3) Send testnet funds from external wallet/exchange on the same network.
              </p>
              <a
                href={selectedReceiveFaucetUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex mt-2 text-xs text-primary hover:underline"
              >
                Get testnet funds
              </a>
            </div>
          </TabsContent>

          <TabsContent value="buy" className="space-y-4 pt-4">
            <div className="p-8 rounded-xl bg-surface/30 border border-border text-center">
              <Lock className="h-12 w-12 text-secondary mx-auto mb-4" />
              <h4 className="font-medium text-foreground mb-2">Available in Mainnet</h4>
              <p className="text-sm text-muted-foreground">
                Buy crypto with fiat currencies will be available after mainnet launch.
              </p>

              <div className="mt-6 space-y-2">
                {topUpProviders.map((provider) => (
                  <div
                    key={provider.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-surface/50 border border-border opacity-50"
                  >
                    <span className="text-xl">{provider.icon}</span>
                    <span className="text-sm text-foreground">{provider.name}</span>
                    <span className="ml-auto text-xs text-secondary">Coming Soon</span>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="sell" className="space-y-4 pt-4">
            <div className="p-8 rounded-xl bg-surface/30 border border-border text-center">
              <Lock className="h-12 w-12 text-secondary mx-auto mb-4" />
              <h4 className="font-medium text-foreground mb-2">Available in Mainnet</h4>
              <p className="text-sm text-muted-foreground">
                Sell crypto for fiat currencies will be available after mainnet launch.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
