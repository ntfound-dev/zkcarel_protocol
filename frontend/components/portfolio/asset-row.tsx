import { TrendingDown, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  formatPercent,
  formatTokenAmount,
  formatUsd,
  type PortfolioAsset,
} from "@/lib/portfolio-utils"

/**
 * Handles `AssetRow` logic.
 *
 * @param asset - Input used by `AssetRow` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function AssetRow({ asset }: { asset: PortfolioAsset }) {
  const isPositive = asset.change >= 0
  const amount = "amount" in asset ? Number(asset.amount ?? 0) : 0

  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0 hover:bg-primary/5 px-2 -mx-2 rounded-lg transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-full bg-surface flex items-center justify-center text-xl border border-border">
          {asset.icon}
        </div>
        <div className="min-w-0">
          <p className="font-medium text-foreground truncate">{asset.symbol}</p>
          <p className="text-xs text-muted-foreground truncate">{asset.name}</p>
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
          <p className="text-xs text-muted-foreground mt-1 text-center">
            {formatPercent(asset.percent)}
          </p>
        </div>
        <div className="text-right min-w-[110px] shrink-0">
          <p className="text-xs text-muted-foreground">
            {formatTokenAmount(amount)} {asset.symbol}
          </p>
          <p className="font-medium text-foreground break-words">{formatUsd(asset.value)}</p>
          <p
            className={cn(
              "text-xs flex items-center justify-end gap-1",
              isPositive ? "text-success" : "text-destructive"
            )}
          >
            {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {isPositive ? "+" : ""}
            {formatPercent(asset.change)}
          </p>
        </div>
      </div>
    </div>
  )
}
