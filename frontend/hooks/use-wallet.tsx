"use client"

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import {
  connectWallet,
  getLinkedWallets,
  getOnchainBalances,
  getPortfolioBalance,
  linkWalletAddress,
} from "@/lib/api"
import { emitEvent } from "@/lib/events"
import {
  EVM_SEPOLIA_CHAIN_ID,
  EVM_SEPOLIA_CHAIN_ID_HEX,
  STARKNET_SEPOLIA_CHAIN_ID_TEXT,
  detectBtcAddressNetwork,
  isStarknetSepolia,
  normalizeStarknetChainValue,
} from "@/lib/network-config"
import {
  EVM_SEPOLIA_CHAIN_PARAMS,
  STARKNET_API_VERSIONS,
  STARKNET_PROVIDER_ID_ALIASES,
  STARKNET_SWITCH_CHAIN_PAYLOADS,
  type BtcWalletProviderType,
  type WalletProviderType,
} from "@/lib/wallet-provider-config"
export type { WalletProviderType, BtcWalletProviderType }

interface WalletState {
  isConnected: boolean
  address: string | null
  provider: WalletProviderType | null
  balance: Record<string, number>
  onchainBalance: {
    STRK_L2: number | null
    STRK_L1: number | null
    ETH: number | null
    BTC: number | null
  }
  btcAddress?: string | null
  btcProvider?: BtcWalletProviderType | null
  starknetAddress?: string | null
  evmAddress?: string | null
  network: string
  token?: string | null
  totalValueUSD?: number
}

