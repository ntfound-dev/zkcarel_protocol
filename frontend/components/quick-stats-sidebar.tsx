"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Diamond, Trophy, BarChart3, ChevronUp, ChevronDown } from "lucide-react"
import {
  getLeaderboardUserCategories,
  getLeaderboardUserRank,
  getOwnedNfts,
  getPortfolioAnalytics,
  getRewardsPoints,
  type NFTItem,
} from "@/lib/api"
import { useWallet } from "@/hooks/use-wallet"

interface StatCardProps {
  icon: React.ElementType
  label: string
  value: string | number
  subValue?: string
  progress?: number
  trend?: {
    value: string
    isPositive: boolean
  }
  className?: string
}

function StatCard({ icon: Icon, label, value, subValue, progress, trend, className }: StatCardProps) {
  return (
    <div className={cn(
      "p-4 rounded-xl glass border border-border hover:border-primary/50 transition-all duration-300 group",
      className
    )}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-primary group-hover:animate-pulse-glow" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          {subValue && (
            <p className="text-xs text-muted-foreground mt-1">{subValue}</p>
          )}
        </div>
        {trend && (
          <div className={cn(
            "flex items-center gap-1 text-sm font-medium",
            trend.isPositive ? "text-success" : "text-destructive"
          )}>
            {trend.isPositive ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            {trend.value}
          </div>
        )}
      </div>
      {progress !== undefined && (
        <div className="mt-3">
          <div className="h-2 rounded-full bg-surface overflow-hidden">
            <div 
              className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all duration-500"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

interface LeaderboardRankProps {
  rank: number | null
  change: number
  categories: {
    label: string
    rank: number | null
  }[]
}

function LeaderboardRank({ rank, change, categories }: LeaderboardRankProps) {
  return (
    <div className="p-4 rounded-xl glass border border-border hover:border-primary/50 transition-all duration-300">
      <div className="flex items-center gap-2 mb-3">
        <Trophy className="h-4 w-4 text-primary" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Leaderboard Rank
        </span>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-3xl font-bold text-foreground">
          {rank && rank > 0 ? `#${rank}` : "—"}
        </span>
        <span className={cn(
          "flex items-center gap-1 text-sm font-medium px-2 py-0.5 rounded-full",
          change > 0 ? "bg-success/20 text-success" : change < 0 ? "bg-destructive/20 text-destructive" : "bg-muted text-muted-foreground"
        )}>
          {change > 0 ? (
            <><ChevronUp className="h-3 w-3" />+{change}</>
          ) : change < 0 ? (
            <><ChevronDown className="h-3 w-3" />{change}</>
          ) : (
            "—"
          )}
        </span>
      </div>
      <div className="space-y-2">
        {categories.map((cat) => (
          <div key={cat.label} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{cat.label}</span>
            <span className="font-medium text-foreground">
              {cat.rank && cat.rank > 0 ? `#${cat.rank}` : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function QuickStatsSidebar() {
  const wallet = useWallet()
  const [points, setPoints] = React.useState<number | null>(null)
  const [tierLabel, setTierLabel] = React.useState("—")
  const [tierProgress, setTierProgress] = React.useState(0)
  const [tierSubValue, setTierSubValue] = React.useState("—")
  const [volumeLabel, setVolumeLabel] = React.useState("—")
  const [lastKnownActiveTierId, setLastKnownActiveTierId] = React.useState<number | null>(null)
  const [rankData, setRankData] = React.useState<{ rank: number | null; change: number; total: number }>({ rank: null, change: 0, total: 0 })
  const [categoryRanks, setCategoryRanks] = React.useState<Array<{ label: string; rank: number | null }>>([
    { label: "Total Points", rank: null },
    { label: "Trading", rank: null },
    { label: "Referral", rank: null },
  ])

  const nftTierConfig = React.useMemo(
    () => [
      { tierId: 1, name: "Bronze", mintCost: 5_000 },
      { tierId: 2, name: "Silver", mintCost: 15_000 },
      { tierId: 3, name: "Gold", mintCost: 50_000 },
      { tierId: 4, name: "Platinum", mintCost: 150_000 },
      { tierId: 5, name: "Onyx", mintCost: 500_000 },
    ],
    []
  )

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
            const cachedTier = nftTierConfig.find((tier) => tier.tierId === lastKnownActiveTierId) || null
            if (cachedTier) {
              const cachedIndex = nftTierConfig.findIndex((tier) => tier.tierId === cachedTier.tierId)
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
              setTierSubValue(`Upgrade unlock: ${totalPoints.toLocaleString()} / ${nextTier.mintCost.toLocaleString()} (cached)`)
              return
            }
          }
          const firstTier = nftTierConfig[0]
          const progress = firstTier ? Math.min(100, Math.max(0, (totalPoints / firstTier.mintCost) * 100)) : 0
          const isMintReady = Boolean(firstTier && totalPoints >= firstTier.mintCost)
          setTierLabel("None")
          setTierProgress(progress)
          setTierSubValue(
            isMintReady
              ? `Mint ${firstTier.name} NFT to activate tier`
              : `Progress to ${firstTier?.name ?? "first tier"}: ${totalPoints.toLocaleString()} / ${firstTier?.mintCost.toLocaleString() ?? "—"}`
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
        setTierSubValue(`Upgrade unlock: ${totalPoints.toLocaleString()} / ${nextTier.mintCost.toLocaleString()}`)
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
    }, 10000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [wallet.address, wallet.starknetAddress, wallet.evmAddress, wallet.btcAddress, nftTierConfig, lastKnownActiveTierId])

  React.useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const analytics = await getPortfolioAnalytics()
        if (!active) return
        const volume = Number(analytics.trading.total_volume_usd)
        setVolumeLabel(Number.isFinite(volume) ? `$${volume.toLocaleString()}` : "—")
      } catch {
        if (!active) return
        setVolumeLabel("—")
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
      setCategoryRanks([
        { label: "Total Points", rank: null },
        { label: "Trading", rank: null },
        { label: "Referral", rank: null },
      ])
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
    }, 15000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [wallet.address, wallet.starknetAddress])

  return (
    <aside className="w-72 shrink-0 hidden xl:block">
      <div className="sticky top-20 space-y-4">
        <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest px-1 mb-4">
          Quick Stats
        </h2>
        
        <StatCard
          icon={Diamond}
          label="Usable Points"
          value={points !== null ? points.toLocaleString() : "—"}
          progress={points !== null ? Math.round(tierProgress) : 0}
        />

        <StatCard
          icon={Trophy}
          label="Tier Progress"
          value={tierLabel}
          subValue={tierSubValue}
          progress={points !== null ? Math.round(tierProgress) : 0}
        />

        <StatCard
          icon={BarChart3}
          label="Total Volume"
          value={volumeLabel}
        />

        <LeaderboardRank
          rank={rankData.rank}
          change={rankData.change}
          categories={categoryRanks}
        />
      </div>
    </aside>
  )
}
