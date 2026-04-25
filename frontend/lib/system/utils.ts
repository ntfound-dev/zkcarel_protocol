import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Handles `cn` logic.
 *
 * @param inputs - Input used by `cn` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Handles `formatCompact` logic.
 *
 * @param value - Input used by `formatCompact` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export const formatCompact = (value: number) => {
  try {
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return value.toLocaleString()
  }
}

/**
 * Handles `formatCompactNumber` logic.
 *
 * @param value - Input used by `formatCompactNumber` to compute state, payload, or request behavior.
 * @param maxFractionDigits - Input used by `formatCompactNumber` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export const formatCompactNumber = (value: number, maxFractionDigits = 2): string => {
  if (!Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  if (abs < 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: maxFractionDigits })
  }
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: maxFractionDigits,
  }).format(value)
}