interface WalletContextType extends WalletState {
  connect: (provider: WalletProviderType) => Promise<void>
  connectBtcWallet: (provider: BtcWalletProviderType) => Promise<void>
  linkBtcAddress: (address: string) => Promise<void>
  connectWithSumo: (sumoToken: string, address?: string) => Promise<boolean>
  refreshPortfolio: () => Promise<void>
  refreshOnchainBalances: () => Promise<void>
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

const STRK_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_STRK_TOKEN_ADDRESS ||
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
const STRK_DECIMALS = 18
const STRK_L1_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_STRK_L1_TOKEN_ADDRESS ||
  "0xca14007eff0db1f8135f4c25b34de49ab0d42766"

const STORAGE_KEYS = {
  token: "auth_token",
  address: "wallet_address",
  provider: "wallet_provider",
  network: "wallet_network",
  starknetAddress: "wallet_address_starknet",
  evmAddress: "wallet_address_evm",
  btcAddress: "wallet_address_btc",
  sumoToken: "sumo_login_token",
  sumoAddress: "sumo_login_address",
}

const XVERSE_PROVIDER_ID = "XverseProviders.BitcoinProvider"
const XVERSE_CONNECT_MESSAGE = "ZkCarel wants to connect your Bitcoin testnet wallet."

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletState>({
    isConnected: false,
    address: null,
    provider: null,
    balance: defaultBalance,
    onchainBalance: {
      STRK_L2: null,
      STRK_L1: null,
      ETH: null,
      BTC: null,
    },
    btcAddress: null,
    btcProvider: null,
    network: "starknet",
    token: null,
    totalValueUSD: 0,
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

  const refreshPortfolio = useCallback(async () => {
    try {
      const portfolio = await getPortfolioBalance()
      const balances = portfolio.balances.reduce<Record<string, number>>((acc, item) => {
        acc[item.token.toUpperCase()] = item.amount
        return acc
      }, { ...defaultBalance })
      const totalValueUSD = Number(portfolio.total_value_usd || 0)
      setWallet((prev) => ({
        ...prev,
        balance: balances,
        totalValueUSD,
      }))
    } catch {
      // keep cached state
    }
  }, [])

  const refreshOnchainBalances = useCallback(async () => {
    if (!wallet.starknetAddress && !wallet.evmAddress && !wallet.btcAddress) return

    let response: Awaited<ReturnType<typeof getOnchainBalances>> | null = null
    if (wallet.token) {
      try {
        response = await getOnchainBalances({
          starknet_address: wallet.starknetAddress,
          evm_address: wallet.evmAddress,
          btc_address: wallet.btcAddress,
        })
      } catch {
        // fallback to direct wallet reads
      }
    }

    const resolved = {
      STRK_L2: response?.strk_l2 ?? null,
      STRK_L1: response?.strk_l1 ?? null,
      ETH: response?.eth ?? null,
      BTC: response?.btc ?? null,
    }

    if (wallet.starknetAddress && resolved.STRK_L2 === null) {
      const starknet =
        (wallet.provider && isStarknetWalletProvider(wallet.provider)
          ? getInjectedStarknet(wallet.provider)
          : null) ||
        getInjectedStarknet("braavos") ||
        getInjectedStarknet("starknet")
      if (starknet) {
        const strkL2 = await fetchStarknetBalance(starknet, wallet.starknetAddress)
        if (typeof strkL2 === "number" && Number.isFinite(strkL2)) {
          resolved.STRK_L2 = strkL2
        }
      }
    }

    if (wallet.evmAddress && (resolved.ETH === null || resolved.STRK_L1 === null)) {
      const evm = getPreferredEvmProvider(wallet.provider)
      if (evm) {
        if (resolved.ETH === null) {
          const ethBalance = await fetchEvmBalance(evm, wallet.evmAddress)
          if (typeof ethBalance === "number" && Number.isFinite(ethBalance)) {
            resolved.ETH = ethBalance
          }
        }
        if (resolved.STRK_L1 === null && STRK_L1_TOKEN_ADDRESS) {
          const strkL1 = await fetchEvmErc20Balance(evm, wallet.evmAddress, STRK_L1_TOKEN_ADDRESS)
          if (typeof strkL1 === "number" && Number.isFinite(strkL1)) {
            resolved.STRK_L1 = strkL1
          }
        }
      }
    }

    setWallet((prev) => ({
      ...prev,
      balance: {
        ...prev.balance,
        ETH:
          wallet.evmAddress && resolved.ETH !== null ? resolved.ETH : prev.balance.ETH,
        STRK:
          wallet.starknetAddress && resolved.STRK_L2 !== null
            ? resolved.STRK_L2
            : prev.balance.STRK,
        BTC:
          wallet.btcAddress && resolved.BTC !== null ? resolved.BTC : prev.balance.BTC,
      },
      onchainBalance: {
        STRK_L2: resolved.STRK_L2 ?? prev.onchainBalance.STRK_L2,
        STRK_L1: resolved.STRK_L1 ?? prev.onchainBalance.STRK_L1,
        ETH: resolved.ETH ?? prev.onchainBalance.ETH,
        BTC: resolved.BTC ?? prev.onchainBalance.BTC,
      },
    }))
  }, [wallet.token, wallet.starknetAddress, wallet.evmAddress, wallet.btcAddress, wallet.provider])

  useEffect(() => {
    if (typeof window === "undefined") return
    const token = window.localStorage.getItem(STORAGE_KEYS.token)
    const address = window.localStorage.getItem(STORAGE_KEYS.address)
    const providerRaw = window.localStorage.getItem(STORAGE_KEYS.provider)
    const provider: WalletProviderType | null =
      providerRaw === "starknet" ||
      providerRaw === "argentx" ||
      providerRaw === "braavos" ||
      providerRaw === "metamask"
        ? providerRaw
        : null
    const network = window.localStorage.getItem(STORAGE_KEYS.network)
    const starknetAddress = window.localStorage.getItem(STORAGE_KEYS.starknetAddress)
    const evmAddress = window.localStorage.getItem(STORAGE_KEYS.evmAddress)
    const btcAddress = window.localStorage.getItem(STORAGE_KEYS.btcAddress)

    if (!token || !address) return

    setWallet((prev) => ({
      ...prev,
      isConnected: true,
      address,
      provider: provider || null,
      network: network || prev.network,
      starknetAddress: starknetAddress || null,
      evmAddress: evmAddress || null,
      btcAddress: btcAddress || null,
      token,
    }))

    void refreshPortfolio()
  }, [refreshPortfolio])

  useEffect(() => {
    if (!wallet.isConnected || !wallet.token) return
    let active = true
    ;(async () => {
      try {
        const linked = await getLinkedWallets()
        if (!active) return
        setWallet((prev) => ({
          ...prev,
          starknetAddress: prev.starknetAddress || linked.starknet_address || null,
          evmAddress: prev.evmAddress || linked.evm_address || null,
          btcAddress: prev.btcAddress || linked.btc_address || null,
        }))
      } catch {
        // keep local addresses if backend linked wallet fetch fails
      }
    })()
    return () => {
      active = false
    }
  }, [wallet.isConnected, wallet.token])

  useEffect(() => {
    if (!wallet.isConnected || !wallet.token) return
    const tasks: Promise<unknown>[] = []
    if (wallet.starknetAddress) {
      tasks.push(
        linkWalletAddress({
          chain: "starknet",
          address: wallet.starknetAddress,
          provider: "starknet",
        })
      )
    }
    if (wallet.evmAddress) {
      tasks.push(
        linkWalletAddress({
          chain: "evm",
          address: wallet.evmAddress,
          provider: "metamask",
        })
      )
    }
    if (wallet.btcAddress) {
      tasks.push(
        linkWalletAddress({
          chain: "bitcoin",
          address: wallet.btcAddress,
          provider: wallet.btcProvider || "xverse",
        })
      )
    }
    if (!tasks.length) return
    void Promise.allSettled(tasks)
  }, [
    wallet.isConnected,
    wallet.token,
    wallet.starknetAddress,
    wallet.evmAddress,
    wallet.btcAddress,
    wallet.btcProvider,
  ])

  useEffect(() => {
    if (!wallet.starknetAddress && !wallet.evmAddress && !wallet.btcAddress) return

    void refreshOnchainBalances()

    if (typeof window === "undefined") return
    const interval = window.setInterval(() => {
      void refreshOnchainBalances()
    }, 30000)

    return () => {
      window.clearInterval(interval)
    }
  }, [wallet.token, wallet.starknetAddress, wallet.evmAddress, wallet.btcAddress, refreshOnchainBalances])

  const connect = useCallback(async (provider: WalletProviderType) => {
    const message = `ZkCarel login ${Math.floor(Date.now() / 1000)}`
    let address = ""
    let signature = ""
    let chainId = 1
    let network = "starknet"
    let starknetSession: InjectedStarknet | null = null
    let evmSession: InjectedEvm | null = null
    const onchain = {
      STRK_L2: null as number | null,
      STRK_L1: null as number | null,
      ETH: null as number | null,
      BTC: null as number | null,
    }

    if (provider === "metamask") {
      const evm = getInjectedEvm(provider)
      if (!evm) {
        throw new Error("EVM wallet not detected. Install MetaMask.")
      }
      evmSession = evm
      try {
        const accounts = await evm.request({ method: "eth_requestAccounts" })
        address = Array.isArray(accounts) && accounts[0] ? accounts[0] : ""
        if (!address) {
          throw new Error("No EVM account returned. Unlock MetaMask and try again.")
        }
        chainId = await ensureEvmSepolia(evm)
        if (chainId !== EVM_SEPOLIA_CHAIN_ID) {
          throw new Error("Please switch wallet network to Ethereum Sepolia (chain id 11155111).")
        }
        try {
          signature = await evm.request({
            method: "personal_sign",
            params: [message, address],
          })
        } catch {
          // Some injected EVM providers expect reversed personal_sign params.
          signature = await evm.request({
            method: "personal_sign",
            params: [address, message],
          })
        }
        if (!signature || typeof signature !== "string") {
          throw new Error("EVM signature failed. Approve sign request in wallet.")
        }
        network = "evm"
      } catch (error) {
        console.warn("EVM wallet connect failed:", error)
        throw normalizeWalletError(error, "Failed to connect EVM wallet")
      }
    } else {
      const starknet = await connectStarknetWallet(provider)
      if (!starknet) {
        throw new Error("No Starknet wallet detected. Install ArgentX/Braavos.")
      }
      starknetSession = starknet
      try {
        const accounts = await requestAccounts(starknet)
        address =
          (Array.isArray(accounts) && accounts[0]) ||
          starknet.selectedAddress ||
          starknet.account?.address ||
          ""
        const activeStarknetChainId = await ensureStarknetSepolia(starknet)
        const chainReadable = isReadableStarknetChainId(activeStarknetChainId)
        const resolvedStarknetChainId =
          chainReadable && isStarknetSepolia(activeStarknetChainId)
            ? activeStarknetChainId
            : STARKNET_SEPOLIA_CHAIN_ID_TEXT
        chainId = 2
        const signed = await signStarknetMessage(
          starknet,
          address,
          message,
          resolvedStarknetChainId
        )
        if (chainReadable && activeStarknetChainId && !isStarknetSepolia(activeStarknetChainId)) {
          const normalizedChainId = normalizeStarknetChainValue(activeStarknetChainId)
          console.warn(
            `Starknet wallet reported non-Sepolia chain (${normalizedChainId || activeStarknetChainId}). Continuing with Sepolia login context.`
          )
        }
        if (signed) {
          signature = signed
        } else {
          throw new Error("Failed to sign Starknet login message.")
        }
      } catch (error) {
        console.warn("Starknet wallet connect failed:", error)
        throw normalizeWalletError(error, "Failed to connect Starknet wallet")
      }
    }

    if (!address) {
      throw new Error("Wallet not connected")
    }
    if (!signature) {
      throw new Error("Wallet signature was not produced.")
    }

    if (wallet.isConnected && wallet.token && wallet.address) {
      const chain = network === "evm" ? "evm" : "starknet"
      try {
        await linkWalletAddress({
          chain,
          address,
          provider,
        })
      } catch (error) {
        console.warn("Wallet link failed:", error)
      }

      if (typeof window !== "undefined") {
        if (network === "starknet") {
          window.localStorage.setItem(STORAGE_KEYS.starknetAddress, address)
        }
        if (network === "evm") {
          window.localStorage.setItem(STORAGE_KEYS.evmAddress, address)
        }
      }

      setWallet((prev) => ({
        ...prev,
        provider: prev.provider || provider,
        network,
        starknetAddress: network === "starknet" ? address : prev.starknetAddress,
        evmAddress: network === "evm" ? address : prev.evmAddress,
      }))

      emitEvent("wallet:connected", { address: wallet.address, provider })
      return
    }

    let token = ""
    let userAddress = address
    try {
      const auth = await connectWallet({
        address,
        signature,
        message,
        chain_id: chainId,
        wallet_type: network === "evm" ? "evm" : "starknet",
      })
      token = auth.token
      userAddress = auth.user.address || address
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEYS.token, auth.token)
        window.localStorage.setItem(STORAGE_KEYS.address, userAddress)
        window.localStorage.setItem(STORAGE_KEYS.provider, provider)
        window.localStorage.setItem(STORAGE_KEYS.network, network)
        if (network === "starknet") {
          window.localStorage.setItem(STORAGE_KEYS.starknetAddress, address)
        }
        if (network === "evm") {
          window.localStorage.setItem(STORAGE_KEYS.evmAddress, address)
        }
      }
    } catch (error) {
      console.warn("Backend auth failed:", error)
      throw normalizeWalletError(error, "Failed to authenticate wallet with backend.")
    }
    let balances = { ...defaultBalance }
    let totalValueUSD = 0

    try {
      const portfolio = await getPortfolioBalance()
      balances = portfolio.balances.reduce<Record<string, number>>((acc, item) => {
        acc[item.token.toUpperCase()] = item.amount
        return acc
      }, { ...defaultBalance })
      totalValueUSD = Number(portfolio.total_value_usd || 0)
    } catch {
      // keep default balances
    }

    if (network === "starknet" && starknetSession && address) {
      const strkBalance = await fetchStarknetBalance(starknetSession, address)
      if (typeof strkBalance === "number" && Number.isFinite(strkBalance)) {
        balances = { ...balances, STRK: strkBalance }
        onchain.STRK_L2 = strkBalance
      }
    }
    if (network === "evm" && evmSession && address) {
      const [ethBalance, strkL1] = await Promise.all([
        fetchEvmBalance(evmSession, address),
        STRK_L1_TOKEN_ADDRESS
          ? fetchEvmErc20Balance(evmSession, address, STRK_L1_TOKEN_ADDRESS)
          : Promise.resolve(null),
      ])
      if (typeof ethBalance === "number" && Number.isFinite(ethBalance)) {
        balances = { ...balances, ETH: ethBalance }
        onchain.ETH = ethBalance
      }
      if (typeof strkL1 === "number" && Number.isFinite(strkL1)) {
        onchain.STRK_L1 = strkL1
      }
    }

    setWallet((prev) => ({
      isConnected: true,
      address: userAddress,
      provider,
      balance: balances,
      onchainBalance: {
        STRK_L2: onchain.STRK_L2 ?? prev.onchainBalance.STRK_L2,
        STRK_L1: onchain.STRK_L1 ?? prev.onchainBalance.STRK_L1,
        ETH: onchain.ETH ?? prev.onchainBalance.ETH,
        BTC: onchain.BTC ?? prev.onchainBalance.BTC,
      },
      network,
      starknetAddress: network === "starknet" ? address : prev.starknetAddress,
      evmAddress: network === "evm" ? address : prev.evmAddress,
      btcAddress: prev.btcAddress,
      btcProvider: prev.btcProvider,
      token,
      totalValueUSD,
    }))
    emitEvent("wallet:connected", { address: userAddress, provider })
  }, [wallet.address, wallet.isConnected, wallet.token])

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
        window.localStorage.setItem(STORAGE_KEYS.token, auth.token)
        window.localStorage.setItem(STORAGE_KEYS.address, userAddress)
        window.localStorage.setItem(STORAGE_KEYS.provider, "")
        window.localStorage.setItem(STORAGE_KEYS.network, "starknet")
        window.sessionStorage.setItem(STORAGE_KEYS.sumoToken, sumoToken)
        if (address) {
          window.sessionStorage.setItem(STORAGE_KEYS.sumoAddress, address)
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
    emitEvent("wallet:connected", { address: userAddress, provider: null })
    return !!token
  }, [])

  const connectBtcWallet = useCallback(async (provider: BtcWalletProviderType) => {
    if (provider === "xverse") {
      const { address: btcAddress, balance: btcBalance } = await connectBtcWalletViaXverse()
      setWallet((prev) => ({
        ...prev,
        btcAddress,
        btcProvider: provider,
        balance: {
          ...prev.balance,
          BTC: typeof btcBalance === "number" ? btcBalance : prev.balance.BTC,
        },
        onchainBalance: {
          ...prev.onchainBalance,
          BTC: typeof btcBalance === "number" ? btcBalance : prev.onchainBalance.BTC,
        },
      }))
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEYS.btcAddress, btcAddress)
      }
      if (wallet.token) {
        try {
          await linkWalletAddress({ chain: "bitcoin", address: btcAddress, provider })
        } catch {
          // keep local linked BTC even if backend link fails
        }
      }
      return
    }

    const injected = getInjectedBtc(provider)
    if (!injected) {
      throw new Error(
        "BTC wallet extension not detected. Install Xverse wallet (optional jika hanya pakai ETH/STRK)."
      )
    }

    const accounts = await requestBtcAccounts(injected)
    const btcAddress = accounts?.[0] || null
    if (!btcAddress) {
      throw new Error("BTC wallet not connected")
    }
    const btcNetwork = detectBtcAddressNetwork(btcAddress)
    if (btcNetwork !== "testnet") {
      throw new Error("BTC wallet must be on Bitcoin testnet (native).")
    }

    const btcBalance = await fetchBtcBalance(injected, btcAddress)
    setWallet((prev) => ({
      ...prev,
      btcAddress,
      btcProvider: provider,
      balance: {
        ...prev.balance,
        BTC: typeof btcBalance === "number" ? btcBalance : prev.balance.BTC,
      },
      onchainBalance: {
        ...prev.onchainBalance,
        BTC: typeof btcBalance === "number" ? btcBalance : prev.onchainBalance.BTC,
      },
    }))
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEYS.btcAddress, btcAddress)
    }
    if (wallet.token) {
      try {
        await linkWalletAddress({ chain: "bitcoin", address: btcAddress, provider })
      } catch {
        // keep local linked BTC even if backend link fails
      }
    }
  }, [wallet.token])

  const linkBtcAddress = useCallback(async (address: string) => {
    const btcAddress = address.trim()
    if (!btcAddress) {
      throw new Error("BTC address is required.")
    }
    const btcNetwork = detectBtcAddressNetwork(btcAddress)
    if (btcNetwork !== "testnet") {
      throw new Error("BTC address must be on Bitcoin testnet (native).")
    }

    let btcBalance: number | null = null
    const injected =
      getInjectedBtc("braavos_btc") ||
      getInjectedBtc("xverse") ||
      getInjectedBtc("unisat")
    if (injected) {
      btcBalance = await fetchBtcBalance(injected, btcAddress)
    }

    setWallet((prev) => ({
      ...prev,
      btcAddress,
      balance: {
        ...prev.balance,
        BTC: typeof btcBalance === "number" ? btcBalance : prev.balance.BTC,
      },
      onchainBalance: {
        ...prev.onchainBalance,
        BTC: typeof btcBalance === "number" ? btcBalance : prev.onchainBalance.BTC,
      },
    }))

    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEYS.btcAddress, btcAddress)
    }
    if (wallet.token) {
      try {
        await linkWalletAddress({ chain: "bitcoin", address: btcAddress, provider: "manual" })
      } catch {
        // keep local linked BTC even if backend link fails
      }
    }
  }, [wallet.token])

  const disconnect = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEYS.token)
      window.localStorage.removeItem(STORAGE_KEYS.address)
      window.localStorage.removeItem(STORAGE_KEYS.provider)
      window.localStorage.removeItem(STORAGE_KEYS.network)
      window.localStorage.removeItem(STORAGE_KEYS.starknetAddress)
      window.localStorage.removeItem(STORAGE_KEYS.evmAddress)
      window.localStorage.removeItem(STORAGE_KEYS.btcAddress)
      window.sessionStorage.removeItem(STORAGE_KEYS.sumoToken)
      window.sessionStorage.removeItem(STORAGE_KEYS.sumoAddress)
    }
    setWallet({
      isConnected: false,
      address: null,
      provider: null,
      balance: defaultBalance,
      onchainBalance: {
        STRK_L2: null,
        STRK_L1: null,
        ETH: null,
        BTC: null,
      },
      btcAddress: null,
      btcProvider: null,
      starknetAddress: null,
      evmAddress: null,
      network: "starknet",
      token: null,
      totalValueUSD: 0,
    })
    emitEvent("wallet:disconnected", { address: null, provider: null })
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
        connectBtcWallet,
        linkBtcAddress,
        connectWithSumo,
        refreshPortfolio,
        refreshOnchainBalances,
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
  id?: string
  name?: string
  version?: string
  icon?: string | { dark?: string; light?: string }
  enable?: (opts?: { showModal?: boolean }) => Promise<void>
  selectedAddress?: string
  chainId?: string
  request?: (payload: { type?: string; method?: string; params?: unknown }) => Promise<unknown>
  on?: (...args: any[]) => void
  off?: (...args: any[]) => void
  account?: {
    address?: string
    signMessage?: (typedData: Record<string, any>) => Promise<any>
    getChainId?: () => Promise<unknown> | unknown
  }
  provider?: {
    getChainId?: () => Promise<unknown> | unknown
  }
}

