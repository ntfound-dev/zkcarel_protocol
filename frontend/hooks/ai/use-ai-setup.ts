import * as React from "react"
import {
  ensureAiExecutorReady,
  getAiPendingActions,
  getAiPlanStatus,
  getAiRuntimeConfig,
  getOnchainBalances,
  approveAiPlan,
  prepareAiAction,
  prepareAiPlan,
} from "@/lib/api"
import {
  decimalToU256Parts,
  invokeStarknetCallFromWallet,
  signStarknetMessageHashFromWallet,
  signStarknetTypedDataFromWallet,
  toHexFelt,
  type StarknetInvokeCall,
} from "@/lib/onchain-trade"
import {
  AI_REQUIRE_FRESH_SETUP_PER_EXECUTION,
  STATIC_CAREL_TOKEN_ADDRESS,
  STATIC_STARKNET_AI_EXECUTOR_ADDRESS,
  buildTxExplorerUrl,
  executionBurnAmountCarel,
  formatSetupFailureMessage,
  invokeWalletCallsWithSequentialFallback,
  isWalletMulticallExecutionError,
  normalizeMessageText,
  nowTimestampLabel,
  requiresOnchainActionForCommand,
} from "@/lib/ai-parser"
import { useNotifications } from "@/hooks/notifications/use-notifications"
import { useWallet } from "@/hooks/wallet/use-wallet"

const readMsEnvValue = (raw: string | undefined, fallback: number): number => {
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

// Internal helper that supports ms env parsing for AI setup timing.
function readMsEnv(raw: string | undefined, fallback: number): number {
  return readMsEnvValue(raw, fallback)
}

const AI_SETUP_SKIP_APPROVE =
  process.env.NEXT_PUBLIC_AI_SETUP_SKIP_APPROVE === "true" ||
  process.env.NEXT_PUBLIC_AI_DEMO_MODE === "true"
const AI_SETUP_SUBMIT_COOLDOWN_MS = 20_000
const AI_SETUP_PENDING_POLL_ATTEMPTS = Math.max(
  10,
  readMsEnv(process.env.NEXT_PUBLIC_AI_SETUP_PENDING_POLL_ATTEMPTS, 28)
)
const AI_SETUP_PENDING_POLL_INTERVAL_MS = readMsEnv(
  process.env.NEXT_PUBLIC_AI_SETUP_PENDING_POLL_INTERVAL_MS,
  1_500
)
const AI_SETUP_PRE_WALLET_DELAY_MS = readMsEnv(process.env.NEXT_PUBLIC_AI_SETUP_PRE_WALLET_DELAY_MS, 350)
const AI_SETUP_NONCE_RETRY_DELAY_MS = readMsEnv(
  process.env.NEXT_PUBLIC_AI_SETUP_NONCE_RETRY_DELAY_MS,
  1_500
)
const AI_PREPARE_DEBOUNCE_MS = 500
const AI_PREPARE_CACHE_MAX_AGE_MS = readMsEnv(
  process.env.NEXT_PUBLIC_AI_PREPARE_CACHE_MAX_AGE_MS,
  225_000
)
const AI_EXECUTOR_PREFLIGHT_CACHE_MS = readMsEnv(
  process.env.NEXT_PUBLIC_AI_EXECUTOR_PREFLIGHT_CACHE_MS,
  90_000
)

const AI_PLAN_ROUTER_ADDRESS = (process.env.NEXT_PUBLIC_AI_PLAN_ROUTER_ADDRESS || "").trim()
const AI_PLAN_ENABLED = AI_PLAN_ROUTER_ADDRESS.length > 0
const AI_PLAN_STORAGE_KEY = "ai_plan_active_v1"
const AI_PLAN_STATUS_CACHE_MS = readMsEnv(
  process.env.NEXT_PUBLIC_AI_PLAN_STATUS_CACHE_MS,
  300_000
)

const AI_ACTION_TYPE_SWAP = 0
const AI_ACTION_TYPE_MULTI_STEP = 5

type UseAiSetupParams = {
  isOpen: boolean
  selectedTier: number
  normalizedInput: string
  commandNeedsAction: boolean
  appendMessagesForTier: (
    tier: number,
    messages: Array<{ role: "user" | "assistant"; content: string; timestamp: string }>
  ) => void
}

type UseAiSetupResult = {
  actionId: string
  setActionId: React.Dispatch<React.SetStateAction<string>>
  planId: string
  hasPlanReady: boolean
  aiPlanEnabled: boolean
  pendingActions: number[]
  setPendingActions: React.Dispatch<React.SetStateAction<number[]>>
  isResolvingExecutor: boolean
  isCreatingAction: boolean
  isAutoPreparingAction: boolean
  isBackgroundPreparingAction: boolean
  hasPreparedActionReady: boolean
  hasSetupReady: boolean
  isSetupProcessing: boolean
  isExecuteButtonBlockedByPrepare: boolean
  effectiveExecutorAddress: string
  getLastBurnTxHash: () => string
  ensureExecutorAddress: () => Promise<string>
  resolveActionId: (
    requiredForCommand: boolean,
    options?: { forceRefresh?: boolean; requireFresh?: boolean }
  ) => Promise<number>
  handleAutoSetup: () => Promise<void>
}

interface ExecutorPreflightCache {
  ready: boolean
  burnerRoleGranted: boolean
  signatureVerificationEnabled: boolean | null
  message: string
  expiresAt: number
}

interface PreparedActionCache {
  level: number
  context: string
  preparedAt: number
  response: Awaited<ReturnType<typeof prepareAiAction>>
}

const actionTypeForTier = (tier: number): number => {
  return tier >= 3 ? AI_ACTION_TYPE_MULTI_STEP : AI_ACTION_TYPE_SWAP
}

const setupApprovalAmountCarel = (tier: number): number => {
  if (tier >= 3) return 2
  return 1
}

const waitMs = async (delayMs: number): Promise<void> => {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

const encodeShortByteArray = (value: string): Array<string | number> => {
  const normalized = value.trim()
  const byteLen = new TextEncoder().encode(normalized).length
  if (byteLen === 0) return [0, 0, 0]
  if (byteLen > 31) {
    throw new Error("AI action payload is too long. Maximum 31 bytes.")
  }
  return [0, toHexFelt(normalized), byteLen]
}

type StoredAiPlan = {
  plan_id: string
  user_address: string
  expires_at: number
  cached_at: number
}

const loadStoredPlan = (): StoredAiPlan | null => {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(AI_PLAN_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredAiPlan
    if (!parsed.plan_id || !parsed.user_address || !Number.isFinite(parsed.expires_at)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

const saveStoredPlan = (plan: StoredAiPlan) => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(AI_PLAN_STORAGE_KEY, JSON.stringify(plan))
  } catch {
    // ignore storage errors
  }
}

const clearStoredPlan = () => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(AI_PLAN_STORAGE_KEY)
  } catch {
    // ignore storage errors
  }
}

const isPlanExpired = (expiresAt: number | null | undefined): boolean => {
  if (!expiresAt || !Number.isFinite(expiresAt) || expiresAt <= 0) return false
  return Date.now() >= expiresAt * 1000
}

const isInvalidUserSignatureError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "")
  return /invalid user signature|argent\/multicall-failed|multicall-failed|entrypoint_failed/i.test(
    message
  )
}

