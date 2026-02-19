"use client"

import * as React from "react"
import { ThemeProvider } from "@/components/theme-provider"
import { WalletProvider } from "@/hooks/use-wallet"
import { NotificationsProvider } from "@/hooks/use-notifications"
import { GlobalEventHandlers } from "@/components/global-event-handlers"
import { EnhancedNavigation } from "@/components/enhanced-navigation"
import { HeroSection } from "@/components/hero-section"
import { FeaturedCards, type SelectableFeatureId } from "@/components/featured-cards"
import { TradingInterface } from "@/components/trading-interface"
import { LimitOrder } from "@/components/limit-order"
import { StakeEarn } from "@/components/stake-earn"
import { DefiFuturesBattleship } from "@/components/defi-futures-battleship"
import { PortfolioDashboard } from "@/components/portfolio-dashboard"
import { Leaderboard } from "@/components/leaderboard"
import { RewardsHub } from "@/components/rewards-hub"
import { FloatingAIAssistant } from "@/components/floating-ai-assistant"
import { ParticleBackground } from "@/components/particle-background"

export default function CarelProtocolApp() {
  const [activeFeature, setActiveFeature] = React.useState<SelectableFeatureId | null>(null)

  const handleSelectFeature = React.useCallback((featureId: SelectableFeatureId) => {
    setActiveFeature((current) => (current === featureId ? null : featureId))
  }, [])

  React.useEffect(() => {
    if (!activeFeature) return
    const panel = document.getElementById("feature-panel")
    if (panel) {
      panel.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [activeFeature])

  return (
    <ThemeProvider defaultTheme="dark">
      <WalletProvider>
        <NotificationsProvider>
          <GlobalEventHandlers />
          <div className="relative min-h-screen">
            {/* Background Effects */}
            <ParticleBackground />
            
            {/* Navigation */}
            <EnhancedNavigation />

            {/* Main Layout */}
            <div className="container mx-auto px-4 py-8">
              {/* Main Content */}
              <main className="space-y-12">
                  {/* Hero Section with Swap & Bridge */}
                  <HeroSection />

                  {/* Featured Cards */}
                  <FeaturedCards
                    onSelectFeature={handleSelectFeature}
                    activeFeatureId={activeFeature}
                  />

                  {/* Feature Panels (shown on card click) */}
                  {activeFeature && (
                    <section id="feature-panel" className="space-y-4">
                      {activeFeature === "swap-bridge" && (
                        <section id="trade">
                          <TradingInterface />
                        </section>
                      )}
                      {activeFeature === "limit-order" && (
                        <section id="limit-order">
                          <LimitOrder />
                        </section>
                      )}
                      {activeFeature === "stake-earn" && (
                        <section id="stake">
                          <StakeEarn />
                        </section>
                      )}
                      {activeFeature === "defi-futures" && (
                        <section id="defi-futures">
                          <DefiFuturesBattleship />
                        </section>
                      )}
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
                        <span className="font-bold text-foreground">Carel Protocol</span>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
                        <a href="https://x.com/carelprotocol" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">X (Twitter)</a>
                        <a href="https://t.me/carelprotocol" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">Telegram</a>
                        <a href="https://github.com/carelprotocol" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">GitHub</a>
                        <a href="#docs" className="hover:text-primary transition-colors">Documentation</a>
                        <a href="#terms" className="hover:text-primary transition-colors">Terms</a>
                        <a href="#privacy" className="hover:text-primary transition-colors">Privacy Policy</a>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        2024 Carel Protocol. All rights reserved.
                      </p>
                    </div>
                  </footer>
              </main>
            </div>

            {/* Floating AI Assistant */}
            <FloatingAIAssistant />
          </div>
        </NotificationsProvider>
      </WalletProvider>
    </ThemeProvider>
  )
}
