"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { X, Minus, ChevronUp, ArrowUpRight, Zap, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  autoSubmitPrivacyAction,
  cancelLimitOrder,
  createLimitOrder,
  executeAiCommand,
  executeBridge,
  executeSwap,
  getAiPendingActions,
  prepareAiAction,
  getAiRuntimeConfig,
  ensureAiExecutorReady,
  getAiLevel,
  upgradeAiLevel,
  getBridgeQuote,
  getOnchainBalances,
  getOwnedNfts,
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
import { useNotifications } from "@/hooks/use-notifications"
import { useWallet } from "@/hooks/use-wallet"
import {
  decimalToU256Parts,
  invokeStarknetCallFromWallet,
  invokeStarknetCallsFromWallet,
  sendEvmTransactionFromWallet,
  toHexFelt,
} from "@/lib/onchain-trade"
import {
  BTC_TESTNET_EXPLORER_BASE_URL,
  ETHERSCAN_SEPOLIA_BASE_URL,
  STARKSCAN_SEPOLIA_BASE_URL,
} from "@/lib/network-config"

const dmSans = { className: "font-sans" }
const spaceMono = { className: "font-mono" }

const aiTiers = [
  {
    id: 1,
    name: "Level 1",
    cost: 0,
    costLabel: "FREE",
    description: "Basic queries, price check",
  },
  {
    id: 2,
    name: "Level 2",
    cost: 5,
    costLabel: "5 CAREL",
    description: "Swap/bridge/stake/claim/limit execution",
  },
  {
    id: 3,
    name: "Level 3",
    cost: 10,
    costLabel: "10 CAREL",
    description: "All L2 actions in Garaga mode + unstake/portfolio/alerts",
  },
]

const tierGreetingMessage: Record<number, string> = {
  1: "Welcome to CAREL Agent (Level 1). I can help with read-only data: balance, points, token prices, and market info.",
  2: "Welcome to CAREL Agent (Level 2). I can execute live DeFi actions after wallet confirmation. Each execution burns 1 CAREL.",
  3: "Welcome to CAREL Agent (Level 3). I can run private Garaga-mode execution and advanced analysis. Each execution burns 2 CAREL. Bridge is currently available on Level 2.",
}

const quickPromptsByTier: Record<number, string[]> = {
  1: ["check balance", "my points", "STRK price", "market info", "what can you do?"],
  2: [
    "please swap 25 STRK to WBTC",
    "please swap 20 CAREL to USDT",
    "please swap 15 USDC to WBTC",
    "please swap 25 USDC to CAREL",
    "please bridge 0.05 ETH to WBTC",
    "please bridge 0.005 BTC to WBTC",
    "please bridge 0.05 ETH to BTC",
    "please stake 15 USDT",
    "please stake 10 USDT",
    "please stake 100 CAREL",
    "please stake 0.0005 WBTC",
    "please limit order STRK/USDT amount 10 at 1.25 expiry 1d",
    "please limit order STRK/USDC amount 10 at 1.25 expiry 3d",
    "please limit order CAREL/USDC amount 10 at 1.25 expiry 1d",
    "please limit order USDT/USDC amount 10 at 1.25 expiry 3d",
  ],
  3: [
    "please set price alert for WBTC",
    "please private swap 25 STRK to WBTC",
    "please private swap 20 CAREL to USDT",
    "please private swap 15 USDC to WBTC",
    "please private swap 25 USDC to CAREL",
    "please private stake 15 USDT",
    "please private stake 10 USDT",
    "please private stake 100 CAREL",
    "please private stake 0.0005 WBTC",
    "please private limit order STRK/USDT amount 10 at 1.25 expiry 1d",
    "please private limit order STRK/USDC amount 10 at 1.25 expiry 3d",
    "please private limit order CAREL/USDC amount 10 at 1.25 expiry 1d",
    "please private limit order USDT/USDC amount 10 at 1.25 expiry 3d",
    "switch to L2 for bridge",
    "rebalance portfolio",
  ],
}
const l2BridgeShortcutPrompts = quickPromptsByTier[2].filter((prompt) => /\bbridge\b/i.test(prompt))

const featureListByTier: Record<number, string> = {
  1: "Available now: chat, balance check, points check, token price, and market summary.",
  2: "Available now: swap, bridge, stake, claim rewards, create limit order, and cancel order. Tap one example below to start.",
  3: "Available now: private swap/stake/claim/limit order, plus portfolio rebalance, price alerts, and deeper analysis. Bridge stays on Level 2 for now.",
}

const levelBadgeClasses: Record<number, string> = {
  1: "bg-[#334155] text-[#cbd5e1] border-[#475569]",
  2: "bg-[#7c3aed33] text-[#c4b5fd] border-[#7c3aed]",
  3: "bg-[#06b6d433] text-[#67e8f9] border-[#06b6d4]",
}

const STATIC_STARKNET_AI_EXECUTOR_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_AI_EXECUTOR_ADDRESS ||
  process.env.NEXT_PUBLIC_AI_EXECUTOR_ADDRESS ||
  ""
const STATIC_CAREL_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_CAREL_ADDRESS ||
  process.env.NEXT_PUBLIC_CAREL_TOKEN_ADDRESS ||
  ""
const AI_SETUP_SKIP_APPROVE =
  process.env.NEXT_PUBLIC_AI_SETUP_SKIP_APPROVE === "true" ||
  process.env.NEXT_PUBLIC_AI_DEMO_MODE === "true"
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
const HIDE_BALANCE_EXECUTOR_KIND = (
  process.env.NEXT_PUBLIC_HIDE_BALANCE_EXECUTOR_KIND || ""
)
  .trim()
  .toLowerCase()
const HIDE_BALANCE_SHIELDED_POOL_V2 =
  HIDE_BALANCE_EXECUTOR_KIND === "shielded_pool_v2" ||
  HIDE_BALANCE_EXECUTOR_KIND === "shielded-v2" ||
  HIDE_BALANCE_EXECUTOR_KIND === "v2"
const GARDEN_STARKNET_APPROVE_SELECTOR = "0x219209e083275171774dab1df80982e9df2096516f06319c5c6d71ae0a8480c"
const GARDEN_STARKNET_INITIATE_SELECTOR = "0x2aed25fcd0101fcece997d93f9d0643dfa3fbd4118cae16bf7d6cd533577c28"

const AI_ACTION_TYPE_SWAP = 0
const AI_ACTION_TYPE_MULTI_STEP = 5
const BRIDGE_COMMAND_REGEX = /\b(bridge|brigde|briedge|jembatan)\b/i
const TIER2_ONCHAIN_COMMAND_REGEX =
  /\b(swap|bridge|brigde|briedge|stake|claim|limit(?:\s|-)?order|cancel\s+order)\b/i
const TIER3_ONCHAIN_COMMAND_REGEX =
  /\b(swap|bridge|brigde|briedge|stake|unstake|claim|limit(?:\s|-)?order|cancel\s+order|portfolio|rebalance|alert|price alert)\b/i
const LIVE_DATA_PRIORITY_ACTIONS = new Set([
  "get_swap_quote",
  "get_bridge_quote",
  "show_balance",
  "show_points_breakdown",
  "show_chart",
])
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
const STARKNET_STAKING_BTC_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_STAKING_BTC_ADDRESS ||
  process.env.NEXT_PUBLIC_STAKING_BTC_ADDRESS ||
  ""
const STARKNET_LIMIT_ORDER_BOOK_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_LIMIT_ORDER_BOOK_ADDRESS ||
  process.env.NEXT_PUBLIC_LIMIT_ORDER_BOOK_ADDRESS ||
  ""
const AI_TOKEN_ADDRESS_MAP: Record<string, string> = {
  CAREL:
    process.env.NEXT_PUBLIC_TOKEN_CAREL_ADDRESS ||
    process.env.NEXT_PUBLIC_CAREL_TOKEN_ADDRESS ||
    "0x0517f60f4ec4e1b2b748f0f642dfdcb32c0ddc893f777f2b595a4e4f6df51545",
  STRK:
    process.env.NEXT_PUBLIC_TOKEN_STRK_ADDRESS ||
    "0x04718f5a0Fc34cC1AF16A1cdee98fFB20C31f5cD61D6Ab07201858f4287c938D",
  USDT:
    process.env.NEXT_PUBLIC_TOKEN_USDT_ADDRESS ||
    "0x030fcbfd1f83fb2d697ad8bdd52e1d55a700b876bed1f4507875539581ed53e5",
  USDC:
    process.env.NEXT_PUBLIC_TOKEN_USDC_ADDRESS ||
    "0x0179cc8cb5ea0b143e17d649e8ad60d80c45c8132c4cf162d57eaf8297f529d8",
  WBTC:
    process.env.NEXT_PUBLIC_TOKEN_WBTC_ADDRESS ||
    process.env.NEXT_PUBLIC_TOKEN_BTC_ADDRESS ||
    "0x496bef3ed20371382fbe0ca6a5a64252c5c848f9f1f0cccf8110fc4def912d5",
  BTC:
    process.env.NEXT_PUBLIC_TOKEN_BTC_ADDRESS ||
    process.env.NEXT_PUBLIC_TOKEN_WBTC_ADDRESS ||
    "0x496bef3ed20371382fbe0ca6a5a64252c5c848f9f1f0cccf8110fc4def912d5",
}
const STARKNET_WBTC_STAKING_TOKEN_ADDRESS = (
  process.env.NEXT_PUBLIC_TOKEN_WBTC_ADDRESS ||
  "0x496bef3ed20371382fbe0ca6a5a64252c5c848f9f1f0cccf8110fc4def912d5"
).trim()
const AI_TOKEN_DECIMALS: Record<string, number> = {
  CAREL: 18,
  STRK: 18,
  USDT: 6,
  USDC: 6,
  WBTC: 8,
  BTC: 8,
}
const U256_MAX_WORD_HEX = "0xffffffffffffffffffffffffffffffff"
const SUPPORTED_SWAP_TOKENS = new Set(["USDT", "USDC", "STRK", "WBTC", "CAREL"])
const SUPPORTED_LIMIT_ORDER_TOKENS = new Set(["USDT", "USDC", "STRK", "CAREL"])
const SUPPORTED_STAKE_TOKENS = new Set(["CAREL", "USDC", "USDT", "STRK", "WBTC"])
const L3_GARAGA_BRIDGE_ENABLED =
  (process.env.NEXT_PUBLIC_L3_GARAGA_BRIDGE_ENABLED || "false").toLowerCase() === "true"
const GARDEN_ORDER_EXPLORER_BASE_URL =
  process.env.NEXT_PUBLIC_GARDEN_ORDER_EXPLORER_URL || "https://testnet-explorer.garden.finance/order"
type TxExplorerNetwork = "starknet" | "evm" | "btc"
const AI_SETUP_SUBMIT_COOLDOWN_MS = 20_000
const AI_SETUP_PENDING_POLL_ATTEMPTS = Math.max(
  10,
  readMsEnv(process.env.NEXT_PUBLIC_AI_SETUP_PENDING_POLL_ATTEMPTS, 28)
)
const AI_SETUP_PENDING_POLL_INTERVAL_MS = readMsEnv(
  process.env.NEXT_PUBLIC_AI_SETUP_PENDING_POLL_INTERVAL_MS,
  1_500
)
const AI_SETUP_PRE_WALLET_DELAY_MS = readMsEnv(process.env.NEXT_PUBLIC_AI_SETUP_PRE_WALLET_DELAY_MS, 350)
const AI_SETUP_NONCE_RETRY_DELAY_MS = readMsEnv(
  process.env.NEXT_PUBLIC_AI_SETUP_NONCE_RETRY_DELAY_MS,
  1_500
)
const AI_EXECUTOR_PREFLIGHT_CACHE_MS = readMsEnv(
  process.env.NEXT_PUBLIC_AI_EXECUTOR_PREFLIGHT_CACHE_MS,
  90_000
)
const AI_SETUP_SIGNATURE_WINDOW_SECONDS = (() => {
  const raw = Number.parseInt(
    process.env.NEXT_PUBLIC_AI_SETUP_SIGNATURE_WINDOW_SECONDS || "180",
    10
  )
  if (!Number.isFinite(raw)) return 180
  return Math.min(300, Math.max(60, raw))
})()
const AI_REQUIRE_FRESH_SETUP_PER_EXECUTION =
  (process.env.NEXT_PUBLIC_AI_REQUIRE_FRESH_SETUP_PER_EXECUTION || "false").toLowerCase() ===
  "true"
const AI_BUBBLE_STORAGE_KEY = "carel_ai_bubble_position_v1"
const AI_BUBBLE_SIZE_PX = 56
const AI_BUBBLE_EDGE_PADDING_PX = 16
const AI_PANEL_STORAGE_KEY = "carel_ai_panel_position_v1"
const AI_PANEL_EDGE_PADDING_PX = 16
const AI_PANEL_WIDTH_PX = 460
const AI_PANEL_MINIMIZED_HEIGHT_PX = 64
const AI_PANEL_EXPANDED_HEIGHT_PX = 700

type BubblePosition = { x: number; y: number }

function clampBubblePosition(position: BubblePosition): BubblePosition {
  if (typeof window === "undefined") return position
  const maxX = Math.max(
    AI_BUBBLE_EDGE_PADDING_PX,
    window.innerWidth - AI_BUBBLE_SIZE_PX - AI_BUBBLE_EDGE_PADDING_PX
  )
  const maxY = Math.max(
    AI_BUBBLE_EDGE_PADDING_PX,
    window.innerHeight - AI_BUBBLE_SIZE_PX - AI_BUBBLE_EDGE_PADDING_PX
  )
  return {
    x: Math.min(maxX, Math.max(AI_BUBBLE_EDGE_PADDING_PX, position.x)),
    y: Math.min(maxY, Math.max(AI_BUBBLE_EDGE_PADDING_PX, position.y)),
  }
}

function getPanelDimensions(isMinimized: boolean): { width: number; height: number } {
  const defaultHeight = isMinimized ? AI_PANEL_MINIMIZED_HEIGHT_PX : AI_PANEL_EXPANDED_HEIGHT_PX
  if (typeof window === "undefined") {
    return { width: AI_PANEL_WIDTH_PX, height: defaultHeight }
  }
  const width = Math.min(AI_PANEL_WIDTH_PX, Math.max(320, window.innerWidth - AI_PANEL_EDGE_PADDING_PX))
  const height = Math.min(
    defaultHeight,
    Math.max(isMinimized ? AI_PANEL_MINIMIZED_HEIGHT_PX : 320, window.innerHeight - AI_PANEL_EDGE_PADDING_PX)
  )
  return { width, height }
}

function clampPanelPosition(position: BubblePosition, isMinimized: boolean): BubblePosition {
  if (typeof window === "undefined") return position
  const { width, height } = getPanelDimensions(isMinimized)
  const maxX = Math.max(
    AI_PANEL_EDGE_PADDING_PX,
    window.innerWidth - width - AI_PANEL_EDGE_PADDING_PX
  )
  const maxY = Math.max(
    AI_PANEL_EDGE_PADDING_PX,
    window.innerHeight - height - AI_PANEL_EDGE_PADDING_PX
  )
  return {
    x: Math.min(maxX, Math.max(AI_PANEL_EDGE_PADDING_PX, position.x)),
    y: Math.min(maxY, Math.max(AI_PANEL_EDGE_PADDING_PX, position.y)),
  }
}

// Internal helper that supports ms env parsing for AI setup timing.
function readMsEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

