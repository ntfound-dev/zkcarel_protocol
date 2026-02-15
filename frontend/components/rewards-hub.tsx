"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Gift, Diamond, Trophy, Sparkles, ArrowRight, Check, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWallet } from "@/hooks/use-wallet"
import { useNotifications } from "@/hooks/use-notifications"
import { claimRewards, convertRewards, getOwnedNfts, getPortfolioAnalytics, getRewardsPoints, mintNft, syncRewardsPointsOnchain, verifySocialTask, type NFTItem } from "@/lib/api"
import { invokeStarknetCallFromWallet } from "@/lib/onchain-trade"

const tierDefinitions = [
  { 
    tierId: 1,
    name: "Bronze", 
    points: 5000, 
    discount: "5%", 
    color: "from-amber-600 to-amber-800",
    borderColor: "border-amber-600",
  },
  { 
    tierId: 2,
    name: "Silver", 
    points: 15000, 
    discount: "10%", 
    color: "from-gray-300 to-gray-500",
    borderColor: "border-gray-400",
  },
  { 
    tierId: 3,
    name: "Gold", 
    points: 50000, 
    discount: "25%", 
    color: "from-yellow-400 to-yellow-600",
    borderColor: "border-yellow-500",
  },
  { 
    tierId: 4,
    name: "Platinum", 
    points: 150000, 
    discount: "35%", 
    color: "from-cyan-300 to-cyan-500",
    borderColor: "border-cyan-400",
  },
  { 
    tierId: 5,
    name: "Onyx", 
    points: 500000, 
    discount: "50%", 
    color: "from-purple-900 to-black",
    borderColor: "border-purple-600",
  },
]

const nftTiers = [
  {
    tierId: 0,
    tier: "None",
    name: "No NFT",
    image: "/nft/none-tier-animated.svg",
    fallbackImage: "/nft/none-tier.png",
    discount: "0%",
    uses: 0,
    maxUses: 0,
    rechargeCost: 0,
    cost: 0,
    gradient: "from-muted to-muted-foreground",
    description: "No discount benefits",
  },
  {
    tierId: 1,
    tier: "Bronze",
    name: "Cyberpunk Shield NFT",
    image: "/nft/bronze-shield-animated.svg",
    fallbackImage: "/nft/bronze-shield.png",
    discount: "5%",
    uses: 5,
    maxUses: 5,
    rechargeCost: 0,
    cost: 5000,
    gradient: "from-amber-600 to-amber-800",
    description: "5% fee discount on all transactions",
  },
  {
    tierId: 2,
    tier: "Silver",
    name: "Cyberpunk Blade NFT",
    image: "/nft/silver-blade-animated.svg",
    fallbackImage: "/nft/silver-blade.png",
    discount: "10%",
    uses: 7,
    maxUses: 7,
    rechargeCost: 0,
    cost: 15000,
    gradient: "from-gray-300 to-gray-500",
    description: "10% fee discount on all transactions",
  },
  {
    tierId: 3,
    tier: "Gold",
    name: "Cyberpunk Blade NFT",
    image: "/nft/gold-blade-animated.svg",
    fallbackImage: "/nft/gold-blade.png",
    discount: "25%",
    uses: 10,
    maxUses: 10,
    rechargeCost: 0,
    cost: 50000,
    gradient: "from-yellow-400 to-yellow-600",
    description: "25% fee discount on all transactions",
  },
  {
    tierId: 4,
    tier: "Platinum",
    name: "Cyberpunk Blade NFT",
    image: "/nft/platinum-blade-animated.svg",
    fallbackImage: "/nft/platinum-blade.png",
    discount: "35%",
    uses: 15,
    maxUses: 15,
    rechargeCost: 0,
    cost: 150000,
    gradient: "from-cyan-300 to-cyan-500",
    description: "35% fee discount on all transactions",
  },
  {
    tierId: 5,
    tier: "Onyx",
    name: "Cyberpunk Blade NFT",
    image: "/nft/onyx-blade-animated.svg",
    fallbackImage: "/nft/onyx-blade.png",
    discount: "50%",
    uses: 20,
    maxUses: 20,
    rechargeCost: 0,
    cost: 500000,
    gradient: "from-purple-900 to-black",
    description: "50% fee discount on all transactions",
  },
]

