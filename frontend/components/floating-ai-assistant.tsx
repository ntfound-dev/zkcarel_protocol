"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { X, Minus, ChevronUp, ArrowUpRight, Zap, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DM_Sans, Space_Mono } from "next/font/google"
import {
  executeAiCommand,
  getAiPendingActions,
  prepareAiAction,
  getAiRuntimeConfig,
  ensureAiExecutorReady,
  getAiLevel,
  upgradeAiLevel,
  getBridgeQuote,
  getPortfolioAnalytics,
  getPortfolioBalance,
  getRewardsPoints,
  getStakePools,
  getStakePositions,
  getSwapQuote,
  getTokenOHLCV,
  listLimitOrders,
} from "@/lib/api"
import { useNotifications } from "@/hooks/use-notifications"
import { useWallet } from "@/hooks/use-wallet"
import {
  decimalToU256Parts,
  invokeStarknetCallFromWallet,
  invokeStarknetCallsFromWallet,
  toHexFelt,
} from "@/lib/onchain-trade"

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
})

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
})

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
    description: "Auto swap/bridge/stake/limit execution",
  },
  {
    id: 3,
    name: "Level 3",
    cost: 10,
    costLabel: "10 CAREL",
    description: "Advanced execution, portfolio, alerts",
  },
]

const tierGreetingMessage: Record<number, string> = {
  1: "Hai! Level 1 untuk chat + query read-only. Mau cek saldo, poin, atau harga token?",
  2: "Hai! Level 2 aktif untuk eksekusi real swap/bridge/stake/limit setelah setup on-chain.",
  3: "Hai! Level 3 aktif penuh untuk eksekusi real + unstake/claim/portfolio/alerts.",
}

