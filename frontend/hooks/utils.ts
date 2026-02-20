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