function isUsableStarknetInjected(candidate: unknown): candidate is InjectedStarknet {
  if (!candidate || typeof candidate !== "object") return false
  const injected = candidate as InjectedStarknet
  return (
    typeof injected.request === "function" ||
    typeof injected.enable === "function" ||
    typeof injected.account?.signMessage === "function" ||
    typeof injected.account?.address === "string"
  )
}

function pickInjectedStarknet(...candidates: unknown[]): InjectedStarknet | null {
  for (const candidate of candidates) {
    if (isUsableStarknetInjected(candidate)) {
      return candidate
    }
  }
  return null
}

function getInjectedStarknet(provider?: WalletProviderType): InjectedStarknet | null {
  if (typeof window === "undefined") return null
  const anyWindow = window as any
  const starknetDefault = anyWindow.starknet
  const starknetArgent =
    anyWindow.starknet_argentX ||
    anyWindow.argentX?.starknet ||
    anyWindow.argent?.starknet ||
    anyWindow.argentX
  const starknetBraavos =
    anyWindow.starknet_braavos ||
    anyWindow.braavos?.starknet ||
    anyWindow.braavosWallet?.starknet ||
    anyWindow.braavosStarknet
  const fallbackDefault = pickInjectedStarknet(starknetDefault)

  if (provider === "argentx") {
    const direct = pickInjectedStarknet(starknetArgent)
    if (direct) return direct
    if (
      fallbackDefault &&
      hasStarknetProviderAlias(fallbackDefault, STARKNET_PROVIDER_ID_ALIASES.argentx)
    ) {
      return fallbackDefault
    }
    return null
  }
  if (provider === "braavos") {
    const direct = pickInjectedStarknet(starknetBraavos)
    if (direct) return direct
    if (
      fallbackDefault &&
      hasStarknetProviderAlias(fallbackDefault, STARKNET_PROVIDER_ID_ALIASES.braavos)
    ) {
      return fallbackDefault
    }
    return null
  }
  return pickInjectedStarknet(starknetDefault, starknetArgent, starknetBraavos)
}

