"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { useWallet, type WalletProviderType, type BtcWalletProviderType } from "@/hooks/use-wallet"
import { useNotifications } from "@/hooks/use-notifications"
import {
  claimFaucet,
  getFaucetStatus,
  getProfile,
  getTransactionsHistory,
  setDisplayName,
  type Transaction,
} from "@/lib/api"
import { invokeStarknetCallFromWallet } from "@/lib/onchain-trade"
import {
  BTC_TESTNET_FAUCET_URL,
  BTC_TESTNET_EXPLORER_BASE_URL,
  ETH_SEPOLIA_FAUCET_URL,
  ETHERSCAN_SEPOLIA_BASE_URL,
  STRK_FAUCET_URL,
  STARKSCAN_SEPOLIA_BASE_URL,
  formatNetworkLabel,
} from "@/lib/network-config"
import {
  BTC_WALLET_PROVIDERS,
  STARKNET_WALLET_PROVIDERS,
  WALLET_PROVIDERS,
} from "@/lib/wallet-provider-config"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CarelBrandLogo } from "@/components/carel-logo"
import { PrivacyRouterPanel } from "@/components/privacy-router-panel"
import { ReferralLog } from "@/components/referral-log"
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
  Wallet, Bell, User, Menu, X, ArrowRightLeft, PieChart, Trophy, Gift, 
  History, Users, Settings, Droplets, ChevronDown, HelpCircle, Zap,
  Copy, Check, TrendingUp, Coins, QrCode, Lock,
  Smartphone, ChevronRight, Clock, XCircle, CheckCircle, Loader2, Mail
} from "lucide-react"

const CAREL_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_CAREL_ADDRESS ||
  "0x0517f60f4ec4e1b2b748f0f642dfdcb32c0ddc893f777f2b595a4e4f6df51545"
const DEV_WALLET_ADDRESS =
  process.env.NEXT_PUBLIC_DEV_WALLET_ADDRESS ||
  process.env.NEXT_PUBLIC_TREASURY_ADDRESS ||
  ""
const ONE_CAREL_WEI_HEX = "0xde0b6b3a7640000" // 1e18

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

const internalFaucetTokens = [
  { symbol: "CAREL", name: "Carel Protocol", amount: "25" },
  { symbol: "USDT", name: "Tether USD", amount: "25" },
  { symbol: "USDC", name: "USD Coin", amount: "25" },
]

const externalFaucetLinks = [
  { symbol: "ETH", name: "Ethereum Sepolia", action: "Google Faucet", url: ETH_SEPOLIA_FAUCET_URL },
  { symbol: "STRK", name: "Starknet Sepolia", action: "Official Faucet", url: STRK_FAUCET_URL },
  { symbol: "BTC", name: "Bitcoin Testnet4", action: "Testnet4 Faucet", url: BTC_TESTNET_FAUCET_URL },
]

