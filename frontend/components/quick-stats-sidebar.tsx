"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Diamond, Trophy, BarChart3, TrendingUp, ChevronUp, ChevronDown } from "lucide-react"

interface StatCardProps {
  icon: React.ElementType
  label: string
  value: string | number
  subValue?: string
  progress?: number
  trend?: {
    value: string
    isPositive: boolean
  }
  className?: string
}

function StatCard({ icon: Icon, label, value, subValue, progress, trend, className }: StatCardProps) {
  return (
    <div className={cn(
      "p-4 rounded-xl glass border border-border hover:border-primary/50 transition-all duration-300 group",
      className
    )}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-primary group-hover:animate-pulse-glow" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          {subValue && (
            <p className="text-xs text-muted-foreground mt-1">{subValue}</p>
          )}
        </div>
        {trend && (
          <div className={cn(
            "flex items-center gap-1 text-sm font-medium",
            trend.isPositive ? "text-success" : "text-destructive"
          )}>
            {trend.isPositive ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            {trend.value}
          </div>
        )}
      </div>
      {progress !== undefined && (
        <div className="mt-3">
          <div className="h-2 rounded-full bg-surface overflow-hidden">
            <div 
              className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all duration-500"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

interface LeaderboardRankProps {
  rank: number
  change: number
  categories: {
    label: string
    rank: number
  }[]
}

function LeaderboardRank({ rank, change, categories }: LeaderboardRankProps) {
  return (
    <div className="p-4 rounded-xl glass border border-border hover:border-primary/50 transition-all duration-300">
      <div className="flex items-center gap-2 mb-3">
        <Trophy className="h-4 w-4 text-primary" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Leaderboard Rank
        </span>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-3xl font-bold text-foreground">#{rank}</span>
        <span className={cn(
          "flex items-center gap-1 text-sm font-medium px-2 py-0.5 rounded-full",
          change > 0 ? "bg-success/20 text-success" : change < 0 ? "bg-destructive/20 text-destructive" : "bg-muted text-muted-foreground"
        )}>
          {change > 0 ? (
            <><ChevronUp className="h-3 w-3" />+{change}</>
          ) : change < 0 ? (
            <><ChevronDown className="h-3 w-3" />{change}</>
          ) : (
            "—"
          )}
        </span>
      </div>
      <div className="space-y-2">
        {categories.map((cat) => (
          <div key={cat.label} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{cat.label}</span>
            <span className="font-medium text-foreground">#{cat.rank}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function QuickStatsSidebar() {
  return (
    <aside className="w-72 shrink-0 hidden xl:block">
      <div className="sticky top-20 space-y-4">
        <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest px-1 mb-4">
          Quick Stats
        </h2>
        
        <StatCard
          icon={Diamond}
          label="Usable Points"
          value="1,850"
          progress={37}
        />

        <StatCard
          icon={Trophy}
          label="Tier Progress"
          value="Silver"
          subValue="4,200 / 10,000"
          progress={42}
        />

        <StatCard
          icon={BarChart3}
          label="24H Volume"
          value="$2.4M"
          trend={{ value: "12.5%", isPositive: true }}
        />

        <LeaderboardRank
          rank={42}
          change={3}
          categories={[
            { label: "Total Points", rank: 56 },
            { label: "Trading", rank: 24 },
            { label: "Referral", rank: 89 },
          ]}
        />
      </div>
    </aside>
  )
}
