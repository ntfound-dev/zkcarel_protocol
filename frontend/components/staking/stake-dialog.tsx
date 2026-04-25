"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AlertCircle, Check } from "lucide-react"

type StakeDialogPool = {
  symbol: string
  icon: string
  gradient: string
  apy: string
  apyDisplay?: string
  lockPeriod: string
  minStake: string
  userBalance: number
  tvl: string
  reward: string
}

type StakeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedPool: StakeDialogPool | null
  stakeSuccess: boolean
  stakeAmount: string
  onStakeAmountChange: (value: string) => void
  onAmountPreset: (percent: number) => void
  balanceHidden: boolean
  hideBalanceSummary: string
  onOpenHideBalance: () => void
  activeDiscountPercent: number
  isStaking: boolean
  isAutoPrivacyProvisioning: boolean
  onConfirmStake: () => void
  apyDisplay: string
  apyDisplayFallback: (pool: StakeDialogPool) => string
}

export function StakeDialog({
  open,
  onOpenChange,
  selectedPool,
  stakeSuccess,
  stakeAmount,
  onStakeAmountChange,
  onAmountPreset,
  balanceHidden,
  hideBalanceSummary,
  onOpenHideBalance,
  activeDiscountPercent,
  isStaking,
  isAutoPrivacyProvisioning,
  onConfirmStake,
  apyDisplay,
  apyDisplayFallback,
}: StakeDialogProps) {
  const parsedAmount = Number.parseFloat(stakeAmount)
  const minStakeValue = Number.parseFloat(selectedPool?.minStake || "0")
  const estimatedRewardMonthly =
    selectedPool && Number.isFinite(parsedAmount) && parsedAmount > 0
      ? ((parsedAmount * Number.parseFloat(selectedPool.apy || "0")) / 100 / 12).toFixed(4)
      : ""
  const resolvedApyDisplay = selectedPool ? (selectedPool.apyDisplay ?? apyDisplayFallback(selectedPool)) : apyDisplay

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md glass-strong border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {selectedPool && (
              <>
                <div
                  className={cn(
                    "w-8 h-8 rounded-full bg-gradient-to-br flex items-center justify-center",
                    selectedPool.gradient
                  )}
                >
                  <span className="text-lg text-white">{selectedPool.icon}</span>
                </div>
                Stake {selectedPool.symbol}
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {stakeSuccess ? (
          <div className="py-8 text-center">
            <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
              <Check className="h-8 w-8 text-success" />
            </div>
            <p className="text-lg font-medium text-foreground">Staking Successful!</p>
            <p className="text-sm text-muted-foreground mt-2">
              {stakeAmount} {selectedPool?.symbol} has been staked
            </p>
            <Button onClick={() => onOpenChange(false)} className="mt-4">
              Close
            </Button>
          </div>
        ) : (
          <Tabs defaultValue="stake">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="stake">Stake</TabsTrigger>
              <TabsTrigger value="info">Pool Info</TabsTrigger>
            </TabsList>

            <TabsContent value="stake" className="space-y-4">
              {selectedPool && (
                <>
                  <div className="p-4 rounded-xl bg-surface/50 border border-border">
                    <div className="flex justify-between mb-2">
                      <span className="text-sm text-muted-foreground">APY</span>
                      <span className="text-lg font-bold text-success">{resolvedApyDisplay}</span>
                    </div>
                    <div className="flex justify-between mb-2">
                      <span className="text-sm text-muted-foreground">Lock Period</span>
                      <span className="text-sm font-medium text-foreground">
                        {selectedPool.lockPeriod}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Min. Stake</span>
                      <span className="text-sm font-medium text-foreground">
                        {selectedPool.minStake} {selectedPool.symbol}
                      </span>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between mb-2">
                      <label className="text-sm font-medium text-foreground">Amount</label>
                      <span className="text-xs text-muted-foreground">
                        Balance: {balanceHidden ? "••••••" : selectedPool.userBalance.toLocaleString()}{" "}
                        {selectedPool.symbol}
                      </span>
                    </div>
                    <input
                      type="number"
                      value={stakeAmount}
                      onChange={(e) => onStakeAmountChange(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <div className="flex gap-2 mt-2">
                      {[25, 50, 75, 100].map((percent) => (
                        <button
                          key={percent}
                          onClick={() => onAmountPreset(percent)}
                          className="flex-1 px-2 py-1 text-xs rounded-md bg-surface text-muted-foreground hover:text-foreground hover:bg-surface/80 transition-colors"
                        >
                          {percent}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {balanceHidden && (
                    <button
                      type="button"
                      onClick={onOpenHideBalance}
                      className="w-full rounded-lg border border-border bg-surface/40 px-3 py-2 text-left transition-colors hover:border-primary/50"
                    >
                      <p className="text-[11px] text-muted-foreground">{hideBalanceSummary}</p>
                    </button>
                  )}

                  {Number.isFinite(parsedAmount) && parsedAmount > 0 && estimatedRewardMonthly && (
                    <div className="p-3 rounded-lg bg-success/10 border border-success/20">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Estimated Reward/Month</span>
                        <span className="font-medium text-success">
                          {estimatedRewardMonthly} {selectedPool.symbol}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                    <p className="text-xs text-foreground">
                      {activeDiscountPercent > 0
                        ? `NFT discount ${activeDiscountPercent}% is active. Usage decreases only after successful on-chain stake/unstake transactions.`
                        : "NFT discount is inactive. Mint an NFT tier to activate discount usage."}
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-secondary/10 border border-secondary/20">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-secondary flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-foreground">
                        Testnet token. Rewards follow testnet contracts.
                      </p>
                    </div>
                  </div>

                  <Button
                    onClick={onConfirmStake}
                    disabled={
                      !stakeAmount ||
                      (Number.isFinite(minStakeValue) && parsedAmount < minStakeValue) ||
                      isStaking ||
                      isAutoPrivacyProvisioning
                    }
                    className="w-full bg-primary hover:bg-primary/90"
                  >
                    {isAutoPrivacyProvisioning
                      ? "Preparing Hide Balance..."
                      : isStaking
                      ? "Processing..."
                      : `Stake ${selectedPool.symbol}`}
                  </Button>
                </>
              )}
            </TabsContent>

            <TabsContent value="info" className="space-y-4">
              {selectedPool && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-surface/50 border border-border">
                    <h4 className="font-medium text-foreground mb-3">Pool Details</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Total Staked</span>
                        <span className="text-sm font-medium text-foreground">{selectedPool.tvl}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">APY</span>
                        <span className="text-sm font-medium text-success">
                          {resolvedApyDisplay}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Lock Period</span>
                        <span className="text-sm font-medium text-foreground">
                          {selectedPool.lockPeriod}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Min. Stake</span>
                        <span className="text-sm font-medium text-foreground">
                          {selectedPool.minStake} {selectedPool.symbol}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Reward Token</span>
                        <span className="text-sm font-medium text-foreground">
                          {selectedPool.reward}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-surface/50 border border-border">
                    <h4 className="font-medium text-foreground mb-3">How It Works</h4>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li className="flex items-start gap-2">
                        <span className="text-primary">1.</span>
                        Stake your tokens in the pool
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary">2.</span>
                        Rewards accumulate every block
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary">3.</span>
                        Claim rewards anytime
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary">4.</span>
                        Unstake after lock period is complete
                      </li>
                    </ul>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
