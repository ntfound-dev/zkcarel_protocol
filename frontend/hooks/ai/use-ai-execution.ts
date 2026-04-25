import * as React from "react"
import {
  autoSubmitPrivacyAction,
  cancelLimitOrder,
  createLimitOrder,
  executeAiCommand,
  executeBridge,
  executeSwap,
  fetchPrivacyFixedAmount,
  getBridgeQuote,
  getPortfolioAnalytics,
  getPortfolioBalance,
  getRewardsPoints,
  getStakePools,
  getStakePositions,
  getSwapQuote,
  getTokenOHLCV,
  listLimitOrders,
  stakeClaim,
  stakeDeposit,
  type PrivacyVerificationPayload,
} from "@/lib/api"
import { resolveNoirInputs } from "@/lib/privacy/noir-inputs"
import {
  decimalToU256Parts,
  invokeStarknetCallFromWallet,
  invokeStarknetCallsFromWallet,
  readStarknetShieldedPoolFixedAmountFromWallet,
  sendEvmTransactionFromWallet,
  toHexFelt,
  type StarknetInvokeCall,
} from "@/lib/onchain-trade"
import {
  markAiLimitOrder,
  markAiStakePosition,
  markAiTransaction,
} from "@/lib/ai-execution-source"
import {
  AI_HIDE_AUTO_EXECUTE_AFTER_COOLDOWN,
  AI_HIDE_MIN_NOTE_AGE_MS,
  AI_HIDE_USDT_TIER_OPTIONS,
  AI_REQUIRE_FRESH_SETUP_PER_EXECUTION,
  AI_TOKEN_ADDRESS_MAP,
  AI_TOKEN_DECIMALS,
  BRIDGE_COMMAND_REGEX,
  SUPPORTED_LIMIT_ORDER_TOKENS,
  SUPPORTED_STAKE_TOKENS,
  SUPPORTED_SWAP_TOKENS,
  bridgeAddressRequirementError,
  bridgeTargetChainForToken,
  buildGardenOrderExplorerUrl,
  buildPrivateHideTierHint,
  buildTxExplorerUrl,
  executionBurnAmountCarel,
  formatBtcFromSats,
  formatDurationHhMmSs,
  formatExecutionFailureMessage,
  formatSwapMinAmountOut,
  inferHideTierFromPrivateCommand,
  incrementalTierUpgradeCost,
  isAffirmativeConfirmation,
  isNegativeConfirmation,
  isRelayerAllowanceErrorMessage,
  isWalletMulticallPayloadError,
  isSupportedBridgePair,
  isWalletCancellationMessage,
  invokeWalletCallsWithSequentialFallback,
  normalizeAiCommandInput,
  normalizeHexArray,
  normalizeMessageText,
  nowTimestampLabel,
  parseBridgeTokensFromCommand,
  parseLimitOrderIdFromCancelCommand,
  parseLimitOrderIntentFromCommand,
  parseStakeTokenAmountFromCommand,
  parseStakeTokenHintFromCommand,
  parseSwapTokensFromCommand,
  requiresOnchainActionForCommand,
  resolveStakeTokenSymbol,
  sanitizeDecimalInput,
  scaledBigIntToDecimalString,
  shortAddress,
  trimDecimalZeros,
  type AiHideUsdtTierOption,
} from "@/lib/ai-parser"
import { computeTradeDeadlineSeconds } from "@/lib/trade/trading-utils"
import { useNotifications } from "@/hooks/notifications/use-notifications"
import type { WalletContextType } from "@/hooks/wallet/use-wallet"

const HIDE_BALANCE_RELAYER_POOL_ENABLED =
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_ENABLED || "false").toLowerCase() === "true"
const HIDE_BALANCE_RELAYER_POOL_LIMIT_ENABLED =
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_LIMIT_ENABLED || "false").toLowerCase() ===
  "true"
const PRIVATE_ACTION_EXECUTOR_ADDRESS = (
  process.env.NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS || ""
).trim()
const HIDE_BALANCE_RELAYER_APPROVE_MAX =
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_RELAYER_APPROVE_MAX || "false").toLowerCase() === "true"
const HIDE_BALANCE_EXECUTOR_KIND = (process.env.NEXT_PUBLIC_HIDE_BALANCE_EXECUTOR_KIND || "")
  .trim()
  .toLowerCase()
const HIDE_BALANCE_SHIELDED_POOL_V4 =
  HIDE_BALANCE_EXECUTOR_KIND === "shielded_pool_v4" ||
  HIDE_BALANCE_EXECUTOR_KIND === "shielded-v4" ||
  HIDE_BALANCE_EXECUTOR_KIND === "v4"
const HIDE_BALANCE_SHIELDED_POOL = HIDE_BALANCE_SHIELDED_POOL_V4
const HIDE_BALANCE_NOTE_VERSION = HIDE_BALANCE_SHIELDED_POOL_V4 ? "v4" : undefined
const DEFAULT_AI_SWAP_SLIPPAGE_PERCENT = 0.5
const DEFAULT_AI_SWAP_MODE = "transparent"
const STARKNET_ZK_PRIVACY_ROUTER_ADDRESS =
  process.env.NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS ||
  process.env.NEXT_PUBLIC_PRIVACY_ROUTER_ADDRESS ||
  ""
const STARKNET_STAKING_CAREL_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_STAKING_CAREL_ADDRESS ||
  process.env.NEXT_PUBLIC_STAKING_CAREL_ADDRESS ||
  ""
const STARKNET_STAKING_STABLECOIN_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_STAKING_STABLECOIN_ADDRESS ||
  process.env.NEXT_PUBLIC_STAKING_STABLECOIN_ADDRESS ||
  ""
const STARKNET_STAKING_WBTC_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_STAKING_WBTC_ADDRESS ||
  process.env.NEXT_PUBLIC_STAKING_WBTC_ADDRESS ||
  ""
const STARKNET_LIMIT_ORDER_BOOK_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_LIMIT_ORDER_BOOK_ADDRESS ||
  process.env.NEXT_PUBLIC_LIMIT_ORDER_BOOK_ADDRESS ||
  ""
const GARDEN_STARKNET_APPROVE_SELECTOR = "0x219209e083275171774dab1df80982e9df2096516f06319c5c6d71ae0a8480c"
const GARDEN_STARKNET_INITIATE_SELECTOR = "0x2aed25fcd0101fcece997d93f9d0643dfa3fbd4118cae16bf7d6cd533577c28"
const U256_MAX_WORD_HEX = "0xffffffffffffffffffffffffffffffff"
const U256_MASK_128 = (BigInt(1) << BigInt(128)) - BigInt(1)
const AI_PRIVACY_PENDING_NOTES_KEY = "ai_privacy_pending_notes_v4"
const AI_PRIVACY_PENDING_NOTES_UPDATED_EVENT = "ai-privacy-pending-notes-updated"
const TRADE_PENDING_BTC_DEPOSIT_KEY = "trade_pending_btc_deposit_v1"
const TRADE_PENDING_BTC_DEPOSITS_KEY = "trade_pending_btc_deposits_v1"

const LIVE_DATA_PRIORITY_ACTIONS = new Set([
  "get_swap_quote",
  "get_bridge_quote",
  "show_balance",
  "show_points_breakdown",
  "show_chart",
])

type UseAiExecutionParams = {
  input: string
  setInput: React.Dispatch<React.SetStateAction<string>>
  selectedTier: number
  unlockedTier: number
  selectedAiHideTier: AiHideUsdtTierOption
  setAiHideUsdtTierMin: React.Dispatch<React.SetStateAction<number>>
  notifications: ReturnType<typeof useNotifications>
  wallet: WalletContextType
  messages: Array<{ role: "user" | "assistant"; content: string; timestamp: string }>
  appendMessagesForTier: (
    tier: number,
    messages: Array<{ role: "user" | "assistant"; content: string; timestamp: string }>
  ) => void
  isLoadingTier: boolean
  isUpgradingTier: boolean
  commandNeedsAction: boolean
  planId: string
  hasPlanReady: boolean
  aiPlanEnabled: boolean
  isBackgroundPreparingAction: boolean
  hasPreparedActionReady: boolean
  resolveActionId: (
    requiredForCommand: boolean,
    options?: { forceRefresh?: boolean; requireFresh?: boolean }
  ) => Promise<number>
  setActionId: React.Dispatch<React.SetStateAction<string>>
  setPendingActions: React.Dispatch<React.SetStateAction<number[]>>
  getLastBurnTxHash: () => string
}

type UseAiExecutionResult = {
  handleSend: () => Promise<void>
  isSending: boolean
}

interface PendingExecutionConfirmation {
  tier: number
  command: string
  createdAt: number
}

type HideBalanceNoteVersion = "v4"

type AiPendingHideNoteRecord = {
  note_version: HideBalanceNoteVersion
  note_commitment: string
  nullifier?: string
  executor_address?: string
  verifier?: string
  root?: string
  proof?: string[]
  public_inputs?: string[]
  denom_id?: string
  token_symbol?: string
  target_token_symbol?: string
  amount?: string
  deposited_at_unix: number
  spendable_at_unix?: number
}

