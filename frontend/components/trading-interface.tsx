"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import { useNotifications } from "@/hooks/use-notifications"
import { useWallet } from "@/hooks/use-wallet"
import { useLivePrices } from "@/hooks/use-live-prices"
import {
  executeBridge,
  executeSwap,
  getBridgeQuote,
  getOwnedNfts,
  getPortfolioBalance,
  getRewardsPoints,
  getSwapQuote,
  type NFTItem,
} from "@/lib/api"
import {
  bigintWeiToUnitNumber,
  decimalToU256Parts,
  estimateEvmNetworkFeeWei,
  estimateStarkgateDepositFeeWei,
  invokeStarknetCallsFromWallet,
  invokeStarknetCallFromWallet,
  parseEstimatedMinutes,
  providerIdToFeltHex,
  sendEvmStarkgateEthDepositFromWallet,
  toHexFelt,
  unitNumberToScaledBigInt,
} from "@/lib/onchain-trade"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  feeUnit?: "token" | "usd"
  protocolFee?: number
  networkFee?: number
  mevFee?: number
  estimatedTime: string
  priceImpact?: string
  provider?: string
  normalizedByLivePrice?: boolean
  bridgeSourceAmount?: number
  bridgeConvertedAmount?: number
  onchainCalls?: Array<{
    contractAddress: string
    entrypoint: string
    calldata: string[]
  }>
}

type QuoteCacheEntry = {
  expiresAt: number
  quote: QuoteState
  toAmount: string
  quoteError: string | null
}

const TradePreviewDialog = dynamic(
  () => import("@/components/trade-preview-dialog").then((mod) => mod.TradePreviewDialog),
  { ssr: false }
)

const tokenCatalog = [
  { symbol: "BTC", name: "Bitcoin", icon: "₿", price: 0, network: "Bitcoin Testnet" },
  { symbol: "ETH", name: "Ethereum", icon: "Ξ", price: 0, network: "Ethereum Sepolia" },
  { symbol: "STRK", name: "StarkNet", icon: "◈", price: 0, network: "Starknet Sepolia" },
  { symbol: "CAREL", name: "ZkCarel", icon: "◇", price: 0, network: "Starknet Sepolia" },
  { symbol: "USDC", name: "USD Coin", icon: "$", price: 0, network: "Starknet Sepolia" },
  { symbol: "USDT", name: "Tether", icon: "₮", price: 0, network: "Starknet Sepolia" },
  { symbol: "WBTC", name: "Wrapped BTC", icon: "₿", price: 0, network: "Starknet Sepolia" },
]

const slippagePresets = ["0.1", "0.3", "0.5", "1.0"]
const MEV_FEE_RATE = 0.01
const STARKNET_STRK_GAS_RESERVE = 0.02
const QUOTE_CACHE_TTL_MS = 20_000
const MAX_QUOTE_CACHE_ENTRIES = 120

const CAREL_PROTOCOL_ADDRESS = process.env.NEXT_PUBLIC_CAREL_PROTOCOL_ADDRESS || ""
const STARKNET_SWAP_CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_SWAP_CONTRACT_ADDRESS ||
  process.env.NEXT_PUBLIC_CAREL_PROTOCOL_ADDRESS ||
  ""
const STARKNET_BRIDGE_AGGREGATOR_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_BRIDGE_AGGREGATOR_ADDRESS ||
  ""
const STARKGATE_ETH_BRIDGE_ADDRESS =
  process.env.NEXT_PUBLIC_STARKGATE_ETH_BRIDGE_ADDRESS ||
  "0x8453FC6Cd1bCfE8D4dFC069C400B433054d47bDc"
const STARKGATE_ETH_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_STARKGATE_ETH_TOKEN_ADDRESS ||
  "0x0000000000000000000000000000000000455448"

const STARKNET_TOKEN_ADDRESS: Record<string, string> = {
  CAREL:
    process.env.NEXT_PUBLIC_TOKEN_CAREL_ADDRESS ||
    "0x0517f60f4ec4e1b2b748f0f642dfdcb32c0ddc893f777f2b595a4e4f6df51545",
  BTC: process.env.NEXT_PUBLIC_TOKEN_BTC_ADDRESS || "0x2",
  WBTC: process.env.NEXT_PUBLIC_TOKEN_WBTC_ADDRESS || process.env.NEXT_PUBLIC_TOKEN_BTC_ADDRESS || "0x2",
  ETH: process.env.NEXT_PUBLIC_TOKEN_ETH_ADDRESS || "0x3",
  STRK:
    process.env.NEXT_PUBLIC_TOKEN_STRK_ADDRESS ||
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  USDT: process.env.NEXT_PUBLIC_TOKEN_USDT_ADDRESS || "0x5",
  USDC: process.env.NEXT_PUBLIC_TOKEN_USDC_ADDRESS || "0x6",
}

const TOKEN_DECIMALS: Record<string, number> = {
  BTC: 8,
  WBTC: 8,
  USDT: 6,
  USDC: 6,
  ETH: 18,
  STRK: 18,
  CAREL: 18,
}

const chainFromNetwork = (network: string) => {
  const key = network.toLowerCase()
  if (key.includes("bitcoin")) return "bitcoin"
  if (key.includes("ethereum")) return "ethereum"
  if (key.includes("starknet")) return "starknet"
  return key
}

const normalizeBtcTxHashInput = (raw: string): string => {
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) {
    throw new Error("BTC tx hash wajib diisi untuk bridge native BTC.")
  }
  const body = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed
  if (!/^[0-9a-f]{64}$/.test(body)) {
    throw new Error("BTC tx hash tidak valid. Gunakan txid 64 karakter hex.")
  }
  return body
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

const normalizeFeltAddress = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (!trimmed.startsWith("0x")) return trimmed.toLowerCase()
  try {
    return `0x${BigInt(trimmed).toString(16)}`
  } catch {
    return trimmed.toLowerCase()
  }
}

const isSameFeltAddress = (left: string, right: string) => {
  const a = normalizeFeltAddress(left)
  const b = normalizeFeltAddress(right)
  if (!a || !b) return false
  return a === b
}

const resolveTokenAddress = (symbol: string): string => {
  const key = symbol.toUpperCase()
  return STARKNET_TOKEN_ADDRESS[key] || ""
}

const resolveTokenDecimals = (symbol: string): number => {
  const key = symbol.toUpperCase()
  return TOKEN_DECIMALS[key] ?? 18
}

const formatTokenAmount = (value: number, maxFractionDigits = 8) => {
  if (!Number.isFinite(value)) return "—"
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  })
}

const formatMultiplier = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "1x"
  const rounded = Math.round(value)
  if (Math.abs(value - rounded) < 0.01) return `${rounded}x`
  return `${value.toFixed(2)}x`
}

const stableKeyNumber = (value: number, fractionDigits = 8) => {
  if (!Number.isFinite(value)) return "0"
  return value.toFixed(fractionDigits)
}

