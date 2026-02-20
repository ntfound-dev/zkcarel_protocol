"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { ArrowRightLeft, TrendingUp, Coins, ChevronLeft, ChevronRight, Users, ExternalLink, Gamepad2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ReferralLog } from "@/components/referral-log"
import { getPortfolioAnalytics, getReferralStats, getRewardsPoints, getStakePools, listLimitOrders } from "@/lib/api"
import { useWallet } from "@/hooks/use-wallet"

// Animated counter for dynamic stats - starts at 0 on server, animates on client
function useAnimatedValue(end: number, duration: number = 1500) {
  const [value, setValue] = React.useState(0)
  const [hasAnimated, setHasAnimated] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  React.useEffect(() => {
    if (!mounted) return
    
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated) {
          setHasAnimated(true)
          let startTime: number | null = null
          
          /**
           * Handles `animate` logic.
           *
           * @param timestamp - Input used by `animate` to compute state, payload, or request behavior.
           *
           * @returns Result consumed by caller flow, UI state updates, or async chaining.
           * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
           */
          const animate = (timestamp: number) => {
            if (!startTime) startTime = timestamp
            const progress = Math.min((timestamp - startTime) / duration, 1)
            const easeOut = 1 - Math.pow(1 - progress, 3)
            setValue(Math.floor(easeOut * end))
            
            if (progress < 1) {
              requestAnimationFrame(animate)
            }
          }
          
          requestAnimationFrame(animate)
        }
      },
      { threshold: 0.1 }
    )

    if (ref.current) {
      observer.observe(ref.current)
    }

    return () => observer.disconnect()
  }, [end, duration, hasAnimated, mounted])

  React.useEffect(() => {
    if (!mounted || !hasAnimated) return
    setValue(Math.floor(end))
  }, [end, mounted, hasAnimated])

  return { value, ref }
}
export type SelectableFeatureId = "swap-bridge" | "limit-order" | "stake-earn" | "defi-futures"
type FeatureId = SelectableFeatureId | "referral" | "defi-futures"

interface FeaturedCardsProps {
  onSelectFeature?: (featureId: SelectableFeatureId) => void
  activeFeatureId?: SelectableFeatureId | null
}

