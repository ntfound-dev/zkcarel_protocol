"use client"

import { create } from "zustand"
import type { WebSocketStatus } from "@/hooks/system/use-websocket"

export type PriceStoreState = {
  prices: Record<string, number>
  changes: Record<string, number>
  status: WebSocketStatus
  requestedTokens: string[]
  registerTokens: (tokens: string[]) => void
  unregisterTokens: (tokens: string[]) => void
  clearTokens: () => void
  setStatus: (status: WebSocketStatus) => void
  applyUpdate: (update: { token: string; price?: number; change_24h?: number }) => void
}

const normalizeTokens = (tokens: string[]) =>
  Array.from(new Set(tokens.map((token) => token.trim().toUpperCase()).filter(Boolean))).sort()

export const usePriceStore = create<PriceStoreState>((set) => ({
  prices: {},
  changes: {},
  status: "idle",
  requestedTokens: [],
  registerTokens: (tokens) =>
    set((state) => {
      const next = normalizeTokens([...state.requestedTokens, ...tokens])
      if (next.join("|") === state.requestedTokens.join("|")) {
        return state
      }
      return { requestedTokens: next }
    }),
  unregisterTokens: (tokens) =>
    set((state) => {
      if (!state.requestedTokens.length) return state
      const remove = new Set(normalizeTokens(tokens))
      const next = state.requestedTokens.filter((token) => !remove.has(token))
      if (next.join("|") === state.requestedTokens.join("|")) {
        return state
      }
      return { requestedTokens: next }
    }),
  clearTokens: () => set({ requestedTokens: [] }),
  setStatus: (status) => set({ status }),
  applyUpdate: (update) =>
    set((state) => {
      const symbol = update.token.trim().toUpperCase()
      if (!symbol) return state
      const nextPrices = { ...state.prices }
      const nextChanges = { ...state.changes }
      let changed = false
      if (Number.isFinite(update.price)) {
        if (nextPrices[symbol] !== update.price) {
          nextPrices[symbol] = update.price as number
          changed = true
        }
      }
      if (Number.isFinite(update.change_24h)) {
        if (nextChanges[symbol] !== update.change_24h) {
          nextChanges[symbol] = update.change_24h as number
          changed = true
        }
      }
      if (!changed) return state
      return { prices: nextPrices, changes: nextChanges }
    }),
}))