const sanitizeDecimalInput = (raw: string, maxDecimals = 18) => {
  const cleaned = raw.replace(/,/g, "").replace(/[^\d.]/g, "")
  if (!cleaned) return ""
  const firstDot = cleaned.indexOf(".")
  if (firstDot === -1) {
    const noLeading = cleaned.replace(/^0+(?=\d)/, "")
    return noLeading || "0"
  }
  const intPartRaw = cleaned.slice(0, firstDot).replace(/\./g, "")
  const fracRaw = cleaned.slice(firstDot + 1).replace(/\./g, "")
  const intPart = intPartRaw.replace(/^0+(?=\d)/, "") || "0"
  const fracPart = fracRaw.slice(0, Math.max(0, maxDecimals))
  return `${intPart}.${fracPart}`
}

const trimDecimalZeros = (raw: string) =>
  raw
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "")
    .replace(/\.$/, "")

const normalizeTokenAmountDisplay = (raw: string | number, symbol: string) => {
  const parsed =
    typeof raw === "number" ? raw : Number.parseFloat(String(raw).replace(/,/g, ""))
  if (!Number.isFinite(parsed) || parsed < 0) return ""
  const maxDecimals = Math.min(resolveTokenDecimals(symbol), 8)
  return trimDecimalZeros(parsed.toFixed(Math.max(0, maxDecimals)))
}

const parseLiquidityMaxFromQuoteError = (message: string, expectedSymbol: string): number | null => {
  if (!message) return null
  const expected = expectedSymbol.trim().toUpperCase()
  if (!expected) return null
  const patterns = [
    /maks sekitar\s+([0-9]+(?:[.,][0-9]+)?)\s+([a-z0-9]+)/i,
    /max(?:imum)?\s+around\s+([0-9]+(?:[.,][0-9]+)?)\s+([a-z0-9]+)/i,
  ]
  for (const pattern of patterns) {
    const match = message.match(pattern)
    if (!match) continue
    const amountRaw = (match[1] || "").replace(",", ".")
    const symbolRaw = (match[2] || "").trim().toUpperCase()
    if (!amountRaw || symbolRaw !== expected) continue
    const parsed = Number.parseFloat(amountRaw)
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed
    }
  }
  return null
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
  maxTradeBalance?: number
}

type TokenWithBalance = (typeof tokenCatalog)[number] & { balance: number }