/**
 * Handles `FeaturedCards` logic.
 *
 * @param onSelectFeature - Input used by `FeaturedCards` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function FeaturedCards({ onSelectFeature, activeFeatureId = null }: FeaturedCardsProps = {}) {
  const wallet = useWallet()
  const scrollContainerRef = React.useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = React.useState(false)
  const [canScrollRight, setCanScrollRight] = React.useState(true)
  const [referralOpen, setReferralOpen] = React.useState(false)
  const [swapStats, setSwapStats] = React.useState<{ volume?: number; trades?: number }>({})
  const [limitStats, setLimitStats] = React.useState<{ activeOrders?: number; successRate?: number }>({})
  const [stakeStats, setStakeStats] = React.useState<{ tvl?: number; maxApy?: number }>({})
  const [referralStats, setReferralStats] = React.useState<{ totalReferrals?: number; referralPoints?: number }>({})

  /**
   * Handles `checkScroll` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const checkScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current
      setCanScrollLeft(scrollLeft > 0)
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10)
    }
  }

  React.useEffect(() => {
    checkScroll()
    window.addEventListener('resize', checkScroll)
    return () => window.removeEventListener('resize', checkScroll)
  }, [])

  React.useEffect(() => {
    let active = true

    /**
     * Fetches data for `fetchStats`.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const fetchStats = async () => {
      if (!active) return
      if (!wallet.isConnected) {
        setSwapStats({})
        setLimitStats({})
        setStakeStats({})
        setReferralStats({})
        return
      }

      const [
        analyticsRes,
        activeLimitRes,
        filledLimitRes,
        cancelledLimitRes,
        poolsRes,
        referralRes,
        pointsRes,
      ] = await Promise.allSettled([
        getPortfolioAnalytics(),
        listLimitOrders(1, 1, "active"),
        listLimitOrders(1, 1, "filled"),
        listLimitOrders(1, 1, "cancelled"),
        getStakePools(),
        getReferralStats(),
        getRewardsPoints(),
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
        const totalTvl = poolsRes.value.reduce((acc, pool) => acc + (Number(pool.tvl_usd) || 0), 0)
        const maxApy = poolsRes.value.reduce((acc, pool) => Math.max(acc, Number(pool.apy) || 0), 0)
        setStakeStats({
          tvl: Number.isFinite(totalTvl) ? totalTvl : undefined,
          maxApy: Number.isFinite(maxApy) ? maxApy : undefined,
        })
      } else {
        setStakeStats({})
      }

      let totalReferrals: number | undefined
      let referralPoints: number | undefined
      if (referralRes.status === "fulfilled") {
        const total = Number(referralRes.value.total_referrals)
        const rewards = Number(referralRes.value.total_rewards)
        totalReferrals = Number.isFinite(total) ? total : undefined
        referralPoints = Number.isFinite(rewards) ? rewards : undefined
      }
      if (pointsRes.status === "fulfilled") {
        const epochReferralPoints = Number(pointsRes.value.referral_points)
        if (Number.isFinite(epochReferralPoints)) {
          referralPoints = Math.max(referralPoints || 0, epochReferralPoints)
        }
      }
      setReferralStats({
        totalReferrals,
        referralPoints,
      })
    }

    void fetchStats()
    const timer = window.setInterval(() => {
      void fetchStats()
    }, 30000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [wallet.address, wallet.isConnected, wallet.token])

  /**
   * Handles `scroll` logic.
   *
   * @param direction - Input used by `scroll` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const scrollAmount = 400
      const newScrollLeft = direction === 'left' 
        ? scrollContainerRef.current.scrollLeft - scrollAmount
        : scrollContainerRef.current.scrollLeft + scrollAmount
      
      scrollContainerRef.current.scrollTo({
        left: newScrollLeft,
        behavior: 'smooth'
      })
    }
  }

  const features: Feature[] = React.useMemo(() => [
    {
      id: "swap-bridge",
      title: "Swap & Bridge",
      description: "Trade tokens seamlessly across chains with zero-knowledge privacy",
      icon: ArrowRightLeft,
      gradient: "from-primary via-accent to-secondary",
      stats: [
        { label: "Your Volume", value: "—", numericValue: swapStats.volume, prefix: "$" },
        { label: "Your Trades", value: "—", numericValue: swapStats.trades },
      ],
      cta: "Explore",
    },
    {
      id: "limit-order",
      title: "Limit Order",
      description: "Set your price and let the market come to you with advanced order types",
      icon: TrendingUp,
      gradient: "from-secondary via-primary to-accent",
      stats: [
        { label: "Active Orders", value: "—", numericValue: limitStats.activeOrders },
        { label: "Success Rate", value: "—", numericValue: limitStats.successRate, suffix: "%" },
      ],
      cta: "Open",
    },
    {
      id: "stake-earn",
      title: "Stake & Earn",
      description: "Earn passive income by staking your crypto assets with competitive APY",
      icon: Coins,
      gradient: "from-accent via-secondary to-primary",
      stats: [
        { label: "TVL", value: "—", numericValue: stakeStats.tvl, prefix: "$" },
        { label: "APY", value: stakeStats.maxApy ? `Up to ${stakeStats.maxApy.toFixed(2)}%` : "—", numericValue: stakeStats.maxApy, prefix: "Up to ", suffix: "%" },
      ],
      cta: "Open",
    },
    {
      id: "referral",
      title: "Referral Program",
      description: "Invite friends and earn bonus points on their trading activity",
      icon: Users,
      gradient: "from-success via-primary to-accent",
      stats: [
        { label: "Total Referrals", value: "—", numericValue: referralStats.totalReferrals },
        { label: "Points Earned", value: "—", numericValue: referralStats.referralPoints },
      ],
      isReferral: true,
      cta: "View Log",
    },
    {
      id: "defi-futures",
      title: "Battleship",
      description:
        "Private strategy game with ZK fairness. Reward points are tuned lower for balanced progression.",
      icon: Gamepad2,
      gradient: "from-primary via-secondary to-success",
      stats: [
        { label: "Win Reward", value: "+20 pts" },
        { label: "Hit Reward", value: "+3 pts" },
      ],
      cta: "Open",
    },
  ], [swapStats, limitStats, stakeStats, referralStats])

  return (
    <section className="relative">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-foreground">Featured DeFi Services</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => scroll('left')}
            disabled={!canScrollLeft}
            className={cn(
              "h-8 w-8 rounded-full bg-transparent border-border",
              !canScrollLeft && "opacity-50 cursor-not-allowed"
            )}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => scroll('right')}
            disabled={!canScrollRight}
            className={cn(
              "h-8 w-8 rounded-full bg-transparent border-border",
              !canScrollRight && "opacity-50 cursor-not-allowed"
            )}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div 
        ref={scrollContainerRef}
        onScroll={checkScroll}
        className="flex gap-6 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-4"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {features.map((feature) => (
          <FeatureCard 
            key={feature.id} 
            feature={feature} 
            onReferralClick={() => setReferralOpen(true)}
            onSelect={onSelectFeature}
            isActive={!feature.isReferral && activeFeatureId === feature.id}
          />
        ))}
      </div>

      {/* Gradient Overlays for scroll indication */}
      {canScrollLeft && (
        <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-background to-transparent pointer-events-none z-10" />
      )}
      {canScrollRight && (
        <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-background to-transparent pointer-events-none z-10" />
      )}

      {/* Referral Log Dialog */}
      <ReferralLog 
        isOpen={referralOpen} 
        onOpenChange={setReferralOpen}
        showTrigger={false}
        pointsEarned={referralStats.referralPoints || 0}
      />
    </section>
  )
}

