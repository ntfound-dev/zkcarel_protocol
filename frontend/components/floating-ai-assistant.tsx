"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { X, Minus, ChevronUp, ArrowUpRight, Zap, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  autoSubmitPrivacyAction,
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
  toHexFelt,
} from "@/lib/onchain-trade"

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
  1: "Hi! Level 1 is for chat and read-only queries. Try balance, points, or token prices.",
  2: "Hi! Level 2 is active for real swap/bridge/stake/claim/limit execution. Each execution asks wallet signature and burns 1 CAREL.",
  3: "Hi! Level 3 is active with Garaga/private mode and advanced analysis. Each execution asks wallet signature and burns 2 CAREL. Bridge is currently available on Level 2.",
}

const quickPromptsByTier: Record<number, string[]> = {
  1: ["check balance", "my points", "STRK price", "market info", "what can you do?"],
  2: [
    "swap STRK → WBTC",
    "bridge ETH → WBTC",
    "stake USDT",
    "claim rewards USDT",
    "limit order STRK/USDC",
    "cancel order",
  ],
  3: [
    "hide swap STRK → WBTC",
    "hide stake WBTC",
    "hide claim rewards",
    "switch to L2 for bridge",
    "rebalance portfolio",
    "price alert WBTC",
  ],
}

const featureListByTier: Record<number, string> = {
  1: "Features: chat, balance, points, token price, market info.",
  2: "Features: swap, bridge, stake, claim rewards, limit order, cancel order.",
  3: "Features: L2 features in Garaga mode (except bridge for now) + unstake, portfolio rebalance, price alerts, deep analysis.",
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
const BRIDGE_COMMAND_REGEX = /\b(bridge|brigde|jembatan)\b/i
const TIER2_ONCHAIN_COMMAND_REGEX =
  /\b(swap|bridge|brigde|stake|claim|limit(?:\s|-)?order|cancel\s+order)\b/i
const TIER3_ONCHAIN_COMMAND_REGEX =
  /\b(swap|bridge|brigde|stake|unstake|claim|limit(?:\s|-)?order|cancel\s+order|portfolio|rebalance|alert|price alert)\b/i
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
const AI_SETUP_SUBMIT_COOLDOWN_MS = 20_000
const AI_SETUP_PENDING_POLL_ATTEMPTS = 10
const AI_SETUP_PENDING_POLL_INTERVAL_MS = 1_200
const AI_SETUP_PRE_WALLET_DELAY_MS = readMsEnv(process.env.NEXT_PUBLIC_AI_SETUP_PRE_WALLET_DELAY_MS, 350)
const AI_SETUP_NONCE_RETRY_DELAY_MS = readMsEnv(
  process.env.NEXT_PUBLIC_AI_SETUP_NONCE_RETRY_DELAY_MS,
  1_500
)
const AI_EXECUTOR_PREFLIGHT_CACHE_MS = readMsEnv(
  process.env.NEXT_PUBLIC_AI_EXECUTOR_PREFLIGHT_CACHE_MS,
  90_000
)
const AI_REQUIRE_FRESH_SETUP_PER_EXECUTION =
  (process.env.NEXT_PUBLIC_AI_REQUIRE_FRESH_SETUP_PER_EXECUTION || "true").toLowerCase() !==
  "false"

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
  return /invalid user signature/i.test(message)
}

// Internal helper that supports `isStarknetEntrypointMissingError` operations.
function isStarknetEntrypointMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "")
  return /(requested entrypoint does not exist|entrypoint does not exist|entry point .* not found|entrypoint .* not found|entry_point_not_found)/i.test(
    message
  )
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
  return value.trim().toUpperCase()
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
function parseBridgeTokensFromCommand(command: string): { fromToken: string; toToken: string } | null {
  const normalized = normalizeMessageText(command).replace(/[,()]/g, " ")
  const patterns = [
    /\b(?:bridge|brigde|jembatan)\b\s+([a-z0-9]{2,12})\s+[0-9]+(?:\.[0-9]+)?\s*(?:to|ke|->|→)\s*([a-z0-9]{2,12})\b/i,
    /\b(?:bridge|brigde|jembatan)\b\s+([a-z0-9]{2,12})\s*(?:to|ke|->|→)\s*([a-z0-9]{2,12})\b/i,
  ]
  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    if (!match) continue
    const fromToken = (match[1] || "").trim().toUpperCase()
    const toToken = (match[2] || "").trim().toUpperCase()
    if (!fromToken || !toToken) continue
    return { fromToken, toToken }
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
    const wbtc = AI_TOKEN_ADDRESS_MAP.WBTC.trim()
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
    const wbtc = AI_TOKEN_ADDRESS_MAP.WBTC.trim()
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
  return /^(yes|y|ya|iya|yup|ok|oke|lanjut|proceed|confirm)$/i.test(value.trim())
}

