"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useNotifications } from "@/hooks/notifications/use-notifications"
import { useWallet } from "@/hooks/wallet/use-wallet"
import {
  BOARD_SIZE,
  REQUIRED_SHIP_CELLS,
  cellKey,
  parseCellKey,
  useBattleshipEngine,
} from "@/hooks/battleship/use-battleship-engine"
import {
  normalizeAddress,
  useBattleshipNetwork,
} from "@/hooks/battleship/use-battleship-network"
import { BattleshipBoard } from "@/components/battleship/BattleshipBoard"
import { RadarLog } from "@/components/battleship/RadarLog"

/**
 * Handles `DefiFuturesBattleship` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function DefiFuturesBattleship() {
  const wallet = useWallet()
  const notifications = useNotifications()
  const lastWalletRef = React.useRef<string>("")
  const [selectedTarget, setSelectedTarget] = React.useState<string | null>(null)
  const [selectedDefense, setSelectedDefense] = React.useState<string | null>(null)
  const [isResolving, setIsResolving] = React.useState(false)

  const {
    setupCells,
    fleetValidation,
    toggleSetupCell,
    autoFleet,
    clearFleet,
    collectSetupCells,
    syncSetupCells,
  } = useBattleshipEngine()

  const {
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
    resetForNewGame,
    createGame,
    joinGame,
    fireShot,
    respondShot,
    claimTimeout,
  } = useBattleshipNetwork({
    wallet,
    notifications,
    fleetValidation,
    collectSetupCells,
    syncSetupCells,
  })

  const setupLocked = Boolean(activeGameId && state?.your_ready)
  const selectedTargetCell = React.useMemo(
    () => (selectedTarget ? parseCellKey(selectedTarget) : null),
    [selectedTarget]
  )

  React.useEffect(() => {
    const normalized = normalizeAddress(activeStarknetAddress)
    if (!normalized) {
      lastWalletRef.current = ""
      return
    }
    if (lastWalletRef.current && lastWalletRef.current !== normalized) {
      resetForNewGame()
      clearFleet()
      setSelectedTarget(null)
      setSelectedDefense(null)
    }
    lastWalletRef.current = normalized
  }, [activeStarknetAddress, clearFleet, resetForNewGame])

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
    if (!canRespond || !state?.pending_shot) {
      setSelectedDefense(null)
    }
  }, [canRespond, state?.pending_shot])

  React.useEffect(() => {
    if (state?.status === "FINISHED") {
      setIsResolving(true)
      const timer = window.setTimeout(() => setIsResolving(false), 1000)
      return () => window.clearTimeout(timer)
    }
    setIsResolving(false)
  }, [state?.status])

  const handleSelectOwnCell = React.useCallback(
    (x: number, y: number) => {
      if (canRespond && state?.pending_shot) {
        const key = cellKey(x, y)
        setSelectedDefense((prev) => (prev === key ? null : key))
        return
      }
      if (setupLocked) return
      toggleSetupCell(x, y)
    },
    [canRespond, setupLocked, state?.pending_shot, toggleSetupCell]
  )

  const handleAutoFleet = React.useCallback(() => {
    if (setupLocked) return
    autoFleet()
  }, [autoFleet, setupLocked])

  const handleClearFleet = React.useCallback(() => {
    if (setupLocked) return
    clearFleet()
  }, [clearFleet, setupLocked])

  const handleFire = React.useCallback(
    async (x: number, y: number) => {
      const success = await fireShot(x, y)
      if (success) {
        setSelectedTarget(null)
      }
    },
    [fireShot]
  )

  const handleRespond = React.useCallback(async () => {
    if (!selectedDefense) {
      notifications.addNotification({
        type: "warning",
        title: "Defense cell required",
        message: "Klik 1 sel di board kamu untuk defend sebelum respond.",
      })
      return
    }
    const selected = parseCellKey(selectedDefense)
    if (!selected) return

    const success = await respondShot(selected.x, selected.y)
    if (success) {
      setSelectedDefense(null)
    }
  }, [notifications, respondShot, selectedDefense])

  const handleResetForNewGame = React.useCallback(() => {
    resetForNewGame()
    clearFleet()
    setSelectedTarget(null)
    setSelectedDefense(null)
  }, [clearFleet, resetForNewGame])

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
          Commit board, fire, defend, respond, and timeout are all signed on Starknet with Garaga payload per action.
        </CardDescription>
      </CardHeader>

      <CardContent className="relative space-y-6 p-5">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Input
              value={opponentAddress}
              onChange={(event) => setOpponentAddress(event.target.value)}
              placeholder="Opponent Starknet address (0x...) - optional for open challenge"
              className="border-[#7c3aed]/60 bg-[#130d2a]/85 text-[#e7dcff] placeholder:text-[#9274c9]"
            />
            <p className="text-[11px] text-[#bba7f2]">
              Leave blank to create open challenge. Fill address to create invited match.
            </p>
            <Button
              onClick={createGame}
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
              placeholder="Paste game_id (invited wallet or first-come open challenge)"
              className="border-[#7c3aed]/60 bg-[#130d2a]/85 text-[#e7dcff] placeholder:text-[#9274c9]"
            />
            <Button
              onClick={joinGame}
              disabled={busyAction === "join"}
              className="border border-[#7c3aed]/70 bg-[#2f1c5a] text-[#e9ddff] hover:bg-[#3c2370]"
            >
              Join Game + Commit Fleet
            </Button>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={handleResetForNewGame}
            className="border-[#7c3aed]/70 bg-[#120a2b] text-[#d6c6ff] hover:bg-[#1f1140]"
          >
            Reset Setup / New Match
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <Badge className="border border-[#8b5cf6]/70 bg-[#1c1138]/90 text-[#d5c5ff]">
            GAME_ID {activeGameId || "-"}
          </Badge>
          <Badge className="border border-[#8b5cf6]/60 bg-[#160f2f]/80 text-[#d5c5ff]">
            STATUS {isResolving ? "VERIFYING..." : state?.status || "IDLE"}
          </Badge>
          <Badge className="border border-[#8b5cf6]/60 bg-[#160f2f]/80 text-[#d5c5ff]">
            TURN {state?.current_turn ? (isYourTurn ? "YOU" : "OPPONENT") : "-"}
          </Badge>
          <Badge className="border border-[#8b5cf6]/60 bg-[#160f2f]/80 text-[#d5c5ff]">
            WINNER {isResolving ? "..." : state?.winner || "-"}
          </Badge>
          <Badge className="border border-[#8b5cf6]/60 bg-[#160f2f]/80 text-[#d5c5ff]">
            TIMEOUT {state?.timeout_in_seconds != null ? `${state.timeout_in_seconds}s` : "-"}
          </Badge>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_auto_1fr]">
          <BattleshipBoard
            title="YOUR BOARD"
            headerRight={
              <span className="text-[10px] uppercase tracking-[0.18em] text-[#bda2ff]">
                selected {setupCells.size}/{REQUIRED_SHIP_CELLS}
              </span>
            }
            subtitle={
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
            }
            boardSize={BOARD_SIZE}
            getCellProps={(x, y) => {
              const key = cellKey(x, y)
              const isPlaced = setupCells.has(key) || yourBoardSet.has(key)
              const wasShotByOpponent = opponentShotSet.has(key)
              const resolvedHit = opponentShotResolvedMap.get(key)
              const isPendingShot =
                state?.pending_shot &&
                state.pending_shot.x === x &&
                state.pending_shot.y === y &&
                !opponentShotResolvedMap.has(key)
              const isDefenseSelected = selectedDefense === key

              return {
                ariaLabel: `your-cell-${x}-${y}`,
                onClick: () => handleSelectOwnCell(x, y),
                className: cn(
                  "border-[#7e3af2]/50 bg-[#170e34] text-[#e7dcff] hover:border-[#c084fc] hover:shadow-[0_0_10px_rgba(192,132,252,0.4)]",
                  isPlaced &&
                    "border-[#d946ef]/80 bg-[#301253] text-[#f3d8ff] shadow-[0_0_16px_rgba(217,70,239,0.5)]",
                  wasShotByOpponent &&
                    resolvedHit === true &&
                    "border-red-400/90 bg-[#370e1a] text-red-200 shadow-[0_0_18px_rgba(239,68,68,0.7)] animate-pulse",
                  wasShotByOpponent &&
                    resolvedHit === false &&
                    "border-sky-400/90 bg-[#0b1f3a] text-sky-200 shadow-[0_0_16px_rgba(56,189,248,0.7)]",
                  isPendingShot &&
                    "border-amber-300/90 bg-amber-500/20 text-amber-100 shadow-[0_0_16px_rgba(251,191,36,0.55)] animate-pulse",
                  isDefenseSelected &&
                    "border-cyan-300/90 ring-2 ring-cyan-300/80 shadow-[0_0_18px_rgba(34,211,238,0.65)]"
                ),
                label: isDefenseSelected
                  ? "DEF"
                  : isPendingShot
                  ? "PEND"
                  : wasShotByOpponent
                  ? resolvedHit
                    ? "HIT"
                    : "MISS"
                  : isPlaced
                  ? "SHIP"
                  : "",
              }
            }}
          />

          <section className="flex min-w-[210px] flex-col items-center justify-center gap-4 rounded-xl border border-cyan-400/45 bg-[#0d1b2d]/55 p-4 text-center backdrop-blur-sm">
            <div className="rounded-full border border-cyan-300/70 bg-cyan-400/10 px-4 py-1 text-xs font-semibold tracking-[0.2em] text-cyan-300">
              ZK PROOF
            </div>
            <div className="text-xs font-mono text-[#a5f3fc]">
              PLAYER 1 <span className="mx-2 text-[#67e8f9]">← verify →</span> PLAYER 2
            </div>
            <div className="grid w-full gap-2 text-[11px] text-[#bdefff]">
              <div className="rounded-md border border-cyan-400/40 bg-cyan-400/10 px-3 py-2">
                Commitment locked on-chain
              </div>
              <div className="rounded-md border border-cyan-400/40 bg-cyan-400/10 px-3 py-2">
                Garaga proof per action
              </div>
              <div className="rounded-md border border-cyan-400/40 bg-cyan-400/10 px-3 py-2">
                Wallet signed transaction hash
              </div>
            </div>
            {state?.pending_shot ? (
              <div className="rounded-md border border-amber-400/60 bg-amber-500/15 px-3 py-2 text-[11px] text-amber-100">
                Pending shot: ({state.pending_shot.x}, {state.pending_shot.y}) from{" "}
                {normalizeAddress(state.pending_shot.shooter) === normalizedUser ? "You" : "Opponent"}
              </div>
            ) : (
              <div className="rounded-md border border-cyan-400/40 bg-cyan-400/10 px-3 py-2 text-[11px] text-[#bdefff]">
                No pending shot.
              </div>
            )}
          </section>

          <BattleshipBoard
            title="TARGET BOARD"
            headerRight={
              <span className="text-[10px] uppercase tracking-[0.16em] text-[#c4afff]">Fire Coordinates</span>
            }
            boardSize={BOARD_SIZE}
            gridClassName="cursor-crosshair"
            getCellProps={(x, y) => {
              const key = cellKey(x, y)
              const shotTaken = yourShotsSet.has(key)
              const resolved = yourShotResolvedMap.get(key)
              const isPending = shotTaken && !yourShotResolvedMap.has(key)
              const canPickTarget =
                state?.status === "PLAYING" &&
                isYourTurn &&
                !hasPendingShot &&
                !shotTaken &&
                busyAction == null
              const isSelected = selectedTarget === key

              return {
                ariaLabel: `target-cell-${x}-${y}`,
                onClick: () =>
                  canPickTarget && setSelectedTarget((prev) => (prev === key ? null : key)),
                className: cn(
                  "border-[#7e3af2]/50 bg-[#170e34] text-[#e7dcff] transition-all",
                  canPickTarget &&
                    "hover:border-[#22d3ee]/75 hover:shadow-[0_0_12px_rgba(34,211,238,0.6)] hover:-translate-y-0.5",
                  isSelected && "border-cyan-300/90 ring-2 ring-cyan-300/70",
                  shotTaken &&
                    resolved === true &&
                    "border-red-400/90 bg-[#3a0e18] text-red-200 shadow-[0_0_20px_rgba(239,68,68,0.75)] animate-pulse",
                  shotTaken &&
                    resolved === false &&
                    "border-sky-400/90 bg-[#09233b] text-sky-200 shadow-[0_0_18px_rgba(56,189,248,0.7)]",
                  isPending &&
                    "border-amber-300/90 bg-amber-500/20 text-amber-100 shadow-[0_0_16px_rgba(251,191,36,0.55)] animate-pulse"
                ),
                label: shotTaken
                  ? resolved === true
                    ? "HIT"
                    : resolved === false
                    ? "MISS"
                    : "PEND"
                  : isSelected
                  ? "LOCK"
                  : "",
              }
            }}
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={handleAutoFleet}
            disabled={setupLocked}
            className="border-emerald-400/70 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
          >
            Auto Fleet
          </Button>
          <Button
            variant="outline"
            onClick={handleClearFleet}
            disabled={setupLocked}
            className="border-[#a855f7]/70 bg-[#1c1037]/80 text-[#dacaff] hover:bg-[#261349]"
          >
            Clear Fleet
          </Button>
          <Button
            variant="outline"
            onClick={claimTimeout}
            disabled={!canClaimTimeout}
            className="border-[#a855f7]/70 bg-[#1c1037]/80 text-[#dacaff] hover:bg-[#261349]"
          >
            Claim Timeout
          </Button>
          <Button
            onClick={handleRespond}
            disabled={!canRespond || busyAction === "respond" || !selectedDefense}
            className="border border-amber-400/70 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30"
          >
            Defend + Respond
          </Button>
        </div>
        {canRespond && (
          <p className="mt-2 text-[11px] text-cyan-200">
            {selectedDefense
              ? `Defense lock: ${selectedDefense} (jika salah, ship bisa terbakar)`
              : "Klik 1 sel di board kamu untuk defense lock."}
          </p>
        )}

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
          {isResolving && (
            <p className="text-[11px] text-amber-200 animate-pulse">Memastikan target...</p>
          )}
        </div>

        <section className="rounded-xl border border-[#a855f7]/40 bg-[#100824]/70 p-4">
          <h4 className="mb-2 text-sm font-semibold tracking-[0.15em] text-cyan-300">How It Works</h4>
          <ol className="space-y-1 text-xs text-[#d7c6ff]">
            <li>1. Creator commits fleet on-chain in `create_game`.</li>
            <li>2. `join_game` is invited-only or first-come for open challenge.</li>
            <li>3. Shooter fires coordinate on-chain with Garaga payload in `fire_shot`.</li>
            <li>4. Defender clicks defense cell, then submits Garaga-backed `respond_shot`.</li>
            <li>5. Timeout and winner are resolved on-chain.</li>
          </ol>
        </section>

        <RadarLog
          shots={state?.shot_history ?? []}
          isPlayer={(address) => normalizeAddress(address) === normalizedUser}
        />
      </CardContent>
    </Card>
  )
}
