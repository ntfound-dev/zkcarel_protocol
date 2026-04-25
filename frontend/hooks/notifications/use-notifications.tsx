"use client"

import * as React from "react"
import { useEffect, type ReactNode } from "react"
import { create } from "zustand"
import {
  WS_BASE_URL,
  getNotifications,
  markNotificationsRead,
  type BackendNotification,
} from "@/lib/api"
import {
  BTC_TESTNET_EXPLORER_BASE_URL,
  ETHERSCAN_SEPOLIA_BASE_URL,
  STARKSCAN_SEPOLIA_BASE_URL,
} from "@/lib/network-config"
import { useWallet } from "@/hooks/wallet/use-wallet"
import { emitEvent } from "@/lib/events"
import { useWebSocket } from "@/hooks/system/use-websocket"

type TxNetwork = "starknet" | "evm" | "btc"

export interface TxExplorerLink {
  label: string
  url: string
}

export interface Notification {
  id: number
  type: "success" | "error" | "warning" | "info"
  title: string
  message: string
  timestamp: Date
  read: boolean
  txHash?: string
  txNetwork?: TxNetwork
  txExplorerUrls?: TxExplorerLink[]
}

type NotificationsStore = {
  notifications: Notification[]
  unreadCount: number
  setNotifications: (items: Notification[]) => void
  prependNotification: (notification: Notification) => void
  addNotification: (notification: Omit<Notification, "id" | "timestamp" | "read">) => void
  markAsRead: (id: number) => void
  markAllAsRead: () => void
  clearNotification: (id: number) => void
  clearAll: () => void
}

const DEDUPE_WINDOW_MS = 8000
const DEDUPE_CLEANUP_AFTER_MS = 120000
const DEDUPE_MAX_SIZE = 256
const dedupeMap = new Map<string, number>()

