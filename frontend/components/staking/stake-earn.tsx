"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { TrendingUp, Coins, Info, Clock, Wallet, Eye, EyeOff } from "lucide-react"
import { useWallet } from "@/hooks/wallet/use-wallet"
import { useNotifications } from "@/hooks/notifications/use-notifications"
import { useLivePrices } from "@/hooks/price/use-live-prices"
import {
  getOwnedNfts,
  getStakePools,
  getStakePositions,
  type NFTItem,
  type PrivacyVerificationPayload,
} from "@/lib/api"
import {
  AI_STAKE_POSITION_SOURCES_UPDATED_EVENT,
  loadAiStakePositionSourceIds,
} from "@/lib/ai-execution-source"
import { Countdown } from "@/components/trade/trade-countdown"
import { StakeDialog } from "@/components/staking/stake-dialog"
import { StakingCard } from "@/components/staking/staking-card"
import { useStakeOnchain } from "@/hooks/stake/use-stake-onchain"
import { useStakeActions } from "@/hooks/stake/use-stake-actions"
import {
  HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED,
  HIDE_BALANCE_RELAYER_APPROVE_MAX,
  HIDE_BALANCE_RELAYER_POOL_ENABLED,
  PRIVATE_ACTION_EXECUTOR_ADDRESS,
  STAKE_PRIVACY_PAYLOAD_UPDATED_EVENT,
  STAKE_PRIVACY_PENDING_NOTES_UPDATED_EVENT,
  STARKNET_ZK_PRIVACY_ROUTER_ADDRESS,
  buildHideBalancePrivacyCall,
  clearTradePrivacyPayload,
  loadPendingHideNotes,
  loadTradePrivacyPayload,
  persistTradePrivacyPayload,
  removePendingHideNote,
  type PendingHideNoteRecord,
  useStakePrivacy,
} from "@/hooks/stake/use-stake-privacy"

const poolMeta: Record<string, { name: string; icon: string; type: string; gradient: string }> = {
  USDT: { name: "Tether", icon: "₮", type: "Stablecoin", gradient: "from-green-400 to-emerald-600" },
  USDC: { name: "USD Coin", icon: "⭕", type: "Stablecoin", gradient: "from-blue-400 to-cyan-600" },
  WBTC: { name: "Wrapped Bitcoin", icon: "₿", type: "Crypto", gradient: "from-orange-400 to-amber-600" },
  BTC: { name: "Bitcoin", icon: "₿", type: "Crypto", gradient: "from-orange-400 to-amber-600" },
  ETH: { name: "Ethereum", icon: "Ξ", type: "Crypto", gradient: "from-purple-400 to-indigo-600" },
  STRK: { name: "StarkNet", icon: "◈", type: "Crypto", gradient: "from-pink-400 to-rose-600" },
  CAREL: { name: "Carel Protocol", icon: "◐", type: "Crypto", gradient: "from-violet-400 to-purple-600" },
}

type UsdtTierOption = { minUsdt: number; bonusPercent: number }

const USDT_POINTS_TIER_OPTIONS: UsdtTierOption[] = [
  { minUsdt: 5, bonusPercent: 5 },
  { minUsdt: 10, bonusPercent: 10 },
  { minUsdt: 50, bonusPercent: 20 },
  { minUsdt: 100, bonusPercent: 30 },
  { minUsdt: 250, bonusPercent: 50 },
]

const STARKNET_STAKING_CAREL_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_STAKING_CAREL_ADDRESS ||
  process.env.NEXT_PUBLIC_STAKING_CAREL_ADDRESS ||
  ""
const STARKNET_STAKING_STABLECOIN_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_STAKING_STABLECOIN_ADDRESS ||
  process.env.NEXT_PUBLIC_STAKING_STABLECOIN_ADDRESS ||
  ""
const STARKNET_STAKING_WBTC_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_STAKING_WBTC_ADDRESS ||
  process.env.NEXT_PUBLIC_STAKING_WBTC_ADDRESS ||
  ""
const TOKEN_CAREL_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_CAREL_ADDRESS ||
  "0x0517f60f4ec4e1b2b748f0f642dfdcb32c0ddc893f777f2b595a4e4f6df51545"
const TOKEN_USDC_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_USDC_ADDRESS ||
  "0x05a26f9680c5dc0c36dcf1670d7f51f24ba0080d15fedb7396d23a77bf5c1924"
const TOKEN_USDT_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_USDT_ADDRESS ||
  "0x07439bce89f5559b3f6aa1793291c5bb20c03adf5bac57debe4d7209c2cb053b"
const TOKEN_WBTC_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_WBTC_ADDRESS ||
  process.env.NEXT_PUBLIC_TOKEN_BTC_ADDRESS ||
  ""
const TOKEN_STRK_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_STRK_ADDRESS ||
  "0x04718f5a0Fc34cC1AF16A1cdee98fFB20C31f5cD61D6Ab07201858f4287c938D"

