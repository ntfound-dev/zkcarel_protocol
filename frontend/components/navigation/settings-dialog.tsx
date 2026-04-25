"use client"

import * as React from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { SettingsPage } from "@/components/settings/settings-page"

type SettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong border-border max-w-5xl max-h-[85vh] overflow-hidden p-0">
        <div className="max-h-[85vh] overflow-y-auto p-6">
          <SettingsPage />
        </div>
      </DialogContent>
    </Dialog>
  )
}
