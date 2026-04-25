"use client"

import * as React from "react"
import { shallow } from "zustand/shallow"
import {
  connectWallet,
  getPortfolioBalance,
  linkWalletAddress,
} from "@/lib/api"
import { emitEvent } from "@/lib/events"
import {
  EVM_SEPOLIA_CHAIN_ID,
  STARKNET_SEPOLIA_CHAIN_ID_TEXT,
  detectBtcAddressNetwork,
  isStarknetSepolia,
  normalizeStarknetChainValue,
} from "@/lib/network-config"
import {
  type BtcWalletProviderType,
  type WalletProviderType,
} from "@/lib/wallet-provider-config"
import {
  connectBtcWalletViaXverse,
  ensureUniSatTestnet4,
  fetchBtcBalance,
  fetchBtcBalanceFromPublicApis,
  getInjectedBtc,
  normalizeXverseConnectError,
  requestBtcAccounts,
  requestBtcAuthSignature,
  sendBtcTransferViaXverse,
  sendBtcTransferWithInjectedWallet,
  type InjectedBtc,
} from "@/lib/wallet/adapters/bitcoin-adapter"
import {
  ensureEvmSepolia,
  fetchEvmBalance,
  fetchEvmErc20Balance,
  getInjectedEvm,
  type InjectedEvm,
} from "@/lib/wallet/adapters/evm-adapter"
import {
  connectStarknetWallet,
  ensureStarknetSepolia,
  fetchStarknetTokenBalance,
  isReadableStarknetChainId,
  requestAccounts,
  signStarknetMessage,
  type InjectedStarknet,
} from "@/lib/wallet/adapters/starknet-adapter"
import {
  DEFAULT_BALANCE,
  STRK_DECIMALS,
  STRK_L1_TOKEN_ADDRESS,
  STRK_TOKEN_ADDRESS,
} from "@/lib/wallet/wallet-constants"
import type { WalletState } from "@/lib/wallet/wallet-types"
import { normalizeBtcAddress, normalizeWalletError, withWalletTimeout } from "@/lib/wallet/wallet-utils"
import { useWalletStore } from "@/store/use-wallet-store"

export type { WalletProviderType, BtcWalletProviderType }

export interface WalletContextType extends WalletState {
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

export const STORAGE_KEYS = {
  token: "auth_token",
  address: "wallet_address",
  provider: "wallet_provider",
  network: "wallet_network",
  starknetAddress: "wallet_address_starknet",
  evmAddress: "wallet_address_evm",
  btcAddress: "wallet_address_btc",
  btcProvider: "wallet_provider_btc",
  sumoToken: "sumo_login_token",
  sumoAddress: "sumo_login_address",
  referralCode: "referral_code",
}

const UNISAT_NETWORK_VALIDATION_CACHE_MS = 45_000
let unisatNetworkValidatedUntil = 0

const getWalletState = () => useWalletStore.getState()
const setWalletState = (update: WalletState | ((prev: WalletState) => WalletState)) =>
  useWalletStore.getState().setWallet(update)
const updateBalanceState = (symbol: string, amount: number) =>
  useWalletStore.getState().updateBalance(symbol, amount)

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

export function normalizeStoredBtcProvider(raw: string | null): BtcWalletProviderType | null {
  if (!raw) return null
  const value = raw.trim().toLowerCase()
  if (value === "unisat" || value === "xverse" || value === "braavos_btc") {
    return value as BtcWalletProviderType
  }
  return null
}

export function clearWalletStorage() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(STORAGE_KEYS.token)
  window.localStorage.removeItem(STORAGE_KEYS.address)
  window.localStorage.removeItem(STORAGE_KEYS.provider)
  window.localStorage.removeItem(STORAGE_KEYS.network)
  window.localStorage.removeItem(STORAGE_KEYS.starknetAddress)
  window.localStorage.removeItem(STORAGE_KEYS.evmAddress)
  window.localStorage.removeItem(STORAGE_KEYS.btcAddress)
  window.localStorage.removeItem(STORAGE_KEYS.btcProvider)
  window.sessionStorage.removeItem(STORAGE_KEYS.sumoToken)
  window.sessionStorage.removeItem(STORAGE_KEYS.sumoAddress)
}

async function refreshPortfolio() {
  await getWalletState().refreshPortfolio()
}

async function refreshOnchainBalances() {
  await getWalletState().refreshOnchainBalances()
}

function disconnect() {
  clearWalletStorage()
  getWalletState().resetWalletState()
  emitEvent("wallet:disconnected", { address: null, provider: null })
}

