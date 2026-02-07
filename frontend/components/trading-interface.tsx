"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { 
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { 
  ArrowDownUp, ChevronDown, Clock, Zap, Shield, Settings2, Check, Loader2, X, 
  Eye, EyeOff, ChevronUp, Info, Gift, Sparkles
} from "lucide-react"

const tokens = [
  { symbol: "BTC", name: "Bitcoin", icon: "₿", balance: 2.5, price: 65000, network: "Bitcoin" },
  { symbol: "ETH", name: "Ethereum", icon: "Ξ", balance: 15.2, price: 2000, network: "Ethereum" },
  { symbol: "STRK", name: "StarkNet", icon: "◈", balance: 5000, price: 1.25, network: "StarkNet" },
  { symbol: "CAREL", name: "ZkCarel", icon: "◇", balance: 245, price: 0.85, network: "StarkNet" },
  { symbol: "USDC", name: "USD Coin", icon: "$", balance: 10000, price: 1.0, network: "Ethereum" },
  { symbol: "USDT", name: "Tether", icon: "₮", balance: 5000, price: 1.0, network: "Ethereum" },
  { symbol: "WBTC", name: "Wrapped BTC", icon: "₿", balance: 0.5, price: 64950, network: "Ethereum" },
]

const slippagePresets = ["0.1", "0.3", "0.5", "1.0"]

interface TokenSelectorProps {
  selectedToken: typeof tokens[0]
  onSelect: (token: typeof tokens[0]) => void
  label: string
  amount: string
  onAmountChange: (value: string) => void
  readOnly?: boolean
  hideBalance?: boolean
}

