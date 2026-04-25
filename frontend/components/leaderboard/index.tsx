"use client"

import { cn } from "@/lib/utils"
import { Trophy, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LeaderboardRow } from "@/components/leaderboard/leaderboard-row"
import { useLeaderboardData, leaderboardTabs } from "@/hooks/leaderboard/use-leaderboard-data"

/**
 * Handles `Leaderboard` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function Leaderboard() {
  const {
    activeTab,
    setActiveTab,
    entries,
    isLoading,
    loadError,
    yourEntry,
    previousEntry,
    nextEntry,
  } = useLeaderboardData()

  return (
    <section id="leaderboard" className="py-12">
      <div className="p-6 rounded-2xl glass-strong border border-border">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3">
              <Trophy className="h-6 w-6 text-primary" />
              <h2 className="text-2xl font-bold text-foreground">Leaderboard</h2>
            </div>
            <div className="flex items-center gap-2 mt-2 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="text-sm">Testnet season</span>
            </div>
          </div>
          <div className="flex gap-2">
            {leaderboardTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300",
                  activeTab === tab.id
                    ? "bg-primary/20 text-primary border border-primary/50"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {isLoading && <div className="text-sm text-muted-foreground px-2">Loading leaderboard...</div>}
          {!isLoading && loadError && <div className="text-sm text-destructive px-2">{loadError}</div>}
          {!isLoading && entries.length === 0 && (
            <div className="text-sm text-muted-foreground px-2">No leaderboard data</div>
          )}
          {!isLoading &&
            entries.map((entry, index) => (
              <LeaderboardRow
                key={`${entry.rank}-${entry.address}-${index}`}
                entry={entry}
                showLabel={activeTab !== "total"}
              />
            ))}
        </div>

        {/* Your Position Summary */}
        {yourEntry && (
          <div className="mt-6 p-4 rounded-xl bg-surface/50 border border-border">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-sm text-muted-foreground">Your Position</p>
                <p className="text-2xl font-bold text-primary">
                  #{yourEntry.rank}
                  {yourEntry.change !== 0 && (
                    <span
                      className={cn(
                        "text-sm ml-2",
                        yourEntry.change > 0 ? "text-success" : "text-destructive"
                      )}
                    >
                      ({yourEntry.change > 0 ? "+" : ""}
                      {yourEntry.change})
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {previousEntry ? `Points behind #${previousEntry.rank}` : "Points behind leader"}
                </p>
                <p className="text-xl font-bold text-foreground">
                  {previousEntry ? (previousEntry.points - yourEntry.points).toLocaleString() : "—"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {nextEntry
                    ? `Points ahead of #${nextEntry.rank}`
                    : yourEntry.rank === 1
                    ? "You're leading"
                    : "Points ahead of next"}
                </p>
                <p className="text-xl font-bold text-success">
                  {nextEntry ? (yourEntry.points - nextEntry.points).toLocaleString() : "—"}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 text-center">
          <Button variant="outline" className="border-primary/50 text-foreground hover:bg-primary/10 bg-transparent">
            View Full Rankings
          </Button>
        </div>
      </div>
    </section>
  )
}
