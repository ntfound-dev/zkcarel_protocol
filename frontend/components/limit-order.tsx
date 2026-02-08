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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ChevronDown, TrendingUp, TrendingDown, Info, Expand, X, Check, AlertCircle } from "lucide-react"
import { useNotifications } from "@/hooks/use-notifications"
import { cancelLimitOrder, createLimitOrder, getMarketDepth, getPortfolioBalance, getTokenOHLCV, listLimitOrders } from "@/lib/api"

const tokenCatalog = [
  { symbol: "BTC", name: "Bitcoin", icon: "₿", price: 65000, change: 0 },
  { symbol: "ETH", name: "Ethereum", icon: "Ξ", price: 2450, change: 0 },
  { symbol: "STRK", name: "StarkNet", icon: "◈", price: 1.25, change: 0 },
  { symbol: "CAREL", name: "ZkCarel", icon: "◐", price: 0.85, change: 0 },
  { symbol: "USDT", name: "Tether", icon: "₮", price: 1, change: 0 },
  { symbol: "USDC", name: "USD Coin", icon: "⭕", price: 1, change: 0 },
]

type TokenItem = (typeof tokenCatalog)[number]

const expiryOptions = [
  { label: "1 hari", value: "1d" },
  { label: "7 hari", value: "7d" },
  { label: "30 hari", value: "30d" },
]

const pricePresets = [
  { label: "-5%", value: -5 },
  { label: "-10%", value: -10 },
  { label: "-25%", value: -25 },
  { label: "-50%", value: -50 },
]

const sellPresets = [
  { label: "+5%", value: 5 },
  { label: "+10%", value: 10 },
  { label: "+25%", value: 25 },
  { label: "+50%", value: 50 },
]

type UiOrder = {
  id: string
  type: "buy" | "sell"
  token: string
  amount: string
  price: string
  expiry: string
  status: "active" | "filled" | "cancelled"
  createdAt: string
}

const fallbackOrders: UiOrder[] = [
  { id: "local-1", type: "buy", token: "BTC", amount: "0.1", price: "62000", expiry: "1d", status: "active", createdAt: "2 jam lalu" },
  { id: "local-2", type: "sell", token: "ETH", amount: "2.5", price: "2600", expiry: "7d", status: "active", createdAt: "5 jam lalu" },
]

const stableSymbols = new Set(["USDT", "USDC"])

const formatDateTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
}

