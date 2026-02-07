"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { ArrowRightLeft, TrendingUp, Coins, Sparkles, ChevronLeft, ChevronRight, Users, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ReferralLog } from "@/components/referral-log"

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

  return { value, ref }
}

const features = [
  {
    id: "swap-bridge",
    title: "Swap & Bridge",
    description: "Trade tokens seamlessly across chains with zero-knowledge privacy",
    icon: ArrowRightLeft,
    gradient: "from-primary via-accent to-secondary",
    href: "#trade",
    stats: [
      { label: "Volume 24H", value: "$2.4M", numericValue: 2400000, prefix: "$" },
      { label: "Transactions", value: "12.5K", numericValue: 12500, suffix: "" },
    ],
    cta: "Explore",
  },
  {
    id: "limit-order",
    title: "Limit Order",
    description: "Set your price and let the market come to you with advanced order types",
    icon: TrendingUp,
    gradient: "from-secondary via-primary to-accent",
    href: "#limit-order",
    stats: [
      { label: "Active Orders", value: "3,420", numericValue: 3420 },
      { label: "Success Rate", value: "94%", numericValue: 94, suffix: "%" },
    ],
    comingSoon: true,
    cta: "Preview",
  },
  {
    id: "stake-earn",
    title: "Stake & Earn",
    description: "Earn passive income by staking your crypto assets with competitive APY",
    icon: Coins,
    gradient: "from-accent via-secondary to-primary",
    href: "#stake",
    stats: [
      { label: "TVL", value: "$8.2M", numericValue: 8200000, prefix: "$" },
      { label: "APY", value: "Up to 12%", numericValue: 12, prefix: "Up to ", suffix: "%" },
    ],
    comingSoon: true,
    cta: "Preview",
  },
  {
    id: "referral",
    title: "Referral Program",
    description: "Invite friends and earn 10% bonus points on their trading activity",
    icon: Users,
    gradient: "from-success via-primary to-accent",
    href: "#referral",
    stats: [
      { label: "Total Referrals", value: "8,420", numericValue: 8420 },
      { label: "Points Earned", value: "2.1M", numericValue: 2100000 },
    ],
    isReferral: true,
    cta: "View Log",
  },
]

export function FeaturedCards() {
  const scrollContainerRef = React.useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = React.useState(false)
  const [canScrollRight, setCanScrollRight] = React.useState(true)
  const [referralOpen, setReferralOpen] = React.useState(false)

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
        pointsEarned={12500}
      />
    </section>
  )
}

interface Feature {
  id: string
  title: string
  description: string
  icon: typeof ArrowRightLeft
  gradient: string
  href: string
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

function FeatureCard({ 
  feature, 
  onReferralClick 
}: { 
  feature: Feature
  onReferralClick: () => void 
}) {
  const stat1 = useAnimatedValue(feature.stats[0]?.numericValue || 0)
  const stat2 = useAnimatedValue(feature.stats[1]?.numericValue || 0)
  
  const formatValue = (stat: Feature['stats'][0], animatedValue: number) => {
    if (!stat.numericValue) return stat.value
    
    const prefix = stat.prefix || ''
    const suffix = stat.suffix || ''
    
    if (animatedValue >= 1000000) {
      return `${prefix}${(animatedValue / 1000000).toFixed(1)}M${suffix}`
    } else if (animatedValue >= 1000) {
      return `${prefix}${(animatedValue / 1000).toFixed(1)}K${suffix}`
    }
    return `${prefix}${animatedValue.toLocaleString()}${suffix}`
  }

  const handleClick = (e: React.MouseEvent) => {
    if (feature.isReferral) {
      e.preventDefault()
      onReferralClick()
    }
  }

  const CardWrapper = feature.isReferral ? 'div' : Link
  const cardProps = feature.isReferral 
    ? { onClick: handleClick, role: 'button', tabIndex: 0 }
    : { href: feature.href }

  return (
    <CardWrapper
      {...cardProps}
      className={cn(
        "group flex-shrink-0 w-[350px] snap-start text-left cursor-pointer",
        feature.comingSoon && "cursor-default"
      )}
    >
      <div 
        ref={stat1.ref}
        className={cn(
          "relative h-full p-6 rounded-2xl border border-border glass overflow-hidden transition-all duration-300",
          !feature.comingSoon && "hover:border-primary/50 hover:shadow-lg hover:shadow-primary/20 hover:-translate-y-1"
        )}
      >
        {/* Background Gradient */}
        <div className={cn(
          "absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-500 bg-gradient-to-br",
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
    </CardWrapper>
  )
}
