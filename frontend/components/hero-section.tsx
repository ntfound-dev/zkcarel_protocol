"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { 
  ArrowRightLeft, 
  Shield, 
  Zap, 
  Globe2, 
  ChevronRight,
  Activity,
  Lock
} from "lucide-react"
import { MarketTicker } from "@/components/market-ticker"
import { QuickStatsSidebar } from "@/components/quick-stats-sidebar"

/**
 * Handles `HeroSection` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function HeroSection() {
  const handleOpenAiAssistant = React.useCallback(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("carel:open-ai-assistant"))
    }
  }, [])

  return (
    <section className="relative py-8 lg:py-16">
      <div className="relative z-10">
        {/* Main Hero Content */}
        <div className="text-center max-w-4xl mx-auto mb-12">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary/10 border border-secondary/25 mb-6">
            <Lock className="h-4 w-4 text-secondary" />
            <span className="text-sm font-medium text-secondary carel-tech-label">Testnet Mode</span>
          </div>
          
          {/* Main Title */}
          <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4 lg:mb-6 leading-tight carel-tech-heading carel-neon-soft">
            <span className="text-balance">Invisible Trades,</span>
            <br />
            <span className="bg-gradient-to-r from-primary via-accent to-secondary bg-clip-text text-transparent">
              Infinite Freedom.
            </span>
          </h1>
          
          {/* Subtitle */}
          <p className="text-base sm:text-lg lg:text-xl text-muted-foreground max-w-2xl mx-auto mb-8 text-pretty carel-tech-copy">
            Experience the freedom of DeFi with zero-knowledge privacy. Seamlessly switch between Public Mode for standard visibility and Hide Mode for secure, anonymous execution powered by Garaga.
          </p>
          
          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <Link href="#featured-services">
              <Button size="lg" className="w-full sm:w-auto gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-8 py-6 text-lg">
                <ArrowRightLeft className="h-5 w-5" />
                Start Trading
              </Button>
            </Link>
            <Button
              variant="outline"
              size="lg"
              onClick={handleOpenAiAssistant}
              className="w-full sm:w-auto gap-2 border-border hover:border-primary/50 px-8 py-6 text-lg"
            >
              Open AI Assistant
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        {/* Swap & Bridge Feature Card */}
        <div className="max-w-5xl mx-auto mb-8">
          <MarketTicker />
        </div>
        <div className="max-w-5xl mx-auto mb-10">
          <QuickStatsSidebar variant="inline" />
        </div>

        {/* Feature Highlights */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 max-w-4xl mx-auto">
          <FeatureHighlight 
            icon={Shield}
            title="Zero-Knowledge Privacy"
            description="Your transactions stay private"
          />
          <FeatureHighlight 
            icon={Zap}
            title="Instant Swaps"
            description="Fast execution, best rates"
          />
          <FeatureHighlight 
            icon={Globe2}
            title="Cross-Chain"
            description="Bridge across multiple chains"
          />
          <FeatureHighlight 
            icon={Activity}
            title="Low Fees"
            description="Competitive trading fees"
          />
        </div>
      </div>
    </section>
  )
}

/**
 * Handles `FeatureHighlight` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function FeatureHighlight({ 
  icon: Icon, 
  title, 
  description 
}: { 
  icon: typeof Shield
  title: string
  description: string 
}) {
  return (
    <div className="p-4 lg:p-5 rounded-xl glass border border-border hover:border-primary/30 transition-colors group">
      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <h3 className="font-bold text-foreground text-sm lg:text-base mb-1">{title}</h3>
      <p className="text-xs lg:text-sm text-muted-foreground">{description}</p>
    </div>
  )
}
