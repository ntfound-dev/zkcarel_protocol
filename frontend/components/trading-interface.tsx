"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useNotifications } from "@/hooks/use-notifications"
import { useWallet } from "@/hooks/use-wallet"
import { useLivePrices } from "@/hooks/use-live-prices"
import { executeBridge, executeSwap, getBridgeQuote, getOwnedNfts, getPortfolioBalance, getSwapQuote, type NFTItem } from "@/lib/api"
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

type QuoteState = {
  type: "swap" | "bridge"
  toAmount: string
  fee: number
  estimatedTime: string
  priceImpact?: string
  provider?: string
  bridgeSourceAmount?: number
  bridgeConvertedAmount?: number
}

const tokenCatalog = [
  { symbol: "BTC", name: "Bitcoin", icon: "₿", price: 0, network: "Bitcoin Testnet" },
  { symbol: "ETH", name: "Ethereum", icon: "Ξ", price: 0, network: "Ethereum Sepolia" },
  { symbol: "STRK", name: "StarkNet", icon: "◈", price: 0, network: "Starknet Sepolia" },
  { symbol: "CAREL", name: "ZkCarel", icon: "◇", price: 0, network: "Starknet Sepolia" },
  { symbol: "USDC", name: "USD Coin", icon: "$", price: 0, network: "Ethereum Sepolia" },
  { symbol: "USDT", name: "Tether", icon: "₮", price: 0, network: "Ethereum Sepolia" },
  { symbol: "WBTC", name: "Wrapped BTC", icon: "₿", price: 0, network: "Ethereum Sepolia" },
]

const slippagePresets = ["0.1", "0.3", "0.5", "1.0"]

const chainFromNetwork = (network: string) => {
  const key = network.toLowerCase()
  if (key.includes("bitcoin")) return "bitcoin"
  if (key.includes("ethereum")) return "ethereum"
  if (key.includes("starknet")) return "starknet"
  return key
}

const convertAmountByUsdPrice = (
  amount: number,
  fromPrice: number,
  toPrice: number
): number | null => {
  if (!Number.isFinite(amount) || amount <= 0) return null
  if (!Number.isFinite(fromPrice) || fromPrice <= 0) return null
  if (!Number.isFinite(toPrice) || toPrice <= 0) return null
  return (amount * fromPrice) / toPrice
}

const formatTokenAmount = (value: number, maxFractionDigits = 8) => {
  if (!Number.isFinite(value)) return "—"
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  })
}

interface TokenSelectorProps {
  selectedToken: TokenWithBalance
  onSelect: (token: TokenWithBalance) => void
  tokens: TokenWithBalance[]
  label: string
  amount: string
  onAmountChange: (value: string) => void
  readOnly?: boolean
  hideBalance?: boolean
}

type TokenWithBalance = (typeof tokenCatalog)[number] & { balance: number }