const resolveStarknetProviderHint = (provider: string | null): "starknet" | "argentx" | "braavos" => {
  if (provider === "argentx" || provider === "braavos") return provider
  return "starknet"
}

const formatBackendConnectivityMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error ?? "")
  if (/failed to fetch|network error|request timeout|backend unavailable/i.test(message)) {
    return "Backend is not connected. Run `cd backend-rust && cargo run` and ensure `NEXT_PUBLIC_BACKEND_URL` points to backend (default: http://localhost:8080)."
  }
  return message || "Failed to contact backend."
}

const findNewPendingAction = (after: number[], before: number[]): number | null => {
  const beforeSet = new Set(before)
  let latest: number | null = null
  for (const id of after) {
    if (!beforeSet.has(id)) {
      latest = latest === null ? id : Math.max(latest, id)
    }
  }
  return latest
}

const pickLatestPendingAction = (pending: number[]): number | null => {
  if (pending.length === 0) return null
  return Math.max(...pending)
}

const pickLatestPendingAbove = (pending: number[], threshold: number): number | null => {
  let latest: number | null = null
  for (const id of pending) {
    if (id > threshold) {
      latest = latest === null ? id : Math.max(latest, id)
    }
  }
  return latest
}

const isPreparedActionCacheValid = (
  cache: PreparedActionCache | null,
  level: number,
  context: string
): boolean => {
  if (!cache) return false
  if (cache.level !== level || cache.context !== context) return false
  return Date.now() - cache.preparedAt <= AI_PREPARE_CACHE_MAX_AGE_MS
}

