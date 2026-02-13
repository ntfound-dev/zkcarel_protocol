"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Bot, User, Send, X, Minus, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { executeAiCommand, getAiPendingActions, prepareAiAction } from "@/lib/api"
import { useNotifications } from "@/hooks/use-notifications"
import { useWallet } from "@/hooks/use-wallet"
import { invokeStarknetCallFromWallet, toHexFelt } from "@/lib/onchain-trade"

const aiTiers = [
  { id: 1, name: "Basic", cost: 0, costLabel: "Free", description: "General assistance" },
  { id: 2, name: "Intermediate", cost: 10, costLabel: "10 CAREL", description: "Market analysis" },
  { id: 3, name: "Expert", cost: 50, costLabel: "50 CAREL", description: "Advanced strategies" },
]

const sampleMessages = [
  {
    role: "assistant" as const,
    content: "Hello! I'm your ZK AI Assistant. How can I help you today?",
  },
]

const quickPrompts = [
  "cek saldo saya",
  "point saya berapa",
  "swap 25 STRK to CAREL",
]

const STARKNET_AI_EXECUTOR_ADDRESS =
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
    throw new Error("AI action payload terlalu panjang. Maksimal 31 bytes.")
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
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const requiresActionId = selectedTier >= 2
  const parsedActionId = Number(actionId)
  const hasValidActionId = !requiresActionId || (Number.isFinite(parsedActionId) && parsedActionId > 0)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  React.useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = async () => {
    const command = input.trim()
    if (!command || isSending) return

    let actionIdValue: number | undefined = undefined
    if (selectedTier >= 2) {
      if (!hasValidActionId) {
        notifications.addNotification({
          type: "error",
          title: "AI Tier requires action_id",
          message: "Masukkan action_id on-chain untuk Tier 2/3.",
        })
        return
      }
      actionIdValue = Math.floor(parsedActionId)
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
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Maaf, AI sedang tidak tersedia. Coba lagi beberapa saat atau cek koneksi backend.",
        },
      ])
      notifications.addNotification({
        type: "error",
        title: "AI Assistant",
        message: error instanceof Error ? error.message : "Gagal memanggil AI",
      })
    } finally {
      setIsSending(false)
    }
  }

  const fetchPendingActions = async () => {
    setIsLoadingActions(true)
    try {
      const response = await getAiPendingActions(0, 10)
      setPendingActions(response.pending || [])
      if ((response.pending || []).length === 0) {
        notifications.addNotification({
          type: "info",
          title: "AI Actions",
          message: "Tidak ada pending action untuk akun ini.",
        })
      }
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "AI Actions",
        message: error instanceof Error ? error.message : "Gagal mengambil pending actions.",
      })
    } finally {
      setIsLoadingActions(false)
    }
  }

  const createOnchainActionId = async () => {
    if (!requiresActionId) return
    if (isCreatingAction) return
    if (!STARKNET_AI_EXECUTOR_ADDRESS) {
      notifications.addNotification({
        type: "error",
        title: "AI executor belum diisi",
        message:
          "Set NEXT_PUBLIC_STARKNET_AI_EXECUTOR_ADDRESS di frontend/.env.local lalu restart frontend.",
      })
      return
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
            contractAddress: STARKNET_AI_EXECUTOR_ADDRESS,
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
          message: "Signature window diperbarui. Konfirmasi transaksi sekali lagi.",
          txHash: retryPrepared.tx_hash,
          txNetwork: "starknet",
        })
        await new Promise((resolve) => setTimeout(resolve, 2000))
        onchainTxHash = await submitOnchainAction()
      }

      notifications.addNotification({
        type: "info",
        title: "AI action submitted",
        message: "Menunggu action_id muncul di pending list...",
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
              title: "action_id siap",
              message: `action_id ${discovered} sudah siap untuk Tier ${selectedTier}.`,
              txHash: onchainTxHash,
              txNetwork: "starknet",
            })
            return
          }
        } catch {
          // continue polling
        }
      }

      setPendingActions(latestPending)
      notifications.addNotification({
        type: "info",
        title: "action_id belum terbaca",
        message: "Klik Fetch pending action_id, lalu pilih ID terbaru.",
        txHash: onchainTxHash,
        txNetwork: "starknet",
      })
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Gagal submit action on-chain",
        message: error instanceof Error ? error.message : "Transaksi submit_action gagal",
      })
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
      isMinimized ? "w-72 h-14" : "w-80 sm:w-96 h-[500px]"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border bg-surface/50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-r from-primary to-accent flex items-center justify-center">
            <Bot className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">ZK AI Assistant</p>
            <p className="text-xs text-muted-foreground">Tier {selectedTier}: {aiTiers[selectedTier - 1].name}</p>
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
                {selectedTier >= 2 && (
                  <div className="mt-2">
                    <label className="text-[11px] text-muted-foreground block mb-1">
                      Action ID (on-chain, required for Tier 2/3)
                    </label>
                    <input
                      type="number"
                      value={actionId}
                      onChange={(e) => setActionId(e.target.value)}
                      placeholder="e.g. 12"
                      className="w-full px-2 py-1.5 rounded-md bg-surface border border-border text-foreground text-xs placeholder:text-muted-foreground focus:border-primary focus:outline-none transition-all"
                      min={1}
                    />
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={fetchPendingActions}
                          disabled={isLoadingActions || isCreatingAction}
                          className="text-[11px] text-primary hover:underline disabled:opacity-50"
                        >
                          {isLoadingActions ? "Loading..." : "Fetch pending action_id"}
                        </button>
                        <button
                          onClick={createOnchainActionId}
                          disabled={isCreatingAction || isLoadingActions}
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
                  </div>
                )}
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
                disabled={isSending}
                className="flex-1 px-3 py-2 rounded-lg bg-surface border border-border text-foreground text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none transition-all"
              />
              <Button 
                onClick={handleSend}
                size="sm"
                disabled={isSending || !input.trim() || !hasValidActionId}
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
                Tier 2/3 perlu action_id on-chain yang valid.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
