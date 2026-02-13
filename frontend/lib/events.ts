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