// Internal helper that supports controlled setup timing without hard-coded sleeps.
async function waitMs(delayMs: number): Promise<void> {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

/**
 * Parses or transforms values for `encodeShortByteArray`.
 *
 * @param value - Input used by `encodeShortByteArray` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function encodeShortByteArray(value: string): Array<string | number> {
  const normalized = value.trim()
  const byteLen = new TextEncoder().encode(normalized).length
  if (byteLen === 0) return [0, 0, 0]
  if (byteLen > 31) {
    throw new Error("AI action payload is too long. Maximum 31 bytes.")
  }
  return [0, toHexFelt(normalized), byteLen]
}

/**
 * Handles `actionTypeForTier` logic.
 *
 * @param tier - Input used by `actionTypeForTier` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function actionTypeForTier(tier: number): number {
  return tier >= 3 ? AI_ACTION_TYPE_MULTI_STEP : AI_ACTION_TYPE_SWAP
}

// Internal helper that supports `setupApprovalAmountCarel` operations.
function setupApprovalAmountCarel(tier: number): number {
  // Per execution, keep allowance equal to expected burn amount.
  if (tier >= 3) return 2
  return 1
}

/**
 * Handles `requiresOnchainActionForCommand` logic.
 *
 * @param tier - Input used by `requiresOnchainActionForCommand` to compute state, payload, or request behavior.
 * @param command - Input used by `requiresOnchainActionForCommand` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function requiresOnchainActionForCommand(tier: number, command: string): boolean {
  if (tier < 2) return false
  const normalized = command.trim()
  if (!normalized) return false
  if (tier === 2) return TIER2_ONCHAIN_COMMAND_REGEX.test(normalized)
  return TIER3_ONCHAIN_COMMAND_REGEX.test(normalized)
}

/**
 * Checks conditions for `isInvalidUserSignatureError`.
 *
 * @param error - Input used by `isInvalidUserSignatureError` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function isInvalidUserSignatureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "")
  return /invalid user signature|argent\/multicall-failed|multicall-failed|entrypoint_failed/i.test(
    message
  )
}

// Internal helper that supports `isStarknetEntrypointMissingError` operations.
function isStarknetEntrypointMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "")
  return /(requested entrypoint does not exist|entrypoint does not exist|entry point .* not found|entrypoint .* not found|entry_point_not_found)/i.test(
    message
  )
}

// Internal helper that detects ERC20 insufficient-balance reverts from wallet/provider errors.
function isErc20InsufficientBalanceError(message: string): boolean {
  return /erc20:\s*insufficient balance|insufficient balance/i.test(message)
}

// Internal helper that detects wallet rejection/cancel messages across providers.
function isWalletCancellationMessage(message: string): boolean {
  const lower = (message || "").toLowerCase()
  return (
    lower.includes("user rejected") ||
    lower.includes("rejected by user") ||
    lower.includes("request rejected") ||
    lower.includes("user denied") ||
    lower.includes("denied by user") ||
    lower.includes("cancelled") ||
    lower.includes("canceled") ||
    lower.includes("declined")
  )
}

// Internal helper that formats on-chain setup failures into actionable messages.
function formatDecimalTokenAmount(raw: string, decimals: number, precision = 6): string {
  const normalized = (raw || "").replace(/\D/g, "")
  if (!normalized) return "0"
  const trimmed = normalized.replace(/^0+/, "") || "0"
  if (trimmed === "0") return "0"
  if (trimmed.length <= decimals) {
    const fraction = trimmed
      .padStart(decimals, "0")
      .replace(/0+$/, "")
      .slice(0, precision)
    return fraction ? `0.${fraction}` : "0"
  }
  const whole = trimmed.slice(0, trimmed.length - decimals)
  const fraction = trimmed
    .slice(trimmed.length - decimals)
    .replace(/0+$/, "")
    .slice(0, precision)
  return fraction ? `${whole}.${fraction}` : whole
}

// Internal helper that detects Starknet v3 resource-bound balance validation failures.
function isResourceBoundsExceedBalanceError(message: string): boolean {
  const lower = (message || "").toLowerCase()
  return (
    lower.includes("validationfailure") &&
    lower.includes("resources bounds") &&
    lower.includes("exceed balance")
  )
}

// Internal helper that parses `exceed balance (<felt>)` from provider errors.
function extractExceedBalanceRaw(message: string): string | null {
  const match = message.match(/exceed balance\s*\((\d+)\)/i)
  if (!match) return null
  return match[1] || null
}

// Internal helper that formats on-chain setup failures into actionable messages.
function formatSetupFailureMessage(
  rawMessage: string,
  requiredCarel: number,
  knownCarelBalance: number | null
): string {
  const lowerRaw = rawMessage.toLowerCase()
  if (isResourceBoundsExceedBalanceError(rawMessage)) {
    const rawBalance = extractExceedBalanceRaw(rawMessage)
    const balanceHint = rawBalance
      ? ` Wallet STRK balance is ~${formatDecimalTokenAmount(rawBalance, 18)} STRK.`
      : ""
    return (
      "Insufficient STRK to cover Starknet max-fee/resource-bounds for execution setup." +
      `${balanceHint} Top up STRK (recommended >= 5 STRK), then retry Auto Setup On-Chain.`
    )
  }
  if (isErc20InsufficientBalanceError(rawMessage) || /fee transfer failed/i.test(lowerRaw)) {
    const balanceHint =
      typeof knownCarelBalance === "number" && Number.isFinite(knownCarelBalance)
        ? ` Current CAREL balance: ~${knownCarelBalance.toFixed(6)}.`
        : ""
    return (
      `Insufficient CAREL for execution setup. This transaction burns ${requiredCarel} CAREL on-chain.` +
      `${balanceHint} Top up CAREL, then retry Auto Setup.`
    )
  }
  return rawMessage
}

// Internal helper that formats execution-time errors for clearer user guidance.
function formatExecutionFailureMessage(rawMessage: string, command: string): string {
  const lowerRaw = rawMessage.toLowerCase()
  if (
    /\b(stake|unstake|claim)\b/i.test(command) &&
    /token\s+btc\s+tidak\s+didukung|token\s+.*\s+tidak\s+didukung/i.test(lowerRaw)
  ) {
    return "WBTC (Starknet) token is not registered in the StakingBTC allowlist yet. Admin must register WBTC first (run `smartcontract/scripts/09_register_staking_tokens.sh` or call `add_btc_token`), then retry."
  }
  if (
    /\bstake\b/i.test(command) &&
    /wallet_addinvoketransaction failed: invalid transaction/i.test(lowerRaw) &&
    /expected\":\s*\"array\"/i.test(rawMessage)
  ) {
    return "Wallet rejected multicall payload format for this staking transaction. Retry once; if it still fails, the app will fallback to separate approve + stake signatures."
  }
  if (/\bclaim\b/i.test(command) && isErc20InsufficientBalanceError(rawMessage)) {
    return "Claim reverted with `ERC20: insufficient balance`. The staking reward pool likely has insufficient on-chain reward liquidity right now. Retry later or top up reward token liquidity, then claim again."
  }
  return rawMessage
}

// Internal helper that detects relayer funding allowance failures for hide-mode flows.
function isRelayerAllowanceErrorMessage(message: string): boolean {
  return /(insufficient allowance|shielded note funding failed|deposit_fixed_for|allowance)/i.test(
    message || ""
  )
}

// Internal helper that detects wallet-side multicall payload schema failures.
function isWalletMulticallPayloadError(message: string): boolean {
  const lower = message.toLowerCase()
  const isWalletInvokeFailure =
    /wallet_addinvoketransaction failed|account\.execute failed|failed to submit starknet transaction from wallet/i.test(
      lower
    )
  if (!isWalletInvokeFailure) return false
  return (
    /invalid_union|invalid input/i.test(lower) ||
    /expected\":\s*\"array\"/i.test(message) ||
    /expected':\s*'array'/i.test(message)
  )
}

// Internal helper that detects wallet-side multicall execution failures that are safer to retry sequentially.
function isWalletMulticallExecutionError(message: string): boolean {
  const lower = message.toLowerCase()
  const isWalletInvokeFailure =
    /wallet_addinvoketransaction failed|account\.execute failed|failed to submit starknet transaction from wallet/i.test(
      lower
    )
  if (!isWalletInvokeFailure) return false
  return (
    /argent\/multicall-failed|multicall-failed|invalid user signature|entrypoint_failed/i.test(
      lower
    )
  )
}

// Internal helper that executes Starknet calls with optional sequential fallback.
async function invokeWalletCallsWithSequentialFallback(
  calls: Parameters<typeof invokeStarknetCallsFromWallet>[0],
  providerHint: Parameters<typeof invokeStarknetCallsFromWallet>[1],
  options?: { allowSequentialFallback?: boolean; onFallback?: () => void }
): Promise<string> {
  try {
    return await invokeStarknetCallsFromWallet(calls, providerHint)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "")
    const shouldFallbackSequentially =
      options?.allowSequentialFallback &&
      calls.length >= 2 &&
      (isWalletMulticallPayloadError(message) || isWalletMulticallExecutionError(message))
    if (!shouldFallbackSequentially) {
      throw error
    }
    options.onFallback?.()
    let lastTxHash = ""
    for (const call of calls) {
      lastTxHash = await invokeStarknetCallFromWallet(call, providerHint)
    }
    return lastTxHash
  }
}

/**
 * Parses or transforms values for `formatBackendConnectivityMessage`.
 *
 * @param error - Input used by `formatBackendConnectivityMessage` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function formatBackendConnectivityMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "")
  if (/failed to fetch|network error|request timeout|backend unavailable/i.test(message)) {
    return "Backend is not connected. Run `cd backend-rust && cargo run` and ensure `NEXT_PUBLIC_BACKEND_URL` points to backend (default: http://localhost:8080)."
  }
  return message || "Failed to contact backend."
}

/**
 * Fetches data for `resolveStarknetProviderHint`.
 *
 * @param provider - Input used by `resolveStarknetProviderHint` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function resolveStarknetProviderHint(provider: string | null): "starknet" | "argentx" | "braavos" {
  if (provider === "argentx" || provider === "braavos") return provider
  return "starknet"
}

/**
 * Fetches data for `findNewPendingAction`.
 *
 * @param after - Input used by `findNewPendingAction` to compute state, payload, or request behavior.
 * @param before - Input used by `findNewPendingAction` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function findNewPendingAction(after: number[], before: number[]): number | null {
  const beforeSet = new Set(before)
  let latest: number | null = null
  for (const id of after) {
    if (!beforeSet.has(id)) {
      latest = latest === null ? id : Math.max(latest, id)
    }
  }
  return latest
}

/**
 * Handles `pickLatestPendingAction` logic.
 *
 * @param pending - Input used by `pickLatestPendingAction` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function pickLatestPendingAction(pending: number[]): number | null {
  if (pending.length === 0) return null
  return Math.max(...pending)
}

// Internal helper that supports `pickLatestPendingAbove` operations.
function pickLatestPendingAbove(pending: number[], threshold: number): number | null {
  let latest: number | null = null
  for (const id of pending) {
    if (id > threshold) {
      latest = latest === null ? id : Math.max(latest, id)
    }
  }
  return latest
}

// Internal helper that supports `executionBurnAmountCarel` operations.
function executionBurnAmountCarel(tier: number): number {
  return tier >= 3 ? 2 : 1
}

// Internal helper that supports `formatSwapMinAmountOut` operations.
function formatSwapMinAmountOut(quotedOutRaw: string, slippagePercent: number): string {
  const quotedOut = Number.parseFloat(String(quotedOutRaw || "0"))
  if (!Number.isFinite(quotedOut) || quotedOut <= 0) return "0"
  const safeSlippage = Number.isFinite(slippagePercent) ? Math.max(0, slippagePercent) : 0
  const minOut = quotedOut * Math.max(0, 1 - safeSlippage / 100)
  const precision = quotedOut < 1 ? 12 : 8
  const normalized = minOut.toFixed(precision).replace(/\.?0+$/, "")
  return normalized || "0"
}

// Internal helper that parses or transforms values for `normalizeHexArray`.
function normalizeHexArray(values?: string[] | null): string[] {
  if (!Array.isArray(values)) return []
  return values
    .map((item) => (typeof item === "string" ? item.trim() : String(item ?? "").trim()))
    .filter((item) => item.length > 0)
}

// Internal helper that supports `resolveStakeTokenSymbol` operations.
function resolveStakeTokenSymbol(value: string): string {
  const normalized = value.trim().toUpperCase()
  if (normalized === "BTC" || normalized === "BITCOIN") return "WBTC"
  return normalized
}

// Internal helper that checks conditions for `isSupportedBridgePair`.
function isSupportedBridgePair(fromChain: string, toChain: string, fromToken: string, toToken: string): boolean {
  const from = fromToken.trim().toUpperCase()
  const to = toToken.trim().toUpperCase()
  return (
    (fromChain === "ethereum" && toChain === "bitcoin" && from === "ETH" && to === "BTC") ||
    (fromChain === "bitcoin" && toChain === "ethereum" && from === "BTC" && to === "ETH") ||
    (fromChain === "bitcoin" && toChain === "starknet" && from === "BTC" && to === "WBTC") ||
    (fromChain === "starknet" && toChain === "bitcoin" && from === "WBTC" && to === "BTC") ||
    (fromChain === "ethereum" && toChain === "starknet" && from === "ETH" && to === "WBTC") ||
    (fromChain === "starknet" && toChain === "ethereum" && from === "WBTC" && to === "ETH")
  )
}

interface BridgeAddressContext {
  address?: string | null
  starknetAddress?: string | null
  evmAddress?: string | null
  btcAddress?: string | null
}

// Internal helper that parses or transforms values for `parseBridgeTokensFromCommand`.
function parseBridgeTokensFromCommand(
  command: string
): { fromToken: string; toToken: string; amountText: string } | null {
  const normalized = normalizeMessageText(command).replace(/[,()]/g, " ")
  const withAmountTokenFirst = normalized.match(
    /\b(?:bridge|brigde|briedge|jembatan)\b\s+([a-z0-9]{2,12})\s+([0-9]+(?:\.[0-9]+)?)\s*(?:to|ke|->|→)\s*([a-z0-9]{2,12})\b/i
  )
  if (withAmountTokenFirst) {
    const fromToken = (withAmountTokenFirst[1] || "").trim().toUpperCase()
    const amountText = (withAmountTokenFirst[2] || "").trim()
    const toToken = (withAmountTokenFirst[3] || "").trim().toUpperCase()
    if (fromToken && toToken) {
      return { fromToken, toToken, amountText }
    }
  }

  const withAmountAmountFirst = normalized.match(
    /\b(?:bridge|brigde|briedge|jembatan)\b\s+([0-9]+(?:\.[0-9]+)?)\s*([a-z0-9]{2,12})\s*(?:to|ke|->|→)\s*([a-z0-9]{2,12})\b/i
  )
  if (withAmountAmountFirst) {
    const amountText = (withAmountAmountFirst[1] || "").trim()
    const fromToken = (withAmountAmountFirst[2] || "").trim().toUpperCase()
    const toToken = (withAmountAmountFirst[3] || "").trim().toUpperCase()
    if (fromToken && toToken) {
      return { fromToken, toToken, amountText }
    }
  }

  const withoutAmount = normalized.match(
    /\b(?:bridge|brigde|briedge|jembatan)\b\s+([a-z0-9]{2,12})\s*(?:to|ke|->|→)\s*([a-z0-9]{2,12})\b/i
  )
  if (withoutAmount) {
    const fromToken = (withoutAmount[1] || "").trim().toUpperCase()
    const toToken = (withoutAmount[2] || "").trim().toUpperCase()
    if (fromToken && toToken) {
      return { fromToken, toToken, amountText: "" }
    }
  }
  return null
}

// Internal helper that parses token/amount from stake commands.
function parseStakeTokenAmountFromCommand(
  command: string
): { token: string; amountText: string } | null {
  const normalized = normalizeMessageText(command).replace(/[,()]/g, " ")
  const direct = normalized.match(
    /\b(?:(?:hide|private)\s+)?stake\b\s+([0-9]+(?:\.[0-9]+)?)\s+([a-z0-9]{2,12})\b/i
  )
  if (!direct) return null
  const amountText = (direct[1] || "").trim()
  const token = resolveStakeTokenSymbol((direct[2] || "").trim())
  if (!amountText || !token) return null
  return { token, amountText }
}

// Internal helper that parses staking-related token hints from stake/unstake/claim commands.
function parseStakeTokenHintFromCommand(
  command: string
): { token: string; amountText?: string } | null {
  const directStake = parseStakeTokenAmountFromCommand(command)
  if (directStake) return directStake

  const normalized = normalizeMessageText(command).replace(/[,()]/g, " ")
  const unstakeWithAmount = normalized.match(
    /\b(?:(?:hide|private)\s+)?unstake\b\s+([0-9]+(?:\.[0-9]+)?)\s+([a-z0-9]{2,12})\b/i
  )
  if (unstakeWithAmount) {
    const amountText = (unstakeWithAmount[1] || "").trim()
    const token = resolveStakeTokenSymbol((unstakeWithAmount[2] || "").trim())
    if (token) return { token, amountText }
  }

  const claimToken = normalized.match(
    /\b(?:(?:hide|private)\s+)?claim(?:\s+staking)?(?:\s+rewards?)?\s+([a-z0-9]{2,12})\b/i
  )
  if (claimToken) {
    const token = resolveStakeTokenSymbol((claimToken[1] || "").trim())
    if (token) return { token }
  }
  return null
}

// Internal helper that supports `missingSourceAddressMessage` operations.
function missingSourceAddressMessage(chain: string): string {
  if (chain === "bitcoin") {
    return "BTC source address is missing. Connect UniSat/Xverse first."
  }
  if (chain === "ethereum") {
    return "Ethereum source address is missing. Connect MetaMask first."
  }
  return "Starknet source address is missing. Connect ArgentX/Braavos first."
}

// Internal helper that supports `missingDestinationAddressMessage` operations.
function missingDestinationAddressMessage(chain: string): string {
  if (chain === "bitcoin") {
    return "BTC destination address is missing. Connect UniSat/Xverse first."
  }
  if (chain === "ethereum") {
    return "Ethereum destination address is missing. Connect MetaMask first."
  }
  return "Starknet destination address is missing. Connect ArgentX/Braavos first."
}

// Internal helper that supports `bridgeAddressRequirementError` operations.
function bridgeAddressRequirementError(
  fromToken: string,
  toToken: string,
  walletContext: BridgeAddressContext
): string | null {
  const fromChain = bridgeTargetChainForToken(fromToken)
  const toChain = bridgeTargetChainForToken(toToken)
  const sourceOwner =
    fromChain === "bitcoin"
      ? walletContext.btcAddress || ""
      : fromChain === "ethereum"
      ? walletContext.evmAddress || ""
      : walletContext.starknetAddress || walletContext.address || ""
  const recipient =
    toChain === "bitcoin"
      ? walletContext.btcAddress || ""
      : toChain === "ethereum"
      ? walletContext.evmAddress || ""
      : walletContext.starknetAddress || walletContext.address || ""

  if (!sourceOwner) return missingSourceAddressMessage(fromChain)
  if (!recipient) return missingDestinationAddressMessage(toChain)
  return null
}

// Internal helper that supports `normalizeGardenStarknetEntrypoint` operations.
function normalizeGardenStarknetEntrypoint(rawSelectorOrEntrypoint: string): string {
  const normalized = (rawSelectorOrEntrypoint || "").trim().toLowerCase()
  if (!normalized) return rawSelectorOrEntrypoint
  if (normalized === GARDEN_STARKNET_APPROVE_SELECTOR) return "approve"
  if (normalized === GARDEN_STARKNET_INITIATE_SELECTOR) return "initiate"
  return rawSelectorOrEntrypoint
}

// Internal helper that parses or transforms values for `buildHideBalancePrivacyCall`.
function buildHideBalancePrivacyCall(payload: PrivacyVerificationPayload) {
  const router = STARKNET_ZK_PRIVACY_ROUTER_ADDRESS.trim()
  if (!router) {
    throw new Error(
      "NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS is not configured. Hide mode requires privacy router address."
    )
  }
  const nullifier = payload.nullifier?.trim() || ""
  const commitment = payload.commitment?.trim() || ""
  const proof = normalizeHexArray(payload.proof)
  const publicInputs = normalizeHexArray(payload.public_inputs)
  if (!nullifier || !commitment || !proof.length || !publicInputs.length) {
    throw new Error("Garaga payload is incomplete (nullifier/commitment/proof/public_inputs).")
  }
  return {
    contractAddress: router,
    entrypoint: "submit_private_action",
    calldata: [nullifier, commitment, String(proof.length), ...proof, String(publicInputs.length), ...publicInputs],
  }
}

// Internal helper that supports `buildStakeWalletCalls` operations.
function buildStakeWalletCalls(tokenSymbol: string, amount: string) {
  const symbol = resolveStakeTokenSymbol(tokenSymbol)
  const decimals = AI_TOKEN_DECIMALS[symbol]
  if (!Number.isFinite(decimals)) {
    throw new Error(`Pool ${symbol} is not supported for staking.`)
  }
  const [amountLow, amountHigh] = decimalToU256Parts(amount, decimals)
  if (symbol === "CAREL") {
    if (!STARKNET_STAKING_CAREL_ADDRESS.trim()) {
      throw new Error("NEXT_PUBLIC_STARKNET_STAKING_CAREL_ADDRESS is not configured.")
    }
    return [
      {
        contractAddress: AI_TOKEN_ADDRESS_MAP.CAREL,
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
  if (symbol === "WBTC") {
    if (!STARKNET_STAKING_BTC_ADDRESS.trim()) {
      throw new Error("NEXT_PUBLIC_STARKNET_STAKING_BTC_ADDRESS is not configured.")
    }
    const wbtc = STARKNET_WBTC_STAKING_TOKEN_ADDRESS
    if (!wbtc) {
      throw new Error("NEXT_PUBLIC_TOKEN_WBTC_ADDRESS is not configured.")
    }
    return [
      {
        contractAddress: wbtc,
        entrypoint: "approve",
        calldata: [STARKNET_STAKING_BTC_ADDRESS.trim(), amountLow, amountHigh],
      },
      {
        contractAddress: STARKNET_STAKING_BTC_ADDRESS.trim(),
        entrypoint: "stake",
        calldata: [wbtc, amountLow, amountHigh],
      },
    ]
  }
  if (symbol === "USDC" || symbol === "USDT" || symbol === "STRK") {
    if (!STARKNET_STAKING_STABLECOIN_ADDRESS.trim()) {
      throw new Error("NEXT_PUBLIC_STARKNET_STAKING_STABLECOIN_ADDRESS is not configured.")
    }
    const tokenAddress = AI_TOKEN_ADDRESS_MAP[symbol]?.trim() || ""
    if (!tokenAddress) {
      throw new Error(`Token address for ${symbol} is not configured.`)
    }
    return [
      {
        contractAddress: tokenAddress,
        entrypoint: "approve",
        calldata: [STARKNET_STAKING_STABLECOIN_ADDRESS.trim(), amountLow, amountHigh],
      },
      {
        contractAddress: STARKNET_STAKING_STABLECOIN_ADDRESS.trim(),
        entrypoint: "stake",
        calldata: [tokenAddress, amountLow, amountHigh],
      },
    ]
  }
  throw new Error(`Pool ${symbol} is not supported for staking.`)
}

// Internal helper that supports `buildClaimWalletCalls` operations.
function buildClaimWalletCalls(tokenSymbol: string) {
  const symbol = resolveStakeTokenSymbol(tokenSymbol)
  if (symbol === "CAREL") {
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
  if (symbol === "WBTC") {
    if (!STARKNET_STAKING_BTC_ADDRESS.trim()) {
      throw new Error("NEXT_PUBLIC_STARKNET_STAKING_BTC_ADDRESS is not configured.")
    }
    const wbtc = STARKNET_WBTC_STAKING_TOKEN_ADDRESS
    if (!wbtc) {
      throw new Error("NEXT_PUBLIC_TOKEN_WBTC_ADDRESS is not configured.")
    }
    return [
      {
        contractAddress: STARKNET_STAKING_BTC_ADDRESS.trim(),
        entrypoint: "claim_rewards",
        calldata: [wbtc],
      },
    ]
  }
  if (symbol === "USDC" || symbol === "USDT" || symbol === "STRK") {
    if (!STARKNET_STAKING_STABLECOIN_ADDRESS.trim()) {
      throw new Error("NEXT_PUBLIC_STARKNET_STAKING_STABLECOIN_ADDRESS is not configured.")
    }
    const tokenAddress = AI_TOKEN_ADDRESS_MAP[symbol]?.trim() || ""
    if (!tokenAddress) {
      throw new Error(`Token address for ${symbol} is not configured.`)
    }
    return [
      {
        contractAddress: STARKNET_STAKING_STABLECOIN_ADDRESS.trim(),
        entrypoint: "claim_rewards",
        calldata: [tokenAddress],
      },
    ]
  }
  throw new Error(`Pool ${symbol} is not supported for claim rewards.`)
}

// Internal helper that supports `expiryToSeconds` operations.
function expiryToSeconds(expiry: string): number {
  const normalized = expiry.trim().toLowerCase()
  if (normalized === "1d") return 24 * 60 * 60
  if (normalized === "30d") return 30 * 24 * 60 * 60
  return 7 * 24 * 60 * 60
}

// Internal helper that supports `generateClientOrderId` operations.
function generateClientOrderId(): string {
  const bytes = new Uint8Array(31)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
  return `0x${hex}`
}

interface Message {
  role: "user" | "assistant"
  content: string
  timestamp: string
}

interface PendingExecutionConfirmation {
  tier: number
  command: string
  createdAt: number
}

interface ExecutorPreflightCache {
  ready: boolean
  burnerRoleGranted: boolean
  message: string
  expiresAt: number
}

type AIData = Record<string, unknown> | null | undefined

// Internal helper that supports `readString` operations.
function readString(data: AIData, key: string): string {
  const value = data && typeof data[key] === "string" ? data[key] : ""
  return typeof value === "string" ? value.trim() : ""
}

// Internal helper that supports `readNumber` operations.
function readNumber(data: AIData, key: string): number {
  const raw = data ? data[key] : undefined
  if (typeof raw === "number") return raw
  if (typeof raw === "string") {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

// Internal helper that supports `parseNumberish` operations.
function parseNumberish(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

// Internal helper that parses limit-order id from `cancel order <id>` commands.
function parseLimitOrderIdFromCancelCommand(command: string): string {
  const match = command.match(/\bcancel\s+order\s+([^\s]+)/i)
  if (!match) return ""
  const raw = (match[1] || "").trim().replace(/[.,!?;:)\]]+$/g, "")
  const lower = raw.toLowerCase()
  if (!raw || lower === "<id>" || lower === "id" || lower === "<order_id>" || lower === "order_id") {
    return ""
  }
  if (/^0x[0-9a-f]+$/i.test(raw) || /^\d+$/.test(raw)) {
    return raw
  }
  return ""
}

// Internal helper that supports `normalizeHexNumberish` operations.
function normalizeHexNumberish(value: string): string {
  const raw = (value || "").trim()
  if (!raw) return "0x0"
  if (raw.startsWith("0x") || raw.startsWith("0X")) {
    const compact = raw.slice(2).replace(/^0+/, "")
    return `0x${(compact || "0").toLowerCase()}`
  }
  if (/^\d+$/.test(raw)) {
    return `0x${BigInt(raw).toString(16)}`
  }
  return raw.toLowerCase()
}

// Internal helper that supports `limitBridgeApprovalToExactAmount` operations.
function limitBridgeApprovalToExactAmount(
  calldata: string[],
  amountText: string,
  tokenSymbol: string
): { calldata: string[]; limited: boolean } {
  if (!Array.isArray(calldata) || calldata.length < 3) {
    return { calldata, limited: false }
  }
  const low = normalizeHexNumberish(calldata[1] || "")
  const high = normalizeHexNumberish(calldata[2] || "")
  if (low !== U256_MAX_WORD_HEX || high !== U256_MAX_WORD_HEX) {
    return { calldata, limited: false }
  }

  const decimals = AI_TOKEN_DECIMALS[tokenSymbol.toUpperCase()] ?? 18
  let exactLow = "0x0"
  let exactHigh = "0x0"
  try {
    ;[exactLow, exactHigh] = decimalToU256Parts(amountText, decimals)
  } catch {
    return { calldata, limited: false }
  }

  const exactLowNorm = normalizeHexNumberish(exactLow)
  const exactHighNorm = normalizeHexNumberish(exactHigh)
  if (exactLowNorm === "0x0" && exactHighNorm === "0x0") {
    return { calldata, limited: false }
  }

  const next = [...calldata]
  next[1] = exactLow
  next[2] = exactHigh
  return { calldata: next, limited: true }
}

// Internal helper that supports `formatBtcFromSats` operations.
function formatBtcFromSats(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0.00000000 BTC"
  return `${(value / 100_000_000).toFixed(8)} BTC`
}

// Internal helper that supports `bridgeTargetChainForToken` operations.
function bridgeTargetChainForToken(token: string): string {
  const normalized = token.toUpperCase()
  if (normalized === "BTC") return "bitcoin"
  if (normalized === "WBTC") return "starknet"
  if (normalized === "ETH" || normalized === "WETH") return "ethereum"
  return "starknet"
}

// Internal helper that supports `buildGardenOrderExplorerUrl` operations.
function buildGardenOrderExplorerUrl(orderId: string): string {
  const normalizedOrderId = orderId.trim()
  if (!normalizedOrderId) return ""
  const base = GARDEN_ORDER_EXPLORER_BASE_URL.trim().replace(/\/$/, "")
  if (!base) return ""
  return `${base}/${encodeURIComponent(normalizedOrderId)}`
}

// Internal helper that supports tx explorer link generation for chat messages.
function buildTxExplorerUrl(txHash: string, network: TxExplorerNetwork): string {
  const normalizedHash = txHash.trim()
  if (!normalizedHash) return ""
  if (network === "starknet") {
    const base = STARKSCAN_SEPOLIA_BASE_URL.trim().replace(/\/$/, "")
    return base ? `${base}/tx/${normalizedHash}` : ""
  }
  if (network === "evm") {
    const base = ETHERSCAN_SEPOLIA_BASE_URL.trim().replace(/\/$/, "")
    return base ? `${base}/tx/${normalizedHash}` : ""
  }
  const btcHash = normalizedHash.startsWith("0x") ? normalizedHash.slice(2) : normalizedHash
  const base = BTC_TESTNET_EXPLORER_BASE_URL.trim().replace(/\/$/, "")
  return base ? `${base}/tx/${btcHash}` : ""
}

// Internal helper that supports `nowTimestampLabel` operations.
function nowTimestampLabel(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

// Internal helper that parses or transforms values for `normalizeMessageText`.
function normalizeMessageText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

// Internal helper that normalizes common command typos before parsing/execution.
function normalizeAiCommandInput(value: string): string {
  let text = normalizeMessageText(value)
  if (!text) return text

  // Support decimal commas from user input (example: 0,001 -> 0.001).
  text = text.replace(/(\d)\s*,\s*(\d)/g, "$1.$2")

  // Normalize common separators.
  text = text.replace(/\s*\/\s*/g, "/")

  const replacements: Array<[RegExp, string]> = [
    [/\b(plesae|plese|plz|pls)\b/gi, "please"],
    [/\b(brigde|briedge)\b/gi, "bridge"],
    [/\b(privat|prvate|privte)\b/gi, "private"],
    [/\b(swpa|sawp)\b/gi, "swap"],
    [/\b(stkae|staek|satke)\b/gi, "stake"],
    [/\b(cliam|clain)\b/gi, "claim"],
    [/\b(limti|lmit|limt)\b/gi, "limit"],
    [/\b(ordre|ordr)\b/gi, "order"],
    [/\b(expirty|expriy|expiri)\b/gi, "expiry"],
    [/\bsrtk\b/gi, "STRK"],
  ]

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement)
  }

  return normalizeMessageText(text)
}

