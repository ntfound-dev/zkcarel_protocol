"use client"

import * as React from "react"
import Link from "next/link"
import { Mail } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type HelpDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function HelpDialog({ open, onOpenChange }: HelpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong border-border max-w-2xl">
        <DialogHeader>
          <DialogTitle>Help Center</DialogTitle>
          <DialogDescription>Get help with Carel Protocol platform</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Link
            href="#tutorial-swap"
            className="p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-surface/50 transition-all"
          >
            <h4 className="font-medium text-foreground mb-1">How to Swap</h4>
            <p className="text-sm text-muted-foreground">
              Learn how to swap tokens on Carel Protocol
            </p>
          </Link>
          <Link
            href="#tutorial-bridge"
            className="p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-surface/50 transition-all"
          >
            <h4 className="font-medium text-foreground mb-1">How to Bridge</h4>
            <p className="text-sm text-muted-foreground">
              Transfer assets across different networks
            </p>
          </Link>
          <div className="p-4 rounded-lg border border-border bg-surface/30">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-medium text-foreground">How to Use Limit Order</h4>
              <span className="text-xs bg-secondary/20 text-secondary px-2 py-0.5 rounded">
                Coming Soon
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Set automatic trades at your target price
            </p>
          </div>
          <Link
            href="#tutorial-wallet"
            className="p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-surface/50 transition-all"
          >
            <h4 className="font-medium text-foreground mb-1">Connect Wallet Tutorial</h4>
            <p className="text-sm text-muted-foreground">
              Learn how to connect various wallets
            </p>
          </Link>

          <div className="mt-4 p-4 rounded-lg bg-primary/10 border border-primary/20">
            <h4 className="font-medium text-foreground mb-2">Contact Support</h4>
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              <a
                href="mailto:support@carelprotocol.com"
                className="text-sm text-primary hover:underline"
              >
                support@carelprotocol.com
              </a>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
