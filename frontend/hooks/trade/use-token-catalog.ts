"use client"

import * as React from "react"
import type { TokenCatalogItem, TokenWithBalance } from "@/lib/trading-types"
import type { WalletContextType } from "@/hooks/wallet/use-wallet"
import { chainFromNetwork } from "@/lib/trading-utils"

type UseTokenCatalogParams = {
  tokenCatalog: TokenCatalogItem[]
  livePrices: Record<string, number>
  wallet: WalletContextType
}

export function useTokenCatalog({ tokenCatalog, livePrices, wallet }: UseTokenCatalogParams) {
  const resolveTokenBalance = React.useCallback(
    (token: { symbol: string; network: string }) => {
      const symbol = token.symbol.toUpperCase()
      const chain = chainFromNetwork(token.network)
      const backendBalance = wallet.balance[symbol] ?? 0

      if (symbol === "ETH" && chain === "ethereum" && wallet.evmAddress) {
        return wallet.onchainBalance.ETH ?? backendBalance
      }
      if (chain === "starknet") {
        if (symbol === "STRK") {
          return wallet.onchainBalance.STRK_L2 ?? backendBalance
        }
        if (symbol === "CAREL") {
          return wallet.onchainBalance.CAREL ?? backendBalance
        }
        if (symbol === "USDC") {
          return wallet.onchainBalance.USDC ?? backendBalance
        }
        if (symbol === "USDT") {
          return wallet.onchainBalance.USDT ?? backendBalance
        }
        if (symbol === "WBTC") {
          if (
            typeof wallet.onchainBalance.WBTC === "number" &&
            Number.isFinite(wallet.onchainBalance.WBTC)
          ) {
            return wallet.onchainBalance.WBTC
          }
          if (
            typeof wallet.balance.WBTC === "number" &&
            Number.isFinite(wallet.balance.WBTC)
          ) {
            return wallet.balance.WBTC
          }
          return backendBalance
        }
      }
      if (symbol === "BTC" && chain === "bitcoin" && wallet.btcAddress) {
        return wallet.onchainBalance.BTC ?? backendBalance
      }
      return backendBalance
    },
    [
      wallet.balance,
      wallet.btcAddress,
      wallet.evmAddress,
      wallet.onchainBalance.BTC,
      wallet.onchainBalance.CAREL,
      wallet.onchainBalance.ETH,
      wallet.onchainBalance.STRK_L2,
      wallet.onchainBalance.USDC,
      wallet.onchainBalance.USDT,
      wallet.onchainBalance.WBTC,
    ]
  )

  const resolveTokenPrice = React.useCallback(
    (symbol: string) => {
      const upper = symbol.toUpperCase()
      const direct = Number(livePrices[upper])
      const directValid = Number.isFinite(direct) && direct > 0
      const btc = Number(livePrices.BTC)
      const btcValid = Number.isFinite(btc) && btc > 0
      const wbtc = Number(livePrices.WBTC)
      const wbtcValid = Number.isFinite(wbtc) && wbtc > 0

      if (upper === "WBTC") {
        if (directValid && btcValid) {
          const ratio = direct / btc
          if (ratio < 0.5 || ratio > 2) {
            return btc
          }
          return direct
        }
        if (btcValid) {
          return btc
        }
        if (wbtcValid) {
          return wbtc
        }
      }

      if (upper === "BTC") {
        if (directValid && wbtcValid) {
          const ratio = wbtc / direct
          if (ratio < 0.5 || ratio > 2) {
            return wbtc
          }
          return direct
        }
        if (directValid) {
          return direct
        }
        if (wbtcValid) {
          return wbtc
        }
      }

      if (directValid) {
        return direct
      }
      return 0
    },
    [livePrices]
  )

  const tokens = React.useMemo<TokenWithBalance[]>(() => {
    return tokenCatalog.map((token) => ({
      ...token,
      balance: resolveTokenBalance(token),
      price: resolveTokenPrice(token.symbol),
    }))
  }, [tokenCatalog, resolveTokenBalance, resolveTokenPrice])

  return { tokens, resolveTokenBalance, resolveTokenPrice }
}
