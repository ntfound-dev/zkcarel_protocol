export type ApiErrorEvent = {
  error: Error
  context?: string
  path?: string
  method?: string
}

export type WebSocketStatusEvent = {
  channel: string
  status: "connected" | "disconnected" | "error"
  error?: string
}

export type WalletEvent = {
  address?: string | null
  provider?: string | null
}

export type AuthExpiredEvent = {
  reason: "invalid_or_expired_token"
  message?: string
  path?: string
}

export type AppEvents = {
  "api:error": ApiErrorEvent
  "ws:status": WebSocketStatusEvent
  "wallet:connected": WalletEvent
  "wallet:disconnected": WalletEvent
  "auth:expired": AuthExpiredEvent
}

type Handler<T> = (payload: T) => void

const listeners = new Map<keyof AppEvents, Set<Handler<any>>>()

/**
 * Handles `onEvent` logic.
 *
 * @param type - Event channel key used to select listener group.
 * @param handler - Callback invoked whenever payload is emitted for `type`.
 * @returns Cleanup function that unsubscribes the provided handler.
 * @remarks Centralizes event-bus subscriptions used by UI and API helpers.
 */
export function onEvent<K extends keyof AppEvents>(type: K, handler: Handler<AppEvents[K]>) {
  const set = listeners.get(type) || new Set<Handler<any>>()
  set.add(handler)
  listeners.set(type, set)
  return () => {
    set.delete(handler)
    if (set.size === 0) {
      listeners.delete(type)
    }
  }
}

/**
 * Handles `emitEvent` logic.
 *
 * @param type - Event channel key to dispatch.
 * @param payload - Typed event payload sent to all active handlers.
 * @returns No direct return value; this dispatches side effects to registered handlers.
 * @remarks Handler exceptions are isolated with try/catch to keep bus delivery resilient.
 */
export function emitEvent<K extends keyof AppEvents>(type: K, payload: AppEvents[K]) {
  const set = listeners.get(type)
  if (!set || set.size === 0) return
  for (const handler of set) {
    try {
      handler(payload)
    } catch (error) {
      console.error("Event handler failed", error)
    }
  }
}
