"use client"

import { create } from "zustand"
import { DEFAULT_BALANCE } from "@/lib/wallet/wallet-constants"
import type { WalletState } from "@/lib/wallet/wallet-types"

export type WalletStoreState = WalletState & {
  setWallet: (update: WalletState | ((prev: WalletState) => WalletState)) => void
  setWalletPartial: (patch: Partial<WalletState>) => void
  resetWalletState: () => void
  updateBalance: (symbol: string, amount: number) => void
  setRefreshHandlers: (handlers: {
    refreshPortfolio: () => Promise<void>
    refreshOnchainBalances: () => Promise<void>
  }) => void
  refreshPortfolio: () => Promise<void>
  refreshOnchainBalances: () => Promise<void>
}

export function createInitialWalletState(): WalletState {
  return {
    isConnected: false,
    address: null,
    provider: null,
    balance: { ...DEFAULT_BALANCE },
    onchainBalance: {
      STRK_L2: null,
      STRK_L1: null,
      ETH: null,
      BTC: null,
      CAREL: null,
      USDC: null,
      USDT: null,
      WBTC: null,
    },
    btcAddress: null,
    btcProvider: null,
    starknetAddress: null,
    evmAddress: null,
    network: "starknet",
    token: null,
    totalValueUSD: 0,
  }
}

export const useWalletStore = create<WalletStoreState>((set) => ({
  ...createInitialWalletState(),
  refreshPortfolio: async () => undefined,
  refreshOnchainBalances: async () => undefined,
  setRefreshHandlers: (handlers) =>
    set(() => ({
      refreshPortfolio: handlers.refreshPortfolio,
      refreshOnchainBalances: handlers.refreshOnchainBalances,
    })),
  setWallet: (update) =>
    set((state) => {
      const current = state as WalletState
      const next = typeof update === "function" ? update(current) : update
      return { ...state, ...next }
    }),
  setWalletPartial: (patch) => set((state) => ({ ...state, ...patch })),
  resetWalletState: () => set((state) => ({ ...state, ...createInitialWalletState() })),
  updateBalance: (symbol, amount) =>
    set((state) => ({
      balance: {
        ...state.balance,
        [symbol.toUpperCase()]: amount,
      },
    })),
}))
