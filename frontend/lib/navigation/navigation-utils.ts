import type { WalletProviderType, BtcWalletProviderType } from "@/hooks/wallet/use-wallet"
import {
  BTC_TESTNET_EXPLORER_BASE_URL,
  BTC_TESTNET_FAUCET_URL,
  ETH_SEPOLIA_FAUCET_URL,
  ETHERSCAN_SEPOLIA_BASE_URL,
  STRK_FAUCET_URL,
  STARKSCAN_SEPOLIA_BASE_URL,
} from "@/lib/network-config"
import {
  BTC_WALLET_PROVIDERS,
  STARKNET_WALLET_PROVIDERS,
  WALLET_PROVIDERS,
} from "@/lib/wallet-provider-config"

export const CAREL_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_CAREL_ADDRESS ||
  "0x0517f60f4ec4e1b2b748f0f642dfdcb32c0ddc893f777f2b595a4e4f6df51545"
export const DEV_WALLET_ADDRESS =
  process.env.NEXT_PUBLIC_DEV_WALLET_ADDRESS ||
  process.env.NEXT_PUBLIC_TREASURY_ADDRESS ||
  ""
export const ONE_CAREL_WEI_HEX = "0xde0b6b3a7640000"

export const walletProviders = WALLET_PROVIDERS as {
  id: WalletProviderType
  name: string
  icon: string
}[]
export const starknetWalletProviders = STARKNET_WALLET_PROVIDERS as {
  id: WalletProviderType
  name: string
  icon: string
}[]
export const btcWalletProviders = BTC_WALLET_PROVIDERS as {
  id: BtcWalletProviderType
  name: string
  icon: string
}[]

export const internalFaucetTokens = [
  { symbol: "CAREL", name: "Carel Protocol", amount: "25" },
  { symbol: "USDT", name: "Tether USD", amount: "25" },
  { symbol: "USDC", name: "USD Coin", amount: "25" },
]

export const externalFaucetLinks = [
  { symbol: "ETH", name: "Ethereum Sepolia", action: "Google Faucet", url: ETH_SEPOLIA_FAUCET_URL },
  { symbol: "STRK", name: "Starknet Sepolia", action: "Official Faucet", url: STRK_FAUCET_URL },
  { symbol: "BTC", name: "Bitcoin Testnet4", action: "Testnet4 Faucet", url: BTC_TESTNET_FAUCET_URL },
]

export const txFilters = [
  { id: "all", label: "All" },
  { id: "pending", label: "In Progress" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
]

export const topUpProviders = [
  { id: "qris", name: "QRIS", icon: "📱", available: false },
  { id: "dana", name: "Dana", icon: "💙", available: false },
  { id: "ovo", name: "OVO", icon: "💜", available: false },
  { id: "gopay", name: "GoPay", icon: "💚", available: false },
  { id: "bank", name: "Bank Transfer", icon: "🏦", available: false },
]

export type FaucetStatusMap = Record<
  string,
  { can_claim: boolean; next_claim_at?: string | null; last_claim_at?: string | null }
>

export type UiTx = {
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
  requestSource: "manual" | "ai"
}

export type DeFiFeatureTarget = "swap-bridge" | "limit-order" | "stake-earn"
export type ReceiveNetworkTarget = "starknet" | "evm" | "btc"

export type ReceiveTarget = {
  key: ReceiveNetworkTarget
  label: string
  chainHint: string
  address: string
  explorerLabel: string
  explorerUrl: string
}

export const formatCurrency = (value: unknown) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return "0"
  return n.toLocaleString()
}

export const formatAsset = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "—"
  if (!Number.isFinite(value)) return "—"
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 })
}

export const formatTime = (ts: unknown) => {
  if (!ts) return ""
  try {
    const d = ts instanceof Date ? ts : new Date(ts as any)
    if (isNaN(d.getTime())) return ""
    return d.toLocaleTimeString()
  } catch {
    return ""
  }
}

export const formatRelativeTime = (iso: string) => {
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

export const parseNumber = (value?: string | number | null) => {
  if (value === null || value === undefined) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const shortenAddress = (addr?: string | null) => {
  if (!addr) return ""
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export const renderLinkStatus = (addr?: string | null) => {
  if (!addr) return "Not linked"
  return shortenAddress(addr)
}

export const txExplorerLinks = (txHash?: string, txNetwork?: "starknet" | "evm" | "btc") => {
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
