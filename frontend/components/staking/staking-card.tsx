"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

type StakingCardPool = {
  symbol: string
  name: string
  icon: string
  gradient: string
  apy: string
  apyDisplay?: string
  tvl: string
  spotPrice: number
  minStake: string
  lockPeriod: string
  userBalance: number
}

type StakingCardProps = {
  pool: StakingCardPool
  onStake: () => void
  balanceHidden: boolean
  apyDisplay: string
}

export function StakingCard({ pool, onStake, balanceHidden, apyDisplay }: StakingCardProps) {
  return (
    <div className="p-6 rounded-xl glass border border-border hover:border-primary/30 transition-all group">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center",
              pool.gradient
            )}
          >
            <span className="text-2xl text-white">{pool.icon}</span>
          </div>
          <div>
            <h4 className="font-bold text-foreground">{pool.symbol}</h4>
            <p className="text-sm text-muted-foreground">{pool.name}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">APY</p>
          <p className="text-2xl font-bold text-success">{apyDisplay}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <p className="text-xs text-muted-foreground">Total Staked</p>
          <p className="text-sm font-medium text-foreground">{pool.tvl}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Harga Spot</p>
          <p className="text-sm font-medium text-foreground">
            {pool.spotPrice > 0
              ? `$${pool.spotPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
              : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Min. Stake</p>
          <p className="text-sm font-medium text-foreground">
            {pool.minStake} {pool.symbol}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Lock Period</p>
          <p className="text-sm font-medium text-foreground">{pool.lockPeriod}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Your Balance</p>
          <p className="text-sm font-medium text-foreground">
            {balanceHidden ? "••••••" : pool.userBalance.toLocaleString()}
          </p>
        </div>
      </div>

      <Button onClick={onStake} className="w-full bg-primary hover:bg-primary/90">
        Stake {pool.symbol}
      </Button>
    </div>
  )
}