const socialTasks = [
  {
    id: "twitter_follow",
    title: "Follow ZkCarel on X",
    description: "Follow @zkcarel and paste your profile link or handle.",
    placeholder: "https://x.com/your_handle",
  },
  {
    id: "twitter_retweet",
    title: "Retweet Announcement",
    description: "Retweet the latest announcement and paste the tweet URL.",
    placeholder: "https://x.com/zkcarel/status/...",
  },
  {
    id: "telegram_join",
    title: "Join Telegram",
    description: "Join our Telegram community and paste your username.",
    placeholder: "@username",
  },
  {
    id: "discord_join",
    title: "Join Discord",
    description: "Join our Discord server and paste your Discord tag.",
    placeholder: "username#1234",
  },
]

type TierInfo = typeof tierDefinitions[number] & { achieved: boolean }

const MONTHLY_POOL_CAREL = (1_000_000_000 * 0.4) / 36
const STARKNET_DISCOUNT_SOULBOUND_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_DISCOUNT_SOULBOUND_ADDRESS ||
  process.env.NEXT_PUBLIC_DISCOUNT_SOULBOUND_ADDRESS ||
  ""

function TierProgressBar({
  currentPoints,
  currentTierId,
  tiers,
}: {
  currentPoints: number
  currentTierId: number
  tiers: TierInfo[]
}) {
  if (tiers.length === 0) {
    return null
  }

  const activeTierIndex = tiers.findIndex((tier) => tier.tierId === currentTierId)
  const hasActiveTier = activeTierIndex >= 0
  const safeCurrentTierIndex = hasActiveTier ? activeTierIndex : 0
  const currentTier = hasActiveTier ? tiers[safeCurrentTierIndex] : null
  const nextTier = hasActiveTier ? tiers[safeCurrentTierIndex + 1] : tiers[0]
  const isMaxTier = hasActiveTier && !nextTier
  const targetName = nextTier?.name ?? "Max Tier"
  const targetPoints = nextTier?.points ?? currentPoints
  const remainingPoints = Math.max(0, targetPoints - currentPoints)
  const targetDiscount = nextTier?.discount ?? currentTier?.discount ?? "0%"
  const hasReachedMintRequirement = !hasActiveTier && Boolean(nextTier) && currentPoints >= (nextTier?.points ?? 0)
  const tierSpan = Math.max(1, tiers.length - 1)
  const progressInCurrentTier = nextTier
    ? Math.min(100, Math.max(0, (currentPoints / nextTier.points) * 100))
    : 100
  // Top timeline follows active NFT tier only (not point simulation).
  const progressWidth = hasActiveTier ? (safeCurrentTierIndex / tierSpan) * 100 : 0
  const currentTierLabel = currentTier?.name ?? "None"
  const actionLabel = hasActiveTier ? "upgrade" : "mint"
  const highlightedTierIndex = hasActiveTier ? safeCurrentTierIndex : -1

  return (
    <div className="p-6 rounded-2xl glass border border-border">
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="h-5 w-5 text-primary" />
        <span className="font-medium text-foreground">Tier Progression</span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Tier aktif mengikuti NFT discount on-chain. Points hanya untuk unlock/mint tier berikutnya.
      </p>

      {/* Tier Progress Line */}
      <div className="relative mt-8 mb-12">
        {/* Background line */}
        <div className="absolute top-1/2 left-0 right-0 h-1 bg-surface -translate-y-1/2 rounded-full" />
        
        {/* Progress line */}
        <div 
          className="absolute top-1/2 left-0 h-1 bg-gradient-to-r from-primary to-secondary -translate-y-1/2 rounded-full transition-all duration-500"
          style={{ width: `${progressWidth}%` }}
        />
        
        {/* Tier markers */}
        <div className="relative flex justify-between">
          {tiers.map((tier, index) => (
            <div key={tier.name} className="flex flex-col items-center">
              <div className={cn(
                "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                tier.achieved 
                  ? `bg-gradient-to-br ${tier.color} border-transparent` 
                  : "bg-surface border-border"
              )}>
                {tier.achieved && <Check className="h-3 w-3 text-white" />}
              </div>
              <span className={cn(
                "text-xs mt-2 font-medium",
                index === highlightedTierIndex
                  ? "text-primary"
                  : tier.achieved
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}>
                {tier.name}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Current Status */}
      <div className="p-4 rounded-xl bg-surface/50 border border-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm text-muted-foreground">Current Tier</p>
            <p className="text-xl font-bold text-foreground">{currentTierLabel}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Progress to {targetName}</p>
            <p className="text-xl font-bold text-primary">{currentPoints.toLocaleString()} / {targetPoints.toLocaleString()}</p>
          </div>
        </div>
        <div className="h-3 rounded-full bg-surface overflow-hidden">
          <div 
            className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all duration-500"
            style={{ width: `${progressInCurrentTier}%` }}
          />
        </div>
        {isMaxTier ? (
          <p className="text-sm text-muted-foreground mt-2">
            You are at the highest tier ({targetDiscount} discount).
          </p>
        ) : hasReachedMintRequirement ? (
          <p className="text-sm text-muted-foreground mt-2">
            Points requirement met. Mint {targetName} NFT to activate tier ({targetDiscount} discount).
          </p>
        ) : (
          <p className="text-sm text-muted-foreground mt-2">
            Need {remainingPoints.toLocaleString()} more points to {actionLabel} {targetName} ({targetDiscount} discount)
          </p>
        )}
      </div>
    </div>
  )
}

function NFTCard({ 
  nft, 
  isOwned, 
  isActive,
  ownedNft,
  isMinting,
  onMint 
}: { 
  nft: typeof nftTiers[0]
  isOwned: boolean
  isActive: boolean
  ownedNft?: NFTItem | null
  isMinting?: boolean
  onMint?: () => void
}) {
  const dynamicMaxUsage =
    typeof ownedNft?.max_usage === "number" && Number.isFinite(ownedNft.max_usage)
      ? Math.max(0, Math.floor(ownedNft.max_usage))
      : null
  const dynamicRemainingUsage =
    typeof ownedNft?.remaining_usage === "number" && Number.isFinite(ownedNft.remaining_usage)
      ? Math.max(0, Math.floor(ownedNft.remaining_usage))
      : null

  return (
    <div className={cn(
      "group relative p-4 rounded-2xl glass border transition-all duration-300 overflow-hidden",
      isOwned ? "border-primary/50" : "border-border"
    )}>
      {/* Non-transferable badge */}
      {isOwned && (
        <div className="absolute top-2 right-2 z-10">
          <span className="text-xs px-2 py-1 rounded-full bg-secondary/20 text-secondary border border-secondary/30">
            Non-transferable
          </span>
        </div>
      )}
      
      {/* Glow effect on hover */}
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      
      {/* NFT Visual */}
      <div className={cn(
        "relative h-32 rounded-xl mb-3 flex items-center justify-center bg-gradient-to-br overflow-hidden",
        nft.gradient
      )}>
        <picture className="h-full w-full">
          <source srcSet={nft.image} type="image/svg+xml" />
          <img
            src={nft.fallbackImage || nft.image}
            alt={`${nft.name} artwork`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </picture>
        <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(to_top,rgba(0,0,0,0.35),transparent_60%)]" />
        
        {/* 3D effect border */}
        <div className="absolute inset-0 border-2 border-white/20 rounded-xl" />
      </div>
      
      <div className="relative z-10">
        <h3 className="font-bold text-foreground text-sm group-hover:text-primary transition-colors">{nft.name}</h3>
        <p className="text-xs text-muted-foreground mb-2">{nft.tier} Tier</p>
        
        {nft.maxUses > 0 && (
          <div className="mb-3 text-xs text-muted-foreground">
            {isOwned && dynamicMaxUsage !== null
              ? dynamicRemainingUsage !== null
                ? `Uses left: ${dynamicRemainingUsage}/${dynamicMaxUsage}`
                : `Max uses: ${dynamicMaxUsage}`
              : `Max uses: ${nft.maxUses}`}
          </div>
        )}
        {nft.rechargeCost > 0 && (
          <div className="mb-3 text-xs text-muted-foreground">
            Recharge cost: {nft.rechargeCost.toLocaleString()} pts
          </div>
        )}
        
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-success font-medium">{nft.discount} Discount</span>
          {!isOwned && nft.tier !== "None" && (
            <span className="text-xs text-primary font-medium">{nft.cost.toLocaleString()} pts</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground mb-3">{nft.description}</p>

        {/* Action Button */}
        {nft.tier !== "None" && (
          <Button 
            size="sm" 
            className="relative z-10 w-full bg-gradient-to-r from-primary to-accent hover:opacity-90 text-xs"
            onClick={onMint}
            disabled={isMinting}
          >
            {isMinting ? "Minting..." : isOwned ? "Mint Again" : "Mint On-chain"}
          </Button>
        )}
        {isOwned && isActive && (
          <div className="text-center py-2 px-3 rounded-lg bg-success/10 border border-success/20">
            <p className="text-xs font-medium text-success">Active</p>
          </div>
        )}
        {isOwned && !isActive && (
          <div className="text-center py-2 px-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <p className="text-xs font-medium text-amber-300">Owned (Inactive)</p>
          </div>
        )}
      </div>
    </div>
  )
}

export function RewardsHub() {
  const wallet = useWallet()
  const notifications = useNotifications()
  const [usablePoints, setUsablePoints] = React.useState(0)
  const [everPoints, setEverPoints] = React.useState(0)
  const [estimatedCAREL, setEstimatedCAREL] = React.useState(0)
  const [ownedNfts, setOwnedNfts] = React.useState<NFTItem[]>([])
  const [isConverting, setIsConverting] = React.useState(false)
  const [isMintingTier, setIsMintingTier] = React.useState<number | null>(null)
  const [taskInputs, setTaskInputs] = React.useState<Record<string, string>>({})
  const [taskStatus, setTaskStatus] = React.useState<Record<string, { status: "idle" | "verifying" | "success" | "error"; message?: string; points?: number }>>({})
  const [currentEpoch, setCurrentEpoch] = React.useState<number | null>(null)
  const [convertEpoch, setConvertEpoch] = React.useState("")
  const [convertDistribution, setConvertDistribution] = React.useState("")
  const [showAdvancedConvert, setShowAdvancedConvert] = React.useState(false)
  const monthlyPoolLabel = React.useMemo(
    () => MONTHLY_POOL_CAREL.toLocaleString(undefined, { maximumFractionDigits: 2 }),
    []
  )
  const starknetProviderHint = React.useMemo<"starknet" | "argentx" | "braavos">(() => {
    if (wallet.provider === "argentx" || wallet.provider === "braavos") {
      return wallet.provider
    }
    return "starknet"
  }, [wallet.provider])

  const activeOwnedNft = React.useMemo(() => {
    const now = Math.floor(Date.now() / 1000)
    return ownedNfts.find((nft) => !nft.used && (!nft.expiry || nft.expiry > now)) || null
  }, [ownedNfts])

  const activeNftTier = React.useMemo(() => {
    if (!activeOwnedNft) return null
    return nftTiers.find((tier) => tier.tierId === activeOwnedNft.tier) || null
  }, [activeOwnedNft])

  const tiers = React.useMemo<TierInfo[]>(() => {
    const activeTierId = activeNftTier?.tierId ?? 0
    return tierDefinitions.map((tier) => ({
      ...tier,
      achieved: activeTierId >= tier.tierId && activeTierId > 0,
    }))
  }, [activeNftTier])

  const currentTierName = React.useMemo(() => {
    return activeNftTier?.tier || "None"
  }, [activeNftTier])

  const ownedNftByTier = React.useMemo(() => {
    const map = new Map<number, NFTItem>()
    for (const nft of ownedNfts) {
      const existing = map.get(nft.tier)
      if (!existing) {
        map.set(nft.tier, nft)
        continue
      }
      if (existing.used && !nft.used) {
        map.set(nft.tier, nft)
      }
    }
    return map
  }, [ownedNfts])

  React.useEffect(() => {
    let active = true
    const loadRewardsPoints = async () => {
      try {
        const rewards = await getRewardsPoints()
        if (!active) return
        setUsablePoints(Math.round(rewards.total_points))
        setEverPoints(Math.round(rewards.total_points))
        setCurrentEpoch(rewards.current_epoch)
        setConvertEpoch((prev) => (prev ? prev : String(rewards.current_epoch)))
      } catch {
        // keep existing values
      }
    }

    void loadRewardsPoints()
    const timer = window.setInterval(() => {
      void loadRewardsPoints()
    }, 10000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [wallet.address, wallet.starknetAddress, wallet.evmAddress, wallet.btcAddress])

  React.useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const analytics = await getPortfolioAnalytics()
        if (!active) return
        const estimated = Number(analytics.rewards.estimated_carel)
        setEstimatedCAREL(Number.isFinite(estimated) ? estimated : 0)
      } catch {
        // keep existing values
      }
    })()

    return () => {
      active = false
    }
  }, [])

  React.useEffect(() => {
    let active = true
    const loadOwnedNfts = async () => {
      try {
        const nfts = await getOwnedNfts()
        if (!active) return
        setOwnedNfts((prev) => {
          if (nfts.length > 0) return nfts
          const now = Math.floor(Date.now() / 1000)
          const prevHasActiveOrOwned = prev.some(
            (nft) => nft.tier > 0 && (!nft.expiry || nft.expiry > now)
          )
          return prevHasActiveOrOwned ? prev : nfts
        })
      } catch {
        // keep existing values
      }
    }

    void loadOwnedNfts()
    const timer = window.setInterval(() => {
      void loadOwnedNfts()
    }, 10000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [wallet.address, wallet.starknetAddress, wallet.evmAddress, wallet.btcAddress])

  const handleMintNFT = async (nft: typeof nftTiers[number]) => {
    if (nft.tierId === 0) return
    if (!wallet.isConnected) {
      notifications.addNotification({
        type: "error",
        title: "Wallet belum terkoneksi",
        message: "Connect Starknet wallet dulu sebelum mint NFT.",
      })
      return
    }
    if (usablePoints < nft.cost) {
      notifications.addNotification({
        type: "error",
        title: "Insufficient points",
        message: "Points Anda belum cukup untuk mint NFT ini.",
      })
      return
    }

    try {
      setIsMintingTier(nft.tierId)
      if (!STARKNET_DISCOUNT_SOULBOUND_ADDRESS) {
        throw new Error(
          "NEXT_PUBLIC_STARKNET_DISCOUNT_SOULBOUND_ADDRESS belum diisi. Set alamat kontrak NFT discount di frontend/.env.local."
        )
      }
      notifications.addNotification({
        type: "info",
        title: "Syncing points",
        message: "Sinkronisasi points backend ke PointStorage on-chain...",
      })
      const syncResult = await syncRewardsPointsOnchain({ minimum_points: nft.cost })
      if (syncResult.onchain_points_after < nft.cost) {
        throw new Error(
          `On-chain points belum cukup untuk mint. Required ${nft.cost.toLocaleString()}, on-chain ${Math.floor(syncResult.onchain_points_after).toLocaleString()}.`
        )
      }
      if (syncResult.sync_tx_hash) {
        notifications.addNotification({
          type: "success",
          title: "Points synced on-chain",
          message: `On-chain points siap: ${Math.floor(syncResult.onchain_points_after).toLocaleString()} pts.`,
          txHash: syncResult.sync_tx_hash,
          txNetwork: "starknet",
        })
      }
      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message: "Confirm mint NFT transaction in your Starknet wallet.",
      })
      const onchainTxHash = await invokeStarknetCallFromWallet(
        {
          contractAddress: STARKNET_DISCOUNT_SOULBOUND_ADDRESS,
          entrypoint: "mint_nft",
          calldata: [nft.tierId],
        },
        starknetProviderHint
      )
      const minted = await mintNft({ tier: nft.tierId, onchain_tx_hash: onchainTxHash })
      setOwnedNfts((prev) => [minted, ...prev])
      setUsablePoints((prev) => Math.max(0, prev - nft.cost))
      notifications.addNotification({
        type: "success",
        title: "NFT minted",
        message: `NFT tier ${nft.tier} berhasil dibuat.`,
        txHash: onchainTxHash,
        txNetwork: "starknet",
      })
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Gagal mint NFT."
      let normalizedMessage = rawMessage
      if (/sudah memiliki nft|already has nft/i.test(rawMessage)) {
        normalizedMessage =
          "Kontrak NFT yang aktif masih mode single-mint. Deploy versi unlimited-mint agar mint berulang bisa jalan."
      } else if (/invalid felt hex|representative out of range/i.test(rawMessage)) {
        normalizedMessage =
          "Backend signer on-chain belum valid. Sync points gagal sebelum wallet signature. Cek BACKEND_PRIVATE_KEY/BACKEND_ACCOUNT_ADDRESS lalu restart backend."
      }
      notifications.addNotification({
        type: "error",
        title: "Mint failed",
        message: normalizedMessage,
      })
    } finally {
      setIsMintingTier(null)
    }
  }

  const handleConvert = async () => {
    if (usablePoints <= 0) return
    try {
      setIsConverting(true)
      notifications.addNotification({
        type: "info",
        title: "Convert pending",
        message: "Konversi points ke CAREL sedang diproses...",
      })
      const payload: { points?: number; epoch?: number; total_distribution_carel?: number } = {
        points: usablePoints,
      }
      if (showAdvancedConvert) {
        const epochValue = Number(convertEpoch)
        if (convertEpoch.trim() !== "") {
          if (!Number.isFinite(epochValue) || epochValue < 0) {
            notifications.addNotification({
              type: "error",
              title: "Invalid epoch",
              message: "Epoch harus angka >= 0.",
            })
            setIsConverting(false)
            return
          }
          payload.epoch = Math.floor(epochValue)
        }
        const distValue = Number(convertDistribution)
        if (convertDistribution.trim() !== "" && (!Number.isFinite(distValue) || distValue < 0)) {
          notifications.addNotification({
            type: "error",
            title: "Invalid distribution",
            message: "Total distribution harus angka positif.",
          })
          setIsConverting(false)
          return
        }
        if (Number.isFinite(distValue) && convertDistribution.trim() !== "") {
          payload.total_distribution_carel = distValue
        }
      }
      const result = await convertRewards(payload)
      notifications.addNotification({
        type: "success",
        title: "Convert success",
        message: `Converted ${result.points_converted} points to ${result.amount_carel} CAREL`,
      })
      setUsablePoints(0)
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Convert failed",
        message: error instanceof Error ? error.message : "Gagal convert points.",
      })
    } finally {
      setIsConverting(false)
    }
  }

  const handleClaim = async () => {
    try {
      notifications.addNotification({
        type: "info",
        title: "Claim pending",
        message: "Claim rewards sedang diproses...",
      })
      const result = await claimRewards()
      notifications.addNotification({
        type: "success",
        title: "Claimed",
        message: `Claimed ${result.amount_carel} CAREL.`,
      })
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Claim failed",
        message: error instanceof Error ? error.message : "Tidak ada rewards untuk diklaim.",
      })
    }
  }

  const handleVerifyTask = async (taskId: string) => {
    const proof = taskInputs[taskId]
    if (!proof) return
    setTaskStatus((prev) => ({
      ...prev,
      [taskId]: { status: "verifying" },
    }))
    try {
      const result = await verifySocialTask({ task_type: taskId, proof })
      setTaskStatus((prev) => ({
        ...prev,
        [taskId]: { status: result.verified ? "success" : "error", message: result.message, points: result.points_earned },
      }))
      if (result.verified) {
        const rewards = await getRewardsPoints()
        setUsablePoints(Math.round(rewards.total_points))
        setEverPoints(Math.round(rewards.total_points))
      }
      notifications.addNotification({
        type: result.verified ? "success" : "error",
        title: "Social task",
        message: result.message,
      })
    } catch (error) {
      setTaskStatus((prev) => ({
        ...prev,
        [taskId]: { status: "error", message: error instanceof Error ? error.message : "Verification failed" },
      }))
      notifications.addNotification({
        type: "error",
        title: "Social task",
        message: error instanceof Error ? error.message : "Verification failed",
      })
    }
  }

  return (
    <section id="rewards" className="py-12">
      <div className="flex items-center gap-3 mb-6">
        <Gift className="h-6 w-6 text-primary" />
        <h2 className="text-2xl font-bold text-foreground">Loyalty Hub</h2>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Tier Progression */}
        <div className="lg:col-span-2">
          <TierProgressBar
            currentPoints={usablePoints}
            currentTierId={activeNftTier?.tierId ?? 0}
            tiers={tiers}
          />
        </div>

        {/* Points Balance */}
        <div className="p-6 rounded-2xl glass border border-border">
          <h3 className="font-medium text-foreground mb-4">Point Balance</h3>
          
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-surface/50 border border-border">
              <div className="flex items-center gap-2 mb-1">
                <Trophy className="h-4 w-4 text-primary" />
                <span className="text-sm text-muted-foreground">Lifetime Points</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{everPoints.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Current tier: {currentTierName}</p>
              <p className="text-xs text-accent mt-1">Resets per season</p>
            </div>

            <div className="p-4 rounded-xl bg-surface/50 border border-primary/30">
              <div className="flex items-center gap-2 mb-1">
                <Diamond className="h-4 w-4 text-secondary" />
                <span className="text-sm text-muted-foreground">Current Points</span>
              </div>
              <p className="text-2xl font-bold text-secondary">{usablePoints.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Use for NFTs or conversion</p>
              <p className="text-xs text-muted-foreground">Monthly pool: {monthlyPoolLabel} CAREL</p>
              <p className="text-xs text-accent mt-1">Estimated reward: ≈ {estimatedCAREL.toFixed(2)} CAREL</p>
            </div>

            <div className="p-3 rounded-lg bg-accent/10 border border-accent/20">
              <div className="flex items-start gap-2">
                <Sparkles className="h-4 w-4 text-accent flex-shrink-0 mt-0.5" />
                <p className="text-xs text-foreground">
                  Points decrease when minting NFTs. Earn more through trading volume!
                </p>
              </div>
            </div>

            <div className="grid gap-2">
              <button
                onClick={() => setShowAdvancedConvert((prev) => !prev)}
                className="text-xs text-muted-foreground text-left"
              >
                {showAdvancedConvert ? "Hide advanced convert" : "Advanced convert (epoch/distribution)"}
              </button>
              {showAdvancedConvert && (
                <div className="grid gap-2 p-3 rounded-lg bg-surface/50 border border-border">
                  <div>
                    <label className="text-xs text-muted-foreground">Epoch</label>
                    <input
                      type="number"
                      value={convertEpoch}
                      onChange={(e) => setConvertEpoch(e.target.value)}
                      placeholder={currentEpoch ? String(currentEpoch) : "0"}
                      className="w-full mt-1 px-3 py-2 rounded-lg bg-surface border border-border text-foreground text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Total distribution (CAREL)</label>
                    <input
                      type="number"
                      value={convertDistribution}
                      onChange={(e) => setConvertDistribution(e.target.value)}
                      placeholder="Optional"
                      className="w-full mt-1 px-3 py-2 rounded-lg bg-surface border border-border text-foreground text-sm"
                    />
                  </div>
                </div>
              )}
              <Button
                onClick={handleConvert}
                disabled={usablePoints <= 0 || isConverting}
                className="w-full bg-gradient-to-r from-primary to-accent hover:opacity-90 text-primary-foreground"
              >
                {isConverting ? "Converting..." : "Convert to CAREL"} <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
              <Button
                onClick={handleClaim}
                variant="outline"
                className="w-full bg-transparent"
              >
                Claim Rewards
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Current NFT Status */}
      {activeNftTier && activeOwnedNft && (
        <div className="mt-6 p-6 rounded-2xl glass border border-primary/50">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-foreground mb-1">Active NFT Discount</h3>
              <p className="text-sm text-muted-foreground">Your current fee discount NFT</p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-primary">{activeOwnedNft.discount}%</p>
              <p className="text-sm text-muted-foreground">Fee Discount</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-4">
            <div className="p-3 rounded-lg bg-surface/50">
              <p className="text-xs text-muted-foreground">NFT Tier</p>
              <p className="text-sm font-medium text-foreground">{activeNftTier.tier}</p>
            </div>
            <div className="p-3 rounded-lg bg-surface/50">
              <p className="text-xs text-muted-foreground">Expiry</p>
              <p className="text-sm font-medium text-foreground">
                {activeOwnedNft.expiry ? new Date(activeOwnedNft.expiry * 1000).toLocaleDateString("id-ID") : "—"}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-surface/50">
              <p className="text-xs text-muted-foreground">Status</p>
              <p className={cn(
                "text-sm font-medium",
                activeOwnedNft.used ? "text-destructive" : "text-success"
              )}>
                {activeOwnedNft.used ? "Expired" : "Active"}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-surface/50">
              <p className="text-xs text-muted-foreground">Usage Left</p>
              <p className="text-sm font-medium text-foreground">
                {typeof activeOwnedNft.remaining_usage === "number" && typeof activeOwnedNft.max_usage === "number"
                  ? `${Math.max(0, Math.floor(activeOwnedNft.remaining_usage))}/${Math.max(0, Math.floor(activeOwnedNft.max_usage))}`
                  : "—"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* NFT Gallery */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-foreground">NFT Discount System</h3>
          <div className="text-sm text-muted-foreground">
            Limited uses • Non-transferable • Auto inactive when depleted
          </div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {nftTiers.map((nft) => {
            const ownedNft = ownedNftByTier.get(nft.tierId) || null
            return (
              <NFTCard
                key={nft.tier}
                nft={nft}
                isOwned={Boolean(ownedNft)}
                isActive={(activeNftTier?.tierId ?? 0) === nft.tierId}
                ownedNft={ownedNft}
                isMinting={isMintingTier === nft.tierId}
                onMint={() => handleMintNFT(nft)}
              />
            )
          })}
        </div>

        {/* How NFT System Works */}
        <div className="mt-6 p-6 rounded-2xl glass border border-border">
          <h4 className="font-bold text-foreground mb-4">How NFT Discount System Works</h4>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-primary">1</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Mint NFT with Points</p>
                  <p className="text-xs text-muted-foreground">Mint on-chain. Points are consumed by contract logic.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-primary">2</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Get Fee Discounts</p>
                  <p className="text-xs text-muted-foreground">Each eligible transaction consumes NFT usage quota</p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-primary">3</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Uses Depleted</p>
                  <p className="text-xs text-muted-foreground">NFT stays owned but automatically becomes inactive when usage quota is exhausted</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-primary">4</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Mint Again Anytime</p>
                  <p className="text-xs text-muted-foreground">Unlimited mint is allowed as long as point requirement is met</p>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 p-3 rounded-lg bg-secondary/10 border border-secondary/20">
            <p className="text-xs text-foreground flex items-start gap-2">
              <Shield className="h-4 w-4 text-secondary flex-shrink-0" />
              <span>All NFTs are non-transferable and bound to your wallet to prevent abuse. Points are earned from swap, bridge, limit order, and staking activities.</span>
            </p>
          </div>
        </div>
      </div>

      {/* Social Tasks */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-foreground">Social Tasks</h3>
          <div className="text-sm text-muted-foreground">Earn bonus points</div>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {socialTasks.map((task) => {
            const status = taskStatus[task.id]?.status || "idle"
            return (
              <div key={task.id} className="p-4 rounded-2xl glass border border-border">
                <h4 className="font-medium text-foreground mb-1">{task.title}</h4>
                <p className="text-xs text-muted-foreground mb-3">{task.description}</p>
                <div className="flex gap-2">
                  <input
                    value={taskInputs[task.id] || ""}
                    onChange={(e) => setTaskInputs((prev) => ({ ...prev, [task.id]: e.target.value }))}
                    placeholder={task.placeholder}
                    className="flex-1 px-3 py-2 rounded-lg bg-surface border border-border text-foreground text-xs"
                  />
                  <Button
                    onClick={() => handleVerifyTask(task.id)}
                    disabled={status === "verifying" || !(taskInputs[task.id] || "").trim()}
                  >
                    {status === "verifying" ? "Verifying..." : "Verify"}
                  </Button>
                </div>
                {taskStatus[task.id]?.message && (
                  <p className={cn(
                    "text-xs mt-2",
                    status === "success" ? "text-success" : status === "error" ? "text-destructive" : "text-muted-foreground"
                  )}>
                    {taskStatus[task.id]?.message}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
