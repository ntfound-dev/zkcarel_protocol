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

type PrivacyHistoryStatus = "pending" | "confirmed" | "failed"

type PrivacyHistoryItem = {
  id: string
  mode: "v1" | "v2"
  actionType?: string
  txHash: string
  createdAt: string
  status: PrivacyHistoryStatus
}

const HISTORY_KEY = "privacy_history_v2"

const shortHash = (hash: string) => {
  if (!hash) return ""
  if (hash.length <= 12) return hash
  return `${hash.slice(0, 8)}...${hash.slice(-4)}`
}

const statusStyle: Record<PrivacyHistoryStatus, string> = {
  pending: "bg-secondary/20 text-secondary",
  confirmed: "bg-success/20 text-success",
  failed: "bg-destructive/20 text-destructive",
}

export function PrivacyRouterPanel({ compact = false }: { compact?: boolean }) {
  const notifications = useNotifications()
  const [mode, setMode] = React.useState<"v2" | "v1">("v2")
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [history, setHistory] = React.useState<PrivacyHistoryItem[]>([])

  const [actionType, setActionType] = React.useState("")
  const [oldRoot, setOldRoot] = React.useState("")
  const [newRoot, setNewRoot] = React.useState("")
  const [nullifiers, setNullifiers] = React.useState("")
  const [commitments, setCommitments] = React.useState("")

  const [nullifier, setNullifier] = React.useState("")
  const [commitment, setCommitment] = React.useState("")

  const [publicInputs, setPublicInputs] = React.useState("")
  const [proof, setProof] = React.useState("")

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const raw = window.localStorage.getItem(HISTORY_KEY)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as PrivacyHistoryItem[]
      if (Array.isArray(parsed)) {
        setHistory(parsed)
      }
    } catch {
      // ignore corrupted cache
    }
  }, [])

  const persistHistory = (items: PrivacyHistoryItem[]) => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items))
  }

  const pushHistory = (entry: PrivacyHistoryItem) => {
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, 15)
      persistHistory(next)
      return next
    })
  }

  const updateHistoryStatus = (id: string, status: PrivacyHistoryStatus) => {
    setHistory((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, status } : item))
      persistHistory(next)
      return next
    })
  }

  const removeHistory = (id: string) => {
    setHistory((prev) => {
      const next = prev.filter((item) => item.id !== id)
      persistHistory(next)
      return next
    })
  }

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
      pushHistory({
        id: result.tx_hash,
        mode,
        actionType: mode === "v2" ? actionType : undefined,
        txHash: result.tx_hash,
        createdAt: new Date().toISOString(),
        status: "pending",
      })
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

        <div className="mt-6 border-t border-border/60 pt-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">History</h3>
            <span className="text-xs text-muted-foreground">{history.length} entries</span>
          </div>
          {history.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 p-4 text-xs text-muted-foreground">
              Belum ada submit proof. Setelah submit, riwayat akan muncul di sini.
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((item) => (
                <div key={item.id} className="rounded-xl border border-border bg-surface/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">{shortHash(item.txHash)}</span>
                      <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase", statusStyle[item.status])}>
                        {item.status}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary uppercase">
                        {item.mode}
                      </span>
                      {item.actionType && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {item.actionType}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString("id-ID")}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigator.clipboard.writeText(item.txHash)}
                    >
                      Copy TX
                    </Button>
                    {item.status !== "confirmed" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateHistoryStatus(item.id, "confirmed")}
                      >
                        Mark Confirmed
                      </Button>
                    )}
                    {item.status !== "failed" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateHistoryStatus(item.id, "failed")}
                      >
                        Mark Failed
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeHistory(item.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
