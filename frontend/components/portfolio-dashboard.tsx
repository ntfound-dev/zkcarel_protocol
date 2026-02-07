"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, PieChart, ExternalLink, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const portfolioData = {
  totalValue: 100000,
  pnl: 12450,
  pnlPercent: 24.5,
  period: "7D",
  assets: [
    { symbol: "BTC", name: "Bitcoin", icon: "₿", value: 45000, percent: 45, change: 5.2 },
    { symbol: "ETH", name: "Ethereum", icon: "Ξ", value: 25000, percent: 25, change: -2.1 },
    { symbol: "CAREL", name: "ZkCarel", icon: "◇", value: 15000, percent: 15, change: 15.8 },
    { symbol: "STRK", name: "StarkNet", icon: "◈", value: 10000, percent: 10, change: 8.3 },
    { symbol: "Other", name: "Other Assets", icon: "•", value: 5000, percent: 5, change: 1.2 },
  ],
}

const chartData = [
  { day: "Mon", value: 85000 },
  { day: "Tue", value: 87500 },
  { day: "Wed", value: 89000 },
  { day: "Thu", value: 91000 },
  { day: "Fri", value: 95000 },
  { day: "Sat", value: 93000 },
  { day: "Sun", value: 100000 },
]

function MiniChart() {
  const maxValue = Math.max(...chartData.map(d => d.value))
  const minValue = Math.min(...chartData.map(d => d.value))
  const range = maxValue - minValue
  
  const points = chartData.map((d, i) => {
    const x = (i / (chartData.length - 1)) * 100
    const y = 100 - ((d.value - minValue) / range) * 80
    return `${x},${y}`
  }).join(" ")

  const areaPoints = `0,100 ${points} 100,100`

  return (
    <div className="relative h-40 w-full">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
        {/* Gradient Area */}
        <defs>
          <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--neon-purple)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--neon-purple)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--neon-purple)" />
            <stop offset="50%" stopColor="var(--neon-cyan)" />
            <stop offset="100%" stopColor="var(--neon-purple)" />
          </linearGradient>
        </defs>
        
        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map((y) => (
          <line
            key={y}
            x1="0"
            y1={y}
            x2="100"
            y2={y}
            stroke="var(--border)"
            strokeWidth="0.5"
            strokeDasharray="2,2"
          />
        ))}
        
        {/* Area fill */}
        <polygon
          points={areaPoints}
          fill="url(#chartGradient)"
        />
        
        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke="url(#lineGradient)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Data points */}
        {chartData.map((d, i) => {
          const x = (i / (chartData.length - 1)) * 100
          const y = 100 - ((d.value - minValue) / range) * 80
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r="2"
              fill="var(--neon-cyan)"
              className="animate-pulse-glow"
            />
          )
        })}
      </svg>
      
      {/* X-axis labels */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-between text-xs text-muted-foreground px-1">
        {chartData.map((d) => (
          <span key={d.day}>{d.day}</span>
        ))}
      </div>
    </div>
  )
}

