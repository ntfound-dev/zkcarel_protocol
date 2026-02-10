"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { ShieldCheck, Send, Database, Hash } from "lucide-react"
import { Button } from "@/components/ui/button"
import { submitPrivacyAction, type PrivacyActionPayload } from "@/lib/api"
import { useNotifications } from "@/hooks/use-notifications"

const parseList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

export function PrivacyRouterPanel({ compact = false }: { compact?: boolean }) {
  const notifications = useNotifications()
  const [mode, setMode] = React.useState<"v2" | "v1">("v2")
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const [actionType, setActionType] = React.useState("")
  const [oldRoot, setOldRoot] = React.useState("")
  const [newRoot, setNewRoot] = React.useState("")
  const [nullifiers, setNullifiers] = React.useState("")
  const [commitments, setCommitments] = React.useState("")

  const [nullifier, setNullifier] = React.useState("")
  const [commitment, setCommitment] = React.useState("")

  const [publicInputs, setPublicInputs] = React.useState("")
  const [proof, setProof] = React.useState("")

  const handleSubmit = async () => {
    const shared: Pick<PrivacyActionPayload, "proof" | "public_inputs"> = {
      proof: parseList(proof),
      public_inputs: parseList(publicInputs),
    }

    let payload: PrivacyActionPayload
    if (mode === "v2") {
      if (!actionType || !oldRoot || !newRoot) {
        notifications.addNotification({
          type: "error",
          title: "Privacy V2",
          message: "action_type, old_root, dan new_root wajib diisi.",
        })
        return
      }
      payload = {
        action_type: actionType,
        old_root: oldRoot,
        new_root: newRoot,
        nullifiers: parseList(nullifiers),
        commitments: parseList(commitments),
        ...shared,
      }
    } else {
      if (!nullifier || !commitment) {
        notifications.addNotification({
          type: "error",
          title: "Privacy V1",
          message: "nullifier dan commitment wajib diisi.",
        })
        return
      }
      payload = {
        nullifier,
        commitment,
        ...shared,
      }
    }

    setIsSubmitting(true)
    try {
      notifications.addNotification({
        type: "info",
        title: "Privacy pending",
        message: "Mengirim privacy action ke backend...",
      })
      const result = await submitPrivacyAction(payload)
      notifications.addNotification({
        type: "success",
        title: "Privacy submitted",
        message: `TX: ${result.tx_hash}`,
      })
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Privacy submit failed",
        message: error instanceof Error ? error.message : "Gagal submit privacy action.",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section id="privacy" className={compact ? "py-2" : "py-12"}>
      <div className={cn("flex items-center gap-3", compact ? "mb-3" : "mb-6")}>
        <ShieldCheck className="h-6 w-6 text-primary" />
        <h2 className={cn("font-bold text-foreground", compact ? "text-lg" : "text-2xl")}>Privacy Router</h2>
      </div>

      <div className="p-6 rounded-2xl glass border border-border">
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setMode("v2")}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-semibold transition-colors",
              mode === "v2" ? "bg-primary/20 text-primary" : "bg-surface/50 text-muted-foreground"
            )}
          >
            V2 (PrivacyRouter)
          </button>
          <button
            onClick={() => setMode("v1")}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-semibold transition-colors",
              mode === "v1" ? "bg-primary/20 text-primary" : "bg-surface/50 text-muted-foreground"
            )}
          >
            V1 (ZkPrivacyRouter)
          </button>
        </div>

        {mode === "v2" ? (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <label className="text-xs text-muted-foreground">Action Type</label>
              <input
                value={actionType}
                onChange={(e) => setActionType(e.target.value)}
                placeholder="e.g. SWAP / 0x..."
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-foreground text-sm"
              />

              <label className="text-xs text-muted-foreground">Old Root</label>
              <input
                value={oldRoot}
                onChange={(e) => setOldRoot(e.target.value)}
                placeholder="0x..."
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-foreground text-sm"
              />

              <label className="text-xs text-muted-foreground">New Root</label>
              <input
                value={newRoot}
                onChange={(e) => setNewRoot(e.target.value)}
                placeholder="0x..."
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-foreground text-sm"
              />
            </div>

            <div className="space-y-3">
              <label className="text-xs text-muted-foreground">Nullifiers (comma separated)</label>
              <textarea
                value={nullifiers}
                onChange={(e) => setNullifiers(e.target.value)}
                placeholder="0xaaa,0xbbb"
                className="w-full h-20 px-3 py-2 rounded-lg bg-surface border border-border text-foreground text-sm"
              />

              <label className="text-xs text-muted-foreground">Commitments (comma separated)</label>
              <textarea
                value={commitments}
                onChange={(e) => setCommitments(e.target.value)}
                placeholder="0xccc,0xddd"
                className="w-full h-20 px-3 py-2 rounded-lg bg-surface border border-border text-foreground text-sm"
              />
            </div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <label className="text-xs text-muted-foreground">Nullifier</label>
              <input
                value={nullifier}
                onChange={(e) => setNullifier(e.target.value)}
                placeholder="0x..."
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-foreground text-sm"
              />
              <label className="text-xs text-muted-foreground">Commitment</label>
              <input
                value={commitment}
                onChange={(e) => setCommitment(e.target.value)}
                placeholder="0x..."
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-foreground text-sm"
              />
            </div>
            <div className="rounded-xl bg-surface/40 border border-border p-4 text-xs text-muted-foreground">
              <p className="flex items-center gap-2 mb-2"><Database className="h-4 w-4" />Legacy V1 path (ZkPrivacyRouter.submit_private_action)</p>
              <p>Gunakan ini jika router V2 belum di-deploy.</p>
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <div>
            <label className="text-xs text-muted-foreground">Public Inputs (comma separated)</label>
            <textarea
              value={publicInputs}
              onChange={(e) => setPublicInputs(e.target.value)}
              placeholder="0x1,0x2"
              className="w-full h-20 px-3 py-2 rounded-lg bg-surface border border-border text-foreground text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Proof (comma separated)</label>
            <textarea
              value={proof}
              onChange={(e) => setProof(e.target.value)}
              placeholder="0xabc,0xdef"
              className="w-full h-20 px-3 py-2 rounded-lg bg-surface border border-border text-foreground text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between mt-5 gap-3">
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Hash className="h-4 w-4" />
            Payload akan diarahkan ke router yang aktif di backend.
          </div>
          <Button onClick={handleSubmit} disabled={isSubmitting} className="bg-gradient-to-r from-primary to-accent">
            {isSubmitting ? "Submitting..." : "Submit Privacy Action"}
            <Send className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    </section>
  )
}