// Internal helper that supports compact address display in notifications.
function shortAddress(value: string, head = 6, tail = 4): string {
  const normalized = (value || "").trim()
  if (!normalized) return "-"
  if (normalized.length <= head + tail + 3) return normalized
  return `${normalized.slice(0, head)}...${normalized.slice(-tail)}`
}

const TRAILING_URL_PUNCTUATION = new Set([".", ",", "!", "?", ";", ":", ")", "]", "}"])

// Internal helper that supports `splitUrlWithTrailingPunctuation` operations.
function splitUrlWithTrailingPunctuation(rawUrl: string): { url: string; trailing: string } {
  if (!rawUrl) return { url: "", trailing: "" }
  let end = rawUrl.length
  while (end > 0 && TRAILING_URL_PUNCTUATION.has(rawUrl[end - 1])) {
    end -= 1
  }
  return {
    url: rawUrl.slice(0, end),
    trailing: rawUrl.slice(end),
  }
}

// Internal helper that supports `renderMessageContentWithLinks` operations.
function renderMessageContentWithLinks(content: string): React.ReactNode {
  const urlPattern = /https?:\/\/[^\s<>()]+/g
  const nodes: React.ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = urlPattern.exec(content)) !== null) {
    const start = match.index
    const rawMatch = match[0] || ""
    const { url, trailing } = splitUrlWithTrailingPunctuation(rawMatch)
    if (start > cursor) {
      nodes.push(
        <React.Fragment key={`text-${cursor}`}>{content.slice(cursor, start)}</React.Fragment>
      )
    }
    if (url) {
      nodes.push(
        <a
          key={`url-${start}-${url}`}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="break-all text-[#67e8f9] underline underline-offset-2 hover:text-[#a5f3fc]"
        >
          {url}
        </a>
      )
    } else {
      nodes.push(<React.Fragment key={`url-raw-${start}`}>{rawMatch}</React.Fragment>)
    }
    if (trailing) {
      nodes.push(<React.Fragment key={`trail-${start}`}>{trailing}</React.Fragment>)
    }
    cursor = start + rawMatch.length
  }

  if (cursor < content.length) {
    nodes.push(<React.Fragment key={`text-${cursor}`}>{content.slice(cursor)}</React.Fragment>)
  }

  return nodes.length > 0 ? nodes : content
}

// Internal helper that supports `isAffirmativeConfirmation` operations.
function isAffirmativeConfirmation(value: string): boolean {
  return /^(yes|yess|yesss|yse|ye|y|ya|iya|yup|ok|okay|oke|lanjut|proceed|confirm)$/i.test(
    value.trim()
  )
}

// Internal helper that supports `isNegativeConfirmation` operations.
function isNegativeConfirmation(value: string): boolean {
  return /^(no|nope|nop|n|tidak|ga|gak|batal|cancel|stop)$/i.test(value.trim())
}

// Internal helper that supports `defaultMessagesByTier` operations.
function defaultMessagesByTier(): Record<number, Message[]> {
  const timestamp = nowTimestampLabel()
  return {
    1: [{ role: "assistant", content: tierGreetingMessage[1], timestamp }],
    2: [{ role: "assistant", content: tierGreetingMessage[2], timestamp }],
    3: [{ role: "assistant", content: tierGreetingMessage[3], timestamp }],
  }
}

// Internal helper that supports `tierTotalCostCarel` operations.
function tierTotalCostCarel(tier: number): number {
  const found = aiTiers.find((item) => item.id === tier)
  return typeof found?.cost === "number" ? found.cost : 0
}

// Internal helper that supports `incrementalTierUpgradeCost` operations.
function incrementalTierUpgradeCost(currentTier: number, targetTier: number): number {
  const currentCost = tierTotalCostCarel(currentTier)
  const targetCost = tierTotalCostCarel(targetTier)
  return Math.max(0, targetCost - currentCost)
}