function AssetRow({ asset }: { asset: typeof portfolioData.assets[0] }) {
  const isPositive = asset.change >= 0
  
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0 hover:bg-primary/5 px-2 -mx-2 rounded-lg transition-colors">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-surface flex items-center justify-center text-xl border border-border">
          {asset.icon}
        </div>
        <div>
          <p className="font-medium text-foreground">{asset.symbol}</p>
          <p className="text-xs text-muted-foreground">{asset.name}</p>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="w-24">
          <div className="h-2 rounded-full bg-surface overflow-hidden">
            <div 
              className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
              style={{ width: `${asset.percent}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1 text-center">{asset.percent}%</p>
        </div>
        <div className="text-right min-w-[100px]">
          <p className="font-medium text-foreground">${asset.value.toLocaleString()}</p>
          <p className={cn(
            "text-xs flex items-center justify-end gap-1",
            isPositive ? "text-success" : "text-destructive"
          )}>
            {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {isPositive ? "+" : ""}{asset.change}%
          </p>
        </div>
      </div>
    </div>
  )
}

const transactionHistory = [
  { id: 1, type: "Buy", asset: "BTC", amount: "0.5", value: "$32,500", time: "2 hours ago", status: "Completed" },
  { id: 2, type: "Swap", asset: "ETH → CAREL", amount: "5.0", value: "$10,000", time: "5 hours ago", status: "Completed" },
  { id: 3, type: "Sell", asset: "STRK", amount: "1000", value: "$1,250", time: "1 day ago", status: "Completed" },
  { id: 4, type: "Buy", asset: "CAREL", amount: "5000", value: "$4,250", time: "2 days ago", status: "Completed" },
  { id: 5, type: "Swap", asset: "BTC → ETH", amount: "0.2", value: "$13,000", time: "3 days ago", status: "Completed" },
]

export function PortfolioDashboard() {
  const isPositive = portfolioData.pnl >= 0
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const [selectedPeriod, setSelectedPeriod] = React.useState("7D")

  return (
    <section id="portfolio" className="py-12">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-foreground">Portfolio Overview</h2>
        <Button 
          variant="outline" 
          className="gap-2 border-primary/50 text-foreground hover:bg-primary/10 bg-transparent"
          onClick={() => setDetailsOpen(true)}
        >
          View Details <ExternalLink className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* PnL Chart */}
        <div className="p-6 rounded-2xl glass border border-border hover:border-primary/50 transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-primary" />
              <span className="font-medium text-foreground">PnL Chart</span>
            </div>
            <div className="flex gap-2">
              {["24H", "7D", "30D", "ALL"].map((period) => (
                <button
                  key={period}
                  onClick={() => setSelectedPeriod(period)}
                  className={cn(
                    "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                    period === selectedPeriod
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-end gap-2 mb-6">
            <span className={cn(
              "text-3xl font-bold",
              isPositive ? "text-success" : "text-destructive"
            )}>
              {isPositive ? "+" : ""}${portfolioData.pnl.toLocaleString()}
            </span>
            <span className={cn(
              "text-sm font-medium pb-1 flex items-center gap-1",
              isPositive ? "text-success" : "text-destructive"
            )}>
              {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              {isPositive ? "+" : ""}{portfolioData.pnlPercent}%
            </span>
          </div>

          <MiniChart />
        </div>

        {/* Asset Allocation */}
        <div className="p-6 rounded-2xl glass border border-border hover:border-primary/50 transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">Asset Allocation</span>
            </div>
            <span className="text-2xl font-bold text-foreground">
              ${portfolioData.totalValue.toLocaleString()}
            </span>
          </div>

          <div className="space-y-1">
            {portfolioData.assets.map((asset) => (
              <AssetRow key={asset.symbol} asset={asset} />
            ))}
          </div>
        </div>
      </div>

      {/* Portfolio Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="glass-strong border-border max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <PieChart className="h-5 w-5 text-primary" />
              Portfolio Details
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-surface/50 border border-border">
                <p className="text-xs text-muted-foreground">Total Value</p>
                <p className="text-lg font-bold text-foreground">${portfolioData.totalValue.toLocaleString()}</p>
              </div>
              <div className="p-4 rounded-xl bg-surface/50 border border-border">
                <p className="text-xs text-muted-foreground">Total PnL</p>
                <p className={cn("text-lg font-bold", isPositive ? "text-success" : "text-destructive")}>
                  {isPositive ? "+" : ""}${portfolioData.pnl.toLocaleString()}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-surface/50 border border-border">
                <p className="text-xs text-muted-foreground">Assets</p>
                <p className="text-lg font-bold text-foreground">{portfolioData.assets.length}</p>
              </div>
              <div className="p-4 rounded-xl bg-surface/50 border border-border">
                <p className="text-xs text-muted-foreground">Best Performer</p>
                <p className="text-lg font-bold text-success">CAREL +15.8%</p>
              </div>
            </div>

            {/* Asset Breakdown */}
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">Asset Breakdown</h3>
              <div className="space-y-3">
                {portfolioData.assets.map((asset) => (
                  <div key={asset.symbol} className="flex items-center justify-between p-3 rounded-lg bg-surface/30 border border-border">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center text-lg border border-border">
                        {asset.icon}
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{asset.symbol}</p>
                        <p className="text-xs text-muted-foreground">{asset.name}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-foreground">${asset.value.toLocaleString()}</p>
                      <p className={cn("text-xs", asset.change >= 0 ? "text-success" : "text-destructive")}>
                        {asset.change >= 0 ? "+" : ""}{asset.change}%
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Transaction History */}
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">Recent Transactions</h3>
              <div className="space-y-2">
                {transactionHistory.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between p-3 rounded-lg bg-surface/30 border border-border">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
                        tx.type === "Buy" && "bg-success/20 text-success",
                        tx.type === "Sell" && "bg-destructive/20 text-destructive",
                        tx.type === "Swap" && "bg-secondary/20 text-secondary"
                      )}>
                        {tx.type[0]}
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{tx.type} {tx.asset}</p>
                        <p className="text-xs text-muted-foreground">{tx.time}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-foreground">{tx.value}</p>
                      <p className="text-xs text-success">{tx.status}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