type AiPendingBtcDepositRecord = {
  bridgeId: string
  depositAddress: string
  amountSats: number
  destinationChain: string
  requestSource?: "manual" | "ai" | string
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

type AIData = Record<string, unknown> | null | undefined

const resolveStarknetProviderHint = (
  provider: string | null
): "starknet" | "argentx" | "braavos" => {
  if (provider === "argentx" || provider === "braavos") return provider
  return "starknet"
}

const waitMs = async (delayMs: number): Promise<void> => {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

const toU256HexPartsFromBigInt = (value: bigint): [string, string] => {
  const safe = value < BigInt(0) ? BigInt(0) : value
  const low = safe & U256_MASK_128
  const high = safe >> BigInt(128)
  return [toHexFelt(low), toHexFelt(high)]
}

const toBigIntFromU256 = (value?: { amount_low?: string; amount_high?: string } | null) => {
  if (!value) return null
  try {
    const low = BigInt((value.amount_low ?? "0").toString())
    const high = BigInt((value.amount_high ?? "0").toString())
    return (high << BigInt(128)) + low
  } catch {
    return null
  }
}

const readString = (data: AIData, key: string): string => {
  const value = data && typeof data[key] === "string" ? data[key] : ""
  return typeof value === "string" ? value.trim() : ""
}

const readNumber = (data: AIData, key: string): number => {
  const raw = data ? data[key] : undefined
  if (typeof raw === "number") return raw
  if (typeof raw === "string") {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

const parseNumberish = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

const normalizeGardenStarknetEntrypoint = (rawSelectorOrEntrypoint: string): string => {
  const normalized = (rawSelectorOrEntrypoint || "").trim().toLowerCase()
  if (!normalized) return rawSelectorOrEntrypoint
  if (normalized === GARDEN_STARKNET_APPROVE_SELECTOR) return "approve"
  if (normalized === GARDEN_STARKNET_INITIATE_SELECTOR) return "initiate"
  return rawSelectorOrEntrypoint
}

const loadAiPrivacyPendingNotes = (): AiPendingHideNoteRecord[] => {
  if (typeof window === "undefined") return []
  const raw = window.localStorage.getItem(AI_PRIVACY_PENDING_NOTES_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry): AiPendingHideNoteRecord | null => {
        if (!entry || typeof entry !== "object") return null
        const item = entry as Record<string, unknown>
        const noteCommitment =
          typeof item.note_commitment === "string" ? item.note_commitment.trim() : ""
        if (!noteCommitment) return null
        return {
          note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
          note_commitment: noteCommitment,
          nullifier: typeof item.nullifier === "string" ? item.nullifier.trim() || undefined : undefined,
          executor_address:
            typeof item.executor_address === "string"
              ? item.executor_address.trim() || undefined
              : undefined,
          verifier: typeof item.verifier === "string" ? item.verifier.trim() || undefined : undefined,
          root: typeof item.root === "string" ? item.root.trim() || undefined : undefined,
          proof: normalizeHexArray((item.proof as string[] | undefined) || []),
          public_inputs: normalizeHexArray((item.public_inputs as string[] | undefined) || []),
          denom_id: typeof item.denom_id === "string" ? item.denom_id.trim() || undefined : undefined,
          token_symbol:
            typeof item.token_symbol === "string" ? item.token_symbol.trim() || undefined : undefined,
          target_token_symbol:
            typeof item.target_token_symbol === "string"
              ? item.target_token_symbol.trim() || undefined
              : undefined,
          amount: typeof item.amount === "string" ? item.amount.trim() || undefined : undefined,
          deposited_at_unix:
            typeof item.deposited_at_unix === "number" && Number.isFinite(item.deposited_at_unix)
              ? Math.floor(item.deposited_at_unix)
              : Math.floor(Date.now() / 1000),
          spendable_at_unix:
            typeof item.spendable_at_unix === "number" && Number.isFinite(item.spendable_at_unix)
              ? Math.floor(item.spendable_at_unix)
              : (typeof item.deposited_at_unix === "number" && Number.isFinite(item.deposited_at_unix)
                  ? Math.floor(item.deposited_at_unix)
                  : Math.floor(Date.now() / 1000)) + Math.floor(AI_HIDE_MIN_NOTE_AGE_MS / 1000),
        }
      })
      .filter((item): item is AiPendingHideNoteRecord => item !== null)
      .sort((a, b) => b.deposited_at_unix - a.deposited_at_unix)
  } catch {
    return []
  }
}

const persistAiPrivacyPendingNotes = (items: AiPendingHideNoteRecord[]) => {
  if (typeof window === "undefined") return
  window.localStorage.setItem(AI_PRIVACY_PENDING_NOTES_KEY, JSON.stringify(items))
  window.dispatchEvent(new Event(AI_PRIVACY_PENDING_NOTES_UPDATED_EVENT))
}

const upsertAiPendingHideNote = (note: AiPendingHideNoteRecord) => {
  const items = loadAiPrivacyPendingNotes()
  const normalizedCommitment = note.note_commitment.trim().toLowerCase()
  const normalizedNullifier = (note.nullifier || "").trim().toLowerCase()
  const existing = items.find((item) => {
    const sameCommitment = item.note_commitment.trim().toLowerCase() === normalizedCommitment
    const sameNullifier =
      normalizedNullifier.length > 0 &&
      (item.nullifier || "").trim().toLowerCase() === normalizedNullifier
    return sameCommitment || sameNullifier
  })
  const merged: AiPendingHideNoteRecord = {
    ...(existing || {}),
    ...note,
  }
  const next = [
    merged,
    ...items.filter((item) => {
      const sameCommitment = item.note_commitment.trim().toLowerCase() === normalizedCommitment
      const sameNullifier =
        normalizedNullifier.length > 0 &&
        (item.nullifier || "").trim().toLowerCase() === normalizedNullifier
      return !(sameCommitment || sameNullifier)
    }),
  ]
  persistAiPrivacyPendingNotes(next)
}

const removeAiPendingHideNote = (noteCommitment?: string, nullifier?: string) => {
  const normalizedCommitment = (noteCommitment || "").trim().toLowerCase()
  const normalizedNullifier = (nullifier || "").trim().toLowerCase()
  if (!normalizedCommitment && !normalizedNullifier) return
  const items = loadAiPrivacyPendingNotes()
  const next = items.filter((item) => {
    const sameCommitment =
      normalizedCommitment.length > 0 &&
      item.note_commitment.trim().toLowerCase() === normalizedCommitment
    const sameNullifier =
      normalizedNullifier.length > 0 &&
      item.nullifier?.trim().toLowerCase() === normalizedNullifier
    return !(sameCommitment || sameNullifier)
  })
  persistAiPrivacyPendingNotes(next)
}

const loadTradePendingBtcDepositRecords = (): AiPendingBtcDepositRecord[] => {
  if (typeof window === "undefined") return []
  try {
    const rawMulti = window.localStorage.getItem(TRADE_PENDING_BTC_DEPOSITS_KEY)
    if (rawMulti) {
      const parsed = JSON.parse(rawMulti) as unknown
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry): AiPendingBtcDepositRecord | null => {
            if (!entry || typeof entry !== "object") return null
            const item = entry as Record<string, unknown>
            const bridgeId = typeof item.bridgeId === "string" ? item.bridgeId.trim() : ""
            const depositAddress =
              typeof item.depositAddress === "string" ? item.depositAddress.trim() : ""
            const destinationChain =
              typeof item.destinationChain === "string" ? item.destinationChain.trim() : ""
            const amountSats = Number(item.amountSats || 0)
            if (!bridgeId || !depositAddress || !destinationChain || !Number.isFinite(amountSats)) {
              return null
            }
            return {
              bridgeId,
              depositAddress,
              amountSats,
              destinationChain,
              requestSource: item.requestSource === "ai" ? "ai" : "manual",
              burnTxHash: typeof item.burnTxHash === "string" ? item.burnTxHash : null,
              status: typeof item.status === "string" ? item.status : "pending_deposit",
              txHash: typeof item.txHash === "string" ? item.txHash : null,
              sourceInitiateTxHash:
                typeof item.sourceInitiateTxHash === "string" ? item.sourceInitiateTxHash : null,
              destinationInitiateTxHash:
                typeof item.destinationInitiateTxHash === "string"
                  ? item.destinationInitiateTxHash
                  : null,
              destinationRedeemTxHash:
                typeof item.destinationRedeemTxHash === "string"
                  ? item.destinationRedeemTxHash
                  : null,
              refundTxHash: typeof item.refundTxHash === "string" ? item.refundTxHash : null,
              instantRefundTx:
                typeof item.instantRefundTx === "string" ? item.instantRefundTx : null,
              instantRefundHash:
                typeof item.instantRefundHash === "string" ? item.instantRefundHash : null,
              lastUpdatedAt:
                typeof item.lastUpdatedAt === "number" ? item.lastUpdatedAt : Date.now(),
            }
          })
          .filter((item): item is AiPendingBtcDepositRecord => item !== null)
      }
    }
  } catch {
    // ignore local storage parse errors
  }

  const fallback = window.localStorage.getItem(TRADE_PENDING_BTC_DEPOSIT_KEY)
  if (!fallback) return []
  try {
    const raw = JSON.parse(fallback) as Record<string, unknown>
    const normalized = raw && typeof raw === "object" ? raw : {}
    const bridgeId = typeof normalized.bridgeId === "string" ? normalized.bridgeId.trim() : ""
    const depositAddress =
      typeof normalized.depositAddress === "string" ? normalized.depositAddress.trim() : ""
    const destinationChain =
      typeof normalized.destinationChain === "string" ? normalized.destinationChain.trim() : ""
    const amountSats = Number(normalized.amountSats || 0)
    if (!bridgeId || !depositAddress || !destinationChain || !Number.isFinite(amountSats) || amountSats < 0) {
      return []
    }
    return [
      {
        bridgeId,
        depositAddress,
        amountSats,
        destinationChain,
        requestSource: normalized.requestSource === "ai" ? "ai" : "manual",
        burnTxHash: typeof normalized.burnTxHash === "string" ? normalized.burnTxHash : null,
        status: typeof normalized.status === "string" ? normalized.status : "pending_deposit",
        txHash: typeof normalized.txHash === "string" ? normalized.txHash : null,
        sourceInitiateTxHash:
          typeof normalized.sourceInitiateTxHash === "string"
            ? normalized.sourceInitiateTxHash
            : null,
        destinationInitiateTxHash:
          typeof normalized.destinationInitiateTxHash === "string"
            ? normalized.destinationInitiateTxHash
            : null,
        destinationRedeemTxHash:
          typeof normalized.destinationRedeemTxHash === "string"
            ? normalized.destinationRedeemTxHash
            : null,
        refundTxHash: typeof normalized.refundTxHash === "string" ? normalized.refundTxHash : null,
        instantRefundTx:
          typeof normalized.instantRefundTx === "string" ? normalized.instantRefundTx : null,
        instantRefundHash:
          typeof normalized.instantRefundHash === "string" ? normalized.instantRefundHash : null,
        lastUpdatedAt:
          typeof normalized.lastUpdatedAt === "number" ? normalized.lastUpdatedAt : Date.now(),
      },
    ]
  } catch {
    return []
  }
}

const persistTradePendingBtcDepositRecords = (records: AiPendingBtcDepositRecord[]) => {
  if (typeof window === "undefined") return
  window.localStorage.setItem(TRADE_PENDING_BTC_DEPOSITS_KEY, JSON.stringify(records))
}

const upsertTradePendingBtcDepositRecord = (record: AiPendingBtcDepositRecord) => {
  const current = loadTradePendingBtcDepositRecords()
  const normalized = {
    ...record,
    bridgeId: record.bridgeId.trim(),
    depositAddress: record.depositAddress.trim(),
    destinationChain: record.destinationChain.trim(),
    amountSats: Number(record.amountSats),
    requestSource: record.requestSource === "ai" ? "ai" : "manual",
    status: record.status || "pending_deposit",
    lastUpdatedAt: record.lastUpdatedAt || Date.now(),
  }
  if (!normalized.bridgeId || !normalized.depositAddress || !normalized.destinationChain) return
  const id = normalized.bridgeId.toLowerCase()
  const next = [
    normalized,
    ...current.filter((item) => item.bridgeId.toLowerCase() !== id),
  ]
  persistTradePendingBtcDepositRecords(next)
}

const removeTradePendingBtcDepositRecord = (bridgeId: string) => {
  const id = bridgeId.trim().toLowerCase()
  if (!id) return
  const current = loadTradePendingBtcDepositRecords()
  const next = current.filter((item) => item.bridgeId.toLowerCase() !== id)
  persistTradePendingBtcDepositRecords(next)
}

