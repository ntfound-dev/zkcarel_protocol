"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  Users, 
  Gift, 
  Copy, 
  Check, 
  TrendingUp, 
  Coins, 
  Clock, 
  ChevronRight,
  Share2,
  Star,
  Sparkles,
  ArrowUpRight,
  Lock
} from "lucide-react"

// Mock referral data
const referralHistory = [
  { 
    id: 1, 
    user: "0x8f...2e4d", 
    date: "2024-01-15", 
    action: "Swap", 
    volume: "$2,450", 
    points: 245,
    status: "completed" 
  },
  { 
    id: 2, 
    user: "0x3a...9f1c", 
    date: "2024-01-14", 
    action: "Bridge", 
    volume: "$5,200", 
    points: 520,
    status: "completed" 
  },
  { 
    id: 3, 
    user: "0x7b...4d8a", 
    date: "2024-01-13", 
    action: "Swap", 
    volume: "$890", 
    points: 89,
    status: "completed" 
  },
  { 
    id: 4, 
    user: "0x1e...6c2f", 
    date: "2024-01-12", 
    action: "Stake", 
    volume: "$10,000", 
    points: 1000,
    status: "pending" 
  },
  { 
    id: 5, 
    user: "0x9d...8e1a", 
    date: "2024-01-11", 
    action: "Swap", 
    volume: "$3,100", 
    points: 310,
    status: "completed" 
  },
]

const tierRewards = [
  { tier: "Bronze", referrals: 5, bonus: "5%", unlocked: true },
  { tier: "Silver", referrals: 15, bonus: "7%", unlocked: true },
  { tier: "Gold", referrals: 30, bonus: "10%", unlocked: false },
  { tier: "Platinum", referrals: 50, bonus: "12%", unlocked: false },
  { tier: "Diamond", referrals: 100, bonus: "15%", unlocked: false },
]

interface ReferralLogProps {
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode
  pointsEarned?: number
  showTrigger?: boolean
}

