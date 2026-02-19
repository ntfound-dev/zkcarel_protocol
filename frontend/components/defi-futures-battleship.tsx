"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useNotifications } from "@/hooks/use-notifications"
import { useWallet } from "@/hooks/use-wallet"
import { invokeStarknetCallsFromWallet } from "@/lib/onchain-trade"
import {
  claimBattleshipTimeout,
  createBattleshipGame,
  fireBattleshipShot,
  getBattleshipState,
  joinBattleshipGame,
  respondBattleshipShot,
  type BattleshipCell,
  type BattleshipGameStateResponse,
  type StarknetWalletCall,
} from "@/lib/api"

const BOARD_SIZE = 5
const REQUIRED_SHIP_CELLS = 9
const EXPECTED_FLEET_GROUPS = [1, 1, 2, 2, 3]
const POLL_INTERVAL_MS = 4000
const LAST_OPPONENT_STORAGE_KEY = "battleship_last_opponent"

function cellKey(x: number, y: number) {
  return `${x},${y}`
}

function parseCellKey(key: string): BattleshipCell | null {
  const [xRaw, yRaw] = key.split(",")
  const x = Number(xRaw)
  const y = Number(yRaw)
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null
  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return null
  return { x, y }
}

function normalizeAddress(value?: string | null) {
  return (value || "").trim().toLowerCase()
}

function toInvokeCalls(calls: StarknetWalletCall[]) {
  return calls.map((call) => ({
    contractAddress: call.contract_address,
    entrypoint: call.entrypoint,
    calldata: call.calldata,
  }))
}

function orthogonalNeighbors(x: number, y: number) {
  return [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ] as const
}

type FleetValidation = {
  valid: boolean
  reason: string
  groupSizes: number[]
}

function validateFleetCells(keys: Set<string>): FleetValidation {
  if (keys.size !== REQUIRED_SHIP_CELLS) {
    return {
      valid: false,
      reason: `Select exactly ${REQUIRED_SHIP_CELLS} cells.`,
      groupSizes: [],
    }
  }

  const cells = Array.from(keys)
    .map(parseCellKey)
    .filter((cell): cell is BattleshipCell => cell !== null)

  if (cells.length !== REQUIRED_SHIP_CELLS) {
    return {
      valid: false,
      reason: "Invalid cell coordinate detected.",
      groupSizes: [],
    }
  }

  const has = new Set(cells.map((cell) => cellKey(cell.x, cell.y)))
  const visited = new Set<string>()
  const groups: BattleshipCell[][] = []

  for (const cell of cells) {
    const start = cellKey(cell.x, cell.y)
    if (visited.has(start)) continue
    visited.add(start)
    const queue: BattleshipCell[] = [cell]
    const group: BattleshipCell[] = []

    while (queue.length > 0) {
      const current = queue.shift()!
      group.push(current)
      for (const [nx, ny] of orthogonalNeighbors(current.x, current.y)) {
        if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) continue
        const neighborKey = cellKey(nx, ny)
        if (!has.has(neighborKey) || visited.has(neighborKey)) continue
        visited.add(neighborKey)
        queue.push({ x: nx, y: ny })
      }
    }

    groups.push(group)
  }

  const groupSizes = groups.map((group) => group.length).sort((a, b) => a - b)
  const expected = EXPECTED_FLEET_GROUPS.join(",")
  const got = groupSizes.join(",")
  if (got !== expected) {
    return {
      valid: false,
      reason: `Fleet must be [3,2,2,1,1]. Current groups: [${groupSizes.join(",")}].`,
      groupSizes,
    }
  }

  for (const group of groups) {
    if (group.length <= 1) continue
    const sameX = group.every((cell) => cell.x === group[0].x)
    const sameY = group.every((cell) => cell.y === group[0].y)
    if (!sameX && !sameY) {
      return {
        valid: false,
        reason: "Ships must be straight (horizontal or vertical).",
        groupSizes,
      }
    }
    if (sameX) {
      const ys = group.map((cell) => cell.y).sort((a, b) => a - b)
      if (ys.some((value, index) => index > 0 && value !== ys[index - 1] + 1)) {
        return {
          valid: false,
          reason: "Ship cells must be contiguous.",
          groupSizes,
        }
      }
    } else {
      const xs = group.map((cell) => cell.x).sort((a, b) => a - b)
      if (xs.some((value, index) => index > 0 && value !== xs[index - 1] + 1)) {
        return {
          valid: false,
          reason: "Ship cells must be contiguous.",
          groupSizes,
        }
      }
    }
  }

  return {
    valid: true,
    reason: "Fleet valid [3,2,2,1,1].",
    groupSizes,
  }
}

