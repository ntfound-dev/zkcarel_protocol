"use client"

import * as React from "react"
import { usePriceStream } from "@/hooks/use-price-stream"
import {
  DEFAULT_COINGECKO_IDS,
  DEFAULT_FALLBACK_PRICES,
  parseKeyValueMap,
  parsePriceMap,
  type PriceSource,
} from "@/lib/price-config"

export type LivePriceState = {
  prices: Record<string, number>
  changes: Record<string, number>
  sources: Record<string, PriceSource>
  status: {
    websocket: "idle" | "connecting" | "open" | "closed" | "error"
    lastRefresh: number | null
  }
}

type UseLivePricesOptions = {
  enabled?: boolean
  refreshMs?: number
  staleMs?: number
  useCoinGecko?: boolean
  seedPrices?: Record<string, number>
  fallbackPrices?: Record<string, number>
}

const DEFAULT_REFRESH_MS = 30000
const DEFAULT_STALE_MS = 25000
const CACHE_KEY = "zkcare_prices_cache"

const getEnv = () => (typeof process !== "undefined" ? process.env : undefined)

function buildCoinGeckoUrl(ids: string[], apiKey?: string) {
  const params = new URLSearchParams({
    vs_currencies: "usd",
    ids: ids.join(","),
    include_24hr_change: "true",
  })
  if (apiKey) params.set("x_cg_demo_api_key", apiKey)
  return `https://api.coingecko.com/api/v3/simple/price?${params.toString()}`
}

function mergePrices(
  prev: Record<string, number>,
  updates: Record<string, number>
): Record<string, number> {
  if (!updates || Object.keys(updates).length === 0) return prev
  let changed = false
  const next = { ...prev }
  for (const [key, value] of Object.entries(updates)) {
    if (!Number.isFinite(value)) continue
    if (next[key] !== value) {
      next[key] = value
      changed = true
    }
  }
  return changed ? next : prev
}

