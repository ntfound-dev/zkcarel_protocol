"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Bot, User, Send, X, Minus, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { executeAiCommand, getAiPendingActions, prepareAiAction, getAiRuntimeConfig } from "@/lib/api"
import { useNotifications } from "@/hooks/use-notifications"
import { useWallet } from "@/hooks/use-wallet"
import { invokeStarknetCallFromWallet, toHexFelt } from "@/lib/onchain-trade"

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
    cost: 1,
    costLabel: "1 CAREL",
    description: "Auto swap/bridge execution",
  },
  {
    id: 3,
    name: "Level 3",
    cost: 2,
    costLabel: "2 CAREL",
    description: "Portfolio management, alerts",
  },
]

const sampleMessages = [
  {
    role: "assistant" as const,
    content: "Hello! I'm your CAREL AI Assistant. How can I help you today?",
  },
]

const quickPromptsByTier: Record<number, string[]> = {
  1: [
    "check my balance",
    "how many points do I have?",
    "show STRK price",
    "beginner tutorial",
  ],
  2: [
    "swap 25 STRK to CAREL",
    "bridge 10 USDT to STRK",
    "check my balance",
    "beginner tutorial",
  ],
  3: [
    "rebalance my portfolio",
    "create price alerts for STRK",
    "check my balance",
    "beginner tutorial",
  ],
}

const STATIC_STARKNET_AI_EXECUTOR_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_AI_EXECUTOR_ADDRESS ||
  process.env.NEXT_PUBLIC_AI_EXECUTOR_ADDRESS ||
  ""

const AI_ACTION_TYPE_SWAP = 0
const AI_ACTION_TYPE_MULTI_STEP = 5

function encodeShortByteArray(value: string): Array<string | number> {
  const normalized = value.trim()
  const byteLen = new TextEncoder().encode(normalized).length
  if (byteLen === 0) return [0, 0, 0]
  if (byteLen > 31) {
    throw new Error("AI action payload is too long. Maximum 31 bytes.")
  }
  return [0, toHexFelt(normalized), byteLen]
}

function actionTypeForTier(tier: number): number {
  return tier >= 3 ? AI_ACTION_TYPE_MULTI_STEP : AI_ACTION_TYPE_SWAP
}

function isInvalidUserSignatureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "")
  return /invalid user signature/i.test(message)
}

function resolveStarknetProviderHint(provider: string | null): "starknet" | "argentx" | "braavos" {
  if (provider === "argentx" || provider === "braavos") return provider
  return "starknet"
}

function findNewPendingAction(after: number[], before: number[]): number | null {
  const beforeSet = new Set(before)
  for (const id of after) {
    if (!beforeSet.has(id)) return id
  }
  return after.length > 0 ? after[after.length - 1] : null
}

function pickLatestPendingAction(pending: number[]): number | null {
  if (pending.length === 0) return null
  return Math.max(...pending)
}

interface Message {
  role: "user" | "assistant"
  content: string
}

