import type { PriceSource } from "@/lib/price-config"

/**
 * Parses or transforms values for `formatPrice`.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export const formatPrice = (value?: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—"
  if (value >= 1000) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  if (value >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
  return `$${value.toFixed(6)}`
}

/**
 * Handles `sourceBadge` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export const sourceBadge = (source?: PriceSource) => {
  switch (source) {
    case "ws":
      return { label: "Live", className: "bg-success/20 text-success" }
    case "coingecko":
      return { label: "CG", className: "bg-primary/20 text-primary" }
    default:
      return { label: "Est.", className: "bg-muted text-muted-foreground" }
  }
}