export function useLivePrices(tokens: string[], options: UseLivePricesOptions = {}): LivePriceState {
  const {
    enabled = true,
    refreshMs = DEFAULT_REFRESH_MS,
    staleMs = DEFAULT_STALE_MS,
    useCoinGecko = true,
    seedPrices,
    fallbackPrices,
  } = options

  const tokensKey = React.useMemo(
    () => tokens.map((t) => t.toUpperCase()).join("|"),
    [tokens]
  )
  const uniqueTokens = React.useMemo(
    () => Array.from(new Set(tokensKey.split("|").filter(Boolean))),
    [tokensKey]
  )

  const env = getEnv()
  const coingeckoIds = React.useMemo(() => {
    const override = parseKeyValueMap(env?.NEXT_PUBLIC_COINGECKO_IDS)
    return { ...DEFAULT_COINGECKO_IDS, ...override }
  }, [env?.NEXT_PUBLIC_COINGECKO_IDS])

  const envFallback = React.useMemo(
    () => parsePriceMap(env?.NEXT_PUBLIC_PRICE_FALLBACKS),
    [env?.NEXT_PUBLIC_PRICE_FALLBACKS]
  )

  const seedKey = React.useMemo(() => JSON.stringify(seedPrices || {}), [seedPrices])
  const fallbackKey = React.useMemo(() => JSON.stringify(fallbackPrices || {}), [fallbackPrices])

  const stableSeed = React.useMemo(() => ({ ...(seedPrices || {}) }), [seedKey])
  const stableFallback = React.useMemo(() => ({ ...(fallbackPrices || {}) }), [fallbackKey])

  const initialFallback = React.useMemo(() => ({
    ...DEFAULT_FALLBACK_PRICES,
    ...envFallback,
    ...stableFallback,
    ...stableSeed,
  }), [envFallback, stableFallback, stableSeed])

  const [prices, setPrices] = React.useState<Record<string, number>>(() => ({ ...initialFallback }))
  const [changes, setChanges] = React.useState<Record<string, number>>({})
  const [sources, setSources] = React.useState<Record<string, PriceSource>>(() => {
    const map: Record<string, PriceSource> = {}
    Object.keys(initialFallback).forEach((key) => {
      map[key] = "fallback"
    })
    return map
  })
  const [lastRefresh, setLastRefresh] = React.useState<number | null>(null)

  const lastWsUpdateRef = React.useRef<Record<string, number>>({})

  const { prices: wsPrices, changes: wsChanges, status: wsStatus } = usePriceStream(uniqueTokens, {
    enabled,
  })

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const cached = window.localStorage.getItem(CACHE_KEY)
    if (!cached) return
    try {
      const parsed = JSON.parse(cached) as {
        prices?: Record<string, number>
        changes?: Record<string, number>
        ts?: number
      }
      if (parsed?.prices) {
        setPrices((prev) => mergePrices(prev, parsed.prices || {}))
      }
      if (parsed?.changes) {
        setChanges((prev) => mergePrices(prev, parsed.changes || {}))
      }
      if (parsed?.ts) setLastRefresh(parsed.ts)
    } catch {
      // ignore cache
    }
  }, [])

  React.useEffect(() => {
    if (!stableSeed || Object.keys(stableSeed).length === 0) return
    setPrices((prev) => mergePrices(prev, stableSeed))
    setSources((prev) => {
      const next = { ...prev }
      let changed = false
      for (const [key, value] of Object.entries(stableSeed)) {
        if (!Number.isFinite(value)) continue
        if (!next[key]) {
          next[key] = "fallback"
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [seedKey, stableSeed])

  React.useEffect(() => {
    if (!stableFallback || Object.keys(stableFallback).length === 0) return
    setPrices((prev) => mergePrices(prev, stableFallback))
    setSources((prev) => {
      const next = { ...prev }
      let changed = false
      for (const [key, value] of Object.entries(stableFallback)) {
        if (!Number.isFinite(value)) continue
        if (!next[key]) {
          next[key] = "fallback"
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [fallbackKey, stableFallback])

  React.useEffect(() => {
    if (!wsPrices || Object.keys(wsPrices).length === 0) return
    const now = Date.now()
    setPrices((prev) => mergePrices(prev, wsPrices))
    setChanges((prev) => mergePrices(prev, wsChanges))
    setSources((prev) => {
      const next = { ...prev }
      let changed = false
      Object.keys(wsPrices).forEach((token) => {
        if (Number.isFinite(wsPrices[token])) {
          if (next[token] !== "ws") {
            next[token] = "ws"
            changed = true
          }
          lastWsUpdateRef.current[token] = now
        }
      })
      return changed ? next : prev
    })
  }, [wsPrices, wsChanges])

  React.useEffect(() => {
    if (!enabled || !useCoinGecko || uniqueTokens.length === 0) return

    let active = true
    const apiKey = env?.NEXT_PUBLIC_COINGECKO_API_KEY || env?.NEXT_PUBLIC_COINGECKO_KEY

    const runFetch = async () => {
      const ids = uniqueTokens
        .map((token) => coingeckoIds[token])
        .filter((id): id is string => Boolean(id))

      if (ids.length === 0) return

      try {
        const response = await fetch(buildCoinGeckoUrl(ids, apiKey))
        if (!response.ok) return
        const data = await response.json()
        if (!active || typeof data !== "object" || data === null) return

        const nextPrices: Record<string, number> = {}
        const nextChanges: Record<string, number> = {}
        const now = Date.now()

        uniqueTokens.forEach((token) => {
          const id = coingeckoIds[token]
          if (!id || !data[id]) return
          const price = data[id]?.usd
          const change = data[id]?.usd_24h_change
          if (!Number.isFinite(price)) return

          const lastWs = lastWsUpdateRef.current[token] || 0
          if (now - lastWs < staleMs) {
            return
          }
          nextPrices[token] = Number(price)
          if (Number.isFinite(change)) {
            nextChanges[token] = Number(change)
          }
        })

        if (!active) return
        if (Object.keys(nextPrices).length > 0) {
          setPrices((prev) => mergePrices(prev, nextPrices))
          setChanges((prev) => mergePrices(prev, nextChanges))
          setSources((prev) => {
            const next = { ...prev }
            let changed = false
            Object.keys(nextPrices).forEach((token) => {
              if (next[token] !== "coingecko") {
                next[token] = "coingecko"
                changed = true
              }
            })
            return changed ? next : prev
          })
          const ts = Date.now()
          setLastRefresh(ts)
          if (typeof window !== "undefined") {
            window.localStorage.setItem(
              CACHE_KEY,
              JSON.stringify({ prices: nextPrices, changes: nextChanges, ts })
            )
          }
        }
      } catch {
        // ignore CG errors
      }
    }

    runFetch()
    const timer = setInterval(runFetch, refreshMs)

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [
    enabled,
    useCoinGecko,
    refreshMs,
    staleMs,
    tokensKey,
    coingeckoIds,
    env?.NEXT_PUBLIC_COINGECKO_API_KEY,
    env?.NEXT_PUBLIC_COINGECKO_KEY,
  ])

  return {
    prices,
    changes,
    sources,
    status: {
      websocket: wsStatus,
      lastRefresh,
    },
  }
}