function TokenSelector({
  selectedToken,
  onSelect,
  tokens,
  label,
  amount,
  onAmountChange,
  readOnly,
  hideBalance,
  maxTradeBalance,
}: TokenSelectorProps) {
  const hasPrice = selectedToken.price > 0
  const usdValue = Number.parseFloat(amount || "0") * selectedToken.price
  const tokenDecimals = resolveTokenDecimals(selectedToken.symbol)
  const availableBalanceForTrade =
    typeof maxTradeBalance === "number" && Number.isFinite(maxTradeBalance)
      ? Math.max(0, Math.min(maxTradeBalance, selectedToken.balance))
      : selectedToken.balance
  
  return (
    <div className="p-3 sm:p-4 rounded-xl glass border border-border hover:border-primary/50 transition-all duration-300">
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
          <DropdownMenuContent className="w-52 sm:w-56 glass-strong border-border">
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
            inputMode={readOnly ? undefined : "decimal"}
            autoComplete="off"
            spellCheck={false}
            aria-label={`${label} amount`}
            onChange={(e) => {
              if (readOnly) return
              onAmountChange(sanitizeDecimalInput(e.target.value, tokenDecimals))
            }}
            readOnly={readOnly}
            placeholder="0.0"
              className={cn(
              "w-full bg-transparent text-right text-xl sm:text-2xl font-bold text-foreground outline-none placeholder:text-muted-foreground/50",
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
        <div className="grid grid-cols-4 gap-1.5 sm:gap-2 mt-3">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              onClick={() =>
                onAmountChange(
                  sanitizeDecimalInput(String((availableBalanceForTrade * pct) / 100), tokenDecimals)
                )
              }
              className="flex-1 py-1 text-xs font-medium text-muted-foreground hover:text-primary border border-border hover:border-primary/50 rounded-md transition-colors"
            >
              {pct === 100 ? "MAX" : `${pct}%`}
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
  const { mode } = useTheme()
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
      if (chain === "starknet") {
        if (symbol === "STRK") {
          return wallet.onchainBalance.STRK_L2 ?? backendBalance
        }
        if (symbol === "CAREL") {
          return wallet.onchainBalance.CAREL ?? backendBalance
        }
        if (symbol === "USDC") {
          return wallet.onchainBalance.USDC ?? backendBalance
        }
        if (symbol === "USDT") {
          return wallet.onchainBalance.USDT ?? backendBalance
        }
        if (symbol === "WBTC" || symbol === "BTC") {
          return wallet.onchainBalance.WBTC ?? backendBalance
        }
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
      wallet.onchainBalance.CAREL,
      wallet.onchainBalance.ETH,
      wallet.onchainBalance.STRK_L2,
      wallet.onchainBalance.USDC,
      wallet.onchainBalance.USDT,
      wallet.onchainBalance.WBTC,
    ]
  )

  const resolveTokenPrice = React.useCallback(
    (symbol: string) => {
      const upper = symbol.toUpperCase()
      const direct = Number(livePrices[upper])
      const directValid = Number.isFinite(direct) && direct > 0
      const btc = Number(livePrices.BTC)
      const btcValid = Number.isFinite(btc) && btc > 0
      const wbtc = Number(livePrices.WBTC)
      const wbtcValid = Number.isFinite(wbtc) && wbtc > 0

      if (upper === "WBTC") {
        if (directValid && btcValid) {
          const ratio = direct / btc
          if (ratio < 0.5 || ratio > 2) {
            return btc
          }
          return direct
        }
        if (btcValid) {
          return btc
        }
        if (wbtcValid) {
          return wbtc
        }
      }

      if (upper === "BTC") {
        if (directValid && wbtcValid) {
          const ratio = wbtc / direct
          if (ratio < 0.5 || ratio > 2) {
            return wbtc
          }
          return direct
        }
        if (directValid) {
          return direct
        }
        if (wbtcValid) {
          return wbtc
        }
      }

      if (directValid) {
        return direct
      }
      return 0
    },
    [livePrices]
  )

  const tokens = React.useMemo<TokenWithBalance[]>(() => {
    return tokenCatalog.map((token) => ({
      ...token,
      balance: resolveTokenBalance(token),
      price: resolveTokenPrice(token.symbol),
    }))
  }, [resolveTokenBalance, resolveTokenPrice])

  const [fromTokenSymbol, setFromTokenSymbol] = React.useState("ETH")
  const [toTokenSymbol, setToTokenSymbol] = React.useState("STRK")
  const fromToken = React.useMemo(() => {
    return (
      tokens.find((token) => token.symbol === fromTokenSymbol) ||
      tokens.find((token) => token.symbol === "ETH") ||
      tokens[0]
    )
  }, [fromTokenSymbol, tokens])
  const toToken = React.useMemo(() => {
    return (
      tokens.find((token) => token.symbol === toTokenSymbol) ||
      tokens.find((token) => token.symbol === "STRK") ||
      tokens[1] ||
      tokens[0]
    )
  }, [toTokenSymbol, tokens])
  const [fromAmount, setFromAmount] = React.useState("1.0")
  const [toAmount, setToAmount] = React.useState("")
  const [swapState, setSwapState] = React.useState<"idle" | "confirming" | "processing" | "success" | "error">("idle")
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [quote, setQuote] = React.useState<QuoteState | null>(null)
  const [isQuoteLoading, setIsQuoteLoading] = React.useState(false)
  const [quoteError, setQuoteError] = React.useState<string | null>(null)
  const [liquidityMaxFromQuote, setLiquidityMaxFromQuote] = React.useState<number | null>(null)
  const quoteCacheRef = React.useRef<Map<string, QuoteCacheEntry>>(new Map())
  const [activeNft, setActiveNft] = React.useState<NFTItem | null>(null)
  const [stakePointsMultiplier, setStakePointsMultiplier] = React.useState(1)
  
  // Privacy mode - ONLY for hiding balance in this module
  const [balanceHidden, setBalanceHidden] = React.useState(false)
  
  // Settings state
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [mevProtectionEnabled, setMevProtectionEnabled] = React.useState(false)
  const mevProtection = mode === "private" && mevProtectionEnabled
  const [slippage, setSlippage] = React.useState("0.5")
  const [customSlippage, setCustomSlippage] = React.useState("")
  const [receiveAddress, setReceiveAddress] = React.useState("")
  const [isReceiveAddressManual, setIsReceiveAddressManual] = React.useState(false)
  const [xverseUserId, setXverseUserId] = React.useState("")
  const [btcBridgeTxHash, setBtcBridgeTxHash] = React.useState("")

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
  
  const discountPercent = activeNft ? activeNft.discount : 0
  const hasNftDiscount = Boolean(activeNft)

  // Detect cross-chain
  const isCrossChain = fromToken.network !== toToken.network
  const sourceChain = chainFromNetwork(fromToken.network)
  const targetChain = chainFromNetwork(toToken.network)
  const fromSymbol = fromToken.symbol
  const toSymbol = toToken.symbol
  const fromNetwork = fromToken.network
  const toNetwork = toToken.network
  const fromPrice = fromToken.price
  const toPrice = toToken.price
  const fromChain = chainFromNetwork(fromNetwork)
  const toChain = chainFromNetwork(toNetwork)

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
    if (typeof window === "undefined") return
    const stored = window.sessionStorage.getItem("btc_bridge_tx_hash") || ""
    if (stored) {
      setBtcBridgeTxHash(stored)
    }
  }, [])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    if (btcBridgeTxHash.trim()) {
      window.sessionStorage.setItem("btc_bridge_tx_hash", btcBridgeTxHash.trim())
    }
  }, [btcBridgeTxHash])

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
    let active = true
    if (!wallet.isConnected) {
      setStakePointsMultiplier(1)
      return
    }

    const loadMultiplier = async (force = false) => {
      try {
        const rewards = await getRewardsPoints({ force })
        if (!active) return
        const parsed = Number(rewards.multiplier)
        setStakePointsMultiplier(Number.isFinite(parsed) && parsed > 0 ? parsed : 1)
      } catch {
        if (!active) return
        setStakePointsMultiplier(1)
      }
    }

    void loadMultiplier()
    const timer = window.setInterval(() => {
      void loadMultiplier(true)
    }, 20_000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [wallet.isConnected, wallet.address, wallet.starknetAddress, wallet.evmAddress, wallet.btcAddress])

  React.useEffect(() => {
    const amountValue = Number.parseFloat(fromAmount || "0")
    if (!amountValue || amountValue <= 0) {
      setToAmount("")
      setQuote(null)
      setQuoteError(null)
      setLiquidityMaxFromQuote(null)
      return
    }
    const slippageValue = Number(customSlippage || slippage || "0.5")
    const tradeMode = mevProtection ? "private" : "transparent"
    const quoteCacheKey = [
      isCrossChain ? "bridge" : "swap",
      fromChain,
      toChain,
      fromSymbol,
      toSymbol,
      stableKeyNumber(amountValue, 8),
      stableKeyNumber(slippageValue, 4),
      tradeMode,
    ].join("|")

    let cancelled = false
    const timer = setTimeout(async () => {
      setIsQuoteLoading(true)
      setQuoteError(null)
      const now = Date.now()
      const cached = quoteCacheRef.current.get(quoteCacheKey)
      if (cached && cached.expiresAt > now) {
        if (!cancelled) {
          setToAmount(cached.toAmount)
          setQuote(cached.quote)
          setQuoteError(cached.quoteError)
          setLiquidityMaxFromQuote(
            parseLiquidityMaxFromQuoteError(cached.quoteError || "", fromSymbol)
          )
          setIsQuoteLoading(false)
        }
        return
      }
      if (cached) {
        quoteCacheRef.current.delete(quoteCacheKey)
      }

      const saveQuoteToCache = (nextQuote: QuoteState, nextToAmount: string, nextQuoteError: string | null) => {
        quoteCacheRef.current.set(quoteCacheKey, {
          expiresAt: Date.now() + QUOTE_CACHE_TTL_MS,
          quote: nextQuote,
          toAmount: nextToAmount,
          quoteError: nextQuoteError,
        })
        while (quoteCacheRef.current.size > MAX_QUOTE_CACHE_ENTRIES) {
          const oldest = quoteCacheRef.current.keys().next().value
          if (!oldest) break
          quoteCacheRef.current.delete(oldest)
        }
      }

      try {
        if (isCrossChain) {
          setLiquidityMaxFromQuote(null)
          if (fromChain === "starknet" && toChain === "ethereum") {
            setQuote(null)
            setToAmount("")
            setQuoteError(
              "Arah STRK/Starknet -> ETH Sepolia belum didukung end-to-end. Gunakan ETH Sepolia -> Starknet Sepolia."
            )
            return
          }
          const response = await getBridgeQuote({
            from_chain: fromChain,
            to_chain: toChain,
            token: fromSymbol,
            amount: fromAmount,
          })
          if (cancelled) return
          let protocolFee = Number(response.fee || 0)
          let networkFee = 0
          if (fromChain === "ethereum" && toChain === "starknet" && fromSymbol.toUpperCase() === "ETH") {
            const [estimatedFeeWei, estimatedNetworkFeeWei] = await Promise.all([
              estimateStarkgateDepositFeeWei(STARKGATE_ETH_BRIDGE_ADDRESS),
              estimateEvmNetworkFeeWei(BigInt(210000)),
            ])
            if (!cancelled && estimatedFeeWei !== null) {
              protocolFee = bigintWeiToUnitNumber(estimatedFeeWei, 18)
            }
            if (!cancelled && estimatedNetworkFeeWei !== null) {
              networkFee = bigintWeiToUnitNumber(estimatedNetworkFeeWei, 18)
            }
          }
          const mevFee = mevProtection ? amountValue * MEV_FEE_RATE : 0
          const bridgeFee = protocolFee + networkFee + mevFee
          const estimatedReceiveRaw = Number(response.estimated_receive || 0)
          const bridgeToSwapAmount = estimatedReceiveRaw * (1 - 0.003)
          const slippageFactor = 1 - slippageValue / 100
          const bridgeConvertedAmount =
            fromSymbol !== toSymbol
              ? convertAmountByUsdPrice(
                  bridgeToSwapAmount * (Number.isFinite(slippageFactor) && slippageFactor > 0 ? slippageFactor : 1),
                  fromPrice,
                  toPrice
                )
              : null
          const displayToAmount =
            fromSymbol !== toSymbol
              ? Number.isFinite(bridgeConvertedAmount ?? NaN)
                ? normalizeTokenAmountDisplay(bridgeConvertedAmount as number, toSymbol)
                : ""
              : normalizeTokenAmountDisplay(response.estimated_receive, toSymbol)
          const estimatedTimeLabel =
            fromSymbol !== toSymbol
              ? `${response.estimated_time} + ~2-3 min swap`
              : response.estimated_time
          const bridgeQuote: QuoteState = {
            type: "bridge",
            toAmount: displayToAmount,
            fee: bridgeFee,
            feeUnit: "token",
            protocolFee,
            networkFee,
            mevFee,
            estimatedTime: estimatedTimeLabel,
            provider: response.bridge_provider,
            bridgeSourceAmount: estimatedReceiveRaw,
            bridgeConvertedAmount: bridgeConvertedAmount ?? undefined,
          }
          const bridgeQuoteError =
            fromSymbol !== toSymbol && !displayToAmount
              ? "Estimasi cross-token belum tersedia (harga live token tujuan belum masuk)."
              : null
          setToAmount(displayToAmount)
          setQuote(bridgeQuote)
          setQuoteError(bridgeQuoteError)
          setLiquidityMaxFromQuote(
            parseLiquidityMaxFromQuoteError(bridgeQuoteError || "", fromSymbol)
          )
          saveQuoteToCache(bridgeQuote, displayToAmount, bridgeQuoteError)
        } else {
          const response = await getSwapQuote({
            from_token: fromSymbol,
            to_token: toSymbol,
            amount: fromAmount,
            slippage: slippageValue,
            mode: tradeMode,
          })
          if (cancelled) return
          const onchainCalls =
            Array.isArray(response.onchain_calls) && response.onchain_calls.length > 0
              ? response.onchain_calls
                  .filter((call) => {
                    return (
                      call &&
                      typeof call.contract_address === "string" &&
                      typeof call.entrypoint === "string" &&
                      Array.isArray(call.calldata)
                    )
                  })
                  .map((call) => ({
                    contractAddress: call.contract_address.trim(),
                    entrypoint: call.entrypoint.trim(),
                    calldata: call.calldata.map((item) => String(item)),
                  }))
                  .filter(
                    (call) =>
                      !!call.contractAddress &&
                      !!call.entrypoint &&
                      call.calldata.every((item) => typeof item === "string" && item.trim().length > 0)
                  )
              : undefined
          const hasPreparedOnchainCalls = Array.isArray(onchainCalls) && onchainCalls.length > 0
          const backendToAmountRaw = Number(response.to_amount || 0)
          const slippageFactor =
            Number.isFinite(slippageValue) && slippageValue >= 0
              ? Math.max(0, 1 - slippageValue / 100)
              : 1
          const liveReferenceToAmount = convertAmountByUsdPrice(
            amountValue * 0.997 * slippageFactor,
            fromPrice,
            toPrice
          )
          const hasLiveReference =
            Number.isFinite(liveReferenceToAmount ?? NaN) && (liveReferenceToAmount ?? 0) > 0
          const backendDeviatesTooMuch =
            hasLiveReference &&
            (!Number.isFinite(backendToAmountRaw) ||
              backendToAmountRaw <= 0 ||
              backendToAmountRaw > (liveReferenceToAmount as number) * 1.35 ||
              backendToAmountRaw < (liveReferenceToAmount as number) * 0.65)
          const normalizedByLivePrice = !hasPreparedOnchainCalls && Boolean(backendDeviatesTooMuch)
          const normalizedToAmount = normalizedByLivePrice
            ? normalizeTokenAmountDisplay(liveReferenceToAmount as number, toSymbol)
            : normalizeTokenAmountDisplay(response.to_amount, toSymbol)
          const protocolFee = Number(response.fee || 0)
          const mevFee = mevProtection ? amountValue * MEV_FEE_RATE : 0
          const fallbackPriceImpact = `${Math.max(
            0,
            (1 - 0.997 * slippageFactor) * 100
          ).toFixed(2)}%`
          const swapQuote: QuoteState = {
            type: "swap",
            toAmount: normalizedToAmount,
            fee: protocolFee + mevFee,
            feeUnit: "usd",
            protocolFee,
            mevFee,
            estimatedTime: response.estimated_time,
            priceImpact: normalizedByLivePrice ? fallbackPriceImpact : response.price_impact,
            normalizedByLivePrice,
            onchainCalls,
          }
          setToAmount(swapQuote.toAmount)
          setQuote(swapQuote)
          setQuoteError(null)
          setLiquidityMaxFromQuote(null)
          saveQuoteToCache(swapQuote, swapQuote.toAmount, null)
        }
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? error.message : "Failed to fetch quote"
        setQuoteError(message)
        setLiquidityMaxFromQuote(parseLiquidityMaxFromQuoteError(message, fromSymbol))
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
    fromChain,
    fromPrice,
    fromSymbol,
    isCrossChain,
    mevProtection,
    slippage,
    toChain,
    toPrice,
    toSymbol,
    customSlippage,
  ])

  const handleSwapTokens = () => {
    const tempTokenSymbol = fromSymbol
    const tempAmount = fromAmount
    setFromTokenSymbol(toSymbol)
    setToTokenSymbol(tempTokenSymbol)
    setFromAmount(toAmount)
    setToAmount(tempAmount)
  }

  // Calculate trade details
  const fromValueUSD = Number.parseFloat(fromAmount || "0") * fromToken.price
  const hasQuote = Boolean(quote)
  const bridgeTokenMismatch = isCrossChain && fromToken.symbol !== toToken.symbol
  const rawFeeAmount = hasQuote ? quote?.fee ?? 0 : null
  const feeUnit = quote?.feeUnit || (quote?.type === "bridge" ? "token" : "usd")
  const discountRate = hasNftDiscount ? Math.min(Math.max(discountPercent, 0), 100) / 100 : 0
  const rawProtocolFee = quote?.protocolFee
  const rawMevFee = quote?.mevFee
  const rawNetworkFee = quote?.networkFee
  const protocolFeeEffective =
    rawProtocolFee === undefined
      ? undefined
      : rawProtocolFee * (1 - discountRate)
  const mevFeeEffective =
    rawMevFee === undefined
      ? undefined
      : rawMevFee * (1 - discountRate)
  const feeAmount =
    hasQuote
      ? (protocolFeeEffective ?? 0) + (mevFeeEffective ?? 0) + (rawNetworkFee ?? 0)
      : null
  const feeUsdAmount =
    feeAmount === null
      ? null
      : feeUnit === "token"
      ? feeAmount * (fromToken.price || 0)
      : feeAmount
  const rawFeeUsdAmount =
    rawFeeAmount === null
      ? null
      : feeUnit === "token"
      ? rawFeeAmount * (fromToken.price || 0)
      : rawFeeAmount
  const feeSavingsUsd =
    rawFeeUsdAmount === null || feeUsdAmount === null
      ? 0
      : Math.max(0, rawFeeUsdAmount - feeUsdAmount)
  const feeDisplayLabel =
    feeAmount === null
      ? "—"
      : feeUnit === "token"
      ? `${formatTokenAmount(feeAmount, 6)} ${fromToken.symbol}${
          feeUsdAmount !== null && feeUsdAmount > 0 ? ` (~$${feeUsdAmount.toFixed(2)})` : ""
        }`
      : `$${(feeAmount ?? 0).toFixed(2)}`
  const protocolFeeDisplay =
    protocolFeeEffective === undefined
      ? "—"
      : feeUnit === "token"
      ? `${formatTokenAmount(protocolFeeEffective, 6)} ${fromToken.symbol}`
      : `$${protocolFeeEffective.toFixed(2)}`
  const networkFeeDisplay =
    quote?.networkFee === undefined || quote.networkFee <= 0
      ? "—"
      : `${formatTokenAmount(quote.networkFee, 6)} ${fromToken.symbol}`
  const mevFeeDisplay =
    mevFeeEffective === undefined || mevFeeEffective <= 0
      ? "—"
      : feeUnit === "token"
      ? `${formatTokenAmount(mevFeeEffective, 6)} ${fromToken.symbol}`
      : `$${mevFeeEffective.toFixed(2)}`
  const mevFeePercent = mevProtection ? "1.0" : "0.0"
  const basePointsEarned = hasQuote ? Math.max(0, Math.floor(fromValueUSD * 10)) : null
  const nftPointsMultiplier = hasNftDiscount ? 1 + discountRate : 1
  const normalizedStakeMultiplier =
    Number.isFinite(stakePointsMultiplier) && stakePointsMultiplier > 0 ? stakePointsMultiplier : 1
  const effectivePointsMultiplier = normalizedStakeMultiplier * nftPointsMultiplier
  const pointsEarned =
    basePointsEarned === null
      ? null
      : Math.max(0, Math.floor(basePointsEarned * effectivePointsMultiplier))
  const showPointsMultiplier = normalizedStakeMultiplier > 1 || nftPointsMultiplier > 1
  const estimatedTime = hasQuote ? quote?.estimatedTime || "—" : "—"
  
  // Price Impact calculation
  const priceImpact = quote?.priceImpact
    ? Number.parseFloat(quote.priceImpact.replace("%", ""))
    : null

  const activeSlippage = customSlippage || slippage
  const routeLabel = isCrossChain ? (quote?.provider || "Bridge") : "Auto"
  const isSwapContractEventOnly = React.useMemo(() => {
    const forcedEventOnly = (process.env.NEXT_PUBLIC_SWAP_CONTRACT_EVENT_ONLY || "").toLowerCase()
    if (forcedEventOnly === "1" || forcedEventOnly === "true") {
      return true
    }
    return isSameFeltAddress(STARKNET_SWAP_CONTRACT_ADDRESS, CAREL_PROTOCOL_ADDRESS)
  }, [])
  const isStarknetPairSwap = !isCrossChain && fromChain === "starknet" && toChain === "starknet"
  const fromAmountValue = Number.parseFloat(fromAmount || "0")
  const hasPositiveAmount = Number.isFinite(fromAmountValue) && fromAmountValue > 0
  const shouldRequireLiveStarknetBalance =
    sourceChain === "starknet" &&
    ["STRK", "CAREL", "USDC", "USDT", "WBTC", "BTC"].includes(fromToken.symbol.toUpperCase())
  const fromTokenLiveBalance = (() => {
    const symbol = fromToken.symbol.toUpperCase()
    if (!shouldRequireLiveStarknetBalance) return null
    if (symbol === "STRK") return wallet.onchainBalance.STRK_L2
    if (symbol === "CAREL") return wallet.onchainBalance.CAREL
    if (symbol === "USDC") return wallet.onchainBalance.USDC
    if (symbol === "USDT") return wallet.onchainBalance.USDT
    if (symbol === "WBTC" || symbol === "BTC") return wallet.onchainBalance.WBTC
    return null
  })()
  const onchainBalanceUnavailable =
    shouldRequireLiveStarknetBalance &&
    (fromTokenLiveBalance === null || fromTokenLiveBalance === undefined)
  const needsStarknetGasReserve =
    fromToken.symbol.toUpperCase() === "STRK" && sourceChain === "starknet"
  const effectiveFromBalance =
    shouldRequireLiveStarknetBalance && typeof fromTokenLiveBalance === "number"
      ? fromTokenLiveBalance
      : fromToken.balance || 0
  const maxSpendableFromBalance = Math.max(
    0,
    effectiveFromBalance - (needsStarknetGasReserve ? STARKNET_STRK_GAS_RESERVE : 0)
  )
  const maxSpendableFromLiquidity =
    typeof liquidityMaxFromQuote === "number" && Number.isFinite(liquidityMaxFromQuote)
      ? Math.max(0, liquidityMaxFromQuote)
      : null
  const maxExecutableFromAllLimits =
    maxSpendableFromLiquidity === null
      ? maxSpendableFromBalance
      : Math.max(0, Math.min(maxSpendableFromBalance, maxSpendableFromLiquidity))
  const hasInsufficientBalance = hasPositiveAmount && fromAmountValue > maxSpendableFromBalance
  const hasInsufficientLiquidityCap =
    hasPositiveAmount &&
    maxSpendableFromLiquidity !== null &&
    fromAmountValue > maxSpendableFromLiquidity + 1e-12
  React.useEffect(() => {
    if (onchainBalanceUnavailable) return
    const parsed = Number.parseFloat(fromAmount || "0")
    if (!Number.isFinite(parsed) || parsed <= 0) return
    if (parsed <= maxExecutableFromAllLimits + 1e-12) return
    const clamped = sanitizeDecimalInput(
      String(Math.max(0, maxExecutableFromAllLimits)),
      resolveTokenDecimals(fromToken.symbol)
    )
    if (clamped !== fromAmount) {
      setFromAmount(clamped)
    }
  }, [fromAmount, fromToken.symbol, maxExecutableFromAllLimits, onchainBalanceUnavailable])
  const resolvedReceiveAddress = (receiveAddress || preferredReceiveAddress).trim()
  const requiresBtcTxHash = isCrossChain && sourceChain === "bitcoin"
  const isBtcTxHashValid = !requiresBtcTxHash || /^[0-9a-fA-F]{64}$/.test((btcBridgeTxHash || "").trim().replace(/^0x/i, ""))
  const hasValidQuote = hasQuote && !quoteError
  const hasPreparedOnchainSwapCalls =
    quote?.type === "swap" && Array.isArray(quote.onchainCalls) && quote.onchainCalls.length > 0
  const hasFallbackPositiveBalance =
    Number.isFinite(fromToken.balance) && fromToken.balance > 0
  const executeDisabledReason =
    !wallet.isConnected
      ? "Connect wallet dulu."
      : !hasPositiveAmount
      ? "Masukkan amount yang valid."
      : onchainBalanceUnavailable && !hasFallbackPositiveBalance
      ? `Saldo on-chain ${fromToken.symbol} belum terbaca. Tunggu refresh saldo dulu.`
      : hasInsufficientBalance
      ? `Amount melebihi saldo. Maks ${formatTokenAmount(maxSpendableFromBalance, 6)} ${fromToken.symbol}${
          needsStarknetGasReserve ? " (sudah sisakan gas)" : ""
        }.`
      : hasInsufficientLiquidityCap
      ? `Likuiditas route saat ini membatasi amount. Maks ${formatTokenAmount(maxExecutableFromAllLimits, 6)} ${fromToken.symbol}.`
      : isStarknetPairSwap && isSwapContractEventOnly
      ? "Swap real token belum aktif: kontrak saat ini event-only (hanya event + gas)."
      : !hasValidQuote
      ? quoteError || "Quote belum siap."
      : isStarknetPairSwap && !hasPreparedOnchainSwapCalls
      ? "Quote on-chain calldata belum siap. Refresh quote lagi."
      : isCrossChain && !resolvedReceiveAddress
      ? "Receive address wajib diisi."
      : !isBtcTxHashValid
      ? "BTC tx hash harus 64 hex."
      : null
  const executeButtonLabel = (() => {
    if (swapState === "confirming") {
      return (
        <span className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          Confirming...
        </span>
      )
    }
    if (swapState === "processing") {
      return (
        <span className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          Processing {isCrossChain ? "Bridge" : "Swap"}...
        </span>
      )
    }
    if (swapState === "success") {
      return (
        <span className="flex items-center gap-2">
          <Check className="h-5 w-5" />
          {isCrossChain ? "Bridge" : "Swap"} Successful!
        </span>
      )
    }
    if (swapState === "error") {
      return (
        <span className="flex items-center gap-2">
          <X className="h-5 w-5" />
          Transaction Failed
        </span>
      )
    }
    return "Execute Trade"
  })()

  const starknetProviderHint = React.useMemo<"starknet" | "argentx" | "braavos">(() => {
    if (wallet.provider === "argentx" || wallet.provider === "braavos") {
      return wallet.provider
    }
    return "starknet"
  }, [wallet.provider])

  const submitOnchainSwapTx = React.useCallback(async () => {
    const fromChain = chainFromNetwork(fromToken.network)
    const toChain = chainFromNetwork(toToken.network)
    if (fromChain !== "starknet" || toChain !== "starknet") {
      throw new Error(
        "On-chain user-sign untuk swap saat ini difokuskan ke pair Starknet. Gunakan pair Starknet ↔ Starknet atau mode bridge."
      )
    }
    if (isSwapContractEventOnly) {
      throw new Error(
        "Kontrak swap saat ini event-only, belum memindahkan token real. Aktifkan/deploy real swap router dulu."
      )
    }
    const preparedCalls = quote?.type === "swap" ? quote.onchainCalls || [] : []
    if (!preparedCalls.length) {
      throw new Error(
        "Quote swap belum mengandung calldata on-chain. Refresh quote lalu coba lagi."
      )
    }

    return invokeStarknetCallsFromWallet(
      preparedCalls.map((call) => ({
        contractAddress: call.contractAddress,
        entrypoint: call.entrypoint,
        calldata: call.calldata,
      })),
      starknetProviderHint
    )
  }, [
    fromToken.network,
    isSwapContractEventOnly,
    quote,
    starknetProviderHint,
    toToken.network,
  ])

  const submitOnchainBridgeTx = React.useCallback(async () => {
    const fromChain = chainFromNetwork(fromToken.network)
    const toChain = chainFromNetwork(toToken.network)
    const recipient = (receiveAddress || preferredReceiveAddress).trim()
    if (fromChain === "bitcoin") {
      if (toChain !== "starknet") {
        throw new Error("Bridge BTC native saat ini hanya didukung untuk tujuan Starknet.")
      }
      return normalizeBtcTxHashInput(btcBridgeTxHash)
    }
    if (fromChain === "ethereum") {
      if (fromToken.symbol.toUpperCase() !== "ETH") {
        throw new Error(
          "Bridge Ethereum -> Starknet via StarkGate saat ini hanya mendukung ETH native."
        )
      }
      if (toChain !== "starknet") {
        throw new Error("Bridge source Ethereum saat ini hanya didukung untuk tujuan Starknet.")
      }
      if (!recipient) {
        throw new Error("Starknet recipient address is required for StarkGate bridge.")
      }
      // Refresh fee right before submit to reduce mismatch with MetaMask preview.
      const estimatedFeeWei = await estimateStarkgateDepositFeeWei(STARKGATE_ETH_BRIDGE_ADDRESS)
      const quotedProtocolFeeWei =
        quote?.type === "bridge" && typeof quote.protocolFee === "number" && quote.protocolFee > 0
          ? unitNumberToScaledBigInt(quote.protocolFee, 18)
          : null
      return sendEvmStarkgateEthDepositFromWallet({
        bridgeAddress: STARKGATE_ETH_BRIDGE_ADDRESS,
        tokenAddress: STARKGATE_ETH_TOKEN_ADDRESS,
        amountEth: fromAmount,
        l2Recipient: recipient,
        feeWei: estimatedFeeWei ?? quotedProtocolFeeWei,
      })
    }

    if (fromChain !== "starknet") {
      throw new Error("On-chain bridge currently supports Bitcoin/Ethereum/Starknet source only.")
    }
    if (toChain === "ethereum") {
      throw new Error(
        "STRK/Starknet -> ETH Sepolia withdrawal belum didukung end-to-end di UI ini. Saat ini bridge on-chain stabil hanya ETH Sepolia -> Starknet Sepolia."
      )
    }

    if (!STARKNET_BRIDGE_AGGREGATOR_ADDRESS) {
      throw new Error(
        "NEXT_PUBLIC_STARKNET_BRIDGE_AGGREGATOR_ADDRESS belum diisi. Set alamat bridge aggregator Starknet di frontend/.env.local."
      )
    }
    const activeBridgeQuote =
      quote?.type === "bridge"
        ? quote
        : await getBridgeQuote({
            from_chain: chainFromNetwork(fromToken.network),
            to_chain: chainFromNetwork(toToken.network),
            token: fromToken.symbol,
            amount: fromAmount,
          })

    const providerId = providerIdToFeltHex(
      (activeBridgeQuote as any).provider || (activeBridgeQuote as any).bridge_provider || ""
    )
    const [costLow, costHigh] = decimalToU256Parts(
      String((activeBridgeQuote as any).fee ?? 0),
      resolveTokenDecimals(fromToken.symbol)
    )
    const [amountLow, amountHigh] = decimalToU256Parts(fromAmount, resolveTokenDecimals(fromToken.symbol))
    const estimatedTime = parseEstimatedMinutes((activeBridgeQuote as any).estimatedTime || (activeBridgeQuote as any).estimated_time)

    return invokeStarknetCallFromWallet(
      {
        contractAddress: STARKNET_BRIDGE_AGGREGATOR_ADDRESS,
        entrypoint: "execute_bridge",
        calldata: [providerId, costLow, costHigh, toHexFelt(estimatedTime), amountLow, amountHigh],
      },
      starknetProviderHint
    )
  }, [
    btcBridgeTxHash,
    fromAmount,
    fromToken.network,
    fromToken.symbol,
    preferredReceiveAddress,
    quote,
    receiveAddress,
    starknetProviderHint,
    toToken.network,
  ])

  const handleExecuteTrade = () => {
    if (executeDisabledReason) return
    setPreviewOpen(true)
  }

  const confirmTrade = async () => {
    setPreviewOpen(false)
    setSwapState("confirming")
    setSwapState("processing")
    let tradeFinalized = true

    try {
      if (isCrossChain) {
        const recipient = (receiveAddress || preferredReceiveAddress).trim()
        const sourceChain = chainFromNetwork(fromToken.network)
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
          title: "Wallet signature required",
          message:
            sourceChain === "ethereum"
              ? "Confirm bridge transaction in MetaMask (StarkGate). Nilai final di MetaMask termasuk amount + L1 message fee + gas, jadi bisa sedikit beda dari estimasi UI."
              : sourceChain === "bitcoin"
              ? "Bridge BTC native: kirim BTC ke vault lewat wallet BTC, lalu isi BTC Tx Hash di form ini."
              : "Confirm bridge transaction in your Starknet wallet.",
        })
        const onchainTxHash = await submitOnchainBridgeTx()
        const txNetwork = sourceChain === "ethereum" ? "evm" : sourceChain === "bitcoin" ? "btc" : "starknet"

        notifications.addNotification({
          type: "info",
          title: "Bridge pending",
          message: `Bridge ${fromAmount} ${fromToken.symbol} submitted on-chain (${onchainTxHash.slice(0, 10)}...).`,
          txHash: onchainTxHash,
          txNetwork,
        })
        const response = await executeBridge({
          from_chain: sourceChain,
          to_chain: toChain,
          token: fromToken.symbol,
          to_token: toToken.symbol,
          estimated_out_amount: quote?.toAmount || toAmount || undefined,
          amount: fromAmount,
          recipient,
          xverse_user_id: xverseHint,
          onchain_tx_hash: onchainTxHash,
          mode: mevProtection ? "private" : "transparent",
        })
        const normalizedStatus = (response.status || "").toLowerCase()
        const isBridgeFinalized = normalizedStatus === "completed" || normalizedStatus === "success"
        tradeFinalized = isBridgeFinalized
        notifications.addNotification({
          type: isBridgeFinalized ? "success" : "info",
          title: isBridgeFinalized ? "Bridge completed" : "Bridge submitted",
          message: isBridgeFinalized
            ? `Bridge ${fromAmount} ${fromToken.symbol} ke ${toToken.symbol} selesai. Tx: ${onchainTxHash}`
            : `Bridge ${fromAmount} ${fromToken.symbol} masih proses settlement ke Starknet (~5-20 menit). Tx: ${onchainTxHash}`,
          txHash: onchainTxHash,
          txNetwork,
        })
      } else {
        const slippageValue = Number(activeSlippage || "0.5")
        const minAmountOut = (Number.parseFloat(toAmount || "0") * (1 - slippageValue / 100)).toFixed(6)
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20
        notifications.addNotification({
          type: "info",
          title: "Wallet signature required",
          message: "Confirm swap transaction in your Starknet wallet.",
        })
        const onchainTxHash = await submitOnchainSwapTx()

        notifications.addNotification({
          type: "info",
          title: "Swap pending",
          message: `Swap ${fromAmount} ${fromToken.symbol} submitted on-chain (${onchainTxHash.slice(0, 10)}...).`,
          txHash: onchainTxHash,
          txNetwork: "starknet",
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
          onchain_tx_hash: onchainTxHash || undefined,
          mode: mevProtection ? "private" : "transparent",
        })
        notifications.addNotification({
          type: "success",
          title: "Swap completed",
          message: `Swap ${fromAmount} ${fromToken.symbol} → ${response.to_amount} ${toToken.symbol}`,
          txHash: onchainTxHash,
          txNetwork: "starknet",
        })
      }
      await Promise.allSettled([wallet.refreshPortfolio(), wallet.refreshOnchainBalances()])
      if (tradeFinalized) {
        setSwapState("success")
      }
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
    <div className="w-full max-w-xl mx-auto px-2 sm:px-0 pb-28 md:pb-0">
      <div className="p-4 sm:p-6 rounded-xl sm:rounded-2xl glass-strong border border-border neon-border">
        {/* Header with Privacy Toggle */}
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-foreground">Unified Trade</h2>
            <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide", fromSource.className)}>
              {fromSource.label}
            </span>
            {fromToken.symbol !== toToken.symbol && fromSource.label !== toSource.label && (
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
            onSelect={(token) => setFromTokenSymbol(token.symbol)}
            tokens={tokens}
            label="From"
            amount={fromAmount}
            onAmountChange={setFromAmount}
            hideBalance={balanceHidden}
            maxTradeBalance={maxExecutableFromAllLimits}
          />

          {fromToken.symbol === "BTC" && !wallet.btcAddress && (
            <div className="px-3 py-2 rounded-lg bg-warning/10 border border-warning/30">
              <p className="text-xs text-foreground">
                Source BTC membutuhkan wallet BTC testnet (Xverse). Untuk cepat test STRK,
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
            onSelect={(token) => setToTokenSymbol(token.symbol)}
            tokens={tokens}
            label="To"
            amount={toAmount}
            onAmountChange={setToAmount}
            readOnly
            hideBalance={balanceHidden}
          />
        </div>

        {/* Simplified Route Display */}
        <div className="mt-3 sm:mt-4 p-3 rounded-xl bg-surface/30 border border-border/50">
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
          {!isQuoteLoading && quoteError && (
            <p className="mt-2 text-[11px] text-destructive break-words">{quoteError}</p>
          )}
          {!isQuoteLoading && quoteError && maxSpendableFromLiquidity !== null && (
            <button
              onClick={() =>
                setFromAmount(
                  sanitizeDecimalInput(
                    String(maxExecutableFromAllLimits),
                    resolveTokenDecimals(fromToken.symbol)
                  )
                )
              }
              className="mt-2 text-[11px] text-primary hover:text-primary/80 underline underline-offset-2"
            >
              Pakai max aman: {formatTokenAmount(maxExecutableFromAllLimits, 6)} {fromToken.symbol}
            </button>
          )}
          {!isCrossChain && quote?.type === "swap" && quote.normalizedByLivePrice && !quoteError && (
            <p className="mt-2 text-[11px] text-warning">
              Quote backend tidak konsisten dengan harga live. Estimasi output dinormalisasi via nilai USD live.
            </p>
          )}
        </div>

        {/* Settings Panel - Collapsible */}
        <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen} className="mt-3 sm:mt-4">
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
                onClick={() => setMevProtectionEnabled((prev) => !prev)}
                disabled={mode !== "private"}
                className={cn(
                  "w-11 h-6 rounded-full transition-colors relative",
                  mode !== "private" && "opacity-50 cursor-not-allowed",
                  mevProtection ? "bg-primary" : "bg-muted"
                )}
              >
                <span className={cn(
                  "absolute top-1 w-4 h-4 rounded-full bg-background transition-transform",
                  mevProtection ? "left-6" : "left-1"
                )} />
              </button>
            </div>
            {mode !== "private" && (
              <p className="text-xs text-muted-foreground">
                Aktif hanya di Private Mode. Saat mode biasa, selalu Disabled.
              </p>
            )}

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
                  . Angka {toToken.symbol} di atas adalah estimasi konversi live (sudah termasuk asumsi swap fee + slippage).
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

            {isCrossChain && targetChain === "bitcoin" && (
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

            {isCrossChain && sourceChain === "bitcoin" && (
              <div>
                <label className="text-sm text-foreground mb-2 block">BTC Tx Hash (required)</label>
                <input
                  type="text"
                  value={btcBridgeTxHash}
                  onChange={(e) => setBtcBridgeTxHash(e.target.value)}
                  placeholder="Paste BTC txid from wallet (64 hex chars)"
                  className="w-full py-2 px-3 rounded-lg text-sm bg-surface text-foreground border border-border focus:border-primary outline-none"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Setelah kirim BTC ke vault bridge, paste txid di sini agar backend bisa lanjut settlement ke Starknet.
                </p>
              </div>
            )}

            {/* Transaction Fee Breakdown */}
            <div className="space-y-2 p-3 rounded-lg bg-surface/50">
              {quote?.type === "bridge" ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">StarkGate Fee</span>
                    <span className="text-sm text-foreground">{protocolFeeDisplay}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Network Gas (est.)</span>
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
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Provider</span>
                    <span className="text-sm text-foreground">{routeLabel}</span>
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
                    <span className="text-sm font-medium text-foreground">
                      {feeDisplayLabel}
                    </span>
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

            {/* Points Estimate */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-accent/10 border border-accent/20">
              <div>
                <span className="text-sm text-foreground flex items-center gap-2">
                  <Gift className="h-4 w-4 text-accent" />
                  Estimated Points
                </span>
                {basePointsEarned !== null && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Base +{basePointsEarned}
                    {normalizedStakeMultiplier > 1 ? ` × Stake ${formatMultiplier(normalizedStakeMultiplier)}` : ""}
                    {nftPointsMultiplier > 1 ? ` × NFT ${formatMultiplier(nftPointsMultiplier)}` : ""}
                  </p>
                )}
              </div>
              <span className="text-sm font-bold text-accent">{pointsEarned === null ? "—" : `+${pointsEarned}`}</span>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* NFT Discount Counter */}
        {hasNftDiscount && (
          <div className="mt-3 sm:mt-4 p-3 rounded-xl bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                NFT Discount Active
              </span>
              <span className="text-xs text-muted-foreground">{discountPercent}% off fees</span>
            </div>
          </div>
        )}
        {showPointsMultiplier && (
          <div className="mt-3 p-3 rounded-xl bg-secondary/10 border border-secondary/20">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground flex items-center gap-2">
                <Gift className="h-4 w-4 text-secondary" />
                Points Multiplier Active
              </span>
              <span className="text-xs text-secondary font-semibold">
                {formatMultiplier(effectivePointsMultiplier)}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Stake: {formatMultiplier(normalizedStakeMultiplier)}
              {nftPointsMultiplier > 1 ? ` • NFT: ${formatMultiplier(nftPointsMultiplier)}` : ""}
            </p>
          </div>
        )}

        {/* Quick Info */}
        <div className="mt-3 sm:mt-4 grid grid-cols-3 gap-2 sm:gap-3">
          <div className="p-2.5 sm:p-3 rounded-lg bg-surface/30 text-center">
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <Clock className="h-3 w-3" /> Est. Time
            </p>
            <p className="text-sm font-medium text-foreground">{estimatedTime}</p>
          </div>
          <div className="p-2.5 sm:p-3 rounded-lg bg-surface/30 text-center">
            <p className="text-xs text-muted-foreground">Fee</p>
            <p className="text-sm font-medium text-foreground">{feeDisplayLabel}</p>
          </div>
          <div className="p-2.5 sm:p-3 rounded-lg bg-surface/30 text-center">
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
          <div className="mt-3 sm:mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
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
          disabled={swapState !== "idle" || !!executeDisabledReason}
          className={cn(
            "hidden md:inline-flex w-full mt-6 py-6 text-lg font-bold transition-all text-primary-foreground",
            swapState === "idle" && "bg-gradient-to-r from-primary via-accent to-primary bg-[length:200%_100%] animate-gradient hover:opacity-90",
            swapState === "confirming" && "bg-primary/80",
            swapState === "processing" && "bg-secondary/80",
            swapState === "success" && "bg-success",
            swapState === "error" && "bg-destructive"
          )}
        >
          {executeButtonLabel}
        </Button>
        {swapState === "idle" && executeDisabledReason && (
          <p className="hidden md:block text-center text-xs text-warning mt-2">{executeDisabledReason}</p>
        )}

        <p className="text-center text-xs text-muted-foreground mt-4">
          By trading, you agree to our Terms of Service
        </p>
      </div>

      <div className="fixed md:hidden inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto w-full max-w-xl px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
          <div className="mb-2 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">Fee: {feeDisplayLabel}</span>
            <span className="truncate text-center">Time: {estimatedTime}</span>
            <span className="truncate text-right">{pointsEarned === null ? "Pts: —" : `Pts: +${pointsEarned}`}</span>
          </div>
          <Button
            onClick={handleExecuteTrade}
            disabled={swapState !== "idle" || !!executeDisabledReason}
            className={cn(
              "w-full h-12 text-base font-semibold transition-all text-primary-foreground",
              swapState === "idle" && "bg-gradient-to-r from-primary via-accent to-primary bg-[length:200%_100%] animate-gradient hover:opacity-90",
              swapState === "confirming" && "bg-primary/80",
              swapState === "processing" && "bg-secondary/80",
              swapState === "success" && "bg-success",
              swapState === "error" && "bg-destructive"
            )}
          >
            {executeButtonLabel}
          </Button>
          {swapState === "idle" && executeDisabledReason && (
            <p className="text-center text-[11px] text-warning mt-2">{executeDisabledReason}</p>
          )}
        </div>
      </div>

      {previewOpen ? (
        <TradePreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          fromAmount={fromAmount}
          fromSymbol={fromToken.symbol}
          toAmount={toAmount}
          toSymbol={toToken.symbol}
          isCrossChain={isCrossChain}
          routeLabel={routeLabel}
          activeSlippage={activeSlippage}
          mevProtection={mevProtection}
          feeDisplayLabel={feeDisplayLabel}
          estimatedTime={estimatedTime}
          pointsEarned={pointsEarned}
          receiveAddress={resolvedReceiveAddress}
          onCancel={() => setPreviewOpen(false)}
          onConfirm={confirmTrade}
        />
      ) : null}
    </div>
  )
}
