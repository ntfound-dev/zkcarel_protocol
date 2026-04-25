"use client"

import * as React from "react"
import type { WalletContextType } from "@/hooks/wallet/use-wallet"
import {
  getLeaderboardUserCategories,
  getLeaderboardUserRank,
  getOwnedNfts,
  getPortfolioAnalytics,
  getRewardsPoints,
  type NFTItem,
} from "@/lib/api"
import { formatCompactNumber } from "@/lib/utils"

type PointsData = {
  points: number | null
  pointsLabel: string
  pointsTitle?: string
  pointsSubValue?: string
  tierLabel: string
  tierProgress: number
  tierSubValue: string
}

type VolumeData = {
  volumeLabel: string
  volumeFullLabel?: string
}

type RankCategory = {
  label: string
  rank: number | null
}

type RankData = {
  rank: number | null
  change: number
  total: number
  categories: RankCategory[]
}

type UseQuickStatsDataParams = {
  wallet: WalletContextType
}

const nftTierConfig = [
  { tierId: 1, name: "Bronze", mintCost: 5_000 },
  { tierId: 2, name: "Silver", mintCost: 15_000 },
  { tierId: 3, name: "Gold", mintCost: 50_000 },
  { tierId: 4, name: "Platinum", mintCost: 150_000 },
  { tierId: 5, name: "Onyx", mintCost: 500_000 },
]

const defaultCategories: RankCategory[] = [
  { label: "Total Points", rank: null },
  { label: "Trading", rank: null },
  { label: "Referral", rank: null },
]

