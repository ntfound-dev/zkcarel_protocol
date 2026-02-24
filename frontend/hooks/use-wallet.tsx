"use client"

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react"
import {
  connectWallet,
  getLinkedWallets,
  getOnchainBalances,
  getPortfolioBalance,
  linkWalletAddress,
} from "@/lib/api"
import { emitEvent, onEvent } from "@/lib/events"
import {
  BTC_TESTNET_EXPLORER_BASE_URL,
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
    CAREL: number | null
    USDC: number | null
    USDT: number | null
    WBTC: number | null
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
  sendBtcTransaction: (toAddress: string, amountSats: number) => Promise<string>
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
const CAREL_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_CAREL_ADDRESS ||
  "0x0517f60f4ec4e1b2b748f0f642dfdcb32c0ddc893f777f2b595a4e4f6df51545"
const CAREL_DECIMALS = 18
const USDC_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_USDC_ADDRESS ||
  "0x0179cc8cb5ea0b143e17d649e8ad60d80c45c8132c4cf162d57eaf8297f529d8"
const USDC_DECIMALS = 6
const USDT_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_USDT_ADDRESS ||
  "0x030fcbfd1f83fb2d697ad8bdd52e1d55a700b876bed1f4507875539581ed53e5"
const USDT_DECIMALS = 6
const WBTC_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_WBTC_ADDRESS ||
  process.env.NEXT_PUBLIC_TOKEN_BTC_ADDRESS ||
  "0x496bef3ed20371382fbe0ca6a5a64252c5c848f9f1f0cccf8110fc4def912d5"
const WBTC_DECIMALS = 8
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
  referralCode: "referral_code",
}

const XVERSE_PROVIDER_ID = "XverseProviders.BitcoinProvider"
const XVERSE_CONNECT_MESSAGE = "Carel Protocol wants to connect your Bitcoin testnet wallet."
const UNISAT_NETWORK_VALIDATION_CACHE_MS = 45_000

