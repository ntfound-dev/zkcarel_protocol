"use client"

import * as React from "react"
import { getPortfolioAnalytics, getStakePools, listLimitOrders } from "@/lib/api"
import type { WalletContextType } from "@/hooks/wallet/use-wallet"
type SwapStats = { volume?: number; trades?: number }
type LimitStats = { activeOrders?: number; successRate?: number }
type StakeStats = { tvl?: number; maxApy?: number }

type UseFeaturedStatsParams = {
  wallet: WalletContextType
}

export const useFeaturedStats = ({ wallet }: UseFeaturedStatsParams) => {
  const [swapStats, setSwapStats] = React.useState<SwapStats>({})
  const [limitStats, setLimitStats] = React.useState<LimitStats>({})
  const [stakeStats, setStakeStats] = React.useState<StakeStats>({})

  React.useEffect(() => {
    let active = true

    const fetchStats = async () => {
      if (!active) return
      if (!wallet.isConnected) {
        setSwapStats({})
        setLimitStats({})
        setStakeStats({})
        return
      }

      const [
        analyticsRes,
        activeLimitRes,
        filledLimitRes,
        cancelledLimitRes,
        poolsRes,
      ] = await Promise.allSettled([
        getPortfolioAnalytics(),
        listLimitOrders(1, 1, "active"),
        listLimitOrders(1, 1, "filled"),
        listLimitOrders(1, 1, "cancelled"),
        getStakePools(),
      ])

      if (!active) return

      if (analyticsRes.status === "fulfilled") {
        const volume = Number(analyticsRes.value.trading.total_volume_usd)
        const trades = Number(analyticsRes.value.trading.total_trades)
        setSwapStats({
          volume: Number.isFinite(volume) ? volume : undefined,
          trades: Number.isFinite(trades) ? trades : undefined,
        })
      } else {
        setSwapStats({})
      }

      const activeOrders =
        activeLimitRes.status === "fulfilled"
          ? Number(activeLimitRes.value.total)
          : undefined
      const filledOrders =
        filledLimitRes.status === "fulfilled"
          ? Number(filledLimitRes.value.total)
          : undefined
      const cancelledOrders =
        cancelledLimitRes.status === "fulfilled"
          ? Number(cancelledLimitRes.value.total)
          : undefined
      const closedOrders =
        (Number.isFinite(filledOrders) ? (filledOrders as number) : 0) +
        (Number.isFinite(cancelledOrders) ? (cancelledOrders as number) : 0)
      const successRate =
        closedOrders > 0 && Number.isFinite(filledOrders)
          ? ((filledOrders as number) / closedOrders) * 100
          : undefined
      setLimitStats({
        activeOrders: Number.isFinite(activeOrders) ? activeOrders : undefined,
        successRate: Number.isFinite(successRate) ? successRate : undefined,
      })

      if (poolsRes.status === "fulfilled") {
        const totalTvl = poolsRes.value.reduce(
          (acc, pool) => acc + (Number(pool.tvl_usd) || 0),
          0
        )
        const maxApy = poolsRes.value.reduce(
          (acc, pool) => Math.max(acc, Number(pool.apy) || 0),
          0
        )
        setStakeStats({
          tvl: Number.isFinite(totalTvl) ? totalTvl : undefined,
          maxApy: Number.isFinite(maxApy) ? maxApy : undefined,
        })
      } else {
        setStakeStats({})
      }
    }

    void fetchStats()
    const timer = window.setInterval(() => {
      void fetchStats()
    }, 30_000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [wallet.address, wallet.isConnected, wallet.token])

  return { swapStats, limitStats, stakeStats }
}
