"use client"

import { createContext, useContext, useState, useCallback, type ReactNode } from "react"
import { connectWallet, getPortfolioBalance } from "@/lib/api"

export type WalletProviderType = "metamask" | "walletconnect" | "coinbase" | "phantom" | "okx" | "trust"

interface WalletState {
  isConnected: boolean
  address: string | null
  provider: WalletProviderType | null
  balance: Record<string, number>
  network: string
  token?: string | null
}

interface WalletContextType extends WalletState {
  connect: (provider: WalletProviderType) => Promise<void>
  connectWithSumo: (sumoToken: string, address?: string) => Promise<boolean>
  disconnect: () => void
  switchNetwork: (network: string) => Promise<void>
  updateBalance: (symbol: string, amount: number) => void
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

const defaultBalance: Record<string, number> = {
  ETH: 0,
  USDT: 0,
  USDC: 0,
  BTC: 0,
  STRK: 0,
  CAREL: 0,
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletState>({
    isConnected: false,
    address: null,
    provider: null,
    balance: defaultBalance,
    network: "ethereum",
    token: null,
  })

  const updateBalance = useCallback((symbol: string, amount: number) => {
    setWallet((prev) => ({
      ...prev,
      balance: {
        ...prev.balance,
        [symbol.toUpperCase()]: amount,
      },
    }))
  }, [])

  const connect = useCallback(async (provider: WalletProviderType) => {
    // Simulate wallet connection
    await new Promise((resolve) => setTimeout(resolve, 600))

    const address = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F"
    const message = "Sign in to ZkCarel"
    const signature = `0x${"a".repeat(64)}`
    let token: string | null = null
    try {
      const auth = await connectWallet({
        address,
        signature,
        message,
        chain_id: 1,
      })
      token = auth.token
      if (typeof window !== "undefined") {
        window.localStorage.setItem("auth_token", auth.token)
      }
    } catch {
      // keep token null
    }
    let balances = { ...defaultBalance }

    try {
      const portfolio = await getPortfolioBalance()
      balances = portfolio.balances.reduce<Record<string, number>>((acc, item) => {
        acc[item.token.toUpperCase()] = item.amount
        return acc
      }, { ...defaultBalance })
    } catch {
      // fallback to default
    }

    setWallet({
      isConnected: true,
      address,
      provider,
      balance: balances,
      network: "ethereum",
      token,
    })
  }, [])

  const connectWithSumo = useCallback(async (sumoToken: string, address?: string) => {
    const userAddress = address || "0x0000000000000000000000000000000000000000"
    let token: string | null = null
    try {
      const auth = await connectWallet({
        address: userAddress,
        signature: "",
        message: "",
        chain_id: 0,
        sumo_login_token: sumoToken,
      })
      token = auth.token
      if (typeof window !== "undefined") {
        window.localStorage.setItem("auth_token", auth.token)
        window.sessionStorage.setItem("sumo_login_token", sumoToken)
        if (address) {
          window.sessionStorage.setItem("sumo_login_address", address)
        }
      }
    } catch {
      token = null
    }

    setWallet((prev) => ({
      ...prev,
      isConnected: true,
      address: userAddress,
      provider: prev.provider,
      token,
    }))
    return !!token
  }, [])

  const disconnect = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("auth_token")
    }
    setWallet({
      isConnected: false,
      address: null,
      provider: null,
      balance: defaultBalance,
      network: "ethereum",
      token: null,
    })
  }, [])

  const switchNetwork = useCallback(async (network: string) => {
    await new Promise((resolve) => setTimeout(resolve, 300))
    setWallet((prev) => ({ ...prev, network }))
  }, [])

  return (
    <WalletContext.Provider
      value={{
        ...wallet,
        connect,
        connectWithSumo,
        disconnect,
        switchNetwork,
        updateBalance,
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
