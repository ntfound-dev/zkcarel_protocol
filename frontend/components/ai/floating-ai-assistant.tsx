"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { X, Minus, ChevronUp, ArrowUpRight, Zap, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getAiLevel, upgradeAiLevel } from "@/lib/api"
import { decimalToU256Parts, invokeStarknetCallFromWallet } from "@/lib/onchain-trade"
import { useNotifications } from "@/hooks/notifications/use-notifications"
import { useWallet } from "@/hooks/wallet/use-wallet"
import { useAiExecution } from "@/hooks/ai/use-ai-execution"
import { useAiSetup } from "@/hooks/ai/use-ai-setup"
import { useDraggablePanel } from "@/hooks/ai/use-draggable-panel"
import {
  AI_HIDE_AUTO_EXECUTE_AFTER_COOLDOWN,
  AI_HIDE_MIN_NOTE_AGE_MS,
  AI_HIDE_USDT_TIER_OPTIONS,
  AI_REQUIRE_FRESH_SETUP_PER_EXECUTION,
  AI_TIERS,
  buildOptimisticExecutionPreview,
  buildTxExplorerUrl,
  executionBurnAmountCarel,
  incrementalTierUpgradeCost,
  inferHideTierFromPrivateCommand,
  normalizeAiCommandInput,
  normalizeMessageText,
  nowTimestampLabel,
  requiresOnchainActionForCommand,
  splitUrlWithTrailingPunctuation,
  STATIC_CAREL_TOKEN_ADDRESS,
} from "@/lib/ai-parser"

const dmSans = { className: "font-sans" }
const spaceMono = { className: "font-mono" }

const aiTiers = AI_TIERS

const tierGreetingMessage: Record<number, string> = {
  1: "Welcome to CAREL Agent (Level 1). I can help with read-only data: balance, points, token prices, and market info.",
  2: "Welcome to CAREL Agent (Level 2). I can execute live DeFi actions after wallet confirmation. Each execution burns 1 CAREL.",
  3: "Welcome to CAREL Agent (Level 3). I can run private Garaga-mode execution for swap, stake, and limit order. Each execution burns 2 CAREL. Bridge stays on Level 2. Private hide flow uses a 60s cooldown after note deposit.",
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
    "please stake 15 USDC",
    "please stake 10 USDT",
    "please stake 100 CAREL",
    "please stake 0.0005 WBTC",
    "please limit order STRK/USDT amount 10 at 1.25 expiry 1d",
    "please limit order STRK/USDC amount 10 at 1.25 expiry 3d",
    "please limit order CAREL/USDC amount 10 at 1.25 expiry 1d",
    "please limit order USDT/USDC amount 10 at 1.25 expiry 3d",
  ],
  3: [],
}
const l2BridgeShortcutPrompts = quickPromptsByTier[2].filter((prompt) => /\bbridge\b/i.test(prompt))

const featureListByTier: Record<number, string> = {
  1: "Available now: chat, balance check, points check, token price, and market summary.",
  2: "Available now: swap, bridge, stake, claim rewards, create limit order, and cancel order. Tap one example below to start.",
  3: "Available now: private swap, private stake, and private limit order. Hide tier ($5/$10/$50/$100/$250) controls private note size for swap, stake, and limit. Private note deposit uses a 60s cooldown before execution. Bridge stays on Level 2.",
}

const levelBadgeClasses: Record<number, string> = {
  1: "bg-[#334155] text-[#cbd5e1] border-[#475569]",
  2: "bg-[#7c3aed33] text-[#c4b5fd] border-[#7c3aed]",
  3: "bg-[#06b6d433] text-[#67e8f9] border-[#06b6d4]",
}

type Message = { role: "user" | "assistant"; content: string; timestamp: string }

const resolveStarknetProviderHint = (
  provider: string | null
): "starknet" | "argentx" | "braavos" => {
  if (provider === "argentx" || provider === "braavos") return provider
  return "starknet"
}

