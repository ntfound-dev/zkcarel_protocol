"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Bot, User, Send, Sparkles, Coins, X, Minus, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { executeAiCommand, getAiPendingActions } from "@/lib/api"
import { useNotifications } from "@/hooks/use-notifications"

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

interface Message {
  role: "user" | "assistant"
  content: string
}

export function FloatingAIAssistant() {
  const notifications = useNotifications()
  const [isOpen, setIsOpen] = React.useState(false)
  const [isMinimized, setIsMinimized] = React.useState(false)
  const [messages, setMessages] = React.useState<Message[]>(sampleMessages)
  const [input, setInput] = React.useState("")
  const [selectedTier, setSelectedTier] = React.useState(1)
  const [showTierPurchase, setShowTierPurchase] = React.useState(false)
  const [carelBalance, setCarelBalance] = React.useState(245)
  const [purchasedTiers, setPurchasedTiers] = React.useState<number[]>([1])
  const [isSending, setIsSending] = React.useState(false)
  const [actionId, setActionId] = React.useState("")
  const [pendingActions, setPendingActions] = React.useState<number[]>([])
  const [isLoadingActions, setIsLoadingActions] = React.useState(false)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  React.useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = async () => {
    const command = input.trim()
    if (!command) return

    setMessages((prev) => [...prev, { role: "user", content: command }])
    setInput("")
    setIsSending(true)

    let actionIdValue: number | undefined = undefined
    if (selectedTier >= 2) {
      const parsed = Number(actionId)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        notifications.addNotification({
          type: "error",
          title: "AI Tier requires action_id",
          message: "Masukkan action_id on-chain untuk Tier 2/3.",
        })
        setIsSending(false)
        return
      }
      actionIdValue = Math.floor(parsed)
    }

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

  const handlePurchaseTier = (tierId: number) => {
    const tier = aiTiers.find(t => t.id === tierId)
    if (!tier || purchasedTiers.includes(tierId)) return
    
    if (carelBalance >= tier.cost) {
      setCarelBalance(prev => prev - tier.cost)
      setPurchasedTiers(prev => [...prev, tierId])
      setSelectedTier(tierId)
      setShowTierPurchase(false)
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `Congratulations! You've unlocked Tier ${tierId}: ${tier.name}. I can now provide ${tier.description.toLowerCase()}.`
      }])
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
        <>
          {showTierPurchase ? (
            /* Tier Purchase View */
            <div className="flex flex-col h-[calc(100%-56px)]">
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                <h3 className="font-medium text-foreground mb-3">Upgrade AI Tier</h3>
                {aiTiers.map((tier) => {
                  const isPurchased = purchasedTiers.includes(tier.id)
                  const canAfford = carelBalance >= tier.cost
                  
                  return (
                    <button
                      key={tier.id}
                      onClick={() => !isPurchased && canAfford && handlePurchaseTier(tier.id)}
                      disabled={isPurchased || !canAfford}
                      className={cn(
                        "w-full p-3 rounded-xl text-left transition-all duration-300",
                        isPurchased
                          ? "bg-success/10 border border-success/50"
                          : selectedTier === tier.id
                          ? "bg-primary/10 border-2 border-primary"
                          : canAfford
                          ? "bg-surface/50 border border-border hover:border-primary/50"
                          : "bg-surface/30 border border-border opacity-50"
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={cn(
                          "font-medium text-sm",
                          isPurchased ? "text-success" : "text-foreground"
                        )}>
                          Tier {tier.id}: {tier.name}
                        </span>
                        {isPurchased ? (
                          <span className="text-xs text-success flex items-center gap-1">
                            <Sparkles className="h-3 w-3" /> Owned
                          </span>
                        ) : (
                          <span className={cn(
                            "text-xs font-medium",
                            tier.cost === 0 ? "text-success" : canAfford ? "text-secondary" : "text-destructive"
                          )}>
                            {tier.costLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{tier.description}</p>
                    </button>
                  )
                })}
                
                <div className="mt-4 p-3 rounded-xl bg-surface/50 border border-border">
                  <div className="flex items-center gap-2 mb-1">
                    <Coins className="h-4 w-4 text-primary" />
                    <span className="text-xs text-muted-foreground">Your Balance</span>
                  </div>
                  <p className="text-lg font-bold text-foreground">{carelBalance} CAREL</p>
                </div>
              </div>
              
              <div className="p-3 border-t border-border">
                <Button 
                  onClick={() => setShowTierPurchase(false)}
                  variant="outline"
                  className="w-full border-border text-foreground hover:bg-surface bg-transparent"
                >
                  Back to Chat
                </Button>
              </div>
            </div>
          ) : (
            /* Chat View */
            <div className="flex flex-col h-[calc(100%-56px)]">
              {/* Tier Selector */}
              <div className="p-2 border-b border-border">
                <div className="flex gap-1">
                  {aiTiers.map((tier) => {
                    const isPurchased = purchasedTiers.includes(tier.id)
                    return (
                      <button
                        key={tier.id}
                        onClick={() => isPurchased ? setSelectedTier(tier.id) : setShowTierPurchase(true)}
                        className={cn(
                          "flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all",
                          selectedTier === tier.id && isPurchased
                            ? "bg-primary/20 text-primary border border-primary/50"
                            : isPurchased
                            ? "bg-surface text-muted-foreground hover:text-foreground"
                            : "bg-surface/50 text-muted-foreground/50 border border-dashed border-border"
                        )}
                      >
                        {isPurchased ? tier.name : `${tier.costLabel}`}
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
                      <button
                        onClick={fetchPendingActions}
                        disabled={isLoadingActions}
                        className="text-[11px] text-primary hover:underline disabled:opacity-50"
                      >
                        {isLoadingActions ? "Loading..." : "Fetch pending action_id"}
                      </button>
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
                    className="flex-1 px-3 py-2 rounded-lg bg-surface border border-border text-foreground text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none transition-all"
                  />
                  <Button 
                    onClick={handleSend}
                    size="sm"
                    disabled={isSending}
                    className="bg-gradient-to-r from-primary to-accent hover:opacity-90 text-primary-foreground"
                  >
                    {isSending ? (
                      <span className="text-xs">...</span>
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