// Internal helper that supports `isNegativeConfirmation` operations.
function isNegativeConfirmation(value: string): boolean {
  return /^(no|n|tidak|ga|gak|batal|cancel|stop)$/i.test(value.trim())
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
  const [messagesByTier, setMessagesByTier] = React.useState<Record<number, Message[]>>(
    defaultMessagesByTier
  )
  const [input, setInput] = React.useState("")
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
  const executorPreflightCacheRef = React.useRef<ExecutorPreflightCache>({
    ready: false,
    burnerRoleGranted: false,
    message: "",
    expiresAt: 0,
  })
  const parsedActionId = Number(actionId)
  const hasValidActionId = Number.isFinite(parsedActionId) && parsedActionId > 0
  const commandNeedsAction = requiresOnchainActionForCommand(selectedTier, input)
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

  const appendMessagesForTier = React.useCallback((tier: number, nextMessages: Message[]) => {
    if (!nextMessages.length) return
    setMessagesByTier((prev) => ({
      ...prev,
      [tier]: [...(prev[tier] || []), ...nextMessages],
    }))
  }, [])

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
      throw new Error(
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

      throw new Error("No valid on-chain setup found. Click Auto Setup On-Chain and confirm in wallet.")
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
            add("Portfolio check: no assets found yet on this account.")
          } else {
            const top = balance.balances
              .slice(0, 3)
              .map((item) => `${item.token} ${item.amount.toFixed(4)} (~$${item.value_usd.toFixed(2)})`)
              .join(", ")
            add(`Live portfolio: total ~$${balance.total_value_usd.toFixed(2)}. Top: ${top}.`)
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
            `Live points: ${points.total_points.toFixed(2)} points (epoch ${points.current_epoch}), estimated CAREL ${Number(points.estimated_reward_carel || 0).toFixed(6)}.`
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
            add(`Live ${token} price (1h): close ${Number(last.close).toFixed(6)}.`)
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
            add(`Active limit orders: ${list}. Tell me 'cancel order <id>' to target one.`)
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
    let command = normalizeMessageText(input)
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

    let actionIdValue: number | undefined
    const commandNeedsOnchainAction = requiresOnchainActionForCommand(activeTier, command)
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
      appendMessagesForTier(activeTier, [
        {
          role: "assistant",
          content:
            `You're about to execute this REAL on-chain command:\n${command}\n\nReply \`yes\` to continue or \`no\` to cancel.\nThis will request wallet signature and burn ${executionBurnAmountCarel(activeTier)} CAREL on-chain for this execution. If you have an active discount NFT, fee discount will be applied automatically.`,
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

    if (commandNeedsOnchainAction) {
      try {
        actionIdValue = await resolveActionId(true, {
          requireFresh: AI_REQUIRE_FRESH_SETUP_PER_EXECUTION,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to resolve on-chain action."
        notifications.addNotification({
          type: "error",
          title: "On-chain setup required",
          message,
        })
        appendMessagesForTier(activeTier, [
          {
            role: "assistant",
            content:
              "This command needs one on-chain setup signature first. Click Auto Setup On-Chain, confirm in wallet, then retry.",
            timestamp: nowTimestampLabel(),
          },
        ])
        return
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
          directExecutionMessage = normalizeMessageText(
            `✅ Swap executed: ${amountText} ${fromToken} -> ${swapResult.to_amount} ${toToken}. Tx: ${(finalTxHash || "").slice(0, 14)}...\n${pointsLine}\n${discountLine}${pendingLine ? `\n${pendingLine}` : ""}`
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
            if (bridgeResult.starknet_approval_transaction || bridgeResult.starknet_initiate_transaction) {
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
                } else {
                  throw finalizeError
                }
              }
            }
            const bridgeExplorerUrl = buildGardenOrderExplorerUrl(bridgeResult.bridge_id)
            const bridgeExplorerLinks = bridgeExplorerUrl
              ? [{ label: "Open Garden Explorer", url: bridgeExplorerUrl }]
              : undefined
            const shortBridgeId = bridgeResult.bridge_id.slice(0, 10)
            let btcDepositStateMessage = ""
            if (fromChain === "bitcoin" && bridgeResult.deposit_address) {
              const parsedAmountSats = Number.parseInt(String(bridgeResult.deposit_amount || "0"), 10)
              const amountSats =
                Number.isFinite(parsedAmountSats) && parsedAmountSats > 0 ? parsedAmountSats : 0
              const btcAmountDisplay =
                amountSats > 0 ? formatBtcFromSats(amountSats) : "required BTC amount"

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
                  await wallet.refreshOnchainBalances()
                  btcDepositStateMessage =
                    `\nBTC deposit submitted (${btcAmountDisplay}): ${btcDepositTxHash.slice(0, 12)}...`
                } catch (depositError) {
                  const detail =
                    depositError instanceof Error
                      ? depositError.message
                      : "Popup wallet canceled/failed."
                  notifications.addNotification({
                    type: "warning",
                    title: "BTC auto-send skipped",
                    message: `${detail} Send ${btcAmountDisplay} manually to ${bridgeResult.deposit_address}.`,
                  })
                  btcDepositStateMessage =
                    `\nBTC deposit not sent automatically. Send ${btcAmountDisplay} manually to ${bridgeResult.deposit_address}.`
                }
              } else if (!wallet.btcAddress) {
                notifications.addNotification({
                  type: "warning",
                  title: "BTC wallet not connected",
                  message: "Connect UniSat/Xverse first to send BTC deposit on-chain.",
                })
                btcDepositStateMessage =
                  `\nBTC wallet not connected. Send ${btcAmountDisplay} manually to ${bridgeResult.deposit_address}.`
              } else {
                btcDepositStateMessage =
                  `\nSend ${btcAmountDisplay} manually to ${bridgeResult.deposit_address}.`
              }
            }
            if (bridgeResult.deposit_address) {
              notifications.addNotification({
                type: "success",
                title: "Bridge order created",
                message: `Order ${shortBridgeId}... created for ${amountText} ${fromToken} -> ${toToken}.`,
                txExplorerUrls: bridgeExplorerLinks,
              })
              const explorerHint = bridgeExplorerUrl
                ? `\nTrack order: ${bridgeExplorerUrl}\nIf search is delayed, open the direct order link above.`
                : ""
              directExecutionMessage =
                `✅ Bridge order created: ${bridgeResult.bridge_id}. ` +
                `Send deposit to ${bridgeResult.deposit_address} to continue settlement.` +
                `${btcDepositStateMessage}${explorerHint}\n` +
                "If you have an active discount NFT, fee discount is applied automatically."
            } else {
              notifications.addNotification({
                type: "success",
                title: "Bridge submitted",
                message: `Bridge ${amountText} ${fromToken} -> ${toToken}. Order ${shortBridgeId}...`,
                txExplorerUrls: bridgeExplorerLinks,
              })
              const explorerHint = bridgeExplorerUrl
                ? `\nTrack order: ${bridgeExplorerUrl}`
                : ""
              directExecutionMessage =
                `✅ Bridge submitted: ${amountText} ${fromToken} -> ${toToken}. ` +
                `Order: ${bridgeResult.bridge_id}.` +
                `${explorerHint}\n` +
                "If you have an active discount NFT, fee discount is applied automatically."
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
          } else {
            const calls = buildStakeWalletCalls(token, amountText)
            notifications.addNotification({
              type: "info",
              title: "Wallet signature required",
              message: `Confirm stake ${amountText} ${token} in your wallet.`,
            })
            txHash = await invokeStarknetCallsFromWallet(calls, providerHint)
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
          directExecutionMessage = normalizeMessageText(
            `✅ Stake executed: ${amountText} ${token}. Tx: ${(finalStakeTx || "").slice(0, 14)}...`
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
        const candidate = tokenHint
          ? positions.find((item) => resolveStakeTokenSymbol(item.token) === tokenHint)
          : positions[0]
        if (!candidate) {
          directExecutionMessage = "No staking position found yet for claim rewards."
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
          directExecutionMessage = normalizeMessageText(
            `✅ Claim submitted for ${candidate.token}. Tx: ${(finalClaimTx || "").slice(0, 14)}...`
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
              if (!/requires onchain_tx_hash/i.test(message)) {
                throw error
              }
              if (HIDE_BALANCE_SHIELDED_POOL_V2) {
                throw new Error(
                  `Hide relayer unavailable. Wallet fallback is blocked in shielded_pool_v2 so limit-order details do not leak in explorer. Detail: ${message}`
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
          directExecutionMessage = normalizeMessageText(
            `✅ Limit order created: ${amountText} ${fromToken} -> ${toToken} at ${priceText} (${expiry}). Order: ${limitResult.order_id}.`
          )
          }
        }
      }
      const followUps = await buildActionFollowUps(response.actions || [], response.data)
      const cleanFollowUps = followUps
        .map((item) => normalizeMessageText(item.content))
        .filter((item) => item.length > 0)
      const fallbackAssistant =
        activeTier >= 2
          ? "Perintah diterima. Lanjutkan konfirmasi di wallet jika ini aksi on-chain."
          : "Perintah diterima."
      const baseAssistant = normalizeMessageText(response.response || "")
      const firstFollowUp = cleanFollowUps[0] || ""
      const prioritizeLive = (response.actions || []).some((action) =>
        LIVE_DATA_PRIORITY_ACTIONS.has(action)
      )
      const assistantContent = directExecutionMessage
        ? directExecutionMessage
        : firstFollowUp
        ? prioritizeLive
          ? firstFollowUp
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
      const message = error instanceof Error ? error.message : "AI request failed."
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
    if (selectedTier < 2) return null
    if (isCreatingAction) return null
    if (!staticCarelTokenAddress) {
      notifications.addNotification({
        type: "error",
        title: "CAREL token not configured",
        message:
          "NEXT_PUBLIC_TOKEN_CAREL_ADDRESS is missing. Set CAREL token contract address first.",
      })
      return null
    }
    let executorAddress = ""
    try {
      executorAddress = await ensureExecutorAddress()
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "AI executor not configured",
        message:
          error instanceof Error
            ? error.message
            : "AI executor is not configured. Please set backend/frontend executor address first.",
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

      const prepareResponse = await prepareAiAction({
        level: selectedTier,
        context: payload,
        window_seconds: 90,
      })
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
      const submitOnchainAction = async () => {
        const calls = AI_SETUP_SKIP_APPROVE
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
        return invokeStarknetCallsFromWallet(calls, providerHint)
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
        if (isInvalidUserSignatureError(firstError)) {
          // Retry once by refreshing the validity window.
          const retryPrepared = await prepareAiAction({
            level: selectedTier,
            context: payload,
            window_seconds: 90,
          })
          notifications.addNotification({
            type: "info",
            title: "Retrying with refreshed window",
            message: "Signature window refreshed. Confirm the transaction one more time.",
            txHash: retryPrepared.tx_hash,
            txNetwork: "starknet",
          })
          await waitMs(AI_SETUP_PRE_WALLET_DELAY_MS)
          onchainTxHash = await submitOnchainAction()
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
            return null
          }
          setActionId(String(fresh))
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
            return latest
          }
        } catch {
          // Ignore and surface the original rate-limit message below.
        }
      }
      const message = /caller is missing role/i.test(rawMessage)
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
        : /insufficient allowance/i.test(rawMessage)
          ? "Demo setup is skipping approve, but contract still requires allowance. Disable AI setup fee (fee_enabled=false) or disable NEXT_PUBLIC_AI_SETUP_SKIP_APPROVE."
        : rawMessage
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
            `✅ Upgrade complete. Level ${upgrade.current_level} is active now. Tx: ${upgrade.onchain_tx_hash.slice(0, 12)}...`
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
        onClick={() => setIsOpen(true)}
        className={cn(
          "fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full",
          "border border-[#06b6d455] bg-[radial-gradient(circle_at_30%_20%,#7c3aed_0%,#0a1423_55%,#080f1a_100%)]",
          "text-[#e2e8f0] transition duration-200 hover:scale-105",
          "shadow-[0_8px_26px_rgba(0,0,0,0.55),0_0_20px_rgba(6,182,212,0.35)]"
        )}
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
          "fixed bottom-4 right-4 z-50 overflow-hidden rounded-[20px] border border-[#1e293b]",
          "bg-[#080f1a] text-[#e2e8f0] transition-all duration-300",
          "shadow-[0_28px_60px_rgba(2,6,23,0.92),0_0_0_1px_rgba(6,182,212,0.22),0_0_26px_rgba(6,182,212,0.28)]",
          isMinimized
            ? "h-16 w-[460px] max-w-[calc(100vw-16px)]"
            : "h-[700px] w-[460px] max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)]"
        )}
      >
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top,#13233c_0%,transparent_55%)] opacity-90" />
        <div className="absolute inset-0 pointer-events-none carel-scanlines" />

        <div className="relative z-10 border-b border-[#1e293b] px-4 pt-3 pb-2 bg-[#0a1423cc]">
          <div className="flex items-center justify-between">
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
              <p className={cn(spaceMono.className, "mb-2 text-[10px] text-[#64748b]")}>
                {featureList}
              </p>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {quickPrompts.slice(0, 6).map((prompt) => (
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

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  placeholder="Ask anything..."
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
