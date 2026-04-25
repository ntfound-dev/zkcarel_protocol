"use client"

import * as React from "react"
import type { useNotifications } from "@/hooks/notifications/use-notifications"
import type { WalletContextType } from "@/hooks/wallet/use-wallet"
import { invokeStarknetCallsFromWallet } from "@/lib/onchain-trade"
import { getErrorMessage } from "@/lib/errors"
import {
  claimBattleshipTimeout,
  createBattleshipGame,
  fireBattleshipShot,
  getBattleshipState,
  joinBattleshipGame,
  respondBattleshipShot,
  type BattleshipGameStateResponse,
  type StarknetWalletCall,
} from "@/lib/api"
import {
  cellKey,
  type FleetValidation,
} from "@/hooks/battleship/use-battleship-engine"

const POLL_INTERVAL_MS = 4000
const LAST_OPPONENT_STORAGE_KEY = "battleship_last_opponent"

/**
 * Parses or transforms values for `normalizeAddress`.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export const normalizeAddress = (value?: string | null) => {
  const raw = (value || "").trim().toLowerCase()
  if (!raw) return ""
  try {
    const parsed =
      raw.startsWith("0x")
        ? BigInt(raw)
        : /^[0-9]+$/.test(raw)
        ? BigInt(raw)
        : null
    if (parsed !== null) {
      return `0x${parsed.toString(16)}`
    }
  } catch {
    // fallback to raw string when parsing fails
  }
  return raw
}

export const isZeroAddress = (value?: string | null) => normalizeAddress(value) === "0x0"

const toInvokeCalls = (calls: StarknetWalletCall[]) =>
  calls.map((call) => ({
    contractAddress: call.contract_address,
    entrypoint: call.entrypoint,
    calldata: call.calldata,
  }))

type UseBattleshipNetworkParams = {
  wallet: WalletContextType
  notifications: ReturnType<typeof useNotifications>
  fleetValidation: FleetValidation
  collectSetupCells: () => Array<{ x: number; y: number }>
  syncSetupCells: (cells: Array<{ x: number; y: number }>) => void
}

export const useBattleshipNetwork = ({
  wallet,
  notifications,
  fleetValidation,
  collectSetupCells,
  syncSetupCells,
}: UseBattleshipNetworkParams) => {
  const lastWalletRef = React.useRef<string>("")
  const [gameId, setGameId] = React.useState("")
  const [joinGameId, setJoinGameId] = React.useState("")
  const [opponentAddress, setOpponentAddress] = React.useState("")
  const [state, setState] = React.useState<BattleshipGameStateResponse | null>(null)
  const [busyAction, setBusyAction] = React.useState<string | null>(null)
  const [optimisticShots, setOptimisticShots] = React.useState<Set<string>>(new Set())
  const defaultOpponentFromEnv = (process.env.NEXT_PUBLIC_DEV_WALLET_ADDRESS || "").trim()

  const activeGameId = gameId.trim()
  const activeStarknetAddress = React.useMemo(
    () => (wallet.starknetAddress || wallet.address || "").trim(),
    [wallet.address, wallet.starknetAddress]
  )
  const normalizedUser = normalizeAddress(state?.your_address || wallet.address)
  const starknetProviderHint = React.useMemo(
    () => (wallet.provider === "argentx" || wallet.provider === "braavos" ? wallet.provider : "starknet"),
    [wallet.provider]
  )

  const applyState = React.useCallback(
    (next: BattleshipGameStateResponse) => {
      setState(next)
      if (next.your_board.length > 0) {
        syncSetupCells(next.your_board)
      }
      const resolvedKeys = new Set(next.your_shots.map((cell) => cellKey(cell.x, cell.y)))
      setOptimisticShots((prev) => {
        if (prev.size === 0) return prev
        const updated = new Set<string>()
        for (const key of prev) {
          if (!resolvedKeys.has(key)) updated.add(key)
        }
        return updated
      })
    },
    [syncSetupCells]
  )

  const refreshState = React.useCallback(
    async (id?: string) => {
      const target = (id || activeGameId).trim()
      if (!target || !wallet.isConnected) return
      const next = await getBattleshipState(target, {
        starknetAddress: activeStarknetAddress,
      })
      applyState(next)
    },
    [activeGameId, activeStarknetAddress, applyState, wallet.isConnected]
  )

  React.useEffect(() => {
    if (!wallet.isConnected || !activeGameId) return
    let cancelled = false

    const tick = async () => {
      try {
        const next = await getBattleshipState(activeGameId, {
          starknetAddress: activeStarknetAddress,
        })
        if (cancelled) return
        applyState(next)
      } catch {
        // silent polling
      }
    }

    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeGameId, activeStarknetAddress, applyState, wallet.isConnected])

  React.useEffect(() => {
    const normalized = normalizeAddress(activeStarknetAddress)
    if (!normalized) {
      lastWalletRef.current = ""
      return
    }
    if (lastWalletRef.current && lastWalletRef.current !== normalized) {
      setState(null)
      setOptimisticShots(new Set())
    }
    lastWalletRef.current = normalized
  }, [activeStarknetAddress])

  React.useEffect(() => {
    if (activeGameId) return
    setState(null)
  }, [activeGameId])

  React.useEffect(() => {
    if (opponentAddress.trim()) return

    let resolved = ""
    try {
      resolved = window.localStorage.getItem(LAST_OPPONENT_STORAGE_KEY) || ""
    } catch {
      resolved = ""
    }

    if (!resolved && state) {
      const candidate = [state.player_a, state.player_b || ""].find(
        (value) =>
          !!value && !isZeroAddress(value) && normalizeAddress(value) !== normalizedUser
      )
      if (candidate) resolved = candidate
    }

    if (!resolved && defaultOpponentFromEnv) {
      resolved = defaultOpponentFromEnv
    }

    if (!resolved) return
    if (isZeroAddress(resolved)) return
    if (normalizeAddress(resolved) === normalizedUser) return
    setOpponentAddress(resolved)
  }, [defaultOpponentFromEnv, normalizedUser, opponentAddress, state])

  const signPreparedCalls = React.useCallback(
    async (calls: StarknetWalletCall[], message: string) => {
      if (!calls.length) {
        throw new Error("Backend did not return on-chain calls for wallet signature.")
      }
      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message,
      })
      return invokeStarknetCallsFromWallet(toInvokeCalls(calls), starknetProviderHint)
    },
    [notifications, starknetProviderHint]
  )

  const resetForNewGame = React.useCallback(() => {
    setGameId("")
    setJoinGameId("")
    setState(null)
    setOptimisticShots(new Set())
  }, [])

  const createGame = React.useCallback(async () => {
    if (!wallet.isConnected) {
      notifications.addNotification({
        type: "warning",
        title: "Wallet not connected",
        message: "Connect Starknet wallet before creating a game.",
      })
      return
    }
    const opponent = opponentAddress.trim()
    const normalizedSelf = normalizeAddress(wallet.starknetAddress || wallet.address)
    if (opponent && normalizeAddress(opponent) === normalizedSelf) {
      notifications.addNotification({
        type: "warning",
        title: "Invalid opponent",
        message: "Opponent address cannot be your connected wallet.",
      })
      return
    }
    if (!fleetValidation.valid) {
      notifications.addNotification({
        type: "warning",
        title: "Invalid fleet",
        message: fleetValidation.reason,
      })
      return
    }

    const cells = collectSetupCells()
    setBusyAction("create")
    try {
      const prepared = await createBattleshipGame({ opponent, cells }, {
        starknetAddress: activeStarknetAddress,
      })
      const txHash = await signPreparedCalls(
        prepared.onchain_calls || [],
        "Confirm create_game transaction in your Starknet wallet."
      )

      const finalized = await createBattleshipGame(
        { opponent, cells, onchain_tx_hash: txHash },
        { starknetAddress: activeStarknetAddress }
      )

      setGameId(finalized.game_id)
      if (opponent && !isZeroAddress(opponent)) {
        try {
          window.localStorage.setItem(LAST_OPPONENT_STORAGE_KEY, opponent)
        } catch {
          // noop
        }
      }
      let refreshWarning: string | null = null
      try {
        await refreshState(finalized.game_id)
      } catch (refreshError) {
        refreshWarning = getErrorMessage(
          refreshError,
          "Game created, but state refresh failed. Open game ID manually."
        )
      }

      notifications.addNotification({
        type: "success",
        title: "Game created on-chain",
        message: opponent && !isZeroAddress(opponent)
          ? `Game ${finalized.game_id} ready. Share this game ID with invited opponent wallet to join.`
          : `Open challenge ${finalized.game_id} ready. Any non-creator wallet can join first.`,
        txHash,
        txNetwork: "starknet",
      })
      if (refreshWarning) {
        notifications.addNotification({
          type: "warning",
          title: "State refresh delayed",
          message: refreshWarning,
        })
      }
    } catch (error: unknown) {
      notifications.addNotification({
        type: "error",
        title: "Create game failed",
        message: getErrorMessage(error, "Unable to create game on-chain."),
      })
    } finally {
      setBusyAction(null)
    }
  }, [
    activeStarknetAddress,
    collectSetupCells,
    fleetValidation,
    notifications,
    opponentAddress,
    refreshState,
    signPreparedCalls,
    wallet.address,
    wallet.isConnected,
    wallet.starknetAddress,
  ])

  const joinGame = React.useCallback(async () => {
    if (!wallet.isConnected) {
      notifications.addNotification({
        type: "warning",
        title: "Wallet not connected",
        message: "Connect Starknet wallet before joining a game.",
      })
      return
    }
    const target = joinGameId.trim()
    if (!target) {
      notifications.addNotification({
        type: "warning",
        title: "Game ID required",
        message: "Paste game ID first.",
      })
      return
    }
    if (!fleetValidation.valid) {
      notifications.addNotification({
        type: "warning",
        title: "Invalid fleet",
        message: fleetValidation.reason,
      })
      return
    }

    const cells = collectSetupCells()
    setBusyAction("join")
    try {
      const prepared = await joinBattleshipGame({ game_id: target, cells }, {
        starknetAddress: activeStarknetAddress,
      })
      const txHash = await signPreparedCalls(
        prepared.onchain_calls || [],
        "Confirm join_game transaction in your Starknet wallet."
      )

      const finalized = await joinBattleshipGame(
        { game_id: target, cells, onchain_tx_hash: txHash },
        { starknetAddress: activeStarknetAddress }
      )

      setGameId(finalized.game_id)
      let refreshWarning: string | null = null
      try {
        await refreshState(finalized.game_id)
      } catch (refreshError) {
        refreshWarning = getErrorMessage(
          refreshError,
          "Joined game, but state refresh failed. Open game ID manually."
        )
      }
      notifications.addNotification({
        type: "success",
        title: "Joined game",
        message: `Joined game ${finalized.game_id} on-chain.`,
        txHash,
        txNetwork: "starknet",
      })
      if (refreshWarning) {
        notifications.addNotification({
          type: "warning",
          title: "State refresh delayed",
          message: refreshWarning,
        })
      }
    } catch (error: unknown) {
      notifications.addNotification({
        type: "error",
        title: "Join failed",
        message: getErrorMessage(error, "Unable to join game on-chain."),
      })
    } finally {
      setBusyAction(null)
    }
  }, [
    activeStarknetAddress,
    collectSetupCells,
    fleetValidation,
    joinGameId,
    notifications,
    refreshState,
    signPreparedCalls,
    wallet.isConnected,
  ])

  const yourShotsSet = React.useMemo(() => {
    const set = new Set<string>()
    if (state) {
      for (const shot of state.your_shots) {
        set.add(cellKey(shot.x, shot.y))
      }
    }
    for (const key of optimisticShots) {
      set.add(key)
    }
    return set
  }, [optimisticShots, state])

  const isYourTurn = React.useMemo(() => {
    if (!state?.current_turn) return false
    return normalizeAddress(state.current_turn) === normalizedUser
  }, [normalizedUser, state?.current_turn])

  const hasPendingShot = Boolean(state?.pending_shot) || optimisticShots.size > 0
  const canRespond = Boolean(state?.can_respond)

  const fireShot = React.useCallback(
    async (x: number, y: number): Promise<boolean> => {
      if (!activeGameId || !state) return false
      if (state.status !== "PLAYING") return false
      if (!isYourTurn || hasPendingShot) return false

      const key = cellKey(x, y)
      if (yourShotsSet.has(key)) return false

      setOptimisticShots((prev) => {
        const next = new Set(prev)
        next.add(key)
        return next
      })
      setBusyAction(`fire-${key}`)
      try {
        const prepared = await fireBattleshipShot(
          { game_id: activeGameId, x, y },
          { starknetAddress: activeStarknetAddress }
        )
        const txHash = await signPreparedCalls(
          prepared.onchain_calls || [],
          "Confirm fire_shot transaction in your Starknet wallet."
        )

        const finalized = await fireBattleshipShot(
          { game_id: activeGameId, x, y, onchain_tx_hash: txHash },
          { starknetAddress: activeStarknetAddress }
        )

        await refreshState()
        notifications.addNotification({
          type: "success",
          title: "Shot submitted",
          message: finalized.message,
          txHash,
          txNetwork: "starknet",
        })
        return true
      } catch (error: unknown) {
        setOptimisticShots((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
        notifications.addNotification({
          type: "error",
          title: "Fire failed",
          message: getErrorMessage(error, "Unable to fire shot."),
        })
        return false
      } finally {
        setBusyAction(null)
      }
    },
    [
      activeGameId,
      activeStarknetAddress,
      hasPendingShot,
      isYourTurn,
      notifications,
      refreshState,
      signPreparedCalls,
      state,
      yourShotsSet,
    ]
  )

  const respondShot = React.useCallback(
    async (defendX: number, defendY: number): Promise<boolean> => {
      if (!activeGameId || !state || !state.pending_shot) return false
      if (!canRespond) return false

      setBusyAction("respond")
      try {
        const prepared = await respondBattleshipShot(
          { game_id: activeGameId, defend_x: defendX, defend_y: defendY },
          { starknetAddress: activeStarknetAddress }
        )
        const txHash = await signPreparedCalls(
          prepared.onchain_calls || [],
          "Confirm respond_shot transaction in your Starknet wallet."
        )

        const finalized = await respondBattleshipShot(
          {
            game_id: activeGameId,
            defend_x: defendX,
            defend_y: defendY,
            onchain_tx_hash: txHash,
          },
          { starknetAddress: activeStarknetAddress }
        )

        await refreshState()
        notifications.addNotification({
          type: "success",
          title: finalized.is_hit ? "Hit confirmed" : "Miss confirmed",
          message: finalized.message,
          txHash,
          txNetwork: "starknet",
        })
      } catch (error: unknown) {
        notifications.addNotification({
          type: "error",
          title: "Respond failed",
          message: getErrorMessage(error, "Unable to submit shot response."),
        })
        return false
      } finally {
        setBusyAction(null)
      }
      return true
    },
    [activeGameId, activeStarknetAddress, canRespond, notifications, refreshState, signPreparedCalls, state]
  )

  const claimTimeout = React.useCallback(async () => {
    if (!activeGameId) return
    setBusyAction("timeout")
    try {
      const prepared = await claimBattleshipTimeout(
        { game_id: activeGameId },
        { starknetAddress: activeStarknetAddress }
      )
      const txHash = await signPreparedCalls(
        prepared.onchain_calls || [],
        "Confirm claim_timeout transaction in your Starknet wallet."
      )

      const finalized = await claimBattleshipTimeout(
        { game_id: activeGameId, onchain_tx_hash: txHash },
        { starknetAddress: activeStarknetAddress }
      )

      await refreshState()
      notifications.addNotification({
        type: "success",
        title: "Timeout claimed",
        message: finalized.message,
        txHash,
        txNetwork: "starknet",
      })
    } catch (error: unknown) {
      notifications.addNotification({
        type: "error",
        title: "Timeout claim failed",
        message: error instanceof Error ? error.message : "Unable to claim timeout.",
      })
    } finally {
      setBusyAction(null)
    }
  }, [activeGameId, activeStarknetAddress, notifications, refreshState, signPreparedCalls])

  const yourShotResolvedMap = React.useMemo(() => {
    const map = new Map<string, boolean>()
    if (!state) return map
    for (const shot of state.shot_history) {
      if (normalizeAddress(shot.shooter) !== normalizedUser) continue
      map.set(cellKey(shot.x, shot.y), shot.is_hit)
    }
    return map
  }, [normalizedUser, state])

  const opponentShotResolvedMap = React.useMemo(() => {
    const map = new Map<string, boolean>()
    if (!state) return map
    for (const shot of state.shot_history) {
      if (normalizeAddress(shot.shooter) === normalizedUser) continue
      map.set(cellKey(shot.x, shot.y), shot.is_hit)
    }
    return map
  }, [normalizedUser, state])

  const opponentShotSet = React.useMemo(() => {
    const set = new Set<string>()
    if (!state) return set
    for (const shot of state.opponent_shots) {
      set.add(cellKey(shot.x, shot.y))
    }
    return set
  }, [state])

  const yourBoardSet = React.useMemo(() => {
    const set = new Set<string>()
    if (!state) return set
    for (const cell of state.your_board) {
      set.add(cellKey(cell.x, cell.y))
    }
    return set
  }, [state])

  return {
    gameId,
    setGameId,
    joinGameId,
    setJoinGameId,
    opponentAddress,
    setOpponentAddress,
    state,
    busyAction,
    activeGameId,
    normalizedUser,
    activeStarknetAddress,
    isYourTurn,
    hasPendingShot,
    canRespond,
    yourShotsSet,
    opponentShotSet,
    yourBoardSet,
    yourShotResolvedMap,
    opponentShotResolvedMap,
    refreshState,
    resetForNewGame,
    createGame,
    joinGame,
    fireShot,
    respondShot,
    claimTimeout,
  }
}
