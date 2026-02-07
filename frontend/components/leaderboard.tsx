"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Trophy, Medal, Crown, ChevronUp, ChevronDown, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"

const leaderboardData = {
  total: [
    { rank: 1, address: "0x8f...4e2d", points: 45200, isYou: true, change: 2 },
    { rank: 2, address: "0xab...c3f1", points: 42800, isYou: false, change: -1 },
    { rank: 3, address: "0x12...45a9", points: 39500, isYou: false, change: 1 },
    { rank: 4, address: "0xcd...67b2", points: 37100, isYou: false, change: 0 },
    { rank: 5, address: "0xef...89c4", points: 35900, isYou: false, change: -2 },
    { rank: 6, address: "0x23...d1e5", points: 34200, isYou: false, change: 3 },
    { rank: 7, address: "0x56...f2a7", points: 32800, isYou: false, change: 0 },
    { rank: 8, address: "0x78...b3c9", points: 31500, isYou: false, change: -1 },
  ],
  trading: [
    { rank: 1, address: "0xde...7a3c", points: 2450000, isYou: false, change: 0, label: "$2.45M" },
    { rank: 2, address: "0x8f...4e2d", points: 1890000, isYou: true, change: 3, label: "$1.89M" },
    { rank: 3, address: "0xab...c3f1", points: 1520000, isYou: false, change: -1, label: "$1.52M" },
    { rank: 4, address: "0x45...9f2e", points: 1180000, isYou: false, change: 2, label: "$1.18M" },
    { rank: 5, address: "0x12...45a9", points: 980000, isYou: false, change: -2, label: "$980K" },
    { rank: 6, address: "0xcd...67b2", points: 750000, isYou: false, change: 1, label: "$750K" },
    { rank: 7, address: "0x89...3d1f", points: 620000, isYou: false, change: 0, label: "$620K" },
    { rank: 8, address: "0xef...89c4", points: 540000, isYou: false, change: -1, label: "$540K" },
  ],
  referral: [
    { rank: 1, address: "0x67...8b4a", points: 156, isYou: false, change: 1, label: "156 refs" },
    { rank: 2, address: "0xbc...5e9d", points: 142, isYou: false, change: -1, label: "142 refs" },
    { rank: 3, address: "0x8f...4e2d", points: 98, isYou: true, change: 5, label: "98 refs" },
    { rank: 4, address: "0xab...c3f1", points: 87, isYou: false, change: 0, label: "87 refs" },
    { rank: 5, address: "0x23...d1e5", points: 72, isYou: false, change: 2, label: "72 refs" },
    { rank: 6, address: "0xf1...2c8e", points: 65, isYou: false, change: -2, label: "65 refs" },
    { rank: 7, address: "0x12...45a9", points: 54, isYou: false, change: 1, label: "54 refs" },
    { rank: 8, address: "0xcd...67b2", points: 48, isYou: false, change: 0, label: "48 refs" },
  ],
}

type TabId = "total" | "trading" | "referral"

const tabs: { id: TabId; label: string }[] = [
  { id: "total", label: "Total Points" },
  { id: "trading", label: "Trading Volume" },
  { id: "referral", label: "Referral" },
]

function RankBadge({ rank }: { rank: number }) {
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

interface LeaderboardEntry {
  rank: number
  address: string
  points: number
  isYou: boolean
  change: number
  label?: string
}

function LeaderboardRow({ entry, showLabel }: { entry: LeaderboardEntry; showLabel?: boolean }) {
  return (
    <div className={cn(
      "flex items-center justify-between py-4 px-4 rounded-xl transition-all duration-300",
      entry.isYou 
        ? "bg-primary/10 border border-primary/50 neon-border" 
        : "hover:bg-surface/50"
    )}>
      <div className="flex items-center gap-4">
        <RankBadge rank={entry.rank} />
        <div>
          <div className="flex items-center gap-2">
            <span className={cn(
              "font-mono",
              entry.isYou ? "text-primary font-bold" : "text-foreground"
            )}>
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
              <span className={cn(
                "flex items-center text-xs",
                entry.change > 0 ? "text-success" : "text-destructive"
              )}>
                {entry.change > 0 ? (
                  <><ChevronUp className="h-3 w-3" />+{entry.change}</>
                ) : (
                  <><ChevronDown className="h-3 w-3" />{entry.change}</>
                )}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="text-right">
        <span className={cn(
          "text-lg font-bold",
          entry.isYou ? "text-primary" : "text-foreground"
        )}>
          {showLabel && entry.label ? entry.label : entry.points.toLocaleString()}
        </span>
        {!showLabel && <span className="text-sm text-muted-foreground ml-1">pts</span>}
      </div>
    </div>
  )
}

export function Leaderboard() {
  const [activeTab, setActiveTab] = React.useState<TabId>("total")
  const daysRemaining = 15

  const currentData = leaderboardData[activeTab]
  const yourEntry = currentData.find(e => e.isYou)
  const aheadOf = currentData.find(e => e.rank === (yourEntry?.rank || 0) + 1)
  const behindOf = currentData.find(e => e.rank === (yourEntry?.rank || 0) - 1)

  return (
    <section id="leaderboard" className="py-12">
      <div className="p-6 rounded-2xl glass-strong border border-border">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3">
              <Trophy className="h-6 w-6 text-primary" />
              <h2 className="text-2xl font-bold text-foreground">Season 5 Leaderboard</h2>
            </div>
            <div className="flex items-center gap-2 mt-2 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="text-sm">{daysRemaining} days remaining</span>
            </div>
          </div>
          <div className="flex gap-2">
            {tabs.map((tab) => (
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
          {currentData.map((entry) => (
            <LeaderboardRow key={entry.rank} entry={entry} showLabel={activeTab !== "total"} />
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
                    <span className={cn(
                      "text-sm ml-2",
                      yourEntry.change > 0 ? "text-success" : "text-destructive"
                    )}>
                      ({yourEntry.change > 0 ? "+" : ""}{yourEntry.change})
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Points behind #{(yourEntry.rank - 1) || 1}</p>
                <p className="text-xl font-bold text-foreground">
                  {behindOf ? (behindOf.points - yourEntry.points).toLocaleString() : "—"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Points ahead of #{yourEntry.rank + 1}</p>
                <p className="text-xl font-bold text-success">
                  {aheadOf ? (yourEntry.points - aheadOf.points).toLocaleString() : "—"}
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
