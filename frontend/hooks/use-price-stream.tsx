"use client"

import * as React from "react"
import { WS_BASE_URL } from "@/lib/api"
import { emitEvent } from "@/lib/events"
import { useWebSocket } from "@/hooks/use-websocket"

export type PriceUpdate = {
  token: string
  price: number
  change_24h: number
  timestamp: number
}

type UsePriceStreamOptions = {
  enabled?: boolean
}

/**
 * Exposes `usePriceStream` as a reusable hook.
 *
 * @param tokens - Input used by `usePriceStream` to compute state, payload, or request behavior.
 * @param options - Input used by `usePriceStream` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function usePriceStream(tokens: string[], options: UsePriceStreamOptions = {}) {
  const [prices, setPrices] = React.useState<Record<string, number>>({})
  const [changes, setChanges] = React.useState<Record<string, number>>({})

  const uniqueTokens = React.useMemo(
    () => Array.from(new Set(tokens.map((t) => t.toUpperCase()))),
    [tokens]
  )

  const wsUrl = uniqueTokens.length
    ? `${WS_BASE_URL.replace(/\/$/, "")}/ws/prices`
    : null

  const { status, send } = useWebSocket({
    url: wsUrl,
    enabled: options.enabled !== false && uniqueTokens.length > 0,
    onOpen: () => {
      emitEvent("ws:status", { channel: "prices", status: "connected" })
      send(
        JSON.stringify({
          type: "subscribe",
          tokens: uniqueTokens,
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
          const update: PriceUpdate = payload
          const symbol = update.token.toUpperCase()
          if (Number.isFinite(update.price)) {
            setPrices((prev) => ({ ...prev, [symbol]: update.price }))
          }
          if (Number.isFinite(update.change_24h)) {
            setChanges((prev) => ({ ...prev, [symbol]: update.change_24h }))
          }
        }
      } catch {
        // ignore invalid payloads
      }
    },
  })

  React.useEffect(() => {
    if (status !== "open" || uniqueTokens.length === 0) return
    send(
      JSON.stringify({
        type: "subscribe",
        tokens: uniqueTokens,
      })
    )
  }, [status, uniqueTokens.join("|"), send])

  return { prices, changes, status }
}
