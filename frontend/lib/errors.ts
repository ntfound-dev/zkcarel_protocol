export type ApiErrorMeta = {
  status?: number
  code?: string
  path?: string
  method?: string
  details?: unknown
}

export class ApiError extends Error {
  status?: number
  code?: string
  path?: string
  method?: string
  details?: unknown

  constructor(message: string, meta: ApiErrorMeta = {}) {
    super(message)
    this.name = "ApiError"
    this.status = meta.status
    this.code = meta.code
    this.path = meta.path
    this.method = meta.method
    this.details = meta.details
  }
}

// Internal helper that supports `normalizeKnownErrorMessage` operations.
function normalizeKnownErrorMessage(message: string) {
  const raw = (message || "").trim()
  if (!raw) return raw

  if (
    /(entrypoint_not_found|entrypoint not found|requested entrypoint does not exist|entrypoint does not exist)/i.test(
      raw
    )
  ) {
    return "Kontrak on-chain tidak cocok (entrypoint tidak ditemukan). Restart backend/frontend dan pastikan BATTLESHIP_GARAGA_ADDRESS mengarah ke kontrak Battleship terbaru."
  }

  if (/onchain_tx_hash sender mismatch/i.test(raw)) {
    return "Wallet yang sign tx berbeda dengan wallet yang terhubung saat request. Refresh halaman, reconnect wallet yang benar, lalu coba lagi."
  }

  return raw
}

/**
 * Handles `toApiError` logic.
 *
 * @param error - Input used by `toApiError` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function toApiError(error: unknown, fallback = "Request failed"): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof Error) {
    return new ApiError(error.message || fallback)
  }
  if (typeof error === "string") {
    return new ApiError(error)
  }
  return new ApiError(fallback)
}

/**
 * Fetches data for `getErrorMessage`.
 *
 * @param error - Input used by `getErrorMessage` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function getErrorMessage(error: unknown, fallback = "Request failed") {
  if (!error) return fallback
  if (typeof error === "string") return normalizeKnownErrorMessage(error)
  if (error instanceof Error) {
    const msg = error.message || fallback
    return normalizeKnownErrorMessage(msg)
  }
  return normalizeKnownErrorMessage(fallback)
}

/**
 * Checks conditions for `isNetworkError`.
 *
 * @param error - Input used by `isNetworkError` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function isNetworkError(error: unknown) {
  if (!error) return false
  if (error instanceof ApiError) {
    return error.code === "NETWORK_ERROR" || error.code === "TIMEOUT"
  }
  return false
}
