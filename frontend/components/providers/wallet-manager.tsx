"use client"

import * as React from "react"
import { getLinkedWallets, linkWalletAddress } from "@/lib/api"
import { emitEvent, onEvent } from "@/lib/events"
import { DEFAULT_BALANCE } from "@/lib/wallet/wallet-constants"
import { useWalletBalances } from "@/hooks/wallet/use-wallet-balances"
import {
  STORAGE_KEYS,
  clearWalletStorage,
  normalizeStoredBtcProvider,
} from "@/hooks/wallet/use-wallet"
import { useWalletStore } from "@/store/use-wallet-store"

/**
 * Handles `WalletManager` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function WalletManager() {
  const wallet = useWalletStore((state) => state)
  const setWallet = useWalletStore((state) => state.setWallet)
  const resetWalletState = useWalletStore((state) => state.resetWalletState)
  const setRefreshHandlers = useWalletStore((state) => state.setRefreshHandlers)
  const onchainRefreshInFlightRef = React.useRef(false)
  const portfolioBalanceHintRef = React.useRef<Record<string, number>>({ ...DEFAULT_BALANCE })

  const { refreshPortfolio, refreshOnchainBalances } = useWalletBalances({
    wallet,
    setWallet,
    onchainRefreshInFlightRef,
    portfolioBalanceHintRef,
  })

  React.useEffect(() => {
    setRefreshHandlers({ refreshPortfolio, refreshOnchainBalances })
  }, [refreshOnchainBalances, refreshPortfolio, setRefreshHandlers])

  React.useEffect(() => {
    portfolioBalanceHintRef.current = { ...wallet.balance }
  }, [wallet.balance])

  const resetWalletSession = React.useCallback(() => {
    clearWalletStorage()
    resetWalletState()
    emitEvent("wallet:disconnected", { address: null, provider: null })
  }, [resetWalletState])

  React.useEffect(() => {
    const unsubscribe = onEvent("auth:expired", (payload?: unknown) => {
      const currentToken =
        wallet.token ||
        (typeof window !== "undefined"
          ? window.localStorage.getItem(STORAGE_KEYS.token)
          : null)
      const eventToken =
        payload &&
        typeof payload === "object" &&
        "token" in payload &&
        typeof (payload as { token?: unknown }).token === "string"
          ? ((payload as { token?: string }).token || "").trim()
          : ""
      if (eventToken && currentToken && eventToken !== currentToken) {
        return
      }
      resetWalletSession()
    })
    return () => unsubscribe()
  }, [resetWalletSession, wallet.token])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const token = window.localStorage.getItem(STORAGE_KEYS.token)
    const address = window.localStorage.getItem(STORAGE_KEYS.address)
    const providerRaw = window.localStorage.getItem(STORAGE_KEYS.provider)
    const provider =
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
    const btcProvider = normalizeStoredBtcProvider(
      window.localStorage.getItem(STORAGE_KEYS.btcProvider)
    )

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
      btcProvider,
      token,
    }))

    void refreshPortfolio()
  }, [refreshPortfolio, setWallet])

  React.useEffect(() => {
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
  }, [setWallet, wallet.isConnected, wallet.token])

  React.useEffect(() => {
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

  React.useEffect(() => {
    const effectiveStarknetAddress =
      wallet.starknetAddress || (wallet.network === "starknet" ? wallet.address : null)
    if (!effectiveStarknetAddress && !wallet.evmAddress && !wallet.btcAddress) return
    void refreshOnchainBalances()
  }, [
    wallet.token,
    wallet.starknetAddress,
    wallet.evmAddress,
    wallet.btcAddress,
    wallet.network,
    wallet.address,
    refreshOnchainBalances,
  ])

  return null
}
