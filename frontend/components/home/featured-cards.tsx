"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWallet } from "@/hooks/wallet/use-wallet"
import { useFeaturedStats } from "@/hooks/featured/use-featured-stats"
import { buildFeaturedConfig, type SelectableFeatureId } from "@/lib/featured-config"
import { FeaturedCard } from "@/components/home/featured-card"

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
  const isDraggingRef = React.useRef(false)
  const dragStartXRef = React.useRef(0)
  const dragStartScrollLeftRef = React.useRef(0)
  const suppressClickRef = React.useRef(false)
  const [canScrollLeft, setCanScrollLeft] = React.useState(false)
  const [canScrollRight, setCanScrollRight] = React.useState(true)
  const { swapStats, limitStats, stakeStats } = useFeaturedStats({ wallet })

  const features = React.useMemo(
    () =>
      buildFeaturedConfig({
        swap: swapStats,
        limit: limitStats,
        stake: stakeStats,
      }),
    [swapStats, limitStats, stakeStats]
  )

  /**
   * Handles `checkScroll` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const checkScroll = React.useCallback(() => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current
      setCanScrollLeft(scrollLeft > 0)
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10)
    }
  }, [])

  React.useEffect(() => {
    checkScroll()
    window.addEventListener("resize", checkScroll)
    return () => window.removeEventListener("resize", checkScroll)
  }, [checkScroll])

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      checkScroll()
    })
    return () => cancelAnimationFrame(frame)
  }, [
    checkScroll,
    swapStats.volume,
    swapStats.trades,
    limitStats.activeOrders,
    limitStats.successRate,
    stakeStats.tvl,
    stakeStats.maxApy,
  ])

  React.useEffect(() => {
    const handleMouseUp = () => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      const container = scrollContainerRef.current
      if (container) {
        container.style.cursor = "grab"
        container.style.scrollBehavior = "smooth"
      }
    }

    window.addEventListener("mouseup", handleMouseUp)
    return () => window.removeEventListener("mouseup", handleMouseUp)
  }, [])

  /**
   * Handles `scroll` logic.
   *
   * @param direction - Input used by `scroll` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const scroll = (direction: "left" | "right") => {
    if (scrollContainerRef.current) {
      const scrollAmount = 400
      const newScrollLeft =
        direction === "left"
          ? scrollContainerRef.current.scrollLeft - scrollAmount
          : scrollContainerRef.current.scrollLeft + scrollAmount

      scrollContainerRef.current.scrollTo({
        left: newScrollLeft,
        behavior: "smooth",
      })
    }
  }

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const container = scrollContainerRef.current
    if (!container) return
    isDraggingRef.current = true
    suppressClickRef.current = false
    dragStartXRef.current = event.clientX
    dragStartScrollLeftRef.current = container.scrollLeft
    container.style.cursor = "grabbing"
    container.style.scrollBehavior = "auto"
  }

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return
    const container = scrollContainerRef.current
    if (!container) return
    const deltaX = event.clientX - dragStartXRef.current
    if (Math.abs(deltaX) > 4) {
      suppressClickRef.current = true
    }
    container.scrollLeft = dragStartScrollLeftRef.current - deltaX
  }

  const handleMouseLeave = () => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    const container = scrollContainerRef.current
    if (!container) return
    container.style.cursor = "grab"
    container.style.scrollBehavior = "smooth"
  }

  const handleClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <section id="featured-services" className="relative">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-foreground carel-tech-heading">
          Featured Trading Services
        </h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => scroll("left")}
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
            onClick={() => scroll("right")}
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
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseUp={handleMouseLeave}
        onClickCapture={handleClickCapture}
        className="flex gap-6 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-4 cursor-grab select-none"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {features.map((feature) => (
          <FeaturedCard
            key={feature.id}
            feature={feature}
            onSelect={onSelectFeature}
            isActive={activeFeatureId === feature.id}
          />
        ))}
      </div>

      {canScrollLeft && (
        <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-background to-transparent pointer-events-none z-10" />
      )}
      {canScrollRight && (
        <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-background to-transparent pointer-events-none z-10" />
      )}
    </section>
  )
}