/**
 * Handles `mapNotifType` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function mapNotifType(kind?: string | null): Notification["type"] {
  if (!kind) return "info"
  if (kind.includes("failed") || kind.includes("error")) return "error"
  if (kind.includes("completed") || kind.includes("success")) return "success"
  if (kind.includes("warning")) return "warning"
  return "info"
}

/**
 * Parses or transforms values for `normalizeTxNetwork`.
 *
 * @param raw - Input used by `normalizeTxNetwork` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function normalizeTxNetwork(raw: unknown): TxNetwork | undefined {
  if (typeof raw !== "string") return undefined
  const normalized = raw.trim().toLowerCase()
  if (normalized === "starknet" || normalized === "sn") return "starknet"
  if (normalized === "evm" || normalized === "ethereum" || normalized === "eth") return "evm"
  if (normalized === "btc" || normalized === "bitcoin") return "btc"
  return undefined
}

/**
 * Builds inputs required by `buildTxExplorerUrls`.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function buildTxExplorerUrls(txHash?: string, txNetwork?: TxNetwork): TxExplorerLink[] | undefined {
  if (!txHash) return undefined
  if (txNetwork === "starknet") {
    return [
      {
        label: "Open Explorer",
        url: `${STARKSCAN_SEPOLIA_BASE_URL}/tx/${txHash}`,
      },
    ]
  }
  if (txNetwork === "evm") {
    return [
      {
        label: "Open Etherscan",
        url: `${ETHERSCAN_SEPOLIA_BASE_URL}/tx/${txHash}`,
      },
    ]
  }
  if (txNetwork === "btc") {
    const btcHash = txHash.startsWith("0x") ? txHash.slice(2) : txHash
    return [
      {
        label: "Open Mempool",
        url: `${BTC_TESTNET_EXPLORER_BASE_URL}/tx/${btcHash}`,
      },
    ]
  }
  return [
    {
      label: "Open Explorer",
      url: `${STARKSCAN_SEPOLIA_BASE_URL}/tx/${txHash}`,
    },
  ]
}

/**
 * Handles `mapBackendNotification` logic.
 *
 * @param notification - Input used by `mapBackendNotification` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function mapBackendNotification(notification: BackendNotification): Notification {
  const txHash = typeof notification.data?.tx_hash === "string" ? notification.data?.tx_hash : undefined
  const txNetwork = normalizeTxNetwork(notification.data?.tx_network ?? notification.data?.tx_chain)
  return {
    id: notification.id,
    type: mapNotifType(notification.notif_type),
    title: notification.title,
    message: notification.message,
    timestamp: new Date(notification.created_at),
    read: notification.read,
    txHash,
    txNetwork,
    txExplorerUrls: buildTxExplorerUrls(txHash, txNetwork),
  }
}

const computeUnreadCount = (items: Notification[]) => items.filter((n) => !n.read).length

const useNotificationStore = create<NotificationsStore>((set) => ({
  notifications: [],
  unreadCount: 0,
  setNotifications: (items) =>
    set({
      notifications: items,
      unreadCount: computeUnreadCount(items),
    }),
  prependNotification: (notification) =>
    set((state) => {
      const next = [notification, ...state.notifications]
      return { notifications: next, unreadCount: computeUnreadCount(next) }
    }),
  addNotification: (notification) =>
    set((state) => {
      const dedupeKey = [
        notification.type,
        notification.title.trim().toLowerCase(),
        notification.message.trim().toLowerCase(),
        (notification.txHash || "").trim().toLowerCase(),
      ].join("|")
      const now = Date.now()
      const lastSeen = dedupeMap.get(dedupeKey) || 0
      if (now - lastSeen < DEDUPE_WINDOW_MS) {
        return state
      }
      dedupeMap.set(dedupeKey, now)
      if (dedupeMap.size > DEDUPE_MAX_SIZE) {
        for (const [key, ts] of dedupeMap.entries()) {
          if (now - ts > DEDUPE_CLEANUP_AFTER_MS) {
            dedupeMap.delete(key)
          }
        }
      }

      const txExplorerUrls =
        notification.txExplorerUrls && notification.txExplorerUrls.length > 0
          ? notification.txExplorerUrls
          : buildTxExplorerUrls(notification.txHash, notification.txNetwork)
      const newNotification: Notification = {
        ...notification,
        id: Math.floor(Math.random() * 1000000),
        timestamp: new Date(),
        read: false,
        txExplorerUrls,
      }
      const next = [newNotification, ...state.notifications]
      return { notifications: next, unreadCount: computeUnreadCount(next) }
    }),
  markAsRead: (id) => {
    set((state) => {
      const next = state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n))
      return { notifications: next, unreadCount: computeUnreadCount(next) }
    })
    markNotificationsRead([id]).catch(() => undefined)
  },
  markAllAsRead: () => {
    set((state) => {
      const next = state.notifications.map((n) => ({ ...n, read: true }))
      return { notifications: next, unreadCount: 0 }
    })
    markNotificationsRead([]).catch(() => undefined)
  },
  clearNotification: (id) =>
    set((state) => {
      const next = state.notifications.filter((n) => n.id !== id)
      return { notifications: next, unreadCount: computeUnreadCount(next) }
    }),
  clearAll: () => set({ notifications: [], unreadCount: 0 }),
}))

/**
 * Handles `NotificationsProvider` logic.
 *
 * @param children - Input used by `NotificationsProvider` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet((state) => ({ isConnected: state.isConnected, token: state.token }))
  const setNotifications = useNotificationStore((state) => state.setNotifications)
  const prependNotification = useNotificationStore((state) => state.prependNotification)

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
  }, [wallet.isConnected, wallet.token, setNotifications])

  const token =
    typeof window !== "undefined"
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
          prependNotification(mapped)
        }
      } catch {
        // ignore invalid payloads
      }
    },
  })

  return <>{children}</>
}

/**
 * Exposes `useNotifications` as a reusable hook.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function useNotifications() {
  const storeState = useNotificationStore((state) => state)
  return React.useMemo(
    () => ({
      addNotification: storeState.addNotification,
      markAsRead: storeState.markAsRead,
      markAllAsRead: storeState.markAllAsRead,
      clearNotification: storeState.clearNotification,
      clearAll: storeState.clearAll,
    }),
    [
      storeState.addNotification,
      storeState.markAsRead,
      storeState.markAllAsRead,
      storeState.clearNotification,
      storeState.clearAll,
    ]
  )
}

export function useNotificationsState() {
  const storeState = useNotificationStore((state) => state)
  return React.useMemo(
    () => ({
      notifications: storeState.notifications,
      unreadCount: storeState.unreadCount,
      addNotification: storeState.addNotification,
      markAsRead: storeState.markAsRead,
      markAllAsRead: storeState.markAllAsRead,
      clearNotification: storeState.clearNotification,
      clearAll: storeState.clearAll,
    }),
    [
      storeState.notifications,
      storeState.unreadCount,
      storeState.addNotification,
      storeState.markAsRead,
      storeState.markAllAsRead,
      storeState.clearNotification,
      storeState.clearAll,
    ]
  )
}
