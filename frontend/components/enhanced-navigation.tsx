"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { useWallet, type WalletProviderType, type BtcWalletProviderType } from "@/hooks/use-wallet"
import { useNotifications } from "@/hooks/use-notifications"
import { claimFaucet, getFaucetStatus, getTransactionsHistory, type Transaction } from "@/lib/api"
import { formatNetworkLabel } from "@/lib/network-config"
import {
  BTC_WALLET_PROVIDERS,
  STARKNET_WALLET_PROVIDERS,
  WALLET_PROVIDERS,
} from "@/lib/wallet-provider-config"
import { Button } from "@/components/ui/button"
import { PrivacyRouterPanel } from "@/components/privacy-router-panel"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  Shield, Wallet, Bell, User, Menu, X, ArrowRightLeft, PieChart, Trophy, Gift, 
  History, Users, Settings, Droplets, ChevronDown, HelpCircle, Zap,
  Copy, Check, TrendingUp, Coins, QrCode, Lock,
  Smartphone, ChevronRight, Clock, XCircle, CheckCircle, Loader2, Mail
} from "lucide-react"

const STARKNET_FAUCET_URL = "https://starknet-faucet.vercel.app/"

const walletProviders = WALLET_PROVIDERS as { id: WalletProviderType; name: string; icon: string }[]
const starknetWalletProviders = STARKNET_WALLET_PROVIDERS as {
  id: WalletProviderType
  name: string
  icon: string
}[]
const btcWalletProviders = BTC_WALLET_PROVIDERS as {
  id: BtcWalletProviderType
  name: string
  icon: string
}[]

const faucetTokens = [
  { symbol: "BTC", name: "Bitcoin", amount: "0.001" },
  { symbol: "ETH", name: "Ethereum", amount: "0.01" },
  { symbol: "STRK", name: "StarkNet", amount: "10" },
  { symbol: "CAREL", name: "ZkCarel", amount: "100" },
]

// Transaction history filter options (Indonesian)
const txFilters = [
  { id: "all", label: "Semua" },
  { id: "pending", label: "Berlangsung" },
  { id: "completed", label: "Selesai" },
  { id: "failed", label: "Gagal" },
]

// Top Up providers
const topUpProviders = [
  { id: "qris", name: "QRIS", icon: "📱", available: false },
  { id: "dana", name: "Dana", icon: "💙", available: false },
  { id: "ovo", name: "OVO", icon: "💜", available: false },
  { id: "gopay", name: "GoPay", icon: "💚", available: false },
  { id: "bank", name: "Bank Transfer", icon: "🏦", available: false },
]

type FaucetStatusMap = Record<
  string,
  { can_claim: boolean; next_claim_at?: string | null; last_claim_at?: string | null }
>

type UiTx = {
  id: string
  type: string
  status: "completed" | "pending" | "failed"
  from?: string
  to?: string
  amount?: string
  value?: string
  time?: string
}

