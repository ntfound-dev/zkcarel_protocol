"use client"

import * as React from "react"
import { WS_BASE_URL } from "@/lib/api"
import { emitEvent } from "@/lib/events"
import { usePageVisibility } from "@/hooks/system/use-page-visibility"
import { useWebSocket } from "@/hooks/system/use-websocket"
import { usePriceStore } from "@/store/use-price-store"

/**
 * Handles `PriceStreamProvider` logic.
 *
 * @param children - Input used by `PriceStreamProvider` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function PriceStreamProvider({ children }: { children: React.ReactNode }) {
  const requestedTokens = usePriceStore((state) => state.requestedTokens)
  const setStatus = usePriceStore((state) => state.setStatus)
  const applyUpdate = usePriceStore((state) => state.applyUpdate)
  const isVisible = usePageVisibility()

  const tokensKey = React.useMemo(() => requestedTokens.join("|"), [requestedTokens])
  const wsUrl = requestedTokens.length
    ? `${WS_BASE_URL.replace(/\/$/, "")}/ws/prices`
    : null

  const { status, send } = useWebSocket({
    url: wsUrl,
    enabled: isVisible && requestedTokens.length > 0,
    onOpen: () => {
      emitEvent("ws:status", { channel: "prices", status: "connected" })
      send(
        JSON.stringify({
          type: "subscribe",
          tokens: requestedTokens,
        })
      )
    },
    onClose: () => {
      emitEvent("ws:status", { channel: "prices", status: "disconnected" })
    },
    onError: () => {
      emitEvent("ws:status", { channel: "prices", status: "error", error: "WebSocket error" })
    },
    onMessage: (event) => {
      try {
        const payload = JSON.parse(event.data)
        if (payload?.type === "price_update") {
          applyUpdate(payload)
        }
      } catch {
        // ignore invalid payloads
      }
    },
  })

  React.useEffect(() => {
    setStatus(status)
  }, [setStatus, status])

  React.useEffect(() => {
    if (status !== "open" || requestedTokens.length === 0) return
    send(
      JSON.stringify({
        type: "subscribe",
        tokens: requestedTokens,
      })
    )
  }, [status, tokensKey, requestedTokens, send])

  return <>{children}</>
}
