"use client"

import * as React from "react"
import {
  getReferralCode,
  getReferralHistory,
  getReferralStats,
  getRewardsPoints,
  type ReferralHistoryItem,
} from "@/lib/api"
import { useWallet } from "@/hooks/wallet/use-wallet"

export type ReferralStats = {
  totalReferrals: number
  activeReferrals: number
  totalEarnings: number
  lifetimeVolume: number
  pendingRewards: number
}

export type ReferralRecent = {
  address: string
  date: string
  volume: string
  earnings: string
  status: string
}

export type ReferralActivity = {
  id: string
  user: string
  date: string
  action: string
  volume: string
  points: number
  status: string
}

type ReferralDataState = {
  stats: ReferralStats | null
  recentReferrals: ReferralRecent[]
  history: ReferralActivity[]
  referralCode: string
  referralLink: string
  earnedPoints: number
  isLoading: boolean
}

const defaultState: ReferralDataState = {
  stats: null,
  recentReferrals: [],
  history: [],
  referralCode: "",
  referralLink: "",
  earnedPoints: 0,
  isLoading: false,
}

let cachedState: ReferralDataState = defaultState
let cachedWalletKey: string | null = null
let inFlight: Promise<void> | null = null
const listeners = new Set<() => void>()

const notify = () => {
  listeners.forEach((listener) => listener())
}

const setCachedState = (next: Partial<ReferralDataState>) => {
  cachedState = { ...cachedState, ...next }
  notify()
}

const loadReferralData = async () => {
  if (inFlight) return inFlight
  inFlight = (async () => {
    setCachedState({ isLoading: true })
    try {
      const [codeRes, statsRes, pointsRes, historyRes] = await Promise.all([
        getReferralCode(),
        getReferralStats(),
        getRewardsPoints(),
        getReferralHistory(1, 5),
      ])
      const mappedRecent = historyRes.items.map((item: ReferralHistoryItem) => {
        const volume = Number(item.volume_usd || 0)
        return {
          address: `${item.user_address.slice(0, 6)}...${item.user_address.slice(-4)}`,
          date: new Date(item.timestamp).toLocaleDateString("id-ID"),
          volume: volume ? `$${volume.toLocaleString()}` : "—",
          earnings: `${Math.round(Number(item.points || 0)).toLocaleString()} CAREL`,
          status: item.status || "Pending",
        }
      })
      const mappedHistory = historyRes.items.map((item: ReferralHistoryItem) => {
        const usdValue = Number(item.volume_usd || 0)
        return {
          id: item.tx_hash,
          user: item.user_address.slice(0, 6) + "..." + item.user_address.slice(-4),
          date: new Date(item.timestamp).toLocaleDateString("id-ID"),
          action: item.action.toUpperCase(),
          volume: usdValue ? `$${usdValue.toLocaleString()}` : "—",
          points: Math.round(Number(item.points || 0)),
          status: item.status || "pending",
        }
      })
      setCachedState({
        referralCode: codeRes.code,
        referralLink: codeRes.url,
        stats: {
          totalReferrals: statsRes.total_referrals,
          activeReferrals: statsRes.active_referrals,
          totalEarnings: statsRes.total_rewards,
          lifetimeVolume: statsRes.total_volume,
          pendingRewards: Math.round(statsRes.total_rewards),
        },
        recentReferrals: mappedRecent,
        history: mappedHistory,
        earnedPoints: Math.round(pointsRes.referral_points),
        isLoading: false,
      })
    } catch {
      setCachedState({
        stats: null,
        recentReferrals: [],
        history: [],
        isLoading: false,
      })
    }
  })()

  try {
    await inFlight
  } finally {
    inFlight = null
  }
}

export function useReferralData() {
  const wallet = useWallet()
  const walletKey = wallet.address || wallet.starknetAddress || wallet.evmAddress || wallet.btcAddress || null
  const [state, setState] = React.useState<ReferralDataState>(cachedState)

  React.useEffect(() => {
    const handleUpdate = () => setState(cachedState)
    listeners.add(handleUpdate)
    return () => {
      listeners.delete(handleUpdate)
    }
  }, [])

  React.useEffect(() => {
    if (cachedWalletKey !== walletKey) {
      cachedWalletKey = walletKey
      cachedState = { ...defaultState }
      notify()
    }
    void loadReferralData()
  }, [walletKey])

  return state
}