const POOL_DECIMALS: Record<string, number> = {
  CAREL: 18,
  USDC: 6,
  USDT: 6,
  WBTC: 8,
  STRK: 18,
  BTC: 8,
}

const withStakeSourceLabel = (positions: StakingPosition[]): StakingPosition[] => {
  const aiStakePositionIds = loadAiStakePositionSourceIds()
  return positions.map((position) => ({
    ...position,
    requestSource: aiStakePositionIds.has(position.id.trim().toLowerCase()) ? "ai" : "manual",
  }))
}

/**
 * Parses or transforms values for `formatCompact`.
 *
 * @param value - Input used by `formatCompact` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const formatCompact = (value: number) => {
  try {
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return value.toLocaleString()
  }
}

/**
 * Handles `apyDisplayFor` logic.
 *
 * @param pool - Input used by `apyDisplayFor` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const apyDisplayFor = (pool: { symbol: string; apy: string }) => {
  if (pool.symbol === "CAREL") return "8% - 15%"
  return `${pool.apy}%`
}

interface StakingPool {
  symbol: string
  name: string
  icon: string
  type: string
  apy: string
  apyDisplay?: string
  tvl: string
  tvlValue: number
  spotPrice: number
  minStake: string
  lockPeriod: string
  reward: string
  gradient: string
  userBalance: number
}

interface StakingPosition {
  id: string
  pool: StakingPool
  amount: number
  stakedAt: string
  rewards: number
  status: "active" | "pending" | "unlocking"
  requestSource: "manual" | "ai"
}

/**
 * Runs `StakeEarn` and handles related side effects.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function StakeEarn() {
  const wallet = useWallet()
  const notifications = useNotifications()
  const [selectedPool, setSelectedPool] = React.useState<StakingPool | null>(null)
  const [stakeDialogOpen, setStakeDialogOpen] = React.useState(false)
  const [stakeAmount, setStakeAmount] = React.useState("")
  const [isStaking, setIsStaking] = React.useState(false)
  const [stakeSuccess, setStakeSuccess] = React.useState(false)
  const [claimingPositionId, setClaimingPositionId] = React.useState<string | null>(null)
  const [balanceHidden, setBalanceHidden] = React.useState(false)
  const [hideBalancePopupOpen, setHideBalancePopupOpen] = React.useState(false)
  const [hideUsdtTierMin, setHideUsdtTierMin] = React.useState<number>(10)
  const [hasTradePrivacyPayload, setHasTradePrivacyPayload] = React.useState(false)
  const [pendingHideNotes, setPendingHideNotes] = React.useState<PendingHideNoteRecord[]>([])
  const [countdownTick, setCountdownTick] = React.useState(0)
  const [pendingNoteActionCommitment, setPendingNoteActionCommitment] = React.useState<string | null>(null)
  const [isAutoPrivacyProvisioning, setIsAutoPrivacyProvisioning] = React.useState(false)
  const autoPrivacyPayloadPromiseRef = React.useRef<Promise<PrivacyVerificationPayload | undefined> | null>(null)
  const manuallySelectedHideNoteRef = React.useRef<{
    noteCommitment: string
    nullifier?: string
  } | null>(null)
  const [pools, setPools] = React.useState<StakingPool[]>([])
  const [positions, setPositions] = React.useState<StakingPosition[]>([])
  const [activeNftDiscount, setActiveNftDiscount] = React.useState<NFTItem | null>(null)
  const { prices: tokenPrices } = useLivePrices(Object.keys(poolMeta), {
    fallbackPrices: { CAREL: 1, USDC: 1, USDT: 1 },
  })
  const [activePositions, setActivePositions] = React.useState(0)
  const starknetProviderHint = React.useMemo<"starknet" | "argentx" | "braavos">(() => {
    if (wallet.provider === "argentx" || wallet.provider === "braavos") {
      return wallet.provider
    }
    return "starknet"
  }, [wallet.provider])

  const resolvePoolTokenAddress = React.useCallback((poolSymbol: string): string => {
    const symbol = poolSymbol.trim().toUpperCase()
    if (symbol === "CAREL") return TOKEN_CAREL_ADDRESS.trim()
    if (symbol === "USDC") return TOKEN_USDC_ADDRESS.trim()
    if (symbol === "USDT") return TOKEN_USDT_ADDRESS.trim()
    if (symbol === "WBTC") return TOKEN_WBTC_ADDRESS.trim()
    if (symbol === "STRK") return TOKEN_STRK_ADDRESS.trim()
    return ""
  }, [])

  const refreshTradePrivacyPayload = React.useCallback(() => {
    setHasTradePrivacyPayload(Boolean(loadTradePrivacyPayload()))
  }, [])

  const refreshPendingHideNotes = React.useCallback(() => {
    setPendingHideNotes(loadPendingHideNotes())
  }, [])

  const setManuallySelectedHideNote = React.useCallback(
    (noteCommitment?: string, nullifier?: string) => {
      const normalizedCommitment = (noteCommitment || "").trim().toLowerCase()
      const normalizedNullifier = (nullifier || "").trim().toLowerCase()
      if (!normalizedCommitment && !normalizedNullifier) {
        manuallySelectedHideNoteRef.current = null
        return
      }
      manuallySelectedHideNoteRef.current = {
        noteCommitment: normalizedCommitment,
        nullifier: normalizedNullifier || undefined,
      }
    },
    []
  )

  const clearManuallySelectedHideNote = React.useCallback(() => {
    manuallySelectedHideNoteRef.current = null
  }, [])

  const isManuallySelectedHideNote = React.useCallback(
    (noteCommitment?: string, nullifier?: string) => {
      const selected = manuallySelectedHideNoteRef.current
      if (!selected) return false
      const normalizedCommitment = (noteCommitment || "").trim().toLowerCase()
      const normalizedNullifier = (nullifier || "").trim().toLowerCase()
      const commitmentMatch =
        !!selected.noteCommitment &&
        !!normalizedCommitment &&
        selected.noteCommitment === normalizedCommitment
      const nullifierMatch =
        !!selected.nullifier && !!normalizedNullifier && selected.nullifier === normalizedNullifier
      return commitmentMatch || nullifierMatch
    },
    []
  )

  const consumeUsedHidePayload = React.useCallback(
    (payload?: PrivacyVerificationPayload) => {
      const spentCommitment = (payload?.note_commitment || payload?.commitment || "").trim()
      const spentNullifier = (payload?.nullifier || "").trim()
      removePendingHideNote(spentCommitment, spentNullifier)
      setPendingHideNotes(loadPendingHideNotes())
      if (isManuallySelectedHideNote(spentCommitment, spentNullifier)) {
        clearManuallySelectedHideNote()
      }
      clearTradePrivacyPayload()
      setHasTradePrivacyPayload(false)
    },
    [clearManuallySelectedHideNote, isManuallySelectedHideNote]
  )

  const displayPools = React.useMemo(() => {
    if (pools.length === 0) return []
    return pools.map((pool) => ({
      ...pool,
      spotPrice: tokenPrices[pool.symbol] ?? pool.spotPrice,
    }))
  }, [pools, tokenPrices])

  React.useEffect(() => {
    let active = true
    if (!wallet.isConnected) {
      setActiveNftDiscount(null)
      return
    }

    /**
     * Handles `loadNftDiscount` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const loadNftDiscount = async (force = false) => {
      try {
        const nfts = await getOwnedNfts({ force })
        if (!active) return
        const now = Math.floor(Date.now() / 1000)
        const usable = nfts
          .filter((nft) => !nft.used && (!nft.expiry || nft.expiry > now))
          .sort((a, b) => (b.discount || 0) - (a.discount || 0))[0]
        setActiveNftDiscount(usable || null)
      } catch {
        if (!active) return
        setActiveNftDiscount(null)
      }
    }

    void loadNftDiscount()
    const timer = window.setInterval(() => {
      void loadNftDiscount(true)
    }, 20_000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [wallet.isConnected, wallet.address, wallet.starknetAddress, wallet.evmAddress, wallet.btcAddress])

  React.useEffect(() => {
    refreshTradePrivacyPayload()
    window.addEventListener(STAKE_PRIVACY_PAYLOAD_UPDATED_EVENT, refreshTradePrivacyPayload)
    return () => {
      window.removeEventListener(STAKE_PRIVACY_PAYLOAD_UPDATED_EVENT, refreshTradePrivacyPayload)
    }
  }, [refreshTradePrivacyPayload])

  React.useEffect(() => {
    refreshPendingHideNotes()
    window.addEventListener(STAKE_PRIVACY_PENDING_NOTES_UPDATED_EVENT, refreshPendingHideNotes)
    return () => {
      window.removeEventListener(STAKE_PRIVACY_PENDING_NOTES_UPDATED_EVENT, refreshPendingHideNotes)
    }
  }, [refreshPendingHideNotes])

  React.useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const response = await getStakePools()
        if (!active) return
        const mapped = response.map((pool) => {
          const meta = poolMeta[pool.token] || {
            name: pool.token,
            icon: "●",
            type: "Crypto",
            gradient: "from-slate-400 to-slate-600",
          }
          const symbol = pool.token.toUpperCase()
          const userBalance =
            symbol === "CAREL"
              ? wallet.onchainBalance.CAREL ?? wallet.balance[symbol] ?? 0
              : symbol === "USDC"
              ? wallet.onchainBalance.USDC ?? wallet.balance[symbol] ?? 0
              : symbol === "USDT"
              ? wallet.onchainBalance.USDT ?? wallet.balance[symbol] ?? 0
              : symbol === "WBTC"
              ? wallet.onchainBalance.WBTC ?? wallet.balance[symbol] ?? 0
              : symbol === "BTC"
              ? wallet.onchainBalance.BTC ?? wallet.balance[symbol] ?? 0
              : symbol === "STRK"
              ? wallet.onchainBalance.STRK_L2 ?? wallet.balance[symbol] ?? 0
              : wallet.balance[symbol] ?? 0
          const tvlUsd = Number.isFinite(pool.tvl_usd) ? pool.tvl_usd : pool.total_staked
          return {
            symbol,
            name: meta.name,
            icon: meta.icon,
            type: meta.type,
            apy: pool.apy.toFixed(2),
            apyDisplay: symbol === "CAREL" ? "8% - 15%" : `${pool.apy.toFixed(2)}%`,
            tvl: formatCompact(tvlUsd),
            tvlValue: tvlUsd,
            spotPrice: 0,
            minStake: pool.min_stake.toString(),
            lockPeriod: pool.lock_period ? `${pool.lock_period} days` : "Flexible",
            reward: pool.token,
            gradient: meta.gradient,
            userBalance,
          } as StakingPool
        })
        setPools(mapped)
      } catch {
        if (!active) return
        setPools([])
      }
    })()

    return () => {
      active = false
    }
  }, [
    wallet.balance,
    wallet.onchainBalance.BTC,
    wallet.onchainBalance.CAREL,
    wallet.onchainBalance.STRK_L2,
    wallet.onchainBalance.USDC,
    wallet.onchainBalance.USDT,
    wallet.onchainBalance.WBTC,
  ])

  const refreshPositions = React.useCallback(async () => {
    try {
      const response = await getStakePositions()
      const poolMap = new Map(pools.map((pool) => [pool.symbol, pool]))
      const mapped = response
        .map((position) => {
          const pool = poolMap.get(position.token)
          if (!pool) return null
          return {
            id: position.position_id,
            pool,
            amount: position.amount,
            stakedAt: new Date(position.started_at * 1000).toLocaleDateString("id-ID"),
            rewards: position.rewards_earned,
            status: "active",
            requestSource: "manual" as const,
          } as StakingPosition
        })
        .filter((item): item is StakingPosition => item !== null)
      const labeledPositions = withStakeSourceLabel(mapped)
      setPositions(labeledPositions)
      setActivePositions(labeledPositions.length)
    } catch {
      setPositions([])
      setActivePositions(0)
    }
  }, [pools])

  React.useEffect(() => {
    if (pools.length === 0) return
    let active = true
    ;(async () => {
      if (!active) return
      await refreshPositions()
    })()
    return () => {
      active = false
    }
  }, [pools, refreshPositions])

  React.useEffect(() => {
    const handleAiStakeSourceUpdated = () => {
      void refreshPositions()
    }
    window.addEventListener(AI_STAKE_POSITION_SOURCES_UPDATED_EVENT, handleAiStakeSourceUpdated)
    return () => {
      window.removeEventListener(
        AI_STAKE_POSITION_SOURCES_UPDATED_EVENT,
        handleAiStakeSourceUpdated
      )
    }
  }, [refreshPositions])

  /**
   * Handles `handleStake` logic.
   *
   * @param pool - Input used by `handleStake` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleStake = (pool: StakingPool) => {
    if (pool.symbol === "BTC") {
      notifications.addNotification({
        type: "info",
        title: "Not Available",
        message: "BTC staking is currently unavailable.",
      })
      return
    }
    setSelectedPool(pool)
    setStakeAmount("")
    setStakeSuccess(false)
    setStakeDialogOpen(true)
  }

  /**
   * Handles `handleAmountPreset` logic.
   *
   * @param percent - Input used by `handleAmountPreset` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleAmountPreset = (percent: number) => {
    if (selectedPool) {
      const amount = selectedPool.userBalance * percent / 100
      setStakeAmount(amount.toString())
    }
  }

  const selectedHideTier =
    USDT_POINTS_TIER_OPTIONS.find((option) => option.minUsdt === hideUsdtTierMin) ||
    USDT_POINTS_TIER_OPTIONS[1]

  const resolvePoolUsdPrice = React.useCallback(
    (poolSymbol: string): number => {
      const symbol = poolSymbol.toUpperCase()
      if (symbol === "USDT" || symbol === "USDC") return 1
      const livePrice = tokenPrices[symbol]
      if (Number.isFinite(livePrice) && livePrice > 0) return livePrice
      const fallbackPrice =
        pools.find((pool) => pool.symbol.toUpperCase() === symbol)?.spotPrice ?? 0
      return Number.isFinite(fallbackPrice) && fallbackPrice > 0 ? fallbackPrice : 0
    },
    [pools, tokenPrices]
  )

  const {
    resolveHideBalancePrivacyPayload,
    ensureHideNoteDeposited,
    handleUsePendingHideNote,
    handleWithdrawPendingHideNote,
  } = useStakePrivacy({
    notifications,
    wallet,
    pools,
    selectedPool,
    stakeAmount,
    hideUsdtTierMin,
    setHideUsdtTierMin,
    setSelectedPool,
    setStakeAmount,
    setBalanceHidden,
    setHasTradePrivacyPayload,
    setPendingHideNotes,
    setIsAutoPrivacyProvisioning,
    setPendingNoteActionCommitment,
    setManuallySelectedHideNote,
    clearManuallySelectedHideNote,
    isManuallySelectedHideNote,
    autoPrivacyPayloadPromiseRef,
    resolvePoolTokenAddress,
    resolvePoolUsdPrice,
    poolDecimals: POOL_DECIMALS,
    starknetProviderHint,
  })

  const { submitOnchainStakeTx, submitOnchainClaimTx } = useStakeOnchain({
    notifications,
    starknetProviderHint,
    poolDecimals: POOL_DECIMALS,
    stakingCarelAddress: STARKNET_STAKING_CAREL_ADDRESS,
    stakingStablecoinAddress: STARKNET_STAKING_STABLECOIN_ADDRESS,
    stakingWbtcAddress: STARKNET_STAKING_WBTC_ADDRESS,
    tokenAddresses: {
      carel: TOKEN_CAREL_ADDRESS,
      usdc: TOKEN_USDC_ADDRESS,
      usdt: TOKEN_USDT_ADDRESS,
      wbtc: TOKEN_WBTC_ADDRESS,
      strk: TOKEN_STRK_ADDRESS,
    },
    hideBalancePrivateExecutorEnabled: HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED,
    buildHideBalancePrivacyCall,
    persistTradePrivacyPayload,
    setHasTradePrivacyPayload,
  })

  const { confirmStake, handleUnstake, handleClaim } = useStakeActions({
    notifications,
    wallet,
    pools,
    positions,
    selectedPool,
    stakeAmount,
    balanceHidden,
    hideBalanceRelayerPoolEnabled: HIDE_BALANCE_RELAYER_POOL_ENABLED,
    hideBalanceRelayerApproveMax: HIDE_BALANCE_RELAYER_APPROVE_MAX,
    poolDecimals: POOL_DECIMALS,
    privateActionExecutorAddress: PRIVATE_ACTION_EXECUTOR_ADDRESS,
    privacyRouterAddress: STARKNET_ZK_PRIVACY_ROUTER_ADDRESS,
    starknetProviderHint,
    resolvePoolTokenAddress,
    resolveHideBalancePrivacyPayload,
    ensureHideNoteDeposited,
    submitOnchainStakeTx,
    submitOnchainClaimTx,
    consumeUsedHidePayload,
    loadTradePrivacyPayload,
    isManuallySelectedHideNote,
    clearManuallySelectedHideNote,
    clearTradePrivacyPayload,
    setHasTradePrivacyPayload,
    setPositions,
    setStakeSuccess,
    setIsStaking,
    setClaimingPositionId,
    refreshPositions,
  })

  const selectedPoolSpotUsd =
    selectedPool && selectedPool.symbol
      ? resolvePoolUsdPrice(selectedPool.symbol)
      : 0
  const hideTierLockedStakeAmount =
    balanceHidden && selectedPoolSpotUsd > 0
      ? selectedHideTier.minUsdt / selectedPoolSpotUsd
      : null
  const pendingHideNotesActive = React.useMemo(
    () =>
      pendingHideNotes.filter((note) => {
        const commitment = (note.note_commitment || "").trim()
        return commitment.length > 0
      }),
    [pendingHideNotes]
  )
  const nextCountdownAtMs = React.useMemo(() => {
    const now = Date.now()
    const upcoming = pendingHideNotesActive
      .map((note) => Number(note.spendable_at_unix || 0) * 1000)
      .filter((timestamp) => Number.isFinite(timestamp) && timestamp > now)
    if (upcoming.length === 0) return null
    return Math.min(...upcoming)
  }, [pendingHideNotesActive, countdownTick])
  const hidePayloadStatusLabel = hasTradePrivacyPayload
    ? "payload ready"
    : isAutoPrivacyProvisioning
    ? "preparing payload"
    : "payload auto on submit"
  const hideBalanceCompactSummary = `Tier $${selectedHideTier.minUsdt} (+${selectedHideTier.bonusPercent}%) • ${hidePayloadStatusLabel} • ${pendingHideNotesActive.length} pending notes • Click for details`

  React.useEffect(() => {
    if (!nextCountdownAtMs || !Number.isFinite(nextCountdownAtMs)) return
    const delay = Math.max(0, nextCountdownAtMs - Date.now())
    if (delay <= 0) {
      setCountdownTick(Date.now())
      return
    }
    const timer = window.setTimeout(() => {
      setCountdownTick(Date.now())
    }, Math.min(delay, 2_147_483_647))
    return () => window.clearTimeout(timer)
  }, [nextCountdownAtMs])

  React.useEffect(() => {
    if (!balanceHidden || !selectedPool) return
    if (!Number.isFinite(hideTierLockedStakeAmount || Number.NaN) || (hideTierLockedStakeAmount || 0) <= 0) return

    const decimals = POOL_DECIMALS[selectedPool.symbol.toUpperCase()] ?? 18
    const precision = Math.min(decimals >= 10 ? 8 : 6, 8)
    const nextAmount = Number(hideTierLockedStakeAmount).toFixed(precision).replace(/\.?0+$/, "")
    if (!nextAmount) return

    const currentAmount = Number.parseFloat(stakeAmount || "0")
    const drift = Math.abs(currentAmount - Number(hideTierLockedStakeAmount))
    const tolerance = Math.max(Number(hideTierLockedStakeAmount) * 1e-6, 1e-8)
    if (!Number.isFinite(currentAmount) || drift > tolerance) {
      setStakeAmount(nextAmount)
    }
  }, [balanceHidden, hideTierLockedStakeAmount, selectedPool, stakeAmount])

  const totalStaked = positions.reduce((acc, p) => {
    const price = tokenPrices[p.pool.symbol] ?? 0
    return acc + (p.amount * price)
  }, 0)

  const totalRewards = positions.reduce((acc, p) => {
    const price = tokenPrices[p.pool.symbol] ?? 0
    return acc + (p.rewards * price)
  }, 0)

  const currentCarelStake = positions
    .filter((p) => p.pool.symbol === "CAREL")
    .reduce((acc, p) => acc + p.amount, 0)
  const pointsMultiplier =
    currentCarelStake >= 10_000 ? 5 : currentCarelStake >= 1_000 ? 3 : currentCarelStake >= 100 ? 2 : 1
  const activeDiscountPercent = activeNftDiscount?.discount ?? 0
  const activeDiscountMaxUsage = activeNftDiscount?.max_usage
  const activeDiscountUsed = activeNftDiscount?.used_in_period ?? 0
  const activeDiscountRemainingUsage =
    typeof activeDiscountMaxUsage === "number"
      ? Math.max(0, activeDiscountMaxUsage - activeDiscountUsed)
      : null

  const totalValueLocked = displayPools.reduce((acc, pool) => acc + pool.tvlValue, 0)
  const selectedPoolApyDisplay =
    selectedPool ? selectedPool.apyDisplay ?? apyDisplayFor(selectedPool) : ""

  return (
    <section id="stake" className="py-12">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/20 border border-primary/30 mb-4">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-primary">Testnet Active</span>
          </div>
          <h2 className="text-3xl font-bold text-foreground mb-2">Stake & Earn</h2>
          <p className="text-muted-foreground">Earn passive income from your crypto assets</p>
        </div>

        {/* Stats */}
        <div className="grid md:grid-cols-4 gap-6 mb-8">
          <div className="p-6 rounded-xl glass border border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">Total Value Locked</p>
            </div>
            <p className="text-2xl font-bold text-foreground">
              {totalValueLocked > 0 ? `$${formatCompact(totalValueLocked)}` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Based on pool totals</p>
          </div>

          <div className="p-6 rounded-xl glass border border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-secondary/20 flex items-center justify-center">
                <Coins className="h-5 w-5 text-secondary" />
              </div>
              <p className="text-sm text-muted-foreground">Active Positions</p>
            </div>
            <p className="text-2xl font-bold text-foreground">
              {activePositions > 0 ? activePositions.toLocaleString() : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Active positions</p>
          </div>

          <div className="p-6 rounded-xl glass border border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-accent" />
              </div>
              <p className="text-sm text-muted-foreground">Your Total Staked</p>
            </div>
            <p className="text-2xl font-bold text-foreground">
              {balanceHidden ? "••••••" : totalStaked > 0 ? `$${totalStaked.toLocaleString()}` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{positions.length} active positions</p>
          </div>

          <div className="p-6 rounded-xl glass border border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-success" />
              </div>
              <p className="text-sm text-muted-foreground">Total Rewards</p>
            </div>
            <p className="text-2xl font-bold text-success">
              {balanceHidden ? "••••••" : totalRewards > 0 ? `$${totalRewards.toFixed(2)}` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Ready to claim</p>
          </div>
        </div>

        {/* Info Banner */}
        <div className="mb-8 p-4 rounded-xl bg-secondary/10 border border-secondary/20">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-secondary flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Testnet Mode</p>
              <p className="text-xs text-muted-foreground mt-1">
                Staking uses testnet tokens. Rewards follow testnet contracts and may change based on pool conditions.
              </p>
              <p className="text-xs text-foreground mt-2">
                Active points multiplier: <span className="text-primary font-semibold">{pointsMultiplier}x</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Your CAREL stake: {currentCarelStake.toLocaleString(undefined, { maximumFractionDigits: 4 })} CAREL
              </p>
              <p className="text-xs text-foreground mt-2">
                NFT discount while staking:{" "}
                <span className={cn("font-semibold", activeDiscountPercent > 0 ? "text-success" : "text-muted-foreground")}>
                  {activeDiscountPercent > 0 ? `% active` : "inactive"}
                </span>
              </p>
              {activeDiscountPercent > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Usage in current period: {activeDiscountUsed}
                  {typeof activeDiscountRemainingUsage === "number" ? ` • remaining ${activeDiscountRemainingUsage}` : ""}
                </p>
              )}
              <div className="mt-3 rounded-lg border border-border bg-surface/40 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Hide Balance</p>
                    <p className="text-[11px] text-muted-foreground">
                      Use Garaga privacy call before stake/unstake execution.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBalanceHidden((prev) => !prev)}
                    className={cn(
                      "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
                      balanceHidden
                        ? "border-primary/70 bg-primary/20 text-primary"
                        : "border-border bg-surface text-muted-foreground"
                    )}
                  >
                    {balanceHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {balanceHidden && (
                  <button
                    type="button"
                    onClick={() => setHideBalancePopupOpen(true)}
                    className="mt-2 w-full rounded-lg border border-border bg-surface/30 px-3 py-2 text-left transition-colors hover:border-primary/50"
                  >
                    <p className="text-[11px] text-muted-foreground">{hideBalanceCompactSummary}</p>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Staking Pools */}
        <div className="space-y-6">
          {displayPools.length === 0 ? (
            <div className="p-6 rounded-xl glass border border-border text-center text-muted-foreground">
              No staking pools available
            </div>
          ) : (
            <>
              {/* Stablecoins Section */}
              <div>
                <h3 className="text-lg font-bold text-foreground mb-4">Stablecoins</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  {displayPools
                    .filter((pool) => pool.type === "Stablecoin")
                    .map((pool) => (
                      <StakingCard
                        key={pool.symbol}
                        pool={pool}
                        apyDisplay={pool.apyDisplay ?? apyDisplayFor(pool)}
                        onStake={() => handleStake(pool)}
                        balanceHidden={balanceHidden}
                      />
                    ))}
                </div>
              </div>

              {/* Cryptocurrencies Section */}
              <div>
                <h3 className="text-lg font-bold text-foreground mb-4">Cryptocurrencies</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  {displayPools
                    .filter((pool) => pool.type === "Crypto")
                    .map((pool) => (
                      <StakingCard
                        key={pool.symbol}
                        pool={pool}
                        apyDisplay={pool.apyDisplay ?? apyDisplayFor(pool)}
                        onStake={() => handleStake(pool)}
                        balanceHidden={balanceHidden}
                      />
                    ))}
                </div>
              </div>

            </>
          )}
        </div>

        {/* Your Staking Positions */}
        <div className="mt-12 p-6 rounded-2xl glass-strong border border-border">
          <h3 className="text-lg font-bold text-foreground mb-4">Your Staking Positions</h3>
          
          {positions.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-full bg-muted/20 flex items-center justify-center mx-auto mb-4">
                <Clock className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground">No staking positions yet</p>
              <p className="text-sm text-muted-foreground mt-2">
                Stake your tokens to start earning rewards
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {positions.map((position) => (
                <div key={position.id} className="p-4 rounded-xl bg-surface/50 border border-border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center",
                        position.pool.gradient
                      )}>
                        <span className="text-xl text-white">{position.pool.icon}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-foreground">{position.pool.symbol}</h4>
                          <span className={cn(
                            "px-2 py-0.5 text-xs rounded-full",
                            position.status === "active" ? "bg-success/20 text-success" :
                            position.status === "unlocking" ? "bg-secondary/20 text-secondary" :
                            "bg-muted/20 text-muted-foreground"
                          )}>
                            {position.status === "active" ? "Active" : 
                             position.status === "unlocking" ? "Unlocking..." : "Pending"}
                          </span>
                          {position.requestSource === "ai" ? (
                            <span className="px-2 py-0.5 text-xs rounded-full bg-primary/20 text-primary">
                              AI
                            </span>
                          ) : null}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {balanceHidden ? `•••••• ${position.pool.symbol} staked` : `${position.amount} ${position.pool.symbol} staked`}
                        </p>
                        <p className="text-xs text-muted-foreground">{position.stakedAt}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">APY</p>
                        <p className="text-lg font-bold text-success">{position.pool.apyDisplay ?? apyDisplayFor(position.pool)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Rewards</p>
                        <p className="text-lg font-bold text-foreground">
                          {balanceHidden ? `•••••• ${position.pool.symbol}` : `${position.rewards.toFixed(4)} ${position.pool.symbol}`}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleClaim(position.id)}
                          disabled={claimingPositionId === position.id}
                          className="text-foreground"
                        >
                          {claimingPositionId === position.id ? "Claiming..." : "Claim"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleUnstake(position.id)}
                          disabled={position.status === "unlocking" || claimingPositionId === position.id}
                          className="text-muted-foreground"
                        >
                          {position.status === "unlocking" ? "Unlocking..." : "Unstake"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={hideBalancePopupOpen} onOpenChange={setHideBalancePopupOpen}>
        <DialogContent className="max-w-lg glass-strong border-border max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Hide Balance</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              Add Garaga privacy proof in the same on-chain transaction.
            </p>
            <div className="space-y-2 rounded-lg border border-border bg-surface/40 p-3">
              <p className="text-xs text-foreground">Hide Tier (USDT)</p>
              <div className="grid grid-cols-5 gap-2">
                {USDT_POINTS_TIER_OPTIONS.map((option) => {
                  const selected = selectedHideTier.minUsdt === option.minUsdt
                  return (
                    <button
                      key={option.minUsdt}
                      type="button"
                      onClick={() => setHideUsdtTierMin(option.minUsdt)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-[10px] transition-colors",
                        selected
                          ? "border-primary bg-primary/20 text-primary"
                          : "border-border bg-surface text-muted-foreground hover:border-primary/50"
                      )}
                    >
                      <div>${option.minUsdt}</div>
                      <div>+{option.bonusPercent}%</div>
                    </button>
                  )
                })}
              </div>
              {selectedPool && (
                <p className="text-[11px] text-muted-foreground">
                  Nominal hide stake dikunci ke tier ${selectedHideTier.minUsdt}: ~
                  {hideTierLockedStakeAmount && Number.isFinite(hideTierLockedStakeAmount)
                    ? Number(hideTierLockedStakeAmount).toLocaleString(undefined, {
                        maximumFractionDigits: 6,
                      })
                    : "—"}{" "}
                  {selectedPool.symbol} • Bonus +{selectedHideTier.bonusPercent}%.
                </p>
              )}
            </div>
            <div className="rounded-lg border border-border bg-surface/40 p-3">
              <p className="text-[11px] text-muted-foreground">
                {hasTradePrivacyPayload
                  ? "Garaga payload is ready."
                  : isAutoPrivacyProvisioning
                  ? "Preparing Garaga payload..."
                  : "Garaga payload will be auto-prepared on submit."}
              </p>
            </div>
            {pendingHideNotesActive.length > 0 && (
              <div className="space-y-2 rounded-lg border border-border bg-surface/40 p-3">
                <p className="text-[11px] font-medium text-foreground">
                  Pending Hide Notes ({pendingHideNotesActive.length})
                </p>
                {pendingHideNotesActive.map((note) => {
                  const spendableAtMs = Number(note.spendable_at_unix || 0) * 1000
                  const remainingMs =
                    spendableAtMs > 0 ? Math.max(0, spendableAtMs - Date.now()) : 0
                  const isReady = remainingMs <= 0
                  const isNoteSubmitting =
                    pendingNoteActionCommitment === note.note_commitment
                  const fromSymbol = (note.token_symbol || "Token").toUpperCase()
                  const toSymbol = (note.target_token_symbol || fromSymbol).toUpperCase()
                  return (
                    <div key={note.note_commitment} className="rounded-md border border-border/60 p-2">
                      <p className="text-[10px] font-mono text-muted-foreground">
                        {note.note_commitment.slice(0, 12)}...{note.note_commitment.slice(-6)}
                      </p>
                      <p className="text-[11px] text-foreground">
                        {(note.amount || "—").trim()} {fromSymbol} → {toSymbol} •{" "}
                        {isReady ? (
                          "Ready now"
                        ) : (
                          <>
                            Ready in <Countdown targetMs={spendableAtMs} />
                          </>
                        )}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <Button
                          type="button"
                          className="h-7 flex-1 text-[11px]"
                          onClick={() => void handleUsePendingHideNote(note, confirmStake)}
                          disabled={!isReady || isStaking || isNoteSubmitting}
                        >
                          {isNoteSubmitting ? "Processing..." : "Private Stake now"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-7 flex-1 text-[11px]"
                          onClick={() => void handleWithdrawPendingHideNote(note)}
                          disabled={isStaking || isNoteSubmitting}
                        >
                          Withdraw
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <StakeDialog
        open={stakeDialogOpen}
        onOpenChange={setStakeDialogOpen}
        selectedPool={selectedPool}
        stakeSuccess={stakeSuccess}
        stakeAmount={stakeAmount}
        onStakeAmountChange={(value) => setStakeAmount(value)}
        onAmountPreset={handleAmountPreset}
        balanceHidden={balanceHidden}
        hideBalanceSummary={hideBalanceCompactSummary}
        onOpenHideBalance={() => setHideBalancePopupOpen(true)}
        activeDiscountPercent={activeDiscountPercent}
        isStaking={isStaking}
        isAutoPrivacyProvisioning={isAutoPrivacyProvisioning}
        onConfirmStake={() => void confirmStake()}
        apyDisplay={selectedPoolApyDisplay}
        apyDisplayFallback={apyDisplayFor}
      />
    </section>
  )
}
