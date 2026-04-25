"use client"

import * as React from "react"
import { ChevronDown, ChevronUp, Trophy } from "lucide-react"
import { cn } from "@/lib/utils"

export type LeaderboardRankProps = {
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
export function LeaderboardRank({ rank, change, categories }: LeaderboardRankProps) {
  return (
    <div className="p-4 rounded-xl glass border border-border hover:border-primary/50 transition-all duration-300">
      <div className="flex items-center gap-2 mb-3">
        <Trophy className="h-4 w-4 text-primary" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider carel-tech-label">
          Leaderboard Rank
        </span>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-2xl lg:text-3xl font-bold text-foreground carel-tech-title">
          {rank && rank > 0 ? `#${rank}` : "—"}
        </span>
        <span
          className={cn(
            "flex items-center gap-1 text-sm font-medium px-2 py-0.5 rounded-full",
            change > 0
              ? "bg-success/20 text-success"
              : change < 0
              ? "bg-destructive/20 text-destructive"
              : "bg-muted text-muted-foreground"
          )}
        >
          {change > 0 ? (
            <>
              <ChevronUp className="h-3 w-3" />+{change}
            </>
          ) : change < 0 ? (
            <>
              <ChevronDown className="h-3 w-3" />
              {change}
            </>
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