/**
 * Handles `normalizeReferralCode` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function normalizeReferralCode(raw?: string | null): string | null {
  if (!raw) return null
  const upper = raw.trim().toUpperCase()
  if (!upper) return null
  const suffix = upper.startsWith("CAREL_") ? upper.slice(6) : upper
  if (suffix.length !== 8 || !/^[0-9A-F]+$/.test(suffix)) return null
  return `CAREL_${suffix}`
}

/**
 * Handles `readPendingReferralCode` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function readPendingReferralCode(): string | undefined {
  if (typeof window === "undefined") return undefined

  const stored = normalizeReferralCode(window.localStorage.getItem(STORAGE_KEYS.referralCode))
  if (stored) {
    window.localStorage.setItem(STORAGE_KEYS.referralCode, stored)
    return stored
  }

  const fromQuery = normalizeReferralCode(new URLSearchParams(window.location.search).get("ref"))
  if (fromQuery) {
    window.localStorage.setItem(STORAGE_KEYS.referralCode, fromQuery)
    return fromQuery
  }

  return undefined
}

/**
 * Handles `createInitialWalletState` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function createInitialWalletState(): WalletState {
  return {
    isConnected: false,
    address: null,
    provider: null,
    balance: { ...defaultBalance },
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

/**
 * Handles `clearWalletStorage` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function clearWalletStorage() {
  if (typeof window === "undefined") return
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

/**
 * Handles `WalletProvider` in the wallet client flow.
 *
 * @param children - Input used to compute or dispatch the `WalletProvider` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletState>(() => createInitialWalletState())
  const onchainRefreshInFlightRef = useRef(false)
  const unisatNetworkValidatedUntilRef = useRef(0)
  const portfolioBalanceHintRef = useRef<Record<string, number>>({ ...defaultBalance })

  const resetWalletSession = useCallback(() => {
    clearWalletStorage()
    setWallet(createInitialWalletState())
    emitEvent("wallet:disconnected", { address: null, provider: null })
  }, [])

  const updateBalance = useCallback((symbol: string, amount: number) => {
    setWallet((prev) => ({
      ...prev,
      balance: {
        ...prev.balance,
        [symbol.toUpperCase()]: amount,
      },
    }))
  }, [])

  useEffect(() => {
    const unsubscribe = onEvent("auth:expired", () => {
      resetWalletSession()
    })
    return () => unsubscribe()
  }, [resetWalletSession])

  useEffect(() => {
    portfolioBalanceHintRef.current = { ...wallet.balance }
  }, [wallet.balance])

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
    const effectiveStarknetAddress =
      wallet.starknetAddress || (wallet.network === "starknet" ? wallet.address : null)
    if (!effectiveStarknetAddress && !wallet.evmAddress && !wallet.btcAddress) return
    if (onchainRefreshInFlightRef.current) return
    onchainRefreshInFlightRef.current = true

    try {
      const requestPayload = {
        starknet_address: effectiveStarknetAddress,
        evm_address: wallet.evmAddress,
        btc_address: wallet.btcAddress,
      }
      let response: Awaited<ReturnType<typeof getOnchainBalances>> | null = null
      if (wallet.token) {
        try {
          response = await getOnchainBalances(requestPayload)
        } catch {
          // fallback to direct wallet reads
        }
      }

      const resolved = {
        STRK_L2: response?.strk_l2 ?? null,
        STRK_L1: response?.strk_l1 ?? null,
        ETH: response?.eth ?? null,
        BTC: response?.btc ?? null,
        CAREL: response?.carel ?? null,
        USDC: response?.usdc ?? null,
        USDT: response?.usdt ?? null,
        WBTC: response?.wbtc ?? null,
      }
      const portfolioHints = portfolioBalanceHintRef.current
      const portfolioHint = (tokenSymbol: string) => Number(portfolioHints[tokenSymbol] || 0)
      const needsForceRefresh = (onchainValue: number | null, tokenSymbol: string) =>
        portfolioHint(tokenSymbol) > 0 &&
        (onchainValue === null ||
          (typeof onchainValue === "number" && Number.isFinite(onchainValue) && onchainValue <= 0))
      const needsWalletRead = (onchainValue: number | null, tokenSymbol: string) =>
        onchainValue === null ||
        (portfolioHint(tokenSymbol) > 0 &&
          typeof onchainValue === "number" &&
          Number.isFinite(onchainValue) &&
          onchainValue <= 0)

      if (
        wallet.token &&
        effectiveStarknetAddress &&
        (needsForceRefresh(resolved.STRK_L2, "STRK") ||
          needsForceRefresh(resolved.CAREL, "CAREL") ||
          needsForceRefresh(resolved.USDC, "USDC") ||
          needsForceRefresh(resolved.USDT, "USDT") ||
          needsForceRefresh(resolved.WBTC, "WBTC"))
      ) {
        try {
          const forced = await getOnchainBalances(requestPayload, { force: true })
          resolved.STRK_L2 = forced?.strk_l2 ?? resolved.STRK_L2
          resolved.CAREL = forced?.carel ?? resolved.CAREL
          resolved.USDC = forced?.usdc ?? resolved.USDC
          resolved.USDT = forced?.usdt ?? resolved.USDT
          resolved.WBTC = forced?.wbtc ?? resolved.WBTC
        } catch {
          // continue with existing values + direct wallet reads
        }
      }

      const starknet =
        effectiveStarknetAddress
          ? (wallet.provider && isStarknetWalletProvider(wallet.provider)
              ? getInjectedStarknet(wallet.provider)
              : null) ||
            getInjectedStarknet("braavos") ||
            getInjectedStarknet("starknet")
          : null

      if (effectiveStarknetAddress && starknet) {
        if (needsWalletRead(resolved.STRK_L2, "STRK")) {
          resolved.STRK_L2 = await fetchStarknetTokenBalance(
            starknet,
            effectiveStarknetAddress,
            STRK_TOKEN_ADDRESS,
            STRK_DECIMALS
          )
        }
        if (needsWalletRead(resolved.CAREL, "CAREL")) {
          resolved.CAREL = await fetchStarknetTokenBalance(
            starknet,
            effectiveStarknetAddress,
            CAREL_TOKEN_ADDRESS,
            CAREL_DECIMALS
          )
        }
        if (needsWalletRead(resolved.USDC, "USDC")) {
          resolved.USDC = await fetchStarknetTokenBalance(
            starknet,
            effectiveStarknetAddress,
            USDC_TOKEN_ADDRESS,
            USDC_DECIMALS
          )
        }
        if (needsWalletRead(resolved.USDT, "USDT")) {
          resolved.USDT = await fetchStarknetTokenBalance(
            starknet,
            effectiveStarknetAddress,
            USDT_TOKEN_ADDRESS,
            USDT_DECIMALS
          )
        }
        // Use direct Starknet wallet read as source-of-truth for WBTC whenever possible.
        const walletWbtcBalance = await fetchStarknetTokenBalance(
          starknet,
          effectiveStarknetAddress,
          WBTC_TOKEN_ADDRESS,
          WBTC_DECIMALS
        )
        if (typeof walletWbtcBalance === "number" && Number.isFinite(walletWbtcBalance)) {
          resolved.WBTC = walletWbtcBalance
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

      // Combine direct extension + public mempool-aware balance.
      // We take the lower value when both exist to avoid stale extension reads
      // after a fresh outgoing BTC transaction.
      if (wallet.btcAddress) {
        let directBtcBalance: number | null = null
        const injectedBtc =
          getInjectedBtc(wallet.btcProvider || "unisat") ||
          getInjectedBtc("unisat") ||
          getInjectedBtc("xverse") ||
          getInjectedBtc("braavos_btc")
        if (injectedBtc) {
          directBtcBalance = await fetchBtcBalance(injectedBtc, wallet.btcAddress)
          if (typeof directBtcBalance === "number" && Number.isFinite(directBtcBalance)) {
            resolved.BTC = directBtcBalance
          }
        }
        const publicBtcBalance = await fetchBtcBalanceFromPublicApis(wallet.btcAddress)
        if (
          typeof directBtcBalance === "number" &&
          Number.isFinite(directBtcBalance) &&
          typeof publicBtcBalance === "number" &&
          Number.isFinite(publicBtcBalance)
        ) {
          resolved.BTC = Math.min(directBtcBalance, publicBtcBalance)
        } else if (
          (resolved.BTC === null || !Number.isFinite(resolved.BTC)) &&
          typeof publicBtcBalance === "number" &&
          Number.isFinite(publicBtcBalance)
        ) {
          resolved.BTC = publicBtcBalance
        }
        if (resolved.BTC === null) {
          resolved.BTC = 0
        }
      }

      if (effectiveStarknetAddress) {
        if (resolved.STRK_L2 === null) resolved.STRK_L2 = 0
        if (resolved.CAREL === null) resolved.CAREL = 0
        if (resolved.USDC === null) resolved.USDC = 0
        if (resolved.USDT === null) resolved.USDT = 0
        if (resolved.WBTC === null) resolved.WBTC = 0
      }
      if (wallet.evmAddress) {
        if (resolved.ETH === null) resolved.ETH = 0
        if (resolved.STRK_L1 === null) resolved.STRK_L1 = 0
      }

      setWallet((prev) => ({
        ...prev,
        balance: {
          ...prev.balance,
          ETH:
            wallet.evmAddress && resolved.ETH !== null ? resolved.ETH : prev.balance.ETH,
          STRK:
            effectiveStarknetAddress
              ? resolved.STRK_L2 ?? prev.balance.STRK
              : prev.balance.STRK,
          CAREL:
            effectiveStarknetAddress
              ? resolved.CAREL ?? prev.balance.CAREL
              : prev.balance.CAREL,
          USDC:
            effectiveStarknetAddress
              ? resolved.USDC ?? prev.balance.USDC
              : prev.balance.USDC,
          USDT:
            effectiveStarknetAddress
              ? resolved.USDT ?? prev.balance.USDT
              : prev.balance.USDT,
          WBTC:
            effectiveStarknetAddress
              ? resolved.WBTC ?? prev.balance.WBTC
              : prev.balance.WBTC,
          BTC:
            wallet.btcAddress && resolved.BTC !== null ? resolved.BTC : prev.balance.BTC,
        },
        onchainBalance: {
          STRK_L2: effectiveStarknetAddress
            ? resolved.STRK_L2 ?? prev.onchainBalance.STRK_L2
            : prev.onchainBalance.STRK_L2,
          STRK_L1: resolved.STRK_L1 ?? prev.onchainBalance.STRK_L1,
          ETH: resolved.ETH ?? prev.onchainBalance.ETH,
          BTC: resolved.BTC ?? prev.onchainBalance.BTC,
          CAREL: effectiveStarknetAddress
            ? resolved.CAREL ?? prev.onchainBalance.CAREL
            : prev.onchainBalance.CAREL,
          USDC: effectiveStarknetAddress
            ? resolved.USDC ?? prev.onchainBalance.USDC
            : prev.onchainBalance.USDC,
          USDT: effectiveStarknetAddress
            ? resolved.USDT ?? prev.onchainBalance.USDT
            : prev.onchainBalance.USDT,
          WBTC: effectiveStarknetAddress
            ? resolved.WBTC ?? prev.onchainBalance.WBTC
            : prev.onchainBalance.WBTC,
        },
      }))
    } finally {
      onchainRefreshInFlightRef.current = false
    }
  }, [wallet.token, wallet.starknetAddress, wallet.evmAddress, wallet.btcAddress, wallet.btcProvider, wallet.provider, wallet.network, wallet.address])

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
          provider: wallet.btcProvider || "unisat",
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
    const effectiveStarknetAddress =
      wallet.starknetAddress || (wallet.network === "starknet" ? wallet.address : null)
    if (!effectiveStarknetAddress && !wallet.evmAddress && !wallet.btcAddress) return

    void refreshOnchainBalances()

    if (typeof window === "undefined") return
    const interval = window.setInterval(() => {
      void refreshOnchainBalances()
    }, 45000)

    return () => {
      window.clearInterval(interval)
    }
  }, [wallet.token, wallet.starknetAddress, wallet.evmAddress, wallet.btcAddress, wallet.network, wallet.address, refreshOnchainBalances])

  const connect = useCallback(async (provider: WalletProviderType) => {
    const message = `Carel Protocol login ${Math.floor(Date.now() / 1000)}`
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
      CAREL: null as number | null,
      USDC: null as number | null,
      USDT: null as number | null,
      WBTC: null as number | null,
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

    const normalizeSessionAddress = (value?: string | null) => (value || "").trim().toLowerCase()
    const previousSameChainAddress =
      network === "starknet"
        ? wallet.starknetAddress || (wallet.network === "starknet" ? wallet.address : null)
        : wallet.evmAddress || (wallet.network === "evm" ? wallet.address : null)
    const switchingSameChainIdentity =
      !!previousSameChainAddress &&
      normalizeSessionAddress(previousSameChainAddress) !== normalizeSessionAddress(address)

    if (wallet.isConnected && wallet.token && wallet.address && !switchingSameChainIdentity) {
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
      const referralCode = readPendingReferralCode()
      const auth = await connectWallet({
        address,
        signature,
        message,
        chain_id: chainId,
        wallet_type: network === "evm" ? "evm" : "starknet",
        referral_code: referralCode,
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
        window.localStorage.removeItem(STORAGE_KEYS.referralCode)
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
        CAREL: onchain.CAREL ?? prev.onchainBalance.CAREL,
        USDC: onchain.USDC ?? prev.onchainBalance.USDC,
        USDT: onchain.USDT ?? prev.onchainBalance.USDT,
        WBTC: onchain.WBTC ?? prev.onchainBalance.WBTC,
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
    const requestedAddress = address || "0x0000000000000000000000000000000000000000"
    let resolvedAddress = requestedAddress
    let token: string | null = null
    try {
      const referralCode = readPendingReferralCode()
      const auth = await connectWallet({
        address: requestedAddress,
        signature: "",
        message: "",
        chain_id: 0,
        sumo_login_token: sumoToken,
        referral_code: referralCode,
      })
      token = auth.token
      resolvedAddress = auth.user.address || requestedAddress
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEYS.token, auth.token)
        window.localStorage.setItem(STORAGE_KEYS.address, resolvedAddress)
        window.localStorage.setItem(STORAGE_KEYS.provider, "")
        window.localStorage.setItem(STORAGE_KEYS.network, "starknet")
        window.localStorage.removeItem(STORAGE_KEYS.referralCode)
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
      address: resolvedAddress,
      provider: prev.provider,
      network: "starknet",
      token,
    }))
    emitEvent("wallet:connected", { address: resolvedAddress, provider: null })
    return !!token
  }, [])

  const ensureBtcAuthSession = useCallback(
    async (btcAddress: string, injected: InjectedBtc | null): Promise<{ token: string; address: string }> => {
      if (wallet.token && wallet.address) {
        return { token: wallet.token, address: wallet.address }
      }

      const message = `Carel Protocol BTC login ${Math.floor(Date.now() / 1000)}`
      const signature = await requestBtcAuthSignature(injected, message)
      const referralCode = readPendingReferralCode()
      const auth = await connectWallet({
        address: btcAddress,
        signature,
        message,
        chain_id: 0,
        wallet_type: "bitcoin",
        referral_code: referralCode,
      })
      const canonicalAddress = auth.user.address || btcAddress

      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEYS.token, auth.token)
        window.localStorage.setItem(STORAGE_KEYS.address, canonicalAddress)
        window.localStorage.setItem(STORAGE_KEYS.provider, "")
        window.localStorage.setItem(STORAGE_KEYS.network, "bitcoin")
        window.localStorage.removeItem(STORAGE_KEYS.referralCode)
      }

      return {
        token: auth.token,
        address: canonicalAddress,
      }
    },
    [wallet.address, wallet.token]
  )

  const connectBtcWallet = useCallback(async (provider: BtcWalletProviderType) => {
    let btcAddress = ""
    let btcBalance: number | null = null
    let injected: InjectedBtc | null = null

    if (provider === "xverse") {
      const result = await connectBtcWalletViaXverse()
      btcAddress = result.address
      btcBalance = result.balance
      injected = getInjectedBtc("xverse")
    } else {
      injected = getInjectedBtc(provider)
      if (!injected) {
        throw new Error(
          "BTC wallet extension not detected. Install UniSat or Xverse (optional jika hanya pakai ETH/STRK)."
        )
      }
      const accounts = await requestBtcAccounts(injected)
      btcAddress = accounts?.[0] || ""
      if (!btcAddress) {
        throw new Error("BTC wallet not connected")
      }
      if (provider === "unisat") {
        await ensureUniSatTestnet4(injected)
      }
      const btcNetwork = detectBtcAddressNetwork(btcAddress)
      if (btcNetwork !== "testnet") {
        throw new Error("BTC wallet must be on Bitcoin testnet (native).")
      }
      btcBalance = await fetchBtcBalance(injected, btcAddress)
      if (btcBalance === null) {
        btcBalance = await fetchBtcBalanceFromPublicApis(btcAddress)
      }
      if (btcBalance === null) {
        btcBalance = 0
      }
    }

    let activeToken = wallet.token || null
    let activeAddress = wallet.address || btcAddress
    try {
      const session = await ensureBtcAuthSession(btcAddress, injected)
      activeToken = session.token
      activeAddress = session.address
    } catch (error) {
      console.warn("BTC auth fallback to local-only session:", error)
    }

    setWallet((prev) => ({
      ...prev,
      isConnected: prev.isConnected || Boolean(activeToken),
      address: activeAddress,
      token: activeToken,
      network: prev.isConnected ? prev.network : "bitcoin",
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
      if (activeToken) {
        window.localStorage.setItem(STORAGE_KEYS.token, activeToken)
        window.localStorage.setItem(STORAGE_KEYS.address, activeAddress)
        window.localStorage.setItem(STORAGE_KEYS.network, "bitcoin")
      }
    }

    if (activeToken) {
      try {
        await linkWalletAddress({ chain: "bitcoin", address: btcAddress, provider })
      } catch {
        // keep local linked BTC even if backend link fails
      }
    }
  }, [ensureBtcAuthSession, wallet.address, wallet.token])

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
      if (btcBalance === null) {
        btcBalance = await fetchBtcBalanceFromPublicApis(btcAddress)
      }
      if (btcBalance === null) {
        btcBalance = 0
      }
    }

    let activeToken = wallet.token || null
    let activeAddress = wallet.address || btcAddress
    try {
      const session = await ensureBtcAuthSession(btcAddress, injected)
      activeToken = session.token
      activeAddress = session.address
    } catch (error) {
      console.warn("Manual BTC auth fallback to local-only session:", error)
    }

    setWallet((prev) => ({
      ...prev,
      isConnected: prev.isConnected || Boolean(activeToken),
      address: activeAddress,
      token: activeToken,
      network: prev.isConnected ? prev.network : "bitcoin",
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
      if (activeToken) {
        window.localStorage.setItem(STORAGE_KEYS.token, activeToken)
        window.localStorage.setItem(STORAGE_KEYS.address, activeAddress)
        window.localStorage.setItem(STORAGE_KEYS.network, "bitcoin")
      }
    }
    if (activeToken) {
      try {
        await linkWalletAddress({ chain: "bitcoin", address: btcAddress, provider: "manual" })
      } catch {
        // keep local linked BTC even if backend link fails
      }
    }
  }, [ensureBtcAuthSession, wallet.address, wallet.token])

  const sendBtcTransaction = useCallback(
    async (toAddress: string, amountSats: number): Promise<string> => {
      if (!wallet.btcAddress) {
        throw new Error("Connect BTC wallet first before sending.")
      }
      const destination = normalizeBtcAddress(toAddress)
      if (!destination) {
        throw new Error("Invalid BTC destination address.")
      }
      if (detectBtcAddressNetwork(destination) !== "testnet") {
        throw new Error("Destination BTC address must be Bitcoin testnet.")
      }
      if (!Number.isFinite(amountSats) || amountSats <= 0) {
        throw new Error("BTC amount must be greater than 0 sat.")
      }
      const roundedSats = Math.floor(amountSats)
      if (roundedSats <= 0) {
        throw new Error("BTC amount must be at least 1 sat.")
      }

      const activeProvider = wallet.btcProvider || "unisat"
      let xverseError: unknown = null
      if (activeProvider === "xverse") {
        try {
          const txHash = await sendBtcTransferViaXverse(destination, roundedSats)
          const sentAmount = roundedSats / 100_000_000
          setWallet((prev) => {
            const baseBalance =
              typeof prev.onchainBalance.BTC === "number" && Number.isFinite(prev.onchainBalance.BTC)
                ? prev.onchainBalance.BTC
                : prev.balance.BTC
            const nextBalance = Math.max(0, (baseBalance || 0) - sentAmount)
            return {
              ...prev,
              balance: {
                ...prev.balance,
                BTC: nextBalance,
              },
              onchainBalance: {
                ...prev.onchainBalance,
                BTC: nextBalance,
              },
            }
          })
          if (typeof window !== "undefined") {
            window.setTimeout(() => {
              void refreshOnchainBalances()
            }, 1200)
          }
          return txHash
        } catch (error) {
          xverseError = error
        }
      }

      const injected =
        getInjectedBtc(activeProvider) ||
        getInjectedBtc("unisat") ||
        getInjectedBtc("xverse") ||
        getInjectedBtc("braavos_btc")
      if (!injected) {
        if (xverseError) {
          throw normalizeWalletError(xverseError, "Failed to send BTC from Xverse wallet.")
        }
        throw new Error("BTC wallet extension not detected. Install UniSat or Xverse.")
      }
      if (activeProvider === "unisat") {
        const now = Date.now()
        if (now > unisatNetworkValidatedUntilRef.current) {
          await ensureUniSatTestnet4(injected)
          unisatNetworkValidatedUntilRef.current = now + UNISAT_NETWORK_VALIDATION_CACHE_MS
        }
      }
      try {
        const txHash = await sendBtcTransferWithInjectedWallet(injected, destination, roundedSats)
        const sentAmount = roundedSats / 100_000_000
        setWallet((prev) => {
          const baseBalance =
            typeof prev.onchainBalance.BTC === "number" && Number.isFinite(prev.onchainBalance.BTC)
              ? prev.onchainBalance.BTC
              : prev.balance.BTC
          const nextBalance = Math.max(0, (baseBalance || 0) - sentAmount)
          return {
            ...prev,
            balance: {
              ...prev.balance,
              BTC: nextBalance,
            },
            onchainBalance: {
              ...prev.onchainBalance,
              BTC: nextBalance,
            },
          }
        })
        if (typeof window !== "undefined") {
          window.setTimeout(() => {
            void refreshOnchainBalances()
          }, 1200)
        }
        return txHash
      } catch (error) {
        if (activeProvider === "unisat") {
          unisatNetworkValidatedUntilRef.current = 0
        }
        if (xverseError) {
          throw normalizeWalletError(xverseError, "Failed to send BTC from Xverse wallet.")
        }
        throw normalizeWalletError(error, "Failed to send BTC from wallet.")
      }
    },
    [refreshOnchainBalances, wallet.btcAddress, wallet.btcProvider]
  )

  const disconnect = useCallback(() => {
    resetWalletSession()
  }, [resetWalletSession])

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
        sendBtcTransaction,
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

/**
 * Handles `isUsableStarknetInjected` in the wallet client flow.
 *
 * @param candidate - Input used to compute or dispatch the `isUsableStarknetInjected` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `pickInjectedStarknet` in the wallet client flow.
 *
 * @param candidates - Input used to compute or dispatch the `pickInjectedStarknet` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function pickInjectedStarknet(...candidates: unknown[]): InjectedStarknet | null {
  for (const candidate of candidates) {
    if (isUsableStarknetInjected(candidate)) {
      return candidate
    }
  }
  return null
}

/**
 * Handles `getInjectedStarknet` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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
  signMessage?: (message: string, type?: string) => Promise<any>
  sendBitcoin?: (address: string, amount: number) => Promise<any>
  getBalance?: (address?: string) => Promise<any>
  getBalanceV2?: () => Promise<any>
  getChain?: () => Promise<any>
  switchChain?: (chain: string) => Promise<any>
  disconnect?: () => Promise<void>
}

/**
 * Handles `isInjectedBtc` in the wallet client flow.
 *
 * @param candidate - Input used to compute or dispatch the `isInjectedBtc` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `pickInjectedBtc` in the wallet client flow.
 *
 * @param candidates - Input used to compute or dispatch the `pickInjectedBtc` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function pickInjectedBtc(...candidates: unknown[]): InjectedBtc | null {
  for (const candidate of candidates) {
    if (isInjectedBtc(candidate)) return candidate
  }
  return null
}

/**
 * Handles `isStarknetWalletProvider` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function isStarknetWalletProvider(
  provider: WalletProviderType
): provider is "starknet" | "argentx" | "braavos" {
  return provider === "starknet" || provider === "argentx" || provider === "braavos"
}

/**
 * Handles `getInjectedEvm` in the wallet client flow.
 *
 * @param provider - Input used to compute or dispatch the `getInjectedEvm` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function getInjectedEvm(provider: WalletProviderType): InjectedEvm | null {
  if (typeof window === "undefined") return null
  const anyWindow = window as any
  const ethereum = anyWindow.ethereum as InjectedEvm | undefined
  const providers = ethereum?.providers?.length ? ethereum.providers : []

  /**
   * Handles `isMetaMask` in the wallet client flow.
   *
   * @returns Result used by UI state, request lifecycle, or callback chaining.
   * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
   */
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

