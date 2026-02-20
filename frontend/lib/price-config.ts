export type PriceSource = "ws" | "coingecko" | "fallback"

export const DEFAULT_COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  STRK: "starknet",
  USDC: "usd-coin",
  USDT: "tether",
  WBTC: "wrapped-bitcoin",
}

export const DEFAULT_FALLBACK_PRICES: Record<string, number> = {
  USDC: 1,
  USDT: 1,
  CAREL: 1,
}

/**
 * Parses or transforms values for `parseKeyValueMap`.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function parseKeyValueMap(input?: string): Record<string, string> {
  if (!input) return {}
  return input
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, pair) => {
      const [rawKey, rawValue] = pair.split("=")
      const key = rawKey?.trim()?.toUpperCase()
      const value = rawValue?.trim()
      if (key && value) acc[key] = value
      return acc
    }, {})
}

/**
 * Parses or transforms values for `parsePriceMap`.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function parsePriceMap(input?: string): Record<string, number> {
  if (!input) return {}
  return input
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .reduce<Record<string, number>>((acc, pair) => {
      const [rawKey, rawValue] = pair.split("=")
      const key = rawKey?.trim()?.toUpperCase()
      const value = rawValue?.trim()
      if (!key || !value) return acc
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        acc[key] = parsed
      }
      return acc
    }, {})
}
