"use client"

import * as React from "react"
import useSWR from "swr"
import type { WalletContextType } from "@/hooks/wallet/use-wallet"
import {
  getMarketDepth,
  getOwnedNfts,
  getPortfolioBalance,
  getRewardsPoints,
  getTokenOHLCV,
  listLimitOrders,
  type NFTItem,
} from "@/lib/api"
import {
  formatDateTime,
  stableSymbols,
  type ChartCandle,
  type TokenItem,
  type UiOrder,
} from "@/lib/limit-utils"

type OrderBook = {
  bids: Array<{ price: number; amount: number }>
  asks: Array<{ price: number; amount: number }>
}

type UseLimitDataParams = {
  wallet: WalletContextType
  livePrices: Record<string, number>
  liveChanges: Record<string, number>
  tokens: TokenItem[]
  setTokens: React.Dispatch<React.SetStateAction<TokenItem[]>>
  selectedTokenSymbol: string
  chartPeriod: string
  withOrderSourceLabel: (orders: UiOrder[]) => UiOrder[]
}

export const useLimitData = ({
  wallet,
  livePrices,
  liveChanges,
  tokens: _tokens,
  setTokens,
  selectedTokenSymbol,
  chartPeriod,
  withOrderSourceLabel,
}: UseLimitDataParams) => {
  const [chartCandles, setChartCandles] = React.useState<ChartCandle[]>([])
  const [orderBook, setOrderBook] = React.useState<OrderBook>({ bids: [], asks: [] })
  const [orders, setOrders] = React.useState<UiOrder[]>([])
  const [activeNftDiscount, setActiveNftDiscount] = React.useState<NFTItem | null>(null)
  const [stakePointsMultiplier, setStakePointsMultiplier] = React.useState(1)
  const ordersKey = React.useMemo(() => ["limit-orders", 1, 10, "active"], [])
  const {
    data: ordersResponse,
    error: ordersError,
    mutate: mutateOrders,
  } = useSWR(ordersKey, () => listLimitOrders(1, 10, "active"), {
    revalidateOnFocus: true,
    refreshInterval: 0,
    keepPreviousData: true,
    shouldRetryOnError: false,
  })

  React.useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const response = await getPortfolioBalance()
        if (!active) return
        setTokens((prev) =>
          prev.map((token) => {
            const match = response.balances.find((item) => item.token.toUpperCase() === token.symbol)
            if (!match) return token
            const valueUsd = Number(match.value_usd || 0)
            const nextPrice = match.amount > 0 ? valueUsd / match.amount : match.price
            return { ...token, price: nextPrice }
          })
        )
      } catch {
        // keep existing prices
      }
    })()

    return () => {
      active = false
    }
  }, [setTokens])

  React.useEffect(() => {
    if (!livePrices || Object.keys(livePrices).length === 0) return
    setTokens((prev) =>
      prev.map((token) => {
        const price = livePrices[token.symbol]
        const change = liveChanges[token.symbol]
        if (!Number.isFinite(price)) return token
        return {
          ...token,
          price,
          change: Number.isFinite(change) ? change : token.change,
        }
      })
    )
  }, [liveChanges, livePrices, setTokens])

  React.useEffect(() => {
    let active = true
    if (!wallet.isConnected) {
      setActiveNftDiscount(null)
      setStakePointsMultiplier(1)
      return
    }

    const loadRewardsContext = async (force = false) => {
      try {
        const [nfts, rewards] = await Promise.all([
          getOwnedNfts({ force }),
          getRewardsPoints({ force }),
        ])
        if (!active) return
        const now = Math.floor(Date.now() / 1000)
        const usable = nfts
          .filter((nft) => !nft.used && (!nft.expiry || nft.expiry > now))
          .sort((a, b) => (b.discount || 0) - (a.discount || 0))[0]
        setActiveNftDiscount(usable || null)
        const parsedMultiplier = Number(rewards.multiplier)
        setStakePointsMultiplier(
          Number.isFinite(parsedMultiplier) && parsedMultiplier > 0 ? parsedMultiplier : 1
        )
      } catch {
        if (!active) return
        setActiveNftDiscount(null)
        setStakePointsMultiplier(1)
      }
    }

    void loadRewardsContext()
    const timer = window.setInterval(() => {
      void loadRewardsContext(true)
    }, 20_000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [wallet.isConnected, wallet.address, wallet.starknetAddress, wallet.evmAddress, wallet.btcAddress])

  React.useEffect(() => {
    let active = true
    const intervalForPeriod = (period: string) => {
      switch (period) {
        case "5M":
          return { interval: "5m", limit: 72 }
        case "15M":
          return { interval: "15m", limit: 96 }
        case "1H":
          return { interval: "1h", limit: 24 }
        case "24H":
          return { interval: "1h", limit: 24 }
        case "7D":
          return { interval: "1d", limit: 7 }
        case "30D":
          return { interval: "1d", limit: 30 }
        case "1Y":
          return { interval: "1d", limit: 365 }
        default:
          return { interval: "1h", limit: 24 }
      }
    }

    const { interval, limit } = intervalForPeriod(chartPeriod)
    const chartSymbol = selectedTokenSymbol.toUpperCase() === "WBTC" ? "BTC" : selectedTokenSymbol
    ;(async () => {
      try {
        let response
        try {
          response = await getTokenOHLCV({
            token: chartSymbol,
            interval,
            limit,
            source: "coingecko",
          })
        } catch {
          response = await getTokenOHLCV({
            token: chartSymbol,
            interval,
            limit,
          })
        }
        if (!active) return
        const candles = response.data
          .map((candle) => {
            const open = Number(candle.open)
            const high = Number(candle.high)
            const low = Number(candle.low)
            const close = Number(candle.close)
            const parsedTs = new Date(candle.timestamp).getTime()
            return {
              timestamp: Number.isFinite(parsedTs) ? parsedTs : Date.now(),
              open,
              high,
              low,
              close,
            } as ChartCandle
          })
          .filter(
            (candle) =>
              Number.isFinite(candle.open) &&
              Number.isFinite(candle.high) &&
              Number.isFinite(candle.low) &&
              Number.isFinite(candle.close) &&
              candle.high > 0 &&
              candle.low > 0
          )
        if (candles.length >= 2) {
          const latest = candles[candles.length - 1].close
          const prev = candles[candles.length - 2].close
          const change = prev > 0 ? ((latest - prev) / prev) * 100 : 0
          setTokens((prevTokens) =>
            prevTokens.map((token) =>
              token.symbol === selectedTokenSymbol ? { ...token, price: latest, change } : token
            )
          )
          setChartCandles(candles)
        }
      } catch {
        if (!active) return
        setChartCandles([])
      }
    })()

    return () => {
      active = false
    }
  }, [chartPeriod, selectedTokenSymbol, setTokens])

  React.useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const response = await getMarketDepth(selectedTokenSymbol, 3)
        if (!active) return
        setOrderBook({ bids: response.bids, asks: response.asks })
      } catch {
        if (!active) return
        setOrderBook({ bids: [], asks: [] })
      }
    })()

    return () => {
      active = false
    }
  }, [selectedTokenSymbol])

  React.useEffect(() => {
    if (ordersError) {
      setOrders([])
      return
    }
    if (!ordersResponse) return
    const mapped: UiOrder[] = ordersResponse.items.map((order) => {
      const isBuy = stableSymbols.has(order.from_token.toUpperCase())
      return {
        id: order.order_id,
        type: isBuy ? "buy" : "sell",
        token: isBuy ? order.to_token : order.from_token,
        fromToken: order.from_token,
        amount: String(order.amount),
        price: String(order.price),
        expiry: order.expiry,
        status:
          order.status === 2
            ? "filled"
            : order.status === 3 || order.status === 4
            ? "cancelled"
            : "active",
        createdAt: formatDateTime(order.created_at),
        requestSource: "manual" as const,
      }
    })
    setOrders(withOrderSourceLabel(mapped))
  }, [ordersError, ordersResponse, withOrderSourceLabel])

  const refreshOrders = React.useCallback(async () => {
    await mutateOrders()
  }, [mutateOrders])

  return {
    activeNftDiscount,
    chartCandles,
    orderBook,
    orders,
    refreshOrders,
    setOrders,
    stakePointsMultiplier,
  }
}
