"use client"

import * as React from "react"
import { useNotifications } from "@/hooks/use-notifications"
import { onEvent } from "@/lib/events"
import { getErrorMessage, ApiError } from "@/lib/errors"

const DEDUPE_WINDOW_MS = 20000

/**
 * Checks conditions for `shouldNotify`.
 *
 * @param key - Input used by `shouldNotify` to compute state, payload, or request behavior.
 * @param lastSeen - Input used by `shouldNotify` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function shouldNotify(key: string, lastSeen: Map<string, number>) {
  const now = Date.now()
  const last = lastSeen.get(key) || 0
  if (now - last < DEDUPE_WINDOW_MS) return false
  lastSeen.set(key, now)
  return true
}

/**
 * Checks conditions for `isIgnoredWindowErrorMessage`.
 *
 * @param message - Input used by `isIgnoredWindowErrorMessage` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function isIgnoredWindowErrorMessage(message: string) {
  const normalized = message.trim().toLowerCase()
  if (!normalized) return false
  return (
    normalized.includes("resizeobserver loop completed with undelivered notifications") ||
    normalized.includes("resizeobserver loop limit exceeded")
  )
}

/**
 * Handles `GlobalEventHandlers` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function GlobalEventHandlers() {
  const notifications = useNotifications()
  const lastSeenRef = React.useRef(new Map<string, number>())

  React.useEffect(() => {
    const unsubscribe = onEvent("api:error", ({ error, context, method, path }) => {
      const message = getErrorMessage(error)
      const key = `${method || "GET"}:${context || path}:${message}`
      if (!shouldNotify(key, lastSeenRef.current)) return

      const title = error instanceof ApiError && error.status
        ? `API Error (${error.status})`
        : "API Error"

      notifications.addNotification({
        type: "error",
        title,
        message: context ? `${context}: ${message}` : message,
      })
    })

    return () => unsubscribe()
  }, [notifications])

  React.useEffect(() => {
    const unsubscribe = onEvent("auth:expired", () => {
      const key = "auth:expired"
      if (!shouldNotify(key, lastSeenRef.current)) return
      notifications.addNotification({
        type: "warning",
        title: "Session expired",
        message: "Login token invalid/expired. Please reconnect your wallet.",
      })
    })

    return () => unsubscribe()
  }, [notifications])

  React.useEffect(() => {
    if (typeof window === "undefined") return

    /**
     * Handles `onUnhandledRejection` logic.
     *
     * @param event - Input used by `onUnhandledRejection` to compute state, payload, or request behavior.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const message = getErrorMessage(event.reason, "Unhandled promise rejection")
      if (isIgnoredWindowErrorMessage(message)) return
      const key = `unhandledrejection:${message}`
      if (!shouldNotify(key, lastSeenRef.current)) return
      notifications.addNotification({
        type: "error",
        title: "Unexpected error",
        message,
      })
    }

    /**
     * Handles `onError` logic.
     *
     * @param event - Input used by `onError` to compute state, payload, or request behavior.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const onError = (event: ErrorEvent) => {
      const message = event.message || "Unexpected error"
      if (isIgnoredWindowErrorMessage(message)) return
      const key = `windowerror:${message}`
      if (!shouldNotify(key, lastSeenRef.current)) return
      notifications.addNotification({
        type: "error",
        title: "Unexpected error",
        message,
      })
    }

    /**
     * Handles `onOffline` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const onOffline = () => {
      const key = "offline"
      if (!shouldNotify(key, lastSeenRef.current)) return
      notifications.addNotification({
        type: "warning",
        title: "Offline",
        message: "You are offline. Some data may be stale until connection returns.",
      })
    }

    /**
     * Handles `onOnline` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const onOnline = () => {
      const key = "online"
      if (!shouldNotify(key, lastSeenRef.current)) return
      notifications.addNotification({
        type: "success",
        title: "Back online",
        message: "Connection restored. Live data will refresh shortly.",
      })
    }

    window.addEventListener("unhandledrejection", onUnhandledRejection)
    window.addEventListener("error", onError)
    window.addEventListener("offline", onOffline)
    window.addEventListener("online", onOnline)

    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection)
      window.removeEventListener("error", onError)
      window.removeEventListener("offline", onOffline)
      window.removeEventListener("online", onOnline)
    }
  }, [notifications])

  return null
}
