"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { TrendingDown, TrendingUp, PieChart, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWallet } from "@/hooks/wallet/use-wallet"
import { MiniChart } from "@/components/portfolio/mini-chart"
import { AssetRow } from "@/components/portfolio/asset-row"
import { PortfolioDetailsModal } from "@/components/portfolio/portfolio-details-modal"
import { usePortfolioData } from "@/hooks/portfolio/use-portfolio-data"
import { useTransactionHistory } from "@/hooks/portfolio/use-transaction-history"
import { formatUsd } from "@/lib/portfolio-utils"

/**
 * Handles `PortfolioDashboard` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function PortfolioDashboard() {
  const wallet = useWallet()
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const [selectedPeriod, setSelectedPeriod] = React.useState("7D")

  const {
    displayData,
    chartData,
    hasAnalytics,
    isPositive,
    pnlSign,
    bestPerformer,
  } = usePortfolioData({ selectedPeriod, wallet })
  const { transactions, txSummary } = useTransactionHistory({ enabled: detailsOpen })

  return (
    <section id="portfolio" className="py-12">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-foreground carel-tech-heading">Portfolio Overview</h2>
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
        <div className="p-6 rounded-2xl glass border border-border hover:border-primary/50 transition-all duration-300 flex flex-col">
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
            <span
              className={cn(
                "text-3xl font-bold",
                isPositive ? "text-success" : "text-destructive"
              )}
            >
              {hasAnalytics ? `${pnlSign}${formatUsd(Math.abs(displayData.pnl))}` : "—"}
            </span>
            <span
              className={cn(
                "text-sm font-medium pb-1 flex items-center gap-1",
                isPositive ? "text-success" : "text-destructive"
              )}
            >
              {hasAnalytics ? (
                <>
                  {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {isPositive ? "+" : ""}
                  {displayData.pnlPercent}%
                </>
              ) : (
                "—"
              )}
            </span>
          </div>

          <MiniChart data={chartData} className="flex-1 min-h-[260px]" />
        </div>

        {/* Asset Allocation */}
        <div className="p-6 rounded-2xl glass border border-border hover:border-primary/50 transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">Asset Allocation</span>
            </div>
            <span className="text-2xl font-bold text-foreground">
              {hasAnalytics ? formatUsd(displayData.totalValue) : "—"}
            </span>
          </div>

          <div className="space-y-1">
            {displayData.assets.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No portfolio data</div>
            ) : (
              displayData.assets.map((asset) => <AssetRow key={asset.symbol} asset={asset} />)
            )}
          </div>
        </div>
      </div>

      <PortfolioDetailsModal
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        hasAnalytics={hasAnalytics}
        displayData={displayData}
        bestPerformer={bestPerformer}
        isPositive={isPositive}
        pnlSign={pnlSign}
        txSummary={txSummary}
        transactions={transactions}
      />
    </section>
  )
}