type InjectedEvm = {
  isMetaMask?: boolean
  request: (payload: { method: string; params?: unknown[] }) => Promise<any>
  providers?: InjectedEvm[]
}

type InjectedBtc = {
  request?: (payload: { method: string; params?: unknown[] }) => Promise<any>
  getAccounts?: () => Promise<string[]>
  requestAccounts?: () => Promise<string[]>
  getBalance?: (address?: string) => Promise<any>
}

function isInjectedBtc(candidate: unknown): candidate is InjectedBtc {
  if (!candidate || typeof candidate !== "object") return false
  const provider = candidate as InjectedBtc
  return (
    typeof provider.request === "function" ||
    typeof provider.getAccounts === "function" ||
    typeof provider.requestAccounts === "function" ||
    typeof provider.getBalance === "function"
  )
}

function pickInjectedBtc(...candidates: unknown[]): InjectedBtc | null {
  for (const candidate of candidates) {
    if (isInjectedBtc(candidate)) return candidate
  }
  return null
}

function isStarknetWalletProvider(
  provider: WalletProviderType
): provider is "starknet" | "argentx" | "braavos" {
  return provider === "starknet" || provider === "argentx" || provider === "braavos"
}

function getInjectedEvm(provider: WalletProviderType): InjectedEvm | null {
  if (typeof window === "undefined") return null
  const anyWindow = window as any
  const ethereum = anyWindow.ethereum as InjectedEvm | undefined
  const providers = ethereum?.providers?.length ? ethereum.providers : []

  const isMetaMask = (p?: InjectedEvm) => !!p?.isMetaMask

  if (provider === "metamask") {
    if (providers.length) {
      const match = providers.find((p) => isMetaMask(p))
      if (match) return match
    }
    if (ethereum && isMetaMask(ethereum)) return ethereum
    return null
  }

  return ethereum || null
}

function getPreferredEvmProvider(provider?: WalletProviderType | null): InjectedEvm | null {
  if (provider === "metamask") {
    return getInjectedEvm("metamask")
  }
  return getInjectedEvm("metamask")
}