const renderMessageContentWithLinks = (content: string): React.ReactNode => {
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

const defaultMessagesByTier = (): Record<number, Message[]> => {
  const timestamp = nowTimestampLabel()
  return {
    1: [{ role: "assistant", content: tierGreetingMessage[1], timestamp }],
    2: [{ role: "assistant", content: tierGreetingMessage[2], timestamp }],
    3: [{ role: "assistant", content: tierGreetingMessage[3], timestamp }],
  }
}

export function FloatingAIAssistant() {
  const notifications = useNotifications()
  const wallet = useWallet()
  const [isOpen, setIsOpen] = React.useState(false)
  const [isMinimized, setIsMinimized] = React.useState(false)
  const [messagesByTier, setMessagesByTier] = React.useState<Record<number, Message[]>>(
    defaultMessagesByTier
  )
  const [input, setInput] = React.useState("")
  const [showPromptExamples, setShowPromptExamples] = React.useState(false)
  const [selectedTier, setSelectedTier] = React.useState(1)
  const [aiHideUsdtTierMin, setAiHideUsdtTierMin] = React.useState<number>(5)
  const [unlockedTier, setUnlockedTier] = React.useState(1)
  const [paymentAddress, setPaymentAddress] = React.useState("")
  const [isLoadingTier, setIsLoadingTier] = React.useState(false)
  const [isUpgradingTier, setIsUpgradingTier] = React.useState(false)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)

  const {
    bubbleStyle,
    panelStyle,
    isBubbleDragging,
    isPanelDragging,
    openAssistantNearBubble,
    bubbleHandlers,
    panelHandlers,
  } = useDraggablePanel({
    isMinimized,
    setIsMinimized,
    setIsOpen,
  })

  const normalizedInput = React.useMemo(() => normalizeAiCommandInput(input), [input])
  const commandNeedsAction = React.useMemo(
    () => requiresOnchainActionForCommand(selectedTier, normalizedInput),
    [normalizedInput, selectedTier]
  )
  const selectedAiHideTier = React.useMemo(
    () =>
      AI_HIDE_USDT_TIER_OPTIONS.find((option) => option.minUsdt === aiHideUsdtTierMin) ||
      AI_HIDE_USDT_TIER_OPTIONS[0],
    [aiHideUsdtTierMin]
  )
  const optimisticPreview = React.useMemo(
    () => buildOptimisticExecutionPreview(normalizedInput, selectedTier, selectedAiHideTier.minUsdt),
    [normalizedInput, selectedAiHideTier.minUsdt, selectedTier]
  )
  const canTogglePromptExamples = selectedTier >= 2
  const shouldShowPromptExamples = selectedTier === 1 || showPromptExamples
  const messages = messagesByTier[selectedTier] || []
  const quickPrompts = React.useMemo(() => {
    if (selectedTier !== 3) {
      return quickPromptsByTier[selectedTier] ?? quickPromptsByTier[1]
    }
    const activeTier = aiHideUsdtTierMin
    return [
      `please private swap CAREL to USDT with tier $${activeTier}`,
      `please private swap USDC to STRK with tier $${activeTier}`,
      `please private swap STRK to WBTC with tier $${activeTier}`,
      `please private stake ${activeTier} tier USDT`,
      `please private stake ${activeTier} tier USDC`,
      `please private stake ${activeTier} tier CAREL`,
      `please private stake ${activeTier} tier WBTC`,
      `please private limit order USDT/USDC amount ${activeTier} at 1.25 expiry 3d`,
      `please private limit order CAREL/USDC amount ${activeTier} at 1.25 expiry 1d`,
      `please private limit order USDC/STRK amount ${activeTier} at 0.85 expiry 3d`,
      `please private limit order WBTC/USDC amount ${activeTier} at 68000 expiry 1d`,
      `please private limit order tier ${activeTier} USDC/STRK at 0.85 expiry 3d`,
      `please private limit order ${activeTier} tier WBTC/USDC at 68000 expiry 1d`,
    ]
  }, [aiHideUsdtTierMin, selectedTier])
  const featureList = featureListByTier[selectedTier] ?? featureListByTier[1]

  React.useEffect(() => {
    setShowPromptExamples(selectedTier === 1)
  }, [selectedTier])

  React.useEffect(() => {
    if (selectedTier !== 3) return
    const inferredHideTier = inferHideTierFromPrivateCommand(normalizedInput)
    if (inferredHideTier && inferredHideTier !== aiHideUsdtTierMin) {
      setAiHideUsdtTierMin(inferredHideTier)
    }
  }, [aiHideUsdtTierMin, normalizedInput, selectedTier])

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

  const appendMessagesForTier = React.useCallback((tier: number, nextMessages: Message[]) => {
    if (!nextMessages.length) return
    setMessagesByTier((prev) => ({
      ...prev,
      [tier]: [...(prev[tier] || []), ...nextMessages],
    }))
  }, [])

  const {
    setActionId,
    planId,
    hasPlanReady,
    aiPlanEnabled,
    setPendingActions,
    isResolvingExecutor,
    isBackgroundPreparingAction,
    hasPreparedActionReady,
    hasSetupReady,
    isSetupProcessing,
    isExecuteButtonBlockedByPrepare,
    getLastBurnTxHash,
    resolveActionId,
    handleAutoSetup,
  } = useAiSetup({
    isOpen,
    selectedTier,
    normalizedInput,
    commandNeedsAction,
    appendMessagesForTier,
  })

  const { handleSend, isSending } = useAiExecution({
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
  })

  const isWidgetBusy = isSetupProcessing || isUpgradingTier || isLoadingTier

  const scrollToBottom = React.useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  React.useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

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

  const staticCarelTokenAddress = React.useMemo(() => STATIC_CAREL_TOKEN_ADDRESS.trim(), [])
  const effectivePaymentAddress = React.useMemo(() => paymentAddress.trim(), [paymentAddress])

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
        {...bubbleHandlers}
        className={cn(
          "fixed z-50 flex h-14 w-14 items-center justify-center rounded-full",
          "border border-[#06b6d455] bg-[radial-gradient(circle_at_30%_20%,#7c3aed_0%,#0a1423_55%,#080f1a_100%)]",
          "text-[#e2e8f0] transition duration-200 hover:scale-105",
          isBubbleDragging ? "cursor-grabbing" : "cursor-grab",
          "shadow-[0_8px_26px_rgba(0,0,0,0.55),0_0_20px_rgba(6,182,212,0.35)]"
        )}
        style={bubbleStyle}
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
        style={panelStyle}
      >
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top,#13233c_0%,transparent_55%)] opacity-90" />
        <div className="absolute inset-0 pointer-events-none carel-scanlines" />

        <div className="relative z-10 border-b border-[#1e293b] px-4 pt-3 pb-2 bg-[#0a1423cc]">
          <div
            className={cn(
              "flex items-center justify-between select-none",
              isPanelDragging ? "cursor-grabbing" : "cursor-grab"
            )}
            {...panelHandlers}
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
                <p className="text-[11px] text-[#475569]">
                  {aiTiers[selectedTier - 1]?.description || ""}
                </p>
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
                        {aiPlanEnabled
                          ? "Approve Plan + Set Allowance"
                          : AI_REQUIRE_FRESH_SETUP_PER_EXECUTION
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
                        aiPlanEnabled
                          ? "Approve Plan"
                          : AI_REQUIRE_FRESH_SETUP_PER_EXECUTION
                            ? "Sign Execution Setup"
                            : "Auto Setup On-Chain"
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-xl border border-[#14532d] bg-[#052315] px-3 py-2 text-xs text-[#86efac]">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className={spaceMono.className}>
                      {aiPlanEnabled ? "Plan Active" : "Executor Ready"}
                    </span>
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

              {selectedTier >= 3 && (
                <div className="mb-2 rounded-xl border border-[#1f3a5a] bg-[#0b1828] px-3 py-2">
                  <p className={cn(spaceMono.className, "text-[10px] font-semibold text-[#67e8f9]")}>
                    L3 Hide Tier (USDT)
                  </p>
                  <div className="mt-1 grid grid-cols-5 gap-1.5">
                    {AI_HIDE_USDT_TIER_OPTIONS.map((option) => {
                      const isActive = option.minUsdt === selectedAiHideTier.minUsdt
                      return (
                        <button
                          key={option.minUsdt}
                          type="button"
                          onClick={() => setAiHideUsdtTierMin(option.minUsdt)}
                          className={cn(
                            spaceMono.className,
                            "rounded-md border px-1 py-1 text-[10px] transition",
                            isActive
                              ? "border-[#06b6d4] bg-[#083344] text-[#cffafe]"
                              : "border-[#334155] bg-[#0b1729] text-[#94a3b8] hover:border-[#06b6d4]"
                          )}
                        >
                          ${option.minUsdt}
                        </button>
                      )
                    })}
                  </div>
                  <p className={cn(spaceMono.className, "mt-1 text-[10px] text-[#94a3b8]")}>
                    Bonus tier: +{selectedAiHideTier.bonusPercent}% points
                  </p>
                  <p className={cn(spaceMono.className, "text-[10px] text-[#64748b]")}>
                    USDT/USDC/CAREL follow the tier directly. STRK/WBTC use an approximate token amount.
                  </p>
                  <p className={cn(spaceMono.className, "text-[10px] text-[#64748b]")}>
                    Cooldown: {Math.floor(AI_HIDE_MIN_NOTE_AGE_MS / 1000)}s
                    {AI_HIDE_AUTO_EXECUTE_AFTER_COOLDOWN
                      ? " (auto private execution after cooldown)"
                      : " (manual retry after cooldown)"}
                  </p>
                </div>
              )}

              {optimisticPreview && (
                <div className="mb-2 rounded-xl border border-[#1f3a5a] bg-[#0b1828] px-3 py-2">
                  <div className="flex items-center justify-between">
                    <p className={cn(spaceMono.className, "text-[10px] font-semibold text-[#67e8f9]")}>
                      {optimisticPreview.title}
                    </p>
                    <p className={cn(spaceMono.className, "text-[10px] text-[#94a3b8]")}>
                      Fee {executionBurnAmountCarel(selectedTier)} CAREL
                    </p>
                  </div>
                  <p className={cn(spaceMono.className, "mt-1 text-[10px] text-[#cbd5e1]")}>
                    {optimisticPreview.fromToken} {"->"} {optimisticPreview.toToken}
                  </p>
                  <p className={cn(spaceMono.className, "text-[10px] text-[#94a3b8]")}>
                    Est. amount: {optimisticPreview.amountText}
                  </p>
                  <p className={cn(spaceMono.className, "text-[10px] text-[#94a3b8]")}>
                    Est. points: {optimisticPreview.estimatedPoints}
                  </p>
                  <p className={cn(spaceMono.className, "mt-1 text-[10px] text-[#67e8f9]")}>
                    {isBackgroundPreparingAction && !hasPreparedActionReady
                      ? "Preparing execution setup in background..."
                      : hasPreparedActionReady
                        ? "Execution setup prebuilt. Execute is ready."
                        : "Execution setup will auto-prepare when needed."}
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void handleSend()}
                  placeholder="Type command or tap example..."
                  disabled={isSending || isResolvingExecutor || isUpgradingTier || isLoadingTier}
                  className={cn(
                    "h-10 flex-1 rounded-xl border border-[#334155] bg-[#0b1729] px-3 text-sm text-[#e2e8f0]",
                    "placeholder:text-[#475569] outline-none transition focus:border-[#06b6d4] focus:ring-2 focus:ring-[#06b6d433]"
                  )}
                />
                <Button
                  onClick={() => void handleSend()}
                  size="sm"
                  disabled={isSending || !input.trim() || isWidgetBusy || isExecuteButtonBlockedByPrepare}
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
              ) : isExecuteButtonBlockedByPrepare ? (
                <p className={cn(spaceMono.className, "mt-1 text-[10px] text-[#475569]")}>
                  Preparing execution setup in background...
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