interface Feature {
  id: FeatureId
  title: string
  description: string
  icon: typeof ArrowRightLeft
  gradient: string
  stats: Array<{
    label: string
    value: string
    numericValue?: number
    prefix?: string
    suffix?: string
  }>
  comingSoon?: boolean
  isReferral?: boolean
  cta?: string
}

/**
 * Handles `FeatureCard` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function FeatureCard({ 
  feature, 
  onReferralClick,
  onSelect,
  isActive = false,
}: { 
  feature: Feature
  onReferralClick: () => void
  onSelect?: (featureId: SelectableFeatureId) => void
  isActive?: boolean
}) {
  const stat1 = useAnimatedValue(feature.stats[0]?.numericValue || 0)
  const stat2 = useAnimatedValue(feature.stats[1]?.numericValue || 0)
  const cardRef = React.useCallback((node: HTMLDivElement | null) => {
    stat1.ref.current = node
    stat2.ref.current = node
  }, [stat1.ref, stat2.ref])
  
  /**
   * Parses or transforms values for `formatValue`.
   *
   * @param stat - Input used by `formatValue` to compute state, payload, or request behavior.
   * @param animatedValue - Input used by `formatValue` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const formatValue = (stat: Feature['stats'][0], animatedValue: number) => {
    if (stat.numericValue === undefined || stat.numericValue === null) return stat.value
    
    const prefix = stat.prefix || ''
    const suffix = stat.suffix || ''
    
    if (animatedValue >= 1000000) {
      return `${prefix}${(animatedValue / 1000000).toFixed(1)}M${suffix}`
    } else if (animatedValue >= 1000) {
      return `${prefix}${(animatedValue / 1000).toFixed(1)}K${suffix}`
    }
    return `${prefix}${animatedValue.toLocaleString()}${suffix}`
  }

  const wrapperClass = cn(
    "group flex-shrink-0 w-[350px] snap-start text-left cursor-pointer",
    feature.comingSoon && "cursor-default"
  )

  const cardBody = (
    <div 
      ref={cardRef}
      className={cn(
        "relative h-full p-6 rounded-2xl border border-border glass overflow-hidden transition-all duration-300",
        !feature.comingSoon && "hover:border-primary/50 hover:shadow-lg hover:shadow-primary/20 hover:-translate-y-1",
        isActive && "border-primary shadow-lg shadow-primary/20"
      )}
    >
      {/* Background Gradient */}
      <div className={cn(
        "absolute inset-0 transition-opacity duration-500 bg-gradient-to-br",
        isActive ? "opacity-10" : "opacity-0 group-hover:opacity-10",
        feature.gradient
      )} />

      {/* Content */}
      <div className="relative z-10">
        {/* Icon */}
        <div className={cn(
          "w-14 h-14 rounded-xl flex items-center justify-center mb-4 transition-all duration-300",
          !feature.comingSoon && "group-hover:scale-110",
          feature.comingSoon ? "bg-muted/20" : "bg-gradient-to-br " + feature.gradient
        )}>
          <feature.icon className={cn(
            "h-7 w-7",
            feature.comingSoon ? "text-muted-foreground" : "text-white"
          )} />
        </div>

        {/* Title & Description */}
        <h3 className={cn(
          "text-xl font-bold mb-2 transition-colors",
          feature.comingSoon ? "text-muted-foreground" : "text-foreground group-hover:text-primary"
        )}>
          {feature.title}
          {feature.comingSoon && (
            <span className="ml-2 text-xs font-medium px-2 py-1 rounded-full bg-secondary/20 text-secondary">
              Soon
            </span>
          )}
        </h3>
        <p className={cn(
          "text-sm mb-6",
          feature.comingSoon ? "text-muted-foreground/60" : "text-muted-foreground"
        )}>
          {feature.description}
        </p>

        {/* Stats with Animation */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className={cn(
            "p-3 rounded-lg transition-colors",
            feature.comingSoon ? "bg-surface/20" : "bg-surface/50 group-hover:bg-surface"
          )}>
            <p className="text-xs text-muted-foreground mb-1">{feature.stats[0].label}</p>
            <p className={cn(
              "text-sm font-bold",
              feature.comingSoon ? "text-muted-foreground" : "text-foreground"
            )}>
              {formatValue(feature.stats[0], stat1.value)}
            </p>
          </div>
          <div className={cn(
            "p-3 rounded-lg transition-colors",
            feature.comingSoon ? "bg-surface/20" : "bg-surface/50 group-hover:bg-surface"
          )}>
            <p className="text-xs text-muted-foreground mb-1">{feature.stats[1].label}</p>
            <p className={cn(
              "text-sm font-bold",
              feature.comingSoon ? "text-muted-foreground" : "text-foreground"
            )}>
              {formatValue(feature.stats[1], stat2.value)}
            </p>
          </div>
        </div>

        {/* CTA Button */}
        {!feature.comingSoon && (
          <div className="mt-4">
            <Button 
              variant="outline" 
              size="sm" 
              className="w-full gap-2 border-primary/30 hover:border-primary hover:bg-primary/10 text-primary"
            >
              <span>{feature.cta || "Explore"}</span>
              {feature.isReferral ? (
                <ExternalLink className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Decorative Elements */}
      <div className={cn(
        "absolute -right-8 -bottom-8 w-32 h-32 rounded-full blur-3xl opacity-0 group-hover:opacity-20 transition-opacity duration-500",
        feature.comingSoon ? "bg-muted" : "bg-primary"
      )} />
    </div>
  )

  return (
    feature.isReferral ? (
      <div
        className={wrapperClass}
        onClick={onReferralClick}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onReferralClick()
          }
        }}
      >
        {cardBody}
      </div>
    ) : (
      <div
        className={wrapperClass}
        role="button"
        tabIndex={0}
        onClick={() => {
          if (!feature.comingSoon) {
            onSelect?.(feature.id as SelectableFeatureId)
          }
        }}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !feature.comingSoon) {
            event.preventDefault()
            onSelect?.(feature.id as SelectableFeatureId)
          }
        }}
      >
        {cardBody}
      </div>
    )
  )
}