export function DefiFuturesBattleship() {
  const wallet = useWallet()
  const notifications = useNotifications()

  const [gameId, setGameId] = React.useState("")
  const [joinGameId, setJoinGameId] = React.useState("")
  const [opponentAddress, setOpponentAddress] = React.useState("")
  const [state, setState] = React.useState<BattleshipGameStateResponse | null>(null)
  const [setupCells, setSetupCells] = React.useState<Set<string>>(new Set())
  const [busyAction, setBusyAction] = React.useState<string | null>(null)
  const [selectedTarget, setSelectedTarget] = React.useState<string | null>(null)
  const defaultOpponentFromEnv = (process.env.NEXT_PUBLIC_DEV_WALLET_ADDRESS || "").trim()

  const activeGameId = gameId.trim()
  const normalizedUser = normalizeAddress(state?.your_address || wallet.address)
  const starknetProviderHint = React.useMemo(
    () => (wallet.provider === "argentx" || wallet.provider === "braavos" ? wallet.provider : "starknet"),
    [wallet.provider]
  )

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

  const yourShotsSet = React.useMemo(() => {
    const set = new Set<string>()
    if (!state) return set
    for (const shot of state.your_shots) {
      set.add(cellKey(shot.x, shot.y))
    }
    return set
  }, [state])

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

  const isYourTurn = React.useMemo(() => {
    if (!state?.current_turn) return false
    return normalizeAddress(state.current_turn) === normalizedUser
  }, [normalizedUser, state?.current_turn])

  const hasPendingShot = Boolean(state?.pending_shot)
  const canRespond = Boolean(state?.can_respond)

  const selectedTargetCell = React.useMemo(
    () => (selectedTarget ? parseCellKey(selectedTarget) : null),
    [selectedTarget]
  )
  const fleetValidation = React.useMemo(() => validateFleetCells(setupCells), [setupCells])

  const refreshState = React.useCallback(
    async (id?: string) => {
      const target = (id || activeGameId).trim()
      if (!target || !wallet.isConnected) return
      const next = await getBattleshipState(target)
      setState(next)
      if (next.your_board.length > 0) {
        const nextCells = new Set(next.your_board.map((cell) => cellKey(cell.x, cell.y)))
        setSetupCells(nextCells)
      }
    },
    [activeGameId, wallet.isConnected]
  )

  React.useEffect(() => {
    if (!wallet.isConnected || !activeGameId) return
    let cancelled = false

    const tick = async () => {
      try {
        const next = await getBattleshipState(activeGameId)
        if (cancelled) return
        setState(next)
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
  }, [activeGameId, wallet.isConnected])

  React.useEffect(() => {
    if (state?.status !== "PLAYING") {
      setSelectedTarget(null)
      return
    }
    if (!isYourTurn || hasPendingShot) {
      setSelectedTarget(null)
    }
  }, [hasPendingShot, isYourTurn, state?.status])

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
        (value) => !!value && normalizeAddress(value) !== normalizedUser
      )
      if (candidate) resolved = candidate
    }

    if (!resolved && defaultOpponentFromEnv) {
      resolved = defaultOpponentFromEnv
    }

    if (!resolved) return
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

  const collectSetupCells = React.useCallback(() => {
    const cells: BattleshipCell[] = []
    for (const key of setupCells) {
      const parsed = parseCellKey(key)
      if (parsed) cells.push(parsed)
    }
    return cells
  }, [setupCells])

  const handleCreateGame = React.useCallback(async () => {
    if (!wallet.isConnected) {
      notifications.addNotification({
        type: "warning",
        title: "Wallet not connected",
        message: "Connect Starknet wallet before creating a game.",
      })
      return
    }
    const opponent = opponentAddress.trim()
    if (!opponent) {
      notifications.addNotification({
        type: "warning",
        title: "Opponent required",
        message: "Input opponent Starknet address first.",
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
      const prepared = await createBattleshipGame({ opponent, cells })
      const txHash = await signPreparedCalls(
        prepared.onchain_calls || [],
        "Confirm create_game transaction in your Starknet wallet."
      )

      const finalized = await createBattleshipGame({
        opponent,
        cells,
        onchain_tx_hash: txHash,
      })

      setGameId(finalized.game_id)
      setJoinGameId(finalized.game_id)
      try {
        window.localStorage.setItem(LAST_OPPONENT_STORAGE_KEY, opponent)
      } catch {
        // noop
      }
      await refreshState(finalized.game_id)

      notifications.addNotification({
        type: "success",
        title: "Game created on-chain",
        message: `Game ${finalized.game_id} ready.`,
        txHash,
      })
    } catch (error: any) {
      notifications.addNotification({
        type: "error",
        title: "Create game failed",
        message: error?.message || "Unable to create game on-chain.",
      })
    } finally {
      setBusyAction(null)
    }
  }, [collectSetupCells, fleetValidation, notifications, opponentAddress, refreshState, signPreparedCalls, wallet.isConnected])

  const handleJoinGame = React.useCallback(async () => {
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
      const prepared = await joinBattleshipGame({ game_id: target, cells })
      const txHash = await signPreparedCalls(
        prepared.onchain_calls || [],
        "Confirm join_game transaction in your Starknet wallet."
      )

      const finalized = await joinBattleshipGame({
        game_id: target,
        cells,
        onchain_tx_hash: txHash,
      })

      setGameId(finalized.game_id)
      await refreshState(finalized.game_id)
      notifications.addNotification({
        type: "success",
        title: "Joined game",
        message: `Joined game ${finalized.game_id} on-chain.`,
        txHash,
      })
    } catch (error: any) {
      notifications.addNotification({
        type: "error",
        title: "Join failed",
        message: error?.message || "Unable to join game on-chain.",
      })
    } finally {
      setBusyAction(null)
    }
  }, [collectSetupCells, fleetValidation, joinGameId, notifications, refreshState, signPreparedCalls, wallet.isConnected])

  const toggleSetupCell = React.useCallback((x: number, y: number) => {
    if (state?.your_ready) return
    setSetupCells((prev) => {
      const next = new Set(prev)
      const key = cellKey(x, y)
      if (next.has(key)) {
        next.delete(key)
        return next
      }
      if (next.size >= REQUIRED_SHIP_CELLS) return next
      next.add(key)
      return next
    })
  }, [state?.your_ready])

  const handleAutoFleet = React.useCallback(() => {
    if (state?.your_ready) return
    // 5 ships: [3,2,2,1,1], all orthogonally separated
    const preset: BattleshipCell[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 0, y: 3 },
      { x: 1, y: 3 },
      { x: 3, y: 2 },
      { x: 4, y: 4 },
    ]
    setSetupCells(new Set(preset.map((cell) => cellKey(cell.x, cell.y))))
  }, [state?.your_ready])

  const handleClearFleet = React.useCallback(() => {
    if (state?.your_ready) return
    setSetupCells(new Set())
  }, [state?.your_ready])

  const handleFire = React.useCallback(
    async (x: number, y: number) => {
      if (!activeGameId || !state) return
      if (state.status !== "PLAYING") return
      if (!isYourTurn || hasPendingShot) return

      const key = cellKey(x, y)
      if (yourShotsSet.has(key)) return

      setBusyAction(`fire-${key}`)
      try {
        const prepared = await fireBattleshipShot({
          game_id: activeGameId,
          x,
          y,
        })
        const txHash = await signPreparedCalls(
          prepared.onchain_calls || [],
          "Confirm fire_shot transaction in your Starknet wallet."
        )

        const finalized = await fireBattleshipShot({
          game_id: activeGameId,
          x,
          y,
          onchain_tx_hash: txHash,
        })

        setSelectedTarget(null)
        await refreshState()
        notifications.addNotification({
          type: "success",
          title: "Shot submitted",
          message: finalized.message,
          txHash,
        })
      } catch (error: any) {
        notifications.addNotification({
          type: "error",
          title: "Fire failed",
          message: error?.message || "Unable to fire shot.",
        })
      } finally {
        setBusyAction(null)
      }
    },
    [activeGameId, hasPendingShot, isYourTurn, notifications, refreshState, signPreparedCalls, state, yourShotsSet]
  )

  const handleRespond = React.useCallback(async () => {
    if (!activeGameId || !state || !state.pending_shot) return
    if (!canRespond) return

    const pendingKey = cellKey(state.pending_shot.x, state.pending_shot.y)
    const inferredHit = yourBoardSet.has(pendingKey)

    setBusyAction("respond")
    try {
      const prepared = await respondBattleshipShot({
        game_id: activeGameId,
        is_hit: inferredHit,
      })
      const txHash = await signPreparedCalls(
        prepared.onchain_calls || [],
        "Confirm respond_shot transaction in your Starknet wallet."
      )

      const finalized = await respondBattleshipShot({
        game_id: activeGameId,
        is_hit: inferredHit,
        onchain_tx_hash: txHash,
      })

      await refreshState()
      notifications.addNotification({
        type: "success",
        title: finalized.is_hit ? "Hit confirmed" : "Miss confirmed",
        message: finalized.message,
        txHash,
      })
    } catch (error: any) {
      notifications.addNotification({
        type: "error",
        title: "Respond failed",
        message: error?.message || "Unable to submit shot response.",
      })
    } finally {
      setBusyAction(null)
    }
  }, [activeGameId, canRespond, notifications, refreshState, signPreparedCalls, state, yourBoardSet])

  const handleClaimTimeout = React.useCallback(async () => {
    if (!activeGameId) return
    setBusyAction("timeout")
    try {
      const prepared = await claimBattleshipTimeout({ game_id: activeGameId })
      const txHash = await signPreparedCalls(
        prepared.onchain_calls || [],
        "Confirm claim_timeout transaction in your Starknet wallet."
      )

      const finalized = await claimBattleshipTimeout({
        game_id: activeGameId,
        onchain_tx_hash: txHash,
      })

      await refreshState()
      notifications.addNotification({
        type: "success",
        title: "Timeout claimed",
        message: finalized.message,
        txHash,
      })
    } catch (error: any) {
      notifications.addNotification({
        type: "error",
        title: "Timeout claim failed",
        message: error?.message || "Unable to claim timeout.",
      })
    } finally {
      setBusyAction(null)
    }
  }, [activeGameId, notifications, refreshState, signPreparedCalls])

  const canClaimTimeout = busyAction !== "timeout" && state?.status === "PLAYING"
  const canCommitShot =
    !!selectedTargetCell &&
    state?.status === "PLAYING" &&
    isYourTurn &&
    !hasPendingShot &&
    busyAction == null

  return (
    <Card className="relative overflow-hidden border-[#a855f7]/40 bg-[#05030d]/95 text-[#e7dcff] shadow-[0_0_50px_rgba(124,58,237,0.25)]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(168,85,247,0.28),transparent_36%),radial-gradient(circle_at_85%_85%,rgba(34,211,238,0.18),transparent_35%),linear-gradient(180deg,rgba(8,4,20,0.92),rgba(2,1,8,0.98))]" />
        <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(168,85,247,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(168,85,247,0.16)_1px,transparent_1px)] [background-size:38px_38px]" />
      </div>

      <CardHeader className="relative border-b border-[#a855f7]/30 bg-[#0d0820]/70">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-xl font-semibold tracking-[0.22em] text-cyan-300">
            BATTLESHIP
          </CardTitle>
          <Badge className="border border-cyan-400/70 bg-cyan-400/10 font-mono text-[10px] tracking-[0.2em] text-cyan-300">
            GARAGA ZK ON-CHAIN
          </Badge>
        </div>
        <CardDescription className="text-[#c6b3ff]">
          Commit board, fire, respond, and timeout are all signed and executed on Starknet.
        </CardDescription>
      </CardHeader>

      <CardContent className="relative space-y-6 p-5">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Input
              value={opponentAddress}
              onChange={(event) => setOpponentAddress(event.target.value)}
              placeholder="Opponent Starknet address (0x...)"
              className="border-[#7c3aed]/60 bg-[#130d2a]/85 text-[#e7dcff] placeholder:text-[#9274c9]"
            />
            <Button
              onClick={handleCreateGame}
              disabled={busyAction === "create"}
              className="border border-cyan-400/70 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25"
            >
              Create Game + Commit Fleet
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <Input
              value={joinGameId}
              onChange={(event) => setJoinGameId(event.target.value)}
              placeholder="Paste game_id to join"
              className="border-[#7c3aed]/60 bg-[#130d2a]/85 text-[#e7dcff] placeholder:text-[#9274c9]"
            />
            <Button
              onClick={handleJoinGame}
              disabled={busyAction === "join"}
              className="border border-[#7c3aed]/70 bg-[#2f1c5a] text-[#e9ddff] hover:bg-[#3c2370]"
            >
              Join Game + Commit Fleet
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <Badge className="border border-[#8b5cf6]/70 bg-[#1c1138]/90 text-[#d5c5ff]">GAME_ID {activeGameId || "-"}</Badge>
          <Badge className="border border-[#8b5cf6]/60 bg-[#160f2f]/80 text-[#d5c5ff]">STATUS {state?.status || "IDLE"}</Badge>
          <Badge className="border border-[#8b5cf6]/60 bg-[#160f2f]/80 text-[#d5c5ff]">
            TURN {state?.current_turn ? (isYourTurn ? "YOU" : "OPPONENT") : "-"}
          </Badge>
          <Badge className="border border-[#8b5cf6]/60 bg-[#160f2f]/80 text-[#d5c5ff]">WINNER {state?.winner || "-"}</Badge>
          <Badge className="border border-[#8b5cf6]/60 bg-[#160f2f]/80 text-[#d5c5ff]">
            TIMEOUT {state?.timeout_in_seconds != null ? `${state.timeout_in_seconds}s` : "-"}
          </Badge>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_auto_1fr]">
          <section className="rounded-xl border border-[#a855f7]/50 bg-[#120a2b]/70 p-4 backdrop-blur-sm">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold tracking-[0.18em] text-cyan-300">YOUR BOARD</h4>
              <span className="text-[10px] uppercase tracking-[0.18em] text-[#bda2ff]">
                selected {setupCells.size}/{REQUIRED_SHIP_CELLS}
              </span>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge
                className={cn(
                  "border text-[10px] font-mono",
                  fleetValidation.valid
                    ? "border-emerald-400/70 bg-emerald-500/20 text-emerald-100"
                    : "border-amber-400/70 bg-amber-500/20 text-amber-100"
                )}
              >
                {fleetValidation.reason}
              </Badge>
              {!!fleetValidation.groupSizes.length && (
                <Badge className="border border-[#8b5cf6]/60 bg-[#160f2f]/80 text-[#d5c5ff]">
                  groups [{fleetValidation.groupSizes.join(",")}]
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-5 gap-2">
              {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
                const x = index % BOARD_SIZE
                const y = Math.floor(index / BOARD_SIZE)
                const key = cellKey(x, y)
                const isPlaced = setupCells.has(key) || yourBoardSet.has(key)
                const wasShotByOpponent = opponentShotSet.has(key)
                const resolvedHit = opponentShotResolvedMap.get(key)
                const isPendingShot =
                  state?.pending_shot &&
                  state.pending_shot.x === x &&
                  state.pending_shot.y === y &&
                  !opponentShotResolvedMap.has(key)

                return (
                  <button
                    key={`your-${key}`}
                    type="button"
                    onClick={() => toggleSetupCell(x, y)}
                    className={cn(
                      "relative flex h-12 items-center justify-center overflow-hidden rounded-md border text-[10px] font-semibold tracking-[0.14em] transition-all",
                      "border-[#7e3af2]/50 bg-[#170e34]",
                      isPlaced && "border-[#d946ef]/80 bg-[#301253] text-[#f3d8ff] shadow-[0_0_16px_rgba(217,70,239,0.5)]",
                      wasShotByOpponent && resolvedHit === true &&
                        "border-red-400/90 bg-[#370e1a] text-red-200 shadow-[0_0_18px_rgba(239,68,68,0.7)]",
                      wasShotByOpponent && resolvedHit === false &&
                        "border-sky-400/90 bg-[#0b1f3a] text-sky-200 shadow-[0_0_16px_rgba(56,189,248,0.7)]",
                      isPendingShot &&
                        "border-amber-300/90 bg-amber-500/20 text-amber-100 shadow-[0_0_16px_rgba(251,191,36,0.55)]"
                    )}
                    aria-label={`your-cell-${x}-${y}`}
                  >
                    <span className="relative">
                      {isPendingShot
                        ? "PEND"
                        : wasShotByOpponent
                        ? resolvedHit
                          ? "HIT"
                          : "MISS"
                        : isPlaced
                        ? "SHIP"
                        : ""}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleAutoFleet}
                disabled={Boolean(state?.your_ready)}
                className="border-emerald-400/70 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
              >
                Auto Fleet
              </Button>
              <Button
                variant="outline"
                onClick={handleClearFleet}
                disabled={Boolean(state?.your_ready)}
                className="border-[#a855f7]/70 bg-[#1c1037]/80 text-[#dacaff] hover:bg-[#261349]"
              >
                Clear Fleet
              </Button>
              <Button
                variant="outline"
                onClick={handleClaimTimeout}
                disabled={!canClaimTimeout}
                className="border-[#a855f7]/70 bg-[#1c1037]/80 text-[#dacaff] hover:bg-[#261349]"
              >
                Claim Timeout
              </Button>
              <Button
                onClick={handleRespond}
                disabled={!canRespond || busyAction === "respond"}
                className="border border-amber-400/70 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30"
              >
                Respond Pending Shot
              </Button>
            </div>
          </section>

          <section className="flex min-w-[210px] flex-col items-center justify-center gap-4 rounded-xl border border-cyan-400/45 bg-[#0d1b2d]/55 p-4 text-center backdrop-blur-sm">
            <div className="rounded-full border border-cyan-300/70 bg-cyan-400/10 px-4 py-1 text-xs font-semibold tracking-[0.2em] text-cyan-300">
              ZK PROOF
            </div>
            <div className="text-xs font-mono text-[#a5f3fc]">
              PLAYER 1 <span className="mx-2 text-[#67e8f9]">← verify →</span> PLAYER 2
            </div>
            <div className="grid w-full gap-2 text-[11px] text-[#bdefff]">
              <div className="rounded-md border border-cyan-400/40 bg-cyan-400/10 px-3 py-2">Commitment locked on-chain</div>
              <div className="rounded-md border border-cyan-400/40 bg-cyan-400/10 px-3 py-2">Garaga proof per action</div>
              <div className="rounded-md border border-cyan-400/40 bg-cyan-400/10 px-3 py-2">Wallet signed transaction hash</div>
            </div>
            {state?.pending_shot ? (
              <div className="rounded-md border border-amber-400/60 bg-amber-500/15 px-3 py-2 text-[11px] text-amber-100">
                Pending shot: ({state.pending_shot.x}, {state.pending_shot.y}) from {normalizeAddress(state.pending_shot.shooter) === normalizedUser ? "You" : "Opponent"}
              </div>
            ) : (
              <div className="rounded-md border border-cyan-400/40 bg-cyan-400/10 px-3 py-2 text-[11px] text-[#bdefff]">
                No pending shot.
              </div>
            )}
          </section>

          <section className="rounded-xl border border-[#a855f7]/50 bg-[#120a2b]/70 p-4 backdrop-blur-sm">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold tracking-[0.18em] text-cyan-300">TARGET BOARD</h4>
              <span className="text-[10px] uppercase tracking-[0.16em] text-[#c4afff]">Fire Coordinates</span>
            </div>

            <div className="grid grid-cols-5 gap-2">
              {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
                const x = index % BOARD_SIZE
                const y = Math.floor(index / BOARD_SIZE)
                const key = cellKey(x, y)
                const shotTaken = yourShotsSet.has(key)
                const resolved = yourShotResolvedMap.get(key)
                const isPending = shotTaken && !yourShotResolvedMap.has(key)
                const canPickTarget =
                  state?.status === "PLAYING" && isYourTurn && !hasPendingShot && !shotTaken && busyAction == null
                const isSelected = selectedTarget === key

                return (
                  <button
                    key={`target-${key}`}
                    type="button"
                    onClick={() =>
                      canPickTarget && setSelectedTarget((prev) => (prev === key ? null : key))
                    }
                    className={cn(
                      "relative flex h-12 items-center justify-center overflow-hidden rounded-md border text-[10px] font-semibold tracking-[0.14em] transition-all",
                      "border-[#7e3af2]/50 bg-[#170e34]",
                      canPickTarget && "hover:border-[#22d3ee]/75 hover:shadow-[0_0_10px_rgba(34,211,238,0.5)]",
                      isSelected && "border-cyan-300/90 ring-2 ring-cyan-300/70",
                      shotTaken && resolved === true && "border-red-400/90 bg-[#3a0e18] text-red-200 shadow-[0_0_20px_rgba(239,68,68,0.75)]",
                      shotTaken && resolved === false && "border-sky-400/90 bg-[#09233b] text-sky-200 shadow-[0_0_18px_rgba(56,189,248,0.7)]",
                      isPending && "border-amber-300/90 bg-amber-500/20 text-amber-100 shadow-[0_0_16px_rgba(251,191,36,0.55)]"
                    )}
                    aria-label={`target-cell-${x}-${y}`}
                  >
                    <span className="relative">
                      {shotTaken
                        ? resolved === true
                          ? "HIT"
                          : resolved === false
                          ? "MISS"
                          : "PEND"
                        : isSelected
                        ? "LOCK"
                        : ""}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="mt-4 space-y-2">
              <p className="text-xs text-[#b9a3f6]">
                {state?.status === "PLAYING"
                  ? canRespond
                    ? "You must respond to pending shot first."
                    : isYourTurn
                    ? "Pick target and commit transaction on-chain."
                    : "Waiting for opponent turn."
                  : "Create or join game first."}
              </p>
              <Button
                onClick={() => selectedTargetCell && void handleFire(selectedTargetCell.x, selectedTargetCell.y)}
                disabled={!canCommitShot}
                className="h-11 w-full border border-amber-400/80 bg-gradient-to-r from-amber-500/35 to-orange-500/35 text-amber-100 shadow-[0_0_18px_rgba(245,158,11,0.35)] hover:from-amber-500/45 hover:to-orange-500/45"
              >
                COMMIT TRANSACTION
              </Button>
              <p className="text-[11px] font-mono text-[#9fe7ff]">
                {selectedTargetCell
                  ? `Target locked: (${selectedTargetCell.x}, ${selectedTargetCell.y})`
                  : "No target locked"}
              </p>
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-[#a855f7]/40 bg-[#100824]/70 p-4">
          <h4 className="mb-2 text-sm font-semibold tracking-[0.15em] text-cyan-300">How It Works</h4>
          <ol className="space-y-1 text-xs text-[#d7c6ff]">
            <li>1. Creator commits fleet on-chain in `create_game`.</li>
            <li>2. Opponent commits fleet on-chain in `join_game`.</li>
            <li>3. Shooter fires coordinate on-chain with `fire_shot`.</li>
            <li>4. Defender responds on-chain with Garaga proof in `respond_shot`.</li>
            <li>5. Timeout and winner are resolved on-chain.</li>
          </ol>
        </section>

        <section className="space-y-2">
          <h4 className="text-sm font-semibold tracking-[0.15em] text-cyan-300">HUD / Recent Shots</h4>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-[#7c3aed]/45 bg-[#0d0720]/80 p-3 text-xs">
            {state?.shot_history?.length ? (
              state.shot_history
                .slice()
                .reverse()
                .slice(0, 20)
                .map((shot, index) => (
                  <div
                    key={`${shot.timestamp}-${index}`}
                    className="flex items-center justify-between gap-2 rounded border border-[#2f1b59] bg-[#140b2a]/70 px-2 py-1"
                  >
                    <span className="text-[#d9ccff]">
                      {normalizeAddress(shot.shooter) === normalizedUser ? "You" : "Opponent"} fired ({shot.x},{shot.y})
                    </span>
                    <Badge
                      className={cn(
                        "font-mono text-[10px]",
                        shot.is_hit
                          ? "border border-red-400/80 bg-red-500/20 text-red-200"
                          : "border border-sky-400/80 bg-sky-500/20 text-sky-200"
                      )}
                    >
                      {shot.is_hit ? "HIT" : "MISS"}
                    </Badge>
                  </div>
                ))
            ) : (
              <p className="text-[#9f89cf]">No resolved shots yet.</p>
            )}
          </div>
        </section>
      </CardContent>
    </Card>
  )
}
