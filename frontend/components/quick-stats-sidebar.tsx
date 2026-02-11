"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Diamond, Trophy, BarChart3, ChevronUp, ChevronDown } from "lucide-react"
import { getLeaderboardUserCategories, getLeaderboardUserRank, getPortfolioAnalytics, getRewardsPoints } from "@/lib/api"
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
  const [rankData, setRankData] = React.useState<{ rank: number | null; change: number; total: number }>({ rank: null, change: 0, total: 0 })
  const [categoryRanks, setCategoryRanks] = React.useState<Array<{ label: string; rank: number | null }>>([
    { label: "Total Points", rank: null },
    { label: "Trading", rank: null },
    { label: "Referral", rank: null },
  ])

  React.useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const response = await getRewardsPoints()
        if (!active) return
        const totalPoints = Math.round(response.total_points)
        setPoints(totalPoints)

        const tiers = [
          { name: "Bronze", threshold: 1000 },
          { name: "Silver", threshold: 5000 },
          { name: "Gold", threshold: 10000 },
          { name: "Platinum", threshold: 20000 },
        ]

        const currentTier = tiers.find((tier, idx) =>
          totalPoints < tiers[Math.min(idx + 1, tiers.length - 1)].threshold
        ) || tiers[tiers.length - 1]

        const currentIndex = tiers.indexOf(currentTier)
        const nextTier = tiers[currentIndex + 1]
        const prevThreshold = currentIndex === 0 ? 0 : tiers[currentIndex - 1].threshold
        const nextThreshold = nextTier ? nextTier.threshold : currentTier.threshold
        const progress = nextThreshold === prevThreshold
          ? 100
          : ((totalPoints - prevThreshold) / (nextThreshold - prevThreshold)) * 100

        setTierLabel(currentTier.name)
        setTierProgress(Math.min(Math.max(progress, 0), 100))
        setTierSubValue(`${totalPoints.toLocaleString()} / ${nextThreshold.toLocaleString()}`)
      } catch {
        if (!active) return
        setPoints(null)
        setTierLabel("—")
        setTierProgress(0)
        setTierSubValue("—")
      }
    })()

    return () => {
      active = false
    }
  }, [])

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
    ;(async () => {
      try {
        if (!wallet.address) {
          setRankData({ rank: null, change: 0, total: 0 })
          setCategoryRanks([
            { label: "Total Points", rank: null },
            { label: "Trading", rank: null },
            { label: "Referral", rank: null },
          ])
          return
        }
        const [rankRes, categoriesRes] = await Promise.allSettled([
          getLeaderboardUserRank(wallet.address),
          getLeaderboardUserCategories(wallet.address),
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
        setRankData({ rank: null, change: 0, total: 0 })
        setCategoryRanks([
          { label: "Total Points", rank: null },
          { label: "Trading", rank: null },
          { label: "Referral", rank: null },
        ])
      }
    })()

    return () => {
      active = false
    }
  }, [wallet.address])

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
