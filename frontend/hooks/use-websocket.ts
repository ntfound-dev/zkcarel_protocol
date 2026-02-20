"use client"

import * as React from "react"

export type WebSocketStatus = "idle" | "connecting" | "open" | "closed" | "error"

type WebSocketOptions = {
  url?: string | null
  protocols?: string | string[]
  enabled?: boolean
  reconnect?: boolean
  reconnectIntervalMs?: number
  maxReconnectAttempts?: number
  onMessage?: (event: MessageEvent) => void
  onOpen?: () => void
  onClose?: (event: CloseEvent) => void
  onError?: (event: Event) => void
}

/**
 * Exposes `useWebSocket` as a reusable hook.
 *
 * @param options - Input used by `useWebSocket` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function useWebSocket(options: WebSocketOptions) {
  const {
    url,
    protocols,
    enabled = true,
    reconnect = true,
    reconnectIntervalMs = 2000,
    maxReconnectAttempts = 6,
    onMessage,
    onOpen,
    onClose,
    onError,
  } = options

  const [status, setStatus] = React.useState<WebSocketStatus>("idle")
  const socketRef = React.useRef<WebSocket | null>(null)
  const handlersRef = React.useRef({ onMessage, onOpen, onClose, onError })
  const reconnectTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttempts = React.useRef(0)
  const closedRef = React.useRef(false)

  React.useEffect(() => {
    handlersRef.current = { onMessage, onOpen, onClose, onError }
  }, [onMessage, onOpen, onClose, onError])

  React.useEffect(() => {
    if (!enabled || !url || typeof window === "undefined") {
      if (socketRef.current) {
        socketRef.current.close()
        socketRef.current = null
      }
      setStatus("idle")
      return
    }

    closedRef.current = false

    /**
     * Runs `connect` and handles related side effects.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const connect = () => {
      if (closedRef.current || !url) return
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) return

      setStatus("connecting")
      const ws = new WebSocket(url, protocols)
      socketRef.current = ws

      ws.onopen = () => {
        reconnectAttempts.current = 0
        setStatus("open")
        handlersRef.current.onOpen?.()
      }

      ws.onmessage = (event) => {
        handlersRef.current.onMessage?.(event)
      }

      ws.onerror = (event) => {
        setStatus((prev) => (prev === "error" ? prev : "error"))
        handlersRef.current.onError?.(event)
      }

      ws.onclose = (event) => {
        setStatus("closed")
        handlersRef.current.onClose?.(event)
        if (!reconnect || closedRef.current) return
        if (reconnectAttempts.current >= maxReconnectAttempts) return
        reconnectAttempts.current += 1
        const delay = Math.min(reconnectIntervalMs * 2 ** (reconnectAttempts.current - 1), 15000)
        reconnectTimer.current = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      closedRef.current = true
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
      if (socketRef.current) {
        socketRef.current.close()
        socketRef.current = null
      }
    }
  }, [url, protocols, enabled, reconnect, reconnectIntervalMs, maxReconnectAttempts])

  const send = React.useCallback((data: string) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return false
    socketRef.current.send(data)
    return true
  }, [])

  return {
    status,
    isConnected: status === "open",
    send,
    socket: socketRef.current,
  }
}