export function LimitOrder() {
  const notifications = useNotifications()
  const [tokens, setTokens] = React.useState<TokenItem[]>(tokenCatalog)
  const [selectedToken, setSelectedToken] = React.useState(tokens[0])
  const [payToken, setPayToken] = React.useState(tokens[4])
  const [receiveToken, setReceiveToken] = React.useState(tokens[4])
  const [orderType, setOrderType] = React.useState<"buy" | "sell">("buy")
  const [amount, setAmount] = React.useState("")
  const [price, setPrice] = React.useState("")
  const [expiry, setExpiry] = React.useState(expiryOptions[2].value)
  const [chartModalOpen, setChartModalOpen] = React.useState(false)
  const [chartPeriod, setChartPeriod] = React.useState("24H")
  const [orders, setOrders] = React.useState<UiOrder[]>(fallbackOrders)
  const [showConfirmDialog, setShowConfirmDialog] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [submitSuccess, setSubmitSuccess] = React.useState(false)
  const [chartPoints, setChartPoints] = React.useState<number[]>([])
  const [orderBook, setOrderBook] = React.useState<{ bids: Array<{ price: number; amount: number }>; asks: Array<{ price: number; amount: number }> }>({
    bids: [],
    asks: [],
  })

  React.useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const response = await getPortfolioBalance()
        if (!active) return
        setTokens((prev) =>
          prev.map((token) => {
            const match = response.balances.find((item) => item.token.toUpperCase() === token.symbol)
            if (!match) return token
            const nextPrice = match.amount > 0 ? match.value_usd / match.amount : match.price
            return { ...token, price: nextPrice }
          })
        )
      } catch {
        // keep fallback prices
      }
    })()

    return () => {
      active = false
    }
  }, [])

  React.useEffect(() => {
    const nextSelected = tokens.find((token) => token.symbol === selectedToken.symbol) || tokens[0]
    const nextPay = tokens.find((token) => token.symbol === payToken.symbol) || tokens[4]
    const nextReceive = tokens.find((token) => token.symbol === receiveToken.symbol) || tokens[4]
    setSelectedToken(nextSelected)
    setPayToken(nextPay)
    setReceiveToken(nextReceive)
  }, [tokens])

  const intervalForPeriod = (period: string) => {
    switch (period) {
      case "1H":
        return { interval: "1h", limit: 24 }
      case "24H":
        return { interval: "1h", limit: 24 }
      case "7D":
        return { interval: "1d", limit: 7 }
      case "30D":
        return { interval: "1d", limit: 30 }
      default:
        return { interval: "1h", limit: 24 }
    }
  }

  React.useEffect(() => {
    let active = true
    const { interval, limit } = intervalForPeriod(chartPeriod)
    ;(async () => {
      try {
        const response = await getTokenOHLCV({
          token: selectedToken.symbol,
          interval,
          limit,
        })
        if (!active) return
        const closes = response.data.map((candle) => Number(candle.close)).filter((value) => Number.isFinite(value))
        if (closes.length >= 2) {
          const latest = closes[closes.length - 1]
          const prev = closes[closes.length - 2]
          const change = prev > 0 ? ((latest - prev) / prev) * 100 : 0
          setTokens((prevTokens) =>
            prevTokens.map((token) =>
              token.symbol === selectedToken.symbol ? { ...token, price: latest, change } : token
            )
          )
          setChartPoints(closes)
        }
      } catch {
        // keep fallback chart
      }
    })()

    return () => {
      active = false
    }
  }, [selectedToken.symbol, chartPeriod])

  React.useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const response = await getMarketDepth(selectedToken.symbol, 3)
        if (!active) return
        setOrderBook({ bids: response.bids, asks: response.asks })
      } catch {
        if (!active) return
        setOrderBook({ bids: [], asks: [] })
      }
    })()

    return () => {
      active = false
    }
  }, [selectedToken.symbol])

  React.useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const response = await listLimitOrders(1, 10, "active")
        if (!active) return
        const mapped = response.items.map((order) => {
          const isBuy = stableSymbols.has(order.from_token.toUpperCase())
          return {
            id: order.order_id,
            type: isBuy ? "buy" : "sell",
            token: isBuy ? order.to_token : order.from_token,
            amount: order.amount,
            price: order.price,
            expiry: order.expiry,
            status: order.status === 2 ? "filled" : order.status === 3 ? "cancelled" : "active",
            createdAt: formatDateTime(order.created_at),
          } as UiOrder
        })
        setOrders(mapped)
      } catch {
        // keep fallback
      }
    })()

    return () => {
      active = false
    }
  }, [])

  const handlePricePreset = (percentage: number) => {
    const marketPrice = selectedToken.price
    const newPrice = marketPrice * (1 + percentage / 100)
    setPrice(newPrice.toFixed(2))
  }

  const marketPrice = selectedToken.price
  const chartHigh = chartPoints.length > 0 ? Math.max(...chartPoints) : marketPrice * 1.05
  const chartLow = chartPoints.length > 0 ? Math.min(...chartPoints) : marketPrice * 0.95
  const currentPrice = Number.parseFloat(price) || 0
  const priceChange = marketPrice ? ((currentPrice - marketPrice) / marketPrice * 100).toFixed(2) : "0"
  const fallbackBids = [0.02, 0.04, 0.06].map((diff, i) => ({
    price: marketPrice * (1 - diff),
    amount: marketPrice / (1000 * (i + 1)),
  }))
  const fallbackAsks = [0.02, 0.04, 0.06].map((diff, i) => ({
    price: marketPrice * (1 + diff),
    amount: marketPrice / (900 * (i + 1)),
  }))
  const bids = orderBook.bids.length > 0 ? orderBook.bids : fallbackBids
  const asks = orderBook.asks.length > 0 ? orderBook.asks : fallbackAsks

  const handleAmountPreset = (percent: number) => {
    // Mock balance
    const balance = orderType === "buy" ? 10000 : 5
    setAmount((balance * percent / 100).toString())
  }

  const estimatedTotal = currentPrice * (Number.parseFloat(amount) || 0)

  const handleSubmitOrder = () => {
    setShowConfirmDialog(true)
  }

  const confirmOrder = async () => {
    setIsSubmitting(true)
    try {
      const fromToken = orderType === "buy" ? payToken.symbol : selectedToken.symbol
      const toToken = orderType === "buy" ? selectedToken.symbol : receiveToken.symbol

      const response = await createLimitOrder({
        from_token: fromToken,
        to_token: toToken,
        amount,
        price,
        expiry,
        recipient: null,
      })

      const newOrder: UiOrder = {
        id: response.order_id,
        type: orderType,
        token: selectedToken.symbol,
        amount,
        price,
        expiry,
        status: "active",
        createdAt: "Baru saja",
      }

      setOrders((prev) => [newOrder, ...prev])
      setSubmitSuccess(true)
      notifications.addNotification({
        type: "success",
        title: "Order dibuat",
        message: `Order ${orderType === "buy" ? "beli" : "jual"} ${amount} ${selectedToken.symbol} berhasil dibuat`,
      })
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Gagal membuat order",
        message: error instanceof Error ? error.message : "Terjadi kesalahan saat membuat order",
      })
    } finally {
      setIsSubmitting(false)
      setTimeout(() => {
        setShowConfirmDialog(false)
        setSubmitSuccess(false)
        setAmount("")
        setPrice("")
      }, 1500)
    }
  }

  const cancelOrder = async (orderId: string) => {
    try {
      await cancelLimitOrder(orderId)
      setOrders((prev) => prev.filter((order) => order.id !== orderId))
      notifications.addNotification({
        type: "success",
        title: "Order dibatalkan",
        message: "Order berhasil dibatalkan",
      })
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Gagal membatalkan",
        message: error instanceof Error ? error.message : "Tidak dapat membatalkan order",
      })
    }
  }

  return (
    <>
      <section id="limit-order" className="py-12">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/20 border border-primary/30 mb-4">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary">Testnet Active</span>
            </div>
            <h2 className="text-3xl font-bold text-foreground mb-2">Limit Order</h2>
            <p className="text-muted-foreground">Atur harga dan eksekusi trade secara otomatis</p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Chart Section */}
            <div className="lg:col-span-2 p-6 rounded-2xl glass-strong border border-border">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="gap-2 bg-transparent">
                        <span className="text-xl">{selectedToken.icon}</span>
                        <span className="font-bold">{selectedToken.symbol}</span>
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="glass-strong border-border">
                      {tokens.map((token) => (
                        <DropdownMenuItem
                          key={token.symbol}
                          onClick={() => setSelectedToken(token)}
                          className="flex items-center gap-2"
                        >
                          <span className="text-lg">{token.icon}</span>
                          <div>
                            <p className="font-medium">{token.symbol}</p>
                            <p className="text-xs text-muted-foreground">{token.name}</p>
                          </div>
                          <span className="ml-auto">${token.price.toLocaleString()}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  
                  <div>
                    <p className="text-2xl font-bold text-foreground">${selectedToken.price.toLocaleString()}</p>
                    <p className={cn(
                      "text-sm flex items-center gap-1",
                      selectedToken.change >= 0 ? "text-success" : "text-destructive"
                    )}>
                      {selectedToken.change >= 0 ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : (
                        <TrendingDown className="h-3 w-3" />
                      )}
                      {selectedToken.change >= 0 ? "+" : ""}{selectedToken.change}%
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex gap-2">
                    {["1H", "24H", "7D", "30D"].map((period) => (
                      <button
                        key={period}
                        onClick={() => setChartPeriod(period)}
                        className={cn(
                          "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                          chartPeriod === period
                            ? "bg-primary/20 text-primary"
                            : "text-muted-foreground hover:text-foreground hover:bg-surface"
                        )}
                      >
                        {period}
                      </button>
                    ))}
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon"
                    onClick={() => setChartModalOpen(true)}
                  >
                    <Expand className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Chart Visualization */}
              <div className="h-64 rounded-xl bg-surface/30 relative overflow-hidden">
                <svg className="w-full h-full" viewBox="0 0 800 200" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="chartGradientLimit" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {chartPoints.length > 1 ? (
                    <path
                      d={chartPoints.map((value, idx) => {
                        const x = (idx / (chartPoints.length - 1)) * 800
                        const maxVal = Math.max(...chartPoints)
                        const minVal = Math.min(...chartPoints)
                        const range = maxVal - minVal || 1
                        const y = 200 - ((value - minVal) / range) * 160 - 20
                        return `${idx === 0 ? "M" : "L"} ${x} ${y}`
                      }).join(" ")}
                      fill="none"
                      stroke="hsl(var(--primary))"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : (
                    <path
                      d="M 0 150 Q 50 140, 100 145 T 200 120 T 300 130 T 400 100 T 500 110 T 600 80 T 700 85 T 800 70"
                      fill="url(#chartGradientLimit)"
                      stroke="hsl(var(--primary))"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {/* Price line indicator */}
                  {currentPrice > 0 && (
                    <line
                      x1="0"
                      y1={200 - (currentPrice / marketPrice) * 100}
                      x2="800"
                      y2={200 - (currentPrice / marketPrice) * 100}
                      stroke="hsl(var(--secondary))"
                      strokeWidth="1"
                      strokeDasharray="5,5"
                    />
                  )}
                </svg>
                <div className="absolute top-4 left-4 text-xs text-muted-foreground">
                  High: ${chartHigh.toLocaleString()}
                </div>
                <div className="absolute bottom-4 left-4 text-xs text-muted-foreground">
                  Low: ${chartLow.toLocaleString()}
                </div>
                {currentPrice > 0 && (
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 bg-secondary/20 px-2 py-1 rounded text-xs text-secondary">
                    Target: ${currentPrice.toLocaleString()}
                  </div>
                )}
              </div>

              {/* Order Book Preview */}
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div className="p-3 rounded-lg bg-success/10 border border-success/20">
                  <p className="text-xs text-muted-foreground mb-2">Bids</p>
                  <div className="space-y-1">
                    {bids.map((level, i) => (
                      <div key={`${level.price}-${i}`} className="flex justify-between text-xs">
                        <span className="text-success">${level.price.toLocaleString()}</span>
                        <span className="text-muted-foreground">{level.amount.toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <p className="text-xs text-muted-foreground mb-2">Asks</p>
                  <div className="space-y-1">
                    {asks.map((level, i) => (
                      <div key={`${level.price}-${i}`} className="flex justify-between text-xs">
                        <span className="text-destructive">${level.price.toLocaleString()}</span>
                        <span className="text-muted-foreground">{level.amount.toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Order Form */}
            <div className="p-6 rounded-2xl glass-strong border border-border">
              <Tabs value={orderType} onValueChange={(value) => setOrderType(value as "buy" | "sell")}>
                <TabsList className="grid w-full grid-cols-2 mb-6">
                  <TabsTrigger value="buy" className="data-[state=active]:bg-success/20 data-[state=active]:text-success">
                    Beli
                  </TabsTrigger>
                  <TabsTrigger value="sell" className="data-[state=active]:bg-destructive/20 data-[state=active]:text-destructive">
                    Jual
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="buy" className="space-y-4">
                  {/* Token Selection */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-2 block">Token</label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-transparent">
                          <div className="flex items-center gap-2">
                            <span>{selectedToken.icon}</span>
                            <span>{selectedToken.symbol}</span>
                          </div>
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="glass-strong border-border w-full">
                        {tokens.filter(t => t.symbol !== "USDT" && t.symbol !== "USDC").map((token) => (
                          <DropdownMenuItem
                            key={token.symbol}
                            onClick={() => setSelectedToken(token)}
                            className="flex items-center gap-2"
                          >
                            <span>{token.icon}</span>
                            <span>{token.symbol}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Buy Price */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-foreground">Harga Beli</label>
                      <span className="text-xs text-muted-foreground">Market: ${marketPrice.toLocaleString()}</span>
                    </div>
                    <input
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <div className="flex gap-2 mt-2">
                      {pricePresets.map((preset) => (
                        <button
                          key={preset.label}
                          onClick={() => handlePricePreset(preset.value)}
                          className="flex-1 px-2 py-1 text-xs rounded-md bg-surface text-muted-foreground hover:text-foreground hover:bg-surface/80 transition-colors"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    {currentPrice > 0 && (
                      <p className={cn(
                        "text-xs mt-2",
                        Number.parseFloat(priceChange) < 0 ? "text-success" : "text-muted-foreground"
                      )}>
                        {Number.parseFloat(priceChange) < 0 ? priceChange : `+${priceChange}`}% dari market
                      </p>
                    )}
                  </div>

                  {/* Pay With */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-2 block">Bayar dengan</label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-transparent">
                          <div className="flex items-center gap-2">
                            <span>{payToken.icon}</span>
                            <span>{payToken.symbol}</span>
                          </div>
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="glass-strong border-border">
                        {tokens.filter(t => t.symbol === "USDT" || t.symbol === "USDC").map((token) => (
                          <DropdownMenuItem
                            key={token.symbol}
                            onClick={() => setPayToken(token)}
                            className="flex items-center gap-2"
                          >
                            <span>{token.icon}</span>
                            <span>{token.symbol}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Amount */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-foreground">Jumlah</label>
                      <span className="text-xs text-muted-foreground">Saldo: 10,000 {payToken.symbol}</span>
                    </div>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <div className="flex gap-2 mt-2">
                      {[25, 50, 75, 100].map((percent) => (
                        <button
                          key={percent}
                          onClick={() => handleAmountPreset(percent)}
                          className="flex-1 px-2 py-1 text-xs rounded-md bg-surface text-muted-foreground hover:text-foreground hover:bg-surface/80 transition-colors"
                        >
                          {percent}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Expiry */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-2 block">Kedaluwarsa</label>
                    <div className="grid grid-cols-3 gap-2">
                      {expiryOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setExpiry(option.value)}
                          className={cn(
                            "px-3 py-2 text-xs font-medium rounded-lg transition-colors",
                            expiry === option.value
                              ? "bg-primary/20 text-primary border border-primary"
                              : "bg-surface text-muted-foreground border border-border hover:border-primary/50"
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Estimated Total */}
                  {currentPrice > 0 && Number.parseFloat(amount) > 0 && (
                    <div className="p-3 rounded-lg bg-surface/50 border border-border">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Estimasi dapat</span>
                        <span className="font-medium text-foreground">
                          {(Number.parseFloat(amount) / currentPrice).toFixed(6)} {selectedToken.symbol}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm mt-1">
                        <span className="text-muted-foreground">Total bayar</span>
                        <span className="font-medium text-foreground">
                          {amount} {payToken.symbol}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Info */}
                  <div className="p-3 rounded-lg bg-secondary/10 border border-secondary/20">
                    <div className="flex items-start gap-2">
                      <Info className="h-4 w-4 text-secondary flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-foreground">
                        Order akan dieksekusi otomatis saat harga market mencapai target Anda
                      </p>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <Button 
                    onClick={handleSubmitOrder}
                    disabled={!price || !amount}
                    className="w-full py-6 bg-success hover:bg-success/90 text-success-foreground font-bold"
                  >
                    Buat Order Beli
                  </Button>
                </TabsContent>

                <TabsContent value="sell" className="space-y-4">
                  {/* Token Selection */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-2 block">Token</label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-transparent">
                          <div className="flex items-center gap-2">
                            <span>{selectedToken.icon}</span>
                            <span>{selectedToken.symbol}</span>
                          </div>
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="glass-strong border-border w-full">
                        {tokens.filter(t => t.symbol !== "USDT" && t.symbol !== "USDC").map((token) => (
                          <DropdownMenuItem
                            key={token.symbol}
                            onClick={() => setSelectedToken(token)}
                            className="flex items-center gap-2"
                          >
                            <span>{token.icon}</span>
                            <span>{token.symbol}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Sell Price */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-foreground">Harga Jual</label>
                      <span className="text-xs text-muted-foreground">Market: ${marketPrice.toLocaleString()}</span>
                    </div>
                    <input
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <div className="flex gap-2 mt-2">
                      {sellPresets.map((preset) => (
                        <button
                          key={preset.label}
                          onClick={() => handlePricePreset(preset.value)}
                          className="flex-1 px-2 py-1 text-xs rounded-md bg-surface text-muted-foreground hover:text-foreground hover:bg-surface/80 transition-colors"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Receive In */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-2 block">Terima dalam</label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-transparent">
                          <div className="flex items-center gap-2">
                            <span>{receiveToken.icon}</span>
                            <span>{receiveToken.symbol}</span>
                          </div>
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="glass-strong border-border">
                        {tokens.filter(t => t.symbol === "USDT" || t.symbol === "USDC").map((token) => (
                          <DropdownMenuItem
                            key={token.symbol}
                            onClick={() => setReceiveToken(token)}
                            className="flex items-center gap-2"
                          >
                            <span>{token.icon}</span>
                            <span>{token.symbol}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Amount */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-foreground">Jumlah</label>
                      <span className="text-xs text-muted-foreground">Saldo: 5.0 {selectedToken.symbol}</span>
                    </div>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <div className="flex gap-2 mt-2">
                      {[25, 50, 75, 100].map((percent) => (
                        <button
                          key={percent}
                          onClick={() => setAmount((5 * percent / 100).toString())}
                          className="flex-1 px-2 py-1 text-xs rounded-md bg-surface text-muted-foreground hover:text-foreground hover:bg-surface/80 transition-colors"
                        >
                          {percent}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Expiry */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-2 block">Kedaluwarsa</label>
                    <div className="grid grid-cols-3 gap-2">
                      {expiryOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setExpiry(option.value)}
                          className={cn(
                            "px-3 py-2 text-xs font-medium rounded-lg transition-colors",
                            expiry === option.value
                              ? "bg-primary/20 text-primary border border-primary"
                              : "bg-surface text-muted-foreground border border-border hover:border-primary/50"
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Estimated Total */}
                  {currentPrice > 0 && Number.parseFloat(amount) > 0 && (
                    <div className="p-3 rounded-lg bg-surface/50 border border-border">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Estimasi dapat</span>
                        <span className="font-medium text-foreground">
                          {(Number.parseFloat(amount) * currentPrice).toLocaleString()} {receiveToken.symbol}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Submit Button */}
                  <Button 
                    onClick={handleSubmitOrder}
                    disabled={!price || !amount}
                    className="w-full py-6 bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold"
                  >
                    Buat Order Jual
                  </Button>
                </TabsContent>
              </Tabs>
            </div>
          </div>

          {/* Active Orders */}
          {orders.length > 0 && (
            <div className="mt-8 p-6 rounded-2xl glass-strong border border-border">
              <h3 className="text-lg font-bold text-foreground mb-4">Order Aktif</h3>
              <div className="space-y-3">
                {orders.map((order) => (
                  <div key={order.id} className="flex items-center justify-between p-4 rounded-xl bg-surface/50 border border-border">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "px-3 py-1 rounded-full text-xs font-medium",
                        order.type === "buy" ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive"
                      )}>
                        {order.type === "buy" ? "BELI" : "JUAL"}
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{order.amount} {order.token}</p>
                        <p className="text-xs text-muted-foreground">@ ${Number(order.price).toLocaleString()}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">{order.createdAt}</p>
                        <p className="text-xs text-muted-foreground">
                          Exp: {expiryOptions.find(e => e.value === order.expiry)?.label || formatDateTime(order.expiry)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => cancelOrder(order.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Full Chart Modal */}
      <Dialog open={chartModalOpen} onOpenChange={setChartModalOpen}>
        <DialogContent className="max-w-4xl glass-strong border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-xl">{selectedToken.icon}</span>
              {selectedToken.symbol}/USD
            </DialogTitle>
          </DialogHeader>
          <div className="h-96 rounded-xl bg-surface/30 relative overflow-hidden">
            <svg className="w-full h-full" viewBox="0 0 800 300" preserveAspectRatio="none">
              <defs>
                <linearGradient id="chartGradientFull" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                </linearGradient>
              </defs>
              {chartPoints.length > 1 ? (
                <path
                  d={chartPoints.map((value, idx) => {
                    const x = (idx / (chartPoints.length - 1)) * 800
                    const maxVal = Math.max(...chartPoints)
                    const minVal = Math.min(...chartPoints)
                    const range = maxVal - minVal || 1
                    const y = 300 - ((value - minVal) / range) * 240 - 30
                    return `${idx === 0 ? "M" : "L"} ${x} ${y}`
                  }).join(" ")}
                  fill="none"
                  stroke="hsl(var(--primary))"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              ) : (
                <path
                  d="M 0 250 Q 50 230, 100 240 T 200 200 T 300 220 T 400 150 T 500 170 T 600 120 T 700 130 T 800 100"
                  fill="url(#chartGradientFull)"
                  stroke="hsl(var(--primary))"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
          </div>
          <div className="flex justify-center gap-2">
            {["1H", "24H", "7D", "30D", "1Y"].map((period) => (
              <button
                key={period}
                onClick={() => setChartPeriod(period)}
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

      {/* Confirm Order Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="max-w-md glass-strong border-border">
          <DialogHeader>
            <DialogTitle>Konfirmasi Order</DialogTitle>
          </DialogHeader>
          
          {submitSuccess ? (
            <div className="py-8 text-center">
              <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
                <Check className="h-8 w-8 text-success" />
              </div>
              <p className="text-lg font-medium text-foreground">Order Berhasil Dibuat!</p>
              <p className="text-sm text-muted-foreground mt-2">Order Anda akan dieksekusi saat harga tercapai</p>
            </div>
          ) : (
            <>
              <div className="space-y-4 py-4">
                <div className="p-4 rounded-xl bg-surface/50 border border-border">
                  <div className="flex justify-between mb-2">
                    <span className="text-muted-foreground">Tipe</span>
                    <span className={cn(
                      "font-medium",
                      orderType === "buy" ? "text-success" : "text-destructive"
                    )}>
                      {orderType === "buy" ? "Beli" : "Jual"}
                    </span>
                  </div>
                  <div className="flex justify-between mb-2">
                    <span className="text-muted-foreground">Token</span>
                    <span className="font-medium text-foreground">{selectedToken.symbol}</span>
                  </div>
                  <div className="flex justify-between mb-2">
                    <span className="text-muted-foreground">Harga Target</span>
                    <span className="font-medium text-foreground">${currentPrice.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between mb-2">
                    <span className="text-muted-foreground">Jumlah</span>
                    <span className="font-medium text-foreground">{amount} {orderType === "buy" ? payToken.symbol : selectedToken.symbol}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Kedaluwarsa</span>
                    <span className="font-medium text-foreground">{expiryOptions.find(e => e.value === expiry)?.label}</span>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-secondary/10 border border-secondary/20">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-secondary flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-foreground">
                      Order ini bersifat testnet dan tidak menggunakan dana riil
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setShowConfirmDialog(false)}
                  className="flex-1"
                >
                  Batal
                </Button>
                <Button
                  onClick={confirmOrder}
                  disabled={isSubmitting}
                  className={cn(
                    "flex-1",
                    orderType === "buy" ? "bg-success hover:bg-success/90" : "bg-destructive hover:bg-destructive/90"
                  )}
                >
                  {isSubmitting ? "Memproses..." : "Konfirmasi"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
