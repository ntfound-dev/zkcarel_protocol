"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ChevronRight } from "lucide-react"
import type { WalletProviderType, BtcWalletProviderType } from "@/hooks/wallet/use-wallet"

type WalletProviderItem = { id: WalletProviderType; name: string; icon: string }
type BtcWalletProviderItem = { id: BtcWalletProviderType; name: string; icon: string }

type WalletConnectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  walletProviders: WalletProviderItem[]
  btcWalletProviders: BtcWalletProviderItem[]
  walletConnectPending: boolean
  btcConnectPending: boolean
  onWalletConnect: (provider: WalletProviderType) => void
  onBtcConnect: (provider: BtcWalletProviderType) => void
}

export function WalletConnectDialog({
  open,
  onOpenChange,
  walletProviders,
  btcWalletProviders,
  walletConnectPending,
  btcConnectPending,
  onWalletConnect,
  onBtcConnect,
}: WalletConnectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong border-border">
        <DialogHeader>
          <DialogTitle>Connect Wallet</DialogTitle>
          <DialogDescription>Choose your preferred wallet to connect</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Starknet / EVM
          </p>
          {walletProviders.map((provider) => (
            <button
              key={provider.id}
              disabled={walletConnectPending}
              onClick={() => onWalletConnect(provider.id)}
              className="flex items-center gap-3 p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span className="text-2xl">{provider.icon}</span>
              <span className="font-medium text-foreground">{provider.name}</span>
              <ChevronRight className="h-5 w-5 ml-auto text-muted-foreground" />
            </button>
          ))}
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Bitcoin Native (Testnet)
          </p>
          {btcWalletProviders.map((provider) => (
            <button
              key={provider.id}
              disabled={btcConnectPending}
              onClick={() => onBtcConnect(provider.id)}
              className="flex items-center gap-3 p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span className="text-2xl">{provider.icon}</span>
              <span className="font-medium text-foreground">{provider.name}</span>
              <ChevronRight className="h-5 w-5 ml-auto text-muted-foreground" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