function TokenSelector({ selectedToken, onSelect, tokens, label, amount, onAmountChange, readOnly, hideBalance }: TokenSelectorProps) {
  const hasPrice = selectedToken.price > 0
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
            ≈ {hasPrice
              ? `$${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : "—"}
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

function SimpleRouteVisualization({ fromToken, toToken, isCrossChain }: { fromToken: TokenWithBalance, toToken: TokenWithBalance, isCrossChain: boolean }) {
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

function defaultReceiveAddressForNetwork(
  networkLabel: string,
  addresses: {
    starknet?: string | null
    evm?: string | null
    btc?: string | null
    fallback?: string | null
  }
) {
  const chain = chainFromNetwork(networkLabel)
  if (chain === "bitcoin") return addresses.btc || ""
  if (chain === "ethereum") return addresses.evm || addresses.fallback || ""
  return addresses.starknet || addresses.fallback || ""
}

export function TradingInterface() {
  const wallet = useWallet()
  const notifications = useNotifications()
  const [seedPrices, setSeedPrices] = React.useState<Record<string, number>>({})
  const { prices: livePrices, sources: priceSources, status: priceStatus } = useLivePrices(
    React.useMemo(() => tokenCatalog.map((token) => token.symbol), []),
    {
      seedPrices,
      fallbackPrices: { CAREL: 1, USDC: 1, USDT: 1 },
    }
  )

  const resolveTokenBalance = React.useCallback(
    (token: { symbol: string; network: string }) => {
      const symbol = token.symbol.toUpperCase()
      const chain = chainFromNetwork(token.network)
      const backendBalance = wallet.balance[symbol] ?? 0

      if (symbol === "ETH" && chain === "ethereum" && wallet.evmAddress) {
        return wallet.onchainBalance.ETH ?? backendBalance
      }
      if (symbol === "STRK" && chain === "starknet" && wallet.starknetAddress) {
        return wallet.onchainBalance.STRK_L2 ?? backendBalance
      }
      if (symbol === "BTC" && chain === "bitcoin" && wallet.btcAddress) {
        return wallet.onchainBalance.BTC ?? backendBalance
      }
      return backendBalance
    },
    [
      wallet.balance,
      wallet.btcAddress,
      wallet.evmAddress,
      wallet.onchainBalance.BTC,
      wallet.onchainBalance.ETH,
      wallet.onchainBalance.STRK_L2,
      wallet.starknetAddress,
    ]
  )

  const tokens = React.useMemo<TokenWithBalance[]>(() => {
    return tokenCatalog.map((token) => ({
      ...token,
      balance: resolveTokenBalance(token),
      price: livePrices[token.symbol] ?? token.price,
    }))
  }, [resolveTokenBalance, livePrices])

  const [fromToken, setFromToken] = React.useState<TokenWithBalance>(
    tokens.find((token) => token.symbol === "ETH") || tokens[0]
  )
  const [toToken, setToToken] = React.useState<TokenWithBalance>(
    tokens.find((token) => token.symbol === "STRK") || tokens[1]
  )
  const [fromAmount, setFromAmount] = React.useState("1.0")
  const [toAmount, setToAmount] = React.useState("")
  const [swapState, setSwapState] = React.useState<"idle" | "confirming" | "processing" | "success" | "error">("idle")
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [quote, setQuote] = React.useState<QuoteState | null>(null)
  const [isQuoteLoading, setIsQuoteLoading] = React.useState(false)
  const [quoteError, setQuoteError] = React.useState<string | null>(null)
  const [activeNft, setActiveNft] = React.useState<NFTItem | null>(null)
  
  // Privacy mode - ONLY for hiding balance in this module
  const [balanceHidden, setBalanceHidden] = React.useState(false)
  
  // Settings state
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [mevProtection, setMevProtection] = React.useState(true)
  const [slippage, setSlippage] = React.useState("0.5")
  const [customSlippage, setCustomSlippage] = React.useState("")
  const [receiveAddress, setReceiveAddress] = React.useState("")
  const [isReceiveAddressManual, setIsReceiveAddressManual] = React.useState(false)
  const [xverseUserId, setXverseUserId] = React.useState("")

  const formatSource = (source?: string) => {
    switch (source) {
      case "ws":
        return { label: "Live", className: "bg-success/20 text-success" }
      case "coingecko":
        return { label: "CoinGecko", className: "bg-primary/20 text-primary" }
      default:
        return { label: "Fallback", className: "bg-muted text-muted-foreground" }
    }
  }

  const fromSource = formatSource(priceSources[fromToken.symbol])
  const toSource = formatSource(priceSources[toToken.symbol])
  
  const baseFeePercent = 0.3
  const discountPercent = activeNft ? activeNft.discount : 0
  const discountedFeePercent = baseFeePercent * (1 - Math.min(Math.max(discountPercent, 0), 100) / 100)
  const hasNftDiscount = Boolean(activeNft)

  // Detect cross-chain
  const isCrossChain = fromToken.network !== toToken.network

  const preferredReceiveAddress = React.useMemo(
    () =>
      defaultReceiveAddressForNetwork(toToken.network, {
        starknet: wallet.starknetAddress,
        evm: wallet.evmAddress,
        btc: wallet.btcAddress,
        fallback: wallet.address,
      }),
    [toToken.network, wallet.address, wallet.starknetAddress, wallet.evmAddress, wallet.btcAddress]
  )

  React.useEffect(() => {
    setIsReceiveAddressManual(false)
  }, [toToken.network])

  React.useEffect(() => {
    if (isReceiveAddressManual) return
    setReceiveAddress(preferredReceiveAddress)
  }, [preferredReceiveAddress, isReceiveAddressManual])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const stored = window.sessionStorage.getItem("xverse_user_id") || ""
    if (stored) {
      setXverseUserId(stored)
    }
  }, [])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    if (xverseUserId) {
      window.sessionStorage.setItem("xverse_user_id", xverseUserId)
    }
  }, [xverseUserId])

  React.useEffect(() => {
    let active = true
    if (!wallet.isConnected) return
    ;(async () => {
      try {
        const response = await getPortfolioBalance()
        if (!active) return
        const updated: Record<string, number> = {}
        response.balances.forEach((item) => {
          const price = item.amount > 0 ? item.value_usd / item.amount : item.price
          updated[item.token.toUpperCase()] = price
        })
        setSeedPrices(updated)
      } catch {
        // keep existing prices
      }
    })()

    return () => {
      active = false
    }
  }, [wallet.isConnected])

  React.useEffect(() => {
    if (wallet.isConnected) return
    setSeedPrices({})
  }, [wallet.isConnected])

  React.useEffect(() => {
    let active = true
    if (!wallet.isConnected) {
      setActiveNft(null)
      return
    }
    ;(async () => {
      try {
        const nfts = await getOwnedNfts()
        if (!active) return
        const now = Math.floor(Date.now() / 1000)
        const usable = nfts.find((nft) => !nft.used && (!nft.expiry || nft.expiry > now))
        setActiveNft(usable || null)
      } catch {
        if (!active) return
        setActiveNft(null)
      }
    })()

    return () => {
      active = false
    }
  }, [wallet.isConnected])

  React.useEffect(() => {
    const fallbackFrom = tokens.find((token) => token.symbol === "ETH") || tokens[0]
    const fallbackTo = tokens.find((token) => token.symbol === "STRK") || tokens[1] || tokens[0]
    const nextFrom = tokens.find((token) => token.symbol === fromToken.symbol) || fallbackFrom
    const nextTo = tokens.find((token) => token.symbol === toToken.symbol) || fallbackTo
    setFromToken(nextFrom)
    setToToken(nextTo)
  }, [tokens])

  React.useEffect(() => {
    const amountValue = Number.parseFloat(fromAmount || "0")
    if (!amountValue || amountValue <= 0) {
      setToAmount("")
      setQuote(null)
      setQuoteError(null)
      return
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      setIsQuoteLoading(true)
      setQuoteError(null)

      try {
        if (isCrossChain) {
          const response = await getBridgeQuote({
            from_chain: chainFromNetwork(fromToken.network),
            to_chain: chainFromNetwork(toToken.network),
            token: fromToken.symbol,
            amount: fromAmount,
          })
          if (cancelled) return
          const estimatedReceiveRaw = Number(response.estimated_receive || 0)
          const bridgeConvertedAmount =
            fromToken.symbol !== toToken.symbol
              ? convertAmountByUsdPrice(estimatedReceiveRaw, fromToken.price, toToken.price)
              : null
          const displayToAmount = Number.isFinite(bridgeConvertedAmount ?? NaN)
            ? String(bridgeConvertedAmount)
            : response.estimated_receive
          setToAmount(displayToAmount)
          setQuote({
            type: "bridge",
            toAmount: displayToAmount,
            fee: Number(response.fee || 0),
            estimatedTime: response.estimated_time,
            provider: response.bridge_provider,
            bridgeSourceAmount: estimatedReceiveRaw,
            bridgeConvertedAmount: bridgeConvertedAmount ?? undefined,
          })
        } else {
          const response = await getSwapQuote({
            from_token: fromToken.symbol,
            to_token: toToken.symbol,
            amount: fromAmount,
            slippage: Number(customSlippage || slippage),
            mode: mevProtection ? "private" : "transparent",
          })
          if (cancelled) return
          setToAmount(response.to_amount)
          setQuote({
            type: "swap",
            toAmount: response.to_amount,
            fee: Number(response.fee || 0),
            estimatedTime: response.estimated_time,
            priceImpact: response.price_impact,
          })
        }
      } catch (error) {
        if (cancelled) return
        setQuoteError(error instanceof Error ? error.message : "Failed to fetch quote")
        setToAmount("")
        setQuote(null)
      } finally {
        if (!cancelled) {
          setIsQuoteLoading(false)
        }
      }
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    fromAmount,
    fromToken,
    toToken,
    slippage,
    customSlippage,
    mevProtection,
    isCrossChain,
  ])

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
  const hasQuote = Boolean(quote)
  const bridgeTokenMismatch = isCrossChain && fromToken.symbol !== toToken.symbol
  const feeTokenAmount = hasQuote ? quote?.fee ?? 0 : null
  const feeUsdAmount =
    feeTokenAmount === null
      ? null
      : quote?.type === "bridge"
      ? feeTokenAmount * (fromToken.price || 0)
      : feeTokenAmount
  const feeDisplayLabel =
    feeTokenAmount === null
      ? "—"
      : quote?.type === "bridge"
      ? `${formatTokenAmount(feeTokenAmount, 6)} ${fromToken.symbol}${
          feeUsdAmount !== null && feeUsdAmount > 0 ? ` (~$${feeUsdAmount.toFixed(2)})` : ""
        }`
      : `$${(feeUsdAmount ?? 0).toFixed(2)}`
  const pointsEarned = hasQuote ? Math.floor(fromValueUSD * 10) : null
  const estimatedTime = hasQuote ? quote?.estimatedTime || "—" : "—"
  
  // Price Impact calculation
  const expectedAmount = fromValueUSD / toToken.price
  const actualAmount = Number.parseFloat(toAmount || "0")
  const priceImpact = quote?.priceImpact
    ? Number.parseFloat(quote.priceImpact.replace("%", ""))
    : null

  const activeSlippage = customSlippage || slippage
  const routeLabel = isCrossChain ? (quote?.provider || "Bridge") : "Auto"

  const handleExecuteTrade = () => {
    if (!fromAmount || Number.parseFloat(fromAmount) === 0) return
    setPreviewOpen(true)
  }

  const confirmTrade = async () => {
    setPreviewOpen(false)
    setSwapState("confirming")
    
    await new Promise(r => setTimeout(r, 600))
    setSwapState("processing")

    try {
      if (isCrossChain) {
        const recipient = (receiveAddress || preferredReceiveAddress).trim()
        const toChain = chainFromNetwork(toToken.network)
        const xverseHint =
          toChain === "bitcoin" && !recipient && xverseUserId.trim()
            ? xverseUserId.trim()
            : undefined
        if (!recipient && !xverseHint) {
          throw new Error(`Recipient ${toChain} address is required.`)
        }

        notifications.addNotification({
          type: "info",
          title: "Bridge pending",
          message: `Bridge ${fromAmount} ${fromToken.symbol} in progress...`,
        })
        const response = await executeBridge({
          from_chain: chainFromNetwork(fromToken.network),
          to_chain: toChain,
          token: fromToken.symbol,
          amount: fromAmount,
          recipient,
          xverse_user_id: xverseHint,
        })
        notifications.addNotification({
          type: "success",
          title: "Bridge initiated",
          message: `Bridge ${fromAmount} ${fromToken.symbol} to ${toToken.symbol} (${response.bridge_id})`,
        })
      } else {
        const slippageValue = Number(activeSlippage || "0.5")
        const minAmountOut = (Number.parseFloat(toAmount || "0") * (1 - slippageValue / 100)).toFixed(6)
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20
        notifications.addNotification({
          type: "info",
          title: "Swap pending",
          message: `Swap ${fromAmount} ${fromToken.symbol} in progress...`,
        })
        const recipient = (receiveAddress || preferredReceiveAddress).trim() || undefined
        const response = await executeSwap({
          from_token: fromToken.symbol,
          to_token: toToken.symbol,
          amount: fromAmount,
          min_amount_out: minAmountOut,
          slippage: slippageValue,
          deadline,
          recipient,
          mode: mevProtection ? "private" : "transparent",
        })
        notifications.addNotification({
          type: "success",
          title: "Swap completed",
          message: `Swap ${fromAmount} ${fromToken.symbol} → ${response.to_amount} ${toToken.symbol}`,
          txHash: response.tx_hash,
        })
      }
      await Promise.allSettled([wallet.refreshPortfolio(), wallet.refreshOnchainBalances()])
      setSwapState("success")
    } catch (error) {
      if (isCrossChain && error instanceof Error && error.message.toLowerCase().includes("xverse")) {
        notifications.addNotification({
          type: "error",
          title: "Xverse address not found",
          message: "We could not resolve your BTC address. Please check the Xverse User ID or enter a receive address.",
        })
      }
      notifications.addNotification({
        type: "error",
        title: "Trade failed",
        message: error instanceof Error ? error.message : "Failed to execute trade",
      })
      setSwapState("error")
    } finally {
      setTimeout(() => {
        setSwapState("idle")
      }, 2500)
    }
  }

  return (
    <div className="w-full max-w-xl mx-auto">
      <div className="p-6 rounded-2xl glass-strong border border-border neon-border">
        {/* Header with Privacy Toggle */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-foreground">Unified Trade</h2>
            <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide", fromSource.className)}>
              {fromSource.label}
            </span>
            {fromToken.symbol !== toToken.symbol && (
              <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide", toSource.className)}>
                {toSource.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">
              WS: {priceStatus.websocket}
            </span>
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
            tokens={tokens}
            label="From"
            amount={fromAmount}
            onAmountChange={setFromAmount}
            hideBalance={balanceHidden}
          />

          {fromToken.symbol === "BTC" && !wallet.btcAddress && (
            <div className="px-3 py-2 rounded-lg bg-warning/10 border border-warning/30">
              <p className="text-xs text-foreground">
                Source BTC membutuhkan wallet BTC testnet (Xverse/Unisat/Braavos BTC). Untuk cepat test STRK,
                gunakan pair ETH ↔ STRK.
              </p>
            </div>
          )}

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
            tokens={tokens}
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
              Best Route via {quote?.type === "bridge" ? (quote.provider || "Bridge") : "Auto"}
            </span>
            {isQuoteLoading ? (
              <span className="text-xs text-muted-foreground">Fetching quote...</span>
            ) : quoteError ? (
              <span className="text-xs text-destructive">Quote unavailable</span>
            ) : (
              <span className="text-xs text-success">Auto-selected</span>
            )}
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
            {quote?.type === "bridge" && bridgeTokenMismatch && (
              <div className="p-3 rounded-lg bg-warning/10 border border-warning/30">
                <p className="text-xs text-foreground">
                  Bridge quote asli:{" "}
                  <span className="font-medium">
                    {formatTokenAmount(quote.bridgeSourceAmount ?? 0, 8)} {fromToken.symbol}
                  </span>
                  . Angka {toToken.symbol} di atas adalah estimasi konversi harga live.
                </p>
              </div>
            )}

            {/* Receive Address */}
            <div>
              <label className="text-sm text-foreground mb-2 block">Receive Address</label>
              <input
                type="text"
                value={receiveAddress}
                onChange={(e) => {
                  setIsReceiveAddressManual(true)
                  setReceiveAddress(e.target.value)
                }}
                className="w-full py-2 px-3 rounded-lg text-sm bg-surface text-foreground border border-border focus:border-primary outline-none"
              />
              {isCrossChain && (
                <p className="mt-2 text-xs text-muted-foreground">
                  If you use Xverse and see “Address not found”, enter a BTC address manually or provide a valid Xverse User ID.
                </p>
              )}
            </div>

            {isCrossChain && (
              <div>
                <label className="text-sm text-foreground mb-2 block">Xverse User ID (optional)</label>
                <input
                  type="text"
                  value={xverseUserId}
                  onChange={(e) => setXverseUserId(e.target.value)}
                  placeholder="Use if BTC address is managed by Xverse"
                  className="w-full py-2 px-3 rounded-lg text-sm bg-surface text-foreground border border-border focus:border-primary outline-none"
                />
              </div>
            )}

            {/* Transaction Fee Breakdown */}
            <div className="space-y-2 p-3 rounded-lg bg-surface/50">
              {quote?.type === "bridge" ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Bridge Fee</span>
                    <span className="text-sm text-foreground">{feeDisplayLabel}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-2">
                    <span className="text-sm text-muted-foreground">Provider</span>
                    <span className="text-sm text-foreground">{routeLabel}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Base Fee</span>
                    <span className="text-sm text-foreground">{baseFeePercent}%</span>
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
                    <span className="text-sm font-medium text-foreground">Final Fee</span>
                    <span className="text-sm font-medium text-foreground">
                      {feeDisplayLabel} ({discountedFeePercent.toFixed(3)}%)
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Points Estimate */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-accent/10 border border-accent/20">
              <span className="text-sm text-foreground flex items-center gap-2">
                <Gift className="h-4 w-4 text-accent" />
                Estimated Points
              </span>
              <span className="text-sm font-bold text-accent">{pointsEarned === null ? "—" : `+${pointsEarned}`}</span>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* NFT Discount Counter */}
        {hasNftDiscount && (
          <div className="mt-4 p-3 rounded-xl bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                NFT Discount Active
              </span>
              <span className="text-xs text-muted-foreground">{discountPercent}% off fees</span>
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
            <p className="text-sm font-medium text-foreground">{feeDisplayLabel}</p>
          </div>
          <div className="p-3 rounded-lg bg-surface/30 text-center">
            <p className="text-xs text-muted-foreground">Impact</p>
            <p className={cn(
              "text-sm font-medium",
              priceImpact === null
                ? "text-muted-foreground"
                : priceImpact > 1
                ? "text-destructive"
                : "text-success"
            )}>
              {priceImpact === null ? "—" : `${priceImpact.toFixed(2)}%`}
            </p>
          </div>
        </div>

        {/* Price Impact Warning */}
        {priceImpact !== null && priceImpact > 1 && (
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
          disabled={swapState !== "idle" || !fromAmount || Number.parseFloat(fromAmount) === 0 || !hasQuote}
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
                  {toAmount ? `${Number.parseFloat(toAmount).toFixed(4)} ${toToken.symbol}` : "—"}
                </span>
              </div>
              <div className="border-t border-border pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Route</span>
                  <span className="text-sm text-foreground">{isCrossChain ? "Bridge" : "Swap"} via {routeLabel}</span>
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
                  <span className="text-sm text-foreground">{feeDisplayLabel}</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-muted-foreground">Est. Time</span>
                  <span className="text-sm text-foreground">{estimatedTime}</span>
                </div>
              </div>
            </div>

            {/* Points Estimate */}
            <div className="p-3 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-between">
              <span className="text-sm text-foreground">Estimated Points</span>
              <span className="font-bold text-accent">{pointsEarned === null ? "—" : `+${pointsEarned}`}</span>
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
