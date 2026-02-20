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
import { TrendingUp, Coins, Info, Clock, Check, AlertCircle, Wallet, Eye, EyeOff } from "lucide-react"
import { useWallet } from "@/hooks/use-wallet"
import { useNotifications } from "@/hooks/use-notifications"
import { useLivePrices } from "@/hooks/use-live-prices"
import {
  autoSubmitPrivacyAction,
  getOwnedNfts,
  preparePrivateExecution,
  getStakePools,
  getStakePositions,
  stakeClaim,
  stakeDeposit,
  stakeWithdraw,
  type NFTItem,
  type PrivacyVerificationPayload,
} from "@/lib/api"
import {
  decimalToU256Parts,
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

const TRADE_PRIVACY_PAYLOAD_KEY = "trade_privacy_garaga_payload_v2"
const DEV_AUTO_GARAGA_PAYLOAD_ENABLED =
  process.env.NODE_ENV !== "production" &&
  (process.env.NEXT_PUBLIC_ENABLE_DEV_GARAGA_AUTOFILL || "false").toLowerCase() === "true"
const STARKNET_ZK_PRIVACY_ROUTER_ADDRESS =
  process.env.NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS ||
  process.env.NEXT_PUBLIC_PRIVACY_ROUTER_ADDRESS ||
  ""
const PRIVATE_ACTION_EXECUTOR_ADDRESS =
  (process.env.NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim()
const HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED =
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED || "false").toLowerCase() ===
    "true" && PRIVATE_ACTION_EXECUTOR_ADDRESS.length > 0
const HIDE_BALANCE_RELAYER_POOL_ENABLED =
  (process.env.NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_ENABLED || "true").toLowerCase() === "true"

const normalizeHexArray = (values?: string[] | null): string[] => {
  if (!Array.isArray(values)) return []
  return values
    .map((value) => (typeof value === "string" ? value.trim() : String(value ?? "").trim()))
    .filter((value) => value.length > 0)
}

const loadTradePrivacyPayload = (): PrivacyVerificationPayload | undefined => {
  if (typeof window === "undefined") return undefined
  try {
    const raw = window.localStorage.getItem(TRADE_PRIVACY_PAYLOAD_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as PrivacyVerificationPayload
    const nullifier = parsed.nullifier?.trim()
    const commitment = parsed.commitment?.trim()
    const proof = normalizeHexArray(parsed.proof)
    const publicInputs = normalizeHexArray(parsed.public_inputs)
    if (!nullifier || !commitment || proof.length === 0 || publicInputs.length === 0) return undefined
    if (
      proof.length === 1 &&
      publicInputs.length === 1 &&
      proof[0]?.toLowerCase() === "0x1" &&
      publicInputs[0]?.toLowerCase() === "0x1"
    ) {
      window.localStorage.removeItem(TRADE_PRIVACY_PAYLOAD_KEY)
      return undefined
    }
    return {
      verifier: (parsed.verifier || "garaga").trim() || "garaga",
      nullifier,
      commitment,
      proof,
      public_inputs: publicInputs,
    }
  } catch {
    return undefined
  }
}

/**
 * Handles `persistTradePrivacyPayload` logic.
 *
 * @param payload - Input used by `persistTradePrivacyPayload` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const persistTradePrivacyPayload = (payload: PrivacyVerificationPayload) => {
  if (typeof window === "undefined") return
  window.localStorage.setItem(TRADE_PRIVACY_PAYLOAD_KEY, JSON.stringify(payload))
  window.dispatchEvent(new Event("trade-privacy-payload-updated"))
}

/**
 * Handles `randomHexFelt` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const randomHexFelt = () => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `0x${hex.replace(/^0+/, "") || "1"}`
}

const createDevTradePrivacyPayload = (): PrivacyVerificationPayload => ({
  verifier: "garaga",
  nullifier: randomHexFelt(),
  commitment: randomHexFelt(),
  proof: ["0x1"],
  public_inputs: ["0x1"],
})

/**
 * Builds inputs required by `buildHideBalancePrivacyCall`.
 *
 * @param payload - Input used by `buildHideBalancePrivacyCall` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const buildHideBalancePrivacyCall = (payload: PrivacyVerificationPayload) => {
  const router = STARKNET_ZK_PRIVACY_ROUTER_ADDRESS.trim()
  if (!router) {
    throw new Error(
      "NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS is not configured. Hide Balance requires privacy router address."
    )
  }
  const nullifier = payload.nullifier?.trim() || ""
  const commitment = payload.commitment?.trim() || ""
  const proof = normalizeHexArray(payload.proof)
  const publicInputs = normalizeHexArray(payload.public_inputs)
  if (!nullifier || !commitment || !proof.length || !publicInputs.length) {
    throw new Error(
      "Hide Balance requires complete Garaga payload (nullifier, commitment, proof, public_inputs)."
    )
  }
  return {
    contractAddress: router,
    entrypoint: "submit_private_action",
    calldata: [nullifier, commitment, String(proof.length), ...proof, String(publicInputs.length), ...publicInputs],
  }
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
const apyDisplayFor = (pool: StakingPool) => {
  if (pool.symbol === "CAREL") return "8% - 15%"
  return `${pool.apy}%`
}

/**
 * Handles `mapStakeUiErrorMessage` logic.
 *
 * @param error - Input used by `mapStakeUiErrorMessage` to compute state, payload, or request behavior.
 * @param fallback - Input used by `mapStakeUiErrorMessage` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
const mapStakeUiErrorMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : String(error ?? "")
  const normalized = message.toLowerCase()
  const operation = fallback.toLowerCase()

  if (normalized.includes("erc20: insufficient balance")) {
    if (operation.includes("claim")) {
      return "Claim failed because staking reward liquidity is insufficient on-chain. Top up reward pool balance, then retry."
    }
    if (operation.includes("unstake")) {
      return "Unstake failed because pool liquidity is insufficient on-chain. Try a smaller amount, then retry."
    }
    if (operation.includes("stake")) {
      return "Staking failed because your wallet token balance is insufficient."
    }
    return "Transaction failed because token balance is insufficient."
  }
  if (normalized.includes("erc20: insufficient allowance")) {
    return "Token allowance is insufficient. Approve token spending first, then retry."
  }
  if (normalized.includes("argent/multicall-failed")) {
    return `Wallet multicall failed: ${message}`
  }
  return message || fallback
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
  const [hasTradePrivacyPayload, setHasTradePrivacyPayload] = React.useState(false)
  const [isAutoPrivacyProvisioning, setIsAutoPrivacyProvisioning] = React.useState(false)
  const autoPrivacyPayloadPromiseRef = React.useRef<Promise<PrivacyVerificationPayload | undefined> | null>(null)
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

  const refreshTradePrivacyPayload = React.useCallback(() => {
    setHasTradePrivacyPayload(Boolean(loadTradePrivacyPayload()))
  }, [])

  const resolveHideBalancePrivacyPayload = React.useCallback(async (txContext?: {
    flow?: string
    fromToken?: string
    toToken?: string
    amount?: string
  }): Promise<PrivacyVerificationPayload | undefined> => {
    if (autoPrivacyPayloadPromiseRef.current) return autoPrivacyPayloadPromiseRef.current

    /**
     * Handles `task` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const task = (async () => {
      if (DEV_AUTO_GARAGA_PAYLOAD_ENABLED) {
        const generated = createDevTradePrivacyPayload()
        persistTradePrivacyPayload(generated)
        setHasTradePrivacyPayload(true)
        return generated
      }

      if (!wallet.isConnected) return undefined

      setIsAutoPrivacyProvisioning(true)
      try {
        const response = await autoSubmitPrivacyAction({
          verifier: "garaga",
          submit_onchain: false,
          tx_context: {
            flow: txContext?.flow || "stake",
            from_token: txContext?.fromToken || selectedPool?.symbol,
            to_token: txContext?.toToken || selectedPool?.symbol,
            amount: txContext?.amount || stakeAmount || undefined,
            from_network: "starknet",
            to_network: "starknet",
          },
        })
        const payload: PrivacyVerificationPayload = {
          verifier: (response.payload?.verifier || "garaga").trim() || "garaga",
          nullifier: response.payload?.nullifier?.trim(),
          commitment: response.payload?.commitment?.trim(),
          proof: normalizeHexArray(response.payload?.proof),
          public_inputs: normalizeHexArray(response.payload?.public_inputs),
        }
        const proof = normalizeHexArray(payload.proof)
        const publicInputs = normalizeHexArray(payload.public_inputs)
        if (!payload.nullifier || !payload.commitment || !proof.length || !publicInputs.length) {
          throw new Error("Auto Garaga payload is incomplete from backend.")
        }
        if (
          proof.length === 1 &&
          publicInputs.length === 1 &&
          proof[0]?.toLowerCase() === "0x1" &&
          publicInputs[0]?.toLowerCase() === "0x1"
        ) {
          throw new Error("Auto Garaga payload from backend is still dummy (0x1).")
        }
        const normalizedPayload: PrivacyVerificationPayload = {
          verifier: payload.verifier,
          nullifier: payload.nullifier,
          commitment: payload.commitment,
          proof,
          public_inputs: publicInputs,
        }
        persistTradePrivacyPayload(normalizedPayload)
        setHasTradePrivacyPayload(true)
        return normalizedPayload
      } catch (error) {
        notifications.addNotification({
          type: "error",
          title: "Auto Garaga payload failed",
          message: error instanceof Error ? error.message : "Unable to prepare Garaga payload automatically.",
        })
        return undefined
      } finally {
        setIsAutoPrivacyProvisioning(false)
      }
    })()

    autoPrivacyPayloadPromiseRef.current = task
    try {
      return await task
    } finally {
      autoPrivacyPayloadPromiseRef.current = null
    }
  }, [notifications, selectedPool?.symbol, stakeAmount, wallet.isConnected])

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
    window.addEventListener("trade-privacy-payload-updated", refreshTradePrivacyPayload)
    return () => {
      window.removeEventListener("trade-privacy-payload-updated", refreshTradePrivacyPayload)
    }
  }, [refreshTradePrivacyPayload])

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
        message: "BTC staking is disabled. Use Bridge via Garden for BTC<->WBTC transfers.",
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

  const submitOnchainStakeTx = React.useCallback(
    async (
      poolSymbol: string,
      entrypoint: "stake" | "unstake",
      amount: string,
      privacyPayload?: PrivacyVerificationPayload
    ): Promise<{ txHash: string; privacyPayload?: PrivacyVerificationPayload }> => {
      const symbol = poolSymbol.toUpperCase()
      if (symbol === "BTC") {
        throw new Error("Native BTC staking will be enabled via Garden API.")
      }

      const decimals = POOL_DECIMALS[symbol] ?? 18
      const [amountLow, amountHigh] = decimalToU256Parts(amount, decimals)
      const isStake = entrypoint === "stake"

      const invokeWithHideMode = async (
        calls: Array<{ contractAddress: string; entrypoint: string; calldata: string[] }>
      ): Promise<{ txHash: string; privacyPayload?: PrivacyVerificationPayload }> => {
        if (!privacyPayload) {
          const txHash = await invokeStarknetCallsFromWallet(calls, starknetProviderHint)
          return { txHash }
        }

        if (HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED && calls.length > 0) {
          try {
            const actionCall = calls[calls.length - 1]
            const preCalls = calls.length > 1 ? calls.slice(0, calls.length - 1) : []
            const preparedPrivate = await preparePrivateExecution({
              verifier: (privacyPayload.verifier || "garaga").trim() || "garaga",
              flow: "stake",
              action_entrypoint: actionCall.entrypoint,
              action_calldata: actionCall.calldata,
              tx_context: {
                flow: isStake ? "stake" : "unstake",
                from_token: symbol,
                to_token: symbol,
                amount,
                from_network: "starknet",
                to_network: "starknet",
              },
            })
            const preparedPayload: PrivacyVerificationPayload = {
              verifier: (preparedPrivate.payload?.verifier || "garaga").trim() || "garaga",
              nullifier: preparedPrivate.payload?.nullifier?.trim(),
              commitment: preparedPrivate.payload?.commitment?.trim(),
              proof: normalizeHexArray(preparedPrivate.payload?.proof),
              public_inputs: normalizeHexArray(preparedPrivate.payload?.public_inputs),
            }
            persistTradePrivacyPayload(preparedPayload)
            setHasTradePrivacyPayload(true)
            const executorCalls = preparedPrivate.onchain_calls.map((call) => ({
              contractAddress: call.contract_address,
              entrypoint: call.entrypoint,
              calldata: call.calldata.map((item) => String(item)),
            }))
            const txHash = await invokeStarknetCallsFromWallet(
              [...preCalls, ...executorCalls],
              starknetProviderHint
            )
            return { txHash, privacyPayload: preparedPayload }
          } catch (error) {
            notifications.addNotification({
              type: "warning",
              title: "Private executor fallback",
              message:
                error instanceof Error
                  ? `Using legacy privacy call path: ${error.message}`
                  : "Using legacy privacy call path.",
            })
          }
        }

        const txHash = await invokeStarknetCallsFromWallet(
          [buildHideBalancePrivacyCall(privacyPayload), ...calls],
          starknetProviderHint
        )
        return { txHash, privacyPayload }
      }

      if (symbol === "CAREL") {
        if (!STARKNET_STAKING_CAREL_ADDRESS) {
          throw new Error(
            "NEXT_PUBLIC_STARKNET_STAKING_CAREL_ADDRESS is not set. Configure CAREL staking contract address in frontend/.env.local."
          )
        }
        if (isStake) {
          return invokeWithHideMode([
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
          ])
        }
        return invokeWithHideMode([
          {
            contractAddress: STARKNET_STAKING_CAREL_ADDRESS,
            entrypoint,
            calldata: [amountLow, amountHigh],
          },
        ])
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
          return invokeWithHideMode([
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
          ])
        }
        return invokeWithHideMode([
          {
            contractAddress: STARKNET_STAKING_STABLECOIN_ADDRESS,
            entrypoint,
            calldata: [tokenAddress, amountLow, amountHigh],
          },
        ])
      }

      if (symbol === "WBTC") {
        if (!STARKNET_STAKING_BTC_ADDRESS) {
          throw new Error(
            "NEXT_PUBLIC_STARKNET_STAKING_BTC_ADDRESS is not set for WBTC staking."
          )
        }
        if (!TOKEN_WBTC_ADDRESS) {
          throw new Error(
            "NEXT_PUBLIC_TOKEN_WBTC_ADDRESS is not set. Configure the real Starknet WBTC token address."
          )
        }
        if (isStake) {
          return invokeWithHideMode([
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
          ])
        }
        return invokeWithHideMode([
          {
            contractAddress: STARKNET_STAKING_BTC_ADDRESS,
            entrypoint,
            calldata: [TOKEN_WBTC_ADDRESS, amountLow, amountHigh],
          },
        ])
      }

      throw new Error(`Pool ${symbol} is not supported for on-chain staking.`)
    },
    [notifications, starknetProviderHint]
  )

  const submitOnchainClaimTx = React.useCallback(
    async (
      poolSymbol: string,
      privacyPayload?: PrivacyVerificationPayload
    ): Promise<{ txHash: string; privacyPayload?: PrivacyVerificationPayload }> => {
      const symbol = poolSymbol.toUpperCase()
      if (symbol === "BTC") {
        throw new Error("Native BTC staking will be enabled via Garden API.")
      }

      const invokeWithHideMode = async (
        calls: Array<{ contractAddress: string; entrypoint: string; calldata: string[] }>
      ): Promise<{ txHash: string; privacyPayload?: PrivacyVerificationPayload }> => {
        if (!privacyPayload) {
          const txHash = await invokeStarknetCallsFromWallet(calls, starknetProviderHint)
          return { txHash }
        }

        if (HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED && calls.length > 0) {
          try {
            const actionCall = calls[calls.length - 1]
            const preCalls = calls.length > 1 ? calls.slice(0, calls.length - 1) : []
            const preparedPrivate = await preparePrivateExecution({
              verifier: (privacyPayload.verifier || "garaga").trim() || "garaga",
              flow: "stake",
              action_entrypoint: actionCall.entrypoint,
              action_calldata: actionCall.calldata,
              tx_context: {
                flow: "stake_claim",
                from_token: symbol,
                to_token: symbol,
                from_network: "starknet",
                to_network: "starknet",
              },
            })
            const preparedPayload: PrivacyVerificationPayload = {
              verifier: (preparedPrivate.payload?.verifier || "garaga").trim() || "garaga",
              nullifier: preparedPrivate.payload?.nullifier?.trim(),
              commitment: preparedPrivate.payload?.commitment?.trim(),
              proof: normalizeHexArray(preparedPrivate.payload?.proof),
              public_inputs: normalizeHexArray(preparedPrivate.payload?.public_inputs),
            }
            persistTradePrivacyPayload(preparedPayload)
            setHasTradePrivacyPayload(true)
            const executorCalls = preparedPrivate.onchain_calls.map((call) => ({
              contractAddress: call.contract_address,
              entrypoint: call.entrypoint,
              calldata: call.calldata.map((item) => String(item)),
            }))
            const txHash = await invokeStarknetCallsFromWallet(
              [...preCalls, ...executorCalls],
              starknetProviderHint
            )
            return { txHash, privacyPayload: preparedPayload }
          } catch (error) {
            notifications.addNotification({
              type: "warning",
              title: "Private executor fallback",
              message:
                error instanceof Error
                  ? `Using legacy privacy call path: ${error.message}`
                  : "Using legacy privacy call path.",
            })
          }
        }

        const txHash = await invokeStarknetCallsFromWallet(
          [buildHideBalancePrivacyCall(privacyPayload), ...calls],
          starknetProviderHint
        )
        return { txHash, privacyPayload }
      }

      if (symbol === "CAREL") {
        if (!STARKNET_STAKING_CAREL_ADDRESS) {
          throw new Error(
            "NEXT_PUBLIC_STARKNET_STAKING_CAREL_ADDRESS is not set. Configure CAREL staking contract address in frontend/.env.local."
          )
        }
        return invokeWithHideMode([
          {
            contractAddress: STARKNET_STAKING_CAREL_ADDRESS,
            entrypoint: "claim_rewards",
            calldata: [],
          },
        ])
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
        return invokeWithHideMode([
          {
            contractAddress: STARKNET_STAKING_STABLECOIN_ADDRESS,
            entrypoint: "claim_rewards",
            calldata: [tokenAddress],
          },
        ])
      }

      if (symbol === "WBTC") {
        if (!STARKNET_STAKING_BTC_ADDRESS) {
          throw new Error(
            "NEXT_PUBLIC_STARKNET_STAKING_BTC_ADDRESS is not set for WBTC staking."
          )
        }
        if (!TOKEN_WBTC_ADDRESS) {
          throw new Error(
            "NEXT_PUBLIC_TOKEN_WBTC_ADDRESS is not set. Configure the real Starknet WBTC token address."
          )
        }
        return invokeWithHideMode([
          {
            contractAddress: STARKNET_STAKING_BTC_ADDRESS,
            entrypoint: "claim_rewards",
            calldata: [TOKEN_WBTC_ADDRESS],
          },
        ])
      }

      throw new Error(`Pool ${symbol} is not supported for staking reward claim.`)
    },
    [notifications, starknetProviderHint]
  )

  /**
   * Handles `confirmStake` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const confirmStake = async () => {
    if (!selectedPool) return
    if (selectedPool.symbol === "BTC") {
      notifications.addNotification({
        type: "info",
        title: "Not Available",
        message: "BTC staking is disabled. Use Bridge via Garden for BTC<->WBTC transfers.",
      })
      return
    }
    
    setIsStaking(true)
    try {
      const effectiveHideBalance = balanceHidden
      const useRelayerPoolHide = effectiveHideBalance && HIDE_BALANCE_RELAYER_POOL_ENABLED
      const resolvedPrivacyPayload = effectiveHideBalance
        ? await resolveHideBalancePrivacyPayload({
            flow: "stake",
            fromToken: selectedPool.symbol,
            toToken: selectedPool.symbol,
            amount: stakeAmount,
          })
        : undefined
      if (effectiveHideBalance && !resolvedPrivacyPayload) {
        throw new Error("Garaga payload is not ready for Hide Balance. Check backend auto-proof config.")
      }
      let onchainTxHash: string | undefined
      let payloadForBackend = resolvedPrivacyPayload
      if (!useRelayerPoolHide) {
        notifications.addNotification({
          type: "info",
          title: "Wallet signature required",
          message: "Confirm staking transaction in your Starknet wallet.",
        })
        const submitted = await submitOnchainStakeTx(
          selectedPool.symbol,
          "stake",
          stakeAmount,
          resolvedPrivacyPayload
        )
        onchainTxHash = submitted.txHash
        payloadForBackend = submitted.privacyPayload || resolvedPrivacyPayload
        notifications.addNotification({
          type: "info",
          title: "Staking pending",
          message: `Stake ${stakeAmount} ${selectedPool.symbol} submitted on-chain (${onchainTxHash.slice(0, 10)}...).`,
          txHash: onchainTxHash,
          txNetwork: "starknet",
        })
      } else {
        notifications.addNotification({
          type: "info",
          title: "Submitting private stake",
          message: "Submitting hide-mode stake via Starknet relayer pool.",
        })
      }
      const response = await stakeDeposit({
        pool_id: selectedPool.symbol,
        amount: stakeAmount,
        onchain_tx_hash: onchainTxHash,
        hide_balance: effectiveHideBalance,
        privacy: effectiveHideBalance
          ? payloadForBackend || resolvedPrivacyPayload
          : undefined,
      })
      const finalTxHash = response.tx_hash || onchainTxHash
      if (useRelayerPoolHide && finalTxHash) {
        notifications.addNotification({
          type: "info",
          title: "Staking pending",
          message: `Stake ${stakeAmount} ${selectedPool.symbol} submitted on-chain (${finalTxHash.slice(0, 10)}...).`,
          txHash: finalTxHash,
          txNetwork: "starknet",
        })
      }
      if (response.privacy_tx_hash) {
        notifications.addNotification({
          type: "info",
          title: "Garaga verification submitted",
          message: `Privacy tx ${response.privacy_tx_hash.slice(0, 12)}... was submitted on Starknet.`,
          txHash: response.privacy_tx_hash,
          txNetwork: "starknet",
        })
      }
      await Promise.allSettled([wallet.refreshPortfolio(), wallet.refreshOnchainBalances()])
      await refreshPositions()
      setStakeSuccess(true)
      notifications.addNotification({
        type: "success",
        title: "Staking successful",
        message: `Stake   completed successfully`,
        txHash: finalTxHash,
        txNetwork: "starknet",
      })
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Staking failed",
        message: mapStakeUiErrorMessage(error, "Unable to complete staking"),
      })
    } finally {
      setIsStaking(false)
    }
  }

  /**
   * Handles `handleUnstake` logic.
   *
   * @param positionId - Input used by `handleUnstake` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleUnstake = async (positionId: string) => {
    const target = positions.find((pos) => pos.id === positionId)
    if (!target) return

    setPositions((prev) =>
      prev.map((p) => (p.id === positionId ? { ...p, status: "unlocking" as const } : p))
    )

    try {
      const effectiveHideBalance = balanceHidden
      const useRelayerPoolHide = effectiveHideBalance && HIDE_BALANCE_RELAYER_POOL_ENABLED
      const resolvedPrivacyPayload = effectiveHideBalance
        ? await resolveHideBalancePrivacyPayload({
            flow: "unstake",
            fromToken: target.pool.symbol,
            toToken: target.pool.symbol,
            amount: target.amount.toString(),
          })
        : undefined
      if (effectiveHideBalance && !resolvedPrivacyPayload) {
        throw new Error("Garaga payload is not ready for Hide Balance. Check backend auto-proof config.")
      }
      let onchainTxHash: string | undefined
      let payloadForBackend = resolvedPrivacyPayload
      if (!useRelayerPoolHide) {
        notifications.addNotification({
          type: "info",
          title: "Wallet signature required",
          message: "Confirm unstake transaction in your Starknet wallet.",
        })
        const submitted = await submitOnchainStakeTx(
          target.pool.symbol,
          "unstake",
          target.amount.toString(),
          resolvedPrivacyPayload
        )
        onchainTxHash = submitted.txHash
        payloadForBackend = submitted.privacyPayload || resolvedPrivacyPayload
        notifications.addNotification({
          type: "info",
          title: "Unstake pending",
          message: `${target.amount} ${target.pool.symbol} submitted on-chain (${onchainTxHash.slice(0, 10)}...).`,
          txHash: onchainTxHash,
          txNetwork: "starknet",
        })
      } else {
        notifications.addNotification({
          type: "info",
          title: "Submitting private unstake",
          message: "Submitting hide-mode unstake via Starknet relayer pool.",
        })
      }
      const response = await stakeWithdraw({
        position_id: positionId,
        amount: target.amount.toString(),
        onchain_tx_hash: onchainTxHash,
        hide_balance: effectiveHideBalance,
        privacy: effectiveHideBalance
          ? payloadForBackend || resolvedPrivacyPayload
          : undefined,
      })
      const finalTxHash = response.tx_hash || onchainTxHash
      if (useRelayerPoolHide && finalTxHash) {
        notifications.addNotification({
          type: "info",
          title: "Unstake pending",
          message: `${target.amount} ${target.pool.symbol} submitted on-chain (${finalTxHash.slice(0, 10)}...).`,
          txHash: finalTxHash,
          txNetwork: "starknet",
        })
      }
      if (response.privacy_tx_hash) {
        notifications.addNotification({
          type: "info",
          title: "Garaga verification submitted",
          message: `Privacy tx ${response.privacy_tx_hash.slice(0, 12)}... was submitted on Starknet.`,
          txHash: response.privacy_tx_hash,
          txNetwork: "starknet",
        })
      }
      await Promise.allSettled([wallet.refreshPortfolio(), wallet.refreshOnchainBalances()])
      await refreshPositions()
      notifications.addNotification({
        type: "success",
        title: "Unstake processing",
        message: `${target.amount} ${target.pool.symbol} is being processed`,
        txHash: finalTxHash,
        txNetwork: "starknet",
      })
    } catch (error) {
      setPositions((prev) =>
        prev.map((p) => (p.id === positionId ? { ...p, status: "active" as const } : p))
      )
      notifications.addNotification({
        type: "error",
        title: "Unstake failed",
        message: mapStakeUiErrorMessage(error, "Unable to complete unstake"),
      })
    }
  }

  /**
   * Handles `handleClaim` logic.
   *
   * @param positionId - Input used by `handleClaim` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleClaim = async (positionId: string) => {
    const target = positions.find((pos) => pos.id === positionId)
    if (!target) return

    setClaimingPositionId(positionId)
    try {
      const effectiveHideBalance = balanceHidden
      const useRelayerPoolHide = effectiveHideBalance && HIDE_BALANCE_RELAYER_POOL_ENABLED
      const resolvedPrivacyPayload = effectiveHideBalance
        ? await resolveHideBalancePrivacyPayload({
            flow: "stake_claim",
            fromToken: target.pool.symbol,
            toToken: target.pool.symbol,
            amount: target.rewards.toString(),
          })
        : undefined
      if (effectiveHideBalance && !resolvedPrivacyPayload) {
        throw new Error("Garaga payload is not ready for Hide Balance. Check backend auto-proof config.")
      }
      let onchainTxHash: string | undefined
      let payloadForBackend = resolvedPrivacyPayload
      if (!useRelayerPoolHide) {
        notifications.addNotification({
          type: "info",
          title: "Wallet signature required",
          message: "Confirm claim rewards transaction in your Starknet wallet.",
        })
        const submitted = await submitOnchainClaimTx(target.pool.symbol, resolvedPrivacyPayload)
        onchainTxHash = submitted.txHash
        payloadForBackend = submitted.privacyPayload || resolvedPrivacyPayload
        notifications.addNotification({
          type: "info",
          title: "Claim pending",
          message: `Claim ${target.pool.symbol} rewards submitted on-chain (${onchainTxHash.slice(0, 10)}...).`,
          txHash: onchainTxHash,
          txNetwork: "starknet",
        })
      } else {
        notifications.addNotification({
          type: "info",
          title: "Submitting private claim",
          message: "Submitting hide-mode claim via Starknet relayer pool.",
        })
      }
      const response = await stakeClaim({
        position_id: positionId,
        onchain_tx_hash: onchainTxHash,
        hide_balance: effectiveHideBalance,
        privacy: effectiveHideBalance
          ? payloadForBackend || resolvedPrivacyPayload
          : undefined,
      })
      const finalTxHash = response.tx_hash || onchainTxHash
      if (useRelayerPoolHide && finalTxHash) {
        notifications.addNotification({
          type: "info",
          title: "Claim pending",
          message: `Claim ${target.pool.symbol} rewards submitted on-chain (${finalTxHash.slice(0, 10)}...).`,
          txHash: finalTxHash,
          txNetwork: "starknet",
        })
      }
      if (response.privacy_tx_hash) {
        notifications.addNotification({
          type: "info",
          title: "Garaga verification submitted",
          message: `Privacy tx ${response.privacy_tx_hash.slice(0, 12)}... was submitted on Starknet.`,
          txHash: response.privacy_tx_hash,
          txNetwork: "starknet",
        })
      }
      await Promise.allSettled([wallet.refreshPortfolio(), wallet.refreshOnchainBalances()])
      await refreshPositions()
      notifications.addNotification({
        type: "success",
        title: "Claim completed",
        message: `Staking rewards claim confirmed for ${target.pool.symbol}.`,
        txHash: finalTxHash,
        txNetwork: "starknet",
      })
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Claim failed",
        message: mapStakeUiErrorMessage(error, "Unable to claim staking rewards"),
      })
    } finally {
      setClaimingPositionId((current) => (current === positionId ? null : current))
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
              <p className="text-xs text-muted-foreground mt-1">
                BTC staking is disabled. Use Bridge via Garden for BTC↔WBTC transfers.
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
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {hasTradePrivacyPayload
                      ? "Garaga payload is ready."
                      : isAutoPrivacyProvisioning
                      ? "Preparing Garaga payload..."
                      : "Garaga payload will be auto-prepared on submit."}
                  </p>
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
                          Balance: {balanceHidden ? "••••••" : selectedPool.userBalance.toLocaleString()} {selectedPool.symbol}
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
                      disabled={
                        !stakeAmount ||
                        Number.parseFloat(stakeAmount) < Number.parseFloat(selectedPool.minStake) ||
                        isStaking ||
                        isAutoPrivacyProvisioning
                      }
                      className="w-full bg-primary hover:bg-primary/90"
                    >
                      {isAutoPrivacyProvisioning
                        ? "Preparing Hide Balance..."
                        : isStaking
                        ? "Processing..."
                        : `Stake ${selectedPool.symbol}`}
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

/**
 * Handles `StakingCard` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function StakingCard({
  pool,
  onStake,
  balanceHidden,
}: {
  pool: StakingPool
  onStake: () => void
  balanceHidden: boolean
}) {
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
          <p className="text-sm font-medium text-foreground">
            {balanceHidden ? "••••••" : pool.userBalance.toLocaleString()}
          </p>
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
