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
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message || fallback
  return fallback
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
