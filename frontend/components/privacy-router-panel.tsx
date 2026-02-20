"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { ShieldCheck, Send, Database, Hash } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  submitPrivacyAction,
  type PrivacyActionPayload,
  type PrivacyVerificationPayload,
} from "@/lib/api"
import { useNotifications } from "@/hooks/use-notifications"

/**
 * Parses or transforms values for `parseList`.
 *
 * @param value - Input used by `parseList` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const parseList = (value: string) =>
  value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

/**
 * Checks conditions for `isDummyGaragaPayload`.
 *
 * @param proof - Input used by `isDummyGaragaPayload` to compute state, payload, or request behavior.
 * @param publicInputs - Input used by `isDummyGaragaPayload` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const isDummyGaragaPayload = (proof: string[], publicInputs: string[]) => {
  if (proof.length !== 1 || publicInputs.length !== 1) return false
  return proof[0].toLowerCase() === "0x1" && publicInputs[0].toLowerCase() === "0x1"
}

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
const TRADE_PRIVACY_PAYLOAD_KEY = "trade_privacy_garaga_payload_v1"

/**
 * Handles `shortHash` logic.
 *
 * @param hash - Input used by `shortHash` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
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

/**
 * Handles `PrivacyRouterPanel` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
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

  /**
   * Handles `persistHistory` logic.
   *
   * @param items - Input used by `persistHistory` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const persistHistory = (items: PrivacyHistoryItem[]) => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items))
  }

  /**
   * Handles `pushHistory` logic.
   *
   * @param entry - Input used by `pushHistory` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const pushHistory = (entry: PrivacyHistoryItem) => {
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, 15)
      persistHistory(next)
      return next
    })
  }

  /**
   * Updates state for `updateHistoryStatus`.
   *
   * @param id - Input used by `updateHistoryStatus` to compute state, payload, or request behavior.
   * @param status - Input used by `updateHistoryStatus` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const updateHistoryStatus = (id: string, status: PrivacyHistoryStatus) => {
    setHistory((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, status } : item))
      persistHistory(next)
      return next
    })
  }

  /**
   * Handles `removeHistory` logic.
   *
   * @param id - Input used by `removeHistory` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const removeHistory = (id: string) => {
    setHistory((prev) => {
      const next = prev.filter((item) => item.id !== id)
      persistHistory(next)
      return next
    })
  }

  const buildTradePrivacyPayload = (
    payload: PrivacyActionPayload
  ): PrivacyVerificationPayload | null => {
    const proof = Array.isArray(payload.proof)
      ? payload.proof.map((item) => item.trim()).filter((item) => item.length > 0)
      : []
    const publicInputs = Array.isArray(payload.public_inputs)
      ? payload.public_inputs
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : []
    if (!proof.length || !publicInputs.length) return null
    if (isDummyGaragaPayload(proof, publicInputs)) return null

    const nullifier =
      payload.nullifier?.trim() ||
      payload.nullifiers?.find((item) => item.trim().length > 0)?.trim()
    const commitment =
      payload.commitment?.trim() ||
      payload.commitments?.find((item) => item.trim().length > 0)?.trim()
    if (!nullifier || !commitment) return null

    return {
      verifier: "garaga",
      nullifier,
      commitment,
      proof,
      public_inputs: publicInputs,
    }
  }

  /**
   * Handles `handleSubmit` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleSubmit = async () => {
    const parsedProof = parseList(proof)
    const parsedPublicInputs = parseList(publicInputs)
    if (!parsedProof.length || !parsedPublicInputs.length) {
      notifications.addNotification({
        type: "error",
        title: "Payload belum lengkap",
        message: "proof dan public_inputs wajib diisi (bukan kosong).",
      })
      return
    }
    if (isDummyGaragaPayload(parsedProof, parsedPublicInputs)) {
      notifications.addNotification({
        type: "error",
        title: "Dummy proof ditolak",
        message:
          "Payload Garaga dummy (proof/public_inputs = 0x1) tidak diizinkan di mode strict. Masukkan proof real.",
      })
      return
    }

    const shared: Pick<PrivacyActionPayload, "proof" | "public_inputs"> = {
      proof: parsedProof,
      public_inputs: parsedPublicInputs,
    }

    let payload: PrivacyActionPayload
    if (mode === "v2") {
      const parsedNullifiers = parseList(nullifiers)
      const parsedCommitments = parseList(commitments)
      if (!actionType || !oldRoot || !newRoot) {
        notifications.addNotification({
          type: "error",
          title: "Privacy V2",
          message: "action_type, old_root, dan new_root wajib diisi.",
        })
        return
      }
      if (!parsedNullifiers.length || !parsedCommitments.length) {
        notifications.addNotification({
          type: "error",
          title: "Privacy V2",
          message: "nullifiers dan commitments wajib diisi minimal 1 item.",
        })
        return
      }
      payload = {
        action_type: actionType,
        old_root: oldRoot,
        new_root: newRoot,
        nullifiers: parsedNullifiers,
        commitments: parsedCommitments,
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
      const tradePayload = buildTradePrivacyPayload(payload)
      if (tradePayload && typeof window !== "undefined") {
        window.localStorage.setItem(
          TRADE_PRIVACY_PAYLOAD_KEY,
          JSON.stringify(tradePayload)
        )
        window.dispatchEvent(new Event("trade-privacy-payload-updated"))
        notifications.addNotification({
          type: "success",
          title: "Trade payload updated",
          message: "Hide Balance payload saved for Unified Trade.",
        })
      } else {
        notifications.addNotification({
          type: "info",
          title: "Trade payload not updated",
          message:
            mode === "v2"
              ? "V2 submitted, tapi payload trade tidak tersimpan. Pastikan nullifiers, commitments, proof, dan public_inputs valid (bukan dummy)."
              : "V1 submitted, tapi payload trade tidak tersimpan. Pastikan nullifier, commitment, proof, dan public_inputs valid (bukan dummy).",
        })
      }
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
        message: error instanceof Error ? error.message : "Failed to submit privacy action.",
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
              <p>Use this if the V2 router has not been deployed yet.</p>
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
            Payload will be routed to the active backend router.
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
              No proof submissions yet. History will appear here after your first submission.
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
