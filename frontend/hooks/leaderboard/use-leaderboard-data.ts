"use client"

import * as React from "react"
import { getLeaderboard } from "@/lib/api"
import { formatCompact } from "@/lib/utils"
import { useWallet } from "@/hooks/wallet/use-wallet"

export type TabId = "total" | "trading" | "referral"

export const leaderboardTabs: { id: TabId; label: string }[] = [
  { id: "total", label: "Total Points" },
  { id: "trading", label: "Trading Volume" },
  { id: "referral", label: "Referral" },
]

export interface LeaderboardEntry {
  rank: number
  address: string
  points: number
  isYou: boolean
  change: number
  label?: string
}

export function useLeaderboardData() {
  const wallet = useWallet()
  const [activeTab, setActiveTab] = React.useState<TabId>("total")
  const [entries, setEntries] = React.useState<LeaderboardEntry[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const isYouAddress = React.useCallback(
    (entryAddress: string) => {
      const candidates = [
        wallet.address,
        wallet.starknetAddress,
        wallet.evmAddress,
        wallet.btcAddress,
      ]
        .map((value) => value?.toLowerCase().trim())
        .filter((value): value is string => Boolean(value))

      if (candidates.length === 0) return false
      const normalizedEntry = entryAddress.toLowerCase()
      return candidates.some((normalizedWallet) => {
        if (normalizedWallet.includes("...")) {
          const [prefix, suffix] = normalizedWallet.split("...")
          return normalizedEntry.startsWith(prefix) && normalizedEntry.endsWith(suffix)
        }
        return normalizedEntry === normalizedWallet
      })
    },
    [wallet.address, wallet.starknetAddress, wallet.evmAddress, wallet.btcAddress]
  )

  React.useEffect(() => {
    let active = true
    const leaderboardType =
      activeTab === "total" ? "points" : activeTab === "trading" ? "volume" : "referrals"

    /**
     * Handles `loadLeaderboard` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const loadLeaderboard = async () => {
      setIsLoading(true)
      setLoadError(null)
      try {
        const response = await getLeaderboard(leaderboardType)
        if (!active) return
        const mapped = response.entries.map((entry) => {
          const base: LeaderboardEntry = {
            rank: entry.rank,
            address: entry.display_name || entry.address,
            points: entry.value,
            isYou: isYouAddress(entry.address),
            change: entry.change_24h ? Math.round(entry.change_24h) : 0,
          }

          if (activeTab === "trading") {
            base.label = `$${formatCompact(entry.value)}`
          } else if (activeTab === "referral") {
            base.label = `${Math.round(entry.value)} refs`
          }

          return base
        })

        setEntries(mapped)
      } catch (error) {
        if (!active) return
        setLoadError(error instanceof Error ? error.message : "Failed to load leaderboard")
        setEntries([])
      } finally {
        if (active) setIsLoading(false)
      }
    }

    void loadLeaderboard()
    const timer = window.setInterval(() => {
      void loadLeaderboard()
    }, 15000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [activeTab, isYouAddress])

  const derived = React.useMemo(() => {
    const yourEntryIndex = entries.findIndex((entry) => entry.isYou)
    const yourEntry = yourEntryIndex >= 0 ? entries[yourEntryIndex] : undefined
    const previousEntry = yourEntryIndex > 0 ? entries[yourEntryIndex - 1] : undefined
    const nextEntry =
      yourEntryIndex >= 0 && yourEntryIndex < entries.length - 1 ? entries[yourEntryIndex + 1] : undefined
    return { yourEntry, previousEntry, nextEntry }
  }, [entries])

  return {
    activeTab,
    setActiveTab,
    entries,
    isLoading,
    loadError,
    yourEntry: derived.yourEntry,
    previousEntry: derived.previousEntry,
    nextEntry: derived.nextEntry,
  }
}