export function ReferralLog({ 
  isOpen, 
  onOpenChange, 
  trigger,
  pointsEarned = 12500,
  showTrigger = true 
}: ReferralLogProps) {
  const [copied, setCopied] = React.useState(false)
  const referralCode = "ZKCRL-8F4E2D"
  const referralLink = `https://zkcarel.com/ref/${referralCode}`
  
  // Calculate if user has earned 10% bonus (simulation)
  const hasEarnedBonus = pointsEarned >= 10000
  const currentTier = tierRewards.find(t => !t.unlocked)?.tier || "Diamond"
  const totalReferrals = 18
  const activeReferrals = 12
  const pendingRewards = 1500

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {showTrigger && (
        <DialogTrigger asChild>
          {trigger || (
            <Button variant="outline" className="gap-2">
              <Users className="h-4 w-4" />
              Referral Log
              {hasEarnedBonus && (
                <span className="px-1.5 py-0.5 rounded-full bg-success/20 text-success text-xs font-bold">
                  10%
                </span>
              )}
            </Button>
          )}
        </DialogTrigger>
      )}
      
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto glass-strong border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-foreground flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Referral Program
            {hasEarnedBonus && (
              <span className="px-2 py-1 rounded-full bg-gradient-to-r from-primary to-accent text-white text-xs font-bold">
                10% Bonus Active
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="p-4 rounded-xl glass border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Total Referrals</span>
            </div>
            <p className="text-2xl font-bold text-foreground">{totalReferrals}</p>
          </div>
          <div className="p-4 rounded-xl glass border border-border">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-success" />
              <span className="text-xs text-muted-foreground">Active</span>
            </div>
            <p className="text-2xl font-bold text-foreground">{activeReferrals}</p>
          </div>
          <div className="p-4 rounded-xl glass border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Gift className="h-4 w-4 text-accent" />
              <span className="text-xs text-muted-foreground">Points Earned</span>
            </div>
            <p className="text-2xl font-bold text-foreground">{pointsEarned.toLocaleString()}</p>
          </div>
          <div className="p-4 rounded-xl glass border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-secondary" />
              <span className="text-xs text-muted-foreground">Pending</span>
            </div>
            <p className="text-2xl font-bold text-foreground">{pendingRewards}</p>
          </div>
        </div>

        {/* Referral Link Section */}
        <div className="p-4 rounded-xl bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground mb-1">Your Referral Link</p>
              <p className="text-xs text-muted-foreground truncate max-w-xs">{referralLink}</p>
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => copyToClipboard(referralLink)}
                className="gap-2"
              >
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied!" : "Copy"}
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="gap-2"
              >
                <Share2 className="h-4 w-4" />
                Share
              </Button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="history" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="history">Activity Log</TabsTrigger>
            <TabsTrigger value="tiers">Tier Rewards</TabsTrigger>
            <TabsTrigger value="simulation">Simulation</TabsTrigger>
          </TabsList>

          {/* Activity Log Tab */}
          <TabsContent value="history" className="space-y-4">
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="grid grid-cols-5 gap-4 p-3 bg-surface/50 text-xs font-medium text-muted-foreground border-b border-border">
                <span>User</span>
                <span>Date</span>
                <span>Action</span>
                <span>Volume</span>
                <span>Points</span>
              </div>
              {referralHistory.map((item) => (
                <div 
                  key={item.id} 
                  className="grid grid-cols-5 gap-4 p-3 text-sm border-b border-border/50 last:border-0 hover:bg-surface/30 transition-colors"
                >
                  <span className="text-foreground font-mono">{item.user}</span>
                  <span className="text-muted-foreground">{item.date}</span>
                  <span className="text-foreground">{item.action}</span>
                  <span className="text-foreground">{item.volume}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-success font-medium">+{item.points}</span>
                    {item.status === "pending" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/20 text-secondary">
                        Pending
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* Tier Rewards Tab */}
          <TabsContent value="tiers" className="space-y-4">
            <div className="space-y-3">
              {tierRewards.map((tier, index) => (
                <div 
                  key={tier.tier}
                  className={cn(
                    "p-4 rounded-xl border transition-all",
                    tier.unlocked 
                      ? "glass border-primary/30 bg-primary/5" 
                      : "glass border-border"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center",
                        tier.unlocked 
                          ? "bg-gradient-to-br from-primary to-accent" 
                          : "bg-muted"
                      )}>
                        <Star className={cn(
                          "h-5 w-5",
                          tier.unlocked ? "text-white" : "text-muted-foreground"
                        )} />
                      </div>
                      <div>
                        <p className={cn(
                          "font-bold",
                          tier.unlocked ? "text-foreground" : "text-muted-foreground"
                        )}>
                          {tier.tier}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {tier.referrals} referrals required
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={cn(
                        "text-lg font-bold",
                        tier.unlocked ? "text-success" : "text-muted-foreground"
                      )}>
                        {tier.bonus}
                      </p>
                      <p className="text-xs text-muted-foreground">bonus</p>
                    </div>
                  </div>
                  {tier.unlocked && (
                    <div className="mt-2 flex items-center gap-1 text-xs text-success">
                      <Check className="h-3 w-3" />
                      Unlocked
                    </div>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>

          {/* Simulation Tab - For Coming Soon Features */}
          <TabsContent value="simulation" className="space-y-4">
            <div className="p-4 rounded-xl bg-secondary/10 border border-secondary/20 mb-4">
              <div className="flex items-start gap-3">
                <Sparkles className="h-5 w-5 text-secondary flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-foreground">Simulation Mode</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Preview how Limit Order and Stake rewards will work in the referral program.
                    These features are coming soon to mainnet.
                  </p>
                </div>
              </div>
            </div>

            {/* Limit Order Simulation */}
            <div className="p-6 rounded-xl glass border border-border relative overflow-hidden">
              <div className="absolute top-3 right-3 px-2 py-1 rounded-full bg-secondary/20 text-secondary text-xs font-medium flex items-center gap-1">
                <Lock className="h-3 w-3" />
                Coming Soon
              </div>
              
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-secondary via-primary to-accent flex items-center justify-center">
                  <TrendingUp className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h4 className="font-bold text-foreground">Limit Order Referrals</h4>
                  <p className="text-sm text-muted-foreground">Earn from referral limit orders</p>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="p-3 rounded-lg bg-surface/50">
                  <p className="text-xs text-muted-foreground mb-1">Simulated Orders</p>
                  <p className="text-lg font-bold text-foreground">24</p>
                </div>
                <div className="p-3 rounded-lg bg-surface/50">
                  <p className="text-xs text-muted-foreground mb-1">Est. Volume</p>
                  <p className="text-lg font-bold text-foreground">$45,200</p>
                </div>
                <div className="p-3 rounded-lg bg-surface/50">
                  <p className="text-xs text-muted-foreground mb-1">Est. Points</p>
                  <p className="text-lg font-bold text-success">+4,520</p>
                </div>
              </div>
              
              <Button disabled className="w-full cursor-not-allowed">
                <Lock className="h-4 w-4 mr-2" />
                Available in Mainnet
              </Button>
            </div>

            {/* Stake Simulation */}
            <div className="p-6 rounded-xl glass border border-border relative overflow-hidden">
              <div className="absolute top-3 right-3 px-2 py-1 rounded-full bg-secondary/20 text-secondary text-xs font-medium flex items-center gap-1">
                <Lock className="h-3 w-3" />
                Coming Soon
              </div>
              
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent via-secondary to-primary flex items-center justify-center">
                  <Coins className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h4 className="font-bold text-foreground">Staking Referrals</h4>
                  <p className="text-sm text-muted-foreground">Earn from referral staking rewards</p>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="p-3 rounded-lg bg-surface/50">
                  <p className="text-xs text-muted-foreground mb-1">Simulated TVL</p>
                  <p className="text-lg font-bold text-foreground">$125K</p>
                </div>
                <div className="p-3 rounded-lg bg-surface/50">
                  <p className="text-xs text-muted-foreground mb-1">Est. APY Bonus</p>
                  <p className="text-lg font-bold text-foreground">+2.5%</p>
                </div>
                <div className="p-3 rounded-lg bg-surface/50">
                  <p className="text-xs text-muted-foreground mb-1">Est. Points</p>
                  <p className="text-lg font-bold text-success">+12,500</p>
                </div>
              </div>
              
              <Button disabled className="w-full cursor-not-allowed">
                <Lock className="h-4 w-4 mr-2" />
                Available in Mainnet
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        {/* 10% Bonus Banner - Shows when earned */}
        {hasEarnedBonus && (
          <div className="mt-6 p-4 rounded-xl bg-gradient-to-r from-success/20 to-primary/20 border border-success/30">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="font-bold text-foreground">10% Bonus Unlocked!</p>
                <p className="text-sm text-muted-foreground">
                  You&apos;ve earned {pointsEarned.toLocaleString()} points. Enjoy 10% extra on all referral rewards!
                </p>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Export a page component that can be used standalone
export function ReferralLogPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <ReferralLog isOpen={true} onOpenChange={() => {}} showTrigger={false} />
    </div>
  )
}