function getInjectedBtc(provider: BtcWalletProviderType): InjectedBtc | null {
  if (typeof window === "undefined") return null
  const anyWindow = window as any
  const genericBtc = pickInjectedBtc(
    anyWindow.btc,
    anyWindow.bitcoin,
    anyWindow.BitcoinProvider,
    anyWindow.satsConnect?.provider,
    anyWindow.leather?.bitcoin,
    anyWindow.okxwallet?.bitcoin
  )
  if (provider === "braavos_btc") {
    return pickInjectedBtc(
      anyWindow.braavos?.bitcoin ||
      anyWindow.braavos?.btc ||
      anyWindow.starknet_braavos?.bitcoin ||
      anyWindow.braavosWallet?.bitcoin ||
      anyWindow.braavosBtc,
      genericBtc
    )
  }
  if (provider === "xverse") {
    return pickInjectedBtc(
      anyWindow.xverse?.bitcoin ||
      anyWindow.xverseProviders?.bitcoin ||
      anyWindow.XverseProviders?.bitcoin ||
      anyWindow.XverseProviders?.BitcoinProvider ||
      anyWindow.BitcoinProvider,
      genericBtc
    )
  }
  if (provider === "unisat") {
    return pickInjectedBtc(anyWindow.unisat, genericBtc)
  }
  return genericBtc
}

async function connectStarknetWallet(provider: WalletProviderType): Promise<InjectedStarknet | null> {
  const injected = getInjectedStarknet(provider)

  try {
    const coreMod = await import("@starknet-io/get-starknet-core")
    const getStarknetCore = (coreMod as any).getStarknet as (() => any) | undefined
    if (getStarknetCore) {
      const core = getStarknetCore()
      const available = (await core.getAvailableWallets()) as InjectedStarknet[]
      const lastConnected = (await core.getLastConnectedWallet().catch(() => null)) as
        | InjectedStarknet
        | null
      const selected = selectStarknetWallet(available, provider, lastConnected)
      if (selected) {
        const enabled = (await core.enable(selected)) as InjectedStarknet
        return pickInjectedStarknet(enabled, injected)
      }
    }
  } catch (error) {
    console.warn("get-starknet-core connect failed:", error)
  }

  try {
    const mod = await import("@starknet-io/get-starknet")
    const connect = (mod as any).connect as (opts?: any) => Promise<InjectedStarknet | null>
    if (connect) {
      const include = getStarknetIncludeFilter(provider)
      const connected = await connect({
        modalMode: "alwaysAsk",
        include,
      })
      if (isUsableStarknetInjected(connected)) {
        return connected
      }
    }
  } catch (error) {
    console.warn("get-starknet connect failed:", error)
  }

  return injected || null
}

function getStarknetIncludeFilter(provider: WalletProviderType): string[] | undefined {
  if (provider === "argentx" || provider === "braavos") {
    return STARKNET_PROVIDER_ID_ALIASES[provider]
  }
  return undefined
}

function selectStarknetWallet(
  wallets: InjectedStarknet[],
  provider: WalletProviderType,
  lastConnected?: InjectedStarknet | null
): InjectedStarknet | null {
  if (!wallets?.length) return lastConnected || null

  if (provider === "starknet") {
    if (lastConnected) {
      const match = wallets.find((wallet) => wallet.id === lastConnected.id)
      if (match) return match
    }
    return wallets[0]
  }

  if (provider === "argentx" || provider === "braavos") {
    const aliases = STARKNET_PROVIDER_ID_ALIASES[provider]
    const match = wallets.find((wallet) => hasStarknetProviderAlias(wallet, aliases))
    if (match) return match
  }

  return wallets[0] || null
}

function hasStarknetProviderAlias(wallet: InjectedStarknet, aliases: string[]): boolean {
  const id = normalizeProviderHint(wallet.id)
  const name = normalizeProviderHint(wallet.name)
  return aliases.some((alias) => {
    const needle = normalizeProviderHint(alias)
    return (!!id && id.includes(needle)) || (!!name && name.includes(needle))
  })
}

function normalizeProviderHint(value?: string): string {
  if (!value) return ""
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function normalizeChainId(chainId?: string): number {
  if (!chainId) return 1
  if (isStarknetSepolia(chainId)) return 2
  const upper = chainId.toUpperCase()
  if (upper.includes("MAIN")) return 1
  if (chainId.startsWith("0x")) {
    const parsed = Number.parseInt(chainId, 16)
    return Number.isFinite(parsed) ? parsed : 1
  }
  return 1
}

async function signStarknetMessage(
  injected: InjectedStarknet,
  address: string,
  message: string,
  chainIdOverride?: string
): Promise<string | null> {
  if (!address) return null
  const shortMessage = toShortString(message)
  const typedData = {
    domain: {
      name: "ZkCarel",
      version: "1",
      chainId: chainIdOverride || injected.chainId || STARKNET_SEPOLIA_CHAIN_ID_TEXT,
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
      contents: shortMessage,
    },
  }

  if (injected.request) {
    try {
      const signature = await requestStarknet(injected, {
        type: "wallet_signTypedData",
        params: typedData as unknown,
      })
      const normalized = normalizeSignatureValue(signature)
      if (normalized) return normalized
    } catch {
      // fall back to legacy signer
    }
  }

  if (!injected.account?.signMessage) return null
  try {
    const signature = await injected.account.signMessage(typedData)
    return signatureToHex(signature)
  } catch {
    return null
  }
}

async function requestAccounts(injected: InjectedStarknet): Promise<string[] | null> {
  if (injected.request) {
    const attempts: Array<{ type: string; params?: unknown }> = [{ type: "wallet_requestAccounts" }]
    STARKNET_API_VERSIONS.forEach((version) => {
      attempts.push({
        type: "wallet_requestAccounts",
        params: { api_version: version },
      })
      attempts.push({
        type: "wallet_requestAccounts",
        params: { api_version: version, silent_mode: false },
      })
    })
    attempts.push({ type: "wallet_requestAccounts", params: { silent_mode: false } })
    for (const payload of attempts) {
      try {
        const result = await requestStarknet(injected, payload)
        if (Array.isArray(result)) {
          return result as string[]
        }
      } catch (error) {
        console.warn("wallet_requestAccounts failed:", error)
      }
    }
  }

  if (injected.enable) {
    try {
      const result = await injected.enable({ showModal: true })
      if (Array.isArray(result)) {
        return result as string[]
      }
    } catch (error) {
      console.warn("wallet enable failed:", error)
    }
  }

  return null
}

async function fetchStarknetBalance(
  injected: InjectedStarknet,
  address: string
): Promise<number | null> {
  const target: any = injected.account || injected
  if (!target?.getBalance || !address) return null
  const tokenAddress = STRK_TOKEN_ADDRESS

  const attempts = [
    () => target.getBalance(address, "latest", tokenAddress),
    () => target.getBalance(address, tokenAddress),
    () => target.getBalance(tokenAddress),
  ]

  for (const attempt of attempts) {
    try {
      const raw = await attempt()
      const normalized = normalizeTokenBalance(raw, STRK_DECIMALS)
      if (normalized !== null) return normalized
    } catch {
      // try next signature
    }
  }

  return null
}

async function fetchEvmBalance(injected: InjectedEvm, address: string): Promise<number | null> {
  try {
    const raw = await injected.request({ method: "eth_getBalance", params: [address, "latest"] })
    return normalizeEvmBalance(raw)
  } catch {
    return null
  }
}

async function fetchEvmErc20Balance(
  injected: InjectedEvm,
  address: string,
  tokenAddress: string
): Promise<number | null> {
  if (!address || !tokenAddress) return null
  try {
    const owner = sanitizeEvmAddressToWord(address)
    const token = sanitizeEvmAddress(tokenAddress)
    if (!owner || !token) return null

    const rawBalance = await injected.request({
      method: "eth_call",
      params: [{ to: token, data: `0x70a08231${owner}` }, "latest"],
    })
    const rawDecimals = await injected.request({
      method: "eth_call",
      params: [{ to: token, data: "0x313ce567" }, "latest"],
    })

    const balance = parseBigIntLike(rawBalance)
    const decimals = normalizeEvmDecimals(rawDecimals)
    if (balance === null) return null
    return scaleBigIntBalance(balance, decimals)
  } catch {
    return null
  }
}

function normalizeEvmBalance(value: any): number | null {
  if (typeof value !== "string") return null
  try {
    const wei = BigInt(value)
    const divisor = pow10BigInt(18)
    const whole = Number(wei / divisor)
    const fraction = Number(wei % divisor) / Number(divisor)
    return whole + fraction
  } catch {
    return null
  }
}

async function ensureEvmSepolia(injected: InjectedEvm): Promise<number> {
  let chainId = await readEvmChainId(injected)
  if (chainId === EVM_SEPOLIA_CHAIN_ID) return chainId

  try {
    await injected.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: EVM_SEPOLIA_CHAIN_ID_HEX }],
    })
  } catch (error: any) {
    const code = (error as { code?: number } | undefined)?.code
    if (code === 4902) {
      await injected.request({
        method: "wallet_addEthereumChain",
        params: [EVM_SEPOLIA_CHAIN_PARAMS],
      })
    } else {
      throw error
    }
  }

  chainId = await readEvmChainId(injected)
  return chainId
}

