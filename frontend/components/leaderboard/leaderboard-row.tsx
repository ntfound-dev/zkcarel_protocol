import { ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { RankBadge } from "@/components/leaderboard/rank-badge"
import type { LeaderboardEntry } from "@/hooks/leaderboard/use-leaderboard-data"

/**
 * Handles `LeaderboardRow` logic.
 *
 * @param entry - Input used by `LeaderboardRow` to compute state, payload, or request behavior.
 * @param showLabel - Input used by `LeaderboardRow` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function LeaderboardRow({
  entry,
  showLabel,
}: {
  entry: LeaderboardEntry
  showLabel?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between py-4 px-4 rounded-xl transition-all duration-300",
        entry.isYou ? "bg-primary/10 border border-primary/50 neon-border" : "hover:bg-surface/50"
      )}
    >
      <div className="flex items-center gap-4">
        <RankBadge rank={entry.rank} />
        <div>
          <div className="flex items-center gap-2">
            <span
              className={cn("font-mono", entry.isYou ? "text-primary font-bold" : "text-foreground")}
            >
              {entry.address}
            </span>
            {entry.isYou && (
              <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-xs font-medium">
                YOU
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {entry.change !== 0 && (
              <span
                className={cn(
                  "flex items-center text-xs",
                  entry.change > 0 ? "text-success" : "text-destructive"
                )}
              >
                {entry.change > 0 ? (
                  <>
                    <ChevronUp className="h-3 w-3" />+{entry.change}
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3" />
                    {entry.change}
                  </>
                )}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="text-right">
        <span className={cn("text-lg font-bold", entry.isYou ? "text-primary" : "text-foreground")}>
          {showLabel && entry.label ? entry.label : entry.points.toLocaleString()}
        </span>
        {!showLabel && <span className="text-sm text-muted-foreground ml-1">pts</span>}
      </div>
    </div>
  )
}