export const useAiExecution = ({
  input,
  setInput,
  selectedTier,
  unlockedTier,
  selectedAiHideTier,
  setAiHideUsdtTierMin,
  notifications,
  wallet,
  messages,
  appendMessagesForTier,
  isLoadingTier,
  isUpgradingTier,
  commandNeedsAction,
  planId,
  hasPlanReady,
  aiPlanEnabled,
  isBackgroundPreparingAction,
  hasPreparedActionReady,
  resolveActionId,
  setActionId,
  setPendingActions,
  getLastBurnTxHash,
}: UseAiExecutionParams): UseAiExecutionResult => {
  const [isSending, setIsSending] = React.useState(false)
  const [pendingExecutionConfirmation, setPendingExecutionConfirmation] =
    React.useState<PendingExecutionConfirmation | null>(null)

  const resolvePoolTokenAddressForRelayerFunding = React.useCallback((tokenSymbol: string): string => {
    const symbol = resolveStakeTokenSymbol(tokenSymbol)
    if (symbol === "WBTC") return AI_TOKEN_ADDRESS_MAP.WBTC?.trim() || ""
    return (AI_TOKEN_ADDRESS_MAP[symbol] || "").trim()
  }, [])

  const approveRelayerFundingForStake = React.useCallback(
    async (tokenSymbol: string, amountValue: string) => {
      const symbol = resolveStakeTokenSymbol(tokenSymbol)
      const tokenAddress = resolvePoolTokenAddressForRelayerFunding(symbol)
      if (!tokenAddress) {
        throw new Error(`Token address for ${symbol} is not configured for hide-mode relayer funding.`)
      }
      const executorAddress =
        (PRIVATE_ACTION_EXECUTOR_ADDRESS || STARKNET_ZK_PRIVACY_ROUTER_ADDRESS || "").trim()
      if (!executorAddress) {
        throw new Error(
          "NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS is not configured for shielded relayer mode."
        )
      }
      const decimals = AI_TOKEN_DECIMALS[symbol] ?? 18
      const normalizedAmount =
        Number.isFinite(Number.parseFloat(amountValue)) && Number.parseFloat(amountValue) > 0
          ? amountValue
          : "1"
      const [amountLow, amountHigh] = decimalToU256Parts(normalizedAmount, decimals)
      const [approvalLow, approvalHigh] = HIDE_BALANCE_RELAYER_APPROVE_MAX
        ? [U256_MAX_WORD_HEX, U256_MAX_WORD_HEX]
        : [amountLow, amountHigh]
      const providerHint = resolveStarknetProviderHint(wallet.provider)
      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message: HIDE_BALANCE_RELAYER_APPROVE_MAX
          ? `Approve one-time ${symbol} spending limit for private relayer funding.`
          : `Approve ${normalizedAmount} ${symbol} for private relayer note funding.`,
      })
      const txHash = await invokeStarknetCallFromWallet(
        {
          contractAddress: tokenAddress,
          entrypoint: "approve",
          calldata: [executorAddress, approvalLow, approvalHigh],
        },
        providerHint
      )
      notifications.addNotification({
        type: "success",
        title: "Allowance approved",
        message: HIDE_BALANCE_RELAYER_APPROVE_MAX
          ? `Relayer allowance for ${symbol} is now active (one-time setup).`
          : `Relayer can now fund private note from your ${symbol} balance.`,
        txHash,
        txNetwork: "starknet",
      })
    },
    [notifications, resolvePoolTokenAddressForRelayerFunding, wallet.provider]
  )

  const resolveAiHideTierAmountText = React.useCallback(
    async ({
      fromToken,
      fallbackAmountText,
      providerHint,
      requireOnchainRule,
      tierUsdtOverride,
    }: {
      fromToken: string
      fallbackAmountText: string
      providerHint: "starknet" | "argentx" | "braavos"
      requireOnchainRule?: boolean
      tierUsdtOverride?: number
    }): Promise<string> => {
      const tokenSymbol = resolveStakeTokenSymbol(fromToken)
      const denomId = String(
        typeof tierUsdtOverride === "number" && Number.isFinite(tierUsdtOverride)
          ? tierUsdtOverride
          : selectedAiHideTier.minUsdt
      )
      const normalizedAmount = (fallbackAmountText || "").trim()
      const fallbackAmount =
        Number.isFinite(Number.parseFloat(normalizedAmount)) && Number.parseFloat(normalizedAmount) > 0
          ? normalizedAmount
          : ""
      if (!HIDE_BALANCE_SHIELDED_POOL) {
        return fallbackAmount || "1"
      }

      const tokenAddress = (AI_TOKEN_ADDRESS_MAP[tokenSymbol] || "").trim()
      const executorAddress = (PRIVATE_ACTION_EXECUTOR_ADDRESS || STARKNET_ZK_PRIVACY_ROUTER_ADDRESS || "").trim()
      if (!tokenAddress || !executorAddress) {
        if (requireOnchainRule) {
          throw new Error(
            "Private hide note amount requires configured token + executor address. Check env for NEXT_PUBLIC_TOKEN_* and NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS."
          )
        }
        return fallbackAmount || "1"
      }

      const decimals = AI_TOKEN_DECIMALS[tokenSymbol] ?? 18
      try {
        const fixedAmountRaw = await readStarknetShieldedPoolFixedAmountFromWallet(
          executorAddress,
          tokenAddress,
          denomId,
          providerHint
        )
        if (fixedAmountRaw !== null && fixedAmountRaw > BigInt(0)) {
          return scaledBigIntToDecimalString(fixedAmountRaw, decimals)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "")
        if (/asset rule not set/i.test(message)) {
          throw new Error(
            `Hide Balance asset rule is not set for ${tokenSymbol} tier $${denomId}. Ask admin to set_asset_rule for this token+tier before retrying.`
          )
        }
        if (requireOnchainRule) {
          throw error
        }
      }

      if (fallbackAmount) return fallbackAmount
      const fixedAmount = await fetchPrivacyFixedAmount({
        token: tokenSymbol,
        denom_id: denomId,
      })
      const fixedAmountValue = toBigIntFromU256(fixedAmount)
      if (fixedAmountValue !== null && fixedAmountValue > BigInt(0)) {
        return scaledBigIntToDecimalString(fixedAmountValue, decimals)
      }
      return "1"
    },
    [selectedAiHideTier.minUsdt]
  )

    const requestGaragaPayload = React.useCallback(
      async (
        flow: "swap" | "stake" | "limit",
        fromToken: string,
        toToken: string,
        amount: string,
        options?: {
          denomId?: string
          noteVersion?: string
          noteCommitment?: string
          noteDepositTxHash?: string
          nullifier?: string
          noirInputs?: Record<string, unknown>
        }
      ): Promise<PrivacyVerificationPayload> => {
        if (!wallet.isConnected) {
          throw new Error("Wallet must be connected to request Garaga payload.")
        }
        const resolvedNoirInputs = await resolveNoirInputs({
          existing: options?.noirInputs,
          context: {
            flow,
            from_token: fromToken,
            to_token: toToken,
            amount,
            from_network: "starknet",
            to_network: "starknet",
            note_version: options?.noteVersion || HIDE_BALANCE_NOTE_VERSION || "v4",
            denom_id: options?.denomId || String(selectedAiHideTier.minUsdt),
            note_commitment: options?.noteCommitment,
            note_deposit_tx_hash: options?.noteDepositTxHash,
            nullifier: options?.nullifier,
          },
        })
        if (!resolvedNoirInputs) {
          throw new Error(
            "Noir inputs belum tersedia. Aktifkan sumber noir_inputs (window.noirInputsProvider atau NEXT_PUBLIC_NOIR_INPUTS_URL)."
          )
        }
        const response = await autoSubmitPrivacyAction({
          verifier: "garaga",
          submit_onchain: false,
          tx_context: {
            flow,
            from_token: fromToken,
            to_token: toToken,
            amount,
            from_network: "starknet",
            to_network: "starknet",
            note_version: options?.noteVersion || HIDE_BALANCE_NOTE_VERSION || "v4",
            noir_inputs: resolvedNoirInputs,
            denom_id: options?.denomId || String(selectedAiHideTier.minUsdt),
            note_commitment: options?.noteCommitment,
            note_deposit_tx_hash: options?.noteDepositTxHash,
            nullifier: options?.nullifier,
          },
        })
        const responseNoirInputs =
          (response.payload as PrivacyVerificationPayload | undefined)?.noir_inputs ||
          resolvedNoirInputs
        const payload: PrivacyVerificationPayload = {
          verifier: (response.payload?.verifier || "garaga").trim() || "garaga",
          note_version: response.payload?.note_version?.trim() || HIDE_BALANCE_NOTE_VERSION || "v4",
          executor_address: response.payload?.executor_address?.trim() || undefined,
          root: response.payload?.root?.trim() || undefined,
          nullifier: response.payload?.nullifier?.trim(),
          commitment: response.payload?.commitment?.trim(),
          recipient: response.payload?.recipient?.trim() || undefined,
          note_commitment:
            response.payload?.note_commitment?.trim() ||
            response.payload?.commitment?.trim() ||
            undefined,
          note_deposit_tx_hash: options?.noteDepositTxHash,
          noir_inputs: responseNoirInputs,
          denom_id: response.payload?.denom_id?.trim() || options?.denomId || String(selectedAiHideTier.minUsdt),
          spendable_at_unix:
            typeof response.payload?.spendable_at_unix === "number" &&
            Number.isFinite(response.payload.spendable_at_unix)
              ? Math.floor(response.payload.spendable_at_unix)
              : undefined,
          proof: normalizeHexArray(response.payload?.proof),
          public_inputs: normalizeHexArray(response.payload?.public_inputs),
        }
        const proof = normalizeHexArray(payload.proof)
        const publicInputs = normalizeHexArray(payload.public_inputs)
        if (!payload.nullifier || !payload.commitment || !proof.length || !publicInputs.length) {
          throw new Error("Auto Garaga payload is incomplete from backend.")
        }
        if (
          proof.length === 1 &&
          publicInputs.length === 1 &&
          proof[0]?.toLowerCase() === "0x1" &&
          publicInputs[0]?.toLowerCase() === "0x1"
        ) {
          throw new Error("Auto Garaga payload from backend is still dummy (0x1).")
        }
        return {
          verifier: payload.verifier,
          note_version: payload.note_version,
          executor_address: payload.executor_address,
          root: payload.root,
          nullifier: payload.nullifier,
          commitment: payload.commitment,
          recipient: payload.recipient,
          note_commitment: payload.note_commitment,
          note_deposit_tx_hash: payload.note_deposit_tx_hash,
          noir_inputs: responseNoirInputs,
          denom_id: payload.denom_id,
          spendable_at_unix: payload.spendable_at_unix,
          proof,
          public_inputs: publicInputs,
        }
    },
    [selectedAiHideTier.minUsdt, wallet.isConnected]
  )

  const buildHideBalancePrivacyCall = React.useCallback((payload: PrivacyVerificationPayload, actionType = "SWAP") => {
    const router = STARKNET_ZK_PRIVACY_ROUTER_ADDRESS.trim()
    if (!router) {
      throw new Error(
        "NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS is not configured. Hide Balance requires privacy router address."
      )
    }
    const root = payload.root?.trim() || ""
    const nullifier = payload.nullifier?.trim() || ""
    const commitment = (payload.commitment || payload.note_commitment || "").trim()
    const proof = normalizeHexArray(payload.proof).map((value) => toHexFelt(value))
    const publicInputs = normalizeHexArray(payload.public_inputs).map((value) => toHexFelt(value))
    if (!root || !nullifier || !proof.length || !publicInputs.length) {
      throw new Error(
        "Hide Balance (v4) requires root, nullifier, proof, and public_inputs."
      )
    }
    const nullifiers = [toHexFelt(nullifier)]
    const commitments = commitment ? [toHexFelt(commitment)] : []
    return {
      contractAddress: router,
      entrypoint: "submit_action",
      calldata: [
        toHexFelt(actionType),
        toHexFelt(root),
        "0x0",
        String(nullifiers.length),
        ...nullifiers,
        String(commitments.length),
        ...commitments,
        String(publicInputs.length),
        ...publicInputs,
        String(proof.length),
        ...proof,
      ],
    }
  }, [])

  const buildSwapWalletCalls = React.useCallback(
    (
      quote: Awaited<ReturnType<typeof getSwapQuote>> | null,
      fromToken: string,
      toToken: string
    ): StarknetInvokeCall[] => {
      if (!SUPPORTED_SWAP_TOKENS.has(fromToken) || !SUPPORTED_SWAP_TOKENS.has(toToken)) {
        throw new Error(`Swap token ${fromToken}/${toToken} is not supported.`)
      }
      const calls =
        Array.isArray(quote?.onchain_calls) && quote.onchain_calls.length > 0
          ? quote.onchain_calls
              .filter(
                (call): call is { contract_address: string; entrypoint: string; calldata: string[] } =>
                  !!call &&
                  typeof call.contract_address === "string" &&
                  typeof call.entrypoint === "string" &&
                  Array.isArray(call.calldata)
              )
              .map((call) => ({
                contractAddress: call.contract_address.trim(),
                entrypoint: call.entrypoint.trim(),
                calldata: call.calldata.map((value) => String(value)),
              }))
              .filter(
                (call) =>
                  !!call.contractAddress &&
                  !!call.entrypoint &&
                  call.calldata.every((item) => typeof item === "string" && item.trim().length > 0)
              )
          : []
      if (!calls.length) {
        throw new Error(
          "Swap onchain calls belum tersedia. Refresh quote lalu coba lagi."
        )
      }
      return calls
    },
    []
  )

  const buildStakeWalletCalls = React.useCallback(
    (tokenSymbol: string, amountText: string): StarknetInvokeCall[] => {
      const token = resolveStakeTokenSymbol(tokenSymbol)
      const decimals = AI_TOKEN_DECIMALS[token] ?? 18
      const [amountLow, amountHigh] = decimalToU256Parts(amountText, decimals)

      if (token === "CAREL") {
        if (!STARKNET_STAKING_CAREL_ADDRESS.trim()) {
          throw new Error("NEXT_PUBLIC_STARKNET_STAKING_CAREL_ADDRESS is not configured.")
        }
        return [
          {
            contractAddress: AI_TOKEN_ADDRESS_MAP.CAREL || "",
            entrypoint: "approve",
            calldata: [STARKNET_STAKING_CAREL_ADDRESS.trim(), amountLow, amountHigh],
          },
          {
            contractAddress: STARKNET_STAKING_CAREL_ADDRESS.trim(),
            entrypoint: "stake",
            calldata: [amountLow, amountHigh],
          },
        ]
      }

      if (token === "USDC" || token === "USDT" || token === "STRK") {
        if (!STARKNET_STAKING_STABLECOIN_ADDRESS.trim()) {
          throw new Error("NEXT_PUBLIC_STARKNET_STAKING_STABLECOIN_ADDRESS is not configured.")
        }
        const tokenAddress =
          token === "USDC"
            ? AI_TOKEN_ADDRESS_MAP.USDC
            : token === "USDT"
            ? AI_TOKEN_ADDRESS_MAP.USDT
            : AI_TOKEN_ADDRESS_MAP.STRK
        return [
          {
            contractAddress: tokenAddress || "",
            entrypoint: "approve",
            calldata: [STARKNET_STAKING_STABLECOIN_ADDRESS.trim(), amountLow, amountHigh],
          },
          {
            contractAddress: STARKNET_STAKING_STABLECOIN_ADDRESS.trim(),
            entrypoint: "stake",
            calldata: [tokenAddress || "", amountLow, amountHigh],
          },
        ]
      }

      if (token === "WBTC") {
        if (!STARKNET_STAKING_WBTC_ADDRESS.trim()) {
          throw new Error("NEXT_PUBLIC_STARKNET_STAKING_WBTC_ADDRESS is not configured.")
        }
        const tokenAddress = AI_TOKEN_ADDRESS_MAP.WBTC || ""
        return [
          {
            contractAddress: tokenAddress,
            entrypoint: "approve",
            calldata: [STARKNET_STAKING_WBTC_ADDRESS.trim(), amountLow, amountHigh],
          },
          {
            contractAddress: STARKNET_STAKING_WBTC_ADDRESS.trim(),
            entrypoint: "stake",
            calldata: [tokenAddress, amountLow, amountHigh],
          },
        ]
      }

      throw new Error(`Pool ${token} is not supported for staking.`)
    },
    []
  )

  const buildClaimWalletCalls = React.useCallback((tokenSymbol: string): StarknetInvokeCall[] => {
    const token = resolveStakeTokenSymbol(tokenSymbol)

    if (token === "CAREL") {
      if (!STARKNET_STAKING_CAREL_ADDRESS.trim()) {
        throw new Error("NEXT_PUBLIC_STARKNET_STAKING_CAREL_ADDRESS is not configured.")
      }
      return [
        {
          contractAddress: STARKNET_STAKING_CAREL_ADDRESS.trim(),
          entrypoint: "claim_rewards",
          calldata: [],
        },
      ]
    }

    if (token === "USDC" || token === "USDT" || token === "STRK") {
      if (!STARKNET_STAKING_STABLECOIN_ADDRESS.trim()) {
        throw new Error("NEXT_PUBLIC_STARKNET_STAKING_STABLECOIN_ADDRESS is not configured.")
      }
      const tokenAddress =
        token === "USDC"
          ? AI_TOKEN_ADDRESS_MAP.USDC
          : token === "USDT"
          ? AI_TOKEN_ADDRESS_MAP.USDT
          : AI_TOKEN_ADDRESS_MAP.STRK
      return [
        {
          contractAddress: STARKNET_STAKING_STABLECOIN_ADDRESS.trim(),
          entrypoint: "claim_rewards",
          calldata: [tokenAddress || ""],
        },
      ]
    }

    if (token === "WBTC") {
      if (!STARKNET_STAKING_WBTC_ADDRESS.trim()) {
        throw new Error("NEXT_PUBLIC_STARKNET_STAKING_WBTC_ADDRESS is not configured.")
      }
      const tokenAddress = AI_TOKEN_ADDRESS_MAP.WBTC || ""
      return [
        {
          contractAddress: STARKNET_STAKING_WBTC_ADDRESS.trim(),
          entrypoint: "claim_rewards",
          calldata: [tokenAddress],
        },
      ]
    }

    throw new Error(`Pool ${token} is not supported for staking rewards claim.`)
  }, [])

  const resolveAiLimitOrderCallData = React.useCallback(
    async (params: {
      fromToken: string
      toToken: string
      amountText: string
      priceText: string
      expiry: string
    }) => {
      if (!STARKNET_LIMIT_ORDER_BOOK_ADDRESS.trim()) {
        throw new Error("NEXT_PUBLIC_STARKNET_LIMIT_ORDER_BOOK_ADDRESS is not configured.")
      }
      const fromToken = params.fromToken.trim().toUpperCase()
      const toToken = params.toToken.trim().toUpperCase()
      const amountText = params.amountText.trim()
      const priceText = params.priceText.trim()
      if (!fromToken || !toToken || !amountText || !priceText) {
        throw new Error("Limit order requires from token, to token, amount, and price.")
      }
      const tokenIn = (AI_TOKEN_ADDRESS_MAP[fromToken] || "").trim()
      const tokenOut = (AI_TOKEN_ADDRESS_MAP[toToken] || "").trim()
      if (!tokenIn || !tokenOut) {
        throw new Error("Token address is not configured for limit order.")
      }
      const [amountLow, amountHigh] = decimalToU256Parts(amountText, AI_TOKEN_DECIMALS[fromToken] ?? 18)
      const [priceLow, priceHigh] = decimalToU256Parts(priceText, 18)
      const expirySeconds =
        params.expiry === "1d"
          ? 24 * 60 * 60
          : params.expiry === "30d"
          ? 30 * 24 * 60 * 60
          : 7 * 24 * 60 * 60
      return {
        contractAddress: STARKNET_LIMIT_ORDER_BOOK_ADDRESS.trim(),
        entrypoint: "create_limit_order",
        calldata: [
          tokenIn,
          tokenOut,
          amountLow,
          amountHigh,
          priceLow,
          priceHigh,
          String(expirySeconds),
        ],
      }
    },
    []
  )

  const readAiKnownTokenBalance = React.useCallback(
    (walletContext: WalletContextType, symbol: string): number | null => {
      const normalized = symbol.trim().toUpperCase()
      const candidates: number[] = []
      const pushIfFinite = (value: unknown) => {
        if (typeof value === "number" && Number.isFinite(value)) {
          candidates.push(value)
        }
      }

      switch (normalized) {
        case "CAREL":
          pushIfFinite(walletContext.onchainBalance?.CAREL)
          pushIfFinite(walletContext.balance?.CAREL)
          break
        case "STRK":
          pushIfFinite(walletContext.onchainBalance?.STRK_L2)
          pushIfFinite(walletContext.balance?.STRK)
          break
        case "USDC":
          pushIfFinite(walletContext.onchainBalance?.USDC)
          pushIfFinite(walletContext.balance?.USDC)
          break
        case "USDT":
          pushIfFinite(walletContext.onchainBalance?.USDT)
          pushIfFinite(walletContext.balance?.USDT)
          break
        case "WBTC":
        case "BTC":
          pushIfFinite(walletContext.onchainBalance?.WBTC)
          pushIfFinite(walletContext.balance?.WBTC)
          pushIfFinite(walletContext.onchainBalance?.BTC)
          pushIfFinite(walletContext.balance?.BTC)
          break
        default:
          break
      }

      if (candidates.length === 0) return null
      return Math.max(...candidates)
    },
    []
  )

  const ensureHideNoteDeposited = React.useCallback(
    async ({
      payload,
      tokenIn,
      tokenOut,
      amountText,
    }: {
      payload: PrivacyVerificationPayload
      tokenIn: string
      tokenOut: string
      amountText: string
    }) => {
      if (!HIDE_BALANCE_SHIELDED_POOL) {
        throw new Error("Hide note deposit is only supported for shielded pool v4.")
      }
      const tokenSymbol = resolveStakeTokenSymbol(tokenIn)
      const tokenAddress = (AI_TOKEN_ADDRESS_MAP[tokenSymbol] || "").trim()
      if (!tokenAddress) {
        throw new Error(`Token address for ${tokenSymbol} is not configured for hide note deposit.`)
      }
      const executorAddress = (payload.executor_address || PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim()
      if (!executorAddress) {
        throw new Error(
          "NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS is not configured for hide note deposit."
        )
      }
      const noteCommitment = (payload.note_commitment || payload.commitment || "").trim()
      if (!noteCommitment) {
        throw new Error("Hide note commitment missing in privacy payload.")
      }
      const nullifier = (payload.nullifier || "").trim()
      if (!nullifier) {
        throw new Error("Hide nullifier missing in privacy payload.")
      }
      const denomId = (payload.denom_id || String(selectedAiHideTier.minUsdt)).trim()
      if (!denomId) {
        throw new Error("Hide denom_id missing in privacy payload.")
      }

      let resolvedAmount = (amountText || "").trim()
      const providerHint = resolveStarknetProviderHint(wallet.provider)
      try {
        resolvedAmount = await resolveAiHideTierAmountText({
          fromToken: tokenSymbol,
          fallbackAmountText: amountText,
          providerHint,
          requireOnchainRule: true,
          tierUsdtOverride: Number(denomId),
        })
      } catch {
        // fallback to provided amountText or later fallback.
      }
      const decimals = AI_TOKEN_DECIMALS[tokenSymbol] ?? 18
      const parsedAmount = Number.parseFloat(resolvedAmount)
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        const fallbackAmount = sanitizeDecimalInput(String(selectedAiHideTier.minUsdt))
        resolvedAmount = fallbackAmount
      }

      const [amountLow, amountHigh] = decimalToU256Parts(resolvedAmount, decimals)
      const approvalAmountUnits =
        BigInt(amountLow) + (BigInt(amountHigh) << BigInt(128))
      const approvalBufferUnits =
        (approvalAmountUnits * BigInt(10_100) + BigInt(9_999)) / BigInt(10_000)
      const [approvalLow, approvalHigh] = toU256HexPartsFromBigInt(approvalBufferUnits)

      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message: `Confirm approve (+1% buffer) + hide note deposit (${resolvedAmount} ${tokenSymbol}) in one transaction.`,
      })
      const depositTxHash = await invokeStarknetCallsFromWallet(
        [
          {
            contractAddress: tokenAddress,
            entrypoint: "approve",
            calldata: [executorAddress, approvalLow, approvalHigh],
          },
          {
            contractAddress: executorAddress,
            entrypoint: "deposit_fixed_v4",
            calldata: [tokenAddress, toHexFelt(denomId), toHexFelt(noteCommitment), "0x0"],
          },
        ],
        providerHint
      )

      const spendableAtMs = Date.now() + AI_HIDE_MIN_NOTE_AGE_MS
      upsertAiPendingHideNote({
        note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
        note_commitment: noteCommitment,
        nullifier,
        executor_address: (payload.executor_address || PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim() || undefined,
        verifier: (payload.verifier || "garaga").trim() || undefined,
        root: (payload.root || "").trim() || undefined,
        proof: normalizeHexArray(payload.proof),
        public_inputs: normalizeHexArray(payload.public_inputs),
        denom_id: denomId,
        token_symbol: tokenSymbol,
        target_token_symbol: (tokenOut || "").trim().toUpperCase() || undefined,
        amount: resolvedAmount,
        deposited_at_unix: Math.floor(Date.now() / 1000),
        spendable_at_unix: Math.floor(spendableAtMs / 1000),
      })
      notifications.addNotification({
        type: "success",
        title: "Hide note deposited",
        message: `Hide note submitted (${depositTxHash.slice(0, 10)}...).`,
        txHash: depositTxHash,
        txNetwork: "starknet",
      })
      return {
        spendableAtMs,
        txHash: depositTxHash,
        amountText: resolvedAmount,
      }
    },
    [
      notifications,
      resolveAiHideTierAmountText,
      selectedAiHideTier.minUsdt,
      wallet.address,
      wallet.provider,
      wallet.starknetAddress,
    ]
  )

  const isHideNoteRegistrationMissingMessage = React.useCallback((message: string): boolean => {
    const lower = (message || "").toLowerCase()
    return /note belum terdaftar|note not registered|note is not registered yet|nullifier note missing|unknown root|note missing/.test(
      lower
    )
  }, [])

  const buildActionFollowUps = async (actions: string[], data: AIData) => {
    const followUps: Array<{ role: "assistant"; content: string; timestamp: string }> = []
    const add = (content: string) =>
      followUps.push({ role: "assistant", content, timestamp: nowTimestampLabel() })

    for (const action of actions) {
      if (action === "get_swap_quote") {
        const fromToken = readString(data, "from_token")
        const toToken = readString(data, "to_token")
        const amount = readNumber(data, "amount")
        if (!fromToken || !toToken || !(amount > 0)) continue
        try {
          const slippageValue = DEFAULT_AI_SWAP_SLIPPAGE_PERCENT
          const quote = await getSwapQuote({
            from_token: fromToken,
            to_token: toToken,
            amount: String(amount),
            slippage: slippageValue,
            mode: DEFAULT_AI_SWAP_MODE,
          })
          const quotedOutRaw = quote.estimated_amount_out ?? quote.to_amount
          const output = parseNumberish(quotedOutRaw)
          const priceImpact = parseNumberish(quote.price_impact)
          const minOut = formatSwapMinAmountOut(String(quotedOutRaw ?? output), slippageValue)
          const outputDisplay = output > 0 ? output.toFixed(6) : String(quotedOutRaw || "0")
          add(
            `Swap quote (live): ${amount} ${fromToken} -> ~${outputDisplay} ${toToken} (min ${minOut}, price impact ${(priceImpact * 100).toFixed(2)}%).`
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load swap quote."
          add(`Swap quote failed: ${message}`)
        }
        continue
      }

      if (action === "get_bridge_quote") {
        const fromToken = readString(data, "from_token")
        const toToken = readString(data, "to_token")
        const amount = readNumber(data, "amount")
        if (!fromToken || !toToken || !(amount > 0)) continue
        try {
          const fromChain = bridgeTargetChainForToken(fromToken)
          const toChain = bridgeTargetChainForToken(toToken)
          const quote = await getBridgeQuote({
            from_chain: fromChain,
            to_chain: toChain,
            token: fromToken,
            to_token: toToken,
            amount: String(amount),
          })
          const received =
            typeof quote.received_amount !== "undefined" ? quote.received_amount : quote.estimated_receive
          add(
            `Bridge quote (live): ${amount} ${fromToken} -> ~${received} ${toToken}.`
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load bridge quote."
          add(`Bridge quote failed: ${message}`)
        }
        continue
      }

      if (action === "show_balance") {
        try {
          const balances = await getPortfolioBalance()
          const tokenList: Array<{ symbol: string; balance: number }> =
            Array.isArray(balances.tokens) && balances.tokens.length
              ? balances.tokens.map((item) => ({
                  symbol: item.symbol,
                  balance: item.balance,
                }))
              : balances.balances.map((item) => ({
                  symbol: item.token,
                  balance: item.amount,
                }))
          const lines = tokenList
            .slice(0, 5)
            .map((token) => `${token.symbol}: ${Number(token.balance || 0).toFixed(4)}`)
          add(`Wallet balance (live): ${lines.join(", ")}.`)
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load balance."
          add(`Balance refresh failed: ${message}`)
        }
        continue
      }

      if (action === "show_points_breakdown") {
        try {
          const points = await getRewardsPoints()
          const total = Number(points.total_points || 0)
          const walletPoints = Number(points.wallet_points ?? points.onchain_points ?? 0)
          add(`Points breakdown (live): total ${total.toFixed(2)} pts, wallet ${walletPoints.toFixed(2)} pts.`)
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load points."
          add(`Points refresh failed: ${message}`)
        }
        continue
      }

      if (action === "show_chart") {
        const token = (readString(data, "token") || "STRK").toUpperCase()
        try {
          const candles = await getTokenOHLCV({
            token,
            interval: "1h",
            limit: 24,
          })
          const last = candles.data[candles.data.length - 1]
          if (last) {
            add(`Market update (live): ${token} 1h close is ${Number(last.close).toFixed(6)}.`)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load chart."
          add(`Chart refresh failed: ${message}`)
        }
        continue
      }

      if (action === "show_staking_pools") {
        try {
          const pools = await getStakePools()
          if (!pools.length) {
            add("No staking pools available right now.")
          } else {
            const top = [...pools]
              .sort((a, b) => b.apy - a.apy)
              .slice(0, 3)
              .map((pool) => `${pool.token} APY ${pool.apy.toFixed(2)}%`)
              .join(", ")
            add(`Top staking pools now: ${top}.`)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load staking pools."
          add(`Staking pools refresh failed: ${message}`)
        }
        continue
      }

      if (action === "prepare_unstake" || action === "prepare_stake_claim") {
        const tokenHint = readString(data, "token").toUpperCase()
        try {
          const positions = await getStakePositions()
          const filtered = tokenHint
            ? positions.filter((position) => position.token.toUpperCase() === tokenHint)
            : positions
          const first = filtered[0]
          if (!first) {
            add("No matching staking position found for this account yet.")
          } else if (action === "prepare_unstake") {
            add(
              `Unstake ready: position ${first.position_id} (${first.amount.toFixed(4)} ${first.token}). Continue from staking panel to sign transaction.`
            )
          } else {
            add(
              `Claim ready: position ${first.position_id} (${first.token}) with rewards ${first.rewards_earned.toFixed(6)}. Continue from staking panel to sign transaction.`
            )
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load staking positions."
          add(`Staking position lookup failed: ${message}`)
        }
        continue
      }

      if (action === "prepare_limit_order") {
        const fromToken = readString(data, "from_token")
        const toToken = readString(data, "to_token")
        const amount = readNumber(data, "amount")
        const price = readNumber(data, "price")
        const expiry = readString(data, "expiry") || "7d"
        if (fromToken && toToken && amount > 0) {
          add(
            `Limit order parsed: ${amount} ${fromToken} -> ${toToken}${price > 0 ? ` at ${price}` : ""}, expiry ${expiry}. Use trading panel to submit signature.`
          )
        }
        continue
      }

      if (action === "prepare_limit_order_cancel") {
        try {
          const orders = await listLimitOrders(1, 5, "active")
          const items = orders.items || []
          if (!items.length) {
            add("No active limit orders found.")
          } else {
            const list = items
              .slice(0, 3)
              .map((order) => `${order.order_id} (${order.from_token}->${order.to_token})`)
              .join(", ")
            add(`Active limit orders: ${list}. Send 'cancel order 0x...' using one of the order ids above.`)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load active orders."
          add(`Limit order lookup failed: ${message}`)
        }
        continue
      }

      if (action === "open_portfolio_manager" || action === "set_rebalance_plan") {
        try {
          const analytics = await getPortfolioAnalytics()
          const allocation = analytics.portfolio.allocation
            .slice(0, 3)
            .map((item) => `${item.asset} ${item.percentage.toFixed(1)}%`)
            .join(", ")
          add(
            `Live allocation snapshot: total ~$${Number(analytics.portfolio.total_value_usd).toFixed(2)}, top allocation ${allocation || "n/a"}.`
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load portfolio analytics."
          add(`Portfolio analytics refresh failed: ${message}`)
        }
        continue
      }

      if (action === "configure_alerts") {
        const triggers = Array.isArray(data?.supported_triggers)
          ? data?.supported_triggers.filter((item): item is string => typeof item === "string")
          : []
        if (triggers.length) {
          add(`Alert modes available: ${triggers.join(", ")}. Next step: add token + threshold in alert panel.`)
        } else {
          add("Alert setup ready. Next step: choose token, condition, and threshold.")
        }
      }
    }

    return followUps
  }

  const handleSend = async () => {
    let command = normalizeAiCommandInput(input)
    if (!command || isSending || isUpgradingTier || isLoadingTier) return
    if (commandNeedsAction && isBackgroundPreparingAction && !hasPreparedActionReady) return
    const activeTier = selectedTier
    let confirmedPendingExecution = false
    if (activeTier > unlockedTier) {
      const missing = incrementalTierUpgradeCost(unlockedTier, activeTier)
      appendMessagesForTier(activeTier, [
        {
          role: "assistant",
          content:
            missing > 0
              ? `🔒 Level ${activeTier} is locked. Upgrade by paying ${missing} CAREL first.`
              : `🔒 Level ${activeTier} is locked. Please upgrade first.`,
          timestamp: nowTimestampLabel(),
        },
      ])
      return
    }

    const pendingForTier =
      pendingExecutionConfirmation && pendingExecutionConfirmation.tier === activeTier
        ? pendingExecutionConfirmation
        : null
    const hasPendingConfirmation = !!pendingForTier
    const userMessageTimestamp = nowTimestampLabel()

    if (
      !hasPendingConfirmation &&
      (isAffirmativeConfirmation(command) || isNegativeConfirmation(command))
    ) {
      appendMessagesForTier(activeTier, [
        {
          role: "user",
          content: command,
          timestamp: userMessageTimestamp,
        },
      ])
      setInput("")
      const latestAssistantMessage =
        [...messages].reverse().find((item) => item.role === "assistant")?.content || ""
      const hintedOrderId = (latestAssistantMessage.match(/0x[0-9a-fA-F]{8,}/) || [])[0] || "0x..."
      const isCancelOrderContext =
        /cancel order <id>|provide order id|active limit orders|prepare_limit_order_cancel/i.test(
          latestAssistantMessage
        )
      appendMessagesForTier(activeTier, [
        {
          role: "assistant",
          content:
            isCancelOrderContext && isAffirmativeConfirmation(command)
              ? `No pending confirmation right now. For cancel order, send a concrete command with order id: \`cancel order ${hintedOrderId}\`.`
              : "No pending confirmation right now. Send a new command first (example: `swap 25 STRK to WBTC`).",
          timestamp: nowTimestampLabel(),
        },
      ])
      return
    }

    if (hasPendingConfirmation) {
      appendMessagesForTier(activeTier, [
        {
          role: "user",
          content: command,
          timestamp: userMessageTimestamp,
        },
      ])
      setInput("")

      if (isNegativeConfirmation(command)) {
        setPendingExecutionConfirmation(null)
        appendMessagesForTier(activeTier, [
          {
            role: "assistant",
            content: "Execution cancelled. No transaction was sent.",
            timestamp: nowTimestampLabel(),
          },
        ])
        return
      }

      if (!isAffirmativeConfirmation(command)) {
        appendMessagesForTier(activeTier, [
          {
            role: "assistant",
            content:
              "I still need confirmation for the pending on-chain command. Reply `yes` to execute or `no` to cancel.",
            timestamp: nowTimestampLabel(),
          },
        ])
        return
      }

      command = pendingForTier.command
      setPendingExecutionConfirmation(null)
      confirmedPendingExecution = true
    }

    const requestedHideTier = activeTier >= 3 ? inferHideTierFromPrivateCommand(command) : null
    const effectiveHideTierUsdt = requestedHideTier || selectedAiHideTier.minUsdt
    if (requestedHideTier && requestedHideTier !== selectedAiHideTier.minUsdt) {
      setAiHideUsdtTierMin(requestedHideTier)
      notifications.addNotification({
        type: "info",
        title: "Hide tier updated",
        message: `AI L3 hide tier set to $${requestedHideTier}.`,
      })
    }

    const isBridgeCommand = BRIDGE_COMMAND_REGEX.test(command)
    if (activeTier >= 3 && isBridgeCommand) {
      if (!hasPendingConfirmation) {
        appendMessagesForTier(activeTier, [
          {
            role: "user",
            content: command,
            timestamp: userMessageTimestamp,
          },
        ])
        setInput("")
      }
      setPendingExecutionConfirmation(null)
      appendMessagesForTier(activeTier, [
        {
          role: "assistant",
          content:
            "Bridge is not available on Level 3 yet. For now use Level 2 for bridge. Private L3 bridge will be added later.",
          timestamp: nowTimestampLabel(),
        },
      ])
      return
    }

    const parsedCancelOrderId = parseLimitOrderIdFromCancelCommand(command)
    const isCancelOrderCommand = /\bcancel\s+order\b/i.test(command)
    if (isCancelOrderCommand && !parsedCancelOrderId) {
      if (!hasPendingConfirmation) {
        appendMessagesForTier(activeTier, [
          {
            role: "user",
            content: command,
            timestamp: userMessageTimestamp,
          },
        ])
        setInput("")
      }
      let guidance =
        "Cancel order requires a concrete order id. Use: `cancel order 0x...` (replace with a real active order id)."
      try {
        const activeOrders = await listLimitOrders(1, 10, "active")
        const items = activeOrders.items || []
        if (items.length > 0) {
          const list = items
            .slice(0, 3)
            .map((item) => `${item.order_id} (${item.from_token}->${item.to_token})`)
            .join(", ")
          guidance = `${guidance}\nActive orders: ${list}`
        } else {
          guidance = `${guidance}\nNo active limit orders found.`
        }
      } catch {
        // Keep base guidance when order list lookup fails.
      }
      appendMessagesForTier(activeTier, [
        {
          role: "assistant",
          content: guidance,
          timestamp: nowTimestampLabel(),
        },
      ])
      return
    }

    let actionIdValue: number | undefined
    const commandNeedsOnchainAction =
      requiresOnchainActionForCommand(activeTier, command) &&
      (!isCancelOrderCommand || !!parsedCancelOrderId)
    const activePlanId = aiPlanEnabled && hasPlanReady && planId ? planId : ""
    const commandRequiresSetup = commandNeedsOnchainAction && !activePlanId
    const isSetupOutOfSyncError = (value: string): boolean => {
      const lower = value.toLowerCase()
      return (
        lower.includes("please click auto setup on-chain first") ||
        lower.includes("no valid on-chain setup found") ||
        lower.includes("ai action is no longer pending") ||
        lower.includes("on-chain setup required")
      )
    }

    if (!hasPendingConfirmation && commandNeedsOnchainAction) {
      appendMessagesForTier(activeTier, [
        {
          role: "user",
          content: command,
          timestamp: userMessageTimestamp,
        },
      ])
      setInput("")
      setPendingExecutionConfirmation({
        tier: activeTier,
        command,
        createdAt: Date.now(),
      })
      const burnTxHint = activePlanId
        ? ""
        : "\nBurn transaction hash will be shown after you confirm the wallet signature."
      const hideDepositExecutorHint = (PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim()
        ? `\nHide deposit executor: ${(PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim()}`
        : "\nHide deposit executor: not configured"
      const bridgeConfirmHint = isBridgeCommand
        ? activePlanId
          ? "\nBridge execution usually has 2 steps:\n1. Sign Starknet bridge setup in Argent/Braavos.\n2. If source is BTC, sign BTC deposit in UniSat/Xverse.\nOrder is only completed after BTC deposit is sent."
          : "\nBridge execution usually has 2 steps:\n1. Sign Starknet setup in Argent/Braavos (burn CAREL).\n2. If source is BTC, sign BTC deposit in UniSat/Xverse.\nOrder is only completed after BTC deposit is sent."
        : ""
      const privateHideTierHint =
        activeTier >= 3 ? buildPrivateHideTierHint(command, effectiveHideTierUsdt) : ""
      const executionIntro = activePlanId
        ? "This will request wallet signature for the on-chain transaction."
        : `This will request wallet signature and burn ${executionBurnAmountCarel(activeTier)} CAREL on-chain for this execution.`
      appendMessagesForTier(activeTier, [
        {
          role: "assistant",
          content:
            `You're about to execute this REAL on-chain command:\n${command}\n\nReply \`yes\` to continue or \`no\` to cancel.\n${executionIntro}${burnTxHint}${hideDepositExecutorHint}${bridgeConfirmHint}${privateHideTierHint}\nIf you have an active discount NFT, fee discount will be applied automatically.`,
          timestamp: nowTimestampLabel(),
        },
      ])
      return
    }

    if (confirmedPendingExecution) {
      appendMessagesForTier(activeTier, [
        {
          role: "assistant",
          content: `Confirmed. Executing: ${command}`,
          timestamp: nowTimestampLabel(),
        },
      ])
    }

    if (confirmedPendingExecution && isBridgeCommand) {
      const parsedBridge = parseBridgeTokensFromCommand(command)
      if (parsedBridge) {
        const bridgeAddressError = bridgeAddressRequirementError(
          parsedBridge.fromToken,
          parsedBridge.toToken,
          {
            address: wallet.address,
            starknetAddress: wallet.starknetAddress,
            evmAddress: wallet.evmAddress,
            btcAddress: wallet.btcAddress,
          }
        )
        if (bridgeAddressError) {
          notifications.addNotification({
            type: "error",
            title: "Bridge wallet missing",
            message: bridgeAddressError,
          })
          appendMessagesForTier(activeTier, [
            {
              role: "assistant",
              content: `${bridgeAddressError} Connect the required wallet, then retry the same command.`,
              timestamp: nowTimestampLabel(),
            },
          ])
          return
        }
      }
    }

    if (commandRequiresSetup) {
      try {
        actionIdValue = await resolveActionId(true, {
          requireFresh: AI_REQUIRE_FRESH_SETUP_PER_EXECUTION,
        })
      } catch (error) {
        let message = error instanceof Error ? error.message : "Unable to resolve on-chain action."
        const lowerMessage = message.toLowerCase()
        const indexingDelayLikely =
          /not indexed yet|submitted recently|retry in a few seconds|wait a few seconds/i.test(
            lowerMessage
          )
        if (indexingDelayLikely) {
          notifications.addNotification({
            type: "info",
            title: "Finalizing setup indexing",
            message: "Setup tx is confirmed. Waiting for indexer sync, then retrying automatically.",
          })
          await waitMs(1500)
          try {
            actionIdValue = await resolveActionId(true, {
              forceRefresh: true,
              requireFresh: AI_REQUIRE_FRESH_SETUP_PER_EXECUTION,
            })
          } catch (retryError) {
            message =
              retryError instanceof Error
                ? retryError.message
                : "Unable to resolve on-chain action."
          }
        }
        if (typeof actionIdValue === "number" && actionIdValue > 0) {
          // Auto-retry succeeded, continue command execution in the same flow.
        } else {
          notifications.addNotification({
            type: "error",
            title: "On-chain setup required",
            message,
          })
          appendMessagesForTier(activeTier, [
            {
              role: "assistant",
              content: normalizeMessageText(
                `On-chain setup signature was not completed: ${message}\n` +
                  "Confirm the wallet popup for Sign Execution Setup, then retry the same command. No command was executed."
              ),
              timestamp: nowTimestampLabel(),
            },
          ])
          return
        }
      }
    }

    if (!hasPendingConfirmation) {
      appendMessagesForTier(activeTier, [
        {
          role: "user",
          content: command,
          timestamp: nowTimestampLabel(),
        },
      ])
      setInput("")
    }
    setIsSending(true)

    try {
      let response: Awaited<ReturnType<typeof executeAiCommand>>
      try {
        response = await executeAiCommand({
          command,
          level: activeTier,
          action_id: actionIdValue,
        })
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error ?? "")
        if (isSetupOutOfSyncError(rawMessage)) {
          actionIdValue = await resolveActionId(commandRequiresSetup, {
            forceRefresh: true,
          })
          response = await executeAiCommand({
            command,
            level: activeTier,
            action_id: actionIdValue,
          })
        } else {
          throw error
        }
      }

      let directExecutionMessage = ""
      const actionId = typeof response.action_id === "number" ? response.action_id : actionIdValue
      if (commandRequiresSetup && actionId && actionId > 0) {
        setPendingActions((prev) => (prev.includes(actionId) ? prev : [...prev, actionId]))
      }

      const providerHint = resolveStarknetProviderHint(wallet.provider)

      const parsedSwap = parseSwapTokensFromCommand(command)
      const parsedBridge = parseBridgeTokensFromCommand(command)
      const parsedLimit = parseLimitOrderIntentFromCommand(command)

      const canAutoExecuteSwap =
        activeTier >= 2 && (response.actions || []).includes("execute_swap") && parsedSwap
      if (canAutoExecuteSwap && parsedSwap) {
        const { fromToken, toToken, amountText } = parsedSwap
        if (!SUPPORTED_SWAP_TOKENS.has(fromToken) || !SUPPORTED_SWAP_TOKENS.has(toToken)) {
          throw new Error(`Swap token ${fromToken}/${toToken} is not supported.`)
        }
        if (!amountText) {
          throw new Error("Swap amount is required.")
        }

        let swapAmount = amountText
        const tierUsesGaraga = activeTier >= 3
        let hideDepositTxHash = ""
        if (tierUsesGaraga && HIDE_BALANCE_SHIELDED_POOL) {
          swapAmount = await resolveAiHideTierAmountText({
            fromToken,
            fallbackAmountText: amountText,
            providerHint,
            requireOnchainRule: true,
            tierUsdtOverride: effectiveHideTierUsdt,
          })
        }

        const swapSlippage = DEFAULT_AI_SWAP_SLIPPAGE_PERCENT
        const swapMode =
          tierUsesGaraga && HIDE_BALANCE_SHIELDED_POOL ? "private" : DEFAULT_AI_SWAP_MODE
        const swapDeadline = computeTradeDeadlineSeconds()
        let minAmountOut = "0"
        let swapQuote: Awaited<ReturnType<typeof getSwapQuote>> | null = null
        try {
          const quote = await getSwapQuote({
            from_token: fromToken,
            to_token: toToken,
            amount: swapAmount,
            slippage: swapSlippage,
            mode: swapMode,
          })
          swapQuote = quote
          const quotedOutRaw = quote.estimated_amount_out ?? quote.to_amount
          minAmountOut = formatSwapMinAmountOut(String(quotedOutRaw ?? "0"), swapSlippage)
        } catch {
          minAmountOut = "0"
        }

        let onchainTxHash: string | null = null
        let swapResult: Awaited<ReturnType<typeof executeSwap>>
        if (tierUsesGaraga && HIDE_BALANCE_SHIELDED_POOL) {
          let swapPrivacyPayload = await requestGaragaPayload(
            "swap",
            fromToken,
            toToken,
            swapAmount,
            {
              denomId: String(effectiveHideTierUsdt),
              noteVersion: HIDE_BALANCE_NOTE_VERSION || "v4",
            }
          )
          if (!(swapPrivacyPayload.denom_id || "").trim()) {
            swapPrivacyPayload.denom_id = String(effectiveHideTierUsdt)
          }
          const executePrivateSwap = async (
            payload: PrivacyVerificationPayload,
            onchainHash?: string
          ) => {
            return executeSwap({
              from_token: fromToken,
              to_token: toToken,
              amount: swapAmount,
              min_amount_out: minAmountOut,
              slippage: swapSlippage,
              deadline: swapDeadline,
              mode: swapMode,
              action_id: actionId,
              onchain_tx_hash: onchainHash,
              plan_id: activePlanId || undefined,
              hide_balance: true,
              privacy: payload,
            })
          }

          try {
            swapResult = await executePrivateSwap(swapPrivacyPayload)
          } catch (error) {
            const rawMessage = error instanceof Error ? error.message : String(error ?? "")
            if (isHideNoteRegistrationMissingMessage(rawMessage)) {
              const waitDeposit = await ensureHideNoteDeposited({
                payload: swapPrivacyPayload,
                tokenIn: fromToken,
                tokenOut: toToken,
                amountText: swapAmount,
              })
              hideDepositTxHash = waitDeposit.txHash
              const hideNoteSpendableAtMs = waitDeposit.spendableAtMs
              const cooldownMs = hideNoteSpendableAtMs - Date.now()
              if (
                hideNoteSpendableAtMs > 0 &&
                cooldownMs > 0 &&
                !AI_HIDE_AUTO_EXECUTE_AFTER_COOLDOWN
              ) {
                notifications.addNotification({
                  type: "info",
                  title: "Hide note deposited",
                  message:
                    `Hide note deposited. Cooldown ${formatDurationHhMmSs(cooldownMs)}. ` +
                    "Retry private swap after cooldown.",
                })
                throw new Error(
                  `Hide note deposited. Wait ${formatDurationHhMmSs(cooldownMs)} then retry private swap.${hideDepositTxHash ? ` Deposit note tx: ${hideDepositTxHash.slice(0, 14)}...` : ""}`
                )
              }
              if (cooldownMs > 0) {
                notifications.addNotification({
                  type: "info",
                  title: "Hide cooldown",
                  message: `Waiting ${formatDurationHhMmSs(cooldownMs)} before private swap execution.`,
                })
                await waitMs(cooldownMs)
              }
              notifications.addNotification({
                type: "info",
                title: "Starting private swap",
                message: "Cooldown finished. Starting private swap automatically.",
              })
              appendMessagesForTier(activeTier, [
                {
                  role: "assistant",
                  content: "Cooldown finished. Executing private swap now.",
                  timestamp: nowTimestampLabel(),
                },
              ])
              const pinnedCommitment = (
                swapPrivacyPayload.note_commitment ||
                swapPrivacyPayload.commitment ||
                ""
              ).trim()
              const pinnedNullifier = (swapPrivacyPayload.nullifier || "").trim()
              swapPrivacyPayload = await requestGaragaPayload(
                "swap",
                fromToken,
                toToken,
                swapAmount,
                {
                  denomId: String(effectiveHideTierUsdt),
                  noteVersion: HIDE_BALANCE_NOTE_VERSION || "v4",
                  noteCommitment: pinnedCommitment || undefined,
                  nullifier: pinnedNullifier || undefined,
                }
              )
              if (!(swapPrivacyPayload.denom_id || "").trim()) {
                swapPrivacyPayload.denom_id = String(effectiveHideTierUsdt)
              }
              try {
                swapResult = await executePrivateSwap(swapPrivacyPayload)
              } catch (secondError) {
                const secondMessage =
                  secondError instanceof Error ? secondError.message : String(secondError ?? "")
                if (isHideNoteRegistrationMissingMessage(secondMessage)) {
                  throw new Error(
                    "Hide note is already deposited, but indexer is still syncing. Note is saved in Pending Hide Notes; retry private swap once status is Ready."
                  )
                }
                throw secondError
              }
            } else if (
              isRelayerAllowanceErrorMessage(rawMessage) &&
              HIDE_BALANCE_RELAYER_POOL_ENABLED
            ) {
              await approveRelayerFundingForStake(fromToken, swapAmount)
              swapResult = await executePrivateSwap(swapPrivacyPayload)
            } else {
              throw error
            }
          }
        } else {
          notifications.addNotification({
            type: "info",
            title: "Wallet signature required",
            message: `Confirm swap ${swapAmount} ${fromToken} in your wallet.`,
          })
          if (!swapQuote) {
            swapQuote = await getSwapQuote({
              from_token: fromToken,
              to_token: toToken,
              amount: swapAmount,
              slippage: swapSlippage,
              mode: swapMode,
            })
          }
          const calls = buildSwapWalletCalls(swapQuote, fromToken, toToken)
          const txHash = await invokeWalletCallsWithSequentialFallback(calls, providerHint, {
            allowSequentialFallback: calls.length === 2,
            onFallback: () => {
              notifications.addNotification({
                type: "warning",
                title: "Wallet multicall fallback",
                message:
                  "Wallet rejected multicall payload format. Continuing with separate signatures: approve, then swap.",
              })
            },
          })
          onchainTxHash = txHash
          swapResult = await executeSwap({
            from_token: fromToken,
            to_token: toToken,
            amount: swapAmount,
            min_amount_out: minAmountOut,
            slippage: swapSlippage,
            deadline: swapDeadline,
            mode: swapMode,
            action_id: actionId,
            onchain_tx_hash: onchainTxHash,
            plan_id: activePlanId || undefined,
            hide_balance: false,
          })
        }

        const swapTxHash = swapResult.tx_hash || onchainTxHash || swapResult.privacy_tx_hash
        if (swapResult.privacy_tx_hash) {
          notifications.addNotification({
            type: "info",
            title: "Garaga verification submitted",
            message: `Privacy tx ${swapResult.privacy_tx_hash.slice(0, 12)}... was submitted on Starknet.`,
            txHash: swapResult.privacy_tx_hash,
            txNetwork: "starknet",
          })
        }
        notifications.addNotification({
          type: "success",
          title: "Swap completed",
          message: `Swapped ${swapAmount} ${fromToken} to ${toToken}.`,
          txHash: swapTxHash || undefined,
          txNetwork: swapTxHash ? "starknet" : undefined,
        })
        if (swapTxHash) {
          markAiTransaction(swapTxHash)
        }
        const swapTxPreview = swapTxHash ? `${swapTxHash.slice(0, 14)}...` : "-"
        const swapTxUrl = swapTxHash ? buildTxExplorerUrl(swapTxHash, "starknet") : ""
        const hideDepositPreview = hideDepositTxHash ? `${hideDepositTxHash.slice(0, 14)}...` : ""
        const hideDepositUrl = hideDepositTxHash
          ? buildTxExplorerUrl(hideDepositTxHash, "starknet")
          : ""
        const hideDepositLine = hideDepositTxHash
          ? `Hide note deposit tx: ${hideDepositPreview}${hideDepositUrl ? `\nTrack deposit tx: ${hideDepositUrl}` : ""}`
          : ""
        const swapEstimatedPoints = parseNumberish(swapResult.estimated_points_earned)
        const swapDiscountPercent = parseNumberish(swapResult.nft_discount_percent)
        const swapDiscountSaved = parseNumberish(swapResult.fee_discount_saved)
        const swapAiBonusPercent = parseNumberish(swapResult.ai_level_points_bonus_percent)
        const pointsLine =
          swapEstimatedPoints > 0
            ? `Points reward: +${swapEstimatedPoints.toFixed(2)} (estimated).${
                swapAiBonusPercent > 0
                  ? ` Includes AI level bonus +${swapAiBonusPercent.toFixed(2)}%.`
                  : ""
              }`
            : `Points reward: 0${
                swapAiBonusPercent > 0
                  ? ` (AI level bonus +${swapAiBonusPercent.toFixed(2)}% is active once threshold is met).`
                  : "."
              }`
        const discountLine =
          swapDiscountPercent > 0
            ? `Discount NFT applied ${swapDiscountPercent.toFixed(2)}% (fee saved ${swapDiscountSaved.toFixed(6)} ${fromToken}).`
            : "Discount NFT not active on this swap."
        notifications.addNotification({
          type: "info",
          title: "Points & Discount",
          message: `${pointsLine} ${discountLine}`,
        })

        directExecutionMessage = normalizeMessageText(
          `✅ Swap executed: ${swapAmount} ${fromToken} -> ${toToken}. Tx: ${swapTxPreview}${
            swapTxUrl ? `\nTrack tx: ${swapTxUrl}` : ""
          }${hideDepositLine ? `\n${hideDepositLine}` : ""}`
        )
      }

      const canAutoExecuteBridge =
        !directExecutionMessage &&
        activeTier >= 2 &&
        (response.actions || []).includes("execute_bridge") &&
        parsedBridge
      if (canAutoExecuteBridge && parsedBridge) {
        const { fromToken, toToken, amountText } = parsedBridge
        if (!amountText) {
          throw new Error("Bridge amount is required.")
        }
        const fromChain = bridgeTargetChainForToken(fromToken)
        const toChain = bridgeTargetChainForToken(toToken)
        if (!isSupportedBridgePair(fromChain, toChain, fromToken, toToken)) {
          throw new Error(`Bridge pair ${fromToken}/${toToken} is not supported.`)
        }
        if (!wallet.address && !wallet.starknetAddress && fromChain === "starknet") {
          throw new Error("Starknet wallet is not connected.")
        }
        if (!wallet.evmAddress && fromChain === "evm") {
          throw new Error("EVM wallet is not connected.")
        }
        if (!wallet.btcAddress && fromChain === "bitcoin") {
          throw new Error("BTC wallet is not connected.")
        }

        const sourceOwner =
          fromChain === "starknet"
            ? wallet.starknetAddress || wallet.address
            : fromChain === "evm"
            ? wallet.evmAddress
            : wallet.btcAddress
        const recipient =
          toChain === "starknet"
            ? wallet.starknetAddress || wallet.address
            : toChain === "evm"
            ? wallet.evmAddress
            : wallet.btcAddress
        if (!recipient) {
          throw new Error("Recipient address is missing for bridge execution.")
        }

        const bridgeBasePayload = {
          from_chain: fromChain,
          to_chain: toChain,
          token: fromToken,
          to_token: toToken,
          amount: amountText,
          action_id: actionId,
          plan_id: activePlanId || undefined,
          recipient,
          source_owner: sourceOwner || undefined,
        } as const

        let onchainTxHash: string | null = null
        let bridgeResult = await executeBridge(bridgeBasePayload)
        let bridgeSourceTxHash = bridgeResult.source_tx_hash || ""
        let bridgeSourceTxNetwork: "starknet" | "evm" | "btc" | null = null
        if (fromChain === "starknet") {
          const onchainCalls = Array.isArray(bridgeResult.onchain_calls)
            ? bridgeResult.onchain_calls
            : []
          if (onchainCalls.length === 0) {
            throw new Error("Bridge preflight failed: missing on-chain calls.")
          }
          const calls: StarknetInvokeCall[] = onchainCalls.map((call) => ({
            contractAddress: call.contract_address,
            entrypoint: normalizeGardenStarknetEntrypoint(call.entrypoint),
            calldata: call.calldata.map((item) => String(item)),
          }))

          if (!calls.length) {
            throw new Error("Bridge preflight failed: no wallet calls.")
          }
          notifications.addNotification({
            type: "info",
            title: "Wallet signature required",
            message: "Confirm bridge transaction in your Starknet wallet.",
          })
          try {
            onchainTxHash = await invokeWalletCallsWithSequentialFallback(calls, providerHint, {
              allowSequentialFallback: calls.length > 1,
              onFallback: () => {
                notifications.addNotification({
                  type: "warning",
                  title: "Wallet multicall fallback",
                  message:
                    "Wallet rejected multicall payload. Continuing with approve, then bridge setup.",
                })
              },
          })
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error ?? "")
          if (isWalletMulticallPayloadError(errorMessage)) {
            onchainTxHash = await invokeWalletCallsWithSequentialFallback(calls, providerHint, {
              allowSequentialFallback: true,
            })
          } else {
            throw error
            }
          }
          if (!onchainTxHash) {
            throw new Error("Bridge on-chain setup failed.")
          }
          bridgeResult = await executeBridge({
            ...bridgeBasePayload,
            onchain_tx_hash: onchainTxHash,
          })
          if (bridgeResult.source_tx_hash) {
            bridgeSourceTxHash = bridgeResult.source_tx_hash
          }
          bridgeSourceTxNetwork = "starknet"
        } else if (fromChain === "evm") {
          if (!bridgeResult.evm_tx_request) {
            throw new Error("Bridge preflight failed: missing EVM tx request.")
          }
          notifications.addNotification({
            type: "info",
            title: "Wallet signature required",
            message: "Confirm bridge transaction in your EVM wallet.",
          })
          onchainTxHash = await sendEvmTransactionFromWallet(bridgeResult.evm_tx_request)
          if (!onchainTxHash) {
            throw new Error("EVM transaction was not submitted.")
          }
          bridgeResult = await executeBridge({
            ...bridgeBasePayload,
            onchain_tx_hash: onchainTxHash,
          })
          if (bridgeResult.source_tx_hash) {
            bridgeSourceTxHash = bridgeResult.source_tx_hash
          }
          bridgeSourceTxNetwork = "evm"
        } else if (fromChain === "bitcoin") {
          if (!bridgeResult.deposit_address) {
            throw new Error("Bridge preflight failed: missing BTC deposit address.")
          }
          if (bridgeResult.deposit_amount) {
            const parsedSats = Number.parseInt(String(bridgeResult.deposit_amount), 10)
            if (!Number.isFinite(parsedSats) || parsedSats <= 0) {
              throw new Error("Bridge preflight failed: invalid BTC deposit amount.")
            }
          }
        }

        if (bridgeResult.bridge_id) {
          notifications.addNotification({
            type: "success",
            title: "Bridge created",
            message: `Bridge order ${bridgeResult.bridge_id.slice(0, 10)}... is created.`,
            txHash: bridgeResult.source_tx_hash || onchainTxHash || undefined,
            txNetwork: bridgeSourceTxNetwork || undefined,
          })
        }

        const bridgeExplorerUrl = buildGardenOrderExplorerUrl(bridgeResult.bridge_id)
        const bridgeExplorerLinks = bridgeExplorerUrl
          ? [{ label: "Open Garden Explorer", url: bridgeExplorerUrl }]
          : undefined
        const shortBridgeId = bridgeResult.bridge_id.slice(0, 10)
        const bridgeEstimatedPoints = parseNumberish(bridgeResult.estimated_points_earned)
        const bridgeDiscountPercent = parseNumberish(bridgeResult.nft_discount_percent)
        const bridgeDiscountSaved = parseNumberish(bridgeResult.fee_discount_saved)
        const bridgeAiBonusPercent = parseNumberish(bridgeResult.ai_level_points_bonus_percent)
        const bridgePointsPending = !!bridgeResult.points_pending
        const pointsLine =
          bridgeEstimatedPoints > 0
            ? `Points reward: +${bridgeEstimatedPoints.toFixed(2)} (estimated${
                bridgePointsPending ? ", pending settlement" : ""
              }).${
                bridgeAiBonusPercent > 0
                  ? ` Includes AI level bonus +${bridgeAiBonusPercent.toFixed(2)}%.`
                  : ""
              }`
            : `Points reward: 0${
                bridgeAiBonusPercent > 0
                  ? ` (AI level bonus +${bridgeAiBonusPercent.toFixed(2)}% is active once threshold is met).`
                  : "."
              }`
        const discountLine =
          bridgeDiscountPercent > 0
            ? `Discount NFT applied ${bridgeDiscountPercent.toFixed(2)}% (fee saved ${bridgeDiscountSaved.toFixed(8)} ${fromToken}).`
            : "Discount NFT not active on this bridge."
        notifications.addNotification({
          type: "info",
          title: "Points & Discount",
          message: `${pointsLine} ${discountLine}`,
        })
        let btcDepositStateMessage = ""
        let btcDepositAmountDisplay = "the required BTC amount"
        let btcDepositCanceled = false
        if (fromChain === "bitcoin" && bridgeResult.deposit_address) {
          const parsedAmountSats = Number.parseInt(String(bridgeResult.deposit_amount || "0"), 10)
          const amountSats =
            Number.isFinite(parsedAmountSats) && parsedAmountSats > 0 ? parsedAmountSats : 0
          if (amountSats > 0) {
            upsertTradePendingBtcDepositRecord({
              bridgeId: bridgeResult.bridge_id,
              depositAddress: bridgeResult.deposit_address,
              amountSats,
              destinationChain: toChain,
              requestSource: "ai",
              burnTxHash: getLastBurnTxHash() || null,
              status: "pending_deposit",
              txHash: null,
              sourceInitiateTxHash: null,
              destinationInitiateTxHash: null,
              destinationRedeemTxHash: null,
              refundTxHash: null,
              instantRefundTx: null,
              instantRefundHash: null,
              lastUpdatedAt: Date.now(),
            })
          }
          const btcAmountDisplay =
            amountSats > 0 ? formatBtcFromSats(amountSats) : "required BTC amount"
          btcDepositAmountDisplay = btcAmountDisplay
          const btcProviderLabel =
            wallet.btcProvider === "xverse"
              ? "Xverse"
              : wallet.btcProvider === "unisat"
              ? "UniSat"
              : "UniSat/Xverse"

          if (wallet.btcAddress && wallet.btcProvider && amountSats > 0) {
            try {
              notifications.addNotification({
                type: "info",
                title: "Wallet signature required",
                message: `Approve BTC transfer in ${btcProviderLabel} popup.`,
              })
              const btcDepositTxHash = await wallet.sendBtcTransaction(
                bridgeResult.deposit_address,
                amountSats
              )
              notifications.addNotification({
                type: "success",
                title: "BTC deposit submitted",
                message: `Deposit tx ${btcDepositTxHash.slice(0, 12)}... sent to Garden address.`,
                txHash: btcDepositTxHash,
                txNetwork: "btc",
                txExplorerUrls: bridgeExplorerLinks,
              })
              upsertTradePendingBtcDepositRecord({
                bridgeId: bridgeResult.bridge_id,
                depositAddress: bridgeResult.deposit_address,
                amountSats,
                destinationChain: toChain,
                requestSource: "ai",
                burnTxHash: getLastBurnTxHash() || null,
                status: "processing",
                txHash: btcDepositTxHash,
                sourceInitiateTxHash: `${btcDepositTxHash}:0`,
                destinationInitiateTxHash: null,
                destinationRedeemTxHash: null,
                refundTxHash: null,
                instantRefundTx: null,
                instantRefundHash: null,
                lastUpdatedAt: Date.now(),
              })
              bridgeSourceTxHash = btcDepositTxHash
              bridgeSourceTxNetwork = "btc"
              await wallet.refreshOnchainBalances()
              btcDepositStateMessage =
                `\nBTC deposit submitted (${btcAmountDisplay}): ${btcDepositTxHash.slice(0, 12)}...`
            } catch (depositError) {
              const detail =
                depositError instanceof Error
                  ? depositError.message
                  : "Popup wallet canceled/failed."
              if (isWalletCancellationMessage(detail)) {
                btcDepositCanceled = true
                notifications.addNotification({
                  type: "warning",
                  title: "BTC deposit canceled",
                  message:
                    `BTC deposit was canceled in wallet. Order ${shortBridgeId}... will expire automatically in about 1 hour if no deposit is sent. Your BTC is safe.`,
                  txExplorerUrls: bridgeExplorerLinks,
                })
                btcDepositStateMessage = "\nBTC deposit was canceled in wallet."
              } else {
                notifications.addNotification({
                  type: "warning",
                  title: "BTC auto-send skipped",
                  message: `${detail} Send ${btcDepositAmountDisplay} manually to ${bridgeResult.deposit_address}.`,
                })
                btcDepositStateMessage = "\nBTC deposit was not sent automatically."
              }
            }
          } else if (wallet.btcAddress && !wallet.btcProvider) {
            notifications.addNotification({
              type: "warning",
              title: "BTC signer not selected",
              message:
                "BTC address is linked, but signer wallet is unknown. Reconnect Xverse or UniSat first, then retry bridge to show wallet popup.",
            })
          }
        }

        let bridgeTxPreview = ""
        let bridgeTxUrl = ""
        if (bridgeSourceTxHash && bridgeSourceTxNetwork) {
          bridgeTxPreview = `${bridgeSourceTxHash.slice(0, 12)}...`
          bridgeTxUrl = buildTxExplorerUrl(bridgeSourceTxHash, bridgeSourceTxNetwork)
        }
        const btcDepositLine =
          fromChain === "bitcoin"
            ? `\nBTC deposit: send ${btcDepositAmountDisplay} to ${bridgeResult.deposit_address}`
            : ""
        const btcDepositStatusLine =
          fromChain === "bitcoin" && btcDepositStateMessage ? btcDepositStateMessage : ""
        const bridgeActionLabel = fromChain === "bitcoin" ? "Bridge created" : "Bridge executed"
        const gardenLinkText = bridgeExplorerUrl ? `\nTrack order: ${bridgeExplorerUrl}` : ""
        const txLinkText = bridgeTxUrl ? `\nTrack tx: ${bridgeTxUrl}` : ""
        const burnTxHash = onchainTxHash || ""
        const burnTxUrl = burnTxHash ? buildTxExplorerUrl(burnTxHash, "starknet") : ""
        const burnTxLine = burnTxUrl ? `\nBurn tx: ${burnTxHash.slice(0, 12)}...` : ""
        const burnTxLink = burnTxUrl ? `\nTrack burn tx: ${burnTxUrl}` : ""

        directExecutionMessage = normalizeMessageText(
          `✅ ${bridgeActionLabel}: ${amountText} ${fromToken} -> ${toToken} (Garden order ${shortBridgeId}...)` +
            `${burnTxLine}${burnTxLink}${btcDepositLine}${btcDepositStatusLine}${txLinkText}${gardenLinkText}`
        )
        if (bridgeResult.bridge_id) {
          markAiTransaction(bridgeResult.bridge_id)
        }
        if (bridgeSourceTxHash) {
          markAiTransaction(bridgeSourceTxHash)
        }
      }

      const canAutoExecuteStake =
        !directExecutionMessage &&
        activeTier >= 2 &&
        /\bstake\b/i.test(command) &&
        (response.actions || []).includes("execute_stake")
      if (canAutoExecuteStake) {
        const parsedStake = parseStakeTokenAmountFromCommand(command)
        const token = resolveStakeTokenSymbol(parsedStake?.token || "")
        const amountText = parsedStake?.amountText || (parseStakeTokenHintFromCommand(command) ? "" : "")
        if (!token) {
          throw new Error("Stake token is missing. Try: `stake 10 USDT`.")
        }
        if (!SUPPORTED_STAKE_TOKENS.has(token)) {
          throw new Error(`Stake token ${token} is not supported.`)
        }

        const tierUsesGaraga = activeTier >= 3
        let stakeAmountText = amountText
        if (tierUsesGaraga && HIDE_BALANCE_SHIELDED_POOL) {
          stakeAmountText = await resolveAiHideTierAmountText({
            fromToken: token,
            fallbackAmountText: amountText,
            providerHint,
            requireOnchainRule: true,
            tierUsdtOverride: effectiveHideTierUsdt,
          })
        }
        if (!stakeAmountText || !Number.parseFloat(stakeAmountText)) {
          throw new Error("Stake amount is required.")
        }

        let stakeResult: Awaited<ReturnType<typeof stakeDeposit>>
        let txHash = ""
        let hideDepositTxHash = ""
        let stakePrivacyPayload: PrivacyVerificationPayload | undefined
        if (tierUsesGaraga && HIDE_BALANCE_SHIELDED_POOL) {
          stakePrivacyPayload = await requestGaragaPayload("stake", token, token, stakeAmountText, {
            denomId: String(effectiveHideTierUsdt),
            noteVersion: HIDE_BALANCE_NOTE_VERSION || "v4",
          })
          if (!(stakePrivacyPayload.denom_id || "").trim()) {
            stakePrivacyPayload.denom_id = String(effectiveHideTierUsdt)
          }
          const executePrivateStake = async (
            payload: PrivacyVerificationPayload,
            onchainHash?: string
          ) => {
            return stakeDeposit({
              pool_id: token,
              amount: stakeAmountText,
              onchain_tx_hash: onchainHash,
              plan_id: activePlanId || undefined,
              hide_balance: true,
              privacy: payload,
            })
          }
          try {
            stakeResult = await executePrivateStake(stakePrivacyPayload)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error ?? "")
            if (isHideNoteRegistrationMissingMessage(message)) {
              const depositResult = await ensureHideNoteDeposited({
                payload: stakePrivacyPayload,
                tokenIn: token,
                tokenOut: token,
                amountText: stakeAmountText,
              })
              hideDepositTxHash = depositResult.txHash
              const spendableAtMs = depositResult.spendableAtMs
              const remainingWaitMs = spendableAtMs - Date.now()
              if (remainingWaitMs > 0 && !AI_HIDE_AUTO_EXECUTE_AFTER_COOLDOWN) {
                const depositTxUrl = hideDepositTxHash
                  ? buildTxExplorerUrl(hideDepositTxHash, "starknet")
                  : ""
                throw new Error(
                  `Hide note deposited. Wait ${formatDurationHhMmSs(
                    remainingWaitMs
                  )} then retry private stake.${hideDepositTxHash ? ` Deposit note tx: ${hideDepositTxHash.slice(0, 14)}...` : ""}${depositTxUrl ? `\nTrack deposit tx: ${depositTxUrl}` : ""}`
                )
              }
              if (remainingWaitMs > 0) {
                await waitMs(remainingWaitMs)
              }
              notifications.addNotification({
                type: "info",
                title: "Starting private stake",
                message: "Cooldown finished. Starting private stake automatically.",
              })
              appendMessagesForTier(activeTier, [
                {
                  role: "assistant",
                  content: "Cooldown finished. Executing private stake now.",
                  timestamp: nowTimestampLabel(),
                },
              ])
              const pinnedNoteCommitment = (
                stakePrivacyPayload.note_commitment ||
                stakePrivacyPayload.commitment ||
                ""
              ).trim()
              const pinnedNullifier = (stakePrivacyPayload.nullifier || "").trim()
              stakePrivacyPayload = await requestGaragaPayload(
                "stake",
                token,
                token,
                stakeAmountText,
                {
                  denomId: String(effectiveHideTierUsdt),
                  noteVersion: HIDE_BALANCE_NOTE_VERSION || "v4",
                  noteCommitment: pinnedNoteCommitment || undefined,
                  nullifier: pinnedNullifier || undefined,
                }
              )
              if (!(stakePrivacyPayload.denom_id || "").trim()) {
                stakePrivacyPayload.denom_id = String(effectiveHideTierUsdt)
              }
              const noteRetryBackoffMs = [8000, 12000, 15000, 20000, 25000, 30000]
              for (let retryIndex = 0; ; retryIndex += 1) {
                try {
                  stakeResult = await executePrivateStake(stakePrivacyPayload)
                  break
                } catch (retryError) {
                  const retryMessage =
                    retryError instanceof Error ? retryError.message : String(retryError ?? "")
                  const stillNotRegistered = isHideNoteRegistrationMissingMessage(retryMessage)
                  if (!stillNotRegistered || retryIndex >= noteRetryBackoffMs.length) {
                    if (stillNotRegistered && retryIndex >= noteRetryBackoffMs.length) {
                      throw new Error(
                        "Hide note is already deposited, but indexer is still syncing. Note is saved in Pending Hide Notes; retry private stake once status is Ready."
                      )
                    }
                    throw retryError
                  }
                  const waitRetryMs =
                    noteRetryBackoffMs[retryIndex] ??
                    noteRetryBackoffMs[noteRetryBackoffMs.length - 1]
                  notifications.addNotification({
                    type: "info",
                    title: "Indexer syncing",
                    message: `Hide note is not fully indexed yet. Retry ${
                      retryIndex + 2
                    }/${noteRetryBackoffMs.length + 1} in ${formatDurationHhMmSs(waitRetryMs)}.`,
                  })
                  await waitMs(waitRetryMs)
                  stakePrivacyPayload = await requestGaragaPayload(
                    "stake",
                    token,
                    token,
                    stakeAmountText,
                    {
                      denomId: String(effectiveHideTierUsdt),
                      noteVersion: HIDE_BALANCE_NOTE_VERSION || "v4",
                      noteCommitment: pinnedNoteCommitment || undefined,
                      nullifier: pinnedNullifier || undefined,
                    }
                  )
                  if (!(stakePrivacyPayload.denom_id || "").trim()) {
                    stakePrivacyPayload.denom_id = String(effectiveHideTierUsdt)
                  }
                }
              }
            } else {
              throw new Error(
                `Hide relayer unavailable. Wallet fallback is disabled so stake details never leak in explorer. Detail: ${message}`
              )
            }
          }
        } else {
          const calls = buildStakeWalletCalls(token, amountText)
          notifications.addNotification({
            type: "info",
            title: "Wallet signature required",
            message: `Confirm stake ${amountText} ${token} in your wallet.`,
          })
          txHash = await invokeWalletCallsWithSequentialFallback(calls, providerHint, {
            allowSequentialFallback: calls.length === 2,
            onFallback: () => {
              notifications.addNotification({
                type: "warning",
                title: "Wallet multicall fallback",
                message:
                  "Wallet rejected multicall payload format. Continuing with separate signatures: approve, then stake.",
              })
            },
          })
          stakeResult = await stakeDeposit({
            pool_id: token,
            amount: amountText,
            onchain_tx_hash: txHash,
            plan_id: activePlanId || undefined,
            hide_balance: false,
          })
        }
        const finalStakeTx = stakeResult.tx_hash || txHash || stakeResult.privacy_tx_hash || ""
        if (stakeResult.privacy_tx_hash) {
          notifications.addNotification({
            type: "info",
            title: "Garaga verification submitted",
            message: `Privacy tx ${stakeResult.privacy_tx_hash.slice(0, 12)}... was submitted on Starknet.`,
            txHash: stakeResult.privacy_tx_hash,
            txNetwork: "starknet",
          })
        }
        notifications.addNotification({
          type: "success",
          title: "Stake completed",
          message: `Staked ${stakeAmountText} ${token}.`,
          txHash: finalStakeTx || undefined,
          txNetwork: finalStakeTx ? "starknet" : undefined,
        })
        if (finalStakeTx) {
          markAiTransaction(finalStakeTx)
        }
        if (stakeResult.position_id) {
          markAiStakePosition(stakeResult.position_id)
        }
        if (tierUsesGaraga && HIDE_BALANCE_SHIELDED_POOL) {
          const consumedNoteCommitment = (
            stakePrivacyPayload?.note_commitment ||
            stakePrivacyPayload?.commitment ||
            ""
          ).trim()
          const consumedNullifier = (stakePrivacyPayload?.nullifier || "").trim()
          if (consumedNoteCommitment || consumedNullifier) {
            removeAiPendingHideNote(consumedNoteCommitment, consumedNullifier)
          }
        }
        const stakeTxPreview = finalStakeTx ? `${finalStakeTx.slice(0, 14)}...` : "-"
        const stakeTxUrl = finalStakeTx ? buildTxExplorerUrl(finalStakeTx, "starknet") : ""
        const hideDepositTxPreview = hideDepositTxHash
          ? `${hideDepositTxHash.slice(0, 14)}...`
          : ""
        const hideDepositTxUrl = hideDepositTxHash
          ? buildTxExplorerUrl(hideDepositTxHash, "starknet")
          : ""
        const hideDepositLine = hideDepositTxHash
          ? `Hide note deposit tx: ${hideDepositTxPreview}${hideDepositTxUrl ? `\nTrack deposit tx: ${hideDepositTxUrl}` : ""}`
          : ""
        const stakeEstimatedPoints = parseNumberish(stakeResult.estimated_points_earned)
        const stakeDiscountPercent = parseNumberish(stakeResult.nft_discount_percent)
        const stakeDiscountSaved = parseNumberish(stakeResult.fee_discount_saved)
        const stakeAiBonusPercent = parseNumberish(stakeResult.ai_level_points_bonus_percent)
        const pointsLine =
          stakeEstimatedPoints > 0
            ? `Points reward: +${stakeEstimatedPoints.toFixed(2)} (estimated).${
                stakeAiBonusPercent > 0
                  ? ` Includes AI level bonus +${stakeAiBonusPercent.toFixed(2)}%.`
                  : ""
              }`
            : `Points reward: 0${
                stakeAiBonusPercent > 0
                  ? ` (AI level bonus +${stakeAiBonusPercent.toFixed(2)}% is active once threshold is met).`
                  : "."
              }`
        const discountLine =
          stakeDiscountPercent > 0
            ? `Discount NFT applied ${stakeDiscountPercent.toFixed(2)}% (fee saved ${stakeDiscountSaved.toFixed(6)} ${token}).`
            : "Discount NFT not active on this stake."
        notifications.addNotification({
          type: "info",
          title: "Points & Discount",
          message: `${pointsLine} ${discountLine}`,
        })

        directExecutionMessage = normalizeMessageText(
          `✅ Stake executed: ${stakeAmountText} ${token}. Tx: ${stakeTxPreview}${
            stakeTxUrl ? `\nTrack tx: ${stakeTxUrl}` : ""
          }${hideDepositLine ? `\n${hideDepositLine}` : ""}`
        )
      }

      const canAutoExecuteClaim =
        !directExecutionMessage &&
        activeTier >= 2 &&
        /\bclaim\b/i.test(command) &&
        (response.actions || []).includes("execute_stake_claim")
      if (canAutoExecuteClaim) {
        const parsedClaimToken = parseStakeTokenHintFromCommand(command)
        const token = resolveStakeTokenSymbol(parsedClaimToken?.token || "")
        if (!token) {
          throw new Error("Claim token is missing. Try: `claim CAREL` or `claim USDC`.")
        }
        notifications.addNotification({
          type: "info",
          title: "Wallet signature required",
          message: `Confirm claim rewards ${token} in your Starknet wallet.`,
        })
        const calls = buildClaimWalletCalls(token)
        const txHash = await invokeWalletCallsWithSequentialFallback(calls, providerHint, {
          allowSequentialFallback: true,
          onFallback: () => {
            notifications.addNotification({
              type: "warning",
              title: "Wallet multicall fallback",
              message: "Wallet multicall failed. Continuing with sequential claim calls.",
            })
          },
        })
        await stakeClaim({
          position_id: token,
          onchain_tx_hash: txHash,
          plan_id: activePlanId || undefined,
          hide_balance: false,
        })
        directExecutionMessage = normalizeMessageText(
          `✅ Claim submitted: ${token} rewards. Tx: ${txHash.slice(0, 12)}...\nTrack tx: ${buildTxExplorerUrl(
            txHash,
            "starknet"
          )}`
        )
      }

      const canAutoExecuteLimitOrder =
        !directExecutionMessage &&
        activeTier >= 2 &&
        /\blimit(?:\s|-)?order\b/i.test(command) &&
        (response.actions || []).includes("execute_limit_order")
      if (canAutoExecuteLimitOrder && parsedLimit) {
        const { fromToken, toToken, amountText, priceText, expiry } = parsedLimit
        if (
          !SUPPORTED_LIMIT_ORDER_TOKENS.has(fromToken) ||
          !SUPPORTED_LIMIT_ORDER_TOKENS.has(toToken)
        ) {
          throw new Error(`Limit order token ${fromToken}/${toToken} is not supported.`)
        }
        if (!amountText) {
          throw new Error("Limit order amount is required.")
        }
        if (!STARKNET_LIMIT_ORDER_BOOK_ADDRESS.trim()) {
          throw new Error("NEXT_PUBLIC_STARKNET_LIMIT_ORDER_BOOK_ADDRESS is not configured.")
        }
        const expirySeconds =
          expiry === "1d"
            ? 24 * 60 * 60
            : expiry === "30d"
            ? 30 * 24 * 60 * 60
            : 7 * 24 * 60 * 60

        notifications.addNotification({
          type: "info",
          title: "Wallet signature required",
          message: `Confirm limit order ${amountText} ${fromToken}/${toToken} in your wallet.`,
        })
        const [amountLow, amountHigh] = decimalToU256Parts(
          amountText,
          AI_TOKEN_DECIMALS[fromToken] ?? 18
        )
        const [priceLow, priceHigh] = decimalToU256Parts(priceText, 18)
        const calls = [
          {
            contractAddress: STARKNET_LIMIT_ORDER_BOOK_ADDRESS.trim(),
            entrypoint: "create_limit_order",
            calldata: [
              (AI_TOKEN_ADDRESS_MAP[fromToken] || "").trim(),
              (AI_TOKEN_ADDRESS_MAP[toToken] || "").trim(),
              amountLow,
              amountHigh,
              priceLow,
              priceHigh,
              String(expirySeconds),
            ],
          },
        ]
        const txHash = await invokeStarknetCallsFromWallet(calls, providerHint)
        const limitResult = await createLimitOrder({
          from_token: fromToken,
          to_token: toToken,
          amount: amountText,
          price: priceText,
          expiry,
          onchain_tx_hash: txHash,
          plan_id: activePlanId || undefined,
          hide_balance: false,
        })
        markAiLimitOrder(limitResult.order_id)
        directExecutionMessage = normalizeMessageText(
          `✅ Limit order created: ${amountText} ${fromToken} -> ${toToken} at ${priceText} (${expiry}). Order: ${limitResult.order_id}. Tx: ${txHash.slice(0, 12)}...\nTrack tx: ${buildTxExplorerUrl(
            txHash,
            "starknet"
          )}`
        )
      }

      const canAutoExecuteLimitOrderCancel =
        !directExecutionMessage &&
        activeTier >= 2 &&
        /\bcancel\s+order\b/i.test(command) &&
        (response.actions || []).includes("prepare_limit_order_cancel")
      if (canAutoExecuteLimitOrderCancel) {
        const targetOrderId = parseLimitOrderIdFromCancelCommand(command)
        if (!targetOrderId) {
          directExecutionMessage =
            "Cancel order needs a concrete order id. Use: `cancel order 0x...` with one active order id."
        } else {
          if (!STARKNET_LIMIT_ORDER_BOOK_ADDRESS.trim()) {
            throw new Error("NEXT_PUBLIC_STARKNET_LIMIT_ORDER_BOOK_ADDRESS is not configured.")
          }
          notifications.addNotification({
            type: "info",
            title: "Wallet signature required",
            message: `Confirm cancel limit order ${targetOrderId.slice(0, 12)}... in your wallet.`,
          })
          const cancelTxHash = await invokeStarknetCallsFromWallet(
            [
              {
                contractAddress: STARKNET_LIMIT_ORDER_BOOK_ADDRESS.trim(),
                entrypoint: "cancel_limit_order",
                calldata: [targetOrderId],
              },
            ],
            providerHint
          )
          await cancelLimitOrder(targetOrderId, {
            onchain_tx_hash: cancelTxHash,
            plan_id: activePlanId || undefined,
            hide_balance: false,
          })
          notifications.addNotification({
            type: "success",
            title: "Order cancelled",
            message: `Cancelled order ${targetOrderId.slice(0, 12)}...`,
            txHash: cancelTxHash,
            txNetwork: "starknet",
          })
          const cancelTxPreview = `${cancelTxHash.slice(0, 14)}...`
          const cancelTxUrl = buildTxExplorerUrl(cancelTxHash, "starknet")
          directExecutionMessage = normalizeMessageText(
            `✅ Limit order cancelled: ${targetOrderId}. Tx: ${cancelTxPreview}${
              cancelTxUrl ? `\nTrack tx: ${cancelTxUrl}` : ""
            }`
          )
        }
      }

      const followUps = await buildActionFollowUps(response.actions || [], response.data)
      const cleanFollowUps = followUps
        .map((item) => normalizeMessageText(item.content))
        .filter((item) => item.length > 0)
      const fallbackAssistant =
        activeTier >= 2
          ? "Command received. Continue wallet confirmation if this is an on-chain action."
          : "Command received."
      const baseAssistant = normalizeMessageText(response.response || "")
      const firstFollowUp = cleanFollowUps[0] || ""
      const prioritizeLive = (response.actions || []).some((action) =>
        LIVE_DATA_PRIORITY_ACTIONS.has(action)
      )
      const shouldKeepBaseMessage =
        !!baseAssistant && !/^(command received\.?|perintah diterima\.?)$/i.test(baseAssistant.trim())
      const assistantContent = directExecutionMessage
        ? directExecutionMessage
        : firstFollowUp
        ? prioritizeLive
          ? shouldKeepBaseMessage
            ? normalizeMessageText(`${baseAssistant}\n\n${firstFollowUp}`)
            : firstFollowUp
          : normalizeMessageText(`${baseAssistant || fallbackAssistant}\n\n${firstFollowUp}`)
        : baseAssistant || fallbackAssistant

      appendMessagesForTier(activeTier, [
        {
          role: "assistant",
          content: assistantContent,
          timestamp: nowTimestampLabel(),
        },
      ])
      if (commandRequiresSetup) {
        if (typeof actionIdValue === "number" && actionIdValue > 0) {
          setPendingActions((prev) => prev.filter((id) => id !== actionIdValue))
        }
        setActionId("")
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "AI request failed."
      const message = formatExecutionFailureMessage(rawMessage, command)
      if (/please click auto setup on-chain first|no valid on-chain setup found/i.test(message)) {
        setActionId("")
        setPendingActions([])
      }
      appendMessagesForTier(activeTier, [
        {
          role: "assistant",
          content: `I couldn't execute that command: ${message}`,
          timestamp: nowTimestampLabel(),
        },
      ])
      notifications.addNotification({
        type: "error",
        title: "AI Assistant",
        message,
      })
    } finally {
      setIsSending(false)
    }
  }

  return { handleSend, isSending }
}