async function ensureStarknetSepolia(injected: InjectedStarknet): Promise<string | undefined> {
  let chainId = await readStarknetChainId(injected)
  if (isStarknetSepolia(chainId)) return chainId
  if (!injected.request) return chainId

  for (const payload of STARKNET_SWITCH_CHAIN_PAYLOADS) {
    try {
      await requestStarknet(injected, payload)
      chainId = await readStarknetChainId(injected)
      if (isStarknetSepolia(chainId)) return chainId
    } catch {
      // try next payload signature
    }
  }

  return chainId
}

async function readStarknetChainId(injected: InjectedStarknet): Promise<string | undefined> {
  const fromCurrent = parseStarknetChainIdResult(injected.chainId)
  if (fromCurrent) {
    injected.chainId = fromCurrent
    return fromCurrent
  }

  const attempts: Array<{ type: string; params?: unknown }> = [
    { type: "wallet_getChainId" },
    { type: "wallet_requestChainId" },
  ]
  STARKNET_API_VERSIONS.forEach((version) => {
    attempts.push({ type: "wallet_getChainId", params: { api_version: version } })
    attempts.push({ type: "wallet_requestChainId", params: { api_version: version } })
  })
  attempts.push({ type: "starknet_chainId" })
  attempts.push({ type: "wallet_chainId" })

  if (injected.request) {
    for (const payload of attempts) {
      try {
        const result = await requestStarknet(injected, payload)
        const parsed = parseStarknetChainIdResult(result)
        if (parsed) {
          injected.chainId = parsed
          return parsed
        }
      } catch {
        // try next request type
      }
    }
  }

  const fromAccount = await readStarknetChainIdFromGetter(injected.account?.getChainId)
  if (fromAccount) {
    injected.chainId = fromAccount
    return fromAccount
  }

  const fromProvider = await readStarknetChainIdFromGetter(injected.provider?.getChainId)
  if (fromProvider) {
    injected.chainId = fromProvider
    return fromProvider
  }

  return injected.chainId
}

async function requestStarknet(
  injected: InjectedStarknet,
  payload: { type: string; params?: unknown }
): Promise<unknown> {
  if (!injected.request) {
    throw new Error("Injected Starknet wallet does not support request().")
  }
  const variants = buildStarknetRequestVariants(payload)
  let lastError: unknown = null
  for (const variant of variants) {
    try {
      return await injected.request(variant)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error("Starknet wallet request failed.")
}

function buildStarknetRequestVariants(payload: {
  type: string
  params?: unknown
}): Array<{ type?: string; method?: string; params?: unknown }> {
  const variants: Array<{ type?: string; method?: string; params?: unknown }> = [
    { type: payload.type, params: payload.params },
    { method: payload.type, params: payload.params },
  ]

  if (payload.params !== undefined && !Array.isArray(payload.params)) {
    variants.push({ type: payload.type, params: [payload.params] })
    variants.push({ method: payload.type, params: [payload.params] })
  }

  return variants
}

function parseStarknetChainIdResult(result: unknown): string | null {
  if (typeof result === "string" && result) {
    const trimmed = result.trim()
    if (!trimmed) return null
    const upper = trimmed.toUpperCase()
    if (upper === "UNKNOWN" || upper === "NULL" || upper === "UNDEFINED") return null
    return trimmed
  }
  if (typeof result === "number" && Number.isFinite(result)) {
    return `0x${Math.floor(result).toString(16)}`
  }
  if (typeof result === "bigint") {
    return `0x${result.toString(16)}`
  }
  if (Array.isArray(result) && typeof result[0] === "string" && result[0]) {
    return result[0]
  }
  if (Array.isArray(result) && result[0] !== undefined) {
    return parseStarknetChainIdResult(result[0])
  }
  if (typeof result === "object" && result) {
    const fromChainId = parseStarknetChainIdResult((result as { chainId?: unknown }).chainId)
    if (fromChainId) return fromChainId
    const fromNetwork = parseStarknetChainIdResult((result as { network?: unknown }).network)
    if (fromNetwork) return fromNetwork
    const fromResult = parseStarknetChainIdResult((result as { result?: unknown }).result)
    if (fromResult) return fromResult
    const fromData = parseStarknetChainIdResult((result as { data?: unknown }).data)
    if (fromData) return fromData
  }
  return null
}

function isReadableStarknetChainId(chainId?: string): boolean {
  if (!chainId) return false
  const normalized = normalizeStarknetChainValue(chainId)
  if (!normalized) return false
  const upper = normalized.trim().toUpperCase()
  return upper !== "UNKNOWN" && upper !== "NULL" && upper !== "UNDEFINED"
}

function normalizeWalletError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error
  }
  if (typeof error === "string" && error.trim()) {
    return new Error(error.trim())
  }
  if (typeof error === "object" && error) {
    const messageCandidates = [
      (error as { message?: unknown }).message,
      (error as { reason?: unknown }).reason,
      (error as { data?: { message?: unknown } }).data?.message,
      (error as { error?: { message?: unknown } }).error?.message,
    ]
    const message = messageCandidates.find(
      (candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0
    )
    if (message) {
      const normalized = message.trim()
      if (/user rejected|user denied|rejected request/i.test(normalized)) {
        return new Error("Request rejected in wallet.")
      }
      if (/already pending|request of type .* already pending/i.test(normalized)) {
        return new Error("Wallet request already pending. Open wallet extension.")
      }
      if (/unknown chain|unsupported chain|chain .* not added|unrecognized chain/i.test(normalized)) {
        return new Error("Target network is not available in wallet.")
      }
      return new Error(normalized)
    }
    const code = (error as { code?: unknown }).code
    if (typeof code === "number") {
      if (code === 4001) return new Error("Request rejected in wallet.")
      if (code === -32002) return new Error("Wallet request already pending. Open wallet extension.")
      if (code === 4902) return new Error("Target network is not available in wallet.")
    }
  }
  return new Error(fallbackMessage)
}

async function readStarknetChainIdFromGetter(
  getter?: (() => Promise<unknown> | unknown) | null
): Promise<string | undefined> {
  if (!getter) return undefined
  try {
    const result = await getter()
    return parseStarknetChainIdResult(result) || undefined
  } catch {
    return undefined
  }
}

async function readEvmChainId(injected: InjectedEvm): Promise<number> {
  const chainHex = await injected.request({ method: "eth_chainId" })
  return parseEvmChainId(chainHex)
}

function parseEvmChainId(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    if (value.startsWith("0x")) {
      const parsed = Number.parseInt(value, 16)
      return Number.isFinite(parsed) ? parsed : 0
    }
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function sanitizeEvmAddress(address: string): string | null {
  const trimmed = address.trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null
  return trimmed
}

function sanitizeEvmAddressToWord(address: string): string | null {
  const normalized = sanitizeEvmAddress(address)
  if (!normalized) return null
  return normalized.slice(2).toLowerCase().padStart(64, "0")
}

function normalizeEvmDecimals(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampDecimals(value)
  }
  if (typeof value === "string" && value) {
    try {
      const parsed = value.startsWith("0x")
        ? Number.parseInt(value, 16)
        : Number.parseInt(value, 10)
      if (Number.isFinite(parsed)) {
        return clampDecimals(parsed)
      }
    } catch {
      return 18
    }
  }
  return 18
}

function clampDecimals(value: number): number {
  const rounded = Math.floor(value)
  if (rounded < 0) return 0
  if (rounded > 36) return 36
  return rounded
}

function parseBigIntLike(value: unknown): bigint | null {
  if (typeof value === "bigint") return value
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.floor(value))
  if (typeof value === "string" && value) {
    try {
      if (value.startsWith("0x")) return BigInt(value)
      if (/^[0-9]+$/.test(value)) return BigInt(value)
    } catch {
      return null
    }
  }
  return null
}