function TokenSelector({ selectedToken, onSelect, label, amount, onAmountChange, readOnly, hideBalance }: TokenSelectorProps) {
  const usdValue = Number.parseFloat(amount || "0") * selectedToken.price
  
  return (
    <div className="p-4 rounded-xl glass border border-border hover:border-primary/50 transition-all duration-300">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">
          Balance: {hideBalance ? "••••••" : `${selectedToken.balance.toLocaleString()} ${selectedToken.symbol}`}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="outline" 
              className="gap-2 border-primary/30 hover:border-primary/60 bg-surface/50 text-foreground"
            >
              <span className="text-xl">{selectedToken.icon}</span>
              <div className="text-left">
                <span className="font-bold block">{selectedToken.symbol}</span>
                <span className="text-[10px] text-muted-foreground">{selectedToken.network}</span>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56 glass-strong border-border">
            {tokens.map((token) => (
              <DropdownMenuItem
                key={token.symbol}
                onClick={() => onSelect(token)}
                className={cn(
                  "flex items-center gap-3 cursor-pointer",
                  token.symbol === selectedToken.symbol && "bg-primary/20"
                )}
              >
                <span className="text-lg">{token.icon}</span>
                <div className="flex flex-col flex-1">
                  <span className="font-medium text-foreground">{token.symbol}</span>
                  <span className="text-xs text-muted-foreground">{token.name} ({token.network})</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {hideBalance ? "••••" : token.balance.toLocaleString()}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex-1 text-right">
          <input
            type="text"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
            readOnly={readOnly}
            placeholder="0.0"
            className={cn(
              "w-full bg-transparent text-right text-2xl font-bold text-foreground outline-none placeholder:text-muted-foreground/50",
              readOnly && "cursor-default"
            )}
          />
          <p className="text-sm text-muted-foreground mt-1">
            ≈ ${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>
      {!readOnly && (
        <div className="flex gap-2 mt-3">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              onClick={() => onAmountChange(String((selectedToken.balance * pct / 100).toFixed(6)))}
              className="flex-1 py-1 text-xs font-medium text-muted-foreground hover:text-primary border border-border hover:border-primary/50 rounded-md transition-colors"
            >
              {pct}%
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SimpleRouteVisualization({ fromToken, toToken, isCrossChain }: { fromToken: typeof tokens[0], toToken: typeof tokens[0], isCrossChain: boolean }) {
  return (
    <div className="flex items-center justify-center gap-2 py-3 text-sm">
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/30">
        <span>{fromToken.icon}</span>
        <span className="font-medium text-foreground">{fromToken.symbol}</span>
        <span className="text-[10px] text-muted-foreground">({fromToken.network})</span>
      </div>
      <div className="flex items-center gap-1 text-muted-foreground">
        <span className="text-xs">{isCrossChain ? "Bridge" : "Swap"}</span>
        <span>→</span>
      </div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/10 border border-secondary/30">
        <span>{toToken.icon}</span>
        <span className="font-medium text-foreground">{toToken.symbol}</span>
        <span className="text-[10px] text-muted-foreground">({toToken.network})</span>
      </div>
    </div>
  )
}

export function TradingInterface() {
  const [fromToken, setFromToken] = React.useState(tokens[0])
  const [toToken, setToToken] = React.useState(tokens[1])
  const [fromAmount, setFromAmount] = React.useState("1.0")
  const [toAmount, setToAmount] = React.useState("")
  const [swapState, setSwapState] = React.useState<"idle" | "confirming" | "processing" | "success" | "error">("idle")
  const [previewOpen, setPreviewOpen] = React.useState(false)
  
  // Privacy mode - ONLY for hiding balance in this module
  const [balanceHidden, setBalanceHidden] = React.useState(false)
  
  // Settings state
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [mevProtection, setMevProtection] = React.useState(true)
  const [slippage, setSlippage] = React.useState("0.5")
  const [customSlippage, setCustomSlippage] = React.useState("")
  const [receiveAddress, setReceiveAddress] = React.useState("0x8f...4e2d (Your Wallet)")
  
  // NFT Discount simulation
  const hasNFTDiscount = true
  const nftDiscountUsesRemaining = 5
  const nftDiscountTotal = 10
  const baseFeePercent = 0.3
  const discountedFeePercent = hasNFTDiscount ? 0.15 : baseFeePercent

  // Detect cross-chain
  const isCrossChain = fromToken.network !== toToken.network

  React.useEffect(() => {
    if (fromAmount && fromToken && toToken) {
      const fromValue = Number.parseFloat(fromAmount) * fromToken.price
      const toValue = fromValue / toToken.price
      setToAmount(toValue.toFixed(6))
    }
  }, [fromAmount, fromToken, toToken])

  const handleSwapTokens = () => {
    const tempToken = fromToken
    const tempAmount = fromAmount
    setFromToken(toToken)
    setToToken(tempToken)
    setFromAmount(toAmount)
    setToAmount(tempAmount)
  }

  // Calculate trade details
  const fromValueUSD = Number.parseFloat(fromAmount || "0") * fromToken.price
  const toValueUSD = Number.parseFloat(toAmount || "0") * toToken.price
  const transactionFee = fromValueUSD * (discountedFeePercent / 100)
  const pointsEarned = Math.floor(fromValueUSD * 10) // 10 points per $1 volume
  const estimatedTime = isCrossChain ? "~3-5 min" : "~30 sec"
  
  // Price Impact calculation
  const expectedAmount = fromValueUSD / toToken.price
  const actualAmount = Number.parseFloat(toAmount || "0")
  const priceImpact = expectedAmount > 0 ? Math.abs((actualAmount - expectedAmount) / expectedAmount * 100) : 0

  const activeSlippage = customSlippage || slippage

  const handleExecuteTrade = () => {
    if (!fromAmount || Number.parseFloat(fromAmount) === 0) return
    setPreviewOpen(true)
  }

  const confirmTrade = async () => {
    setPreviewOpen(false)
    setSwapState("confirming")
    
    // Simulate confirmation delay
    await new Promise(r => setTimeout(r, 1000))
    setSwapState("processing")
    
    // Simulate transaction processing
    await new Promise(r => setTimeout(r, 2500))
    
    // Random success/fail for demo (90% success rate)
    if (Math.random() > 0.1) {
      setSwapState("success")
    } else {
      setSwapState("error")
    }
    
    // Reset after showing result
    setTimeout(() => {
      setSwapState("idle")
    }, 3000)
  }

  return (
    <div className="w-full max-w-xl mx-auto">
      <div className="p-6 rounded-2xl glass-strong border border-border neon-border">
        {/* Header with Privacy Toggle */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-foreground">Unified Trade</h2>
          <div className="flex items-center gap-2">
            {/* Privacy Mode - Eye Icon to hide/show balance */}
            <button 
              onClick={() => setBalanceHidden(!balanceHidden)}
              className="p-2 rounded-lg hover:bg-surface/50 transition-colors group"
              title={balanceHidden ? "Show balances" : "Hide balances"}
            >
              {balanceHidden ? (
                <EyeOff className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
              ) : (
                <Eye className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
              )}
            </button>
          </div>
        </div>

        {/* Token Selectors */}
        <div className="space-y-2">
          <TokenSelector
            selectedToken={fromToken}
            onSelect={setFromToken}
            label="From"
            amount={fromAmount}
            onAmountChange={setFromAmount}
            hideBalance={balanceHidden}
          />

          <div className="flex justify-center -my-2 relative z-10">
            <button
              onClick={handleSwapTokens}
              className="p-2 rounded-full bg-surface border border-border hover:border-primary hover:bg-primary/10 transition-all duration-300 group"
            >
              <ArrowDownUp className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </button>
          </div>

          <TokenSelector
            selectedToken={toToken}
            onSelect={setToToken}
            label="To"
            amount={toAmount}
            onAmountChange={setToAmount}
            readOnly
            hideBalance={balanceHidden}
          />
        </div>

        {/* Simplified Route Display */}
        <div className="mt-4 p-3 rounded-xl bg-surface/30 border border-border/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Zap className="h-3 w-3 text-secondary" />
              Best Route via {isCrossChain ? "StarkGate Bridge" : "AVNU"}
            </span>
            <span className="text-xs text-success">Auto-selected</span>
          </div>
          <SimpleRouteVisualization fromToken={fromToken} toToken={toToken} isCrossChain={isCrossChain} />
        </div>

        {/* Settings Panel - Collapsible */}
        <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen} className="mt-4">
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between p-3 rounded-xl bg-surface/30 border border-border/50 hover:border-primary/30 transition-colors">
              <span className="text-sm font-medium text-foreground flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Trade Settings
              </span>
              {settingsOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-4 p-4 rounded-xl bg-surface/20 border border-border/30">
            {/* MEV Protection */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                <span className="text-sm text-foreground">MEV Protection</span>
              </div>
              <button 
                onClick={() => setMevProtection(!mevProtection)}
                className={cn(
                  "w-11 h-6 rounded-full transition-colors relative",
                  mevProtection ? "bg-primary" : "bg-muted"
                )}
              >
                <span className={cn(
                  "absolute top-1 w-4 h-4 rounded-full bg-background transition-transform",
                  mevProtection ? "left-6" : "left-1"
                )} />
              </button>
            </div>

            {/* Slippage Tolerance */}
            <div>
              <label className="text-sm text-foreground mb-2 block">Slippage Tolerance</label>
              <div className="flex gap-2">
                {slippagePresets.map((val) => (
                  <button
                    key={val}
                    onClick={() => { setSlippage(val); setCustomSlippage(""); }}
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
                    onChange={(e) => setCustomSlippage(e.target.value)}
                    placeholder="Auto"
                    className="w-full py-2 px-2 rounded-lg text-xs font-medium bg-surface text-foreground border border-border focus:border-primary outline-none text-center"
                  />
                  {customSlippage && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span>}
                </div>
              </div>
            </div>

            {/* Estimated Amount Received */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface/50">
              <span className="text-sm text-muted-foreground">Estimated Received</span>
              <span className="text-sm font-medium text-foreground">
                {toAmount ? `${Number.parseFloat(toAmount).toFixed(4)} ${toToken.symbol}` : "—"}
              </span>
            </div>

            {/* Receive Address */}
            <div>
              <label className="text-sm text-foreground mb-2 block">Receive Address</label>
              <input
                type="text"
                value={receiveAddress}
                onChange={(e) => setReceiveAddress(e.target.value)}
                className="w-full py-2 px-3 rounded-lg text-sm bg-surface text-foreground border border-border focus:border-primary outline-none"
              />
            </div>

            {/* Transaction Fee Breakdown */}
            <div className="space-y-2 p-3 rounded-lg bg-surface/50">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Base Fee</span>
                <span className="text-sm text-foreground">{baseFeePercent}%</span>
              </div>
              {hasNFTDiscount && (
                <div className="flex items-center justify-between text-success">
                  <span className="text-sm flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    NFT Discount
                  </span>
                  <span className="text-sm">-50%</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-border pt-2">
                <span className="text-sm font-medium text-foreground">Final Fee</span>
                <span className="text-sm font-medium text-foreground">
                  ${transactionFee.toFixed(2)} ({discountedFeePercent}%)
                </span>
              </div>
            </div>

            {/* Points Earned */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-accent/10 border border-accent/20">
              <span className="text-sm text-foreground flex items-center gap-2">
                <Gift className="h-4 w-4 text-accent" />
                Points Earned
              </span>
              <span className="text-sm font-bold text-accent">+{pointsEarned}</span>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* NFT Discount Counter */}
        {hasNFTDiscount && (
          <div className="mt-4 p-3 rounded-xl bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                NFT Discount Active
              </span>
              <span className="text-xs text-muted-foreground">
                {nftDiscountUsesRemaining}/{nftDiscountTotal} uses remaining
              </span>
            </div>
          </div>
        )}

        {/* Quick Info */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-surface/30 text-center">
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <Clock className="h-3 w-3" /> Est. Time
            </p>
            <p className="text-sm font-medium text-foreground">{estimatedTime}</p>
          </div>
          <div className="p-3 rounded-lg bg-surface/30 text-center">
            <p className="text-xs text-muted-foreground">Fee</p>
            <p className="text-sm font-medium text-foreground">${transactionFee.toFixed(2)}</p>
          </div>
          <div className="p-3 rounded-lg bg-surface/30 text-center">
            <p className="text-xs text-muted-foreground">Impact</p>
            <p className={cn(
              "text-sm font-medium",
              priceImpact > 1 ? "text-destructive" : "text-success"
            )}>
              {priceImpact.toFixed(2)}%
            </p>
          </div>
        </div>

        {/* Price Impact Warning */}
        {priceImpact > 1 && (
          <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-xs text-foreground">
                Price impact is higher than 1%. Consider reducing your trade size or splitting into multiple transactions.
              </p>
            </div>
          </div>
        )}

        {/* Execute Button */}
        <Button 
          onClick={handleExecuteTrade}
          disabled={swapState !== "idle" || !fromAmount || Number.parseFloat(fromAmount) === 0}
          className={cn(
            "w-full mt-6 py-6 text-lg font-bold transition-all text-primary-foreground",
            swapState === "idle" && "bg-gradient-to-r from-primary via-accent to-primary bg-[length:200%_100%] animate-gradient hover:opacity-90",
            swapState === "confirming" && "bg-primary/80",
            swapState === "processing" && "bg-secondary/80",
            swapState === "success" && "bg-success",
            swapState === "error" && "bg-destructive"
          )}
        >
          {swapState === "idle" && "Execute Trade"}
          {swapState === "confirming" && (
            <span className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Confirming...
            </span>
          )}
          {swapState === "processing" && (
            <span className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Processing {isCrossChain ? "Bridge" : "Swap"}...
            </span>
          )}
          {swapState === "success" && (
            <span className="flex items-center gap-2">
              <Check className="h-5 w-5" />
              {isCrossChain ? "Bridge" : "Swap"} Successful!
            </span>
          )}
          {swapState === "error" && (
            <span className="flex items-center gap-2">
              <X className="h-5 w-5" />
              Transaction Failed
            </span>
          )}
        </Button>

        <p className="text-center text-xs text-muted-foreground mt-4">
          By trading, you agree to our Terms of Service
        </p>
      </div>

      {/* Preview/Confirmation Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="glass-strong border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Confirm Trade</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Trade Summary */}
            <div className="p-4 rounded-xl bg-surface/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">You Pay</span>
                <span className="font-medium text-foreground">
                  {fromAmount} {fromToken.symbol}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">You Receive</span>
                <span className="font-medium text-foreground">
                  {Number.parseFloat(toAmount).toFixed(4)} {toToken.symbol}
                </span>
              </div>
              <div className="border-t border-border pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Route</span>
                  <span className="text-sm text-foreground">{isCrossChain ? "Bridge" : "Swap"} via {isCrossChain ? "StarkGate" : "AVNU"}</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-muted-foreground">Slippage</span>
                  <span className="text-sm text-foreground">{activeSlippage}%</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-muted-foreground">MEV Protection</span>
                  <span className="text-sm text-foreground">{mevProtection ? "Enabled" : "Disabled"}</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-muted-foreground">Fee</span>
                  <span className="text-sm text-foreground">${transactionFee.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-muted-foreground">Est. Time</span>
                  <span className="text-sm text-foreground">{estimatedTime}</span>
                </div>
              </div>
            </div>

            {/* Points */}
            <div className="p-3 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-between">
              <span className="text-sm text-foreground">Points Earned</span>
              <span className="font-bold text-accent">+{pointsEarned}</span>
            </div>

            {/* Receive Address */}
            <div className="p-3 rounded-lg bg-surface/50">
              <p className="text-xs text-muted-foreground mb-1">Receive Address</p>
              <p className="text-sm font-mono text-foreground truncate">{receiveAddress}</p>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 bg-transparent"
                onClick={() => setPreviewOpen(false)}
              >
                Cancel
              </Button>
              <Button 
                className="flex-1 bg-gradient-to-r from-primary to-accent hover:opacity-90 text-primary-foreground"
                onClick={confirmTrade}
              >
                Confirm & Sign
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
