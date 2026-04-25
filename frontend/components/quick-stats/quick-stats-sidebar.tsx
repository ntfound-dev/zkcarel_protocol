"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Diamond, Trophy, BarChart3 } from "lucide-react"
import { useWallet } from "@/hooks/wallet/use-wallet"
import { useQuickStatsData } from "@/hooks/quick-stats/use-quick-stats-data"
import { useDraggableScroll } from "@/hooks/quick-stats/use-draggable-scroll"
import { StatCard } from "@/components/quick-stats/stat-card"
import { LeaderboardRank } from "@/components/quick-stats/leaderboard-rank"

interface QuickStatsSidebarProps {
  variant?: "sidebar" | "inline"
  className?: string
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
  const { pointsData, volumeData, rankData } = useQuickStatsData({ wallet })
  const { stripRef, isDragging, bind } = useDraggableScroll()

  const statsBlocks = (
    <>
      <StatCard
        icon={Diamond}
        label="Usable Points"
        value={pointsData.pointsLabel}
        valueTitle={pointsData.pointsTitle}
        subValue={pointsData.pointsSubValue}
        progress={pointsData.points !== null ? Math.round(pointsData.tierProgress) : 0}
        className={cn(variant === "inline" && "w-[250px] min-w-[250px]")}
      />

      <StatCard
        icon={Trophy}
        label="Tier Progress"
        value={pointsData.tierLabel}
        subValue={pointsData.tierSubValue}
        progress={pointsData.points !== null ? Math.round(pointsData.tierProgress) : 0}
        className={cn(variant === "inline" && "w-[250px] min-w-[250px]")}
      />

      <StatCard
        icon={BarChart3}
        label="Total Volume"
        value={volumeData.volumeLabel}
        valueTitle={volumeData.volumeFullLabel}
        subValue={volumeData.volumeFullLabel}
        className={cn(variant === "inline" && "w-[250px] min-w-[250px]")}
      />

      <div className={cn(variant === "inline" && "w-[250px] min-w-[250px]")}>
        <LeaderboardRank
          rank={rankData.rank}
          change={rankData.change}
          categories={rankData.categories}
        />
      </div>
    </>
  )

  if (variant === "inline") {
    return (
      <section className={cn("w-full", className)}>
        <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest px-1 mb-3 carel-tech-label">
          Quick Stats
        </h2>
        <div
          ref={stripRef}
          className={cn(
            "flex gap-3 overflow-x-auto pb-2 select-none",
            isDragging ? "cursor-grabbing" : "cursor-grab"
          )}
          {...bind}
        >
          {statsBlocks}
        </div>
      </section>
    )
  }

  return (
    <aside className={cn("w-72 shrink-0 hidden xl:block", className)}>
      <div className="sticky top-20 space-y-4">
        <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest px-1 mb-4 carel-tech-label">
          Quick Stats
        </h2>
        {statsBlocks}
      </div>
    </aside>
  )
}
