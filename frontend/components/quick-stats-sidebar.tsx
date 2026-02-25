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

interface QuickStatsSidebarProps {
  variant?: "sidebar" | "inline"
  className?: string
}

interface StatCardProps {
  icon: React.ElementType
  label: string
  value: string | number
  valueTitle?: string
  subValue?: string
  progress?: number
  trend?: {
    value: string
    isPositive: boolean
  }
  className?: string
}

function formatCompactNumber(value: number, maxFractionDigits = 2): string {
  if (!Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  if (abs < 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: maxFractionDigits })
  }
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: maxFractionDigits,
  }).format(value)
}

/**
 * Handles `StatCard` logic.
 *
 * @param icon - Input used by `StatCard` to compute state, payload, or request behavior.
 * @param label - Input used by `StatCard` to compute state, payload, or request behavior.
 * @param value - Input used by `StatCard` to compute state, payload, or request behavior.
 * @param subValue - Input used by `StatCard` to compute state, payload, or request behavior.
 * @param progress - Input used by `StatCard` to compute state, payload, or request behavior.
 * @param trend - Input used by `StatCard` to compute state, payload, or request behavior.
 * @param className - Input used by `StatCard` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function StatCard({ icon: Icon, label, value, valueTitle, subValue, progress, trend, className }: StatCardProps) {
  return (
    <div className={cn(
      "p-4 rounded-xl glass carel-zk-card border border-border hover:border-primary/40 transition-all duration-300 group",
      className
    )}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-primary group-hover:animate-pulse-glow" />
        <span className="carel-tech-label carel-section-label">
          {label}
        </span>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <p
            title={valueTitle}
            className="text-xl lg:text-2xl leading-tight whitespace-normal [overflow-wrap:anywhere] carel-tech-title carel-primary-value"
          >
            {value}
          </p>
          {subValue && (
            <p className="text-xs carel-secondary-text mt-1">{subValue}</p>
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

/**
 * Handles `LeaderboardRank` logic.
 *
 * @param rank - Input used by `LeaderboardRank` to compute state, payload, or request behavior.
 * @param change - Input used by `LeaderboardRank` to compute state, payload, or request behavior.
 * @param categories - Input used by `LeaderboardRank` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function LeaderboardRank({ rank, change, categories }: LeaderboardRankProps) {
  return (
    <div className="p-4 rounded-xl glass carel-zk-card border border-border hover:border-primary/40 transition-all duration-300">
      <div className="flex items-center gap-2 mb-3">
        <Trophy className="h-4 w-4 text-primary" />
        <span className="carel-tech-label carel-section-label">
          Leaderboard Rank
        </span>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-2xl lg:text-3xl carel-tech-title carel-primary-value">
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
            <span className="carel-secondary-text">{cat.label}</span>
            <span className="carel-primary-value font-semibold">
              {cat.rank && cat.rank > 0 ? `#${cat.rank}` : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Handles `QuickStatsSidebar` logic.
 *
 * @param className - Input used by `QuickStatsSidebar` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function QuickStatsSidebar({ variant = "sidebar", className }: QuickStatsSidebarProps) {
  const wallet = useWallet()
  const [points, setPoints] = React.useState<number | null>(null)
  const [tierLabel, setTierLabel] = React.useState("—")
  const [tierProgress, setTierProgress] = React.useState(0)
  const [tierSubValue, setTierSubValue] = React.useState("—")
  const [volumeLabel, setVolumeLabel] = React.useState("—")
  const [volumeFullLabel, setVolumeFullLabel] = React.useState<string | undefined>(undefined)
  const [lastKnownActiveTierId, setLastKnownActiveTierId] = React.useState<number | null>(null)
  const [rankData, setRankData] = React.useState<{ rank: number | null; change: number; total: number }>({ rank: null, change: 0, total: 0 })
  const [categoryRanks, setCategoryRanks] = React.useState<Array<{ label: string; rank: number | null }>>([
    { label: "Total Points", rank: null },
    { label: "Trading", rank: null },
    { label: "Referral", rank: null },
  ])
  const stripRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef({
    active: false,
    moved: false,
    startX: 0,
    startScrollLeft: 0,
  })
  const [isDragging, setIsDragging] = React.useState(false)

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

    /**
     * Handles `loadPoints` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
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
              setTierSubValue(
                `Upgrade unlock: ${formatCompactNumber(totalPoints)} / ${formatCompactNumber(nextTier.mintCost)} (cached)`
              )
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
              : `Progress to ${firstTier?.name ?? "first tier"}: ${formatCompactNumber(totalPoints)} / ${
                  firstTier ? formatCompactNumber(firstTier.mintCost) : "—"
                }`
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
        setTierSubValue(`Upgrade unlock: ${formatCompactNumber(totalPoints)} / ${formatCompactNumber(nextTier.mintCost)}`)
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
    /**
     * Updates state for `resetRank`.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const resetRank = () => {
      setRankData({ rank: null, change: 0, total: 0 })
      setCategoryRanks([
        { label: "Total Points", rank: null },
        { label: "Trading", rank: null },
        { label: "Referral", rank: null },
      ])
    }

    /**
     * Handles `loadRanks` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
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

  const beginDrag = React.useCallback((clientX: number) => {
    const strip = stripRef.current
    if (!strip) return
    dragRef.current.active = true
    dragRef.current.moved = false
    dragRef.current.startX = clientX
    dragRef.current.startScrollLeft = strip.scrollLeft
    setIsDragging(true)
  }, [])

  const moveDrag = React.useCallback((clientX: number) => {
    const strip = stripRef.current
    if (!strip || !dragRef.current.active) return
    const deltaX = clientX - dragRef.current.startX
    if (Math.abs(deltaX) > 3) {
      dragRef.current.moved = true
    }
    strip.scrollLeft = dragRef.current.startScrollLeft - deltaX
  }, [])

  const endDrag = React.useCallback(() => {
    dragRef.current.active = false
    setIsDragging(false)
    window.setTimeout(() => {
      dragRef.current.moved = false
    }, 0)
  }, [])

  const statsBlocks = (
    <>
      <StatCard
        icon={Diamond}
        label="Usable Points"
        value={points !== null ? formatCompactNumber(points) : "—"}
        valueTitle={points !== null ? points.toLocaleString() : undefined}
        subValue={points !== null ? "Current balance" : undefined}
        progress={points !== null ? Math.round(tierProgress) : 0}
        className={cn(variant === "inline" && "w-[250px] min-w-[250px]")}
      />

      <StatCard
        icon={Trophy}
        label="Tier Progress"
        value={tierLabel}
        subValue={tierSubValue}
        progress={points !== null ? Math.round(tierProgress) : 0}
        className={cn(variant === "inline" && "w-[250px] min-w-[250px]")}
      />

      <StatCard
        icon={BarChart3}
        label="Total Volume"
        value={volumeLabel}
        valueTitle={volumeFullLabel}
        subValue={volumeFullLabel}
        className={cn(variant === "inline" && "w-[250px] min-w-[250px]")}
      />

      <div className={cn(variant === "inline" && "w-[250px] min-w-[250px]")}>
        <LeaderboardRank
          rank={rankData.rank}
          change={rankData.change}
          categories={categoryRanks}
        />
      </div>
    </>
  )

  if (variant === "inline") {
    return (
      <section className={cn("w-full", className)}>
        <h2 className="text-sm font-bold uppercase tracking-widest px-1 mb-3 carel-tech-label carel-section-label">
          Quick Stats
        </h2>
        <div
          ref={stripRef}
          className={cn(
            "flex gap-3 overflow-x-auto pb-2 select-none",
            isDragging ? "cursor-grabbing" : "cursor-grab"
          )}
          onMouseDown={(event) => beginDrag(event.clientX)}
          onMouseMove={(event) => moveDrag(event.clientX)}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          onTouchStart={(event) => beginDrag(event.touches[0]?.clientX ?? 0)}
          onTouchMove={(event) => moveDrag(event.touches[0]?.clientX ?? 0)}
          onTouchEnd={endDrag}
          onDragStart={(event) => event.preventDefault()}
        >
          {statsBlocks}
        </div>
      </section>
    )
  }

  return (
    <aside className={cn("w-72 shrink-0 hidden xl:block", className)}>
      <div className="sticky top-20 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-widest px-1 mb-4 carel-tech-label carel-section-label">
          Quick Stats
        </h2>
        {statsBlocks}
      </div>
    </aside>
  )
}
