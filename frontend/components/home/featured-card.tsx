"use client"

import * as React from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { FeatureConfig, FeatureStat, SelectableFeatureId } from "@/lib/featured-config"
import { useAnimatedValue } from "@/hooks/featured/use-animated-value"

type FeaturedCardProps = {
  feature: FeatureConfig
  onSelect?: (featureId: SelectableFeatureId) => void
  isActive?: boolean
}

/**
 * Handles `FeaturedCard` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function FeaturedCard({ feature, onSelect, isActive = false }: FeaturedCardProps) {
  const stat1 = useAnimatedValue(feature.stats[0]?.numericValue || 0)
  const stat2 = useAnimatedValue(feature.stats[1]?.numericValue || 0)
  const cardRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      stat1.ref.current = node
      stat2.ref.current = node
    },
    [stat1.ref, stat2.ref]
  )

  const formatValue = (stat: FeatureStat, animatedValue: number) => {
    if (stat.numericValue === undefined || stat.numericValue === null) return stat.value

    const prefix = stat.prefix || ""
    const suffix = stat.suffix || ""

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
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-500 bg-gradient-to-br",
          isActive ? "opacity-10" : "opacity-0 group-hover:opacity-10",
          feature.gradient
        )}
      />

      <div className="relative z-10">
        <div
          className={cn(
            "w-14 h-14 rounded-xl flex items-center justify-center mb-4 transition-all duration-300",
            !feature.comingSoon && "group-hover:scale-110",
            feature.comingSoon ? "bg-muted/20" : `bg-gradient-to-br ${feature.gradient}`
          )}
        >
          <feature.icon
            className={cn("h-7 w-7", feature.comingSoon ? "text-muted-foreground" : "text-white")}
          />
        </div>

        <h3
          className={cn(
            "text-xl font-bold mb-2 transition-colors carel-tech-title",
            feature.comingSoon ? "text-muted-foreground" : "text-foreground group-hover:text-primary"
          )}
        >
          {feature.title}
          {feature.comingSoon && (
            <span className="ml-2 text-xs font-medium px-2 py-1 rounded-full bg-secondary/20 text-secondary">
              Soon
            </span>
          )}
        </h3>
        <p
          className={cn(
            "text-sm mb-6",
            feature.comingSoon ? "text-muted-foreground/60" : "text-muted-foreground"
          )}
        >
          {feature.description}
        </p>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div
            className={cn(
              "p-3 rounded-lg transition-colors",
              feature.comingSoon ? "bg-surface/20" : "bg-surface/50 group-hover:bg-surface"
            )}
          >
            <p className="text-xs text-muted-foreground mb-1">{feature.stats[0].label}</p>
            <p className={cn("text-sm font-bold", feature.comingSoon ? "text-muted-foreground" : "text-foreground")}>
              {formatValue(feature.stats[0], stat1.value)}
            </p>
          </div>
          <div
            className={cn(
              "p-3 rounded-lg transition-colors",
              feature.comingSoon ? "bg-surface/20" : "bg-surface/50 group-hover:bg-surface"
            )}
          >
            <p className="text-xs text-muted-foreground mb-1">{feature.stats[1].label}</p>
            <p className={cn("text-sm font-bold", feature.comingSoon ? "text-muted-foreground" : "text-foreground")}>
              {formatValue(feature.stats[1], stat2.value)}
            </p>
          </div>
        </div>

        {!feature.comingSoon && (
          <div className="mt-4">
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 border-primary/30 hover:border-primary hover:bg-primary/10 text-primary"
            >
              <span>{feature.cta || "Explore"}</span>
              <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        )}
      </div>

      <div
        className={cn(
          "absolute -right-8 -bottom-8 w-32 h-32 rounded-full blur-3xl opacity-0 group-hover:opacity-20 transition-opacity duration-500",
          feature.comingSoon ? "bg-muted" : "bg-primary"
        )}
      />
    </div>
  )

  return (
    <div
      className={wrapperClass}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (!feature.comingSoon) {
          onSelect?.(feature.id)
        }
      }}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !feature.comingSoon) {
          event.preventDefault()
          onSelect?.(feature.id)
        }
      }}
    >
      {cardBody}
    </div>
  )
}
