"use client"

import type { WalletContextType } from "@/hooks/wallet/use-wallet"
import * as React from "react"
import {
  getOwnedNfts,
  getRewardsPoints,
  getSocialTasks,
  type NFTItem,
  type RewardsPointsResponse,
} from "@/lib/api"
import { usePageVisibility } from "@/hooks/system/use-page-visibility"
import {
  defaultSocialTasks,
  nftTiers,
  tierDefinitions,
  type SocialTaskUi,
  type TierInfo,
} from "@/lib/rewards-config"

type WalletContext = WalletContextType

type UseRewardsDataParams = {
  wallet: WalletContext
}

export function useRewardsData({ wallet }: UseRewardsDataParams) {
  const [usablePoints, setUsablePoints] = React.useState(0)
  const [everPoints, setEverPoints] = React.useState(0)
  const [estimatedCAREL, setEstimatedCAREL] = React.useState(0)
  const [ownedNfts, setOwnedNfts] = React.useState<NFTItem[]>([])
  const [socialTasks, setSocialTasks] = React.useState<SocialTaskUi[]>(defaultSocialTasks)
  const [currentEpoch, setCurrentEpoch] = React.useState<number | null>(null)
  const [convertEpoch, setConvertEpoch] = React.useState("")
  const [convertDistribution, setConvertDistribution] = React.useState("")
  const [showAdvancedConvert, setShowAdvancedConvert] = React.useState(false)
  const [distributionLabel, setDistributionLabel] = React.useState("Distribution pool")
  const [distributionPoolLabel, setDistributionPoolLabel] = React.useState("—")
  const [claimFeeLabel, setClaimFeeLabel] = React.useState("Claim fee: 5%")
  const isVisible = usePageVisibility()

  const applyRewardsPoints = React.useCallback((rewards: RewardsPointsResponse) => {
    setUsablePoints(Math.round(rewards.total_points))
    setEverPoints(Math.round(rewards.total_points))
    if (
      typeof rewards.estimated_reward_carel === "number" &&
      Number.isFinite(rewards.estimated_reward_carel)
    ) {
      setEstimatedCAREL(rewards.estimated_reward_carel)
    }
    setCurrentEpoch(rewards.current_epoch)
    setConvertEpoch((prev) => (prev ? prev : String(rewards.current_epoch)))
    const rawPool = rewards.distribution_pool_carel
    if (typeof rawPool === "number" && Number.isFinite(rawPool)) {
      setDistributionPoolLabel(rawPool.toLocaleString(undefined, { maximumFractionDigits: 2 }))
    } else {
      setDistributionPoolLabel("—")
    }
    setDistributionLabel(rewards.distribution_label || "Distribution pool")
    const feeTotal =
      typeof rewards.claim_fee_percent === "number" && Number.isFinite(rewards.claim_fee_percent)
        ? rewards.claim_fee_percent
        : 5
    setClaimFeeLabel(`Claim fee: ${feeTotal}%`)
  }, [])

  const refreshRewardsPoints = React.useCallback(async () => {
    const rewards = await getRewardsPoints()
    applyRewardsPoints(rewards)
  }, [applyRewardsPoints])

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
    if (!isVisible) return
    let active = true
    /**
     * Handles `loadRewardsPoints` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const loadRewardsPoints = async () => {
      try {
        const rewards = await getRewardsPoints()
        if (!active) return
        applyRewardsPoints(rewards)
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
  }, [applyRewardsPoints, isVisible, wallet.address, wallet.btcAddress, wallet.evmAddress, wallet.starknetAddress])

  React.useEffect(() => {
    let active = true
    /**
     * Handles `loadSocialTasks` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const loadSocialTasks = async () => {
      try {
        const remoteTasks = await getSocialTasks()
        if (!active || !Array.isArray(remoteTasks) || remoteTasks.length === 0) return
        const merged: SocialTaskUi[] = remoteTasks.map((task) => ({
          ...task,
          placeholder:
            task.provider === "telegram"
              ? "@username"
              : task.provider === "discord"
              ? "username#1234"
              : "https://x.com/carelprotocol/status/...",
          description: task.description || `Complete ${task.title} (+${task.points} pts)`,
        }))
        setSocialTasks(merged)
      } catch {
        setSocialTasks(defaultSocialTasks)
      }
    }
    void loadSocialTasks()
    return () => {
      active = false
    }
  }, [])

  React.useEffect(() => {
    if (!isVisible) return
    let active = true
    /**
     * Handles `loadOwnedNfts` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
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
  }, [isVisible, wallet.address, wallet.btcAddress, wallet.evmAddress, wallet.starknetAddress])

  return {
    usablePoints,
    everPoints,
    estimatedCAREL,
    ownedNfts,
    setOwnedNfts,
    socialTasks,
    currentEpoch,
    convertEpoch,
    setConvertEpoch,
    convertDistribution,
    setConvertDistribution,
    showAdvancedConvert,
    setShowAdvancedConvert,
    distributionLabel,
    distributionPoolLabel,
    claimFeeLabel,
    activeOwnedNft,
    activeNftTier,
    tiers,
    currentTierName,
    ownedNftByTier,
    refreshRewardsPoints,
    setUsablePoints,
  }
}