// Transaction history filter options
const txFilters = [
  { id: "all", label: "All" },
  { id: "pending", label: "In Progress" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
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
  txHash?: string
  txNetwork?: "starknet" | "evm" | "btc"
}

/**
 * Handles `EnhancedNavigation` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
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
  const [referralLogOpen, setReferralLogOpen] = React.useState(false)
  const [faucetStatus, setFaucetStatus] = React.useState<FaucetStatusMap>({})
  const [faucetLoading, setFaucetLoading] = React.useState<Record<string, boolean>>({})
  const [faucetTx, setFaucetTx] = React.useState<Record<string, string>>({})
  const [copiedAddress, setCopiedAddress] = React.useState(false)
  const [txFilter, setTxFilter] = React.useState("all")
  const [txHistory, setTxHistory] = React.useState<UiTx[]>([])
  const [txHistoryLoading, setTxHistoryLoading] = React.useState(false)
  const [walletConnectPending, setWalletConnectPending] = React.useState(false)
  const [btcConnectPending, setBtcConnectPending] = React.useState(false)
  const [displayName, setDisplayNameState] = React.useState<string | null>(null)
  const [manualBtcAddress, setManualBtcAddress] = React.useState("")
  const [btcManualLinkPending, setBtcManualLinkPending] = React.useState(false)
  const seenBtcOptionalNoticeRef = React.useRef<Set<string>>(new Set())

  // --- Safe helpers ---
  const formatCurrency = (value: unknown) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return "0"
    return n.toLocaleString()
  }

  /**
   * Parses or transforms values for `formatAsset`.
   *
   * @param value - Input used by `formatAsset` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const formatAsset = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "—"
    if (!Number.isFinite(value)) return "—"
    return value.toLocaleString(undefined, { maximumFractionDigits: 6 })
  }

  /**
   * Parses or transforms values for `formatTime`.
   *
   * @param ts - Input used by `formatTime` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
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

  /**
   * Parses or transforms values for `formatRelativeTime`.
   *
   * @param iso - Input used by `formatRelativeTime` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
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

  /**
   * Parses or transforms values for `parseNumber`.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const parseNumber = (value?: string | number | null) => {
    if (value === null || value === undefined) return 0
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  /**
   * Handles `shortenAddress` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const shortenAddress = (addr?: string | null) => {
    if (!addr) return ""
    if (addr.length <= 12) return addr
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  /**
   * Handles `renderLinkStatus` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const renderLinkStatus = (addr?: string | null) => {
    if (!addr) return "Not linked"
    return shortenAddress(addr)
  }

  /**
   * Handles `txExplorerLinks` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const txExplorerLinks = (txHash?: string, txNetwork?: "starknet" | "evm" | "btc") => {
    if (!txHash) return []
    if (txNetwork === "evm") {
      return [{ label: "Etherscan", url: `${ETHERSCAN_SEPOLIA_BASE_URL}/tx/${txHash}` }]
    }
    if (txNetwork === "starknet") {
      return [{ label: "Explorer", url: `${STARKSCAN_SEPOLIA_BASE_URL}/tx/${txHash}` }]
    }
    if (txNetwork === "btc") {
      const btcHash = txHash.startsWith("0x") ? txHash.slice(2) : txHash
      return [{ label: "Mempool", url: `${BTC_TESTNET_EXPLORER_BASE_URL}/tx/${btcHash}` }]
    }
    return [{ label: "Explorer", url: `${STARKSCAN_SEPOLIA_BASE_URL}/tx/${txHash}` }]
  }

  const effectiveStarknetAddress =
    wallet.starknetAddress || (wallet.network === "starknet" ? wallet.address : null)

  const connectedTestnets = React.useMemo(() => {
    const labels: string[] = []
    if (effectiveStarknetAddress) labels.push(formatNetworkLabel("starknet"))
    if (wallet.evmAddress) labels.push(formatNetworkLabel("evm"))
    if (wallet.btcAddress) labels.push(formatNetworkLabel("btc"))
    return labels
  }, [effectiveStarknetAddress, wallet.evmAddress, wallet.btcAddress])

  const connectedTestnetSummary =
    connectedTestnets.length > 0
      ? `Connected to ${connectedTestnets.join(" + ")}`
      : "Connected, but no testnet wallet linked yet."
  const primaryConnectedTestnet = React.useMemo(() => {
    if (effectiveStarknetAddress) return formatNetworkLabel("starknet")
    if (wallet.evmAddress) return formatNetworkLabel("evm")
    if (wallet.btcAddress) return formatNetworkLabel("btc")
    return "Testnet"
  }, [effectiveStarknetAddress, wallet.evmAddress, wallet.btcAddress])
  const networkStatusHeadline = React.useMemo(() => {
    if (primaryConnectedTestnet === "Testnet") {
      return "Connected, no testnet wallet linked yet."
    }
    return `Connected to ${primaryConnectedTestnet}`
  }, [primaryConnectedTestnet])

  const hasStarknetBalanceSource = Boolean(effectiveStarknetAddress)
  const preferOnchainOrBackend = React.useCallback(
    (onchainValue: number | null | undefined, backendValue: number | undefined) => {
      if (typeof onchainValue === "number" && Number.isFinite(onchainValue) && onchainValue > 0) {
        return onchainValue
      }
      return backendValue ?? 0
    },
    []
  )
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
        hasStarknetBalanceSource
          ? preferOnchainOrBackend(wallet.onchainBalance?.STRK_L2, wallet.balance?.STRK)
          : wallet.evmAddress &&
            wallet.onchainBalance?.STRK_L1 !== null &&
            wallet.onchainBalance?.STRK_L1 !== undefined
          ? wallet.onchainBalance.STRK_L1
          : wallet.balance?.STRK ?? 0,
      CAREL:
        hasStarknetBalanceSource
          ? preferOnchainOrBackend(wallet.onchainBalance?.CAREL, wallet.balance?.CAREL)
          : wallet.balance?.CAREL ?? 0,
      USDC:
        hasStarknetBalanceSource
          ? preferOnchainOrBackend(wallet.onchainBalance?.USDC, wallet.balance?.USDC)
          : wallet.balance?.USDC ?? 0,
      USDT:
        hasStarknetBalanceSource
          ? preferOnchainOrBackend(wallet.onchainBalance?.USDT, wallet.balance?.USDT)
          : wallet.balance?.USDT ?? 0,
      WBTC:
        hasStarknetBalanceSource
          ? preferOnchainOrBackend(wallet.onchainBalance?.WBTC, wallet.balance?.WBTC)
          : wallet.balance?.WBTC ?? 0,
    }),
    [
      wallet.balance?.BTC,
      wallet.balance?.CAREL,
      wallet.balance?.ETH,
      wallet.balance?.STRK,
      wallet.balance?.USDC,
      wallet.balance?.USDT,
      wallet.balance?.WBTC,
      wallet.btcAddress,
      wallet.evmAddress,
      wallet.onchainBalance?.BTC,
      wallet.onchainBalance?.CAREL,
      wallet.onchainBalance?.ETH,
      wallet.onchainBalance?.STRK_L1,
      wallet.onchainBalance?.STRK_L2,
      wallet.onchainBalance?.USDC,
      wallet.onchainBalance?.USDT,
      wallet.onchainBalance?.WBTC,
      hasStarknetBalanceSource,
      preferOnchainOrBackend,
    ]
  )

  const shouldEmitBtcOptionalNotice = React.useCallback((message: string) => {
    if (seenBtcOptionalNoticeRef.current.has(message)) {
      return false
    }
    seenBtcOptionalNoticeRef.current.add(message)
    return true
  }, [])

  React.useEffect(() => {
    if (!wallet.isConnected || !effectiveStarknetAddress) {
      setFaucetStatus({})
      return
    }
    let active = true
    ;(async () => {
      try {
        const response = await getFaucetStatus({
          starknetAddress: effectiveStarknetAddress,
        })
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
  }, [wallet.isConnected, wallet.token, effectiveStarknetAddress])

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
            txHash: tx.tx_hash,
            txNetwork: tx.tx_type === "bridge"
              ? String(tx.token_in || "").toUpperCase() === "ETH"
                ? "evm"
                : String(tx.token_in || "").toUpperCase() === "BTC"
                ? "btc"
                : "starknet"
              : "starknet",
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
  }, [
    txHistoryOpen,
    wallet.isConnected,
    wallet.totalValueUSD,
    wallet.balance?.STRK,
    wallet.balance?.CAREL,
    wallet.balance?.USDC,
    wallet.balance?.USDT,
    wallet.balance?.WBTC,
  ])

  React.useEffect(() => {
    if (!wallet.isConnected) {
      setDisplayNameState(null)
      return
    }
    let active = true
    ;(async () => {
      try {
        const profile = await getProfile()
        if (!active) return
        setDisplayNameState(profile.display_name || null)
      } catch {
        if (!active) return
        setDisplayNameState(null)
      }
    })()
    return () => {
      active = false
    }
  }, [wallet.isConnected, wallet.token, wallet.address])

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

  /**
   * Handles `handleBtcConnect` logic.
   *
   * @param provider - Input used by `handleBtcConnect` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
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
      if (missingExtension) {
        const optionalMessage = `${message} For STRK/ETH trading, continue with MetaMask + Braavos/ArgentX without BTC wallet, or manually link a BTC testnet address in the wallet panel.`
        if (shouldEmitBtcOptionalNotice(optionalMessage)) {
          notifications.addNotification({
            type: "warning",
            title: "BTC wallet optional",
            message: optionalMessage,
          })
        }
      } else {
        notifications.addNotification({
          type: "error",
          title: "BTC wallet connection failed",
          message,
        })
      }
    } finally {
      setBtcConnectPending(false)
    }
  }

  /**
   * Handles `handleSetDisplayName` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleSetDisplayName = async () => {
    if (!wallet.isConnected) {
      notifications.addNotification({
        type: "error",
        title: "Wallet not connected",
        message: "Connect wallet first before changing display name.",
      })
      return
    }

    const initial = displayName || ""
    const input = window.prompt(
      "Enter a new display name (3-24 chars, letters/numbers/_/-). The second change onward costs 1 CAREL on-chain.",
      initial
    )
    const nextName = (input || "").trim()
    if (!nextName) return

    try {
      const saved = await setDisplayName({ display_name: nextName })
      setDisplayNameState(saved.display_name || nextName)
      notifications.addNotification({
        type: "success",
        title: "Display name updated",
        message: `Name saved: ${saved.display_name || nextName}`,
      })
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update display name."
      const needsPayment =
        /requires 1 CAREL|rename_onchain_tx_hash|payment to DEV wallet/i.test(message)
      if (!needsPayment) {
        notifications.addNotification({
          type: "error",
          title: "Update failed",
          message,
        })
        return
      }
    }

    if (!DEV_WALLET_ADDRESS || !CAREL_TOKEN_ADDRESS) {
      notifications.addNotification({
        type: "error",
        title: "Config missing",
        message:
          "NEXT_PUBLIC_DEV_WALLET_ADDRESS / NEXT_PUBLIC_TOKEN_CAREL_ADDRESS is not set.",
      })
      return
    }

    const providerHint =
      wallet.provider === "argentx" || wallet.provider === "braavos"
        ? wallet.provider
        : "starknet"

    try {
      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message: "Confirm 1 CAREL transfer to change display name.",
      })
      const txHash = await invokeStarknetCallFromWallet(
        {
          contractAddress: CAREL_TOKEN_ADDRESS,
          entrypoint: "transfer",
          calldata: [DEV_WALLET_ADDRESS, ONE_CAREL_WEI_HEX, "0x0"],
        },
        providerHint
      )
      notifications.addNotification({
        type: "info",
        title: "Rename fee pending",
        message: `Transfer 1 CAREL submitted (${txHash.slice(0, 10)}...).`,
        txHash,
        txNetwork: "starknet",
      })

      const saved = await setDisplayName({
        display_name: nextName,
        rename_onchain_tx_hash: txHash,
      })
      setDisplayNameState(saved.display_name || nextName)
      notifications.addNotification({
        type: "success",
        title: "Display name updated",
        message: `Name updated: ${saved.display_name || nextName}`,
        txHash,
        txNetwork: "starknet",
      })
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Rename failed",
        message: error instanceof Error ? error.message : "Failed to change display name.",
      })
    }
  }

  /**
   * Handles `handleManualBtcLink` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleManualBtcLink = async () => {
    if (btcManualLinkPending) return
    setBtcManualLinkPending(true)
    try {
      await wallet.linkBtcAddress(manualBtcAddress)
      notifications.addNotification({
        type: "success",
        title: "BTC address linked",
        message: "Bitcoin testnet address linked successfully.",
      })
      setManualBtcAddress("")
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Failed to link BTC address",
        message: error instanceof Error ? error.message : "Unable to link BTC address",
      })
    } finally {
      setBtcManualLinkPending(false)
    }
  }

  const openExternalFaucet = React.useCallback((url: string) => {
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer")
    }
  }, [])

  /**
   * Handles `handleClaimFaucet` logic.
   *
   * @param symbol - Input used by `handleClaimFaucet` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleClaimFaucet = async (symbol: string) => {
    if (!wallet.isConnected) {
      notifications.addNotification({
        type: "error",
        title: "Wallet not connected",
        message: "Connect your wallet to claim faucet tokens.",
      })
      return
    }
    if (!effectiveStarknetAddress) {
      notifications.addNotification({
        type: "warning",
        title: "Starknet wallet required",
        message: "Connect or link your Starknet wallet first.",
      })
      return
    }

    const status = faucetStatus[symbol]
    if (!status?.can_claim || faucetLoading[symbol]) return

    setFaucetLoading((prev) => ({ ...prev, [symbol]: true }))
    try {
      const result = await claimFaucet(symbol, {
        starknetAddress: effectiveStarknetAddress,
      })
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
        title: "Token faucet masuk",
        message: `Berhasil claim ${result.amount} ${result.token}. Tx: ${shortTx || "N/A"}.`,
        txHash,
        txNetwork: txHash ? "starknet" : undefined,
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

  /**
   * Handles `copyAddress` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
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
            <CarelBrandLogo
              iconSize={34}
              markClassName="transition-transform duration-300 group-hover:scale-[1.04]"
              labelClassName="text-xl font-bold tracking-wider text-foreground transition-colors group-hover:text-primary carel-tech-title"
            />
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
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-2 pb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Internal (25/day)
                  </p>
                </div>
                {internalFaucetTokens.map((token) => {
                  const walletReady = wallet.isConnected && Boolean(effectiveStarknetAddress)
                  const status = walletReady ? faucetStatus[token.symbol] : undefined
                  const canClaim = walletReady && (status?.can_claim ?? false)
                  const isLoading = faucetLoading[token.symbol]
                  const nextClaimAtMs = status?.next_claim_at
                    ? new Date(status.next_claim_at).getTime()
                    : NaN
                  const isCooldown =
                    Number.isFinite(nextClaimAtMs) && nextClaimAtMs > Date.now()
                  const isDisabled = !canClaim || isLoading
                  const label = isLoading
                    ? "Claiming..."
                    : !wallet.isConnected
                    ? "Connect"
                    : !effectiveStarknetAddress
                    ? "Link Starknet"
                    : !status
                    ? "Unavailable"
                    : canClaim
                    ? `+${token.amount}`
                    : isCooldown
                    ? "Cooldown"
                    : "Unavailable"

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
                            href={`${STARKSCAN_SEPOLIA_BASE_URL}/tx/${faucetTx[token.symbol]}`}
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
                <div className="px-2 pb-1 pt-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    External
                  </p>
                </div>
                {externalFaucetLinks.map((token) => (
                  <DropdownMenuItem
                    key={token.symbol}
                    className="flex items-center justify-between cursor-pointer py-3"
                    onClick={() => openExternalFaucet(token.url)}
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">{token.symbol}</p>
                      <p className="text-xs text-muted-foreground">{token.name}</p>
                    </div>
                    <span className="text-xs font-medium px-2 py-1 rounded bg-primary/15 text-primary">
                      {token.action}
                    </span>
                  </DropdownMenuItem>
                ))}
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
                    <span className="hidden xl:inline text-[10px] font-medium text-success">
                      {primaryConnectedTestnet}
                    </span>
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
                      <p className="mt-1 text-xs font-medium text-success">{networkStatusHeadline}</p>
                      <p className="mt-1 text-xs text-foreground">{connectedTestnetSummary}</p>
                    </div>
                    <DropdownMenuSeparator />
                    <div>
                      <p className="text-xs text-muted-foreground">Linked Networks</p>
                      <div className="space-y-1 mt-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Starknet Sepolia</span>
                          <span className="font-mono text-foreground">{renderLinkStatus(effectiveStarknetAddress)}</span>
                        </div>
                        {!effectiveStarknetAddress && (
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
                          <span className="text-muted-foreground">ETH Sepolia</span>
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
                        {!wallet.btcAddress && (
                          <div className="mt-2 rounded-md border border-border/60 bg-surface/40 p-2">
                            <p className="text-[10px] text-muted-foreground">
                              No BTC extension found? Link a Bitcoin testnet address manually.
                            </p>
                            <div className="mt-1 flex items-center gap-1">
                              <Input
                                value={manualBtcAddress}
                                onChange={(event) => setManualBtcAddress(event.target.value)}
                                placeholder="tb1..."
                                className="h-7 text-[10px] font-mono"
                              />
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 px-2 text-[10px]"
                                disabled={btcManualLinkPending || !manualBtcAddress.trim()}
                                onClick={handleManualBtcLink}
                              >
                                {btcManualLinkPending ? "Linking..." : "Link"}
                              </Button>
                            </div>
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
                      <div className="p-2 rounded-lg bg-surface/50">
                        <p className="text-xs text-muted-foreground">USDC</p>
                        <p className="text-sm font-medium">{formatAsset(effectivePortfolioBalance.USDC)}</p>
                      </div>
                      <div className="p-2 rounded-lg bg-surface/50">
                        <p className="text-xs text-muted-foreground">USDT</p>
                        <p className="text-sm font-medium">{formatAsset(effectivePortfolioBalance.USDT)}</p>
                      </div>
                      <div className="p-2 rounded-lg bg-surface/50">
                        <p className="text-xs text-muted-foreground">WBTC</p>
                        <p className="text-sm font-medium">{formatAsset(effectivePortfolioBalance.WBTC)}</p>
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
                            {notif.txHash && (
                              <p className="text-xs text-primary mt-1 font-mono">
                                Tx: {shortenAddress(notif.txHash)}
                              </p>
                            )}
                            {notif.txExplorerUrls && notif.txExplorerUrls.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-2">
                                {notif.txExplorerUrls.map((link) => (
                                  <a
                                    key={`${notif.id}-${link.url}`}
                                    href={link.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(event) => event.stopPropagation()}
                                    className="text-[11px] text-primary hover:underline"
                                  >
                                    {link.label}
                                  </a>
                                ))}
                              </div>
                            )}
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
                      {wallet?.isConnected && displayName && (
                        <p className="text-xs text-primary mt-0.5">{displayName}</p>
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
                <DropdownMenuItem onClick={() => setReferralLogOpen(true)}>
                  <Users className="h-4 w-4 mr-2" />
                  Referral
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      window.dispatchEvent(new Event("carel:open-loyalty-hub"))
                    }
                  }}
                >
                  <Gift className="h-4 w-4 mr-2" />
                  Loyalty Hub
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="#airdrop" className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-accent" />
                    <span>Airdrop</span>
                    <span className="ml-auto text-xs bg-accent/20 text-accent px-1.5 py-0.5 rounded">New</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleSetDisplayName}
                  disabled={!wallet?.isConnected}
                  className={!wallet?.isConnected ? "opacity-50 cursor-not-allowed" : ""}
                >
                  <User className="h-4 w-4 mr-2" />
                  {displayName ? "Change Display Name" : "Set Display Name"}
                </DropdownMenuItem>
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
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Starknet / EVM
            </p>
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
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Bitcoin Native (Testnet)
            </p>
            {btcWalletProviders.map((provider) => (
              <button
                key={provider.id}
                disabled={btcConnectPending}
                onClick={() => handleBtcConnect(provider.id)}
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

      <ReferralLog
        isOpen={referralLogOpen}
        onOpenChange={setReferralLogOpen}
        showTrigger={false}
      />

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
                        {tx.txHash && (
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-mono text-primary">
                              {shortenAddress(tx.txHash)}
                            </span>
                            {txExplorerLinks(tx.txHash, tx.txNetwork).map((link) => (
                              <a
                                key={`${tx.id}-${link.url}`}
                                href={link.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[10px] text-primary hover:underline"
                              >
                                {link.label}
                              </a>
                            ))}
                          </div>
                        )}
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
            <DialogDescription>Get help with Carel Protocol platform</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Link href="#tutorial-swap" className="p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-surface/50 transition-all">
              <h4 className="font-medium text-foreground mb-1">How to Swap</h4>
              <p className="text-sm text-muted-foreground">Learn how to swap tokens on Carel Protocol</p>
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
                <a href="mailto:support@carelprotocol.com" className="text-sm text-primary hover:underline">
                  support@carelprotocol.com
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
