import type { BtcWalletProviderType, WalletProviderType } from "@/lib/wallet-provider-config"

export interface WalletState {
  isConnected: boolean
  address: string | null
  provider: WalletProviderType | null
  balance: Record<string, number>
  onchainBalance: {
    STRK_L2: number | null
    STRK_L1: number | null
    ETH: number | null
    BTC: number | null
    CAREL: number | null
    USDC: number | null
    USDT: number | null
    WBTC: number | null
  }
  btcAddress?: string | null
  btcProvider?: BtcWalletProviderType | null
  starknetAddress?: string | null
  evmAddress?: string | null
  network: string
  token?: string | null
  totalValueUSD?: number
}