/**
 * Handles `FloatingAIAssistant` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function FloatingAIAssistant() {
  const notifications = useNotifications()
  const wallet = useWallet()
  const [isOpen, setIsOpen] = React.useState(false)
  const [isMinimized, setIsMinimized] = React.useState(false)
  const [bubblePosition, setBubblePosition] = React.useState<BubblePosition | null>(null)
  const [isBubbleDragging, setIsBubbleDragging] = React.useState(false)
  const [panelPosition, setPanelPosition] = React.useState<BubblePosition | null>(null)
  const [isPanelDragging, setIsPanelDragging] = React.useState(false)
  const [messagesByTier, setMessagesByTier] = React.useState<Record<number, Message[]>>(
    defaultMessagesByTier
  )
  const [input, setInput] = React.useState("")
  const [showPromptExamples, setShowPromptExamples] = React.useState(false)
  const [selectedTier, setSelectedTier] = React.useState(1)
  const [unlockedTier, setUnlockedTier] = React.useState(1)
  const [paymentAddress, setPaymentAddress] = React.useState("")
  const [isLoadingTier, setIsLoadingTier] = React.useState(false)
  const [isUpgradingTier, setIsUpgradingTier] = React.useState(false)
  const [isSending, setIsSending] = React.useState(false)
  const [pendingExecutionConfirmation, setPendingExecutionConfirmation] =
    React.useState<PendingExecutionConfirmation | null>(null)
  const [actionId, setActionId] = React.useState("")
  const [pendingActions, setPendingActions] = React.useState<number[]>([])
  const [isCreatingAction, setIsCreatingAction] = React.useState(false)
  const [isAutoPreparingAction, setIsAutoPreparingAction] = React.useState(false)
  const [runtimeExecutorAddress, setRuntimeExecutorAddress] = React.useState("")
  const [isResolvingExecutor, setIsResolvingExecutor] = React.useState(false)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const setupSubmitCooldownUntilRef = React.useRef(0)
  const lastSetupFailureRef = React.useRef("")
  const lastSetupSubmitAtRef = React.useRef(0)
  const bubbleDragRef = React.useRef({
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    moved: false,
  })
  const panelDragRef = React.useRef({
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  })
  const suppressBubbleClickRef = React.useRef(false)
  const executorPreflightCacheRef = React.useRef<ExecutorPreflightCache>({
    ready: false,
    burnerRoleGranted: false,
    message: "",
    expiresAt: 0,
  })
  const parsedActionId = Number(actionId)
  const hasValidActionId = Number.isFinite(parsedActionId) && parsedActionId > 0
  const commandNeedsAction = requiresOnchainActionForCommand(selectedTier, input)
  const canTogglePromptExamples = selectedTier >= 2
  const shouldShowPromptExamples = selectedTier === 1 || showPromptExamples
  const messages = messagesByTier[selectedTier] || []
  const quickPrompts = quickPromptsByTier[selectedTier] ?? quickPromptsByTier[1]
  const featureList = featureListByTier[selectedTier] ?? featureListByTier[1]
  const staticCarelTokenAddress = React.useMemo(
    () => STATIC_CAREL_TOKEN_ADDRESS.trim(),
    []
  )
  const staticExecutorAddress = React.useMemo(
    () => STATIC_STARKNET_AI_EXECUTOR_ADDRESS.trim(),
    []
  )
  const effectiveExecutorAddress = React.useMemo(
    () => staticExecutorAddress || runtimeExecutorAddress.trim(),
    [staticExecutorAddress, runtimeExecutorAddress]
  )
  const effectivePaymentAddress = React.useMemo(() => paymentAddress.trim(), [paymentAddress])
  const getDefaultBubblePosition = React.useCallback((): BubblePosition => {
    if (typeof window === "undefined") {
      return { x: AI_BUBBLE_EDGE_PADDING_PX, y: AI_BUBBLE_EDGE_PADDING_PX }
    }
    return clampBubblePosition({
      x: window.innerWidth - AI_BUBBLE_SIZE_PX - 20,
      y: window.innerHeight - AI_BUBBLE_SIZE_PX - 20,
    })
  }, [])
  const getDefaultPanelPosition = React.useCallback((minimized: boolean): BubblePosition => {
    if (typeof window === "undefined") {
      return { x: AI_PANEL_EDGE_PADDING_PX, y: AI_PANEL_EDGE_PADDING_PX }
    }
    const { width, height } = getPanelDimensions(minimized)
    return clampPanelPosition(
      {
        x: window.innerWidth - width - AI_PANEL_EDGE_PADDING_PX,
        y: window.innerHeight - height - AI_PANEL_EDGE_PADDING_PX,
      },
      minimized
    )
  }, [])
  const getPanelPositionFromBubble = React.useCallback(
    (minimized: boolean): BubblePosition => {
      const anchor = bubblePosition || getDefaultBubblePosition()
      const { width, height } = getPanelDimensions(minimized)
      const preferred = {
        x: anchor.x + AI_BUBBLE_SIZE_PX - width,
        y: anchor.y + AI_BUBBLE_SIZE_PX - height,
      }
      return clampPanelPosition(preferred, minimized)
    },
    [bubblePosition, getDefaultBubblePosition]
  )
  const openAssistantNearBubble = React.useCallback(() => {
    const minimized = false
    setPanelPosition(getPanelPositionFromBubble(minimized))
    setIsMinimized(minimized)
    setIsOpen(true)
  }, [getPanelPositionFromBubble])

  React.useEffect(() => {
    setShowPromptExamples(selectedTier === 1)
  }, [selectedTier])

  React.useEffect(() => {
    const handleOpenAssistant = () => {
      openAssistantNearBubble()
    }
    const handleCloseAssistant = () => {
      setIsOpen(false)
    }

    window.addEventListener("carel:open-ai-assistant", handleOpenAssistant)
    window.addEventListener("carel:close-ai-assistant", handleCloseAssistant)
    return () => {
      window.removeEventListener("carel:open-ai-assistant", handleOpenAssistant)
      window.removeEventListener("carel:close-ai-assistant", handleCloseAssistant)
    }
  }, [openAssistantNearBubble])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    let initialPosition = getDefaultBubblePosition()
    let initialPanelPosition = getDefaultPanelPosition(false)
    try {
      const raw = window.localStorage.getItem(AI_BUBBLE_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<BubblePosition>
        if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
          initialPosition = clampBubblePosition({
            x: Number(parsed.x),
            y: Number(parsed.y),
          })
        }
      }
      const rawPanel = window.localStorage.getItem(AI_PANEL_STORAGE_KEY)
      if (rawPanel) {
        const parsedPanel = JSON.parse(rawPanel) as Partial<BubblePosition>
        if (Number.isFinite(parsedPanel?.x) && Number.isFinite(parsedPanel?.y)) {
          initialPanelPosition = clampPanelPosition(
            { x: Number(parsedPanel.x), y: Number(parsedPanel.y) },
            false
          )
        }
      }
    } catch {
      // ignore malformed local storage values
    }
    setBubblePosition(initialPosition)
    setPanelPosition(initialPanelPosition)

    const handleResize = () => {
      setBubblePosition((prev) => clampBubblePosition(prev || getDefaultBubblePosition()))
      setPanelPosition((prev) =>
        clampPanelPosition(prev || getDefaultPanelPosition(isMinimized), isMinimized)
      )
    }
    window.addEventListener("resize", handleResize)
    return () => {
      window.removeEventListener("resize", handleResize)
    }
  }, [getDefaultBubblePosition, getDefaultPanelPosition, isMinimized])

  React.useEffect(() => {
    if (!bubblePosition || typeof window === "undefined") return
    try {
      window.localStorage.setItem(AI_BUBBLE_STORAGE_KEY, JSON.stringify(bubblePosition))
    } catch {
      // ignore storage write issues
    }
  }, [bubblePosition])

  React.useEffect(() => {
    if (!panelPosition || typeof window === "undefined") return
    try {
      window.localStorage.setItem(AI_PANEL_STORAGE_KEY, JSON.stringify(panelPosition))
    } catch {
      // ignore storage write issues
    }
  }, [panelPosition])

  React.useEffect(() => {
    setPanelPosition((prev) =>
      clampPanelPosition(prev || getDefaultPanelPosition(isMinimized), isMinimized)
    )
  }, [isMinimized, getDefaultPanelPosition])

  const handleBubblePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return
      const origin = bubblePosition || getDefaultBubblePosition()
      bubbleDragRef.current = {
        active: true,
        startX: event.clientX,
        startY: event.clientY,
        originX: origin.x,
        originY: origin.y,
        moved: false,
      }
      setIsBubbleDragging(true)
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [bubblePosition, getDefaultBubblePosition]
  )

  const handleBubblePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = bubbleDragRef.current
      if (!drag.active) return
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        drag.moved = true
      }
      setBubblePosition(
        clampBubblePosition({
          x: drag.originX + dx,
          y: drag.originY + dy,
        })
      )
    },
    []
  )

  const endBubbleDrag = React.useCallback(() => {
    const drag = bubbleDragRef.current
    if (!drag.active) return
    bubbleDragRef.current.active = false
    if (drag.moved) {
      suppressBubbleClickRef.current = true
      window.setTimeout(() => {
        suppressBubbleClickRef.current = false
      }, 120)
    }
    setIsBubbleDragging(false)
  }, [])

  const handlePanelPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return
      const targetElement = event.target as HTMLElement
      if (
        targetElement.closest("button") ||
        targetElement.closest("input") ||
        targetElement.closest("textarea") ||
        targetElement.closest("a") ||
        targetElement.closest("[data-no-drag='true']")
      ) {
        return
      }
      const origin = panelPosition || getDefaultPanelPosition(isMinimized)
      panelDragRef.current = {
        active: true,
        startX: event.clientX,
        startY: event.clientY,
        originX: origin.x,
        originY: origin.y,
      }
      setIsPanelDragging(true)
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [panelPosition, getDefaultPanelPosition, isMinimized]
  )

  const handlePanelPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = panelDragRef.current
      if (!drag.active) return
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      setPanelPosition(
        clampPanelPosition(
          {
            x: drag.originX + dx,
            y: drag.originY + dy,
          },
          isMinimized
        )
      )
    },
    [isMinimized]
  )

  const endPanelDrag = React.useCallback(() => {
    if (!panelDragRef.current.active) return
    panelDragRef.current.active = false
    setIsPanelDragging(false)
  }, [])

  const appendMessagesForTier = React.useCallback((tier: number, nextMessages: Message[]) => {
    if (!nextMessages.length) return
    setMessagesByTier((prev) => ({
      ...prev,
      [tier]: [...(prev[tier] || []), ...nextMessages],
    }))
  }, [])

  const resolvePoolTokenAddressForRelayerFunding = React.useCallback((tokenSymbol: string): string => {
    const symbol = resolveStakeTokenSymbol(tokenSymbol)
    if (symbol === "WBTC") return STARKNET_WBTC_STAKING_TOKEN_ADDRESS
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

  /**
   * Handles `scrollToBottom` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  React.useEffect(() => {
    scrollToBottom()
  }, [messages])

  const refreshAiLevel = React.useCallback(
    async (silent = true) => {
      setIsLoadingTier(true)
      try {
        const levelInfo = await getAiLevel()
        const currentLevel = Math.min(3, Math.max(1, Number(levelInfo.current_level || 1)))
        setUnlockedTier(currentLevel)
        setSelectedTier((prev) => (prev > currentLevel ? currentLevel : prev))
        setPaymentAddress((levelInfo.payment_address || levelInfo.burn_address || "").trim())
      } catch (error) {
        if (!silent) {
          const message = error instanceof Error ? error.message : "Failed to load AI level."
          notifications.addNotification({
            type: "error",
            title: "AI level",
            message,
          })
        }
      } finally {
        setIsLoadingTier(false)
      }
    },
    [notifications]
  )

  React.useEffect(() => {
    if (!isOpen) return
    void refreshAiLevel(true)
  }, [isOpen, refreshAiLevel])

  const ensureExecutorAddress = React.useCallback(async (): Promise<string> => {
    if (runtimeExecutorAddress.trim()) return runtimeExecutorAddress.trim()
    setIsResolvingExecutor(true)
    try {
      const runtimeConfig = await getAiRuntimeConfig()
      const resolved = (runtimeConfig.executor_address || "").trim()
      if (!runtimeConfig.executor_configured || !resolved) {
        if (staticExecutorAddress) {
          return staticExecutorAddress
        }
        throw new Error(
          "AI executor is not configured yet. Set AI_EXECUTOR_ADDRESS in backend env, or NEXT_PUBLIC_STARKNET_AI_EXECUTOR_ADDRESS in frontend env, then restart services."
        )
      }
      if (staticExecutorAddress && staticExecutorAddress.toLowerCase() !== resolved.toLowerCase()) {
        notifications.addNotification({
          type: "warning",
          title: "Executor address mismatch",
          message:
            "Frontend executor env differs from backend runtime executor. Using backend runtime address to avoid setup mismatch.",
        })
      }
      setRuntimeExecutorAddress(resolved)
      return resolved
    } finally {
      setIsResolvingExecutor(false)
    }
  }, [notifications, runtimeExecutorAddress, staticExecutorAddress])

  React.useEffect(() => {
    if (!isOpen || selectedTier < 2 || effectiveExecutorAddress || isResolvingExecutor) return
    let cancelled = false
    setIsResolvingExecutor(true)
    void getAiRuntimeConfig()
      .then((runtimeConfig) => {
        if (cancelled) return
        const resolved = (runtimeConfig.executor_address || "").trim()
        if (runtimeConfig.executor_configured && resolved) {
          setRuntimeExecutorAddress(resolved)
        }
      })
      .catch(() => {
        // Silent: explicit notification is shown only when user triggers on-chain setup.
      })
      .finally(() => {
        if (!cancelled) {
          setIsResolvingExecutor(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, selectedTier, effectiveExecutorAddress, isResolvingExecutor])

  const loadPendingActions = async (silent = false): Promise<number[]> => {
    const response = await getAiPendingActions(0, 50)
    const pending = response.pending || []
    setPendingActions(pending)
    if (!silent && pending.length === 0) {
      notifications.addNotification({
        type: "info",
        title: "On-chain setup",
        message: "No pending setup found for this account yet.",
      })
    }
    return pending
  }

  const resolveActionId = async (
    requiredForCommand: boolean,
    options?: { forceRefresh?: boolean; requireFresh?: boolean }
  ): Promise<number> => {
    if (!requiredForCommand) return 0
    const forceRefresh = options?.forceRefresh === true
    const requireFresh = options?.requireFresh === true

    if (requireFresh) {
      const created = await createOnchainActionId({ requireFresh: true })
      if (created && created > 0) return created
      const setupSubmittedRecently =
        Date.now() - lastSetupSubmitAtRef.current <= AI_SETUP_SUBMIT_COOLDOWN_MS + 15_000
      if (setupSubmittedRecently) {
        try {
          const pending = await loadPendingActions(true)
          const latest = pickLatestPendingAction(pending)
          if (latest && latest > 0) {
            setActionId(String(latest))
            notifications.addNotification({
              type: "warning",
              title: "Using pending setup",
              message:
                "Fresh setup was submitted but not indexed yet. Using your latest pending setup for this execution.",
            })
            return latest
          }
        } catch {
          // Continue with the explicit setup failure message below.
        }
      }
      const failureDetail = lastSetupFailureRef.current.trim()
      throw new Error(
        failureDetail ||
          "A fresh on-chain signature is required for this execution. Please confirm the wallet popup, then retry."
      )
    }

    if (!forceRefresh && hasValidActionId) {
      const existing = Math.floor(parsedActionId)
      try {
        const pending = await loadPendingActions(true)
        if (pending.includes(existing)) {
          return existing
        }
      } catch {
        // Continue with create/refresh path when pending check fails.
      }
      setActionId("")
    }

    setIsAutoPreparingAction(true)
    try {
      const pending = await loadPendingActions(true)
      const latest = pickLatestPendingAction(pending)
      if (latest && latest > 0) {
        setActionId(String(latest))
        notifications.addNotification({
          type: "success",
          title: "On-chain setup ready",
          message: "Using latest pending setup from your account.",
        })
        return latest
      }

      const created = await createOnchainActionId({ requireFresh: false })
      if (created && created > 0) {
        return created
      }

      const setupSubmittedRecently =
        Date.now() - lastSetupSubmitAtRef.current <= AI_SETUP_SUBMIT_COOLDOWN_MS + 15_000
      if (setupSubmittedRecently) {
        try {
          const pending = await loadPendingActions(true)
          const latest = pickLatestPendingAction(pending)
          if (latest && latest > 0) {
            setActionId(String(latest))
            notifications.addNotification({
              type: "warning",
              title: "Using pending setup",
              message:
                "Setup tx was submitted recently and is now visible. Using latest pending setup for this execution.",
            })
            return latest
          }
        } catch {
          // Keep explicit failure message below.
        }
      }

      const failureDetail = lastSetupFailureRef.current.trim()
      throw new Error(
        failureDetail || "No valid on-chain setup found. Click Auto Setup On-Chain and confirm in wallet."
      )
    } finally {
      setIsAutoPreparingAction(false)
    }
  }

  const buildActionFollowUps = async (actions: string[], data: AIData): Promise<Message[]> => {
    const followUps: Message[] = []
    const add = (content: string) =>
      followUps.push({ role: "assistant", content, timestamp: nowTimestampLabel() })

    for (const action of actions) {
      if (action === "get_swap_quote") {
        const fromToken = readString(data, "from_token")
        const toToken = readString(data, "to_token")
        const amount = readNumber(data, "amount")
        if (!fromToken || !toToken || !(amount > 0)) continue
        try {
          const quote = await getSwapQuote({
            from_token: fromToken,
            to_token: toToken,
            amount: String(amount),
            slippage: 1,
            mode: "public",
          })
          add(
            `Live quote: ${amount} ${fromToken} ~= ${quote.to_amount} ${toToken} (fee ${quote.fee}, route ${quote.route.join(" -> ")}).`
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to fetch swap quote."
          add(`Swap parsed, but live quote failed: ${message}`)
        }
        continue
      }

      if (action === "get_bridge_quote") {
        const fromToken = readString(data, "from_token")
        const toToken = readString(data, "to_token")
        const amount = readNumber(data, "amount")
        if (!fromToken || !toToken || !(amount > 0)) continue
        const toChain = bridgeTargetChainForToken(toToken)
        try {
          const quote = await getBridgeQuote({
            from_chain: "starknet",
            to_chain: toChain,
            token: fromToken,
            to_token: toToken,
            amount: String(amount),
          })
          add(
            `Bridge quote: send ${quote.amount} ${fromToken}, estimated receive ${quote.estimated_receive} on ${quote.to_chain} (fee ${quote.fee}, provider ${quote.bridge_provider}).`
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to fetch bridge quote."
          add(`Bridge parsed, but live quote failed: ${message}`)
        }
        continue
      }

      if (action === "show_balance" || action === "open_portfolio") {
        try {
          const balance = await getPortfolioBalance({ force: true })
          if (!balance.balances?.length) {
            add("Portfolio update (live): no assets found on this account yet.")
          } else {
            const top = balance.balances
              .slice(0, 3)
              .map((item) => `${item.token} ${item.amount.toFixed(4)} (~$${item.value_usd.toFixed(2)})`)
              .join(", ")
            add(
              `Portfolio update (live): total value ~$${balance.total_value_usd.toFixed(2)}. Top holdings: ${top}.`
            )
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load portfolio."
          add(`Portfolio refresh failed: ${message}`)
        }
        continue
      }

      if (action === "show_points_breakdown") {
        try {
          const points = await getRewardsPoints({ force: true })
          add(
            `Points update (live): ${points.total_points.toFixed(2)} points in epoch ${points.current_epoch}. Estimated CAREL reward: ${Number(points.estimated_reward_carel || 0).toFixed(6)}.`
          )
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

  /**
   * Handles `handleSend` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleSend = async () => {
    let command = normalizeAiCommandInput(input)
    if (!command || isSending || isUpgradingTier || isLoadingTier) return
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

    if (!hasPendingConfirmation && (isAffirmativeConfirmation(command) || isNegativeConfirmation(command))) {
      appendMessagesForTier(activeTier, [
        {
          role: "user",
          content: command,
          timestamp: userMessageTimestamp,
        },
      ])
      setInput("")
      const latestAssistantMessage =
        [...messages]
          .reverse()
          .find((item) => item.role === "assistant")
          ?.content || ""
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

    const isBridgeCommand = BRIDGE_COMMAND_REGEX.test(command)
    if (activeTier >= 3 && isBridgeCommand && !L3_GARAGA_BRIDGE_ENABLED) {
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
            "Bridge is currently disabled on Level 3 because Garaga bridge flow is not implemented for public Garden API yet. Use Level 2 for bridge, or enable custom provider with `NEXT_PUBLIC_L3_GARAGA_BRIDGE_ENABLED=true`.",
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
      const bridgeConfirmHint = isBridgeCommand
        ? "\nBridge execution usually has 2 steps:\n1. Sign Starknet setup in Argent/Braavos (burn CAREL).\n2. If source is BTC, sign BTC deposit in UniSat/Xverse.\nOrder is only completed after BTC deposit is sent."
        : ""
      appendMessagesForTier(activeTier, [
        {
          role: "assistant",
          content:
            `You're about to execute this REAL on-chain command:\n${command}\n\nReply \`yes\` to continue or \`no\` to cancel.\nThis will request wallet signature and burn ${executionBurnAmountCarel(activeTier)} CAREL on-chain for this execution.${bridgeConfirmHint}\nIf you have an active discount NFT, fee discount will be applied automatically.`,
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

    if (commandNeedsOnchainAction && isBridgeCommand) {
      const parsedBridge = parseBridgeTokensFromCommand(command)
      if (!parsedBridge) {
        const formatMessage =
          "Bridge pre-check needs explicit format: `bridge <amount> <from_token> to <to_token>` (or `bridge <from_token> <amount> to <to_token>`)."
        notifications.addNotification({
          type: "warning",
          title: "Bridge pre-check failed",
          message: formatMessage,
        })
        appendMessagesForTier(activeTier, [
          {
            role: "assistant",
            content: `${formatMessage} No CAREL was burned.`,
            timestamp: nowTimestampLabel(),
          },
        ])
        return
      }

      const { fromToken, toToken, amountText } = parsedBridge
      const parsedAmount = Number.parseFloat(amountText)
      if (!amountText || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        const invalidAmountMessage =
          "Bridge pre-check failed: amount must be a positive number before on-chain execution."
        notifications.addNotification({
          type: "warning",
          title: "Bridge pre-check failed",
          message: invalidAmountMessage,
        })
        appendMessagesForTier(activeTier, [
          {
            role: "assistant",
            content: `${invalidAmountMessage} No CAREL was burned.`,
            timestamp: nowTimestampLabel(),
          },
        ])
        return
      }

      const fromChain = bridgeTargetChainForToken(fromToken)
      const toChain = bridgeTargetChainForToken(toToken)
      if (!isSupportedBridgePair(fromChain, toChain, fromToken, toToken)) {
        const unsupportedMessage =
          `Bridge pair ${fromToken} (${fromChain}) -> ${toToken} (${toChain}) is not supported. ` +
          "Supported: ETH↔BTC, BTC↔WBTC, ETH↔WBTC."
        notifications.addNotification({
          type: "warning",
          title: "Bridge pre-check failed",
          message: unsupportedMessage,
        })
        appendMessagesForTier(activeTier, [
          {
            role: "assistant",
            content: `${unsupportedMessage} No CAREL was burned.`,
            timestamp: nowTimestampLabel(),
          },
        ])
        return
      }

      notifications.addNotification({
        type: "info",
        title: "Pre-checking bridge liquidity",
        message: `Checking route/liquidity for ${amountText} ${fromToken} -> ${toToken} before CAREL burn.`,
      })
      try {
        let lastPrecheckError: unknown = null
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            await getBridgeQuote({
              from_chain: fromChain,
              to_chain: toChain,
              token: fromToken,
              to_token: toToken,
              amount: amountText,
            })
            lastPrecheckError = null
            break
          } catch (error) {
            lastPrecheckError = error
            const message = error instanceof Error ? error.message : String(error ?? "")
            const retryable =
              /request timeout|network error|timed out|timeout/i.test(message) && attempt === 0
            if (!retryable) break
            notifications.addNotification({
              type: "info",
              title: "Bridge pre-check retry",
              message: "Provider is slow. Retrying bridge pre-check once...",
            })
            await waitMs(900)
          }
        }
        if (lastPrecheckError) {
          throw lastPrecheckError
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Bridge route/liquidity pre-check failed."
        notifications.addNotification({
          type: "warning",
          title: "Bridge pre-check failed",
          message,
        })
        appendMessagesForTier(activeTier, [
          {
            role: "assistant",
            content:
              `Bridge pre-check failed before on-chain setup: ${message}\n` +
              "No CAREL was burned. Adjust pair/amount and retry.",
            timestamp: nowTimestampLabel(),
          },
        ])
        return
      }
    }

    if (commandNeedsOnchainAction) {
      const parsedStake = parseStakeTokenHintFromCommand(command)
      if (parsedStake?.token === "WBTC") {
        const amountLabel =
          typeof parsedStake.amountText === "string" && parsedStake.amountText.trim().length > 0
            ? `${parsedStake.amountText.trim()} WBTC`
            : "WBTC action"
        notifications.addNotification({
          type: "info",
          title: "Pre-checking WBTC staking",
          message: `Checking WBTC (Starknet) pool availability for ${amountLabel} before CAREL burn.`,
        })
        try {
          const pools = await getStakePools()
          const wbtcPool = pools.find(
            (pool) => resolveStakeTokenSymbol(pool.pool_id || pool.token || "") === "WBTC"
          )
          if (!wbtcPool) {
            const reason = "WBTC (Starknet) staking pool metadata is unavailable from backend."
            notifications.addNotification({
              type: "warning",
              title: "Stake pre-check failed",
              message: reason,
            })
            appendMessagesForTier(activeTier, [
              {
                role: "assistant",
                content:
                  `Stake pre-check failed before on-chain setup: ${reason}\n` +
                  "No CAREL was burned. Retry after backend pool data is available.",
                timestamp: nowTimestampLabel(),
              },
            ])
            return
          }
          if (wbtcPool.available === false) {
            const reason =
              (typeof wbtcPool.status_message === "string" && wbtcPool.status_message.trim()) ||
              "WBTC (Starknet) token is not registered on StakingBTC yet. Admin must call add_btc_token first."
            notifications.addNotification({
              type: "warning",
              title: "Stake pre-check failed",
              message: reason,
            })
            appendMessagesForTier(activeTier, [
              {
                role: "assistant",
                content:
                  `Stake pre-check failed before on-chain setup: ${reason}\n` +
                  "No CAREL was burned. Ask admin to register WBTC (Starknet) token on StakingBTC, then retry.",
                timestamp: nowTimestampLabel(),
              },
            ])
            return
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "WBTC staking pre-check failed unexpectedly."
          notifications.addNotification({
            type: "warning",
            title: "Stake pre-check failed",
            message: `Could not verify WBTC (Starknet) pool availability (${message}).`,
          })
          appendMessagesForTier(activeTier, [
            {
              role: "assistant",
              content:
                `Stake pre-check failed before on-chain setup: Could not verify WBTC (Starknet) pool availability (${message}).\n` +
                "No CAREL was burned. Retry after backend/RPC is healthy.",
              timestamp: nowTimestampLabel(),
            },
          ])
          return
        }
      }
    }

    if (commandNeedsOnchainAction) {
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
          await waitMs(AI_SETUP_PENDING_POLL_INTERVAL_MS * 4)
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
          context: `tier:${activeTier}`,
          level: activeTier,
          action_id: commandNeedsOnchainAction ? actionIdValue : undefined,
        })
      } catch (initialError) {
        const initialMessage =
          initialError instanceof Error ? initialError.message : String(initialError ?? "")
        if (commandNeedsOnchainAction && isSetupOutOfSyncError(initialMessage)) {
          setActionId("")
          setPendingActions([])
          notifications.addNotification({
            type: "info",
            title: "Refreshing on-chain setup",
            message: "Detected stale setup action. Refreshing setup and retrying command once.",
          })
          const refreshedActionId = await resolveActionId(true, { forceRefresh: true })
          actionIdValue = refreshedActionId
          response = await executeAiCommand({
            command,
            context: `tier:${activeTier}`,
            level: activeTier,
            action_id: refreshedActionId,
          })
        } else {
          throw initialError
        }
      }
      let directExecutionMessage = ""
      const providerHint = resolveStarknetProviderHint(wallet.provider)
      const tierUsesGaraga = activeTier >= 3
      const requestGaragaPayload = async (
        flow: string,
        fromToken?: string,
        toToken?: string,
        amountText?: string
      ): Promise<PrivacyVerificationPayload> => {
        const prepared = await autoSubmitPrivacyAction({
          verifier: "garaga",
          submit_onchain: false,
          tx_context: {
            flow,
            from_token: fromToken,
            to_token: toToken,
            amount: amountText,
            recipient: wallet.starknetAddress || wallet.address || undefined,
            from_network: "starknet",
            to_network: "starknet",
          },
        })
        return {
          verifier: (prepared.payload?.verifier || "garaga").trim() || "garaga",
          nullifier: prepared.payload?.nullifier?.trim(),
          commitment: prepared.payload?.commitment?.trim(),
          proof: normalizeHexArray(prepared.payload?.proof),
          public_inputs: normalizeHexArray(prepared.payload?.public_inputs),
        }
      }

      const canAutoExecuteSwap =
        activeTier >= 2 &&
        /\b(swap|tukar)\b/i.test(command) &&
        (response.actions || []).includes("get_swap_quote")
      if (canAutoExecuteSwap) {
        const fromToken = readString(response.data, "from_token").toUpperCase()
        const toToken = readString(response.data, "to_token").toUpperCase()
        const amount = readNumber(response.data, "amount")
        const amountText = Number.isFinite(amount) && amount > 0 ? String(amount) : ""
        if (fromToken && toToken && fromToken !== toToken && amountText) {
          if (!SUPPORTED_SWAP_TOKENS.has(fromToken) || !SUPPORTED_SWAP_TOKENS.has(toToken)) {
            directExecutionMessage = `Swap pair ${fromToken}/${toToken} is not listed in CAREL swap. Supported: USDT, USDC, STRK, WBTC, CAREL.`
          } else {
          const mode = tierUsesGaraga || /private|hide/i.test(command) ? "private" : "transparent"
          const slippage = 1
          notifications.addNotification({
            type: "info",
            title: "Preparing swap",
            message: `Preparing ${amountText} ${fromToken} -> ${toToken} on-chain call.`,
          })
          const quote = await getSwapQuote({
            from_token: fromToken,
            to_token: toToken,
            amount: amountText,
            slippage,
            mode,
          })
          const minAmountOut = formatSwapMinAmountOut(String(quote.to_amount || "0"), slippage)
          const onchainCalls = Array.isArray(quote.onchain_calls)
            ? quote.onchain_calls
                .filter(
                  (call) =>
                    call &&
                    typeof call.contract_address === "string" &&
                    typeof call.entrypoint === "string" &&
                    Array.isArray(call.calldata)
                )
                .map((call) => ({
                  contractAddress: call.contract_address.trim(),
                  entrypoint: call.entrypoint.trim(),
                  calldata: call.calldata.map((item) => String(item)),
                }))
                .filter(
                  (call) =>
                    !!call.contractAddress &&
                    !!call.entrypoint &&
                    call.calldata.every(
                      (item) => typeof item === "string" && item.trim().length > 0
                    )
                )
            : []
          let privacyPayload: PrivacyVerificationPayload | undefined
          let swapResult: Awaited<ReturnType<typeof executeSwap>>
          let finalTxHash = ""

          if (tierUsesGaraga) {
            if (HIDE_BALANCE_SHIELDED_POOL_V2 && !HIDE_BALANCE_RELAYER_POOL_ENABLED) {
              throw new Error(
                "Hide relayer pool is not enabled. Set NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_ENABLED=true and restart frontend/backend."
              )
            }

            privacyPayload = await requestGaragaPayload("swap", fromToken, toToken, amountText)
            try {
              notifications.addNotification({
                type: "info",
                title: "Submitting private swap",
                message: "Submitting hide-mode swap through Starknet relayer pool.",
              })
              swapResult = await executeSwap({
                from_token: fromToken,
                to_token: toToken,
                amount: amountText,
                min_amount_out: minAmountOut,
                slippage,
                deadline: Math.floor(Date.now() / 1000) + 60 * 20,
                mode,
                hide_balance: true,
                privacy: privacyPayload,
              })
              finalTxHash = swapResult.tx_hash || ""
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error ?? "")
              const requiresOnchainTx = /requires onchain_tx_hash/i.test(message)
              const relayerUnavailable =
                /(relayer|privateactionexecutor|not configured|executor|submit_private|hide relayer)/i.test(
                  message
                )
              if (HIDE_BALANCE_SHIELDED_POOL_V2 && (requiresOnchainTx || relayerUnavailable)) {
                throw new Error(
                  `Hide relayer unavailable. Wallet fallback is blocked in shielded_pool_v2 so swap details do not leak in explorer. Detail: ${message}`
                )
              }
              if (!requiresOnchainTx && !relayerUnavailable) {
                throw error
              }
              if (!onchainCalls.length) {
                throw new Error(
                  "Swap quote does not include on-chain calldata for wallet fallback."
                )
              }
              const txCalls = [buildHideBalancePrivacyCall(privacyPayload), ...onchainCalls]
              notifications.addNotification({
                type: "warning",
                title: "Relayer unavailable",
                message:
                  "Hide relayer is unavailable. Falling back to wallet-signed hide transaction.",
              })
              notifications.addNotification({
                type: "info",
                title: "Wallet signature required",
                message: `Confirm Garaga private swap ${amountText} ${fromToken} -> ${toToken} in your wallet.`,
              })
              const onchainTxHash = await invokeStarknetCallsFromWallet(txCalls, providerHint)
              swapResult = await executeSwap({
                from_token: fromToken,
                to_token: toToken,
                amount: amountText,
                min_amount_out: minAmountOut,
                slippage,
                deadline: Math.floor(Date.now() / 1000) + 60 * 20,
                onchain_tx_hash: onchainTxHash,
                mode,
                hide_balance: true,
                privacy: privacyPayload,
              })
              finalTxHash = swapResult.tx_hash || onchainTxHash
            }
          } else {
            if (!onchainCalls.length) {
              throw new Error(
                "Swap quote does not include on-chain calldata. Ensure swap aggregator is active."
              )
            }
            notifications.addNotification({
              type: "info",
              title: "Wallet signature required",
              message: `Confirm swap ${amountText} ${fromToken} -> ${toToken} in your wallet.`,
            })
            const onchainTxHash = await invokeStarknetCallsFromWallet(onchainCalls, providerHint)
            swapResult = await executeSwap({
              from_token: fromToken,
              to_token: toToken,
              amount: amountText,
              min_amount_out: minAmountOut,
              slippage,
              deadline: Math.floor(Date.now() / 1000) + 60 * 20,
              onchain_tx_hash: onchainTxHash,
              mode,
              hide_balance: false,
            })
            finalTxHash = swapResult.tx_hash || onchainTxHash
          }

          notifications.addNotification({
            type: "success",
            title: "Swap completed",
            message: `${amountText} ${fromToken} -> ${swapResult.to_amount} ${toToken}`,
            txHash: finalTxHash || undefined,
            txNetwork: "starknet",
          })
          const estimatedPoints = parseNumberish(swapResult.estimated_points_earned)
          const appliedDiscountPercent = parseNumberish(swapResult.nft_discount_percent)
          const feeDiscountSaved = parseNumberish(swapResult.fee_discount_saved)
          const [pointsSnapshot, ownedNftsSnapshot] = await Promise.allSettled([
            getRewardsPoints({ force: true }),
            getOwnedNfts({ force: true }),
          ])

          let pointsLine = estimatedPoints > 0
            ? `Points +${estimatedPoints.toFixed(2)} (estimated).`
            : "Points reward: 0 (minimum notional for points was not reached)."
          if (pointsSnapshot.status === "fulfilled") {
            pointsLine =
              estimatedPoints > 0
                ? `Points +${estimatedPoints.toFixed(2)} (estimated), total now ${pointsSnapshot.value.total_points.toFixed(2)}.`
                : `Total points now ${pointsSnapshot.value.total_points.toFixed(2)}.`
          }

          let discountLine = "Discount: not active on this swap."
          if (appliedDiscountPercent > 0) {
            discountLine = `Discount NFT applied ${appliedDiscountPercent.toFixed(2)}% (fee saved ${feeDiscountSaved.toFixed(8)} ${fromToken}).`
          } else if (ownedNftsSnapshot.status === "fulfilled") {
            const activeNft = ownedNftsSnapshot.value
              .filter((item) => !item.used && (item.remaining_usage ?? 1) > 0)
              .sort((a, b) => (b.discount || 0) - (a.discount || 0))[0]
            if (activeNft && Number.isFinite(activeNft.discount) && activeNft.discount > 0) {
              discountLine = `Discount NFT available: ${activeNft.discount.toFixed(2)}% for the next transaction.`
            }
          }

          const pendingLine = swapResult.points_pending
            ? "Points on-chain/off-chain are syncing; full update usually appears within a few seconds."
            : ""
          const swapTxPreview = finalTxHash ? `${finalTxHash.slice(0, 14)}...` : "-"
          const swapTxUrl = finalTxHash ? buildTxExplorerUrl(finalTxHash, "starknet") : ""
          directExecutionMessage = normalizeMessageText(
            `✅ Swap executed: ${amountText} ${fromToken} -> ${swapResult.to_amount} ${toToken}. Tx: ${swapTxPreview}${swapTxUrl ? `\nTrack tx: ${swapTxUrl}` : ""}\n${pointsLine}\n${discountLine}${pendingLine ? `\n${pendingLine}` : ""}`
          )
          }
        }
      }

      const canAutoExecuteBridge =
        !directExecutionMessage &&
        activeTier >= 2 &&
        !(tierUsesGaraga && !L3_GARAGA_BRIDGE_ENABLED) &&
        BRIDGE_COMMAND_REGEX.test(command) &&
        (response.actions || []).includes("get_bridge_quote")
      if (canAutoExecuteBridge) {
        const fromToken = readString(response.data, "from_token").toUpperCase()
        const toToken = readString(response.data, "to_token").toUpperCase()
        const amount = readNumber(response.data, "amount")
        const amountText = Number.isFinite(amount) && amount > 0 ? String(amount) : ""
        if (fromToken && toToken && amountText) {
          const fromChain = bridgeTargetChainForToken(fromToken)
          const toChain = bridgeTargetChainForToken(toToken)
          if (!isSupportedBridgePair(fromChain, toChain, fromToken, toToken)) {
            directExecutionMessage =
              `Bridge pair ${fromToken} (${fromChain}) -> ${toToken} (${toChain}) is not supported. Supported: ETH↔BTC, BTC↔WBTC, ETH↔WBTC.`
          } else {
            const recipient =
              toChain === "bitcoin"
                ? wallet.btcAddress || ""
                : toChain === "ethereum"
                ? wallet.evmAddress || ""
                : wallet.starknetAddress || wallet.address || ""
            const sourceOwner =
              fromChain === "bitcoin"
                ? wallet.btcAddress || ""
                : fromChain === "ethereum"
                ? wallet.evmAddress || ""
                : wallet.starknetAddress || wallet.address || ""
            if (!recipient || !sourceOwner) {
              if (!sourceOwner) {
                throw new Error(missingSourceAddressMessage(fromChain))
              }
              throw new Error(missingDestinationAddressMessage(toChain))
            }
            const bridgeBasePayload = {
              from_chain: fromChain,
              to_chain: toChain,
              token: fromToken,
              to_token: toToken,
              amount: amountText,
              recipient,
              source_owner: sourceOwner,
              mode: tierUsesGaraga && fromChain === "starknet" ? "private" : "transparent",
              hide_balance: tierUsesGaraga && fromChain === "starknet",
            } as const

            let bridgeResult = await executeBridge(bridgeBasePayload)
            let bridgeSourceTxHash = ""
            let bridgeSourceTxNetwork: TxExplorerNetwork | undefined
            if (bridgeResult.evm_approval_transaction || bridgeResult.evm_initiate_transaction) {
              const orderId = (bridgeResult.bridge_id || "").trim()
              if (!orderId) {
                throw new Error("Garden order id is missing for Ethereum source flow.")
              }
              const submitBridgeWithOnchainHash = async (txHash: string) => {
                return executeBridge({
                  ...bridgeBasePayload,
                  existing_bridge_id: orderId,
                  onchain_tx_hash: txHash,
                })
              }
              notifications.addNotification({
                type: "info",
                title: "Wallet signature required",
                message: "Confirm Garden source transaction in MetaMask.",
              })
              if (bridgeResult.evm_approval_transaction) {
                notifications.addNotification({
                  type: "info",
                  title: "Wallet signature required",
                  message: `Confirm bridge approval for ${amountText} ${fromToken} in MetaMask.`,
                })
                await sendEvmTransactionFromWallet(bridgeResult.evm_approval_transaction)
              }
              if (!bridgeResult.evm_initiate_transaction) {
                throw new Error("Garden initiate transaction is missing for Ethereum source flow.")
              }
              notifications.addNotification({
                type: "info",
                title: "Wallet signature required",
                message: `Confirm bridge initiate ${amountText} ${fromToken} -> ${toToken} in MetaMask.`,
              })
              bridgeSourceTxHash = await sendEvmTransactionFromWallet(
                bridgeResult.evm_initiate_transaction
              )
              bridgeSourceTxNetwork = "evm"
              notifications.addNotification({
                type: "info",
                title: "Bridge pending",
                message: `Bridge ${amountText} ${fromToken} submitted on-chain (${bridgeSourceTxHash.slice(0, 10)}...).`,
                txHash: bridgeSourceTxHash,
                txNetwork: "evm",
              })
              bridgeResult = await submitBridgeWithOnchainHash(bridgeSourceTxHash)
            } else if (
              bridgeResult.starknet_approval_transaction ||
              bridgeResult.starknet_initiate_transaction
            ) {
              let approvalWasLimited = false
              let approvalCall: { contractAddress: string; entrypoint: string; calldata: string[] } | null =
                null
              let initiateCall: { contractAddress: string; entrypoint: string; calldata: string[] } | null =
                null
              if (bridgeResult.starknet_approval_transaction) {
                const approvalTx = bridgeResult.starknet_approval_transaction
                const safeApproval = limitBridgeApprovalToExactAmount(
                  approvalTx.calldata || [],
                  amountText,
                  fromToken
                )
                approvalWasLimited = safeApproval.limited
                approvalCall = {
                  contractAddress: approvalTx.to,
                  entrypoint: normalizeGardenStarknetEntrypoint(approvalTx.selector),
                  calldata: safeApproval.calldata,
                }
              }
              if (bridgeResult.starknet_initiate_transaction) {
                initiateCall = {
                  contractAddress: bridgeResult.starknet_initiate_transaction.to,
                  entrypoint: normalizeGardenStarknetEntrypoint(
                    bridgeResult.starknet_initiate_transaction.selector
                  ),
                  calldata: bridgeResult.starknet_initiate_transaction.calldata || [],
                }
              }
              if (!approvalCall && !initiateCall) {
                throw new Error("Bridge source transactions are missing.")
              }
              let bridgePrivacyPayload: PrivacyVerificationPayload | undefined
              if (tierUsesGaraga) {
                bridgePrivacyPayload = await requestGaragaPayload(
                  "bridge",
                  fromToken,
                  toToken,
                  amountText
                )
              }
              if (approvalWasLimited) {
                notifications.addNotification({
                  type: "info",
                  title: "Approval safety enabled",
                  message: `Approval limited to exact ${amountText} ${fromToken} (not unlimited).`,
                })
              }
              const submitBridgeWithOnchainHash = async (txHash: string) => {
                return executeBridge({
                  ...bridgeBasePayload,
                  existing_bridge_id: bridgeResult.bridge_id,
                  onchain_tx_hash: txHash,
                  privacy: tierUsesGaraga ? bridgePrivacyPayload : undefined,
                })
              }
              let onchainTxHash = ""
              if (tierUsesGaraga) {
                const callsToSign: Array<{ contractAddress: string; entrypoint: string; calldata: string[] }> = []
                callsToSign.push(buildHideBalancePrivacyCall(bridgePrivacyPayload!))
                if (approvalCall) callsToSign.push(approvalCall)
                if (initiateCall) callsToSign.push(initiateCall)
                notifications.addNotification({
                  type: "info",
                  title: "Wallet signature required",
                  message: `Confirm Garaga private bridge ${amountText} ${fromToken} -> ${toToken}.`,
                })
                onchainTxHash = await invokeStarknetCallsFromWallet(callsToSign, providerHint)
              } else {
                if (approvalCall) {
                  const approvalSpender = String(approvalCall.calldata?.[0] || "").trim()
                  notifications.addNotification({
                    type: "info",
                    title: "Wallet warning may appear",
                    message:
                      `Some wallets flag any approve call as high risk. This approval is limited to exact ${amountText} ${fromToken} ` +
                      `(spender ${shortAddress(approvalSpender)}).`,
                  })
                  notifications.addNotification({
                    type: "info",
                    title: "Wallet signature required",
                    message: `Confirm bridge approval for ${amountText} ${fromToken}.`,
                  })
                  await invokeStarknetCallsFromWallet([approvalCall], providerHint)
                }
                if (initiateCall) {
                  notifications.addNotification({
                    type: "info",
                    title: "Wallet signature required",
                    message: `Confirm bridge initiate ${amountText} ${fromToken} -> ${toToken}.`,
                  })
                  onchainTxHash = await invokeStarknetCallsFromWallet([initiateCall], providerHint)
                } else if (approvalCall) {
                  // Fallback when only approval transaction exists from provider.
                  onchainTxHash = await invokeStarknetCallsFromWallet([approvalCall], providerHint)
                }
              }
              try {
                bridgeResult = await submitBridgeWithOnchainHash(onchainTxHash)
              } catch (finalizeError) {
                if (!tierUsesGaraga && approvalCall && initiateCall && isStarknetEntrypointMissingError(finalizeError)) {
                  notifications.addNotification({
                    type: "warning",
                    title: "Retrying bridge submit",
                    message:
                      "Bridge multicall hit ENTRYPOINT_NOT_FOUND. Retrying with split signatures (approve then initiate).",
                  })
                  notifications.addNotification({
                    type: "info",
                    title: "Wallet signature required",
                    message: `Confirm bridge approval for ${amountText} ${fromToken}.`,
                  })
                  await invokeStarknetCallsFromWallet([approvalCall], providerHint)
                  notifications.addNotification({
                    type: "info",
                    title: "Wallet signature required",
                    message: `Confirm bridge initiate ${amountText} ${fromToken} -> ${toToken}.`,
                  })
                  const retryOnchainTxHash = await invokeStarknetCallsFromWallet(
                    [initiateCall],
                    providerHint
                  )
                  bridgeResult = await submitBridgeWithOnchainHash(retryOnchainTxHash)
                  onchainTxHash = retryOnchainTxHash
                } else {
                  throw finalizeError
                }
              }
              bridgeSourceTxHash = onchainTxHash
              bridgeSourceTxNetwork = "starknet"
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
              const btcAmountDisplay =
                amountSats > 0 ? formatBtcFromSats(amountSats) : "required BTC amount"
              btcDepositAmountDisplay = btcAmountDisplay

              if (wallet.btcAddress && amountSats > 0) {
                try {
                  notifications.addNotification({
                    type: "info",
                    title: "Wallet signature required",
                    message: "Approve BTC transfer in UniSat/Xverse popup.",
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
                      message: `${detail} Send ${btcAmountDisplay} manually to ${bridgeResult.deposit_address}.`,
                    })
                    btcDepositStateMessage = "\nBTC deposit was not sent automatically."
                  }
                }
              } else if (!wallet.btcAddress) {
                notifications.addNotification({
                  type: "warning",
                  title: "BTC wallet not connected",
                  message: "Connect UniSat/Xverse first to send BTC deposit on-chain.",
                })
                btcDepositStateMessage = "\nBTC wallet not connected."
              } else {
                btcDepositStateMessage = "\nBTC deposit requires manual confirmation."
              }
            }
            if (bridgeResult.deposit_address) {
              const awaitingBtcDeposit =
                fromChain === "bitcoin" && (!bridgeSourceTxHash || bridgeSourceTxNetwork !== "btc")
              notifications.addNotification({
                type: awaitingBtcDeposit ? "warning" : "success",
                title: awaitingBtcDeposit
                  ? "Bridge order awaiting BTC deposit"
                  : "Bridge order created",
                message: awaitingBtcDeposit
                  ? `Order ${shortBridgeId}... created. Send ${btcDepositAmountDisplay} to the deposit address to continue.`
                  : `Order ${shortBridgeId}... created for ${amountText} ${fromToken} -> ${toToken}.`,
                txHash: bridgeSourceTxHash || undefined,
                txNetwork: bridgeSourceTxHash ? bridgeSourceTxNetwork : undefined,
                txExplorerUrls: bridgeExplorerLinks,
              })
              const sourceTxUrl =
                bridgeSourceTxHash && bridgeSourceTxNetwork
                  ? buildTxExplorerUrl(bridgeSourceTxHash, bridgeSourceTxNetwork)
                  : ""
              const sourceTxHint = sourceTxUrl ? `\nTrack source tx: ${sourceTxUrl}` : ""
              const explorerHint = bridgeExplorerUrl
                ? `\nTrack order: ${bridgeExplorerUrl}\nIf search is delayed, open the direct order link above.`
                : ""
              const btcDepositInstruction =
                fromChain === "bitcoin"
                  ? `\nSend ${btcDepositAmountDisplay} BTC to: ${bridgeResult.deposit_address}`
                  : `\nSend deposit to ${bridgeResult.deposit_address} to continue settlement.`
              const orderExpiryWarning =
                fromChain === "bitcoin"
                  ? "\n⚠️ IMPORTANT: This order will expire automatically in about 1 hour if BTC deposit is not sent."
                  : ""
              const cancelSafetyHint =
                fromChain === "bitcoin"
                  ? "\nIf you cancel BTC deposit, do not send funds. Your BTC stays safe and the order will expire automatically."
                  : ""
              directExecutionMessage = normalizeMessageText(
                `${awaitingBtcDeposit ? "⚠️ Bridge order created (awaiting BTC deposit)" : "✅ Bridge order created"}: ${bridgeResult.bridge_id}.` +
                `${btcDepositInstruction}` +
                `${btcDepositStateMessage}${sourceTxHint}${explorerHint}\n` +
                `${orderExpiryWarning}${btcDepositCanceled ? cancelSafetyHint : ""}\n` +
                `${pointsLine}\n${discountLine}`
              )
            } else {
              notifications.addNotification({
                type: "success",
                title: "Bridge submitted",
                message: `Bridge ${amountText} ${fromToken} -> ${toToken}. Order ${shortBridgeId}...`,
                txHash: bridgeSourceTxHash || undefined,
                txNetwork: bridgeSourceTxHash ? bridgeSourceTxNetwork : undefined,
                txExplorerUrls: bridgeExplorerLinks,
              })
              const sourceTxUrl =
                bridgeSourceTxHash && bridgeSourceTxNetwork
                  ? buildTxExplorerUrl(bridgeSourceTxHash, bridgeSourceTxNetwork)
                  : ""
              const sourceTxHint = sourceTxUrl ? `\nTrack source tx: ${sourceTxUrl}` : ""
              const explorerHint = bridgeExplorerUrl
                ? `\nTrack order: ${bridgeExplorerUrl}`
                : ""
              directExecutionMessage = normalizeMessageText(
                `✅ Bridge submitted: ${amountText} ${fromToken} -> ${toToken}. ` +
                `Order: ${bridgeResult.bridge_id}.` +
                `${sourceTxHint}${explorerHint}\n` +
                `${pointsLine}\n${discountLine}`
              )
            }
          }
        }
      }

      const canAutoExecuteStake =
        !directExecutionMessage &&
        activeTier >= 2 &&
        /\bstake\b/i.test(command) &&
        (response.actions || []).includes("show_staking_pools")
      if (canAutoExecuteStake) {
        const token = resolveStakeTokenSymbol(readString(response.data, "token") || "")
        const amount = readNumber(response.data, "amount")
        const amountText = Number.isFinite(amount) && amount > 0 ? String(amount) : ""
        if (token && amountText) {
          if (!SUPPORTED_STAKE_TOKENS.has(token)) {
            directExecutionMessage = `Stake token ${token} is not available. Supported staking pools: CAREL, STRK, USDT, USDC, WBTC.`
          } else {
          let stakeResult: Awaited<ReturnType<typeof stakeDeposit>>
          let txHash = ""
          if (tierUsesGaraga) {
            try {
              stakeResult = await stakeDeposit({
                pool_id: token,
                amount: amountText,
                hide_balance: true,
              })
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error ?? "")
              if (HIDE_BALANCE_RELAYER_POOL_ENABLED && isRelayerAllowanceErrorMessage(message)) {
                await approveRelayerFundingForStake(token, amountText)
                stakeResult = await stakeDeposit({
                  pool_id: token,
                  amount: amountText,
                  hide_balance: true,
                })
              } else {
                if (!/requires onchain_tx_hash/i.test(message)) {
                  throw error
                }
                if (HIDE_BALANCE_SHIELDED_POOL_V2) {
                  throw new Error(
                    `Hide relayer unavailable. Wallet fallback is blocked in shielded_pool_v2 so stake details do not leak in explorer. Detail: ${message}`
                  )
                }
                const privacyPayload = await requestGaragaPayload("stake", token, token, amountText)
                const calls = [buildHideBalancePrivacyCall(privacyPayload), ...buildStakeWalletCalls(token, amountText)]
                notifications.addNotification({
                  type: "info",
                  title: "Wallet signature required",
                  message: `Confirm Garaga private stake ${amountText} ${token} in your wallet.`,
                })
                txHash = await invokeStarknetCallsFromWallet(calls, providerHint)
                stakeResult = await stakeDeposit({
                  pool_id: token,
                  amount: amountText,
                  onchain_tx_hash: txHash,
                  hide_balance: true,
                  privacy: privacyPayload,
                })
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
              hide_balance: false,
            })
          }
          const finalStakeTx = stakeResult.tx_hash || txHash
          notifications.addNotification({
            type: "success",
            title: "Stake completed",
            message: `Staked ${amountText} ${token}.`,
            txHash: finalStakeTx || undefined,
            txNetwork: finalStakeTx ? "starknet" : undefined,
          })
          const stakeTxPreview = finalStakeTx ? `${finalStakeTx.slice(0, 14)}...` : "-"
          const stakeTxUrl = finalStakeTx ? buildTxExplorerUrl(finalStakeTx, "starknet") : ""
          const stakeEstimatedPoints = parseNumberish(stakeResult.estimated_points_earned)
          const stakeDiscountPercent = parseNumberish(stakeResult.nft_discount_percent)
          const stakePointsLine =
            stakeEstimatedPoints > 0
              ? `Points +${stakeEstimatedPoints.toFixed(2)} (estimated).`
              : "Points reward: 0 (minimum threshold is not met for this stake size)."
          const stakeDiscountLine =
            stakeDiscountPercent > 0
              ? `Discount NFT applied ${stakeDiscountPercent.toFixed(2)}% on this stake.`
              : "Discount: not active on this stake."
          directExecutionMessage = normalizeMessageText(
            `✅ Stake executed: ${amountText} ${token}. Tx: ${stakeTxPreview}${stakeTxUrl ? `\nTrack tx: ${stakeTxUrl}` : ""}\n${stakePointsLine}\n${stakeDiscountLine}`
          )
          }
        }
      }

      const canAutoExecuteClaim =
        !directExecutionMessage &&
        activeTier >= 2 &&
        /\bclaim\b/i.test(command) &&
        (response.actions || []).includes("prepare_stake_claim")
      if (canAutoExecuteClaim) {
        const tokenHint = resolveStakeTokenSymbol(readString(response.data, "token") || "")
        if (tokenHint && !SUPPORTED_STAKE_TOKENS.has(tokenHint)) {
          directExecutionMessage = `Claim token ${tokenHint} is not available. Supported pools: CAREL, STRK, USDT, USDC, WBTC.`
        } else {
        const positions = await getStakePositions()
        const claimablePositions = positions.filter((item) => parseNumberish(item.rewards_earned) > 0)
        const candidate = tokenHint
          ? positions.find((item) => resolveStakeTokenSymbol(item.token) === tokenHint)
          : claimablePositions[0] || positions[0]
        if (!candidate) {
          directExecutionMessage = "No staking position found yet for claim rewards."
        } else if (parseNumberish(candidate.rewards_earned) <= 0) {
          directExecutionMessage = tokenHint
            ? `No claimable rewards found for ${tokenHint} yet. No CAREL was burned.`
            : "No claimable rewards found yet. No CAREL was burned."
        } else {
          let claimResult: Awaited<ReturnType<typeof stakeClaim>>
          let txHash = ""
          if (tierUsesGaraga) {
            try {
              claimResult = await stakeClaim({
                position_id: candidate.position_id,
                hide_balance: true,
              })
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error ?? "")
              if (HIDE_BALANCE_RELAYER_POOL_ENABLED && isRelayerAllowanceErrorMessage(message)) {
                const claimToken = resolveStakeTokenSymbol(candidate.token)
                await approveRelayerFundingForStake(claimToken, "1")
                claimResult = await stakeClaim({
                  position_id: candidate.position_id,
                  hide_balance: true,
                })
              } else {
                if (!/requires onchain_tx_hash/i.test(message)) {
                  throw error
                }
                if (HIDE_BALANCE_SHIELDED_POOL_V2) {
                  throw new Error(
                    `Hide relayer unavailable. Wallet fallback is blocked in shielded_pool_v2 so claim details do not leak in explorer. Detail: ${message}`
                  )
                }
                const claimToken = resolveStakeTokenSymbol(candidate.token)
                const privacyPayload = await requestGaragaPayload(
                  "stake_claim",
                  claimToken,
                  claimToken
                )
                const calls = [buildHideBalancePrivacyCall(privacyPayload), ...buildClaimWalletCalls(claimToken)]
                notifications.addNotification({
                  type: "info",
                  title: "Wallet signature required",
                  message: `Confirm Garaga private claim for ${claimToken} in your wallet.`,
                })
                txHash = await invokeStarknetCallsFromWallet(calls, providerHint)
                claimResult = await stakeClaim({
                  position_id: candidate.position_id,
                  onchain_tx_hash: txHash,
                  hide_balance: true,
                  privacy: privacyPayload,
                })
              }
            }
          } else {
            const claimToken = resolveStakeTokenSymbol(candidate.token)
            const calls = buildClaimWalletCalls(claimToken)
            notifications.addNotification({
              type: "info",
              title: "Wallet signature required",
              message: `Confirm claim rewards ${claimToken} in your wallet.`,
            })
            txHash = await invokeStarknetCallsFromWallet(calls, providerHint)
            claimResult = await stakeClaim({
              position_id: candidate.position_id,
              onchain_tx_hash: txHash,
              hide_balance: false,
            })
          }
          const finalClaimTx = claimResult.tx_hash || txHash
          notifications.addNotification({
            type: "success",
            title: "Claim completed",
            message: `Claim rewards submitted for ${candidate.token}.`,
            txHash: finalClaimTx || undefined,
            txNetwork: finalClaimTx ? "starknet" : undefined,
          })
          const claimTxPreview = finalClaimTx ? `${finalClaimTx.slice(0, 14)}...` : "-"
          const claimTxUrl = finalClaimTx ? buildTxExplorerUrl(finalClaimTx, "starknet") : ""
          directExecutionMessage = normalizeMessageText(
            `✅ Claim submitted for ${candidate.token}. Tx: ${claimTxPreview}${claimTxUrl ? `\nTrack tx: ${claimTxUrl}` : ""}`
          )
        }
        }
      }

      const canAutoExecuteLimitOrder =
        !directExecutionMessage &&
        activeTier >= 2 &&
        /\blimit(?:\s|-)?order\b/i.test(command) &&
        (response.actions || []).includes("prepare_limit_order")
      if (canAutoExecuteLimitOrder) {
        const fromToken = readString(response.data, "from_token").toUpperCase()
        const toToken = readString(response.data, "to_token").toUpperCase()
        const amount = readNumber(response.data, "amount")
        const price = readNumber(response.data, "price")
        const expiry = (readString(response.data, "expiry") || "7d").toLowerCase()
        const amountText = Number.isFinite(amount) && amount > 0 ? String(amount) : ""
        const priceText = Number.isFinite(price) && price > 0 ? String(price) : ""
        if (fromToken && toToken && amountText && priceText) {
          if (!SUPPORTED_LIMIT_ORDER_TOKENS.has(fromToken) || !SUPPORTED_LIMIT_ORDER_TOKENS.has(toToken)) {
            directExecutionMessage = `Limit order token ${fromToken}/${toToken} is not listed. Supported: USDT, USDC, STRK, CAREL.`
          } else {
          const fromAddress = AI_TOKEN_ADDRESS_MAP[fromToken]?.trim() || ""
          const toAddress = AI_TOKEN_ADDRESS_MAP[toToken]?.trim() || ""
          if (!fromAddress || !toAddress) {
            throw new Error(`Limit order pair ${fromToken}/${toToken} is not configured on frontend.`)
          }
          if (!STARKNET_LIMIT_ORDER_BOOK_ADDRESS.trim()) {
            throw new Error("NEXT_PUBLIC_STARKNET_LIMIT_ORDER_BOOK_ADDRESS is not configured.")
          }
          const clientOrderId = generateClientOrderId()
          const [amountLow, amountHigh] = decimalToU256Parts(
            amountText,
            AI_TOKEN_DECIMALS[fromToken] ?? 18
          )
          const [priceLow, priceHigh] = decimalToU256Parts(priceText, 18)
          const expiryTs = Math.floor(Date.now() / 1000) + expiryToSeconds(expiry)
          const createOrderCall = {
            contractAddress: STARKNET_LIMIT_ORDER_BOOK_ADDRESS.trim(),
            entrypoint: "create_limit_order",
            calldata: [
              clientOrderId,
              fromAddress,
              toAddress,
              amountLow,
              amountHigh,
              priceLow,
              priceHigh,
              toHexFelt(expiryTs),
            ],
          }

          let limitResult: Awaited<ReturnType<typeof createLimitOrder>>
          let txHash = ""
          if (tierUsesGaraga) {
            if (HIDE_BALANCE_SHIELDED_POOL_V2 && !HIDE_BALANCE_RELAYER_POOL_LIMIT_ENABLED) {
              throw new Error(
                "Hide limit-order relayer is disabled. Enable NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_LIMIT_ENABLED=true (frontend) and HIDE_BALANCE_RELAYER_POOL_LIMIT_ENABLED=true (backend), then retry."
              )
            }
            try {
              limitResult = await createLimitOrder({
                from_token: fromToken,
                to_token: toToken,
                amount: amountText,
                price: priceText,
                expiry,
                recipient: null,
                client_order_id: clientOrderId,
                hide_balance: true,
              })
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error ?? "")
              if (HIDE_BALANCE_RELAYER_POOL_ENABLED && isRelayerAllowanceErrorMessage(message)) {
                await approveRelayerFundingForStake(fromToken, amountText)
                limitResult = await createLimitOrder({
                  from_token: fromToken,
                  to_token: toToken,
                  amount: amountText,
                  price: priceText,
                  expiry,
                  recipient: null,
                  client_order_id: clientOrderId,
                  hide_balance: true,
                })
              } else {
                if (!/requires onchain_tx_hash/i.test(message)) {
                  throw error
                }
                if (HIDE_BALANCE_SHIELDED_POOL_V2) {
                  throw new Error(
                    `Hide limit-order relayer is unavailable (or disabled). In shielded_pool_v2, wallet fallback is blocked to avoid leaking details in explorer. Enable HIDE_BALANCE_RELAYER_POOL_LIMIT_ENABLED=true on backend and retry. Detail: ${message}`
                  )
                }
                const privacyPayload = await requestGaragaPayload(
                  "limit_order",
                  fromToken,
                  toToken,
                  amountText
                )
                const calls = [buildHideBalancePrivacyCall(privacyPayload), createOrderCall]
                notifications.addNotification({
                  type: "info",
                  title: "Wallet signature required",
                  message: `Confirm Garaga private limit order ${amountText} ${fromToken} -> ${toToken}.`,
                })
                txHash = await invokeStarknetCallsFromWallet(calls, providerHint)
                limitResult = await createLimitOrder({
                  from_token: fromToken,
                  to_token: toToken,
                  amount: amountText,
                  price: priceText,
                  expiry,
                  recipient: null,
                  client_order_id: clientOrderId,
                  onchain_tx_hash: txHash,
                  hide_balance: true,
                  privacy: privacyPayload,
                })
              }
            }
          } else {
            notifications.addNotification({
              type: "info",
              title: "Wallet signature required",
              message: `Confirm limit order ${amountText} ${fromToken} -> ${toToken} in your wallet.`,
            })
            txHash = await invokeStarknetCallsFromWallet([createOrderCall], providerHint)
            limitResult = await createLimitOrder({
              from_token: fromToken,
              to_token: toToken,
              amount: amountText,
              price: priceText,
              expiry,
              recipient: null,
              client_order_id: clientOrderId,
              onchain_tx_hash: txHash,
              hide_balance: false,
            })
          }
          notifications.addNotification({
            type: "success",
            title: "Limit order created",
            message: `Order ${limitResult.order_id} submitted.`,
          })
          const limitTxHash = (limitResult.privacy_tx_hash || txHash || "").trim()
          const limitTxPreview = limitTxHash ? `${limitTxHash.slice(0, 14)}...` : "-"
          const limitTxUrl = limitTxHash ? buildTxExplorerUrl(limitTxHash, "starknet") : ""
          const limitEstimatedPoints = parseNumberish(limitResult.estimated_points_earned)
          const limitDiscountPercent = parseNumberish(limitResult.nft_discount_percent)
          const limitPointsLine =
            limitEstimatedPoints > 0
              ? `Estimated points on fill: +${limitEstimatedPoints.toFixed(2)}.`
              : "Estimated points on fill: 0 (minimum threshold is not met for this order size)."
          const limitDiscountLine =
            limitDiscountPercent > 0
              ? `Discount NFT active ${limitDiscountPercent.toFixed(2)}% (used when fee-discountable execution is applied).`
              : "Discount: not active on this limit order."
          directExecutionMessage = normalizeMessageText(
            `✅ Limit order created: ${amountText} ${fromToken} -> ${toToken} at ${priceText} (${expiry}). Order: ${limitResult.order_id}. Tx: ${limitTxPreview}${limitTxUrl ? `\nTrack tx: ${limitTxUrl}` : ""}\n${limitPointsLine}\n${limitDiscountLine}`
          )
          }
        }
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
            `✅ Limit order cancelled: ${targetOrderId}. Tx: ${cancelTxPreview}${cancelTxUrl ? `\nTrack tx: ${cancelTxUrl}` : ""}`
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
        !!baseAssistant &&
        !/^(command received\.?|perintah diterima\.?)$/i.test(baseAssistant.trim())
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
      if (commandNeedsOnchainAction) {
        if (typeof actionIdValue === "number" && actionIdValue > 0) {
          setPendingActions((prev) => prev.filter((id) => id !== actionIdValue))
        }
        setActionId("")
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "AI request failed."
      const message = formatExecutionFailureMessage(rawMessage, command)
      if (isSetupOutOfSyncError(message)) {
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

  const createOnchainActionId = async (options?: { requireFresh?: boolean }): Promise<number | null> => {
    const requireFresh = options?.requireFresh === true
    lastSetupFailureRef.current = ""
    if (selectedTier < 2) return null
    if (isCreatingAction) {
      lastSetupFailureRef.current = "On-chain setup is still in progress. Wait for wallet confirmation, then retry."
      return null
    }
    if (!staticCarelTokenAddress) {
      const message =
        "NEXT_PUBLIC_TOKEN_CAREL_ADDRESS is missing. Set CAREL token contract address first."
      lastSetupFailureRef.current = message
      notifications.addNotification({
        type: "error",
        title: "CAREL token not configured",
        message,
      })
      return null
    }
    let executorAddress = ""
    try {
      executorAddress = await ensureExecutorAddress()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "AI executor is not configured. Please set backend/frontend executor address first."
      lastSetupFailureRef.current = message
      notifications.addNotification({
        type: "error",
        title: "AI executor not configured",
        message,
      })
      return null
    }

    const requiredCarelForExecution = executionBurnAmountCarel(selectedTier)
    const effectiveStarknetAddress =
      wallet.starknetAddress || (wallet.network === "starknet" ? wallet.address : null)
    const readKnownCarelBalance = (): number | null => {
      const onchainCarel = wallet.onchainBalance?.CAREL
      const portfolioCarel = wallet.balance?.CAREL
      const candidates = [onchainCarel, portfolioCarel].filter(
        (value): value is number => typeof value === "number" && Number.isFinite(value)
      )
      if (candidates.length > 0) {
        return Math.max(...candidates)
      }
      return null
    }
    let knownCarelBalance = readKnownCarelBalance()
    if (knownCarelBalance === null || knownCarelBalance + 1e-9 < requiredCarelForExecution) {
      try {
        await wallet.refreshOnchainBalances()
        knownCarelBalance = readKnownCarelBalance()
      } catch {
        // Continue with wallet-sign flow; exact balance may still be unknown.
      }
    }
    if (
      knownCarelBalance === null ||
      (Number.isFinite(knownCarelBalance) && knownCarelBalance + 1e-9 < requiredCarelForExecution)
    ) {
      try {
        const forced = await getOnchainBalances(
          {
            starknet_address: effectiveStarknetAddress,
            evm_address: wallet.evmAddress || null,
            btc_address: wallet.btcAddress || null,
          },
          { force: true }
        )
        if (typeof forced?.carel === "number" && Number.isFinite(forced.carel)) {
          knownCarelBalance = forced.carel
        }
      } catch {
        // Keep previous value and continue to guarded check below.
      }
    }
    if (
      typeof knownCarelBalance === "number" &&
      Number.isFinite(knownCarelBalance) &&
      knownCarelBalance + 1e-9 < requiredCarelForExecution
    ) {
      const message =
        `Execution setup requires ${requiredCarelForExecution} CAREL burn fee, but available CAREL is ~${knownCarelBalance.toFixed(6)}.` +
        " Top up CAREL then retry."
      lastSetupFailureRef.current = message
      notifications.addNotification({
        type: "error",
        title: "Insufficient CAREL",
        message,
      })
      return null
    }

    setIsCreatingAction(true)
    let pendingBefore: number[] = []
    let pendingBeforeMax = 0
    try {
      const before = await getAiPendingActions(0, 50)
      pendingBefore = before.pending || []
      pendingBeforeMax = pickLatestPendingAction(pendingBefore) || 0
    } catch {
      pendingBefore = []
      pendingBeforeMax = 0
    }

    try {
      if (!requireFresh && Date.now() < setupSubmitCooldownUntilRef.current) {
        const latest = pickLatestPendingAction(pendingBefore)
        if (latest && latest > 0) {
          setPendingActions(pendingBefore)
          setActionId(String(latest))
          lastSetupFailureRef.current = ""
          notifications.addNotification({
            type: "success",
            title: "On-chain setup ready",
            message: "Using latest pending setup from your account.",
          })
          return latest
        }
        notifications.addNotification({
          type: "info",
          title: "Setup cooldown active",
          message: "A setup transaction was submitted recently. Please wait a few seconds before retrying.",
        })
        lastSetupFailureRef.current =
          "Setup transaction was submitted recently. Wait a few seconds, then retry once."
        return null
      }

      const cachedPreflight = executorPreflightCacheRef.current
      const nowMs = Date.now()
      const useCachedPreflight = cachedPreflight.expiresAt > nowMs
      const preflight = useCachedPreflight
        ? {
            ready: cachedPreflight.ready,
            burner_role_granted: cachedPreflight.burnerRoleGranted,
            updated_onchain: false,
            tx_hash: null,
            message: cachedPreflight.message,
          }
        : await ensureAiExecutorReady()
      if (!useCachedPreflight) {
        const preflightTtlMs =
          preflight.ready && preflight.burner_role_granted
            ? AI_EXECUTOR_PREFLIGHT_CACHE_MS
            : Math.min(5_000, AI_EXECUTOR_PREFLIGHT_CACHE_MS)
        executorPreflightCacheRef.current = {
          ready: preflight.ready,
          burnerRoleGranted: preflight.burner_role_granted,
          message: preflight.message || "",
          expiresAt: Date.now() + preflightTtlMs,
        }
      }
      if (preflight.tx_hash) {
        notifications.addNotification({
          type: preflight.ready ? "success" : "info",
          title: preflight.ready ? "Executor role ready" : "Executor role update submitted",
          message: preflight.message,
          txHash: preflight.tx_hash,
          txNetwork: "starknet",
        })
      }
      if (!preflight.ready || !preflight.burner_role_granted) {
        throw new Error(preflight.message || "AI executor preflight is not ready yet.")
      }

      const payload = `tier:${selectedTier}`
      const actionType = actionTypeForTier(selectedTier)
      const providerHint = resolveStarknetProviderHint(wallet.provider)
      const approveAmountCarel = setupApprovalAmountCarel(selectedTier)
      const [approveAmountLow, approveAmountHigh] = decimalToU256Parts(
        String(approveAmountCarel),
        18
      )

      const prepareWindowWithRetry = async () => {
        try {
          return await prepareAiAction({
            level: selectedTier,
            context: payload,
            window_seconds: AI_SETUP_SIGNATURE_WINDOW_SECONDS,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error ?? "")
          if (!/request timeout|network error|timed out|timeout/i.test(message.toLowerCase())) {
            throw error
          }
          notifications.addNotification({
            type: "info",
            title: "Preparing setup window",
            message:
              "Backend is still preparing AI signature hashes. Retrying once before opening wallet popup.",
          })
          await waitMs(1200)
          return prepareAiAction({
            level: selectedTier,
            context: payload,
            window_seconds: AI_SETUP_SIGNATURE_WINDOW_SECONDS,
          })
        }
      }

      const prepareResponse = await prepareWindowWithRetry()
      notifications.addNotification({
        type: "info",
        title: "AI signature window prepared",
        message: `Window ${prepareResponse.from_timestamp}-${prepareResponse.to_timestamp} prepared.`,
        txHash: prepareResponse.tx_hash,
        txNetwork: "starknet",
      })

      await waitMs(AI_SETUP_PRE_WALLET_DELAY_MS)

      /**
       * Runs `submitOnchainAction` and handles related side effects.
       *
       * @returns Result consumed by caller flow, UI state updates, or async chaining.
       * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
       */
      const setupCalls = AI_SETUP_SKIP_APPROVE
        ? [
            {
              contractAddress: executorAddress,
              entrypoint: "submit_action",
              calldata: [actionType, ...encodeShortByteArray(payload), 0],
            },
          ]
        : [
            {
              contractAddress: staticCarelTokenAddress,
              entrypoint: "approve",
              calldata: [executorAddress, approveAmountLow, approveAmountHigh],
            },
            {
              contractAddress: executorAddress,
              entrypoint: "submit_action",
              calldata: [actionType, ...encodeShortByteArray(payload), 0],
            },
          ]

      const submitOnchainAction = async (forceSequential = false) => {
        if (forceSequential && setupCalls.length > 1) {
          let lastTxHash = ""
          for (const call of setupCalls) {
            lastTxHash = await invokeStarknetCallFromWallet(call, providerHint)
          }
          return lastTxHash
        }
        return invokeWalletCallsWithSequentialFallback(setupCalls, providerHint, {
          allowSequentialFallback: !AI_SETUP_SKIP_APPROVE && setupCalls.length === 2,
          onFallback: () => {
            notifications.addNotification({
              type: "warning",
              title: "Wallet multicall fallback",
              message:
                "Wallet multicall failed. Continuing with separate signatures: CAREL approve, then submit_action.",
            })
          },
        })
      }
      const isWalletNonceError = (error: unknown) => {
        const message =
          error instanceof Error ? error.message : typeof error === "string" ? error : ""
        return /invalid transaction nonce|invalid nonce|nonce too low/i.test(message.toLowerCase())
      }

      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message: AI_SETUP_SKIP_APPROVE
          ? `Confirm submit_action transaction in your Starknet wallet (burn ${executionBurnAmountCarel(selectedTier)} CAREL for this execution).`
          : `Confirm CAREL approval (${approveAmountCarel}) + submit_action transaction in your Starknet wallet (burn ${executionBurnAmountCarel(selectedTier)} CAREL for this execution).`,
      })
      let onchainTxHash: string
      try {
        onchainTxHash = await submitOnchainAction()
      } catch (firstError) {
        const firstMessage =
          firstError instanceof Error ? firstError.message : String(firstError ?? "")
        if (
          isInvalidUserSignatureError(firstError) ||
          isWalletMulticallExecutionError(firstMessage)
        ) {
          notifications.addNotification({
            type: "info",
            title: "Refreshing setup signature",
            message:
              "Detected wallet signature mismatch. Refreshing setup window and retrying with split signatures.",
          })
          await waitMs(AI_SETUP_NONCE_RETRY_DELAY_MS)
          // Retry once by refreshing the validity window.
          const retryPrepared = await prepareWindowWithRetry()
          notifications.addNotification({
            type: "info",
            title: "Retrying with refreshed window",
            message: "Signature window refreshed. Confirm the transaction one more time.",
            txHash: retryPrepared.tx_hash,
            txNetwork: "starknet",
          })
          await waitMs(AI_SETUP_PRE_WALLET_DELAY_MS)
          onchainTxHash = await submitOnchainAction(true)
        } else if (isWalletNonceError(firstError)) {
          notifications.addNotification({
            type: "info",
            title: "Nonce pending on wallet",
            message:
              "Previous wallet nonce is still pending. Waiting briefly, then retrying setup once.",
          })
          await waitMs(AI_SETUP_NONCE_RETRY_DELAY_MS)
          onchainTxHash = await submitOnchainAction()
        } else {
          throw firstError
        }
      }

      notifications.addNotification({
        type: "info",
        title: "On-chain setup submitted",
        message: "Waiting for setup to appear in pending list...",
        txHash: onchainTxHash,
        txNetwork: "starknet",
      })
      setupSubmitCooldownUntilRef.current = Date.now() + AI_SETUP_SUBMIT_COOLDOWN_MS
      lastSetupSubmitAtRef.current = Date.now()

      let latestPending: number[] = pendingBefore
      for (let attempt = 0; attempt < AI_SETUP_PENDING_POLL_ATTEMPTS; attempt += 1) {
        await waitMs(AI_SETUP_PENDING_POLL_INTERVAL_MS)
        try {
          const after = requireFresh
            ? await getAiPendingActions(pendingBeforeMax, 50)
            : await getAiPendingActions(0, 50)
          latestPending = after.pending || []
          const discovered = requireFresh
            ? pickLatestPendingAbove(latestPending, pendingBeforeMax)
            : findNewPendingAction(latestPending, pendingBefore)
          if (discovered) {
            setPendingActions(latestPending)
            setActionId(String(discovered))
            lastSetupFailureRef.current = ""
            notifications.addNotification({
              type: "success",
              title: "On-chain setup ready",
              message: `Setup is ready for Tier ${selectedTier}.`,
              txHash: onchainTxHash,
              txNetwork: "starknet",
            })
            return discovered
          }
        } catch {
          // continue polling
        }
      }

      setPendingActions(latestPending)
      const latest = pickLatestPendingAction(latestPending)
      if (latest && latest > 0) {
        if (requireFresh) {
          const fresh = pickLatestPendingAbove(latestPending, pendingBeforeMax)
          if (!fresh || fresh <= 0) {
            try {
              const fullTail = await getAiPendingActions(0, 50)
              const fullTailPending = fullTail.pending || []
              setPendingActions(fullTailPending)
              const freshFromFullTail = pickLatestPendingAbove(fullTailPending, pendingBeforeMax)
              if (freshFromFullTail && freshFromFullTail > 0) {
                setActionId(String(freshFromFullTail))
                lastSetupFailureRef.current = ""
                notifications.addNotification({
                  type: "success",
                  title: "On-chain setup ready",
                  message: `Fresh execution setup is ready for Tier ${selectedTier}.`,
                  txHash: onchainTxHash,
                  txNetwork: "starknet",
                })
                return freshFromFullTail
              }
            } catch {
              // Keep the original error below when fallback lookup fails.
            }
            notifications.addNotification({
              type: "error",
              title: "Fresh setup not detected",
              message:
                "No new on-chain setup action was found for this execution. Please sign again in wallet.",
              txHash: onchainTxHash,
              txNetwork: "starknet",
            })
            lastSetupFailureRef.current =
              "No new on-chain setup action was detected yet after wallet signature. Please sign again in wallet."
            return null
          }
          setActionId(String(fresh))
          lastSetupFailureRef.current = ""
          notifications.addNotification({
            type: "success",
            title: "On-chain setup ready",
            message: `Fresh execution setup is ready for Tier ${selectedTier}.`,
            txHash: onchainTxHash,
            txNetwork: "starknet",
          })
          return fresh
        }
        setActionId(String(latest))
        lastSetupFailureRef.current = ""
        notifications.addNotification({
          type: "success",
          title: "On-chain setup ready",
          message: "Using latest pending setup from your account.",
          txHash: onchainTxHash,
          txNetwork: "starknet",
        })
        return latest
      }
      notifications.addNotification({
        type: "info",
        title: "Setup not detected yet",
        message: "Please retry Auto Setup On-Chain in a few seconds.",
        txHash: onchainTxHash,
        txNetwork: "starknet",
      })
      lastSetupFailureRef.current =
        "Setup transaction was submitted, but pending action is not indexed yet. Retry in a few seconds."
      return null
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "submit_action transaction failed"
      const lowerRaw = rawMessage.toLowerCase()
      if (!requireFresh && /rate limit exceeded/i.test(rawMessage)) {
        try {
          const pendingAfter = await getAiPendingActions(0, 50)
          const latest = pickLatestPendingAction(pendingAfter.pending || [])
          if (latest && latest > 0) {
            setPendingActions(pendingAfter.pending || [])
            setActionId(String(latest))
              notifications.addNotification({
                type: "success",
                title: "On-chain setup ready",
                message: "Rate limit reached for new setup requests, using your latest pending setup.",
              })
              lastSetupFailureRef.current = ""
              return latest
            }
          } catch {
          // Ignore and surface the original rate-limit message below.
        }
      }
      const mappedMessage = /caller is missing role/i.test(rawMessage)
        ? "CAREL token has not granted BURNER_ROLE to AI executor yet. Run Auto Setup again after backend preflight completes."
        : /invalid transaction nonce|invalid nonce|nonce too low/i.test(lowerRaw)
          ? "Nonce is still pending on Starknet (previous setup tx not finalized yet). Wait 10-20 seconds, then retry Auto Setup On-Chain once."
        : /rate_limit getter is unavailable|rate_limit entrypoint not found|set_rate_limit entrypoint not found|cannot read ai executor on-chain rate limit|ai executor preflight blocked/i.test(
              lowerRaw
            )
          ? "AI executor preflight could not verify/adjust on-chain rate limit. Ensure backend signer has AI executor admin role, then retry Auto Setup."
        : /(entrypointnotfound|entrypoint not found|entrypoint_not_found)/i.test(rawMessage) &&
            /submit_action/.test(lowerRaw)
          ? "AI executor address/class mismatch (`submit_action` entrypoint not found). Ensure AI_EXECUTOR_ADDRESS and NEXT_PUBLIC_STARKNET_AI_EXECUTOR_ADDRESS point to the correct AIExecutor contract."
        : /(entrypointnotfound|entrypoint not found|entrypoint_not_found)/i.test(rawMessage)
          ? `Configured contract at ${executorAddress || "AI_EXECUTOR_ADDRESS"} does not expose the required setup entrypoint. Recheck deployed class and restart frontend/backend.`
        : /rate limit exceeded/i.test(rawMessage)
          ? "AI executor daily on-chain rate limit reached. Ask admin to increase `set_rate_limit` (for example 1000), or wait until UTC day reset."
        : /request timeout|network error|timed out|timeout/i.test(lowerRaw)
          ? "AI setup preparation timed out before wallet popup appeared. Usually backend/RPC is still busy preparing signature hashes. Retry once."
        : /insufficient allowance/i.test(rawMessage)
          ? "Demo setup is skipping approve, but contract still requires allowance. Disable AI setup fee (fee_enabled=false) or disable NEXT_PUBLIC_AI_SETUP_SKIP_APPROVE."
        : rawMessage
      const message = formatSetupFailureMessage(
        mappedMessage,
        requiredCarelForExecution,
        knownCarelBalance
      )
      lastSetupFailureRef.current = message
      notifications.addNotification({
        type: "error",
        title: "Failed to submit on-chain action",
        message,
      })
      return null
    } finally {
      setIsCreatingAction(false)
    }
  }

  const isSetupProcessing = isCreatingAction || isAutoPreparingAction || isResolvingExecutor
  const isWidgetBusy = isSetupProcessing || isUpgradingTier || isLoadingTier
  const hasSetupReady = AI_REQUIRE_FRESH_SETUP_PER_EXECUTION
    ? false
    : hasValidActionId || pendingActions.length > 0

  const handleAutoSetup = async () => {
    setIsAutoPreparingAction(true)
    try {
      if (AI_REQUIRE_FRESH_SETUP_PER_EXECUTION) {
        await createOnchainActionId({ requireFresh: true })
        return
      }
      const pending = await loadPendingActions(true)
      const latest = pickLatestPendingAction(pending)
      if (latest && latest > 0) {
        setActionId(String(latest))
        notifications.addNotification({
          type: "success",
          title: "On-chain setup ready",
          message: "Using latest pending setup from your account.",
        })
        return
      }
      const created = await createOnchainActionId()
      if (!created) return
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Backend not connected",
        message: formatBackendConnectivityMessage(error),
      })
    } finally {
      setIsAutoPreparingAction(false)
    }
  }

  const handleTierUpgrade = async (targetTier: number) => {
    if (isUpgradingTier || targetTier <= unlockedTier) {
      setSelectedTier(Math.min(3, Math.max(1, targetTier)))
      return
    }
    const requiredCarel = incrementalTierUpgradeCost(unlockedTier, targetTier)
    if (requiredCarel <= 0) {
      setUnlockedTier(targetTier)
      setSelectedTier(targetTier)
      return
    }

    if (!staticCarelTokenAddress) {
      notifications.addNotification({
        type: "error",
        title: "CAREL token not configured",
        message:
          "NEXT_PUBLIC_TOKEN_CAREL_ADDRESS is missing. Set CAREL token contract address first.",
      })
      return
    }

    setIsUpgradingTier(true)
    try {
      let paymentTo = effectivePaymentAddress
      if (!paymentTo) {
        const levelInfo = await getAiLevel()
        paymentTo = (levelInfo.payment_address || levelInfo.burn_address || "").trim()
        setPaymentAddress(paymentTo)
      }
      if (!paymentTo) {
        throw new Error("AI level payment address is not configured on backend.")
      }

      const providerHint = resolveStarknetProviderHint(wallet.provider)
      const [amountLow, amountHigh] = decimalToU256Parts(String(requiredCarel), 18)
      notifications.addNotification({
        type: "info",
        title: "Level upgrade payment",
        message: `Sign transfer ${requiredCarel} CAREL to payment wallet in your wallet.`,
      })
      const paymentTxHash = await invokeStarknetCallFromWallet(
        {
          contractAddress: staticCarelTokenAddress,
          entrypoint: "transfer",
          calldata: [paymentTo, amountLow, amountHigh],
        },
        providerHint
      )

      const upgrade = await upgradeAiLevel({
        target_level: targetTier,
        onchain_tx_hash: paymentTxHash,
      })
      setUnlockedTier(upgrade.current_level)
      setSelectedTier(upgrade.current_level)
      await refreshAiLevel(true)

      notifications.addNotification({
        type: "success",
        title: "AI level upgraded",
        message: `Level ${upgrade.current_level} active. Paid ${upgrade.burned_carel} CAREL.`,
        txHash: upgrade.onchain_tx_hash,
        txNetwork: "starknet",
      })
      appendMessagesForTier(upgrade.current_level, [
        {
          role: "assistant",
          content: normalizeMessageText(
            `✅ Upgrade complete. Level ${upgrade.current_level} is active now. Tx: ${upgrade.onchain_tx_hash.slice(0, 12)}...\nTrack tx: ${buildTxExplorerUrl(upgrade.onchain_tx_hash, "starknet")}`
          ),
          timestamp: nowTimestampLabel(),
        },
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to upgrade AI level."
      notifications.addNotification({
        type: "error",
        title: "AI level upgrade failed",
        message,
      })
      appendMessagesForTier(selectedTier, [
        {
          role: "assistant",
          content: normalizeMessageText(`🔒 Upgrade failed: ${message}`),
          timestamp: nowTimestampLabel(),
        },
      ])
    } finally {
      setIsUpgradingTier(false)
    }
  }

  const handleTierTabClick = async (tierId: number) => {
    if (isWidgetBusy) return
    if (tierId <= unlockedTier) {
      setSelectedTier(tierId)
      return
    }
    await handleTierUpgrade(tierId)
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => {
          if (suppressBubbleClickRef.current) return
          openAssistantNearBubble()
        }}
        onPointerDown={handleBubblePointerDown}
        onPointerMove={handleBubblePointerMove}
        onPointerUp={endBubbleDrag}
        onPointerCancel={endBubbleDrag}
        className={cn(
          "fixed z-50 flex h-14 w-14 items-center justify-center rounded-full",
          "border border-[#06b6d455] bg-[radial-gradient(circle_at_30%_20%,#7c3aed_0%,#0a1423_55%,#080f1a_100%)]",
          "text-[#e2e8f0] transition duration-200 hover:scale-105",
          isBubbleDragging ? "cursor-grabbing" : "cursor-grab",
          "shadow-[0_8px_26px_rgba(0,0,0,0.55),0_0_20px_rgba(6,182,212,0.35)]"
        )}
        style={
          bubblePosition
            ? {
                left: bubblePosition.x,
                top: bubblePosition.y,
                touchAction: "none",
              }
            : {
                right: 20,
                bottom: 20,
                touchAction: "none",
              }
        }
      >
        <span className={cn(spaceMono.className, "text-xl")}>🤖</span>
      </button>
    )
  }

  return (
    <>
      <div
        className={cn(
          dmSans.className,
          "fixed z-50 overflow-hidden rounded-[20px] border border-[#1e293b]",
          "bg-[#080f1a] text-[#e2e8f0] transition-all duration-300",
          "shadow-[0_28px_60px_rgba(2,6,23,0.92),0_0_0_1px_rgba(6,182,212,0.22),0_0_26px_rgba(6,182,212,0.28)]",
          isMinimized
            ? "h-16 w-[460px] max-w-[calc(100vw-16px)]"
            : "h-[700px] w-[460px] max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)]"
        )}
        style={
          panelPosition
            ? {
                left: panelPosition.x,
                top: panelPosition.y,
              }
            : {
                right: 16,
                bottom: 16,
              }
        }
      >
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top,#13233c_0%,transparent_55%)] opacity-90" />
        <div className="absolute inset-0 pointer-events-none carel-scanlines" />

        <div className="relative z-10 border-b border-[#1e293b] px-4 pt-3 pb-2 bg-[#0a1423cc]">
          <div
            className={cn(
              "flex items-center justify-between select-none",
              isPanelDragging ? "cursor-grabbing" : "cursor-grab"
            )}
            onPointerDown={handlePanelPointerDown}
            onPointerMove={handlePanelPointerMove}
            onPointerUp={endPanelDrag}
            onPointerCancel={endPanelDrag}
            style={{ touchAction: "none" }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <div className="rounded-2xl bg-gradient-to-r from-[#7c3aed] to-[#06b6d4] p-[1.5px]">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[#080f1a] text-base">
                  🤖
                </div>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className={cn(spaceMono.className, "truncate text-sm font-bold text-[#e2e8f0]")}>
                    CAREL Agent
                  </p>
                  <span
                    className={cn(
                      spaceMono.className,
                      "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                      levelBadgeClasses[selectedTier] || levelBadgeClasses[1]
                    )}
                  >
                    Level {selectedTier}
                  </span>
                </div>
                <p className="text-[11px] text-[#475569]">{aiTiers[selectedTier - 1].description}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsMinimized((prev) => !prev)}
                className="rounded-md p-1.5 text-[#94a3b8] transition hover:bg-[#111f35] hover:text-[#e2e8f0]"
              >
                {isMinimized ? <ChevronUp className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-md p-1.5 text-[#94a3b8] transition hover:bg-[#111f35] hover:text-[#e2e8f0]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {!isMinimized && (
            <div className="mt-3 rounded-full border border-[#1e293b] bg-[#0b1729] p-1">
              <div className="grid grid-cols-3 gap-1">
                {aiTiers.map((tier) => (
                  <button
                    key={tier.id}
                    onClick={() => {
                      void handleTierTabClick(tier.id)
                    }}
                    disabled={isWidgetBusy}
                    className={cn(
                      spaceMono.className,
                      "relative rounded-full px-2 py-1.5 text-xs transition-all duration-200",
                      selectedTier === tier.id
                        ? "bg-[#102841] text-[#e2e8f0] shadow-[inset_0_-1px_0_#06b6d4,0_0_16px_rgba(6,182,212,0.35)]"
                        : tier.id <= unlockedTier
                          ? "text-[#475569] hover:text-[#cbd5e1]"
                          : "text-[#334155] hover:text-[#64748b]",
                      "disabled:cursor-not-allowed disabled:opacity-70"
                    )}
                  >
                    {tier.id > unlockedTier ? "🔒 " : ""}L{tier.id}
                    {selectedTier === tier.id && (
                      <span className="absolute inset-x-4 -bottom-0.5 h-[2px] rounded-full bg-[#06b6d4]" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {!isMinimized && (
          <div className="relative z-10 flex h-[calc(100%-118px)] flex-col">
            {selectedTier >= 2 && (
              <div className="mx-3 mt-3">
                {!hasSetupReady ? (
                  <div className="rounded-xl border border-[#334155] bg-[#0d1b2e] p-2.5">
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-[#e2e8f0]">
                      <Zap className="h-3.5 w-3.5 text-[#06b6d4]" />
                      <span>
                        {AI_REQUIRE_FRESH_SETUP_PER_EXECUTION
                          ? "On-chain signature required for execution"
                          : "One-time on-chain setup needed"}
                      </span>
                    </div>
                    <button
                      onClick={handleAutoSetup}
                      disabled={isWidgetBusy}
                      className={cn(
                        "flex w-full items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold",
                        "bg-[#06b6d4] text-[#03131f] transition",
                        "shadow-[0_0_16px_rgba(6,182,212,0.45)] hover:brightness-110 active:scale-[0.99]",
                        "disabled:cursor-not-allowed disabled:opacity-60"
                      )}
                    >
                      {isSetupProcessing ? (
                        <>
                          <span className="mr-2 h-3 w-3 animate-spin rounded-full border-2 border-[#03131f] border-t-transparent" />
                          Preparing...
                        </>
                      ) : (
                        AI_REQUIRE_FRESH_SETUP_PER_EXECUTION
                          ? "Sign Execution Setup"
                          : "Auto Setup On-Chain"
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-xl border border-[#14532d] bg-[#052315] px-3 py-2 text-xs text-[#86efac]">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className={spaceMono.className}>Executor Ready</span>
                  </div>
                )}
              </div>
            )}

            <div className="relative mt-3 flex-1 overflow-y-auto px-3 pb-2 pt-1">
              <div className="space-y-2.5">
                {messages.map((message, index) => {
                  const isUser = message.role === "user"
                  return (
                    <div
                      key={`${message.timestamp}-${index}`}
                      className={cn("flex", isUser ? "justify-end" : "justify-start")}
                      style={{ animation: "carelFadeUp .24s ease-out" }}
                    >
                      <div className="max-w-[82%]">
                        <div
                          className={cn(
                            "rounded-xl border px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words",
                            isUser
                              ? "border-[#06b6d4aa] bg-[#06b6d415] text-[#dff9ff]"
                              : "border-l-2 border-l-[#7c3aed] border-r border-y border-[#243247] bg-[#0d1b2e] text-[#e2e8f0]"
                          )}
                        >
                          {renderMessageContentWithLinks(message.content)}
                        </div>
                        <p
                          className={cn(
                            spaceMono.className,
                            "mt-1 text-[10px] text-[#475569]",
                            isUser ? "text-right" : "text-left"
                          )}
                        >
                          {message.timestamp}
                        </p>
                      </div>
                    </div>
                  )
                })}

                {isSending && (
                  <div className="flex justify-start" style={{ animation: "carelFadeUp .24s ease-out" }}>
                    <div className="rounded-xl border border-l-2 border-l-[#7c3aed] border-[#243247] bg-[#0d1b2e] px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="carel-dot" />
                        <span className="carel-dot" />
                        <span className="carel-dot" />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="border-t border-[#1e293b] px-3 pb-3 pt-2">
              <div className="mb-2 flex items-start justify-between gap-2">
                <p className={cn(spaceMono.className, "text-[10px] text-[#64748b]")}>{featureList}</p>
                {canTogglePromptExamples && (
                  <button
                    type="button"
                    onClick={() => setShowPromptExamples((prev) => !prev)}
                    className={cn(
                      spaceMono.className,
                      "rounded-md border border-[#334155] bg-[#0b1729] px-2 py-1 text-[10px] text-[#94a3b8]",
                      "transition hover:border-[#06b6d4] hover:text-[#cffafe]"
                    )}
                  >
                    {shouldShowPromptExamples ? "Hide examples" : "Show examples"}
                  </button>
                )}
              </div>
              {shouldShowPromptExamples && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {quickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => setInput(prompt)}
                      className={cn(
                        spaceMono.className,
                        "rounded-full border border-[#334155] bg-[#0b1729] px-2.5 py-1 text-[10px] text-[#475569]",
                        "transition duration-150 hover:-translate-y-[1px] hover:border-[#06b6d4] hover:text-[#cffafe]",
                        "hover:shadow-[0_0_14px_rgba(6,182,212,0.35)]"
                      )}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
              {selectedTier === 2 && !shouldShowPromptExamples && (
                <div className="mb-2">
                  <p className={cn(spaceMono.className, "mb-1 text-[10px] text-[#64748b]")}>
                    Bridge shortcuts:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {l2BridgeShortcutPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => setInput(prompt)}
                        className={cn(
                          spaceMono.className,
                          "rounded-full border border-[#0f766e] bg-[#0b1729] px-2.5 py-1 text-[10px] text-[#67e8f9]",
                          "transition duration-150 hover:-translate-y-[1px] hover:border-[#06b6d4] hover:text-[#cffafe]",
                          "hover:shadow-[0_0_14px_rgba(6,182,212,0.35)]"
                        )}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  placeholder="Type command or tap example..."
                  disabled={isSending || isResolvingExecutor || isUpgradingTier || isLoadingTier}
                  className={cn(
                    "h-10 flex-1 rounded-xl border border-[#334155] bg-[#0b1729] px-3 text-sm text-[#e2e8f0]",
                    "placeholder:text-[#475569] outline-none transition focus:border-[#06b6d4] focus:ring-2 focus:ring-[#06b6d433]"
                  )}
                />
                <Button
                  onClick={handleSend}
                  size="sm"
                  disabled={isSending || !input.trim() || isWidgetBusy}
                  className={cn(
                    "h-10 w-10 rounded-xl border-0 bg-[#06b6d4] p-0 text-[#03131f]",
                    "shadow-[0_0_16px_rgba(6,182,212,0.45)] transition hover:brightness-110 active:scale-95"
                  )}
                >
                  <ArrowUpRight className="h-4 w-4" />
                </Button>
              </div>

              {selectedTier > unlockedTier ? (
                <p className={cn(spaceMono.className, "mt-1 text-[10px] text-[#475569]")}>
                  🔒 Upgrade to Level {selectedTier} by paying{" "}
                  {incrementalTierUpgradeCost(unlockedTier, selectedTier)} CAREL first.
                </p>
              ) : selectedTier >= 2 && commandNeedsAction && !hasSetupReady ? (
                <p className={cn(spaceMono.className, "mt-1 text-[10px] text-[#475569]")}>
                  🔒 This action requires wallet signature and burns{" "}
                  {executionBurnAmountCarel(selectedTier)} CAREL.
                </p>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        @keyframes carelFadeUp {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes carelScanShift {
          from {
            transform: translateY(0);
          }
          to {
            transform: translateY(8px);
          }
        }
        .carel-scanlines {
          background: repeating-linear-gradient(
            to bottom,
            rgba(148, 163, 184, 0.03) 0px,
            rgba(148, 163, 184, 0.03) 1px,
            transparent 2px,
            transparent 4px
          );
          animation: carelScanShift 6s linear infinite;
          opacity: 0.32;
        }
        .carel-dot {
          width: 6px;
          height: 6px;
          border-radius: 9999px;
          background: #06b6d4;
          animation: carelDotBounce 0.9s infinite ease-in-out;
          box-shadow: 0 0 8px rgba(6, 182, 212, 0.7);
        }
        .carel-dot:nth-child(2) {
          animation-delay: 0.12s;
        }
        .carel-dot:nth-child(3) {
          animation-delay: 0.24s;
        }
        @keyframes carelDotBounce {
          0%,
          80%,
          100% {
            transform: translateY(0);
            opacity: 0.55;
          }
          40% {
            transform: translateY(-3px);
            opacity: 1;
          }
        }
      `}</style>
    </>
  )
}
