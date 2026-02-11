"use client"

import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from "react"
import {
  WS_BASE_URL,
  getNotifications,
  markNotificationsRead,
  type BackendNotification,
} from "@/lib/api"
import { useWallet } from "@/hooks/use-wallet"
import { emitEvent } from "@/lib/events"
import { useWebSocket } from "@/hooks/use-websocket"

export interface Notification {
  id: number
  type: "success" | "error" | "warning" | "info"
  title: string
  message: string
  timestamp: Date
  read: boolean
  txHash?: string
}

interface NotificationsContextType {
  notifications: Notification[]
  unreadCount: number
  addNotification: (notification: Omit<Notification, "id" | "timestamp" | "read">) => void
  markAsRead: (id: number) => void
  markAllAsRead: () => void
  clearNotification: (id: number) => void
  clearAll: () => void
}

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined)

function mapNotifType(kind?: string | null): Notification["type"] {
  if (!kind) return "info"
  if (kind.includes("failed") || kind.includes("error")) return "error"
  if (kind.includes("completed") || kind.includes("success")) return "success"
  if (kind.includes("warning")) return "warning"
  return "info"
}

function mapBackendNotification(notification: BackendNotification): Notification {
  return {
    id: notification.id,
    type: mapNotifType(notification.notif_type),
    title: notification.title,
    message: notification.message,
    timestamp: new Date(notification.created_at),
    read: notification.read,
    txHash: typeof notification.data?.tx_hash === "string" ? notification.data?.tx_hash : undefined,
  }
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet()
  const [notifications, setNotifications] = useState<Notification[]>([])

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  )

  useEffect(() => {
    if (!wallet.isConnected) return
    let active = true
    ;(async () => {
      try {
        const data = await getNotifications(1, 20)
        if (!active) return
        setNotifications(data.items.map(mapBackendNotification))
      } catch {
        // keep empty
      }
    })()

    return () => {
      active = false
    }
  }, [wallet.isConnected, wallet.token])

  const token = typeof window !== "undefined"
    ? wallet.token || window.localStorage.getItem("auth_token")
    : wallet.token

  const wsUrl = token
    ? `${WS_BASE_URL.replace(/\/$/, "")}/ws/notifications?token=${encodeURIComponent(token)}`
    : null

  useWebSocket({
    url: wsUrl,
    enabled: Boolean(token),
    onOpen: () => {
      emitEvent("ws:status", { channel: "notifications", status: "connected" })
    },
    onClose: () => {
      emitEvent("ws:status", { channel: "notifications", status: "disconnected" })
    },
    onError: () => {
      emitEvent("ws:status", { channel: "notifications", status: "error", error: "WebSocket error" })
    },
    onMessage: (event) => {
      try {
        const payload = JSON.parse(event.data)
        if (payload?.notif_type) {
          const mapped = mapBackendNotification(payload)
          setNotifications((prev) => [mapped, ...prev])
        }
      } catch {
        // ignore invalid payloads
      }
    },
  })

  const addNotification = useCallback(
    (notification: Omit<Notification, "id" | "timestamp" | "read">) => {
      const newNotification: Notification = {
        ...notification,
        id: Math.floor(Math.random() * 1000000),
        timestamp: new Date(),
        read: false,
      }
      setNotifications((prev) => [newNotification, ...prev])
    },
    []
  )

  const markAsRead = useCallback((id: number) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    )
    markNotificationsRead([id]).catch(() => undefined)
  }, [])

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    markNotificationsRead([]).catch(() => undefined)
  }, [])

  const clearNotification = useCallback((id: number) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    setNotifications([])
  }, [])

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        unreadCount,
        addNotification,
        markAsRead,
        markAllAsRead,
        clearNotification,
        clearAll,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  const context = useContext(NotificationsContext)
  if (context === undefined) {
    throw new Error("useNotifications must be used within a NotificationsProvider")
  }
  return context
}
