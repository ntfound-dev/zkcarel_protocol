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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TrendingUp, Coins, Info, Clock, Check, AlertCircle, Wallet } from "lucide-react"
import { useWallet } from "@/hooks/use-wallet"
import { useNotifications } from "@/hooks/use-notifications"
import { useLivePrices } from "@/hooks/use-live-prices"
import {
  getOwnedNfts,
  getStakePools,
  getStakePositions,
  stakeDeposit,
  stakeWithdraw,
  type NFTItem,
} from "@/lib/api"
import {
  decimalToU256Parts,
  invokeStarknetCallFromWallet,
  invokeStarknetCallsFromWallet,
} from "@/lib/onchain-trade"

const poolMeta: Record<string, { name: string; icon: string; type: string; gradient: string }> = {
  USDT: { name: "Tether", icon: "₮", type: "Stablecoin", gradient: "from-green-400 to-emerald-600" },
  USDC: { name: "USD Coin", icon: "⭕", type: "Stablecoin", gradient: "from-blue-400 to-cyan-600" },
  WBTC: { name: "Wrapped Bitcoin", icon: "₿", type: "Crypto", gradient: "from-orange-400 to-amber-600" },
  BTC: { name: "Bitcoin", icon: "₿", type: "Crypto", gradient: "from-orange-400 to-amber-600" },
  ETH: { name: "Ethereum", icon: "Ξ", type: "Crypto", gradient: "from-purple-400 to-indigo-600" },
  STRK: { name: "StarkNet", icon: "◈", type: "Crypto", gradient: "from-pink-400 to-rose-600" },
  CAREL: { name: "Carel Protocol", icon: "◐", type: "Crypto", gradient: "from-violet-400 to-purple-600" },
}

const STARKNET_STAKING_CAREL_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_STAKING_CAREL_ADDRESS ||
  process.env.NEXT_PUBLIC_STAKING_CAREL_ADDRESS ||
  ""
const STARKNET_STAKING_STABLECOIN_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_STAKING_STABLECOIN_ADDRESS ||
  process.env.NEXT_PUBLIC_STAKING_STABLECOIN_ADDRESS ||
  ""
const STARKNET_STAKING_BTC_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_STAKING_BTC_ADDRESS ||
  process.env.NEXT_PUBLIC_STAKING_BTC_ADDRESS ||
  ""
const TOKEN_CAREL_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_CAREL_ADDRESS ||
  "0x0517f60f4ec4e1b2b748f0f642dfdcb32c0ddc893f777f2b595a4e4f6df51545"
const TOKEN_USDC_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_USDC_ADDRESS ||
  "0x0179cc8cb5ea0b143e17d649e8ad60d80c45c8132c4cf162d57eaf8297f529d8"
const TOKEN_USDT_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_USDT_ADDRESS ||
  "0x030fcbfd1f83fb2d697ad8bdd52e1d55a700b876bed1f4507875539581ed53e5"
const TOKEN_WBTC_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_WBTC_ADDRESS ||
  process.env.NEXT_PUBLIC_TOKEN_BTC_ADDRESS ||
  "0x496bef3ed20371382fbe0ca6a5a64252c5c848f9f1f0cccf8110fc4def912d5"
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

const apyDisplayFor = (pool: StakingPool) => {
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
}

