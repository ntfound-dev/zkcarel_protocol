export type { NFTItem } from "@/lib/api"

export type TokenCatalogItem = {
  symbol: string
  name: string
  icon: string
  price: number
  network: string
}

export type TokenWithBalance = TokenCatalogItem & { balance: number }

export type PendingBtcDepositState = {
  bridgeId: string
  depositAddress: string
  amountSats: number
  destinationChain: string
  requestSource?: "manual" | "ai"
  burnTxHash?: string | null
  status?: string
  txHash?: string | null
  sourceInitiateTxHash?: string | null
  destinationInitiateTxHash?: string | null
  destinationRedeemTxHash?: string | null
  refundTxHash?: string | null
  instantRefundTx?: string | null
  instantRefundHash?: string | null
  lastUpdatedAt?: number
}

export type TradeResultPopupState = {
  status: "success" | "error"
  title: string
  message: string
  txHash?: string
}

export type PendingHideNoteRecord = {
  note_version: "v4"
  note_commitment: string
  note_deposit_tx_hash?: string
  nullifier?: string
  executor_address?: string
  verifier?: string
  root?: string
  proof?: string[]
  public_inputs?: string[]
  noir_inputs?: Record<string, unknown>
  denom_id?: string
  token_symbol?: string
  target_token_symbol?: string
  amount?: string
  deposited_at_unix: number
  spendable_at_unix?: number
}

export type GardenOrderProgress = {
  status: string
  sourceInitiateTxHash: string
  destinationInitiateTxHash: string
  destinationRedeemTxHash: string
  sourceRefundTxHash: string
  destinationRefundTxHash: string
  instantRefundTx: string
  isCompleted: boolean
  isRefunded: boolean
  isExpired: boolean
  isRefundable: boolean
}

export type QuoteState = {
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

export type QuoteCacheEntry = {
  expiresAt: number
  quote: QuoteState
  toAmount: string
  quoteError: string | null
}

export type BridgeRewardsSnapshot = {
  estimatedPoints: number
  discountPercent: number
  aiBonusPercent: number
  pointsPending: boolean
  updatedAt: number
}
