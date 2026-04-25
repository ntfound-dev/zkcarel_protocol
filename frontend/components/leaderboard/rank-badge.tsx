import { Crown, Medal } from "lucide-react"

/**
 * Handles `RankBadge` logic.
 *
 * @param rank - Input used by `RankBadge` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center animate-pulse-glow">
        <Crown className="h-4 w-4 text-yellow-900" />
      </div>
    )
  }
  if (rank === 2) {
    return (
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-300 to-gray-500 flex items-center justify-center">
        <Medal className="h-4 w-4 text-gray-700" />
      </div>
    )
  }
  if (rank === 3) {
    return (
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-600 to-amber-800 flex items-center justify-center">
        <Medal className="h-4 w-4 text-amber-200" />
      </div>
    )
  }
  return (
    <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center">
      <span className="text-sm font-medium text-muted-foreground">{rank}</span>
    </div>
  )
}