export function EnhancedNavigation() {
  const wallet = useWallet()
  const notifications = useNotifications()
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)
  const [walletDialogOpen, setWalletDialogOpen] = React.useState(false)
  const [notificationsOpen, setNotificationsOpen] = React.useState(false)
  const [txHistoryOpen, setTxHistoryOpen] = React.useState(false)
  const [helpOpen, setHelpOpen] = React.useState(false)
  const [topUpOpen, setTopUpOpen] = React.useState(false)
  const [privacyOpen, setPrivacyOpen] = React.useState(false)
  const [faucetStatus, setFaucetStatus] = React.useState<FaucetStatusMap>({})
  const [faucetLoading, setFaucetLoading] = React.useState<Record<string, boolean>>({})
  const [faucetTx, setFaucetTx] = React.useState<Record<string, string>>({})
  const [copiedAddress, setCopiedAddress] = React.useState(false)
  const [txFilter, setTxFilter] = React.useState("all")
  const [txHistory, setTxHistory] = React.useState<UiTx[]>([])
  const [txHistoryLoading, setTxHistoryLoading] = React.useState(false)
  const [walletConnectPending, setWalletConnectPending] = React.useState(false)
  const [btcConnectPending, setBtcConnectPending] = React.useState(false)

  // --- Safe helpers ---
  const formatCurrency = (value: unknown) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return "0"
    return n.toLocaleString()
  }

  const formatAsset = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "—"
    if (!Number.isFinite(value)) return "—"
    return value.toLocaleString(undefined, { maximumFractionDigits: 6 })
  }

  const renderOnchainValue = (
    value: number | null | undefined,
    connected: boolean,
    fallback: string
  ) => {
    if (!connected) return fallback
    if (value === null || value === undefined) return "Fetching..."
    return formatAsset(value)
  }

  const formatTime = (ts: unknown) => {
    if (!ts) return ""
    try {
      const d = ts instanceof Date ? ts : new Date(ts as any)
      if (isNaN(d.getTime())) return ""
      return d.toLocaleTimeString()
    } catch {
      return ""
    }
  }

  const formatRelativeTime = (iso: string) => {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ""
    const diffMs = Date.now() - date.getTime()
    const minutes = Math.floor(diffMs / 60000)
    if (minutes < 60) return `${minutes} min ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} hours ago`
    const days = Math.floor(hours / 24)
    return `${days} days ago`
  }

  const parseNumber = (value?: string | number | null) => {
    if (value === null || value === undefined) return 0
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  const shortenAddress = (addr?: string | null) => {
    if (!addr) return ""
    if (addr.length <= 12) return addr
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  const renderLinkStatus = (addr?: string | null) => {
    if (!addr) return "Not linked"
    return shortenAddress(addr)
  }

  const connectedTestnets = React.useMemo(() => {
    const labels: string[] = []
    if (wallet.starknetAddress) labels.push(formatNetworkLabel("starknet"))
    if (wallet.evmAddress) labels.push(formatNetworkLabel("evm"))
    if (wallet.btcAddress) labels.push(formatNetworkLabel("btc"))
    return labels
  }, [wallet.starknetAddress, wallet.evmAddress, wallet.btcAddress])

  const connectedTestnetSummary =
    connectedTestnets.length > 0
      ? `Connected to ${connectedTestnets.join(" + ")}`
      : "Connected, but no testnet wallet linked yet."
  const effectivePortfolioBalance = React.useMemo(
    () => ({
      BTC:
        wallet.btcAddress && wallet.onchainBalance?.BTC !== null && wallet.onchainBalance?.BTC !== undefined
          ? wallet.onchainBalance.BTC
          : wallet.balance?.BTC ?? 0,
      ETH:
        wallet.evmAddress && wallet.onchainBalance?.ETH !== null && wallet.onchainBalance?.ETH !== undefined
          ? wallet.onchainBalance.ETH
          : wallet.balance?.ETH ?? 0,
      STRK:
        wallet.starknetAddress &&
        wallet.onchainBalance?.STRK_L2 !== null &&
        wallet.onchainBalance?.STRK_L2 !== undefined
          ? wallet.onchainBalance.STRK_L2
          : wallet.balance?.STRK ?? 0,
      CAREL: wallet.balance?.CAREL ?? 0,
    }),
    [
      wallet.balance?.BTC,
      wallet.balance?.CAREL,
      wallet.balance?.ETH,
      wallet.balance?.STRK,
      wallet.btcAddress,
      wallet.evmAddress,
      wallet.onchainBalance?.BTC,
      wallet.onchainBalance?.ETH,
      wallet.onchainBalance?.STRK_L2,
      wallet.starknetAddress,
    ]
  )

  React.useEffect(() => {
    if (!wallet.isConnected || wallet.network !== "starknet") {
      setFaucetStatus({})
      return
    }
    let active = true
    ;(async () => {
      try {
        const response = await getFaucetStatus()
        if (!active) return
        const mapped: FaucetStatusMap = {}
        response.tokens.forEach((token) => {
          mapped[token.token] = {
            can_claim: token.can_claim,
            next_claim_at: token.next_claim_at,
            last_claim_at: token.last_claim_at,
          }
        })
        setFaucetStatus(mapped)
      } catch {
        if (!active) return
        setFaucetStatus({})
      }
    })()

    return () => {
      active = false
    }
  }, [wallet.isConnected, wallet.token, wallet.network])

  React.useEffect(() => {
    if (!txHistoryOpen || !wallet.isConnected) return
    let active = true
    setTxHistoryLoading(true)
    ;(async () => {
      try {
        const response = await getTransactionsHistory({ page: 1, limit: 20 })
        if (!active) return
        const mapped: UiTx[] = response.items.map((tx: Transaction) => {
          const amountValue = parseNumber(tx.amount_in || tx.amount_out || 0)
          const usdValue = parseNumber(tx.usd_value)
          return {
            id: tx.tx_hash,
            type: tx.tx_type,
            status: tx.processed ? "completed" : "pending",
            from: tx.token_in || tx.tx_type,
            to: tx.token_out || "",
            amount: amountValue ? amountValue.toString() : "—",
            value: usdValue ? `$${usdValue.toLocaleString()}` : "—",
            time: formatRelativeTime(tx.timestamp),
          }
        })
        setTxHistory(mapped)
      } catch {
        if (!active) return
        setTxHistory([])
      } finally {
        if (active) setTxHistoryLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [txHistoryOpen, wallet.isConnected])

  // --- Handlers ---
  const handleWalletConnect = async (provider: WalletProviderType) => {
    if (walletConnectPending) return
    setWalletConnectPending(true)
    try {
      await wallet.connect(provider)
      setWalletDialogOpen(false)
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Wallet connection failed",
        message: error instanceof Error ? error.message : "Unable to connect wallet",
      })
    } finally {
      setWalletConnectPending(false)
    }
  }

  const handleBtcConnect = async (provider: BtcWalletProviderType) => {
    if (btcConnectPending) return
    setBtcConnectPending(true)
    try {
      await wallet.connectBtcWallet(provider)
      notifications.addNotification({
        type: "success",
        title: "BTC wallet connected",
        message: `Connected ${provider.toUpperCase()} wallet.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to connect BTC wallet"
      const missingExtension = message.toLowerCase().includes("extension not detected")
      notifications.addNotification({
        type: missingExtension ? "warning" : "error",
        title: missingExtension ? "BTC wallet optional" : "BTC wallet connection failed",
        message: missingExtension
          ? `${message} Untuk trade STRK/ETH, lanjutkan dengan MetaMask + Braavos/ArgentX tanpa wallet BTC.`
          : message,
      })
    } finally {
      setBtcConnectPending(false)
    }
  }

  const handleClaimFaucet = async (symbol: string) => {
    if (!wallet.isConnected) {
      notifications.addNotification({
        type: "error",
        title: "Wallet not connected",
        message: "Connect your wallet to claim faucet tokens.",
      })
      return
    }
    if (wallet.network !== "starknet") {
      notifications.addNotification({
        type: "warning",
        title: "Starknet wallet required",
        message: "Faucet hanya tersedia untuk wallet Starknet.",
      })
      return
    }

    const strkBalance = wallet.onchainBalance?.STRK_L2 ?? null
    if (typeof strkBalance === "number" && strkBalance <= 0) {
      notifications.addNotification({
        type: "warning",
        title: "Butuh STRK untuk gas",
        message: "Saldo STRK kosong. Buka faucet Starknet untuk top up.",
      })
      if (typeof window !== "undefined") {
        window.open(STARKNET_FAUCET_URL, "_blank", "noopener,noreferrer")
      }
      return
    }

    const status = faucetStatus[symbol]
    if (!status?.can_claim || faucetLoading[symbol]) return

    setFaucetLoading((prev) => ({ ...prev, [symbol]: true }))
    try {
      const result = await claimFaucet(symbol)
      const txHash = result.tx_hash
      if (txHash) {
        setFaucetTx((prev) => ({ ...prev, [symbol]: txHash }))
      }
      const shortTx =
        typeof txHash === "string" && txHash.length > 12
          ? `${txHash.slice(0, 8)}...${txHash.slice(-6)}`
          : txHash
      notifications.addNotification({
        type: "success",
        title: "Faucet claimed",
        message: `Claimed ${result.amount} ${result.token}. Tx: ${shortTx || "N/A"}.`,
      })

      // Update local faucet status with cooldown info
      const nextClaimAt = result.next_claim_in
        ? new Date(Date.now() + result.next_claim_in * 1000).toISOString()
        : undefined
      setFaucetStatus((prev) => ({
        ...prev,
        [symbol]: {
          ...(prev[symbol] || { can_claim: false }),
          can_claim: false,
          next_claim_at: nextClaimAt,
        },
      }))

      await Promise.allSettled([wallet.refreshPortfolio(), wallet.refreshOnchainBalances()])
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Faucet failed",
        message: error instanceof Error ? error.message : "Failed to claim faucet.",
      })
    } finally {
      setFaucetLoading((prev) => ({ ...prev, [symbol]: false }))
    }
  }

  const copyAddress = () => {
    if (wallet?.address) {
      navigator.clipboard.writeText(wallet.address)
      setCopiedAddress(true)
      setTimeout(() => setCopiedAddress(false), 2000)
    }
  }

  // Filter transactions
  const filteredTxHistory = txHistory.filter(tx => {
    if (txFilter === "all") return true
    return tx.status === txFilter
  })

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b border-border/40 glass-strong">
        <div className="container flex h-16 items-center justify-between px-4 mx-auto">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="relative">
              <Shield className="h-8 w-8 text-primary animate-pulse-glow" />
              <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-primary-foreground">
                Z
              </span>
            </div>
            <span className="font-sans text-xl font-bold tracking-wider text-foreground group-hover:text-primary transition-colors">
              ZkCarel
            </span>
          </Link>

          {/* Desktop Actions */}
          <div className="hidden lg:flex items-center gap-2">
            {/* Faucet */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 text-success hover:bg-success/10">
                  <Droplets className="h-4 w-4" />
                  Faucet
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60 glass-strong border-border">
                <DropdownMenuLabel>
                  <div>
                    <p className="text-sm font-medium text-foreground">Testnet Faucet</p>
                    <p className="text-xs text-muted-foreground">Claim free testnet tokens</p>
                    {wallet.isConnected && wallet.network !== "starknet" && (
                      <p className="text-xs text-warning mt-1">EVM connected – faucet Starknet only</p>
                    )}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {faucetTokens.map((token) => {
                  const walletReady = wallet.isConnected && wallet.network === "starknet"
                  const status = walletReady ? faucetStatus[token.symbol] : undefined
                  const canClaim = walletReady && (status?.can_claim ?? false)
                  const isLoading = faucetLoading[token.symbol]
                  const isDisabled = !canClaim || isLoading
                  const label = isLoading
                    ? "Claiming..."
                    : !wallet.isConnected
                    ? "Connect"
                    : wallet.network !== "starknet"
                    ? "Starknet only"
                    : !status
                    ? "Unavailable"
                    : canClaim
                    ? `+${token.amount}`
                    : "Cooldown"

                  return (
                    <DropdownMenuItem
                      key={token.symbol}
                      className={cn(
                        "flex items-center justify-between cursor-pointer py-3",
                        isDisabled && "opacity-50"
                      )}
                      onClick={() => handleClaimFaucet(token.symbol)}
                      disabled={isDisabled}
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">{token.symbol}</p>
                        <p className="text-xs text-muted-foreground">{token.name}</p>
                        {faucetTx[token.symbol] && (
                          <a
                            href={`https://sepolia.starkscan.co/tx/${faucetTx[token.symbol]}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-primary hover:underline"
                          >
                            View Tx
                          </a>
                        )}
                      </div>
                      <span className={cn(
                        "text-xs font-medium px-2 py-1 rounded",
                        canClaim ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"
                      )}>
                        {label}
                      </span>
                    </DropdownMenuItem>
                  )
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      window.open(STARKNET_FAUCET_URL, "_blank", "noopener,noreferrer")
                    }
                  }}
                >
                  Buka Starknet Faucet
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Network Selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                  Testnet
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 glass-strong border-border">
                <DropdownMenuItem className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-success" />
                    <span>{formatNetworkLabel("starknet")}</span>
                  </div>
                  <Check className="h-4 w-4 text-success" />
                </DropdownMenuItem>
                <DropdownMenuItem className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-success" />
                    <span>{formatNetworkLabel("evm")}</span>
                  </div>
                  <Check className="h-4 w-4 text-success" />
                </DropdownMenuItem>
                <DropdownMenuItem className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-success" />
                    <span>{formatNetworkLabel("btc")}</span>
                  </div>
                  <Check className="h-4 w-4 text-success" />
                </DropdownMenuItem>
                <DropdownMenuItem disabled className="flex items-center justify-between opacity-50">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                    <span>Mainnet</span>
                  </div>
                  <span className="text-xs text-muted-foreground">Soon</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Connect Wallet / Wallet Info */}
            {wallet?.isConnected ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="gap-2 border-primary/50 hover:bg-primary/10 bg-transparent"
                    title={connectedTestnetSummary}
                  >
                    <Wallet className="h-4 w-4 text-primary" />
                    <span className="font-mono text-xs">{shortenAddress(wallet.address)}</span>
                    <span className="hidden xl:inline text-[10px] font-medium text-success">Sepolia/Testnet</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-80 max-h-[75vh] overflow-y-auto glass-strong border-border"
                >
                  <div className="p-3 space-y-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Wallet Address</p>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="font-mono text-sm text-foreground">{wallet.address}</p>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6"
                          onClick={copyAddress}
                        >
                          {copiedAddress ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-lg border border-success/30 bg-success/10 p-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-success">Network Status</p>
                      <p className="mt-1 text-xs font-medium text-success">Connected to Sepolia/Testnet</p>
                      <p className="mt-1 text-xs text-foreground">{connectedTestnetSummary}</p>
                    </div>
                    <DropdownMenuSeparator />
                    <div>
                      <p className="text-xs text-muted-foreground">Linked Networks</p>
                      <div className="space-y-1 mt-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Starknet Sepolia</span>
                          <span className="font-mono text-foreground">{renderLinkStatus(wallet.starknetAddress)}</span>
                        </div>
                        {!wallet.starknetAddress && (
                          <div className="flex flex-wrap gap-1">
                            {starknetWalletProviders.map((starknetProvider) => (
                              <Button
                                key={`linked-${starknetProvider.id}`}
                                size="sm"
                                variant="secondary"
                                className="h-6 px-2 text-[10px]"
                                disabled={walletConnectPending}
                                onClick={() => handleWalletConnect(starknetProvider.id)}
                              >
                                {starknetProvider.icon} Connect {starknetProvider.name}
                              </Button>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">EVM (Sepolia)</span>
                          <span className="font-mono text-foreground">{renderLinkStatus(wallet.evmAddress)}</span>
                        </div>
                        {!wallet.evmAddress && (
                          <div>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-6 px-2 text-[10px]"
                              disabled={walletConnectPending}
                              onClick={() => handleWalletConnect("metamask")}
                            >
                              🦊 Connect MetaMask
                            </Button>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Bitcoin Testnet</span>
                          <span className="font-mono text-foreground">{renderLinkStatus(wallet.btcAddress)}</span>
                        </div>
                        {!wallet.btcAddress && (
                          <div className="flex flex-wrap gap-1">
                            {btcWalletProviders.map((btc) => (
                              <Button
                                key={`linked-${btc.id}`}
                                size="sm"
                                variant="secondary"
                                className="h-6 px-2 text-[10px]"
                                disabled={btcConnectPending}
                                onClick={() => handleBtcConnect(btc.id)}
                              >
                                {btc.icon} Connect {btc.name}
                              </Button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <DropdownMenuSeparator />
                    <div>
                      <p className="text-xs text-muted-foreground">Total Portfolio (backend)</p>
                      <p className="text-2xl font-bold text-foreground">${formatCurrency(wallet?.totalValueUSD)}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">Dari aktivitas backend, bukan saldo on-chain.</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">On-chain Balances (real testnet)</p>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div className="p-2 rounded-lg bg-surface/50">
                          <p className="text-xs text-muted-foreground">STRK L2</p>
                          <p className="text-sm font-medium">
                            {renderOnchainValue(
                              wallet?.onchainBalance?.STRK_L2,
                              !!wallet?.starknetAddress,
                              "Not linked"
                            )}
                          </p>
                          {!wallet?.starknetAddress && (
                            <p className="text-[10px] text-muted-foreground">Link Starknet wallet to read STRK L2</p>
                          )}
                          {!wallet?.starknetAddress && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {starknetWalletProviders.map((starknetProvider) => (
                                <Button
                                  key={starknetProvider.id}
                                  size="sm"
                                  variant="secondary"
                                  className="h-6 px-2 text-[10px]"
                                  disabled={walletConnectPending}
                                  onClick={() => handleWalletConnect(starknetProvider.id)}
                                >
                                  {starknetProvider.icon} {starknetProvider.name}
                                </Button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="p-2 rounded-lg bg-surface/50">
                          <p className="text-xs text-muted-foreground">STRK L1</p>
                          <p className="text-sm font-medium">
                            {renderOnchainValue(
                              wallet?.onchainBalance?.STRK_L1,
                              !!wallet?.evmAddress,
                              "Not linked"
                            )}
                          </p>
                          {!wallet?.evmAddress && (
                            <p className="text-[10px] text-muted-foreground">Link EVM wallet to read STRK L1</p>
                          )}
                          {wallet?.evmAddress && (
                            <p className="text-[10px] text-muted-foreground">ERC20 STRK on Ethereum Sepolia</p>
                          )}
                        </div>
                        <div className="p-2 rounded-lg bg-surface/50">
                          <p className="text-xs text-muted-foreground">ETH Sepolia</p>
                          <p className="text-sm font-medium">
                            {renderOnchainValue(
                              wallet?.onchainBalance?.ETH,
                              !!wallet?.evmAddress,
                              "Not linked"
                            )}
                          </p>
                          {!wallet?.evmAddress && (
                            <p className="text-[10px] text-muted-foreground">Link EVM wallet to read ETH L1</p>
                          )}
                          {!wallet?.evmAddress && (
                            <div className="mt-2">
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-6 px-2 text-[10px]"
                                disabled={walletConnectPending}
                                onClick={() => handleWalletConnect("metamask")}
                              >
                                🦊 MetaMask
                              </Button>
                            </div>
                          )}
                        </div>
                        <div className="p-2 rounded-lg bg-surface/50">
                          <p className="text-xs text-muted-foreground">BTC Testnet</p>
                          <p className="text-sm font-medium">
                            {renderOnchainValue(
                              wallet?.onchainBalance?.BTC,
                              !!wallet?.btcAddress,
                              "Not linked"
                            )}
                          </p>
                          {!wallet?.btcAddress && (
                            <p className="text-[10px] text-muted-foreground">Link BTC wallet to read BTC</p>
                          )}
                        </div>
                      </div>
                      {!wallet?.btcAddress && (
                        <div className="flex flex-wrap gap-2">
                          {btcWalletProviders.map((btc) => (
                            <Button
                              key={btc.id}
                              size="sm"
                              variant="secondary"
                              className="h-7 px-2 text-xs"
                              disabled={btcConnectPending}
                              onClick={() => handleBtcConnect(btc.id)}
                            >
                              {btc.icon} {btc.name}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Portfolio (effective)</p>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                      <div className="p-2 rounded-lg bg-surface/50">
                        <p className="text-xs text-muted-foreground">BTC</p>
                        <p className="text-sm font-medium">{formatAsset(effectivePortfolioBalance.BTC)}</p>
                      </div>
                      <div className="p-2 rounded-lg bg-surface/50">
                        <p className="text-xs text-muted-foreground">ETH</p>
                        <p className="text-sm font-medium">{formatAsset(effectivePortfolioBalance.ETH)}</p>
                      </div>
                      <div className="p-2 rounded-lg bg-surface/50">
                        <p className="text-xs text-muted-foreground">STRK</p>
                        <p className="text-sm font-medium">{formatAsset(effectivePortfolioBalance.STRK)}</p>
                      </div>
                      <div className="p-2 rounded-lg bg-surface/50">
                        <p className="text-xs text-muted-foreground">CAREL</p>
                        <p className="text-sm font-medium">{formatAsset(effectivePortfolioBalance.CAREL)}</p>
                      </div>
                      </div>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive cursor-pointer" onClick={wallet.disconnect}>
                    Disconnect Wallet
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button 
                onClick={() => setWalletDialogOpen(true)}
                className="bg-gradient-to-r from-primary to-accent hover:opacity-90 text-primary-foreground animate-pulse-glow"
              >
                <Wallet className="h-4 w-4 mr-2" />
                Connect Wallet
              </Button>
            )}

            {/* Notifications */}
            <DropdownMenu open={notificationsOpen} onOpenChange={setNotificationsOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative">
                  <Bell className="h-5 w-5" />
                  {Number(notifications?.unreadCount ?? 0) > 0 && (
                    <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-accent text-[10px] font-bold flex items-center justify-center text-accent-foreground animate-pulse">
                      {notifications.unreadCount}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 glass-strong border-border p-0">
                <div className="p-3 border-b border-border flex items-center justify-between">
                  <h3 className="font-medium text-foreground">Notifications</h3>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-7 text-xs"
                    onClick={notifications.markAllAsRead}
                  >
                    Mark all read
                  </Button>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {(!notifications?.notifications || notifications.notifications.length === 0) ? (
                    <div className="p-8 text-center text-muted-foreground">
                      <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No notifications</p>
                    </div>
                  ) : (
                    notifications.notifications.map((notif) => (
                      <div
                        key={notif.id}
                        className={cn(
                          "p-3 border-b border-border/50 hover:bg-surface/50 cursor-pointer transition-colors",
                          !notif.read && "bg-primary/5"
                        )}
                        onClick={() => notifications.markAsRead(notif.id)}
                      >
                        <div className="flex items-start gap-3">
                          <div className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                            notif.type === 'success' && "bg-success/20",
                            notif.type === 'error' && "bg-destructive/20",
                            notif.type === 'info' && "bg-secondary/20",
                            notif.type === 'warning' && "bg-accent/20"
                          )}>
                            {notif.type === 'success' && <CheckCircle className="h-4 w-4 text-success" />}
                            {notif.type === 'error' && <XCircle className="h-4 w-4 text-destructive" />}
                            {notif.type === 'info' && <Bell className="h-4 w-4 text-secondary" />}
                            {notif.type === 'warning' && <Zap className="h-4 w-4 text-accent" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground">{notif.title}</p>
                            <p className="text-xs text-muted-foreground mt-1">{notif.message}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatTime(notif.timestamp)}
                            </p>
                          </div>
                          {!notif.read && (
                            <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Profile / Airdrop */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <User className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 glass-strong border-border">
                <DropdownMenuLabel>
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Profile</p>
                      {wallet?.isConnected && (
                        <p className="text-xs text-muted-foreground font-mono">{shortenAddress(wallet.address)}</p>
                      )}
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="#portfolio" className="flex items-center gap-2">
                    <PieChart className="h-4 w-4" />
                    Portfolio
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="#leaderboard" className="flex items-center gap-2">
                    <Trophy className="h-4 w-4" />
                    Leaderboard
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="#rewards" className="flex items-center gap-2">
                    <Gift className="h-4 w-4" />
                    Rewards
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="#airdrop" className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-accent" />
                    <span>Airdrop</span>
                    <span className="ml-auto text-xs bg-accent/20 text-accent px-1.5 py-0.5 rounded">New</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="#settings" className="flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* More Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 glass-strong border-border">
                <DropdownMenuLabel>DeFi</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href="#trade" className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ArrowRightLeft className="h-4 w-4" />
                      Swap & Bridge
                    </div>
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="#limit-order" className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      Limit Order
                    </div>
                    <span className="text-xs text-secondary">Soon</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="#stake" className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Coins className="h-4 w-4" />
                      Stake & Earn
                    </div>
                    <span className="text-xs text-secondary">Soon</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Top Up</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setTopUpOpen(true)}>
                  <QrCode className="h-4 w-4 mr-2" />
                  Receive Crypto
                </DropdownMenuItem>
                <DropdownMenuItem disabled className="opacity-50 cursor-not-allowed">
                  <div className="flex items-center gap-2">
                    <Smartphone className="h-4 w-4" />
                    Buy with Fiat
                  </div>
                  <span className="ml-auto text-xs text-secondary">Soon</span>
                </DropdownMenuItem>
                <DropdownMenuItem disabled className="opacity-50 cursor-not-allowed">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Sell Crypto
                  </div>
                  <span className="ml-auto text-xs text-secondary">Soon</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setHelpOpen(true)}>
                  <HelpCircle className="h-4 w-4 mr-2" />
                  Help Center
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTxHistoryOpen(true)}>
                  <History className="h-4 w-4 mr-2" />
                  Transaction History
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPrivacyOpen(true)}>
                  <Lock className="h-4 w-4 mr-2" />
                  Privacy Router
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Mobile Menu Toggle */}
          <Button 
            variant="ghost" 
            size="icon" 
            className="lg:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-border glass-strong p-4">
            <div className="space-y-2">
              {!wallet?.isConnected && (
                <Button 
                  onClick={() => {
                    setWalletDialogOpen(true)
                    setMobileMenuOpen(false)
                  }}
                  className="w-full bg-gradient-to-r from-primary to-accent"
                >
                  <Wallet className="h-4 w-4 mr-2" />
                  Connect Wallet
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  setPrivacyOpen(true)
                  setMobileMenuOpen(false)
                }}
                className="w-full"
              >
                <Lock className="h-4 w-4 mr-2" />
                Privacy Router
              </Button>
              <Link href="#trade" className="block px-4 py-3 rounded-lg hover:bg-surface transition-colors">
                <div className="flex items-center gap-2">
                  <ArrowRightLeft className="h-5 w-5 text-primary" />
                  <span className="font-medium">Swap & Bridge</span>
                </div>
              </Link>
              <Link href="#portfolio" className="block px-4 py-3 rounded-lg hover:bg-surface transition-colors">
                <div className="flex items-center gap-2">
                  <PieChart className="h-5 w-5 text-primary" />
                  <span className="font-medium">Portfolio</span>
                </div>
              </Link>
              <Link href="#leaderboard" className="block px-4 py-3 rounded-lg hover:bg-surface transition-colors">
                <div className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-primary" />
                  <span className="font-medium">Leaderboard</span>
                </div>
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* Wallet Connection Dialog */}
      <Dialog open={walletDialogOpen} onOpenChange={setWalletDialogOpen}>
        <DialogContent className="glass-strong border-border">
          <DialogHeader>
            <DialogTitle>Connect Wallet</DialogTitle>
            <DialogDescription>Choose your preferred wallet to connect</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            {walletProviders.map((provider) => (
              <button
                key={provider.id}
                disabled={walletConnectPending}
                onClick={() => handleWalletConnect(provider.id)}
                className="flex items-center gap-3 p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span className="text-2xl">{provider.icon}</span>
                <span className="font-medium text-foreground">{provider.name}</span>
                <ChevronRight className="h-5 w-5 ml-auto text-muted-foreground" />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Transaction History Dialog with Filters */}
      <Dialog open={txHistoryOpen} onOpenChange={setTxHistoryOpen}>
        <DialogContent className="glass-strong border-border max-w-2xl">
          <DialogHeader>
            <DialogTitle>Transaction History</DialogTitle>
            <DialogDescription>View all your recent transactions</DialogDescription>
          </DialogHeader>
          
          {/* Filter Tabs */}
          <Tabs value={txFilter} onValueChange={setTxFilter} className="w-full">
            <TabsList className="grid w-full grid-cols-4 mb-4">
              {txFilters.map(filter => (
                <TabsTrigger key={filter.id} value={filter.id} className="text-xs">
                  {filter.label}
                </TabsTrigger>
              ))}
            </TabsList>
            
            <TabsContent value={txFilter} className="space-y-2 max-h-96 overflow-y-auto">
              {txHistoryLoading ? (
                <div className="text-center py-8">
                  <Loader2 className="h-8 w-8 mx-auto mb-2 text-muted-foreground animate-spin" />
                  <p className="text-sm text-muted-foreground">Loading transactions...</p>
                </div>
              ) : filteredTxHistory.length === 0 ? (
                <div className="text-center py-8">
                  <Clock className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
                  <p className="text-sm text-muted-foreground">No transactions found</p>
                </div>
              ) : (
                filteredTxHistory.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-surface/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center",
                        tx.status === 'completed' && "bg-success/20",
                        tx.status === 'pending' && "bg-secondary/20",
                        tx.status === 'failed' && "bg-destructive/20"
                      )}>
                        {tx.status === 'completed' && <CheckCircle className="h-5 w-5 text-success" />}
                        {tx.status === 'pending' && <Loader2 className="h-5 w-5 text-secondary animate-spin" />}
                        {tx.status === 'failed' && <XCircle className="h-5 w-5 text-destructive" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium capitalize">
                          {tx.type} {tx.from || "—"} {tx.to ? `→ ${tx.to}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">{tx.time || "—"}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{tx.value || "—"}</p>
                      <p className="text-xs text-muted-foreground">{tx.amount || "—"} {tx.from || ""}</p>
                    </div>
                  </div>
                ))
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Top Up Dialog */}
      <Dialog open={topUpOpen} onOpenChange={setTopUpOpen}>
        <DialogContent className="glass-strong border-border max-w-md">
          <DialogHeader>
            <DialogTitle>Top Up / Receive Crypto</DialogTitle>
            <DialogDescription>Add funds to your wallet</DialogDescription>
          </DialogHeader>
          
          <Tabs defaultValue="receive" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="receive">Receive</TabsTrigger>
              <TabsTrigger value="buy" disabled className="opacity-50">Buy</TabsTrigger>
              <TabsTrigger value="sell" disabled className="opacity-50">Sell</TabsTrigger>
            </TabsList>
            
            <TabsContent value="receive" className="space-y-4 pt-4">
              {/* QR Code Placeholder */}
              <div className="flex flex-col items-center p-6 rounded-xl bg-surface/50 border border-border">
                <div className="w-48 h-48 bg-background rounded-xl flex items-center justify-center border-2 border-dashed border-border mb-4">
                  <QrCode className="h-24 w-24 text-muted-foreground" />
                </div>
                <p className="text-xs text-muted-foreground mb-2">Your Wallet Address</p>
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono text-foreground bg-surface px-3 py-1.5 rounded">
                    {wallet?.isConnected ? wallet.address : "Connect wallet first"}
                  </code>
                  {wallet?.isConnected && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={copyAddress}>
                      {copiedAddress ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  )}
                </div>
              </div>
              
              {/* CEX Deposit Info */}
              <div className="p-4 rounded-lg bg-secondary/10 border border-secondary/20">
                <div className="flex items-start gap-3">
                  <Lock className="h-5 w-5 text-secondary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground">CEX Deposit - Coming Soon</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Direct deposit from centralized exchanges will be available in mainnet.
                    </p>
                  </div>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="buy" className="space-y-4 pt-4">
              <div className="p-8 rounded-xl bg-surface/30 border border-border text-center">
                <Lock className="h-12 w-12 text-secondary mx-auto mb-4" />
                <h4 className="font-medium text-foreground mb-2">Available in Mainnet</h4>
                <p className="text-sm text-muted-foreground">
                  Buy crypto with fiat currencies will be available after mainnet launch.
                </p>
                
                {/* Disabled Provider List */}
                <div className="mt-6 space-y-2">
                  {topUpProviders.map(provider => (
                    <div 
                      key={provider.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-surface/50 border border-border opacity-50"
                    >
                      <span className="text-xl">{provider.icon}</span>
                      <span className="text-sm text-foreground">{provider.name}</span>
                      <span className="ml-auto text-xs text-secondary">Coming Soon</span>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="sell" className="space-y-4 pt-4">
              <div className="p-8 rounded-xl bg-surface/30 border border-border text-center">
                <Lock className="h-12 w-12 text-secondary mx-auto mb-4" />
                <h4 className="font-medium text-foreground mb-2">Available in Mainnet</h4>
                <p className="text-sm text-muted-foreground">
                  Sell crypto for fiat currencies will be available after mainnet launch.
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Help Center Dialog */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="glass-strong border-border max-w-2xl">
          <DialogHeader>
            <DialogTitle>Help Center</DialogTitle>
            <DialogDescription>Get help with ZkCarel platform</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Link href="#tutorial-swap" className="p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-surface/50 transition-all">
              <h4 className="font-medium text-foreground mb-1">How to Swap</h4>
              <p className="text-sm text-muted-foreground">Learn how to swap tokens on ZkCarel</p>
            </Link>
            <Link href="#tutorial-bridge" className="p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-surface/50 transition-all">
              <h4 className="font-medium text-foreground mb-1">How to Bridge</h4>
              <p className="text-sm text-muted-foreground">Transfer assets across different networks</p>
            </Link>
            <div className="p-4 rounded-lg border border-border bg-surface/30">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-medium text-foreground">How to Use Limit Order</h4>
                <span className="text-xs bg-secondary/20 text-secondary px-2 py-0.5 rounded">Coming Soon</span>
              </div>
              <p className="text-sm text-muted-foreground">Set automatic trades at your target price</p>
            </div>
            <Link href="#tutorial-wallet" className="p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-surface/50 transition-all">
              <h4 className="font-medium text-foreground mb-1">Connect Wallet Tutorial</h4>
              <p className="text-sm text-muted-foreground">Learn how to connect various wallets</p>
            </Link>
            
            {/* Contact Support */}
            <div className="mt-4 p-4 rounded-lg bg-primary/10 border border-primary/20">
              <h4 className="font-medium text-foreground mb-2">Contact Support</h4>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-primary" />
                <a href="mailto:support@zkcarel.com" className="text-sm text-primary hover:underline">
                  support@zkcarel.com
                </a>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Privacy Router Dialog */}
      <Dialog open={privacyOpen} onOpenChange={setPrivacyOpen}>
        <DialogContent className="glass-strong border-border max-w-3xl">
          <DialogHeader>
            <DialogTitle>Privacy Router</DialogTitle>
            <DialogDescription>Submit privacy proofs (V2/V1) through the backend.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            <PrivacyRouterPanel compact />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
