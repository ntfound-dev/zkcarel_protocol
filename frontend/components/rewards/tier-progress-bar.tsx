import { Check, Trophy } from "lucide-react"
import { cn } from "@/lib/utils"
import type { TierInfo } from "@/lib/rewards-config"

/**
 * Handles `TierProgressBar` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function TierProgressBar({
  currentPoints,
  currentTierId,
  tiers,
}: {
  currentPoints: number
  currentTierId: number
  tiers: TierInfo[]
}) {
  if (tiers.length === 0) {
    return null
  }

  const activeTierIndex = tiers.findIndex((tier) => tier.tierId === currentTierId)
  const hasActiveTier = activeTierIndex >= 0
  const safeCurrentTierIndex = hasActiveTier ? activeTierIndex : 0
  const currentTier = hasActiveTier ? tiers[safeCurrentTierIndex] : null
  const nextTier = hasActiveTier ? tiers[safeCurrentTierIndex + 1] : tiers[0]
  const isMaxTier = hasActiveTier && !nextTier
  const targetName = nextTier?.name ?? "Max Tier"
  const targetPoints = nextTier?.points ?? currentPoints
  const remainingPoints = Math.max(0, targetPoints - currentPoints)
  const targetDiscount = nextTier?.discount ?? currentTier?.discount ?? "0%"
  const hasReachedMintRequirement =
    !hasActiveTier && Boolean(nextTier) && currentPoints >= (nextTier?.points ?? 0)
  const tierSpan = Math.max(1, tiers.length - 1)
  const progressInCurrentTier = nextTier
    ? Math.min(100, Math.max(0, (currentPoints / nextTier.points) * 100))
    : 100
  // Top timeline follows active NFT tier only (not point simulation).
  const progressWidth = hasActiveTier ? (safeCurrentTierIndex / tierSpan) * 100 : 0
  const currentTierLabel = currentTier?.name ?? "None"
  const actionLabel = hasActiveTier ? "upgrade" : "mint"
  const highlightedTierIndex = hasActiveTier ? safeCurrentTierIndex : -1

  return (
    <div className="p-6 rounded-2xl glass border border-border">
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="h-5 w-5 text-primary" />
        <span className="font-medium text-foreground">Tier Progression</span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Active tier follows on-chain NFT discount. Points are used to unlock/mint the next tier.
      </p>

      {/* Tier Progress Line */}
      <div className="relative mt-8 mb-12">
        {/* Background line */}
        <div className="absolute top-1/2 left-0 right-0 h-1 bg-surface -translate-y-1/2 rounded-full" />

        {/* Progress line */}
        <div
          className="absolute top-1/2 left-0 h-1 bg-gradient-to-r from-primary to-secondary -translate-y-1/2 rounded-full transition-all duration-500"
          style={{ width: `${progressWidth}%` }}
        />

        {/* Tier markers */}
        <div className="relative flex justify-between">
          {tiers.map((tier, index) => (
            <div key={tier.name} className="flex flex-col items-center">
              <div
                className={cn(
                  "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                  tier.achieved
                    ? `bg-gradient-to-br ${tier.color} border-transparent`
                    : "bg-surface border-border"
                )}
              >
                {tier.achieved && <Check className="h-3 w-3 text-white" />}
              </div>
              <span
                className={cn(
                  "text-xs mt-2 font-medium",
                  index === highlightedTierIndex
                    ? "text-primary"
                    : tier.achieved
                    ? "text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {tier.name}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Current Status */}
      <div className="p-4 rounded-xl bg-surface/50 border border-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm text-muted-foreground">Current Tier</p>
            <p className="text-xl font-bold text-foreground">{currentTierLabel}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Progress to {targetName}</p>
            <p className="text-xl font-bold text-primary">
              {currentPoints.toLocaleString()} / {targetPoints.toLocaleString()}
            </p>
          </div>
        </div>
        <div className="h-3 rounded-full bg-surface overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all duration-500"
            style={{ width: `${progressInCurrentTier}%` }}
          />
        </div>
        {isMaxTier ? (
          <p className="text-sm text-muted-foreground mt-2">
            You are at the highest tier ({targetDiscount} discount).
          </p>
        ) : hasReachedMintRequirement ? (
          <p className="text-sm text-muted-foreground mt-2">
            Points requirement met. Mint {targetName} NFT to activate tier ({targetDiscount} discount).
          </p>
        ) : (
          <p className="text-sm text-muted-foreground mt-2">
            Need {remainingPoints.toLocaleString()} more points to {actionLabel} {targetName} (
            {targetDiscount} discount)
          </p>
        )}
      </div>
    </div>
  )
}
