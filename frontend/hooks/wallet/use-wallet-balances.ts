"use client"

import * as React from "react"
import useSWR from "swr"
import { getOnchainBalances, getPortfolioBalance } from "@/lib/api"
import {
  CAREL_DECIMALS,
  CAREL_TOKEN_ADDRESS,
  DEFAULT_BALANCE,
  STRK_DECIMALS,
  STRK_L1_TOKEN_ADDRESS,
  STRK_TOKEN_ADDRESS,
  USDC_DECIMALS,
  USDC_TOKEN_ADDRESS,
  USDT_DECIMALS,
  USDT_TOKEN_ADDRESS,
  WBTC_DECIMALS,
  WBTC_TOKEN_ADDRESS,
} from "@/lib/wallet/wallet-constants"
import { fetchBtcBalance, fetchBtcBalanceFromPublicApis, getInjectedBtc } from "@/lib/wallet/adapters/bitcoin-adapter"
import { fetchEvmBalance, fetchEvmErc20Balance, getPreferredEvmProvider } from "@/lib/wallet/adapters/evm-adapter"
import {
  fetchStarknetTokenBalance,
  getInjectedStarknet,
  isStarknetWalletProvider,
} from "@/lib/wallet/adapters/starknet-adapter"
import type { WalletState } from "@/lib/wallet/wallet-types"

type UseWalletBalancesParams = {
  wallet: WalletState
  setWallet: React.Dispatch<React.SetStateAction<WalletState>>
  onchainRefreshInFlightRef: React.MutableRefObject<boolean>
  portfolioBalanceHintRef: React.MutableRefObject<Record<string, number>>
}

export const useWalletBalances = ({
  wallet,
  setWallet,
  onchainRefreshInFlightRef,
  portfolioBalanceHintRef,
}: UseWalletBalancesParams) => {
  const portfolioKey = React.useMemo(
    () => (wallet.token ? ["portfolio-balance", wallet.token] : null),
    [wallet.token]
  )
  const portfolioFetcher = React.useCallback(async () => {
    const portfolio = await getPortfolioBalance()
    const balances = portfolio.balances.reduce<Record<string, number>>((acc, item) => {
      acc[item.token.toUpperCase()] = item.amount
      return acc
    }, { ...DEFAULT_BALANCE })
    const totalValueUSD = Number(portfolio.total_value_usd || 0)
    return { balances, totalValueUSD }
  }, [])

  const { data: portfolioData, mutate: mutatePortfolio } = useSWR(
    portfolioKey,
    portfolioFetcher,
    {
      refreshInterval: 30_000,
      dedupingInterval: 5_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
    }
  )

  React.useEffect(() => {
    if (!portfolioData) return
    setWallet((prev) => ({
      ...prev,
      balance: portfolioData.balances,
      totalValueUSD: portfolioData.totalValueUSD,
    }))
  }, [portfolioData, setWallet])

  const refreshPortfolio = React.useCallback(async () => {
    if (!portfolioKey) return
    await mutatePortfolio()
  }, [mutatePortfolio, portfolioKey])

  const effectiveStarknetAddress =
    wallet.starknetAddress || (wallet.network === "starknet" ? wallet.address : null)
  const onchainKey = React.useMemo(
    () =>
      effectiveStarknetAddress || wallet.evmAddress || wallet.btcAddress
        ? [
            "onchain-balances",
            effectiveStarknetAddress,
            wallet.evmAddress,
            wallet.btcAddress,
            wallet.token,
          ]
        : null,
    [effectiveStarknetAddress, wallet.evmAddress, wallet.btcAddress, wallet.token]
  )

  const onchainFetcher = React.useCallback(async () => {
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

      if (wallet.btcAddress) {
        let directBtcBalance: number | null = null
        const shouldUseInjectedBtc = wallet.network === "bitcoin" && !!wallet.btcProvider
        const injectedBtc = shouldUseInjectedBtc ? getInjectedBtc(wallet.btcProvider || "unisat") : null
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
          ETH: wallet.evmAddress && resolved.ETH !== null ? resolved.ETH : prev.balance.ETH,
          STRK: effectiveStarknetAddress ? resolved.STRK_L2 ?? prev.balance.STRK : prev.balance.STRK,
          CAREL: effectiveStarknetAddress ? resolved.CAREL ?? prev.balance.CAREL : prev.balance.CAREL,
          USDC: effectiveStarknetAddress ? resolved.USDC ?? prev.balance.USDC : prev.balance.USDC,
          USDT: effectiveStarknetAddress ? resolved.USDT ?? prev.balance.USDT : prev.balance.USDT,
          WBTC: effectiveStarknetAddress ? resolved.WBTC ?? prev.balance.WBTC : prev.balance.WBTC,
          BTC: wallet.btcAddress && resolved.BTC !== null ? resolved.BTC : prev.balance.BTC,
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
    return true
  }, [
    onchainRefreshInFlightRef,
    portfolioBalanceHintRef,
    setWallet,
    wallet.address,
    wallet.btcAddress,
    wallet.btcProvider,
    wallet.evmAddress,
    wallet.network,
    wallet.provider,
    wallet.starknetAddress,
    wallet.token,
  ])

  const { mutate: mutateOnchain } = useSWR(onchainKey, onchainFetcher, {
    refreshInterval: 45_000,
    dedupingInterval: 5_000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  })

  const refreshOnchainBalances = React.useCallback(async () => {
    if (!onchainKey) return
    await mutateOnchain()
  }, [mutateOnchain, onchainKey])

  return { refreshPortfolio, refreshOnchainBalances }
}
