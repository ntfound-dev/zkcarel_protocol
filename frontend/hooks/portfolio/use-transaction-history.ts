"use client"

import * as React from "react"
import { getTransactionsHistory, type Transaction } from "@/lib/api"
import {
  AI_TRANSACTION_SOURCES_UPDATED_EVENT,
  loadAiTransactionSourceIds,
} from "@/lib/ai-execution-source"
import type { UiTransaction } from "@/lib/portfolio-utils"

type TxSummary = {
  pending: number
  inbound: number
  outbound: number
  hide: number
}

type UseTransactionHistoryParams = {
  enabled: boolean
}

export function useTransactionHistory({ enabled }: UseTransactionHistoryParams) {
  const [transactions, setTransactions] = React.useState<UiTransaction[]>([])
  const [aiTxSourceVersion, setAiTxSourceVersion] = React.useState(0)

  React.useEffect(() => {
    const handleAiTxSourceUpdated = () => {
      setAiTxSourceVersion((current) => current + 1)
    }
    window.addEventListener(AI_TRANSACTION_SOURCES_UPDATED_EVENT, handleAiTxSourceUpdated)
    return () => {
      window.removeEventListener(AI_TRANSACTION_SOURCES_UPDATED_EVENT, handleAiTxSourceUpdated)
    }
  }, [])

  React.useEffect(() => {
    if (!enabled) return
    let active = true
    let pollingTimer: number | undefined

    /**
     * Parses or transforms values for `formatRelativeTime`.
     *
     * @param iso - Input used by `formatRelativeTime` to compute state, payload, or request behavior.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const formatRelativeTime = (iso: string) => {
      const date = new Date(iso)
      const timeMs = date.getTime()
      if (!Number.isFinite(timeMs) || Number.isNaN(timeMs)) return "—"
      const safeDiffMs = Math.max(0, Date.now() - timeMs)
      const minutes = Math.floor(safeDiffMs / 60000)
      if (minutes < 1) return "just now"
      if (minutes < 60) return `${minutes} min ago`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
      const days = Math.floor(hours / 24)
      return `${days} day${days === 1 ? "" : "s"} ago`
    }

    /**
     * Parses or transforms values for `parseNumber`.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const parseNumber = (value?: string | number | null) => {
      if (value === null || value === undefined) return 0
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : 0
    }

    /**
     * Handles `loadTransactions` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const loadTransactions = async () => {
      try {
        const response = await getTransactionsHistory({ page: 1, limit: 20 })
        if (!active) return
        const aiTxSourceIds = loadAiTransactionSourceIds()
        const mapped: UiTransaction[] = response.items.map((tx: Transaction) => {
          const txType = (tx.tx_type || "").trim()
          const txTypeLower = txType.toLowerCase()
          const blockNumber = Number(tx.block_number || 0)
          const hasOnchainBlock = Number.isFinite(blockNumber) && blockNumber > 0
          const isCompleted = hasOnchainBlock || Boolean(tx.processed)
          const tokenLabel = tx.token_out ? `${tx.token_in || ""} → ${tx.token_out}` : tx.token_in || tx.tx_type
          const amountIn = parseNumber(tx.amount_in)
          const amountOut = parseNumber(tx.amount_out)
          const amount = parseNumber(tx.amount_in || tx.amount_out || 0)
          const usdValue = parseNumber(tx.usd_value)
          const tokenIn = String(tx.token_in || "").toUpperCase()
          const tokenOut = String(tx.token_out || "").toUpperCase()
          const visibility: UiTransaction["visibility"] = txTypeLower.includes("private") ? "Hide" : "Public"
          const normalizedTxHash = String(tx.tx_hash || "").trim().toLowerCase()
          return {
            id: tx.tx_hash,
            type: txType.toUpperCase(),
            asset: tokenLabel.trim() || tx.tx_type,
            amount: amount ? amount.toString() : "—",
            value: usdValue ? `$${usdValue.toLocaleString()}` : "—",
            time: formatRelativeTime(tx.timestamp),
            status: isCompleted ? "Completed" : "Pending",
            visibility,
            requestSource: aiTxSourceIds.has(normalizedTxHash) ? "ai" : "manual",
            amountIn,
            amountOut,
            tokenIn,
            tokenOut,
            usdValue,
          }
        })
        setTransactions(mapped)
      } catch {
        if (!active) return
        setTransactions([])
      }
    }

    void loadTransactions()
    pollingTimer = window.setInterval(() => {
      void loadTransactions()
    }, 12000)

    return () => {
      active = false
      if (pollingTimer) window.clearInterval(pollingTimer)
    }
  }, [aiTxSourceVersion, enabled])

  const txSummary = React.useMemo<TxSummary>(() => {
    const pending = transactions.filter((tx) => tx.status === "Pending").length
    const inbound = transactions.filter((tx) => tx.amountOut > 0).length
    const outbound = transactions.filter((tx) => tx.amountIn > 0).length
    const hide = transactions.filter((tx) => tx.visibility === "Hide").length
    return { pending, inbound, outbound, hide }
  }, [transactions])

  return { transactions, txSummary }
}
