"use client"

import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from "react"
import {
  WS_BASE_URL,
  getNotifications,
  markNotificationsRead,
  type BackendNotification,
} from "@/lib/api"
import { useWallet } from "@/hooks/use-wallet"

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

const fallbackNotifications: Notification[] = [
  {
    id: 1,
    type: "success",
    title: "Swap Berhasil",
    message: "Swap 0.5 ETH ke 1,250 USDT berhasil",
    timestamp: new Date(Date.now() - 1000 * 60 * 5),
    read: false,
    txHash: "0xabc...123",
  },
  {
    id: 2,
    type: "info",
    title: "Bridge Dimulai",
    message: "Bridge 500 USDC dari Ethereum ke Arbitrum",
    timestamp: new Date(Date.now() - 1000 * 60 * 30),
    read: true,
    txHash: "0xdef...456",
  },
]

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet()
  const [notifications, setNotifications] = useState<Notification[]>(fallbackNotifications)

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
        // keep fallback
      }
    })()

    return () => {
      active = false
    }
  }, [wallet.isConnected, wallet.token])

  useEffect(() => {
    if (typeof window === "undefined") return
    const token = wallet.token || window.localStorage.getItem("auth_token")
    if (!token) return
    const wsUrl = `${WS_BASE_URL.replace(/\/$/, "")}/ws/notifications?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        if (payload?.notif_type) {
          const mapped = mapBackendNotification(payload)
          setNotifications((prev) => [mapped, ...prev])
        }
      } catch {
        // ignore invalid payloads
      }
    }

    return () => {
      ws.close()
    }
  }, [wallet.token])

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