/**
 * Handles `getPreferredEvmProvider` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function getPreferredEvmProvider(provider?: WalletProviderType | null): InjectedEvm | null {
  if (provider === "metamask") {
    return getInjectedEvm("metamask")
  }
  return getInjectedEvm("metamask")
}

/**
 * Handles `getInjectedBtc` in the wallet client flow.
 *
 * @param provider - Input used to compute or dispatch the `getInjectedBtc` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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
    return pickInjectedBtc(
      anyWindow.unisat_wallet,
      anyWindow.unisatWallet,
      anyWindow.unisat,
      genericBtc
    )
  }
  return genericBtc
}

/**
 * Handles `connectStarknetWallet` in the wallet client flow.
 *
 * @param provider - Input used to compute or dispatch the `connectStarknetWallet` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `getStarknetIncludeFilter` in the wallet client flow.
 *
 * @param provider - Input used to compute or dispatch the `getStarknetIncludeFilter` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function getStarknetIncludeFilter(provider: WalletProviderType): string[] | undefined {
  if (provider === "argentx" || provider === "braavos") {
    return STARKNET_PROVIDER_ID_ALIASES[provider]
  }
  return undefined
}

/**
 * Handles `selectStarknetWallet` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `hasStarknetProviderAlias` in the wallet client flow.
 *
 * @param wallet - Input used to compute or dispatch the `hasStarknetProviderAlias` operation.
 * @param aliases - Input used to compute or dispatch the `hasStarknetProviderAlias` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function hasStarknetProviderAlias(wallet: InjectedStarknet, aliases: string[]): boolean {
  const id = normalizeProviderHint(wallet.id)
  const name = normalizeProviderHint(wallet.name)
  return aliases.some((alias) => {
    const needle = normalizeProviderHint(alias)
    return (!!id && id.includes(needle)) || (!!name && name.includes(needle))
  })
}

/**
 * Handles `normalizeProviderHint` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function normalizeProviderHint(value?: string): string {
  if (!value) return ""
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/**
 * Handles `normalizeChainId` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `signStarknetMessage` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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
      name: "Carel Protocol",
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

/**
 * Handles `requestAccounts` in the wallet client flow.
 *
 * @param injected - Input used to compute or dispatch the `requestAccounts` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `fetchStarknetBalance` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
async function fetchStarknetBalance(
  injected: InjectedStarknet,
  address: string
): Promise<number | null> {
  return fetchStarknetTokenBalance(injected, address, STRK_TOKEN_ADDRESS, STRK_DECIMALS)
}

/**
 * Handles `fetchStarknetTokenBalance` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
async function fetchStarknetTokenBalance(
  injected: InjectedStarknet,
  address: string,
  tokenAddress: string,
  decimals: number
): Promise<number | null> {
  const target: any = injected.account || injected
  if (!target?.getBalance || !address || !tokenAddress) return null

  const attempts = [
    () => target.getBalance(address, "latest", tokenAddress),
    () => target.getBalance(address, tokenAddress),
    () => target.getBalance(tokenAddress),
  ]

  for (const attempt of attempts) {
    try {
      const raw = await attempt()
      const normalized = normalizeTokenBalance(raw, decimals)
      if (normalized !== null) return normalized
    } catch {
      // try next signature
    }
  }

  return null
}

/**
 * Handles `fetchEvmBalance` in the wallet client flow.
 *
 * @param injected - Input used to compute or dispatch the `fetchEvmBalance` operation.
 * @param address - Input used to compute or dispatch the `fetchEvmBalance` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
async function fetchEvmBalance(injected: InjectedEvm, address: string): Promise<number | null> {
  try {
    const raw = await injected.request({ method: "eth_getBalance", params: [address, "latest"] })
    return normalizeEvmBalance(raw)
  } catch {
    return null
  }
}

/**
 * Handles `fetchEvmErc20Balance` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `normalizeEvmBalance` in the wallet client flow.
 *
 * @param value - Input used to compute or dispatch the `normalizeEvmBalance` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `ensureEvmSepolia` in the wallet client flow.
 *
 * @param injected - Input used to compute or dispatch the `ensureEvmSepolia` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `ensureStarknetSepolia` in the wallet client flow.
 *
 * @param injected - Input used to compute or dispatch the `ensureStarknetSepolia` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `readStarknetChainId` in the wallet client flow.
 *
 * @param injected - Input used to compute or dispatch the `readStarknetChainId` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `requestStarknet` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `buildStarknetRequestVariants` in the wallet client flow.
 *
 * @param payload - Input used to compute or dispatch the `buildStarknetRequestVariants` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `parseStarknetChainIdResult` in the wallet client flow.
 *
 * @param result - Input used to compute or dispatch the `parseStarknetChainIdResult` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `isReadableStarknetChainId` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function isReadableStarknetChainId(chainId?: string): boolean {
  if (!chainId) return false
  const normalized = normalizeStarknetChainValue(chainId)
  if (!normalized) return false
  const upper = normalized.trim().toUpperCase()
  return upper !== "UNKNOWN" && upper !== "NULL" && upper !== "UNDEFINED"
}

/**
 * Handles `normalizeWalletError` in the wallet client flow.
 *
 * @param error - Input used to compute or dispatch the `normalizeWalletError` operation.
 * @param fallbackMessage - Input used to compute or dispatch the `normalizeWalletError` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `readStarknetChainIdFromGetter` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `readEvmChainId` in the wallet client flow.
 *
 * @param injected - Input used to compute or dispatch the `readEvmChainId` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
async function readEvmChainId(injected: InjectedEvm): Promise<number> {
  const chainHex = await injected.request({ method: "eth_chainId" })
  return parseEvmChainId(chainHex)
}

/**
 * Handles `parseEvmChainId` in the wallet client flow.
 *
 * @param value - Input used to compute or dispatch the `parseEvmChainId` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `sanitizeEvmAddress` in the wallet client flow.
 *
 * @param address - Input used to compute or dispatch the `sanitizeEvmAddress` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function sanitizeEvmAddress(address: string): string | null {
  const trimmed = address.trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null
  return trimmed
}

/**
 * Handles `sanitizeEvmAddressToWord` in the wallet client flow.
 *
 * @param address - Input used to compute or dispatch the `sanitizeEvmAddressToWord` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function sanitizeEvmAddressToWord(address: string): string | null {
  const normalized = sanitizeEvmAddress(address)
  if (!normalized) return null
  return normalized.slice(2).toLowerCase().padStart(64, "0")
}

/**
 * Handles `normalizeEvmDecimals` in the wallet client flow.
 *
 * @param value - Input used to compute or dispatch the `normalizeEvmDecimals` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `clampDecimals` in the wallet client flow.
 *
 * @param value - Input used to compute or dispatch the `clampDecimals` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function clampDecimals(value: number): number {
  const rounded = Math.floor(value)
  if (rounded < 0) return 0
  if (rounded > 36) return 36
  return rounded
}

/**
 * Handles `parseBigIntLike` in the wallet client flow.
 *
 * @param value - Input used to compute or dispatch the `parseBigIntLike` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `scaleBigIntBalance` in the wallet client flow.
 *
 * @param value - Input used to compute or dispatch the `scaleBigIntBalance` operation.
 * @param decimals - Input used to compute or dispatch the `scaleBigIntBalance` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `requestBtcAccounts` in the wallet client flow.
 *
 * @param injected - Input used to compute or dispatch the `requestBtcAccounts` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
async function requestBtcAccounts(injected: InjectedBtc): Promise<string[] | null> {
  const attempts = [
    () => injected.requestAccounts?.(),
    () => injected.request?.({ method: "requestAccounts" }),
    () => injected.request?.({ method: "requestAccounts", params: [{ network: "testnet" }] }),
    () => injected.request?.({ method: "requestAccounts", params: ["testnet"] }),
    () => injected.getAccounts?.(),
    () => injected.request?.({ method: "getAccounts" }),
    () => injected.request?.({ method: "getAccounts", params: [{ network: "testnet" }] }),
    () => injected.request?.({ method: "getAccounts", params: ["testnet"] }),
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

/**
 * Handles `normalizeBtcAuthSignature` in the wallet client flow.
 *
 * @param raw - Input used to compute or dispatch the `normalizeBtcAuthSignature` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function normalizeBtcAuthSignature(raw: unknown): string {
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (trimmed) {
      if (trimmed.startsWith("0x")) {
        const body = trimmed
          .slice(2)
          .replace(/[^0-9a-f]/gi, "")
          .toLowerCase()
        if (body.length >= 64) {
          return `0x${body}`
        }
        return `0x${(body + "0".repeat(64)).slice(0, 64)}`
      }
      const hex = Array.from(new TextEncoder().encode(trimmed))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
      if (hex.length >= 64) {
        return `0x${hex.slice(0, 64)}`
      }
      return `0x${(hex + "0".repeat(64)).slice(0, 64)}`
    }
  }
  return `0x${"b".repeat(64)}`
}

/**
 * Handles `requestBtcAuthSignature` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
async function requestBtcAuthSignature(
  injected: InjectedBtc | null,
  message: string
): Promise<string> {
  if (!injected) {
    return `0x${"b".repeat(64)}`
  }
  const attempts = [
    () => injected.signMessage?.(message),
    () => injected.signMessage?.(message, "ecdsa"),
    () => injected.request?.({ method: "signMessage", params: [message] }),
    () => injected.request?.({ method: "signMessage", params: [message, "ecdsa"] }),
    () => injected.request?.({ method: "signMessage", params: [{ message }] }),
    () => injected.request?.({ method: "personal_sign", params: [message] }),
  ]
  for (const attempt of attempts) {
    try {
      const result = await attempt()
      return normalizeBtcAuthSignature(result)
    } catch {
      // try next
    }
  }
  return `0x${"b".repeat(64)}`
}

type BtcChainInfo = {
  enum?: string
  name?: string
  network?: string
}

/**
 * Handles `normalizeBtcChainInfo` in the wallet client flow.
 *
 * @param raw - Input used to compute or dispatch the `normalizeBtcChainInfo` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function normalizeBtcChainInfo(raw: unknown): BtcChainInfo | null {
  if (!raw || typeof raw !== "object") return null
  const record = raw as Record<string, unknown>
  const enumValue = typeof record.enum === "string" ? record.enum : undefined
  const nameValue = typeof record.name === "string" ? record.name : undefined
  const networkValue = typeof record.network === "string" ? record.network : undefined
  if (!enumValue && !nameValue && !networkValue) return null
  return {
    enum: enumValue,
    name: nameValue,
    network: networkValue,
  }
}

/**
 * Handles `getBtcChainInfo` in the wallet client flow.
 *
 * @param injected - Input used to compute or dispatch the `getBtcChainInfo` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
async function getBtcChainInfo(injected: InjectedBtc): Promise<BtcChainInfo | null> {
  const attempts = [
    () => injected.getChain?.(),
    () => injected.request?.({ method: "getChain" }),
  ]
  for (const attempt of attempts) {
    try {
      const raw = await attempt()
      const normalized = normalizeBtcChainInfo(raw)
      if (normalized) return normalized
    } catch {
      // try next
    }
  }
  return null
}

/**
 * Handles `switchBtcChain` in the wallet client flow.
 *
 * @param injected - Input used to compute or dispatch the `switchBtcChain` operation.
 * @param chainEnum - Input used to compute or dispatch the `switchBtcChain` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
async function switchBtcChain(injected: InjectedBtc, chainEnum: string): Promise<BtcChainInfo | null> {
  const attempts = [
    () => injected.switchChain?.(chainEnum),
    () => injected.request?.({ method: "switchChain", params: [chainEnum] }),
  ]
  for (const attempt of attempts) {
    try {
      const raw = await attempt()
      const normalized = normalizeBtcChainInfo(raw)
      if (normalized) return normalized
    } catch {
      // try next
    }
  }
  return null
}

/**
 * Handles `ensureUniSatTestnet4` in the wallet client flow.
 *
 * @param injected - Input used to compute or dispatch the `ensureUniSatTestnet4` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
async function ensureUniSatTestnet4(injected: InjectedBtc): Promise<void> {
  const current = await getBtcChainInfo(injected)
  if (current?.enum === "BITCOIN_TESTNET4") return

  await switchBtcChain(injected, "BITCOIN_TESTNET4")

  const afterSwitch = await getBtcChainInfo(injected)
  if (afterSwitch?.enum && afterSwitch.enum !== "BITCOIN_TESTNET4") {
    throw new Error(
      "UniSat wallet must be on Bitcoin Testnet4. Please switch network to BITCOIN_TESTNET4 in UniSat."
    )
  }
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

/**
 * Handles `unwrapSatsConnectResult` in the wallet client flow.
 *
 * @param response - Raw sats-connect response object returned by provider SDK calls.
 * @param fallbackMessage - Default message used when provider response has no explicit error.
 * @returns Unwrapped success payload typed as `T`.
 * @remarks Throws when provider reports error status so caller can surface wallet UX feedback.
 */
