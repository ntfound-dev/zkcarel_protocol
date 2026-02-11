"use client"

import * as React from "react"
import { WS_BASE_URL } from "@/lib/api"
import { emitEvent } from "@/lib/events"
import { useWebSocket } from "@/hooks/use-websocket"

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
}

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
        }
      } catch {
        // ignore invalid payloads
      }
    },
  })
}