export const useAiSetup = ({
  isOpen,
  selectedTier,
  normalizedInput,
  commandNeedsAction,
  appendMessagesForTier,
}: UseAiSetupParams): UseAiSetupResult => {
  const notifications = useNotifications()
  const wallet = useWallet()
  const [actionId, setActionId] = React.useState("")
  const [planId, setPlanId] = React.useState("")
  const [planExpiresAt, setPlanExpiresAt] = React.useState<number | null>(null)
  const [planCheckedAt, setPlanCheckedAt] = React.useState(0)
  const [isCheckingPlan, setIsCheckingPlan] = React.useState(false)
  const [pendingActions, setPendingActions] = React.useState<number[]>([])
  const [isCreatingAction, setIsCreatingAction] = React.useState(false)
  const [isAutoPreparingAction, setIsAutoPreparingAction] = React.useState(false)
  const [runtimeExecutorAddress, setRuntimeExecutorAddress] = React.useState("")
  const [isResolvingExecutor, setIsResolvingExecutor] = React.useState(false)
  const [preparedActionCache, setPreparedActionCache] = React.useState<PreparedActionCache | null>(
    null
  )
  const [isBackgroundPreparingAction, setIsBackgroundPreparingAction] = React.useState(false)
  const backgroundPrepareRequestSeqRef = React.useRef(0)
  const setupSubmitCooldownUntilRef = React.useRef(0)
  const lastSetupFailureRef = React.useRef("")
  const lastSetupSubmitAtRef = React.useRef(0)
  const lastAiBurnTxHashRef = React.useRef("")
  const executorPreflightCacheRef = React.useRef<ExecutorPreflightCache>({
    ready: false,
    burnerRoleGranted: false,
    signatureVerificationEnabled: null,
    message: "",
    expiresAt: 0,
  })

  const parsedActionId = Number(actionId)
  const hasValidActionId = Number.isFinite(parsedActionId) && parsedActionId > 0
  const prepareContext = React.useMemo(() => `tier:${selectedTier}`, [selectedTier])
  const hasPreparedActionReady = isPreparedActionCacheValid(
    preparedActionCache,
    selectedTier,
    prepareContext
  )
  const staticCarelTokenAddress = React.useMemo(() => STATIC_CAREL_TOKEN_ADDRESS.trim(), [])
  const staticExecutorAddress = React.useMemo(
    () => STATIC_STARKNET_AI_EXECUTOR_ADDRESS.trim(),
    []
  )
  const effectiveExecutorAddress = React.useMemo(
    () => staticExecutorAddress || runtimeExecutorAddress.trim(),
    [runtimeExecutorAddress, staticExecutorAddress]
  )

  React.useEffect(() => {
    if (selectedTier < 2) {
      setPreparedActionCache(null)
      setIsBackgroundPreparingAction(false)
    }
  }, [selectedTier])

  React.useEffect(() => {
    if (!isOpen || selectedTier < 2 || !commandNeedsAction || !normalizedInput) {
      setIsBackgroundPreparingAction(false)
      return
    }
    if (hasPreparedActionReady) {
      setIsBackgroundPreparingAction(false)
      return
    }

    let cancelled = false
    const requestSeq = backgroundPrepareRequestSeqRef.current + 1
    backgroundPrepareRequestSeqRef.current = requestSeq
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return
      setIsBackgroundPreparingAction(true)
      void prepareAiAction({
        level: selectedTier,
        context: prepareContext,
      })
        .then((prepared) => {
          if (cancelled || backgroundPrepareRequestSeqRef.current !== requestSeq) return
          setPreparedActionCache({
            level: selectedTier,
            context: prepareContext,
            preparedAt: Date.now(),
            response: prepared,
          })
        })
        .catch(() => {
          // Silent fallback: execute path will prepare on demand when needed.
        })
        .finally(() => {
          if (cancelled || backgroundPrepareRequestSeqRef.current !== requestSeq) return
          setIsBackgroundPreparingAction(false)
        })
    }, AI_PREPARE_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [
    commandNeedsAction,
    hasPreparedActionReady,
    isOpen,
    normalizedInput,
    prepareContext,
    selectedTier,
  ])

  const ensureExecutorAddress = React.useCallback(async (): Promise<string> => {
    if (runtimeExecutorAddress.trim()) return runtimeExecutorAddress.trim()
    setIsResolvingExecutor(true)
    try {
      const runtimeConfig = await getAiRuntimeConfig()
      const resolved = (runtimeConfig.executor_address || "").trim()
      if (!runtimeConfig.executor_configured || !resolved) {
        if (staticExecutorAddress) {
          return staticExecutorAddress
        }
        throw new Error(
          "AI executor is not configured yet. Set AI_EXECUTOR_ADDRESS in backend env, or NEXT_PUBLIC_STARKNET_AI_EXECUTOR_ADDRESS in frontend env, then restart services."
        )
      }
      if (staticExecutorAddress && staticExecutorAddress.toLowerCase() !== resolved.toLowerCase()) {
        notifications.addNotification({
          type: "warning",
          title: "Executor address mismatch",
          message:
            "Frontend executor env differs from backend runtime executor. Using backend runtime address to avoid setup mismatch.",
        })
      }
      setRuntimeExecutorAddress(resolved)
      return resolved
    } finally {
      setIsResolvingExecutor(false)
    }
  }, [notifications, runtimeExecutorAddress, staticExecutorAddress])

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

  React.useEffect(() => {
    if (!AI_PLAN_ENABLED) return
    const currentAddress =
      wallet.starknetAddress || (wallet.network === "starknet" ? wallet.address : "")
    if (!currentAddress) return
    const stored = loadStoredPlan()
    if (!stored) return
    if (stored.user_address.toLowerCase() !== currentAddress.toLowerCase()) {
      clearStoredPlan()
      setPlanId("")
      setPlanExpiresAt(null)
      return
    }
    if (isPlanExpired(stored.expires_at)) {
      clearStoredPlan()
      setPlanId("")
      setPlanExpiresAt(null)
      return
    }
    setPlanId(stored.plan_id)
    setPlanExpiresAt(stored.expires_at)
  }, [wallet.address, wallet.network, wallet.starknetAddress])

  React.useEffect(() => {
    if (!AI_PLAN_ENABLED || !planId || isCheckingPlan) return
    if (Date.now() - planCheckedAt < AI_PLAN_STATUS_CACHE_MS) return
    let cancelled = false
    setIsCheckingPlan(true)
    void getAiPlanStatus(planId)
      .then((status) => {
        if (cancelled) return
        if (!status.active) {
          clearStoredPlan()
          setPlanId("")
          setPlanExpiresAt(null)
          return
        }
        setPlanExpiresAt(status.expires_at ?? planExpiresAt)
        setPlanCheckedAt(Date.now())
      })
      .catch(() => {
        // keep cached plan when status lookup fails
      })
      .finally(() => {
        if (!cancelled) {
          setIsCheckingPlan(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [planId, planCheckedAt, isCheckingPlan, planExpiresAt])

  const loadPendingActions = async (silent = false): Promise<number[]> => {
    const response = await getAiPendingActions(0, 50)
    const pending = response.pending || []
    setPendingActions(pending)
    if (!silent && pending.length === 0) {
      notifications.addNotification({
        type: "info",
        title: "On-chain setup",
        message: "No pending setup found for this account yet.",
      })
    }
    return pending
  }

  const resolveActionId = async (
    requiredForCommand: boolean,
    options?: { forceRefresh?: boolean; requireFresh?: boolean }
  ): Promise<number> => {
    if (!requiredForCommand) return 0
    const forceRefresh = options?.forceRefresh === true
    const requireFresh = options?.requireFresh === true

    if (requireFresh) {
      const created = await createOnchainActionId({ requireFresh: true })
      if (created && created > 0) return created
      const setupSubmittedRecently =
        Date.now() - lastSetupSubmitAtRef.current <= AI_SETUP_SUBMIT_COOLDOWN_MS + 15_000
      if (setupSubmittedRecently) {
        try {
          const pending = await loadPendingActions(true)
          const latest = pickLatestPendingAction(pending)
          if (latest && latest > 0) {
            setActionId(String(latest))
            notifications.addNotification({
              type: "warning",
              title: "Using pending setup",
              message:
                "Fresh setup was submitted but not indexed yet. Using your latest pending setup for this execution.",
            })
            return latest
          }
        } catch {
          // Continue with the explicit setup failure message below.
        }
      }
      const failureDetail = lastSetupFailureRef.current.trim()
      throw new Error(
        failureDetail ||
          "A fresh on-chain signature is required for this execution. Please confirm the wallet popup, then retry."
      )
    }

    if (!forceRefresh && hasValidActionId) {
      const existing = Math.floor(parsedActionId)
      try {
        const pending = await loadPendingActions(true)
        if (pending.includes(existing)) {
          return existing
        }
      } catch {
        // Continue with create/refresh path when pending check fails.
      }
      setActionId("")
    }

    setIsAutoPreparingAction(true)
    try {
      const pending = await loadPendingActions(true)
      const latest = pickLatestPendingAction(pending)
      if (latest && latest > 0) {
        setActionId(String(latest))
        notifications.addNotification({
          type: "success",
          title: "On-chain setup ready",
          message: "Using latest pending setup from your account.",
        })
        return latest
      }

      const created = await createOnchainActionId({ requireFresh: false })
      if (created && created > 0) {
        return created
      }

      const setupSubmittedRecently =
        Date.now() - lastSetupSubmitAtRef.current <= AI_SETUP_SUBMIT_COOLDOWN_MS + 15_000
      if (setupSubmittedRecently) {
        try {
          const pending = await loadPendingActions(true)
          const latest = pickLatestPendingAction(pending)
          if (latest && latest > 0) {
            setActionId(String(latest))
            notifications.addNotification({
              type: "warning",
              title: "Using pending setup",
              message:
                "Setup tx was submitted recently and is now visible. Using latest pending setup for this execution.",
            })
            return latest
          }
        } catch {
          // Keep explicit failure message below.
        }
      }

      const failureDetail = lastSetupFailureRef.current.trim()
      throw new Error(
        failureDetail || "No valid on-chain setup found. Click Auto Setup On-Chain and confirm in wallet."
      )
    } finally {
      setIsAutoPreparingAction(false)
    }
  }

  const createOnchainActionId = async (options?: { requireFresh?: boolean }): Promise<number | null> => {
    const requireFresh = options?.requireFresh === true
    lastSetupFailureRef.current = ""
    if (selectedTier < 2) return null
    if (isCreatingAction) {
      lastSetupFailureRef.current = "On-chain setup is still in progress. Wait for wallet confirmation, then retry."
      return null
    }
    if (!staticCarelTokenAddress) {
      const message =
        "NEXT_PUBLIC_TOKEN_CAREL_ADDRESS is missing. Set CAREL token contract address first."
      lastSetupFailureRef.current = message
      notifications.addNotification({
        type: "error",
        title: "CAREL token not configured",
        message,
      })
      return null
    }
    let executorAddress = ""
    try {
      executorAddress = await ensureExecutorAddress()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "AI executor is not configured. Please set backend/frontend executor address first."
      lastSetupFailureRef.current = message
      notifications.addNotification({
        type: "error",
        title: "AI executor not configured",
        message,
      })
      return null
    }

    const requiredCarelForExecution = executionBurnAmountCarel(selectedTier)
    const effectiveStarknetAddress =
      wallet.starknetAddress || (wallet.network === "starknet" ? wallet.address : null)
    const readKnownCarelBalance = (): number | null => {
      const onchainCarel = wallet.onchainBalance?.CAREL
      const portfolioCarel = wallet.balance?.CAREL
      const candidates = [onchainCarel, portfolioCarel].filter(
        (value): value is number => typeof value === "number" && Number.isFinite(value)
      )
      if (candidates.length > 0) {
        return Math.max(...candidates)
      }
      return null
    }
    let knownCarelBalance = readKnownCarelBalance()
    if (knownCarelBalance === null || knownCarelBalance + 1e-9 < requiredCarelForExecution) {
      try {
        await wallet.refreshOnchainBalances()
        knownCarelBalance = readKnownCarelBalance()
      } catch {
        // Continue with wallet-sign flow; exact balance may still be unknown.
      }
    }
    if (
      knownCarelBalance === null ||
      (Number.isFinite(knownCarelBalance) && knownCarelBalance + 1e-9 < requiredCarelForExecution)
    ) {
      try {
        const forced = await getOnchainBalances(
          {
            starknet_address: effectiveStarknetAddress,
            evm_address: wallet.evmAddress || null,
            btc_address: wallet.btcAddress || null,
          },
          { force: true }
        )
        if (typeof forced?.carel === "number" && Number.isFinite(forced.carel)) {
          knownCarelBalance = forced.carel
        }
      } catch {
        // Keep previous value and continue to guarded check below.
      }
    }
    if (
      typeof knownCarelBalance === "number" &&
      Number.isFinite(knownCarelBalance) &&
      knownCarelBalance + 1e-9 < requiredCarelForExecution
    ) {
      const message =
        `Execution setup requires ${requiredCarelForExecution} CAREL burn fee, but available CAREL is ~${knownCarelBalance.toFixed(6)}.` +
        " Top up CAREL then retry."
      lastSetupFailureRef.current = message
      notifications.addNotification({
        type: "error",
        title: "Insufficient CAREL",
        message,
      })
      return null
    }

    setIsCreatingAction(true)
    let pendingBefore: number[] = []
    let pendingBeforeMax = 0
    try {
      const before = await getAiPendingActions(0, 50)
      pendingBefore = before.pending || []
      pendingBeforeMax = pickLatestPendingAction(pendingBefore) || 0
    } catch {
      pendingBefore = []
      pendingBeforeMax = 0
    }

    try {
      if (!requireFresh && Date.now() < setupSubmitCooldownUntilRef.current) {
        const latest = pickLatestPendingAction(pendingBefore)
        if (latest && latest > 0) {
          setPendingActions(pendingBefore)
          setActionId(String(latest))
          lastSetupFailureRef.current = ""
          notifications.addNotification({
            type: "success",
            title: "On-chain setup ready",
            message: "Using latest pending setup from your account.",
          })
          return latest
        }
        notifications.addNotification({
          type: "info",
          title: "Setup cooldown active",
          message: "A setup transaction was submitted recently. Please wait a few seconds before retrying.",
        })
        lastSetupFailureRef.current =
          "Setup transaction was submitted recently. Wait a few seconds, then retry once."
        return null
      }

      const isRetriableSetupError = (input: unknown): boolean => {
        const message = input instanceof Error ? input.message : String(input ?? "")
        const lower = message.toLowerCase()
        return (
          /request timeout|network error|timed out|timeout|failed to fetch|bad gateway|gateway timeout|service unavailable/.test(
            lower
          ) || /http 502|http 503|http 504/.test(lower)
        )
      }
      type SetupPreflight = Awaited<ReturnType<typeof ensureAiExecutorReady>>
      const cachedPreflight = executorPreflightCacheRef.current
      const nowMs = Date.now()
      const useCachedPreflight = cachedPreflight.expiresAt > nowMs
      let preflight: SetupPreflight
      if (useCachedPreflight) {
        preflight = {
          ready: cachedPreflight.ready,
          burner_role_granted: cachedPreflight.burnerRoleGranted,
          signature_verification_enabled: cachedPreflight.signatureVerificationEnabled,
          updated_onchain: false,
          tx_hash: null,
          message: cachedPreflight.message,
        }
      } else {
        const preflightBackoffMs = [1200, 2500]
        let lastPreflightError: unknown = null
        let resolvedPreflight: SetupPreflight | null = null
        for (let attempt = 0; attempt <= preflightBackoffMs.length; attempt += 1) {
          try {
            resolvedPreflight = await ensureAiExecutorReady()
            lastPreflightError = null
            break
          } catch (error) {
            lastPreflightError = error
            if (!isRetriableSetupError(error) || attempt >= preflightBackoffMs.length) {
              break
            }
            notifications.addNotification({
              type: "info",
              title: "Preparing on-chain setup",
              message: `Executor preflight is still syncing (${attempt + 1}/${preflightBackoffMs.length + 1}). Retrying...`,
            })
            await waitMs(preflightBackoffMs[attempt] ?? preflightBackoffMs[preflightBackoffMs.length - 1])
          }
        }
        if (!resolvedPreflight) {
          throw (
            lastPreflightError instanceof Error
              ? lastPreflightError
              : new Error("AI executor preflight timed out before wallet popup appeared.")
          )
        }
        preflight = resolvedPreflight
      }
      if (!useCachedPreflight) {
        const preflightTtlMs =
          preflight.ready && preflight.burner_role_granted
            ? AI_EXECUTOR_PREFLIGHT_CACHE_MS
            : Math.min(5_000, AI_EXECUTOR_PREFLIGHT_CACHE_MS)
        executorPreflightCacheRef.current = {
          ready: preflight.ready,
          burnerRoleGranted: preflight.burner_role_granted,
          signatureVerificationEnabled: preflight.signature_verification_enabled ?? null,
          message: preflight.message || "",
          expiresAt: Date.now() + preflightTtlMs,
        }
      }
      if (preflight.tx_hash) {
        notifications.addNotification({
          type: preflight.ready ? "success" : "info",
          title: preflight.ready ? "Executor role ready" : "Executor role update submitted",
          message: preflight.message,
          txHash: preflight.tx_hash,
          txNetwork: "starknet",
        })
      }
      if (!preflight.ready || !preflight.burner_role_granted) {
        throw new Error(preflight.message || "AI executor preflight is not ready yet.")
      }
      const requiresTypedSetupSignature = preflight.signature_verification_enabled !== false

      const payload = `tier:${selectedTier}`
      const actionType = actionTypeForTier(selectedTier)
      const providerHint = resolveStarknetProviderHint(wallet.provider)
      const approveAmountCarel = setupApprovalAmountCarel(selectedTier)
      const [approveAmountLow, approveAmountHigh] = decimalToU256Parts(
        String(approveAmountCarel),
        18
      )

      const prepareChallengeWithRetry = async (options?: { forceFresh?: boolean }) => {
        const forceFresh = options?.forceFresh === true
        if (
          !forceFresh &&
          isPreparedActionCacheValid(preparedActionCache, selectedTier, payload) &&
          preparedActionCache
        ) {
          return preparedActionCache.response
        }

        const fetchPrepared = async () => {
          const prepared = await prepareAiAction({
            level: selectedTier,
            context: payload,
          })
          setPreparedActionCache({
            level: selectedTier,
            context: payload,
            preparedAt: Date.now(),
            response: prepared,
          })
          return prepared
        }

        const prepareBackoffMs = [1200, 2500]
        let lastPrepareError: unknown = null
        for (let attempt = 0; attempt <= prepareBackoffMs.length; attempt += 1) {
          try {
            return await fetchPrepared()
          } catch (error) {
            lastPrepareError = error
            if (!isRetriableSetupError(error) || attempt >= prepareBackoffMs.length) {
              break
            }
            notifications.addNotification({
              type: "info",
              title: "Preparing setup challenge",
              message: `Backend/RPC is still preparing AI typed-data challenge (${attempt + 1}/${prepareBackoffMs.length + 1}). Retrying...`,
            })
            await waitMs(prepareBackoffMs[attempt] ?? prepareBackoffMs[prepareBackoffMs.length - 1])
          }
        }
        throw (
          lastPrepareError instanceof Error
            ? lastPrepareError
            : new Error("AI setup preparation timed out before wallet popup appeared.")
        )
      }

      const buildSetupCalls = async (options?: {
        forceFreshPrepare?: boolean
        forceTypedSignature?: boolean
      }): Promise<{ calls: StarknetInvokeCall[]; usesTypedSignature: boolean }> => {
        const useTypedSignature =
          options?.forceTypedSignature === true || requiresTypedSetupSignature

        let preparedActionType = actionType
        let preparedParams = payload
        let messageHash = "0x0"
        let userSignature: string[] = []

        if (useTypedSignature) {
          const prepareResponse = await prepareChallengeWithRetry({
            forceFresh: options?.forceFreshPrepare === true,
          })
          preparedActionType = Number.isFinite(prepareResponse.action_type)
            ? prepareResponse.action_type
            : actionType
          preparedParams =
            typeof prepareResponse.params === "string" && prepareResponse.params.trim()
              ? prepareResponse.params
              : payload
          messageHash = toHexFelt(prepareResponse.message_hash || "0x0")
          const typedData =
            prepareResponse.typed_data && typeof prepareResponse.typed_data === "object"
              ? (prepareResponse.typed_data as Record<string, unknown>)
              : null
          if (!typedData) {
            throw new Error("Backend did not return AI setup typed-data payload.")
          }

          notifications.addNotification({
            type: "info",
            title: "AI setup challenge ready",
            message: `Nonce ${prepareResponse.nonce} prepared. Confirm wallet message signature.`,
          })

          await waitMs(AI_SETUP_PRE_WALLET_DELAY_MS)
          userSignature = await signStarknetTypedDataFromWallet(typedData, providerHint)
          if (!Array.isArray(userSignature) || userSignature.length === 0) {
            throw new Error("Wallet returned empty AI setup signature.")
          }
        }

        const submitCalldata = [
          preparedActionType,
          ...encodeShortByteArray(preparedParams),
          messageHash,
          userSignature.length,
          ...userSignature,
        ]
        const calls: StarknetInvokeCall[] = AI_SETUP_SKIP_APPROVE
          ? [
              {
                contractAddress: executorAddress,
                entrypoint: "submit_action",
                calldata: submitCalldata,
              },
            ]
          : [
              {
                contractAddress: staticCarelTokenAddress,
                entrypoint: "approve",
                calldata: [executorAddress, approveAmountLow, approveAmountHigh],
              },
              {
                contractAddress: executorAddress,
                entrypoint: "submit_action",
                calldata: submitCalldata,
              },
            ]
        return { calls, usesTypedSignature: useTypedSignature }
      }

      const submitOnchainAction = async (
        setupCalls: StarknetInvokeCall[],
        forceSequential = false
      ) => {
        if (forceSequential && setupCalls.length > 1) {
          let lastTxHash = ""
          for (const call of setupCalls) {
            lastTxHash = await invokeStarknetCallFromWallet(call, providerHint)
          }
          return lastTxHash
        }
        return invokeWalletCallsWithSequentialFallback(setupCalls, providerHint, {
          allowSequentialFallback: !AI_SETUP_SKIP_APPROVE && setupCalls.length === 2,
          onFallback: () => {
            notifications.addNotification({
              type: "warning",
              title: "Wallet multicall fallback",
              message:
                "Wallet multicall failed. Continuing with separate signatures: CAREL approve, then submit_action.",
            })
          },
        })
      }
      const isWalletNonceError = (error: unknown) => {
        const message =
          error instanceof Error ? error.message : typeof error === "string" ? error : ""
        return /invalid transaction nonce|invalid nonce|nonce too low/i.test(message.toLowerCase())
      }

      const isTypedSignatureRequiredError = (message: string) => {
        const lower = message.toLowerCase()
        return (
          lower.includes("message hash required") ||
          lower.includes("invalid user signature") ||
          lower.includes("signature required")
        )
      }

      let setupBundle = await buildSetupCalls()
      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message:
          (AI_SETUP_SKIP_APPROVE
            ? `Confirm submit_action transaction in your Starknet wallet (burn ${executionBurnAmountCarel(selectedTier)} CAREL for this execution).\\nBurn Tx hash will be shown after confirmation.`
            : `Confirm CAREL approval (${approveAmountCarel}) + submit_action transaction in your Starknet wallet (burn ${executionBurnAmountCarel(selectedTier)} CAREL for this execution).\\nBurn Tx hash will be shown after confirmation.`) +
          (setupBundle.usesTypedSignature
            ? ""
            : "\\nSignature challenge is disabled, so setup+burn uses one wallet transaction."),
      })
      let onchainTxHash: string
      try {
        onchainTxHash = await submitOnchainAction(setupBundle.calls)
      } catch (firstError) {
        const firstMessage =
          firstError instanceof Error ? firstError.message : String(firstError ?? "")
        if (!setupBundle.usesTypedSignature && isTypedSignatureRequiredError(firstMessage)) {
          notifications.addNotification({
            type: "info",
            title: "Signature challenge required",
            message:
              "Executor still requires typed-data signature. Refreshing challenge and retrying setup.",
          })
          await waitMs(AI_SETUP_NONCE_RETRY_DELAY_MS)
          setupBundle = await buildSetupCalls({
            forceFreshPrepare: true,
            forceTypedSignature: true,
          })
          notifications.addNotification({
            type: "info",
            title: "Wallet signature required",
            message: "Confirm typed-data signature, then confirm submit_action transaction.",
          })
          onchainTxHash = await submitOnchainAction(setupBundle.calls)
        } else if (
          isInvalidUserSignatureError(firstError) ||
          isWalletMulticallExecutionError(firstMessage)
        ) {
          notifications.addNotification({
            type: "info",
            title: "Refreshing setup signature",
            message:
              "Detected wallet signature mismatch. Refreshing typed-data challenge and retrying with split signatures.",
          })
          await waitMs(AI_SETUP_NONCE_RETRY_DELAY_MS)
          setupBundle = await buildSetupCalls({ forceFreshPrepare: true, forceTypedSignature: true })
          notifications.addNotification({
            type: "info",
            title: "Retrying with refreshed signature",
            message: "Typed-data signature refreshed. Confirm the transaction one more time.",
          })
          onchainTxHash = await submitOnchainAction(setupBundle.calls, true)
        } else if (isWalletNonceError(firstError)) {
          notifications.addNotification({
            type: "info",
            title: "Nonce pending on wallet",
            message:
              "Previous wallet nonce is still pending. Waiting briefly, then retrying setup once.",
          })
          await waitMs(AI_SETUP_NONCE_RETRY_DELAY_MS)
          onchainTxHash = await submitOnchainAction(setupBundle.calls)
        } else {
          throw firstError
        }
      }
      setPreparedActionCache(null)
      lastAiBurnTxHashRef.current = onchainTxHash || ""

      notifications.addNotification({
        type: "info",
        title: "On-chain setup submitted",
        message: "Waiting for setup to appear in pending list...",
        txHash: onchainTxHash,
        txNetwork: "starknet",
      })
      appendMessagesForTier(selectedTier, [
        {
          role: "assistant",
          content: normalizeMessageText(
            `On-chain setup submitted.\\nBurn Tx: ${onchainTxHash.slice(0, 12)}...\\nTrack tx: ${buildTxExplorerUrl(onchainTxHash, "starknet")}`
          ),
          timestamp: nowTimestampLabel(),
        },
      ])
      setupSubmitCooldownUntilRef.current = Date.now() + AI_SETUP_SUBMIT_COOLDOWN_MS
      lastSetupSubmitAtRef.current = Date.now()

      let latestPending: number[] = pendingBefore
      for (let attempt = 0; attempt < AI_SETUP_PENDING_POLL_ATTEMPTS; attempt += 1) {
        await waitMs(AI_SETUP_PENDING_POLL_INTERVAL_MS)
        try {
          const after = requireFresh
            ? await getAiPendingActions(pendingBeforeMax, 50)
            : await getAiPendingActions(0, 50)
          latestPending = after.pending || []
          const discovered = requireFresh
            ? pickLatestPendingAbove(latestPending, pendingBeforeMax)
            : findNewPendingAction(latestPending, pendingBefore)
          if (discovered) {
            setPendingActions(latestPending)
            setActionId(String(discovered))
            lastSetupFailureRef.current = ""
            notifications.addNotification({
              type: "success",
              title: "On-chain setup ready",
              message: `Setup is ready for Tier ${selectedTier}.`,
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
        if (requireFresh) {
          const fresh = pickLatestPendingAbove(latestPending, pendingBeforeMax)
          if (!fresh || fresh <= 0) {
            try {
              const fullTail = await getAiPendingActions(0, 50)
              const fullTailPending = fullTail.pending || []
              setPendingActions(fullTailPending)
              const freshFromFullTail = pickLatestPendingAbove(fullTailPending, pendingBeforeMax)
              if (freshFromFullTail && freshFromFullTail > 0) {
                setActionId(String(freshFromFullTail))
                lastSetupFailureRef.current = ""
                notifications.addNotification({
                  type: "success",
                  title: "On-chain setup ready",
                  message: `Fresh execution setup is ready for Tier ${selectedTier}.`,
                  txHash: onchainTxHash,
                  txNetwork: "starknet",
                })
                return freshFromFullTail
              }
            } catch {
              // Keep the original error below when fallback lookup fails.
            }
            notifications.addNotification({
              type: "error",
              title: "Fresh setup not detected",
              message:
                "No new on-chain setup action was found for this execution. Please sign again in wallet.",
              txHash: onchainTxHash,
              txNetwork: "starknet",
            })
            lastSetupFailureRef.current =
              "No new on-chain setup action was detected yet after wallet signature. Please sign again in wallet."
            return null
          }
          setActionId(String(fresh))
          lastSetupFailureRef.current = ""
          notifications.addNotification({
            type: "success",
            title: "On-chain setup ready",
            message: `Fresh execution setup is ready for Tier ${selectedTier}.`,
            txHash: onchainTxHash,
            txNetwork: "starknet",
          })
          return fresh
        }
        setActionId(String(latest))
        lastSetupFailureRef.current = ""
        notifications.addNotification({
          type: "success",
          title: "On-chain setup ready",
          message: "Using latest pending setup from your account.",
          txHash: onchainTxHash,
          txNetwork: "starknet",
        })
        return latest
      }
      notifications.addNotification({
        type: "info",
        title: "Setup not detected yet",
        message: "Please retry Auto Setup On-Chain in a few seconds.",
        txHash: onchainTxHash,
        txNetwork: "starknet",
      })
      lastSetupFailureRef.current =
        "Setup transaction was submitted, but pending action is not indexed yet. Retry in a few seconds."
      return null
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "submit_action transaction failed"
      const lowerRaw = rawMessage.toLowerCase()
      if (!requireFresh && /rate limit exceeded/i.test(rawMessage)) {
        try {
          const pendingAfter = await getAiPendingActions(0, 50)
          const latest = pickLatestPendingAction(pendingAfter.pending || [])
          if (latest && latest > 0) {
            setPendingActions(pendingAfter.pending || [])
            setActionId(String(latest))
            notifications.addNotification({
              type: "success",
              title: "On-chain setup ready",
              message: "Rate limit reached for new setup requests, using your latest pending setup.",
            })
            lastSetupFailureRef.current = ""
            return latest
          }
        } catch {
          // Ignore and surface the original rate-limit message below.
        }
      }
      const mappedMessage = /caller is missing role/i.test(rawMessage)
        ? "CAREL token has not granted BURNER_ROLE to AI executor yet. Run Auto Setup again after backend preflight completes."
        : /invalid transaction nonce|invalid nonce|nonce too low/i.test(lowerRaw)
          ? "Nonce is still pending on Starknet (previous setup tx not finalized yet). Wait 10-20 seconds, then retry Auto Setup On-Chain once."
        : /rate_limit getter is unavailable|rate_limit entrypoint not found|set_rate_limit entrypoint not found|cannot read ai executor on-chain rate limit|ai executor preflight blocked/i.test(
              lowerRaw
            )
          ? "AI executor preflight could not verify/adjust on-chain rate limit. Ensure backend signer has AI executor admin role, then retry Auto Setup."
        : /(entrypointnotfound|entrypoint not found|entrypoint_not_found)/i.test(rawMessage) &&
            /submit_action/.test(lowerRaw)
          ? "AI executor address/class mismatch (`submit_action` entrypoint not found). Ensure AI_EXECUTOR_ADDRESS and NEXT_PUBLIC_STARKNET_AI_EXECUTOR_ADDRESS point to the correct AIExecutor contract."
        : /(entrypointnotfound|entrypoint not found|entrypoint_not_found)/i.test(rawMessage)
          ? `Configured contract at ${executorAddress || "AI_EXECUTOR_ADDRESS"} does not expose the required setup entrypoint. Recheck deployed class and restart frontend/backend.`
        : /rate limit exceeded/i.test(rawMessage)
          ? "AI executor daily on-chain rate limit reached. Ask admin to increase `set_rate_limit` (for example 1000), or wait until UTC day reset."
        : /request timeout|network error|timed out|timeout/i.test(lowerRaw)
          ? "AI setup preparation timed out before wallet popup appeared. Backend/RPC is still busy preparing typed-data challenge even after automatic retries. Retry once."
        : /message hash required|invalid user signature/.test(lowerRaw)
          ? "AI executor currently requires typed-data signature. Confirm the typed-data popup first, then confirm submit_action transaction."
        : /insufficient allowance/i.test(rawMessage)
          ? "Demo setup is skipping approve, but contract still requires allowance. Disable AI setup fee (fee_enabled=false) or disable NEXT_PUBLIC_AI_SETUP_SKIP_APPROVE."
        : rawMessage
      const message = formatSetupFailureMessage(
        mappedMessage,
        requiredCarelForExecution,
        knownCarelBalance
      )
      lastSetupFailureRef.current = message
      notifications.addNotification({
        type: "error",
        title: "Failed to submit on-chain action",
        message,
      })
      return null
    } finally {
      setIsCreatingAction(false)
    }
  }

  const hasPlanReady = AI_PLAN_ENABLED && !!planId && !isPlanExpired(planExpiresAt)
  const isSetupProcessing =
    isCreatingAction || isAutoPreparingAction || isResolvingExecutor || isCheckingPlan
  const hasSetupReady = AI_PLAN_ENABLED
    ? hasPlanReady
    : AI_REQUIRE_FRESH_SETUP_PER_EXECUTION
      ? false
      : hasValidActionId || pendingActions.length > 0
  const isExecuteButtonBlockedByPrepare =
    commandNeedsAction && isBackgroundPreparingAction && !hasPreparedActionReady

  const handleAutoSetup = async () => {
    setIsAutoPreparingAction(true)
    try {
      if (AI_PLAN_ENABLED) {
        if (hasPlanReady) {
          notifications.addNotification({
            type: "info",
            title: "Plan already active",
            message: "Your AI plan is active. You can execute commands without signing again.",
          })
          return
        }
        const providerHint = resolveStarknetProviderHint(wallet.provider)
        const prepared = await prepareAiPlan()
        notifications.addNotification({
          type: "info",
          title: "Plan signature required",
          message: "Confirm the plan signature in your wallet to enable auto execution.",
        })
        const signature = await signStarknetMessageHashFromWallet(
          prepared.message_hash,
          providerHint
        )
        const approved = await approveAiPlan({
          user: prepared.user,
          agent_id: prepared.agent_id,
          operator: prepared.operator,
          plan_hash: prepared.plan_hash,
          action_mask: prepared.action_mask,
          max_actions: prepared.max_actions,
          expires_at: prepared.expires_at,
          nonce: prepared.nonce,
          signature,
        })
        setPlanId(approved.plan_id)
        setPlanExpiresAt(prepared.expires_at)
        setPlanCheckedAt(Date.now())
        saveStoredPlan({
          plan_id: approved.plan_id,
          user_address: prepared.user,
          expires_at: prepared.expires_at,
          cached_at: Date.now(),
        })
        notifications.addNotification({
          type: "success",
          title: "Plan approved",
          message: "Auto execution plan is now active.",
          txHash: approved.tx_hash,
          txNetwork: "starknet",
        })
        return
      }
      if (AI_REQUIRE_FRESH_SETUP_PER_EXECUTION) {
        await createOnchainActionId({ requireFresh: true })
        return
      }
      const pending = await loadPendingActions(true)
      const latest = pickLatestPendingAction(pending)
      if (latest && latest > 0) {
        setActionId(String(latest))
        notifications.addNotification({
          type: "success",
          title: "On-chain setup ready",
          message: "Using latest pending setup from your account.",
        })
        return
      }
      const created = await createOnchainActionId()
      if (!created) return
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Backend not connected",
        message: formatBackendConnectivityMessage(error),
      })
    } finally {
      setIsAutoPreparingAction(false)
    }
  }

  const getLastBurnTxHash = React.useCallback(() => lastAiBurnTxHashRef.current, [])

  return {
    actionId,
    setActionId,
    planId,
    hasPlanReady,
    aiPlanEnabled: AI_PLAN_ENABLED,
    pendingActions,
    setPendingActions,
    isResolvingExecutor,
    isCreatingAction,
    isAutoPreparingAction,
    isBackgroundPreparingAction,
    hasPreparedActionReady,
    hasSetupReady,
    isSetupProcessing,
    isExecuteButtonBlockedByPrepare,
    effectiveExecutorAddress,
    getLastBurnTxHash,
    ensureExecutorAddress,
    resolveActionId,
    handleAutoSetup,
  }
}
