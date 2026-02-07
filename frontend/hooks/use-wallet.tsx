"use client"

import { createContext, useContext, useState, useCallback, type ReactNode } from "react"

export type WalletProviderType = "metamask" | "walletconnect" | "coinbase" | "phantom" | "okx" | "trust"

interface WalletState {
  isConnected: boolean
  address: string | null
  provider: WalletProviderType | null
  balance: {
    eth: number
    usdt: number
    usdc: number
  }
  network: string
}

interface WalletContextType extends WalletState {
  connect: (provider: WalletProviderType) => Promise<void>
  disconnect: () => void
  switchNetwork: (network: string) => Promise<void>
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletState>({
    isConnected: false,
    address: null,
    provider: null,
    balance: {
      eth: 0,
      usdt: 0,
      usdc: 0,
    },
    network: "ethereum",
  })

  const connect = useCallback(async (provider: WalletProviderType) => {
    // Simulate wallet connection
    await new Promise((resolve) => setTimeout(resolve, 1000))
    
    // Mock connected state
    setWallet({
      isConnected: true,
      address: "0x1234...5678",
      provider,
      balance: {
        eth: 2.5,
        usdt: 1500,
        usdc: 2000,
      },
      network: "ethereum",
    })
  }, [])

  const disconnect = useCallback(() => {
    setWallet({
      isConnected: false,
      address: null,
      provider: null,
      balance: {
        eth: 0,
        usdt: 0,
        usdc: 0,
      },
      network: "ethereum",
    })
  }, [])

  const switchNetwork = useCallback(async (network: string) => {
    await new Promise((resolve) => setTimeout(resolve, 500))
    setWallet((prev) => ({ ...prev, network }))
  }, [])

  return (
    <WalletContext.Provider
      value={{
        ...wallet,
        connect,
        disconnect,
        switchNetwork,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider")
  }
  return context
}