export function FloatingAIAssistant() {
  const notifications = useNotifications()
  const wallet = useWallet()
  const [isOpen, setIsOpen] = React.useState(false)
  const [isMinimized, setIsMinimized] = React.useState(false)
  const [messages, setMessages] = React.useState<Message[]>(sampleMessages)
  const [input, setInput] = React.useState("")
  const [selectedTier, setSelectedTier] = React.useState(1)
  const [isSending, setIsSending] = React.useState(false)
  const [actionId, setActionId] = React.useState("")
  const [pendingActions, setPendingActions] = React.useState<number[]>([])
  const [isLoadingActions, setIsLoadingActions] = React.useState(false)
  const [isCreatingAction, setIsCreatingAction] = React.useState(false)
  const [isAutoPreparingAction, setIsAutoPreparingAction] = React.useState(false)
  const [runtimeExecutorAddress, setRuntimeExecutorAddress] = React.useState("")
  const [isResolvingExecutor, setIsResolvingExecutor] = React.useState(false)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const requiresActionId = selectedTier >= 2
  const parsedActionId = Number(actionId)
  const hasValidActionId = !requiresActionId || (Number.isFinite(parsedActionId) && parsedActionId > 0)
  const quickPrompts = quickPromptsByTier[selectedTier] ?? quickPromptsByTier[1]
  const staticExecutorAddress = React.useMemo(
    () => STATIC_STARKNET_AI_EXECUTOR_ADDRESS.trim(),
    []
  )
  const effectiveExecutorAddress = React.useMemo(
    () => staticExecutorAddress || runtimeExecutorAddress.trim(),
    [staticExecutorAddress, runtimeExecutorAddress]
  )

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  React.useEffect(() => {
    scrollToBottom()
  }, [messages])

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
        title: "AI Actions",
        message: "No pending on-chain action found for this account.",
      })
    }
    return pending
  }

  const resolveActionId = async (): Promise<number> => {
    if (!requiresActionId) return 0
    if (hasValidActionId) return Math.floor(parsedActionId)

    setIsAutoPreparingAction(true)
    try {
      const pending = await loadPendingActions(true)
      const latest = pickLatestPendingAction(pending)
      if (latest && latest > 0) {
        setActionId(String(latest))
        notifications.addNotification({
          type: "success",
          title: "Action ready",
          message: `Using pending action_id ${latest}.`,
        })
        return latest
      }

      const created = await createOnchainActionId()
      if (created && created > 0) {
        return created
      }

      throw new Error(
        "No valid on-chain action_id found. Click 'Auto Setup On-Chain', sign once in wallet, then retry."
      )
    } finally {
      setIsAutoPreparingAction(false)
    }
  }

  const handleSend = async () => {
    const command = input.trim()
    if (!command || isSending) return

    let actionIdValue: number | undefined
    if (selectedTier >= 2) {
      try {
        actionIdValue = await resolveActionId()
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to resolve on-chain action."
        notifications.addNotification({
          type: "error",
          title: "AI Tier requires action_id",
          message,
        })
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `I need a valid on-chain action for Tier ${selectedTier}. Use Auto Setup On-Chain, sign in wallet, then send the command again.`,
          },
        ])
        return
      }
    }

    setMessages((prev) => [...prev, { role: "user", content: command }])
    setInput("")
    setIsSending(true)

    try {
      const response = await executeAiCommand({
        command,
        context: `tier:${selectedTier}`,
        level: selectedTier,
        action_id: actionIdValue,
      })
      setMessages((prev) => [...prev, { role: "assistant", content: response.response }])
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI request failed."
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `I couldn't execute that command: ${message}`,
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

  const fetchPendingActions = async () => {
    setIsLoadingActions(true)
    try {
      await loadPendingActions(false)
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "AI Actions",
        message: error instanceof Error ? error.message : "Failed to load pending actions.",
      })
    } finally {
      setIsLoadingActions(false)
    }
  }

  const createOnchainActionId = async (): Promise<number | null> => {
    if (!requiresActionId) return null
    if (isCreatingAction) return null
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
      const payload = `tier:${selectedTier}`
      const actionType = actionTypeForTier(selectedTier)
      const providerHint = resolveStarknetProviderHint(wallet.provider)

      const prepareResponse = await prepareAiAction({
        level: selectedTier,
        context: payload,
        window_seconds: 45,
      })
      notifications.addNotification({
        type: "info",
        title: "AI signature window prepared",
        message: `Window ${prepareResponse.from_timestamp}-${prepareResponse.to_timestamp} prepared.`,
        txHash: prepareResponse.tx_hash,
        txNetwork: "starknet",
      })

      await new Promise((resolve) => setTimeout(resolve, 2000))

      const submitOnchainAction = async () =>
        invokeStarknetCallFromWallet(
          {
            contractAddress: executorAddress,
            entrypoint: "submit_action",
            calldata: [actionType, ...encodeShortByteArray(payload), 0],
          },
          providerHint
        )

      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message: "Confirm submit_action transaction in your Starknet wallet.",
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
          window_seconds: 45,
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
        title: "AI action submitted",
        message: "Waiting for action_id to appear in pending list...",
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
              title: "Action ready",
              message: `action_id ${discovered} is ready for Tier ${selectedTier}.`,
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
          title: "Action ready",
          message: `Using latest pending action_id ${latest}.`,
          txHash: onchainTxHash,
          txNetwork: "starknet",
        })
        return latest
      }
      notifications.addNotification({
        type: "info",
        title: "Action not detected yet",
        message: "Click 'Fetch pending action_id' and select the newest ID.",
        txHash: onchainTxHash,
        txNetwork: "starknet",
      })
      return null
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Failed to submit on-chain action",
        message: error instanceof Error ? error.message : "submit_action transaction failed",
      })
      return null
    } finally {
      setIsCreatingAction(false)
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-r from-primary to-accent flex items-center justify-center shadow-lg hover:scale-105 transition-transform animate-pulse-glow"
      >
        <Bot className="h-6 w-6 text-primary-foreground" />
      </button>
    )
  }

  return (
    <div className={cn(
      "fixed bottom-6 right-6 z-50 glass-strong border border-primary/30 rounded-2xl shadow-xl transition-all duration-300 overflow-hidden",
      isMinimized ? "w-80 h-14" : "w-[94vw] max-w-[560px] h-[78vh] max-h-[760px]"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border bg-surface/50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-r from-primary to-accent flex items-center justify-center">
            <Bot className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">CAREL AI Assistant</p>
            <p className="text-xs text-muted-foreground">
              {aiTiers[selectedTier - 1].name} • {aiTiers[selectedTier - 1].costLabel}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1.5 rounded-lg hover:bg-surface text-muted-foreground hover:text-foreground transition-colors"
          >
            {isMinimized ? <ChevronUp className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-lg hover:bg-surface text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <div className="flex flex-col h-[calc(100%-56px)]">
              {/* Tier Selector */}
              <div className="p-2 border-b border-border">
                <div className="flex gap-1">
                  {aiTiers.map((tier) => {
                    return (
                      <button
                        key={tier.id}
                        onClick={() => setSelectedTier(tier.id)}
                        className={cn(
                          "flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all",
                          selectedTier === tier.id
                            ? "bg-primary/20 text-primary border border-primary/50"
                            : "bg-surface text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {tier.name}
                      </button>
                    )
                  })}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {aiTiers[selectedTier - 1].description}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Beginner mode: use quick prompts, then confirm only when wallet asks.
                </p>
                {selectedTier >= 2 && (
                  <div className="mt-2">
                    <label className="text-[11px] text-muted-foreground block mb-1">
                      Action ID (on-chain, required for Tier 2/3)
                    </label>
                    <input
                      type="number"
                      value={actionId}
                      onChange={(e) => setActionId(e.target.value)}
                      placeholder="Optional: leave empty and use Auto Setup"
                      className="w-full px-2 py-1.5 rounded-md bg-surface border border-border text-foreground text-xs placeholder:text-muted-foreground focus:border-primary focus:outline-none transition-all"
                      min={1}
                    />
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={async () => {
                            setIsAutoPreparingAction(true)
                            try {
                              const pending = await loadPendingActions(true)
                              const latest = pickLatestPendingAction(pending)
                              if (latest && latest > 0) {
                                setActionId(String(latest))
                                notifications.addNotification({
                                  type: "success",
                                  title: "Action ready",
                                  message: `Using pending action_id ${latest}.`,
                                })
                              } else {
                                const created = await createOnchainActionId()
                                if (!created) {
                                  notifications.addNotification({
                                    type: "info",
                                    title: "No action available",
                                    message:
                                      "No pending action found yet. Please sign one on-chain action first.",
                                  })
                                }
                              }
                            } finally {
                              setIsAutoPreparingAction(false)
                            }
                          }}
                          disabled={isCreatingAction || isLoadingActions || isAutoPreparingAction || isResolvingExecutor}
                          className="text-[11px] text-primary hover:underline disabled:opacity-50"
                        >
                          {isAutoPreparingAction ? "Preparing..." : "Auto Setup On-Chain"}
                        </button>
                        <button
                          onClick={fetchPendingActions}
                          disabled={isLoadingActions || isCreatingAction || isAutoPreparingAction || isResolvingExecutor}
                          className="text-[11px] text-primary hover:underline disabled:opacity-50"
                        >
                          {isLoadingActions ? "Loading..." : "Fetch pending action_id"}
                        </button>
                        <button
                          onClick={createOnchainActionId}
                          disabled={isCreatingAction || isLoadingActions || isAutoPreparingAction || isResolvingExecutor}
                          className="text-[11px] text-primary hover:underline disabled:opacity-50"
                        >
                          {isCreatingAction ? "Submitting..." : "Create on-chain action_id"}
                        </button>
                      </div>
                      {pendingActions.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          {pendingActions.length} pending
                        </span>
                      )}
                    </div>
                    {pendingActions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {pendingActions.map((id) => (
                          <button
                            key={id}
                            onClick={() => setActionId(String(id))}
                            className="px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary hover:bg-primary/20"
                          >
                            {id}
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {effectiveExecutorAddress
                        ? "Executor ready."
                        : isResolvingExecutor
                          ? "Resolving executor address..."
                          : "Executor address will be auto-resolved from backend config."}
                    </p>
                  </div>
                )}
                <div className="mt-2 rounded-md border border-border/60 bg-surface/40 p-2 text-[10px] text-muted-foreground leading-relaxed">
                  <p className="text-foreground font-medium mb-1">Beginner Tutorial</p>
                  <p>Level 1: Chat freely + ask read-only queries (price, balance, points, market).</p>
                  <p>Level 2: Click <span className="text-primary">Auto Setup On-Chain</span>, sign wallet once, then send swap/bridge command.</p>
                  <p>Level 3: Same setup as Level 2, then use portfolio/alert commands.</p>
                </div>
              </div>
              
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {quickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => setInput(prompt)}
                      className="px-2 py-1 rounded-full text-[10px] bg-surface border border-border text-muted-foreground hover:text-foreground"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
                {messages.map((message, index) => {
                  const isUser = message.role === "user"
                  return (
                    <div key={index} className={cn("flex gap-2", isUser && "flex-row-reverse")}>
                      <div className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs",
                        isUser 
                          ? "bg-primary/20 text-primary" 
                          : "bg-secondary/20 text-secondary"
                      )}>
                        {isUser ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                      </div>
                      <div className={cn(
                        "max-w-[80%] p-2.5 rounded-xl text-xs leading-relaxed",
                        isUser 
                          ? "bg-primary/10 border border-primary/30 text-foreground" 
                          : "glass border border-border text-foreground"
                      )}>
                        {message.content}
                      </div>
                    </div>
                  )
                })}
                <div ref={messagesEndRef} />
              </div>

          {/* Input */}
          <div className="p-3 border-t border-border">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Ask anything..."
                disabled={isSending || isResolvingExecutor}
                className="flex-1 px-3 py-2 rounded-lg bg-surface border border-border text-foreground text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none transition-all"
              />
              <Button 
                onClick={handleSend}
                size="sm"
                disabled={isSending || !input.trim() || isCreatingAction || isAutoPreparingAction || isResolvingExecutor}
                className="bg-gradient-to-r from-primary to-accent hover:opacity-90 text-primary-foreground"
              >
                {isSending ? (
                  <span className="text-xs">...</span>
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            {requiresActionId && !hasValidActionId && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                No worries: click "Auto Setup On-Chain". Action ID can be filled automatically.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