export const useQuickStatsData = ({ wallet }: UseQuickStatsDataParams) => {
  const [points, setPoints] = React.useState<number | null>(null)
  const [tierLabel, setTierLabel] = React.useState("—")
  const [tierProgress, setTierProgress] = React.useState(0)
  const [tierSubValue, setTierSubValue] = React.useState("—")
  const [volumeLabel, setVolumeLabel] = React.useState("—")
  const [volumeFullLabel, setVolumeFullLabel] = React.useState<string | undefined>(undefined)
  const [lastKnownActiveTierId, setLastKnownActiveTierId] = React.useState<number | null>(null)
  const [rankData, setRankData] = React.useState<{ rank: number | null; change: number; total: number }>({
    rank: null,
    change: 0,
    total: 0,
  })
  const [categoryRanks, setCategoryRanks] = React.useState<RankCategory[]>(defaultCategories)

  React.useEffect(() => {
    let active = true

    const loadPoints = async () => {
      try {
        const [response, nfts] = await Promise.all([
          getRewardsPoints(),
          getOwnedNfts().catch(() => [] as NFTItem[]),
        ])
        if (!active) return
        const totalPoints = Math.round(response.total_points)
        setPoints(totalPoints)
        const now = Math.floor(Date.now() / 1000)
        const activeNft = nfts.find((nft) => !nft.used && (!nft.expiry || nft.expiry > now)) || null
        const activeTier = activeNft
          ? nftTierConfig.find((tier) => tier.tierId === activeNft.tier) || null
          : null

        if (!activeTier) {
          if (nfts.length === 0 && lastKnownActiveTierId) {
            const cachedTier =
              nftTierConfig.find((tier) => tier.tierId === lastKnownActiveTierId) || null
            if (cachedTier) {
              const cachedIndex = nftTierConfig.findIndex(
                (tier) => tier.tierId === cachedTier.tierId
              )
              const nextTier = cachedIndex >= 0 ? nftTierConfig[cachedIndex + 1] : undefined
              if (!nextTier) {
                setTierLabel(cachedTier.name)
                setTierProgress(100)
                setTierSubValue("Max NFT tier active (cached)")
                return
              }
              const progress = Math.min(100, Math.max(0, (totalPoints / nextTier.mintCost) * 100))
              setTierLabel(cachedTier.name)
              setTierProgress(progress)
              setTierSubValue(
                `Upgrade unlock: ${formatCompactNumber(totalPoints)} / ${formatCompactNumber(
                  nextTier.mintCost
                )} (cached)`
              )
              return
            }
          }
          const firstTier = nftTierConfig[0]
          const progress = firstTier
            ? Math.min(100, Math.max(0, (totalPoints / firstTier.mintCost) * 100))
            : 0
          const isMintReady = Boolean(firstTier && totalPoints >= firstTier.mintCost)
          setTierLabel("None")
          setTierProgress(progress)
          setTierSubValue(
            isMintReady
              ? `Mint ${firstTier.name} NFT to activate tier`
              : `Progress to ${firstTier?.name ?? "first tier"}: ${formatCompactNumber(
                  totalPoints
                )} / ${firstTier ? formatCompactNumber(firstTier.mintCost) : "—"}`
          )
          return
        }

        const activeIndex = nftTierConfig.findIndex((tier) => tier.tierId === activeTier.tierId)
        setLastKnownActiveTierId(activeTier.tierId)
        const nextTier = activeIndex >= 0 ? nftTierConfig[activeIndex + 1] : undefined
        if (!nextTier) {
          setTierLabel(activeTier.name)
          setTierProgress(100)
          setTierSubValue("Max NFT tier active")
          return
        }

        const progress = Math.min(100, Math.max(0, (totalPoints / nextTier.mintCost) * 100))
        setTierLabel(activeTier.name)
        setTierProgress(progress)
        setTierSubValue(
          `Upgrade unlock: ${formatCompactNumber(totalPoints)} / ${formatCompactNumber(
            nextTier.mintCost
          )}`
        )
      } catch {
        if (!active) return
        setPoints(null)
        setTierLabel("—")
        setTierProgress(0)
        setTierSubValue("—")
      }
    }

    void loadPoints()
    const timer = window.setInterval(() => {
      void loadPoints()
    }, 10_000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [
    wallet.address,
    wallet.starknetAddress,
    wallet.evmAddress,
    wallet.btcAddress,
    lastKnownActiveTierId,
  ])

  React.useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const analytics = await getPortfolioAnalytics()
        if (!active) return
        const volume = Number(analytics.trading.total_volume_usd)
        if (Number.isFinite(volume)) {
          setVolumeLabel(`$${formatCompactNumber(volume)}`)
          setVolumeFullLabel(`Full: $${volume.toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
        } else {
          setVolumeLabel("—")
          setVolumeFullLabel(undefined)
        }
      } catch {
        if (!active) return
        setVolumeLabel("—")
        setVolumeFullLabel(undefined)
      }
    })()

    return () => {
      active = false
    }
  }, [])

  React.useEffect(() => {
    let active = true
    const rankAddress = wallet.starknetAddress || wallet.address

    const resetRank = () => {
      setRankData({ rank: null, change: 0, total: 0 })
      setCategoryRanks(defaultCategories)
    }

    const loadRanks = async () => {
      try {
        if (!rankAddress) {
          if (!active) return
          resetRank()
          return
        }

        const [rankRes, categoriesRes] = await Promise.allSettled([
          getLeaderboardUserRank(rankAddress),
          getLeaderboardUserCategories(rankAddress),
        ])
        if (!active) return
        if (rankRes.status === "fulfilled") {
          setRankData({ rank: rankRes.value.rank, change: 0, total: rankRes.value.total_users })
        }
        if (categoriesRes.status === "fulfilled" && categoriesRes.value.categories.length > 0) {
          const categoryMap = new Map(
            categoriesRes.value.categories.map((item) => [item.category, item.rank])
          )
          setCategoryRanks([
            { label: "Total Points", rank: categoryMap.get("points") ?? null },
            { label: "Trading", rank: categoryMap.get("volume") ?? null },
            { label: "Referral", rank: categoryMap.get("referrals") ?? null },
          ])
        }
      } catch {
        if (!active) return
        resetRank()
      }
    }

    void loadRanks()
    const timer = window.setInterval(() => {
      void loadRanks()
    }, 15_000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [wallet.address, wallet.starknetAddress])

  const pointsData: PointsData = {
    points,
    pointsLabel: points !== null ? formatCompactNumber(points) : "—",
    pointsTitle: points !== null ? points.toLocaleString() : undefined,
    pointsSubValue: points !== null ? "Current balance" : undefined,
    tierLabel,
    tierProgress,
    tierSubValue,
  }

  const volumeData: VolumeData = {
    volumeLabel,
    volumeFullLabel,
  }

  const rankSummary: RankData = {
    rank: rankData.rank,
    change: rankData.change,
    total: rankData.total,
    categories: categoryRanks,
  }

  return { pointsData, volumeData, rankData: rankSummary }
}