export function StakeEarn() {
  const wallet = useWallet()
  const notifications = useNotifications()
  const [selectedPool, setSelectedPool] = React.useState<StakingPool | null>(null)
  const [stakeDialogOpen, setStakeDialogOpen] = React.useState(false)
  const [stakeAmount, setStakeAmount] = React.useState("")
  const [isStaking, setIsStaking] = React.useState(false)
  const [stakeSuccess, setStakeSuccess] = React.useState(false)
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
          } as StakingPosition
        })
        .filter((item): item is StakingPosition => item !== null)
      setPositions(mapped)
      setActivePositions(mapped.length)
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

  const handleStake = (pool: StakingPool) => {
    if (pool.symbol === "BTC") {
      notifications.addNotification({
        type: "info",
        title: "Coming Soon",
        message: "Native BTC staking will be enabled via Garden API.",
      })
      return
    }
    setSelectedPool(pool)
    setStakeAmount("")
    setStakeSuccess(false)
    setStakeDialogOpen(true)
  }

  const handleAmountPreset = (percent: number) => {
    if (selectedPool) {
      const amount = selectedPool.userBalance * percent / 100
      setStakeAmount(amount.toString())
    }
  }

  const submitOnchainStakeTx = React.useCallback(
    async (poolSymbol: string, entrypoint: "stake" | "unstake", amount: string) => {
      const symbol = poolSymbol.toUpperCase()
      if (symbol === "BTC") {
        throw new Error("Native BTC staking will be enabled via Garden API.")
      }

      const decimals = POOL_DECIMALS[symbol] ?? 18
      const [amountLow, amountHigh] = decimalToU256Parts(amount, decimals)
      const isStake = entrypoint === "stake"

      if (symbol === "CAREL") {
        if (!STARKNET_STAKING_CAREL_ADDRESS) {
          throw new Error(
            "NEXT_PUBLIC_STARKNET_STAKING_CAREL_ADDRESS is not set. Configure CAREL staking contract address in frontend/.env.local."
          )
        }
        if (isStake) {
          return invokeStarknetCallsFromWallet(
            [
              {
                contractAddress: TOKEN_CAREL_ADDRESS,
                entrypoint: "approve",
                calldata: [STARKNET_STAKING_CAREL_ADDRESS, amountLow, amountHigh],
              },
              {
                contractAddress: STARKNET_STAKING_CAREL_ADDRESS,
                entrypoint: "stake",
                calldata: [amountLow, amountHigh],
              },
            ],
            starknetProviderHint
          )
        }
        return invokeStarknetCallFromWallet(
          {
            contractAddress: STARKNET_STAKING_CAREL_ADDRESS,
            entrypoint,
            calldata: [amountLow, amountHigh],
          },
          starknetProviderHint
        )
      }

      if (symbol === "USDC" || symbol === "USDT" || symbol === "STRK") {
        if (!STARKNET_STAKING_STABLECOIN_ADDRESS) {
          throw new Error(
            "NEXT_PUBLIC_STARKNET_STAKING_STABLECOIN_ADDRESS is not set for stablecoin staking."
          )
        }
        const tokenAddress =
          symbol === "USDC"
            ? TOKEN_USDC_ADDRESS
            : symbol === "USDT"
            ? TOKEN_USDT_ADDRESS
            : TOKEN_STRK_ADDRESS
        if (isStake) {
          return invokeStarknetCallsFromWallet(
            [
              {
                contractAddress: tokenAddress,
                entrypoint: "approve",
                calldata: [STARKNET_STAKING_STABLECOIN_ADDRESS, amountLow, amountHigh],
              },
              {
                contractAddress: STARKNET_STAKING_STABLECOIN_ADDRESS,
                entrypoint: "stake",
                calldata: [tokenAddress, amountLow, amountHigh],
              },
            ],
            starknetProviderHint
          )
        }
        return invokeStarknetCallFromWallet(
          {
            contractAddress: STARKNET_STAKING_STABLECOIN_ADDRESS,
            entrypoint,
            calldata: [tokenAddress, amountLow, amountHigh],
          },
          starknetProviderHint
        )
      }

      if (symbol === "WBTC") {
        if (!STARKNET_STAKING_BTC_ADDRESS) {
          throw new Error(
            "NEXT_PUBLIC_STARKNET_STAKING_BTC_ADDRESS is not set for WBTC staking."
          )
        }
        if (isStake) {
          return invokeStarknetCallsFromWallet(
            [
              {
                contractAddress: TOKEN_WBTC_ADDRESS,
                entrypoint: "approve",
                calldata: [STARKNET_STAKING_BTC_ADDRESS, amountLow, amountHigh],
              },
              {
                contractAddress: STARKNET_STAKING_BTC_ADDRESS,
                entrypoint: "stake",
                calldata: [TOKEN_WBTC_ADDRESS, amountLow, amountHigh],
              },
            ],
            starknetProviderHint
          )
        }
        return invokeStarknetCallFromWallet(
          {
            contractAddress: STARKNET_STAKING_BTC_ADDRESS,
            entrypoint,
            calldata: [TOKEN_WBTC_ADDRESS, amountLow, amountHigh],
          },
          starknetProviderHint
        )
      }

      throw new Error(`Pool ${symbol} is not supported for on-chain staking.`)
    },
    [starknetProviderHint]
  )

  const confirmStake = async () => {
    if (!selectedPool) return
    if (selectedPool.symbol === "BTC") {
      notifications.addNotification({
        type: "info",
        title: "Coming Soon",
        message: "Native BTC staking will be enabled via Garden API.",
      })
      return
    }
    
    setIsStaking(true)
    try {
      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message: "Confirm staking transaction in your Starknet wallet.",
      })
      const onchainTxHash = await submitOnchainStakeTx(selectedPool.symbol, "stake", stakeAmount)
      notifications.addNotification({
        type: "info",
        title: "Staking pending",
        message: `Stake ${stakeAmount} ${selectedPool.symbol} submitted on-chain (${onchainTxHash.slice(0, 10)}...).`,
        txHash: onchainTxHash,
        txNetwork: "starknet",
      })
      await stakeDeposit({
        pool_id: selectedPool.symbol,
        amount: stakeAmount,
        onchain_tx_hash: onchainTxHash,
      })
      await Promise.allSettled([wallet.refreshPortfolio(), wallet.refreshOnchainBalances()])
      await refreshPositions()
      setStakeSuccess(true)
      notifications.addNotification({
        type: "success",
        title: "Staking successful",
        message: `Stake   completed successfully`,
        txHash: onchainTxHash,
        txNetwork: "starknet",
      })
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Staking failed",
        message: error instanceof Error ? error.message : "Unable to complete staking",
      })
    } finally {
      setIsStaking(false)
    }
  }

  const handleUnstake = async (positionId: string) => {
    const target = positions.find((pos) => pos.id === positionId)
    if (!target) return

    setPositions((prev) =>
      prev.map((p) => (p.id === positionId ? { ...p, status: "unlocking" as const } : p))
    )

    try {
      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message: "Confirm unstake transaction in your Starknet wallet.",
      })
      const onchainTxHash = await submitOnchainStakeTx(target.pool.symbol, "unstake", target.amount.toString())
      notifications.addNotification({
        type: "info",
        title: "Unstake pending",
        message: `${target.amount} ${target.pool.symbol} submitted on-chain (${onchainTxHash.slice(0, 10)}...).`,
        txHash: onchainTxHash,
        txNetwork: "starknet",
      })
      await stakeWithdraw({
        position_id: positionId,
        amount: target.amount.toString(),
        onchain_tx_hash: onchainTxHash,
      })
      await Promise.allSettled([wallet.refreshPortfolio(), wallet.refreshOnchainBalances()])
      await refreshPositions()
      notifications.addNotification({
        type: "success",
        title: "Unstake processing",
        message: `${target.amount} ${target.pool.symbol} is being processed`,
        txHash: onchainTxHash,
        txNetwork: "starknet",
      })
    } catch (error) {
      setPositions((prev) =>
        prev.map((p) => (p.id === positionId ? { ...p, status: "active" as const } : p))
      )
      notifications.addNotification({
        type: "error",
        title: "Unstake failed",
        message: error instanceof Error ? error.message : "Unable to complete unstake",
      })
    }
  }

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
              {totalStaked > 0 ? `$${totalStaked.toLocaleString()}` : "—"}
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
              {totalRewards > 0 ? `$${totalRewards.toFixed(2)}` : "—"}
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
              <p className="text-xs text-muted-foreground mt-1">
                Native BTC staking route is being prepared via Garden API.
              </p>
              <p className="text-xs text-foreground mt-2">
                Active points multiplier (swap/bridge/limit): <span className="text-primary font-semibold">{pointsMultiplier}x</span>
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
                      <StakingCard key={pool.symbol} pool={pool} onStake={() => handleStake(pool)} />
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
                      <StakingCard key={pool.symbol} pool={pool} onStake={() => handleStake(pool)} />
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
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {position.amount} {position.pool.symbol} staked
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
                          {position.rewards.toFixed(4)} {position.pool.symbol}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleUnstake(position.id)}
                          disabled={position.status === "unlocking"}
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

      {/* Stake Dialog */}
      <Dialog open={stakeDialogOpen} onOpenChange={setStakeDialogOpen}>
        <DialogContent className="max-w-md glass-strong border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedPool && (
                <>
                  <div className={cn(
                    "w-8 h-8 rounded-full bg-gradient-to-br flex items-center justify-center",
                    selectedPool.gradient
                  )}>
                    <span className="text-lg text-white">{selectedPool.icon}</span>
                  </div>
                  Stake {selectedPool.symbol}
                </>
              )}
            </DialogTitle>
          </DialogHeader>

          {stakeSuccess ? (
            <div className="py-8 text-center">
              <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
                <Check className="h-8 w-8 text-success" />
              </div>
              <p className="text-lg font-medium text-foreground">Staking Successful!</p>
              <p className="text-sm text-muted-foreground mt-2">
                {stakeAmount} {selectedPool?.symbol} has been staked
              </p>
              <Button
                onClick={() => setStakeDialogOpen(false)}
                className="mt-4"
              >
                Close
              </Button>
            </div>
          ) : (
            <Tabs defaultValue="stake">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="stake">Stake</TabsTrigger>
                <TabsTrigger value="info">Pool Info</TabsTrigger>
              </TabsList>

              <TabsContent value="stake" className="space-y-4">
                {selectedPool && (
                  <>
                    <div className="p-4 rounded-xl bg-surface/50 border border-border">
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-muted-foreground">APY</span>
                        <span className="text-lg font-bold text-success">{selectedPool.apyDisplay ?? apyDisplayFor(selectedPool)}</span>
                      </div>
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-muted-foreground">Lock Period</span>
                        <span className="text-sm font-medium text-foreground">{selectedPool.lockPeriod}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Min. Stake</span>
                        <span className="text-sm font-medium text-foreground">{selectedPool.minStake} {selectedPool.symbol}</span>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between mb-2">
                        <label className="text-sm font-medium text-foreground">Amount</label>
                        <span className="text-xs text-muted-foreground">
                          Balance: {selectedPool.userBalance.toLocaleString()} {selectedPool.symbol}
                        </span>
                      </div>
                      <input
                        type="number"
                        value={stakeAmount}
                        onChange={(e) => setStakeAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                      <div className="flex gap-2 mt-2">
                        {[25, 50, 75, 100].map((percent) => (
                          <button
                            key={percent}
                            onClick={() => handleAmountPreset(percent)}
                            className="flex-1 px-2 py-1 text-xs rounded-md bg-surface text-muted-foreground hover:text-foreground hover:bg-surface/80 transition-colors"
                          >
                            {percent}%
                          </button>
                        ))}
                      </div>
                    </div>

                    {Number.parseFloat(stakeAmount) > 0 && (
                      <div className="p-3 rounded-lg bg-success/10 border border-success/20">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Estimated Reward/Month</span>
                          <span className="font-medium text-success">
                            {(Number.parseFloat(stakeAmount) * Number.parseFloat(selectedPool.apy) / 100 / 12).toFixed(4)} {selectedPool.symbol}
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                      <p className="text-xs text-foreground">
                        {activeDiscountPercent > 0
                          ? `NFT discount ${activeDiscountPercent}% is active. Usage decreases only after successful on-chain stake/unstake transactions.`
                          : "NFT discount is inactive. Mint an NFT tier to activate discount usage."}
                      </p>
                    </div>

                    <div className="p-3 rounded-lg bg-secondary/10 border border-secondary/20">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-secondary flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-foreground">
                          Testnet token. Rewards follow testnet contracts.
                        </p>
                      </div>
                    </div>

                    <Button
                      onClick={confirmStake}
                      disabled={!stakeAmount || Number.parseFloat(stakeAmount) < Number.parseFloat(selectedPool.minStake) || isStaking}
                      className="w-full bg-primary hover:bg-primary/90"
                    >
                      {isStaking ? "Processing..." : `Stake ${selectedPool.symbol}`}
                    </Button>
                  </>
                )}
              </TabsContent>

              <TabsContent value="info" className="space-y-4">
                {selectedPool && (
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-surface/50 border border-border">
                      <h4 className="font-medium text-foreground mb-3">Pool Details</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Total Staked</span>
                          <span className="text-sm font-medium text-foreground">{selectedPool.tvl}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">APY</span>
                          <span className="text-sm font-medium text-success">{selectedPool.apyDisplay ?? apyDisplayFor(selectedPool)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Lock Period</span>
                          <span className="text-sm font-medium text-foreground">{selectedPool.lockPeriod}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Min. Stake</span>
                          <span className="text-sm font-medium text-foreground">{selectedPool.minStake} {selectedPool.symbol}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Reward Token</span>
                          <span className="text-sm font-medium text-foreground">{selectedPool.reward}</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-surface/50 border border-border">
                      <h4 className="font-medium text-foreground mb-3">How It Works</h4>
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        <li className="flex items-start gap-2">
                          <span className="text-primary">1.</span>
                          Stake your tokens in the pool
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-primary">2.</span>
                          Rewards accumulate every block
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-primary">3.</span>
                          Claim rewards anytime
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-primary">4.</span>
                          Unstake after lock period is complete
                        </li>
                      </ul>
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}

function StakingCard({ pool, onStake }: { pool: StakingPool; onStake: () => void }) {
  return (
    <div className="p-6 rounded-xl glass border border-border hover:border-primary/30 transition-all group">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={cn("w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center", pool.gradient)}>
            <span className="text-2xl text-white">{pool.icon}</span>
          </div>
          <div>
            <h4 className="font-bold text-foreground">{pool.symbol}</h4>
            <p className="text-sm text-muted-foreground">{pool.name}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">APY</p>
          <p className="text-2xl font-bold text-success">{pool.apyDisplay ?? apyDisplayFor(pool)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <p className="text-xs text-muted-foreground">Total Staked</p>
          <p className="text-sm font-medium text-foreground">{pool.tvl}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Harga Spot</p>
          <p className="text-sm font-medium text-foreground">
            {pool.spotPrice > 0 ? `$${pool.spotPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Min. Stake</p>
          <p className="text-sm font-medium text-foreground">
            {pool.minStake} {pool.symbol}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Lock Period</p>
          <p className="text-sm font-medium text-foreground">{pool.lockPeriod}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Your Balance</p>
          <p className="text-sm font-medium text-foreground">{pool.userBalance.toLocaleString()}</p>
        </div>
      </div>

      <Button
        onClick={onStake}
        className="w-full bg-primary hover:bg-primary/90"
      >
        Stake {pool.symbol}
      </Button>
    </div>
  )
}