const quickPromptsByTier: Record<number, string[]> = {
  1: ["check balance", "STRK price", "my points"],
  2: ["swap STRK → WBTC", "stake USDT", "limit order"],
  3: ["rebalance portfolio", "claim rewards", "price alert"],
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

const AI_ACTION_TYPE_SWAP = 0
const AI_ACTION_TYPE_MULTI_STEP = 5
const TIER2_ONCHAIN_COMMAND_REGEX =
  /\b(swap|bridge|stake|limit(?:\s|-)?order|cancel\s+order)\b/i
const TIER3_ONCHAIN_COMMAND_REGEX =
  /\b(swap|bridge|stake|unstake|claim|limit(?:\s|-)?order|cancel\s+order|portfolio|rebalance|alert|price alert)\b/i
const LIVE_DATA_PRIORITY_ACTIONS = new Set([
  "get_swap_quote",
  "get_bridge_quote",
  "show_balance",
  "show_points_breakdown",
  "show_chart",
])

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
  // Keep allowance limited to expected setup fee budget per tier.
  if (tier >= 3) return 10
  return 5
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
    return "Backend belum terhubung. Jalankan `cd backend-rust && cargo run` dan pastikan `NEXT_PUBLIC_BACKEND_URL` mengarah ke backend (default: http://localhost:8080)."
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
  for (const id of after) {
    if (!beforeSet.has(id)) return id
  }
  return after.length > 0 ? after[after.length - 1] : null
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

interface Message {
  role: "user" | "assistant"
  content: string
  timestamp: string
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

// Internal helper that supports `bridgeTargetChainForToken` operations.
function bridgeTargetChainForToken(token: string): string {
  const normalized = token.toUpperCase()
  if (normalized === "BTC") return "bitcoin"
  if (normalized === "WBTC") return "starknet"
  if (normalized === "ETH" || normalized === "WETH") return "ethereum"
  return "starknet"
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
  const [actionId, setActionId] = React.useState("")
  const [pendingActions, setPendingActions] = React.useState<number[]>([])
  const [isCreatingAction, setIsCreatingAction] = React.useState(false)
  const [isAutoPreparingAction, setIsAutoPreparingAction] = React.useState(false)
  const [runtimeExecutorAddress, setRuntimeExecutorAddress] = React.useState("")
  const [isResolvingExecutor, setIsResolvingExecutor] = React.useState(false)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const parsedActionId = Number(actionId)
  const hasValidActionId = Number.isFinite(parsedActionId) && parsedActionId > 0
  const commandNeedsAction = requiresOnchainActionForCommand(selectedTier, input)
  const messages = messagesByTier[selectedTier] || []
  const quickPrompts = quickPromptsByTier[selectedTier] ?? quickPromptsByTier[1]
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
    if (effectiveExecutorAddress) return effectiveExecutorAddress
    setIsResolvingExecutor(true)
    try {
      const runtimeConfig = await getAiRuntimeConfig()
      const resolved = (runtimeConfig.executor_address || "").trim()
      if (!runtimeConfig.executor_configured || !resolved) {
        throw new Error(
          "AI executor is not configured yet. Set AI_EXECUTOR_ADDRESS in backend env, or NEXT_PUBLIC_STARKNET_AI_EXECUTOR_ADDRESS in frontend env, then restart services."
        )
      }
      setRuntimeExecutorAddress(resolved)
      return resolved
    } finally {
      setIsResolvingExecutor(false)
    }
  }, [effectiveExecutorAddress])

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

  const resolveActionId = async (requiredForCommand: boolean): Promise<number> => {
    if (!requiredForCommand) return 0
    if (hasValidActionId) return Math.floor(parsedActionId)

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

      const created = await createOnchainActionId()
      if (created && created > 0) {
        return created
      }

      throw new Error(
        "No valid on-chain setup found. Click 'Auto Setup On-Chain', sign once in wallet, then retry."
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
    const command = normalizeMessageText(input)
    if (!command || isSending || isUpgradingTier || isLoadingTier) return
    const activeTier = selectedTier
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

    let actionIdValue: number | undefined
    const commandNeedsOnchainAction = requiresOnchainActionForCommand(activeTier, command)
    if (commandNeedsOnchainAction) {
      try {
        actionIdValue = await resolveActionId(true)
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

    appendMessagesForTier(activeTier, [
      {
        role: "user",
        content: command,
        timestamp: nowTimestampLabel(),
      },
    ])
    setInput("")
    setIsSending(true)

    try {
      const response = await executeAiCommand({
        command,
        context: `tier:${activeTier}`,
        level: activeTier,
        action_id: commandNeedsOnchainAction ? actionIdValue : undefined,
      })
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
      const assistantContent = firstFollowUp
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
      if (commandNeedsOnchainAction && /\b(swap|bridge|tukar|jembatan)\b/i.test(command)) {
        if (typeof actionIdValue === "number" && actionIdValue > 0) {
          setPendingActions((prev) => prev.filter((id) => id !== actionIdValue))
        }
        setActionId("")
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI request failed."
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

  const createOnchainActionId = async (): Promise<number | null> => {
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
    try {
      const before = await getAiPendingActions(0, 50)
      pendingBefore = before.pending || []
    } catch {
      pendingBefore = []
    }

    try {
      const preflight = await ensureAiExecutorReady()
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

      await new Promise((resolve) => setTimeout(resolve, 2000))

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

      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message: AI_SETUP_SKIP_APPROVE
          ? "Confirm submit_action transaction in your Starknet wallet."
          : `Confirm limited CAREL approval (${approveAmountCarel}) + submit_action transaction in your Starknet wallet.`,
      })
      let onchainTxHash: string
      try {
        onchainTxHash = await submitOnchainAction()
      } catch (firstError) {
        if (!isInvalidUserSignatureError(firstError)) {
          throw firstError
        }
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
        await new Promise((resolve) => setTimeout(resolve, 2000))
        onchainTxHash = await submitOnchainAction()
      }

      notifications.addNotification({
        type: "info",
        title: "On-chain setup submitted",
        message: "Waiting for setup to appear in pending list...",
        txHash: onchainTxHash,
        txNetwork: "starknet",
      })

      let latestPending: number[] = pendingBefore
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        try {
          const after = await getAiPendingActions(0, 50)
          latestPending = after.pending || []
          const discovered = findNewPendingAction(latestPending, pendingBefore)
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
      const message = /caller is missing role/i.test(rawMessage)
        ? "CAREL token belum grant BURNER_ROLE ke AI executor. Jalankan Auto Setup lagi setelah backend preflight selesai."
        : /insufficient allowance/i.test(rawMessage)
          ? "Setup demo tanpa approve aktif, tapi contract masih minta allowance. Nonaktifkan fee setup AI (fee_enabled=false) atau matikan NEXT_PUBLIC_AI_SETUP_SKIP_APPROVE."
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
  const hasSetupReady = hasValidActionId || pendingActions.length > 0

  const handleAutoSetup = async () => {
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
        return
      }
      const created = await createOnchainActionId()
      if (!created) {
        notifications.addNotification({
          type: "info",
          title: "Setup pending",
          message: "No pending action found yet. Please sign one on-chain action first.",
        })
      }
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
                      <span>One-time on-chain setup needed</span>
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
                        "Auto Setup On-Chain"
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
                            "rounded-xl border px-3 py-2 text-[13px] leading-relaxed",
                            isUser
                              ? "border-[#06b6d4aa] bg-[#06b6d415] text-[#dff9ff]"
                              : "border-l-2 border-l-[#7c3aed] border-r border-y border-[#243247] bg-[#0d1b2e] text-[#e2e8f0]"
                          )}
                        >
                          {message.content}
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
              <div className="mb-2 flex flex-wrap gap-1.5">
                {quickPrompts.slice(0, 3).map((prompt) => (
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
                  🔒 This action needs Auto Setup On-Chain first.
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