function scaleBigIntBalance(value: bigint, decimals: number): number | null {
  try {
    const divisor = pow10BigInt(decimals)
    const whole = Number(value / divisor)
    const fraction = Number(value % divisor) / Number(divisor)
    return whole + fraction
  } catch {
    return null
  }
}

async function requestBtcAccounts(injected: InjectedBtc): Promise<string[] | null> {
  const attempts = [
    () => injected.request?.({ method: "getAccounts", params: [{ network: "testnet" }] }),
    () => injected.request?.({ method: "requestAccounts", params: [{ network: "testnet" }] }),
    () => injected.request?.({ method: "getAccounts", params: ["testnet"] }),
    () => injected.request?.({ method: "requestAccounts", params: ["testnet"] }),
    () => injected.request?.({ method: "getAccounts" }),
    () => injected.request?.({ method: "requestAccounts" }),
    () => injected.getAccounts?.(),
    () => injected.requestAccounts?.(),
  ]

  for (const attempt of attempts) {
    try {
      const result = await attempt()
      const parsed = normalizeBtcAccounts(result)
      if (parsed.length > 0) {
        return parsed
      }
    } catch {
      // try next
    }
  }
  return null
}

type SatsConnectResultLike<T> =
  | {
      status: "success"
      result: T
    }
  | {
      status: "error"
      error?: { message?: string }
    }

function unwrapSatsConnectResult<T>(response: unknown, fallbackMessage: string): T {
  const parsed = response as SatsConnectResultLike<unknown> | null
  if (parsed?.status === "success") {
    return parsed.result as T
  }
  const message = parsed?.status === "error" ? parsed.error?.message?.trim() : ""
  throw new Error(message || fallbackMessage)
}

function normalizeXverseConnectError(error: unknown): Error {
  if (error instanceof Error) {
    const message = error.message.trim()
    if (/provider.*not found|not installed|extension/i.test(message)) {
      return new Error(
        "BTC wallet extension not detected. Install Xverse wallet (optional jika hanya pakai ETH/STRK)."
      )
    }
    if (/reject|cancel/i.test(message)) {
      return new Error("Request rejected in Xverse wallet.")
    }
    return new Error(message || "Failed to connect Xverse wallet.")
  }
  if (typeof error === "string" && error.trim()) {
    return new Error(error.trim())
  }
  return new Error("Failed to connect Xverse wallet.")
}

function extractBtcAddressFromSatsConnectAddresses(payload: unknown): string | null {
  if (!Array.isArray(payload)) return null
  const records = payload as Array<{
    address?: string
    purpose?: string
  }>
  const payment = records.find((record) => {
    const purpose = (record.purpose || "").toLowerCase()
    return purpose === "payment"
  })
  const fallback = payment || records[0]
  if (!fallback?.address) return null
  return normalizeBtcAddress(fallback.address)
}

function isXverseTestnetNetwork(name: unknown): boolean {
  if (typeof name !== "string") return false
  const normalized = name.toLowerCase()
  return (
    normalized.includes("testnet") ||
    normalized.includes("testnet4") ||
    normalized.includes("signet") ||
    normalized.includes("regtest")
  )
}

