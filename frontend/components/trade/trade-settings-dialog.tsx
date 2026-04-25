"use client"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { formatMultiplier, sanitizeDecimalInput } from "@/lib/trading-utils"
import { Gift, Settings2, Shield, Sparkles } from "lucide-react"

type TradeSettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: string
  mevProtection: boolean
  onToggleMevProtection: () => void
  slippagePresets: string[]
  slippage: string
  customSlippage: string
  setSlippage: (value: string) => void
  setCustomSlippage: (value: string) => void
  toAmount: string
  toSymbol: string
  receiveAddress: string
  onReceiveAddressChange: (value: string) => void
  quoteType: "swap" | "bridge" | null
  bridgeProtocolFeeLabel: string
  protocolFeeDisplay: string
  bridgeNetworkFeeLabel: string
  networkFeeDisplay: string
  mevFeePercent: string
  mevFeeDisplay: string
  feeDisplayLabel: string
  hasNftDiscount: boolean
  discountPercent: number
  feeSavingsUsd: number
  basePointsEarned: number | null
  normalizedStakeMultiplier: number
  nftPointsMultiplier: number
  hideBalanceOnchain: boolean
  hideUsdtTierBonusPercent: number
  pointsEarned: number | null
}

export function TradeSettingsDialog({
  open,
  onOpenChange,
  mode,
  mevProtection,
  onToggleMevProtection,
  slippagePresets,
  slippage,
  customSlippage,
  setSlippage,
  setCustomSlippage,
  toAmount,
  toSymbol,
  receiveAddress,
  onReceiveAddressChange,
  quoteType,
  bridgeProtocolFeeLabel,
  protocolFeeDisplay,
  bridgeNetworkFeeLabel,
  networkFeeDisplay,
  mevFeePercent,
  mevFeeDisplay,
  feeDisplayLabel,
  hasNftDiscount,
  discountPercent,
  feeSavingsUsd,
  basePointsEarned,
  normalizedStakeMultiplier,
  nftPointsMultiplier,
  hideBalanceOnchain,
  hideUsdtTierBonusPercent,
  pointsEarned,
}: TradeSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl glass-strong border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Trade Settings
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <span className="text-sm text-foreground">MEV Protection</span>
            </div>
            <button
              onClick={onToggleMevProtection}
              disabled={mode !== "private"}
              className={cn(
                "w-11 h-6 rounded-full transition-colors relative",
                mode !== "private" && "opacity-50 cursor-not-allowed",
                mevProtection ? "bg-primary" : "bg-muted"
              )}
            >
              <span
                className={cn(
                  "absolute top-1 w-4 h-4 rounded-full bg-background transition-transform",
                  mevProtection ? "left-6" : "left-1"
                )}
              />
            </button>
          </div>
          {mode !== "private" && (
            <p className="text-xs text-muted-foreground">
              Aktif hanya di Private Mode. Saat mode biasa, selalu Disabled.
            </p>
          )}

          <div>
            <label className="text-sm text-foreground mb-2 block">Slippage Tolerance</label>
            <div className="flex gap-2">
              {slippagePresets.map((val) => (
                <button
                  key={val}
                  onClick={() => {
                    setSlippage(val)
                    setCustomSlippage("")
                  }}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-xs font-medium transition-all",
                    slippage === val && !customSlippage
                      ? "bg-primary/20 text-primary border border-primary"
                      : "bg-surface text-muted-foreground border border-border hover:border-primary/50"
                  )}
                >
                  {val}%
                </button>
              ))}
              <div className="relative flex-1">
                <input
                  type="text"
                  value={customSlippage}
                  inputMode="decimal"
                  onChange={(e) => {
                    const sanitized = sanitizeDecimalInput(e.target.value, 2)
                    if (!sanitized) {
                      setCustomSlippage("")
                      return
                    }
                    const parsed = Number(sanitized)
                    if (!Number.isFinite(parsed)) return
                    setCustomSlippage(String(Math.min(parsed, 50)))
                  }}
                  placeholder="Auto"
                  className="w-full py-2 px-2 rounded-lg text-xs font-medium bg-surface text-foreground border border-border focus:border-primary outline-none text-center"
                />
                {customSlippage && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
                    %
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-surface/50">
            <span className="text-sm text-muted-foreground">Estimated Received</span>
            <span className="text-sm font-medium text-foreground">
              {toAmount ? `${Number.parseFloat(toAmount).toFixed(4)} ${toSymbol}` : "—"}
            </span>
          </div>

          <div>
            <label className="text-sm text-foreground mb-2 block">Receive Address</label>
            <input
              type="text"
              value={receiveAddress}
              onChange={(e) => onReceiveAddressChange(e.target.value)}
              className="w-full py-2 px-3 rounded-lg text-sm bg-surface text-foreground border border-border focus:border-primary outline-none"
            />
          </div>

          <div className="space-y-2 p-3 rounded-lg bg-surface/50">
            {quoteType === "bridge" ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{bridgeProtocolFeeLabel}</span>
                  <span className="text-sm text-foreground">{protocolFeeDisplay}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{bridgeNetworkFeeLabel}</span>
                  <span className="text-sm text-foreground">{networkFeeDisplay}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">MEV Fee ({mevFeePercent}%)</span>
                  <span className="text-sm text-foreground">{mevFeeDisplay}</span>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-2">
                  <span className="text-sm font-medium text-foreground">Total Fee</span>
                  <span className="text-sm font-medium text-foreground">{feeDisplayLabel}</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Protocol Fee</span>
                  <span className="text-sm text-foreground">{protocolFeeDisplay}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">MEV Fee ({mevFeePercent}%)</span>
                  <span className="text-sm text-foreground">{mevFeeDisplay}</span>
                </div>
                {hasNftDiscount && (
                  <div className="flex items-center justify-between text-success">
                    <span className="text-sm flex items-center gap-1">
                      <Sparkles className="h-3 w-3" />
                      NFT Discount
                    </span>
                    <span className="text-sm">-{discountPercent}%</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-border pt-2">
                  <span className="text-sm font-medium text-foreground">Total Fee</span>
                  <span className="text-sm font-medium text-foreground">{feeDisplayLabel}</span>
                </div>
                {hasNftDiscount && feeSavingsUsd > 0 && (
                  <div className="flex items-center justify-between text-success">
                    <span className="text-xs">Fee saved (NFT)</span>
                    <span className="text-xs">-${feeSavingsUsd.toFixed(2)}</span>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-accent/10 border border-accent/20">
            <div>
              <span className="text-sm text-foreground flex items-center gap-2">
                <Gift className="h-4 w-4 text-accent" />
                Estimated Points
              </span>
              {basePointsEarned !== null && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Base +{basePointsEarned}
                  {normalizedStakeMultiplier > 1
                    ? ` × Stake ${formatMultiplier(normalizedStakeMultiplier)}`
                    : ""}
                  {nftPointsMultiplier > 1 ? ` × NFT ${formatMultiplier(nftPointsMultiplier)}` : ""}
                  {hideBalanceOnchain && hideUsdtTierBonusPercent > 0
                    ? ` × HideTier +${hideUsdtTierBonusPercent.toFixed(0)}%`
                    : ""}
                </p>
              )}
            </div>
            <span className="text-sm font-bold text-accent">
              {pointsEarned === null ? "—" : `+${pointsEarned}`}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
