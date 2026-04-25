"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Copy, Check, Users, Gift, TrendingUp, ExternalLink } from "lucide-react"
import { useNotifications } from "@/hooks/notifications/use-notifications"
import { useReferralData } from "@/hooks/referral/use-referral-data"
import {
  copyReferralToClipboard,
  formatReferralRange,
  referralTiers,
  resolveReferralTier,
} from "@/lib/referral-config"

/**
 * Handles `ReferralSystem` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function ReferralSystem() {
  const notifications = useNotifications()
  const { stats, recentReferrals, referralCode, referralLink } = useReferralData()
  const [copiedCode, setCopiedCode] = React.useState(false)
  const [copiedLink, setCopiedLink] = React.useState(false)

  const totalReferrals = stats?.totalReferrals ?? 0
  const activeReferrals = stats?.activeReferrals ?? 0
  const totalEarnings = stats?.totalEarnings ?? 0
  const lifetimeVolume = stats?.lifetimeVolume ?? 0
  const hasStats = Boolean(stats)

  const currentTier = resolveReferralTier(totalReferrals)
  const currentTierIndex = referralTiers.findIndex((tier) => tier.tierId === currentTier.tierId)
  const nextTier = referralTiers[currentTierIndex + 1]
  const baseReferrals = currentTier.minReferrals
  const nextReferrals = nextTier?.minReferrals ?? baseReferrals
  const progressToNextTier = nextTier
    ? Math.min(
        100,
        Math.max(
          0,
          ((totalReferrals - baseReferrals) / Math.max(1, nextReferrals - baseReferrals)) * 100
        )
      )
    : 100

  /**
   * Handles `copyToClipboard` logic.
   *
   * @param text - Input used by `copyToClipboard` to compute state, payload, or request behavior.
   * @param type - Input used by `copyToClipboard` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const copyToClipboard = (text: string, type: "code" | "link") => {
    copyReferralToClipboard({
      text,
      setCopied: type === "code" ? setCopiedCode : setCopiedLink,
      onCopied: () => {
        notifications.addNotification({
          type: "success",
          title: "Copied",
          message: `Referral ${type} copied to clipboard`,
        })
      },
    })
  }

  return (
    <section id="referral" className="py-12">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-foreground mb-2">Referral Program</h2>
          <p className="text-muted-foreground">Invite friends and earn rewards together</p>
        </div>

        {/* Stats Overview */}
        <div className="grid md:grid-cols-4 gap-6 mb-8">
          <div className="p-6 rounded-xl glass border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-5 w-5 text-primary" />
              <p className="text-sm text-muted-foreground">Total Referrals</p>
            </div>
            <p className="text-3xl font-bold text-foreground">{hasStats ? totalReferrals : "—"}</p>
            <p className="text-xs text-success mt-1">{hasStats ? `${activeReferrals} active` : "—"}</p>
          </div>

          <div className="p-6 rounded-xl glass border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Gift className="h-5 w-5 text-accent" />
              <p className="text-sm text-muted-foreground">Total Earnings</p>
            </div>
            <p className="text-3xl font-bold text-foreground">{hasStats ? totalEarnings : "—"}</p>
            <p className="text-xs text-muted-foreground mt-1">CAREL</p>
          </div>

          <div className="p-6 rounded-xl glass border border-border">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-5 w-5 text-secondary" />
              <p className="text-sm text-muted-foreground">Lifetime Volume</p>
            </div>
            <p className="text-3xl font-bold text-foreground">
              {hasStats ? `$${(lifetimeVolume / 1000).toFixed(1)}K` : "—"}
            </p>
            <p className="text-xs text-success mt-1">From referrals</p>
          </div>

          <div className="p-6 rounded-xl glass border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Gift className="h-5 w-5 text-primary" />
              <p className="text-sm text-muted-foreground">Current Tier</p>
            </div>
            <p className="text-3xl font-bold text-foreground">
              {hasStats ? `Tier ${currentTierIndex + 1}` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {hasStats ? `${currentTier.commissionPercent}% commission` : "—"}
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Referral Code & Link */}
          <div className="lg:col-span-2 space-y-6">
            <div className="p-6 rounded-2xl glass-strong border border-border">
              <h3 className="text-lg font-bold text-foreground mb-4">Your Referral Code</h3>

              {/* Referral Code */}
              <div className="mb-4">
                <label className="text-sm text-muted-foreground mb-2 block">Referral Code</label>
                <div className="flex gap-2">
                  <div className="flex-1 px-4 py-3 rounded-lg bg-surface border border-border font-mono text-lg text-foreground">
                    {referralCode || "—"}
                  </div>
                  <Button onClick={() => copyToClipboard(referralCode, "code")} className="px-6 bg-primary hover:bg-primary/90">
                    {copiedCode ? (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-2" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Referral Link */}
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">Referral Link</label>
                <div className="flex gap-2">
                  <div className="flex-1 px-4 py-3 rounded-lg bg-surface border border-border text-foreground overflow-x-auto">
                    <p className="text-sm whitespace-nowrap">{referralLink || "—"}</p>
                  </div>
                  <Button
                    onClick={() => copyToClipboard(referralLink, "link")}
                    className="px-6 bg-secondary hover:bg-secondary/90 text-secondary-foreground"
                  >
                    {copiedLink ? (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-2" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Share Buttons */}
              <div className="mt-6 flex gap-3">
                <Button variant="outline" className="flex-1 bg-transparent" asChild>
                  <a
                    href={`https://twitter.com/intent/tweet?text=Join Carel Protocol and trade with privacy! Use my referral code: ${referralCode}&url=${referralLink}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Share on X
                  </a>
                </Button>
                <Button variant="outline" className="flex-1 bg-transparent" asChild>
                  <a
                    href={`https://t.me/share/url?url=${referralLink}&text=Join Carel Protocol with my referral: ${referralCode}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Share on Telegram
                  </a>
                </Button>
              </div>
            </div>

            {/* Recent Referrals */}
            <div className="p-6 rounded-2xl glass-strong border border-border">
              <h3 className="text-lg font-bold text-foreground mb-4">Recent Referrals</h3>
              <div className="space-y-2">
                {recentReferrals.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">No referrals yet</div>
                ) : (
                  recentReferrals.map((ref, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-3 rounded-lg bg-surface/50 border border-border"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                          <Users className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-mono text-sm text-foreground">{ref.address}</p>
                          <p className="text-xs text-muted-foreground">{ref.date}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-foreground">{ref.earnings}</p>
                        <p className="text-xs text-muted-foreground">{ref.volume} volume</p>
                        <span
                          className={cn(
                            "text-xs px-2 py-0.5 rounded-full",
                            ref.status.toLowerCase() === "active"
                              ? "bg-success/20 text-success"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {ref.status}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Referral Tiers */}
          <div className="space-y-6">
            <div className="p-6 rounded-2xl glass-strong border border-border">
              <h3 className="text-lg font-bold text-foreground mb-4">Tier Progress</h3>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Current Tier</span>
                  <span className="text-sm font-bold text-primary">Tier {currentTierIndex + 1}</span>
                </div>
                {nextTier && (
                  <>
                    <div className="h-2 bg-surface rounded-full overflow-hidden mb-2">
                      <div
                        className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
                        style={{ width: `${progressToNextTier}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {hasStats
                        ? `${nextTier.minReferrals - totalReferrals} more referrals to Tier ${currentTierIndex + 2}`
                        : "—"}
                    </p>
                  </>
                )}
              </div>

              <div className="space-y-3">
                {referralTiers.map((tier, idx) => (
                  <div
                    key={tier.tierId}
                    className={cn(
                      "p-4 rounded-lg border transition-all",
                      currentTierIndex === idx
                        ? "border-primary bg-primary/10"
                        : "border-border bg-surface/30"
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-foreground">Tier {idx + 1}</span>
                      {currentTierIndex === idx && (
                        <span className="text-xs px-2 py-1 rounded-full bg-primary text-primary-foreground">
                          Current
                        </span>
                      )}
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Referrals:</span>
                        <span className="text-foreground font-medium">{formatReferralRange(tier)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Commission:</span>
                        <span className="text-success font-medium">{tier.commissionPercent}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Bonus:</span>
                        <span className="text-accent font-medium">{tier.bonusCarel.toLocaleString()} CAREL</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* How It Works */}
            <div className="p-6 rounded-2xl glass-strong border border-border">
              <h3 className="text-lg font-bold text-foreground mb-4">How It Works</h3>
              <ol className="space-y-3">
                <li className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-primary">1</span>
                  </div>
                  <p className="text-sm text-muted-foreground">Share your referral code or link</p>
                </li>
                <li className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-primary">2</span>
                  </div>
                  <p className="text-sm text-muted-foreground">Friends sign up using your code</p>
                </li>
                <li className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-primary">3</span>
                  </div>
                  <p className="text-sm text-muted-foreground">Earn commission on their trading volume</p>
                </li>
                <li className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-primary">4</span>
                  </div>
                  <p className="text-sm text-muted-foreground">Unlock higher tiers for better rewards</p>
                </li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