function unwrapSatsConnectResult<T>(response: unknown, fallbackMessage: string): T {
  const parsed = response as SatsConnectResultLike<unknown> | null
  if (parsed?.status === "success") {
    return parsed.result as T
  }
  const message = parsed?.status === "error" ? parsed.error?.message?.trim() : ""
  throw new Error(message || fallbackMessage)
}

/**
 * Handles `normalizeXverseConnectError` in the wallet client flow.
 *
 * @param error - Input used to compute or dispatch the `normalizeXverseConnectError` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function normalizeXverseConnectError(error: unknown): Error {
  if (error instanceof Error) {
    const message = error.message.trim()
    if (/provider.*not found|not installed|extension/i.test(message)) {
      return new Error(
        "BTC wallet extension not detected. Install UniSat or Xverse (optional jika hanya pakai ETH/STRK)."
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

/**
 * Handles `extractBtcAddressFromSatsConnectAddresses` in the wallet client flow.
 *
 * @param payload - Input used to compute or dispatch the `extractBtcAddressFromSatsConnectAddresses` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `isXverseTestnetNetwork` in the wallet client flow.
 *
 * @param name - Input used to compute or dispatch the `isXverseTestnetNetwork` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `normalizeBtcTxHash` in the wallet client flow.
 *
 * @param raw - Input used to compute or dispatch the `normalizeBtcTxHash` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function normalizeBtcTxHash(raw: unknown): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const compact = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed
    if (/^[0-9a-fA-F]{64}$/.test(compact)) {
      return compact.toLowerCase()
    }
    return null
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const nested = normalizeBtcTxHash(item)
      if (nested) return nested
    }
    return null
  }
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>
    const keys = [
      "txid",
      "txId",
      "tx_hash",
      "txHash",
      "transaction_hash",
      "transactionHash",
      "hash",
      "result",
      "data",
    ]
    for (const key of keys) {
      if (!(key in record)) continue
      const nested = normalizeBtcTxHash(record[key])
      if (nested) return nested
    }
  }
  return null
}

/**
 * Handles `sendBtcTransferWithInjectedWallet` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
async function sendBtcTransferWithInjectedWallet(
  injected: InjectedBtc,
  toAddress: string,
  amountSats: number
): Promise<string> {
  const recipients = [{ address: toAddress, amount: amountSats }]
  const attempts = [
    () => injected.sendBitcoin?.(toAddress, amountSats),
    () => injected.request?.({ method: "sendBitcoin", params: [toAddress, amountSats] }),
    () =>
      injected.request?.({
        method: "sendBitcoin",
        params: [{ address: toAddress, amount: amountSats }],
      }),
    () =>
      injected.request?.({
        method: "sendTransfer",
        params: [{ recipients }],
      }),
    () =>
      injected.request?.({
        method: "sendTransfer",
        params: [recipients],
      }),
  ]

  let lastError: unknown = null
  for (const attempt of attempts) {
    try {
      const result = await attempt()
      const txHash = normalizeBtcTxHash(result)
      if (txHash) return txHash
    } catch (error) {
      lastError = error
    }
  }

  throw normalizeWalletError(lastError, "Failed to send BTC transaction from wallet.")
}

/**
 * Handles `sendBtcTransferViaXverse` in the wallet client flow.
 *
 * @param toAddress - Input used to compute or dispatch the `sendBtcTransferViaXverse` operation.
 * @param amountSats - Input used to compute or dispatch the `sendBtcTransferViaXverse` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
async function sendBtcTransferViaXverse(toAddress: string, amountSats: number): Promise<string> {
  const sats = await import("sats-connect")
  const providerId = sats.DefaultAdaptersInfo?.xverse?.id || XVERSE_PROVIDER_ID
  if (!sats.isProviderInstalled(providerId)) {
    throw new Error(
      "BTC wallet extension not detected. Install UniSat or Xverse (optional jika hanya pakai ETH/STRK)."
    )
  }
  const request = sats.request as (
    method: string,
    params: unknown,
    providerId?: string
  ) => Promise<SatsConnectResultLike<unknown>>
  const response = await request(
    "sendTransfer",
    {
      recipients: [{ address: toAddress, amount: amountSats }],
    },
    providerId
  )
  const result = unwrapSatsConnectResult<Record<string, unknown>>(
    response,
    "Failed to send BTC from Xverse wallet."
  )
  const txHash = normalizeBtcTxHash(result)
  if (!txHash) {
    throw new Error("Xverse did not return a BTC transaction hash.")
  }
  return txHash
}

/**
 * Handles `connectBtcWalletViaXverse` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
async function connectBtcWalletViaXverse(): Promise<{ address: string; balance: number | null }> {
  try {
    const sats = await import("sats-connect")
    const providerId = sats.DefaultAdaptersInfo?.xverse?.id || XVERSE_PROVIDER_ID
    if (!sats.isProviderInstalled(providerId)) {
      throw new Error(
        "BTC wallet extension not detected. Install UniSat or Xverse (optional jika hanya pakai ETH/STRK)."
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

/**
 * Handles `normalizeBtcAccounts` in the wallet client flow.
 *
 * @param result - Input used to compute or dispatch the `normalizeBtcAccounts` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `normalizeBtcAddress` in the wallet client flow.
 *
 * @param value - Input used to compute or dispatch the `normalizeBtcAddress` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `fetchBtcBalance` in the wallet client flow.
 *
 * @param injected - Input used to compute or dispatch the `fetchBtcBalance` operation.
 * @param address - Input used to compute or dispatch the `fetchBtcBalance` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
async function fetchBtcBalance(injected: InjectedBtc, address: string): Promise<number | null> {
  const attempts = [
    () => injected.getBalanceV2?.(),
    () => injected.request?.({ method: "getBalanceV2" }),
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

/**
 * Handles `fetchBtcBalanceFromPublicApis` in the wallet client flow.
 *
 * @param address - Input used to compute or dispatch the `fetchBtcBalanceFromPublicApis` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
async function fetchBtcBalanceFromPublicApis(address: string): Promise<number | null> {
  const normalizedAddress = address.trim()
  if (!normalizedAddress) return null

  const base = BTC_TESTNET_EXPLORER_BASE_URL.trim().replace(/\/+$/, "")
  const candidates = [
    `${base}/api/address/${normalizedAddress}`,
    `https://mempool.space/testnet/api/address/${normalizedAddress}`,
    `https://blockstream.info/testnet/api/address/${normalizedAddress}`,
  ]
  const seen = new Set<string>()

  for (const url of candidates) {
    if (!url || seen.has(url)) continue
    seen.add(url)
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      })
      if (!response.ok) continue
      const payload = await response.json()
      const parsed = parseExplorerAddressBalance(payload)
      if (parsed !== null) return parsed
    } catch {
      // try next endpoint
    }
  }

  return null
}

/**
 * Handles `parseExplorerAddressBalance` in the wallet client flow.
 *
 * @param payload - Input used to compute or dispatch the `parseExplorerAddressBalance` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function parseExplorerAddressBalance(payload: any): number | null {
  if (!payload || typeof payload !== "object") return null
  const chainFunded = Number(payload?.chain_stats?.funded_txo_sum)
  const chainSpent = Number(payload?.chain_stats?.spent_txo_sum)
  const mempoolFunded = Number(payload?.mempool_stats?.funded_txo_sum)
  const mempoolSpent = Number(payload?.mempool_stats?.spent_txo_sum)

  if (Number.isFinite(chainFunded) && Number.isFinite(chainSpent)) {
    const confirmedSats = Math.max(0, chainFunded - chainSpent)
    const pendingSats =
      Number.isFinite(mempoolFunded) && Number.isFinite(mempoolSpent)
        ? mempoolFunded - mempoolSpent
        : 0
    const totalSats = Math.max(0, confirmedSats + pendingSats)
    return totalSats / 100_000_000
  }

  const fallback = Number(
    payload?.balance ?? payload?.sats ?? payload?.confirmed ?? payload?.total ?? payload?.amount
  )
  if (!Number.isFinite(fallback)) return null
  return fallback / 100_000_000
}

/**
 * Handles `normalizeBtcBalance` in the wallet client flow.
 *
 * @param raw - Input used to compute or dispatch the `normalizeBtcBalance` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function normalizeBtcBalance(raw: any): number | null {
  if (raw === null || raw === undefined) return null
  const normalizeScaled = (value: number): number | null => {
    if (!Number.isFinite(value) || value < 0) return null
    return value
  }

  if (typeof raw === "number" || typeof raw === "string") {
    const candidate = Number(raw)
    if (!Number.isFinite(candidate)) return null
    if (Number.isInteger(candidate) && candidate > 100) {
      return normalizeScaled(candidate / 100_000_000)
    }
    return normalizeScaled(candidate)
  }

  if (typeof raw === "object") {
    const totalCandidate = Number(raw.total ?? raw.balance ?? raw.amount ?? raw.finalizedBalance)
    const confirmedCandidate = Number(raw.confirmed ?? raw.confirmedBalance)
    const unconfirmedCandidate = Number(
      raw.unconfirmed ?? raw.unconfirmedBalance ?? raw.pending ?? raw.pendingBalance
    )
    const candidate =
      Number.isFinite(confirmedCandidate) && Number.isFinite(unconfirmedCandidate)
        ? confirmedCandidate + unconfirmedCandidate
        : Number.isFinite(totalCandidate)
        ? totalCandidate
        : Number(raw.satoshi ?? raw.satoshis)
    if (!Number.isFinite(candidate)) return null
    const keys = new Set(Object.keys(raw))
    const looksLikeSatoshiPayload =
      keys.has("satoshi") ||
      keys.has("satoshis") ||
      keys.has("confirmed") ||
      keys.has("unconfirmed") ||
      Number.isInteger(candidate)
    if (looksLikeSatoshiPayload) {
      return normalizeScaled(candidate / 100_000_000)
    }
    return normalizeScaled(candidate)
  }

  return null
}

/**
 * Handles `normalizeTokenBalance` in the wallet client flow.
 *
 * @param raw - Input used to compute or dispatch the `normalizeTokenBalance` operation.
 * @param decimals - Input used to compute or dispatch the `normalizeTokenBalance` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `toBigInt` in the wallet client flow.
 *
 * @param value - Input used to compute or dispatch the `toBigInt` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `pow10BigInt` in the wallet client flow.
 *
 * @param exponent - Input used to compute or dispatch the `pow10BigInt` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function pow10BigInt(exponent: number): bigint {
  const safeExponent = Number.isFinite(exponent) && exponent > 0 ? Math.floor(exponent) : 0
  let result = BigInt(1)
  const ten = BigInt(10)
  for (let i = 0; i < safeExponent; i += 1) {
    result *= ten
  }
  return result
}

/**
 * Handles `toShortString` in the wallet client flow.
 *
 * @param value - Input used to compute or dispatch the `toShortString` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function toShortString(value: string): string {
  if (value.length <= 31) return value
  return value.slice(0, 31)
}

/**
 * Handles `signatureToHex` in the wallet client flow.
 *
 * @param signature - Input used to compute or dispatch the `signatureToHex` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function signatureToHex(signature: any): string {
  return normalizeSignatureValue(signature) || randomHex(32)
}

/**
 * Handles `normalizeSignatureValue` in the wallet client flow.
 *
 * @param signature - Input used to compute or dispatch the `normalizeSignatureValue` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `feltToPaddedHex` in the wallet client flow.
 *
 * @param value - Input used to compute or dispatch the `feltToPaddedHex` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function feltToPaddedHex(value: string | number): string {
  const hex = normalizeHex(value)
  return hex.padStart(64, "0")
}

/**
 * Handles `normalizeHex` in the wallet client flow.
 *
 * @param value - Input used to compute or dispatch the `normalizeHex` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Handles `randomHex` in the wallet client flow.
 *
 * @param bytes - Input used to compute or dispatch the `randomHex` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function randomHex(bytes: number): string {
  if (typeof window === "undefined" || !window.crypto?.getRandomValues) {
    return `0x${"a".repeat(bytes * 2)}`
  }
  const buffer = new Uint8Array(bytes)
  window.crypto.getRandomValues(buffer)
  return `0x${Array.from(buffer).map((b) => b.toString(16).padStart(2, "0")).join("")}`
}

/**
 * Handles `useWallet` in the wallet client flow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export function useWallet() {
  const context = useContext(WalletContext)
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider")
  }
  return context
}
