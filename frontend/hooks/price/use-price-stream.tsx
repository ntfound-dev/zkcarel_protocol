"use client"

import * as React from "react"
import { usePriceStore } from "@/store/use-price-store"

export type PriceUpdate = {
  token: string
  price: number
  change_24h: number
  timestamp: number
}

type UsePriceStreamOptions = {
  enabled?: boolean
}

/**
 * Exposes `usePriceStream` as a reusable hook.
 *
 * @param tokens - Input used by `usePriceStream` to compute state, payload, or request behavior.
 * @param options - Input used by `usePriceStream` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function usePriceStream(tokens: string[], options: UsePriceStreamOptions = {}) {
  const uniqueTokens = React.useMemo(
    () => Array.from(new Set(tokens.map((t) => t.toUpperCase()))),
    [tokens]
  )
  const registerTokens = usePriceStore((state) => state.registerTokens)
  const unregisterTokens = usePriceStore((state) => state.unregisterTokens)

  React.useEffect(() => {
    if (options.enabled === false || uniqueTokens.length === 0) return
    registerTokens(uniqueTokens)
    return () => {
      unregisterTokens(uniqueTokens)
    }
  }, [options.enabled, registerTokens, uniqueTokens, unregisterTokens])

  const storeState = usePriceStore((state) => state)
  const { prices, changes, status } = React.useMemo(() => {
    const scopedPrices: Record<string, number> = {}
    const scopedChanges: Record<string, number> = {}
    uniqueTokens.forEach((token) => {
      if (Number.isFinite(storeState.prices[token])) {
        scopedPrices[token] = storeState.prices[token]
      }
      if (Number.isFinite(storeState.changes[token])) {
        scopedChanges[token] = storeState.changes[token]
      }
    })
    return { prices: scopedPrices, changes: scopedChanges, status: storeState.status }
  }, [storeState.prices, storeState.changes, storeState.status, uniqueTokens])

  return { prices, changes, status }
}
