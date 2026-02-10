"use client"

import { createContext, useContext, useState, useCallback, type ReactNode } from "react"
import { connectWallet, getPortfolioBalance } from "@/lib/api"

export type WalletProviderType = "starknet" | "argentx" | "braavos"

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
    network: "starknet",
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
    let address = ""
    let message = `Sign in to ZkCarel (${new Date().toISOString()})`
    let signature = randomHex(32)
    let chainId = 1

    const injected = getInjectedStarknet(provider)
    if (injected?.enable) {
      try {
        await injected.enable({ showModal: true })
        address = injected.selectedAddress || injected.account?.address || ""
        chainId = normalizeChainId(injected.chainId)
        const signed = await signStarknetMessage(injected, address, message)
        if (signed) {
          signature = signed
        }
      } catch (error) {
        console.warn("Starknet wallet connect failed, falling back:", error)
      }
    }

    if (!address) {
      // Fallback demo address
      address = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F"
    }

    let token: string | null = null
    try {
      const auth = await connectWallet({
        address,
        signature,
        message,
        chain_id: chainId,
      })
      token = auth.token
      if (typeof window !== "undefined") {
        window.localStorage.setItem("auth_token", auth.token)
      }
    } catch (error) {
      console.warn("Backend auth failed:", error)
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
      network: "starknet",
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
      network: "starknet",
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
      network: "starknet",
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

type InjectedStarknet = {
  enable?: (opts?: { showModal?: boolean }) => Promise<void>
  selectedAddress?: string
  chainId?: string
  account?: {
    address?: string
    signMessage?: (typedData: Record<string, any>) => Promise<any>
  }
}

function getInjectedStarknet(provider?: WalletProviderType): InjectedStarknet | null {
  if (typeof window === "undefined") return null
  const anyWindow = window as any
  if (provider === "argentx") {
    return (anyWindow.starknet_argentX || anyWindow.starknet) as InjectedStarknet | null
  }
  if (provider === "braavos") {
    return (anyWindow.starknet_braavos || anyWindow.starknet) as InjectedStarknet | null
  }
  return (anyWindow.starknet ||
    anyWindow.starknet_argentX ||
    anyWindow.starknet_braavos) as InjectedStarknet | null
}

function normalizeChainId(chainId?: string): number {
  if (!chainId) return 1
  if (chainId.startsWith("0x")) {
    const parsed = Number.parseInt(chainId, 16)
    return Number.isFinite(parsed) ? parsed : 1
  }
  return 1
}

async function signStarknetMessage(
  injected: InjectedStarknet,
  address: string,
  message: string
): Promise<string | null> {
  if (!injected.account?.signMessage || !address) return null
  const typedData = {
    domain: {
      name: "ZkCarel",
      version: "1",
      chainId: injected.chainId || "SN_MAIN",
    },
    types: {
      StarkNetDomain: [
        { name: "name", type: "felt" },
        { name: "version", type: "felt" },
        { name: "chainId", type: "felt" },
      ],
      Message: [
        { name: "address", type: "felt" },
        { name: "contents", type: "felt" },
      ],
    },
    primaryType: "Message",
    message: {
      address,
      contents: message,
    },
  }
  try {
    const signature = await injected.account.signMessage(typedData)
    return signatureToHex(signature)
  } catch {
    return null
  }
}

function signatureToHex(signature: any): string {
  if (!signature) return randomHex(32)
  if (typeof signature === "string") {
    return signature.startsWith("0x") ? signature : `0x${signature}`
  }
  if (Array.isArray(signature)) {
    const parts = signature.map((item) => feltToPaddedHex(item))
    return `0x${parts.join("")}`
  }
  if (signature.signature) {
    return signatureToHex(signature.signature)
  }
  return randomHex(32)
}

function feltToPaddedHex(value: string | number): string {
  const hex = normalizeHex(value)
  return hex.padStart(64, "0")
}

function normalizeHex(value: string | number): string {
  if (typeof value === "number") {
    return value.toString(16)
  }
  if (value.startsWith("0x")) {
    return value.slice(2)
  }
  if (/^[0-9]+$/.test(value)) {
    try {
      return BigInt(value).toString(16)
    } catch {
      return value
    }
  }
  return value
}

function randomHex(bytes: number): string {
  if (typeof window === "undefined" || !window.crypto?.getRandomValues) {
    return `0x${"a".repeat(bytes * 2)}`
  }
  const buffer = new Uint8Array(bytes)
  window.crypto.getRandomValues(buffer)
  return `0x${Array.from(buffer).map((b) => b.toString(16).padStart(2, "0")).join("")}`
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider")
  }
  return context
}
