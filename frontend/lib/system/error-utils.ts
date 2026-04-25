const DEDUPE_WINDOW_MS = 20_000

/**
 * Checks conditions for `shouldNotify`.
 *
 * @param key - Input used by `shouldNotify` to compute state, payload, or request behavior.
 * @param lastSeen - Input used by `shouldNotify` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export const shouldNotify = (key: string, lastSeen: Map<string, number>) => {
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
export const isIgnoredWindowErrorMessage = (message: string) => {
  const normalized = message.trim().toLowerCase()
  if (!normalized) return false
  return (
    normalized.includes("resizeobserver loop completed with undelivered notifications") ||
    normalized.includes("resizeobserver loop limit exceeded")
  )
}
