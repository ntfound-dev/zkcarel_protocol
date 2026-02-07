"use client"

import * as React from "react"
import { ThemeProvider } from "@/components/theme-provider"
import { WalletProvider } from "@/hooks/use-wallet"
import { NotificationsProvider } from "@/hooks/use-notifications"
import { EnhancedNavigation } from "@/components/enhanced-navigation"
import { QuickStatsSidebar } from "@/components/quick-stats-sidebar"
import { HeroSection } from "@/components/hero-section"
import { FeaturedCards } from "@/components/featured-cards"
import { TradingInterface } from "@/components/trading-interface"
import { LimitOrder } from "@/components/limit-order"
import { StakeEarn } from "@/components/stake-earn"
import { PortfolioDashboard } from "@/components/portfolio-dashboard"
import { Leaderboard } from "@/components/leaderboard"
import { RewardsHub } from "@/components/rewards-hub"
import { FloatingAIAssistant } from "@/components/floating-ai-assistant"
import { ParticleBackground } from "@/components/particle-background"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ChevronDown, Lock, Eye, EyeOff, TrendingUp, Coins } from "lucide-react"

export default function ZkCarelApp() {
  // Conditional section visibility
  const [showLimitOrder, setShowLimitOrder] = React.useState(false)
  const [showStakeEarn, setShowStakeEarn] = React.useState(false)
  
  // Collapsed states for revealed sections
  const [limitOrderExpanded, setLimitOrderExpanded] = React.useState(true)
  const [stakeEarnExpanded, setStakeEarnExpanded] = React.useState(true)

  return (
    <ThemeProvider defaultTheme="dark">
      <WalletProvider>
        <NotificationsProvider>
          <div className="relative min-h-screen">
            {/* Background Effects */}
            <ParticleBackground />
            
            {/* Navigation */}
            <EnhancedNavigation />

            {/* Main Layout */}
            <div className="container mx-auto px-4 py-8">
              <div className="flex flex-col lg:flex-row gap-8">
                {/* Sidebar - Hidden on mobile, shown on lg+ */}
                <div className="hidden lg:block">
                  <QuickStatsSidebar />
                </div>

                {/* Main Content */}
                <main className="flex-1 space-y-12">
                  {/* Hero Section with Swap & Bridge */}
                  <HeroSection />

                  {/* Featured Cards */}
                  <FeaturedCards />

                  {/* Trading Interface - Always Visible */}
                  <section id="trade">
                    <TradingInterface />
                  </section>

                  {/* Limit Order Section - Conditional */}
                  {!showLimitOrder ? (
                    <section className="py-6">
                      <button
                        onClick={() => setShowLimitOrder(true)}
                        className="w-full group"
                      >
                        <div className="p-6 rounded-2xl glass border border-border hover:border-primary/50 transition-all duration-300">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-secondary via-primary to-accent flex items-center justify-center group-hover:scale-110 transition-transform">
                                <TrendingUp className="h-6 w-6 text-white" />
                              </div>
                              <div className="text-left">
                                <h3 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors flex items-center gap-2">
                                  Limit Order
                                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-secondary/20 text-secondary">
                                    Coming Soon
                                  </span>
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                  Set your price and let the market come to you
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="hidden sm:flex items-center gap-4 text-sm">
                                <div className="text-right">
                                  <p className="text-muted-foreground text-xs">Active Orders</p>
                                  <p className="font-bold text-foreground">3,420</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-muted-foreground text-xs">Success Rate</p>
                                  <p className="font-bold text-foreground">94%</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 text-primary">
                                <span className="text-sm font-medium">View Preview</span>
                                <ChevronDown className="h-4 w-4" />
                              </div>
                            </div>
                          </div>
                        </div>
                      </button>
                    </section>
                  ) : (
                    <section id="limit-order">
                      {/* Collapsible Header */}
                      <button
                        onClick={() => setLimitOrderExpanded(!limitOrderExpanded)}
                        className="w-full mb-4"
                      >
                        <div className="flex items-center justify-between p-4 rounded-xl glass border border-border hover:border-primary/30 transition-colors">
                          <div className="flex items-center gap-3">
                            <TrendingUp className="h-5 w-5 text-primary" />
                            <span className="font-bold text-foreground">Limit Order</span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-secondary/20 text-secondary">Coming Soon</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setShowLimitOrder(false)
                              }}
                              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-surface transition-colors"
                            >
                              Hide
                            </button>
                            <ChevronDown className={cn(
                              "h-4 w-4 text-muted-foreground transition-transform",
                              limitOrderExpanded && "rotate-180"
                            )} />
                          </div>
                        </div>
                      </button>
                      {limitOrderExpanded && <LimitOrder />}
                    </section>
                  )}

                  {/* Stake & Earn Section - Conditional */}
                  {!showStakeEarn ? (
                    <section className="py-6">
                      <button
                        onClick={() => setShowStakeEarn(true)}
                        className="w-full group"
                      >
                        <div className="p-6 rounded-2xl glass border border-border hover:border-primary/50 transition-all duration-300">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent via-secondary to-primary flex items-center justify-center group-hover:scale-110 transition-transform">
                                <Coins className="h-6 w-6 text-white" />
                              </div>
                              <div className="text-left">
                                <h3 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors flex items-center gap-2">
                                  Stake & Earn
                                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-secondary/20 text-secondary">
                                    Coming Soon
                                  </span>
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                  Earn passive income on your crypto assets
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="hidden sm:flex items-center gap-4 text-sm">
                                <div className="text-right">
                                  <p className="text-muted-foreground text-xs">TVL</p>
                                  <p className="font-bold text-foreground">$8.2M</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-muted-foreground text-xs">APY</p>
                                  <p className="font-bold text-success">Up to 12%</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 text-primary">
                                <span className="text-sm font-medium">View Preview</span>
                                <ChevronDown className="h-4 w-4" />
                              </div>
                            </div>
                          </div>
                        </div>
                      </button>
                    </section>
                  ) : (
                    <section id="stake">
                      {/* Collapsible Header */}
                      <button
                        onClick={() => setStakeEarnExpanded(!stakeEarnExpanded)}
                        className="w-full mb-4"
                      >
                        <div className="flex items-center justify-between p-4 rounded-xl glass border border-border hover:border-primary/30 transition-colors">
                          <div className="flex items-center gap-3">
                            <Coins className="h-5 w-5 text-primary" />
                            <span className="font-bold text-foreground">Stake & Earn</span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-secondary/20 text-secondary">Coming Soon</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setShowStakeEarn(false)
                              }}
                              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-surface transition-colors"
                            >
                              Hide
                            </button>
                            <ChevronDown className={cn(
                              "h-4 w-4 text-muted-foreground transition-transform",
                              stakeEarnExpanded && "rotate-180"
                            )} />
                          </div>
                        </div>
                      </button>
                      {stakeEarnExpanded && <StakeEarn />}
                    </section>
                  )}

                  {/* Portfolio Dashboard */}
                  <PortfolioDashboard />

                  {/* Leaderboard */}
                  <Leaderboard />

                  {/* Rewards Hub */}
                  <RewardsHub />

                  {/* Footer */}
                  <footer className="py-8 border-t border-border">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                            <span className="text-primary font-bold">Z</span>
                          </div>
                        </div>
                        <span className="font-bold text-foreground">ZkCarel</span>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
                        <a href="https://x.com/zkcarel" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">X (Twitter)</a>
                        <a href="https://t.me/zkcarel" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">Telegram</a>
                        <a href="https://github.com/zkcarel" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">GitHub</a>
                        <a href="#docs" className="hover:text-primary transition-colors">Documentation</a>
                        <a href="#terms" className="hover:text-primary transition-colors">Terms</a>
                        <a href="#privacy" className="hover:text-primary transition-colors">Privacy Policy</a>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        2024 ZkCarel. All rights reserved.
                      </p>
                    </div>
                  </footer>
                </main>
              </div>
            </div>

            {/* Floating AI Assistant */}
            <FloatingAIAssistant />
          </div>
        </NotificationsProvider>
      </WalletProvider>
    </ThemeProvider>
  )
}
