"use client"

import * as React from "react"
import { mutate } from "swr"
import { WS_BASE_URL } from "@/lib/api"
import { emitEvent } from "@/lib/events"
import { useWebSocket } from "@/hooks/system/use-websocket"

export type OrderUpdate = {
  type: "order_update"
  order_id: string
  status: string
  filled: string
  timestamp: number
}

type UseOrderUpdatesOptions = {
  enabled?: boolean
  onUpdate?: (update: OrderUpdate) => void
  invalidateSWR?: boolean
}

const isLimitOrdersKey = (key: unknown) =>
  Array.isArray(key) && key.length > 0 && key[0] === "limit-orders"

/**
 * Exposes `useOrderUpdates` as a reusable hook.
 *
 * @param options - Input used by `useOrderUpdates` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function useOrderUpdates(token?: string | null, options: UseOrderUpdatesOptions = {}) {
  const wsUrl = token
    ? `${WS_BASE_URL.replace(/\/$/, "")}/ws/orders?token=${encodeURIComponent(token)}`
    : null

  const onUpdateRef = React.useRef(options.onUpdate)
  React.useEffect(() => {
    onUpdateRef.current = options.onUpdate
  }, [options.onUpdate])

  return useWebSocket({
    url: wsUrl,
    enabled: options.enabled !== false && Boolean(token),
    onOpen: () => {
      emitEvent("ws:status", { channel: "orders", status: "connected" })
    },
    onClose: () => {
      emitEvent("ws:status", { channel: "orders", status: "disconnected" })
    },
    onError: () => {
      emitEvent("ws:status", { channel: "orders", status: "error", error: "WebSocket error" })
    },
    onMessage: (event) => {
      try {
        const payload = JSON.parse(event.data)
        if (payload?.type === "order_update") {
          onUpdateRef.current?.(payload as OrderUpdate)
          if (options.invalidateSWR !== false) {
            void mutate(isLimitOrdersKey, undefined, { revalidate: true })
          }
        }
      } catch {
        // ignore invalid payloads
      }
    },
  })
}
