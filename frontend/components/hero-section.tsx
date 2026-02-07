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
  TrendingUp, 
  ChevronRight,
  Activity,
  Lock
} from "lucide-react"

// Animated counter hook - starts at 0 on server, animates on client mount
function useAnimatedCounter(end: number, duration: number = 2000) {
  const [count, setCount] = React.useState(0)
  const [mounted, setMounted] = React.useState(false)
  
  React.useEffect(() => {
    setMounted(true)
  }, [])
  
  React.useEffect(() => {
    if (!mounted) return
    
    let startTime: number | null = null
    let animationFrame: number
    
    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp
      const progress = Math.min((timestamp - startTime) / duration, 1)
      
      // Easing function
      const easeOutQuart = 1 - Math.pow(1 - progress, 4)
      setCount(Math.floor(easeOutQuart * end))
      
      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate)
      }
    }
    
    animationFrame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationFrame)
  }, [end, duration, mounted])
  
  return count
}

// Stats display component
function AnimatedStat({ 
  label, 
  value, 
  prefix = "", 
  suffix = "",
  animatedValue 
}: { 
  label: string
  value: string
  prefix?: string
  suffix?: string
  animatedValue?: number
}) {
  return (
    <div className="text-center px-4 sm:px-6 lg:px-8">
      <p className="text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground mb-1">
        {prefix}
        {animatedValue !== undefined ? animatedValue.toLocaleString() : value}
        {suffix}
      </p>
      <p className="text-xs sm:text-sm text-muted-foreground">{label}</p>
    </div>
  )
}

export function HeroSection() {
  const volume24h = useAnimatedCounter(2400000, 2500)
  const transactions = useAnimatedCounter(12500, 2000)
  
  return (
    <section className="relative py-8 lg:py-16">
      {/* Background Decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-64 h-64 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-accent/10 rounded-full blur-3xl" />
      </div>
      
      <div className="relative z-10">
        {/* Main Hero Content */}
        <div className="text-center max-w-4xl mx-auto mb-12">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-6">
            <Lock className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-primary">Testnet Mode Active</span>
          </div>
          
          {/* Main Title */}
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-4 lg:mb-6 leading-tight">
            <span className="text-balance">Privacy-First</span>
            <br />
            <span className="bg-gradient-to-r from-primary via-accent to-secondary bg-clip-text text-transparent">
              DeFi Trading
            </span>
          </h1>
          
          {/* Subtitle */}
          <p className="text-base sm:text-lg lg:text-xl text-muted-foreground max-w-2xl mx-auto mb-8 text-pretty">
            Trade cryptocurrencies with zero-knowledge privacy. Swap, bridge, and earn rewards on the most advanced DeFi platform.
          </p>
          
          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <Link href="#trade">
              <Button size="lg" className="w-full sm:w-auto gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-8 py-6 text-lg">
                <ArrowRightLeft className="h-5 w-5" />
                Start Trading
              </Button>
            </Link>
            <Link href="#docs">
              <Button variant="outline" size="lg" className="w-full sm:w-auto gap-2 border-border hover:border-primary/50 px-8 py-6 text-lg">
                Learn More
                <ChevronRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
        
        {/* Swap & Bridge Feature Card */}
        <div className="max-w-4xl mx-auto mb-12">
          <div className="relative p-6 sm:p-8 rounded-2xl glass-strong border border-primary/30 overflow-hidden">
            {/* Animated Border Glow */}
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-primary/20 via-accent/20 to-secondary/20 opacity-50" />
            
            <div className="relative z-10">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                {/* Left Side - Feature Info */}
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-gradient-to-br from-primary via-accent to-secondary flex items-center justify-center flex-shrink-0">
                    <ArrowRightLeft className="h-7 w-7 sm:h-8 sm:w-8 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-2">
                      Swap & Bridge
                    </h2>
                    <p className="text-sm sm:text-base text-muted-foreground max-w-md">
                      Trade tokens seamlessly across chains with zero-knowledge privacy
                    </p>
                  </div>
                </div>
                
                {/* Right Side - Stats */}
                <div className="flex items-center justify-center lg:justify-end gap-6 lg:gap-8">
                  <AnimatedStat 
                    label="Volume 24H" 
                    value="$2.4M" 
                    prefix="$"
                    suffix=""
                    animatedValue={volume24h}
                  />
                  <div className="w-px h-12 bg-border hidden sm:block" />
                  <AnimatedStat 
                    label="Transactions" 
                    value="12.5K" 
                    animatedValue={transactions}
                  />
                </div>
              </div>
              
              {/* Explore Button */}
              <div className="mt-6 flex justify-center lg:justify-end">
                <Link href="#trade">
                  <Button className="gap-2 bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 hover:border-primary/50">
                    <span>Explore Swap & Bridge</span>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
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