async function connectBtcWalletViaXverse(): Promise<{ address: string; balance: number | null }> {
  try {
    const sats = await import("sats-connect")
    const providerId = sats.DefaultAdaptersInfo?.xverse?.id || XVERSE_PROVIDER_ID
    if (!sats.isProviderInstalled(providerId)) {
      throw new Error(
        "BTC wallet extension not detected. Install Xverse wallet (optional jika hanya pakai ETH/STRK)."
      )
    }
    const request = sats.request as (
      method: string,
      params: unknown,
      providerId?: string
    ) => Promise<SatsConnectResultLike<unknown>>

    const connectResponse = await request(
      "wallet_connect",
      {
        addresses: [sats.AddressPurpose.Payment, sats.AddressPurpose.Ordinals],
        network: sats.BitcoinNetworkType.Testnet,
        message: XVERSE_CONNECT_MESSAGE,
      },
      providerId
    )
    const connectResult = unwrapSatsConnectResult<{
      addresses?: unknown
    }>(connectResponse, "Failed to connect Xverse wallet.")

    let btcAddress = extractBtcAddressFromSatsConnectAddresses(connectResult.addresses)

    if (!btcAddress) {
      const accountResponse = await request("wallet_getAccount", null, providerId)
      const accountResult = unwrapSatsConnectResult<{
        addresses?: unknown
      }>(accountResponse, "Failed to fetch account from Xverse wallet.")
      btcAddress = extractBtcAddressFromSatsConnectAddresses(accountResult.addresses)
    }

    if (!btcAddress) {
      const legacyResponse = await request(
        "getAccounts",
        { purposes: [sats.AddressPurpose.Payment], message: XVERSE_CONNECT_MESSAGE },
        providerId
      )
      const legacyResult = unwrapSatsConnectResult<unknown>(
        legacyResponse,
        "Failed to fetch payment account from Xverse wallet."
      )
      btcAddress = extractBtcAddressFromSatsConnectAddresses(legacyResult)
    }

    if (!btcAddress) {
      throw new Error("Xverse did not return a BTC payment address.")
    }

    try {
      const networkResponse = await request("wallet_getNetwork", null, providerId)
      const networkResult = unwrapSatsConnectResult<{
        bitcoin?: { name?: string }
      }>(networkResponse, "Failed to read Xverse network.")
      const networkName = networkResult.bitcoin?.name
      if (networkName && !isXverseTestnetNetwork(networkName)) {
        throw new Error(
          `Please switch Xverse network to Bitcoin Testnet before connecting. Current network: ${networkName}.`
        )
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Please switch Xverse network to Bitcoin Testnet")
      ) {
        throw error
      }
      const inferredNetwork = detectBtcAddressNetwork(btcAddress)
      if (inferredNetwork !== "testnet") {
        throw new Error("BTC wallet must be on Bitcoin testnet (native).")
      }
    }

    let btcBalance: number | null = null
    try {
      const balanceResponse = await request("getBalance", null, providerId)
      const balanceResult = unwrapSatsConnectResult<unknown>(balanceResponse, "Failed to read BTC balance.")
      btcBalance = normalizeBtcBalance(balanceResult)
    } catch {
      btcBalance = null
    }

    return { address: btcAddress, balance: btcBalance }
  } catch (error) {
    throw normalizeXverseConnectError(error)
  }
}

function normalizeBtcAccounts(result: unknown): string[] {
  if (typeof result === "string") {
    const normalized = normalizeBtcAddress(result)
    return normalized ? [normalized] : []
  }
  if (Array.isArray(result)) {
    return result.flatMap((item) => normalizeBtcAccounts(item))
  }
  if (!result || typeof result !== "object") return []

  const record = result as Record<string, unknown>
  const directKeys = ["address", "btcAddress", "paymentAddress", "ordinalAddress", "bitcoinAddress"]
  for (const key of directKeys) {
    const value = record[key]
    if (typeof value === "string") {
      const normalized = normalizeBtcAddress(value)
      if (normalized) return [normalized]
    }
  }

  const nestedKeys = ["accounts", "addresses", "result", "data", "wallets"]
  for (const key of nestedKeys) {
    if (key in record) {
      const parsed = normalizeBtcAccounts(record[key])
      if (parsed.length > 0) return parsed
    }
  }

  return []
}

function normalizeBtcAddress(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  const looksLikeBtcAddress =
    lower.startsWith("tb1") ||
    lower.startsWith("bcrt1") ||
    lower.startsWith("bc1") ||
    lower.startsWith("1") ||
    lower.startsWith("2") ||
    lower.startsWith("3") ||
    lower.startsWith("m") ||
    lower.startsWith("n")
  return looksLikeBtcAddress ? trimmed : null
}

async function fetchBtcBalance(injected: InjectedBtc, address: string): Promise<number | null> {
  const attempts = [
    () => injected.getBalance?.(address),
    () => injected.getBalance?.(),
    () => injected.request?.({ method: "getBalance", params: [address] }),
    () => injected.request?.({ method: "getBalance" }),
  ]

  for (const attempt of attempts) {
    try {
      const raw = await attempt()
      const normalized = normalizeBtcBalance(raw)
      if (normalized !== null) return normalized
    } catch {
      // try next
    }
  }
  return null
}

function normalizeBtcBalance(raw: any): number | null {
  if (raw === null || raw === undefined) return null
  const candidate =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
      ? Number(raw)
      : typeof raw === "object"
      ? Number(raw.total ?? raw.confirmed ?? raw.balance ?? raw.amount ?? raw.satoshi)
      : NaN
  if (!Number.isFinite(candidate)) return null
  // Heuristic: values larger than 1e6 are likely satoshis.
  if (candidate > 1_000_000) return candidate / 100_000_000
  return candidate
}

function normalizeTokenBalance(raw: any, decimals: number): number | null {
  if (raw === null || raw === undefined) return null
  const dec =
    typeof raw?.decimals === "number" && Number.isFinite(raw.decimals) ? raw.decimals : decimals
  const amount = toBigInt(raw)
  if (amount === null) return null
  try {
    const divisor = pow10BigInt(dec)
    const whole = Number(amount / divisor)
    const fraction = Number(amount % divisor) / Number(divisor)
    return whole + fraction
  } catch {
    return null
  }
}

function toBigInt(value: any): bigint | null {
  if (typeof value === "bigint") return value
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.floor(value))
  }
  if (typeof value === "string") {
    try {
      if (value.startsWith("0x")) return BigInt(value)
      if (/^[0-9]+$/.test(value)) return BigInt(value)
    } catch {
      return null
    }
  }
  if (typeof value === "object" && value) {
    if ("low" in value && "high" in value) {
      try {
        const low = toBigInt((value as any).low) ?? BigInt(0)
        const high = toBigInt((value as any).high) ?? BigInt(0)
        return (high << BigInt(128)) + low
      } catch {
        return null
      }
    }
    if ("amount" in value) return toBigInt((value as any).amount)
    if ("balance" in value) return toBigInt((value as any).balance)
  }
  return null
}

function pow10BigInt(exponent: number): bigint {
  const safeExponent = Number.isFinite(exponent) && exponent > 0 ? Math.floor(exponent) : 0
  let result = BigInt(1)
  const ten = BigInt(10)
  for (let i = 0; i < safeExponent; i += 1) {
    result *= ten
  }
  return result
}

function toShortString(value: string): string {
  if (value.length <= 31) return value
  return value.slice(0, 31)
}

function signatureToHex(signature: any): string {
  return normalizeSignatureValue(signature) || randomHex(32)
}

function normalizeSignatureValue(signature: any): string | null {
  if (!signature) return null
  if (typeof signature === "string") {
    const trimmed = signature.trim()
    if (!trimmed) return null
    return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`
  }
  if (Array.isArray(signature)) {
    if (signature.length === 0) return null
    const parts = signature.map((item) => feltToPaddedHex(item))
    return `0x${parts.join("")}`
  }
  if (typeof signature === "object" && "signature" in signature) {
    return normalizeSignatureValue(signature.signature)
  }
  return null
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