async function connect(provider: WalletProviderType) {
  const wallet = getWalletState()
  const message = `Carel Protocol login at ${Math.floor(Date.now() / 1000)}`
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

    setWalletState((prev) => ({
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
  let balances = { ...DEFAULT_BALANCE }
  let totalValueUSD = 0

  try {
    const portfolio = await getPortfolioBalance()
    balances = portfolio.balances.reduce<Record<string, number>>((acc, item) => {
      acc[item.token.toUpperCase()] = item.amount
      return acc
    }, { ...DEFAULT_BALANCE })
    totalValueUSD = Number(portfolio.total_value_usd || 0)
  } catch {
    // keep default balances
  }

  if (network === "starknet" && starknetSession && address) {
    const strkBalance = await fetchStarknetTokenBalance(
      starknetSession,
      address,
      STRK_TOKEN_ADDRESS,
      STRK_DECIMALS
    )
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

  setWalletState((prev) => ({
    ...prev,
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
}

async function connectWithSumo(sumoToken: string, address?: string) {
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

  setWalletState((prev) => ({
    ...prev,
    isConnected: true,
    address: resolvedAddress,
    provider: prev.provider,
    network: "starknet",
    token,
  }))
  emitEvent("wallet:connected", { address: resolvedAddress, provider: null })
  return !!token
}

async function ensureBtcAuthSession(
  btcAddress: string,
  injected: InjectedBtc | null
): Promise<{ token: string; address: string }> {
  const wallet = getWalletState()
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
}

async function connectBtcWallet(provider: BtcWalletProviderType) {
  const wallet = getWalletState()
  let btcAddress = ""
  let btcBalance: number | null = null
  let injected: InjectedBtc | null = null
  let xverseConnectError: unknown = null

  if (provider === "xverse") {
    injected = getInjectedBtc("xverse")
    try {
      if (injected) {
        const accounts = await requestBtcAccounts(injected, { requireTestnet4: true, timeoutMs: 10_000 })
        btcAddress = accounts?.[0] || ""
        if (!btcAddress) {
          const relaxedAccounts = await requestBtcAccounts(injected, {
            requireTestnet4: false,
            timeoutMs: 8_000,
          })
          btcAddress = relaxedAccounts?.[0] || ""
        }
        if (btcAddress) {
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
      }
      if (!btcAddress && !injected) {
        const result = await withWalletTimeout(
          async () => await connectBtcWalletViaXverse(),
          15_000,
          "Xverse connect request timed out."
        )
        btcAddress = result.address
        btcBalance = result.balance
        injected = getInjectedBtc("xverse")
      }
    } catch (error) {
      xverseConnectError = error
      console.warn("Xverse connect flow failed:", error)
    }

    if (!btcAddress && injected && !xverseConnectError) {
      xverseConnectError = new Error("BTC wallet not connected. Open Xverse and approve account access.")
    }
    if (!btcAddress && injected && xverseConnectError) {
      const normalized = normalizeXverseConnectError(xverseConnectError)
      if (/failed to connect xverse wallet/i.test(normalized.message)) {
        xverseConnectError = new Error("BTC wallet not connected. Open Xverse and approve account access.")
      } else {
        xverseConnectError = normalized
      }
    }
  }

  if (!btcAddress) {
    injected = injected || getInjectedBtc(provider)
    if (!injected) {
      if (provider === "xverse" && xverseConnectError) {
        throw normalizeXverseConnectError(xverseConnectError)
      }
      throw new Error(
        "BTC wallet extension not detected. Install UniSat or Xverse (optional jika hanya pakai ETH/STRK)."
      )
    }
    const accounts = await requestBtcAccounts(injected, {
      requireTestnet4: provider === "xverse",
      timeoutMs: provider === "xverse" ? 6_000 : 10_000,
    })
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

  setWalletState((prev) => ({
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
    window.localStorage.setItem(STORAGE_KEYS.btcProvider, provider)
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
}

async function linkBtcAddress(address: string) {
  const wallet = getWalletState()
  const btcAddress = address.trim()
  if (!btcAddress) {
    throw new Error("BTC address is required.")
  }
  const btcNetwork = detectBtcAddressNetwork(btcAddress)
  if (btcNetwork !== "testnet") {
    throw new Error("BTC address must be on Bitcoin testnet (native).")
  }

  let btcBalance: number | null = null
  const shouldUseInjectedBtc =
    wallet.network === "bitcoin" &&
    !!wallet.btcProvider
  const injected = shouldUseInjectedBtc
    ? getInjectedBtc(wallet.btcProvider || "unisat")
    : null
  if (injected) {
    btcBalance = await fetchBtcBalance(injected, btcAddress)
    if (btcBalance === null) {
      btcBalance = await fetchBtcBalanceFromPublicApis(btcAddress)
    }
    if (btcBalance === null) {
      btcBalance = 0
    }
  } else {
    btcBalance = await fetchBtcBalanceFromPublicApis(btcAddress)
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

  setWalletState((prev) => ({
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
    if (wallet.btcProvider) {
      window.localStorage.setItem(STORAGE_KEYS.btcProvider, wallet.btcProvider)
    }
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
}

async function sendBtcTransaction(toAddress: string, amountSats: number): Promise<string> {
  const wallet = getWalletState()
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

  const inferredProvider: BtcWalletProviderType =
    wallet.btcProvider ||
    (getInjectedBtc("xverse")
      ? "xverse"
      : getInjectedBtc("unisat")
      ? "unisat"
      : getInjectedBtc("braavos_btc")
      ? "braavos_btc"
      : "unisat")
  const activeProvider = inferredProvider
  const warmupBtcWalletPrompt = async (
    injectedWallet: InjectedBtc,
    options?: { requireTestnet4?: boolean }
  ) => {
    const requireTestnet4 = Boolean(options?.requireTestnet4)
    const attempts = requireTestnet4
      ? [
          () => injectedWallet.request?.({ method: "requestAccounts", params: [{ network: "testnet4" }] }),
          () => injectedWallet.request?.({ method: "requestAccounts", params: ["testnet4"] }),
          () => injectedWallet.requestAccounts?.(),
        ]
      : [
          () => injectedWallet.requestAccounts?.(),
          () => injectedWallet.request?.({ method: "requestAccounts" }),
        ]
    const startedAt = Date.now()
    for (const attempt of attempts) {
      if (Date.now() - startedAt > 1_500) break
      try {
        await withWalletTimeout(
          async () => await attempt(),
          1_200,
          "BTC wallet wake-up request timed out."
        )
        return
      } catch (error) {
        const normalized = normalizeWalletError(error, "BTC wallet wake-up failed.")
        if (/already pending/i.test(normalized.message)) {
          return
        }
      }
    }
  }
  const persistActiveBtcProvider = () => {
    if (!wallet.btcProvider) {
      setWalletState((prev) => ({
        ...prev,
        btcProvider: prev.btcProvider || activeProvider,
      }))
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEYS.btcProvider, activeProvider)
    }
  }
  let xverseError: unknown = null
  if (activeProvider === "xverse") {
    try {
      const injectedXverse = getInjectedBtc("xverse")
      let txHash = ""
      if (injectedXverse) {
        await warmupBtcWalletPrompt(injectedXverse, { requireTestnet4: true })
        txHash = await sendBtcTransferWithInjectedWallet(injectedXverse, destination, roundedSats)
      } else {
        txHash = await sendBtcTransferViaXverse(destination, roundedSats)
      }
      const sentAmount = roundedSats / 100_000_000
      setWalletState((prev) => {
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
      persistActiveBtcProvider()
      return txHash
    } catch (error) {
      xverseError = error
      try {
        const txHash = await sendBtcTransferViaXverse(destination, roundedSats)
        const sentAmount = roundedSats / 100_000_000
        setWalletState((prev) => {
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
        persistActiveBtcProvider()
        return txHash
      } catch (fallbackError) {
        xverseError = fallbackError
      }
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
    if (now > unisatNetworkValidatedUntil) {
      await ensureUniSatTestnet4(injected)
      unisatNetworkValidatedUntil = now + UNISAT_NETWORK_VALIDATION_CACHE_MS
    }
  }
  try {
    await warmupBtcWalletPrompt(injected, { requireTestnet4: activeProvider === "xverse" })
    const txHash = await sendBtcTransferWithInjectedWallet(injected, destination, roundedSats)
    const sentAmount = roundedSats / 100_000_000
    setWalletState((prev) => {
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
    persistActiveBtcProvider()
    return txHash
  } catch (error) {
    if (activeProvider === "unisat") {
      unisatNetworkValidatedUntil = 0
    }
    if (xverseError) {
      throw normalizeWalletError(xverseError, "Failed to send BTC from Xverse wallet.")
    }
    throw normalizeWalletError(error, "Failed to send BTC from wallet.")
  }
}

async function switchNetwork(network: string) {
  await new Promise((resolve) => setTimeout(resolve, 300))
  setWalletState((prev) => ({ ...prev, network }))
}

export function useWallet<T = WalletContextType>(
  selector?: (state: WalletContextType) => T,
  equalityFn: (left: T, right: T) => boolean = shallow
) {
  const walletStoreState = useWalletStore((state) => state)
  const context = React.useMemo(() => {
    const { setWallet, setWalletPartial, resetWalletState, setRefreshHandlers, ...walletState } =
      walletStoreState
    return {
      ...(walletState as WalletState),
      connect,
      connectBtcWallet,
      linkBtcAddress,
      sendBtcTransaction,
      connectWithSumo,
      refreshPortfolio,
      refreshOnchainBalances,
      disconnect,
      switchNetwork,
      updateBalance: updateBalanceState,
    } as WalletContextType
  }, [walletStoreState])
  const selection = selector ? selector(context) : (context as T)
  const selectionRef = React.useRef<T>(selection)
  if (!equalityFn(selectionRef.current, selection)) {
    selectionRef.current = selection
  }
  return selectionRef.current
}
