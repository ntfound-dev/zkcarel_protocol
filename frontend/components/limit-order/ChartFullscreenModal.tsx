"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CandlestickChart } from "@/components/limit-order/candlestick-chart"

type ChartFullscreenModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tokenIcon: string
  tokenSymbol: string
  chartCandles: Array<{
    timestamp: number
    open: number
    high: number
    low: number
    close: number
  }>
  chartPeriod: string
  onChartPeriodChange: (value: string) => void
}

export function ChartFullscreenModal({
  open,
  onOpenChange,
  tokenIcon,
  tokenSymbol,
  chartCandles,
  chartPeriod,
  onChartPeriodChange,
}: ChartFullscreenModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl glass-strong border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-xl">{tokenIcon}</span>
            {tokenSymbol}/USD
          </DialogTitle>
        </DialogHeader>
        <div className="h-96 rounded-xl bg-surface/30 relative overflow-hidden">
          <CandlestickChart
            candles={chartCandles}
            viewBoxHeight={300}
            gradientId="chartGradientFull"
          />
          {chartCandles.length <= 1 && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              No price data
            </div>
          )}
        </div>
        <div className="flex justify-center gap-2">
          {["5M", "15M", "1H", "24H", "7D", "30D", "1Y"].map((period) => (
            <button
              key={period}
              onClick={() => onChartPeriodChange(period)}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                chartPeriod === period
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface"
              )}
            >
              {period}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
