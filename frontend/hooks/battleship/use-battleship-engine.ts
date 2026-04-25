"use client"

import * as React from "react"
import type { BattleshipCell } from "@/lib/api"

export const BOARD_SIZE = 5
export const REQUIRED_SHIP_CELLS = 9
const EXPECTED_FLEET_GROUPS = [1, 1, 2, 2, 3]
const FLEET_SHIP_LENGTHS = [3, 2, 2, 1, 1]

export type FleetValidation = {
  valid: boolean
  reason: string
  groupSizes: number[]
}

/**
 * Handles `cellKey` logic.
 *
 * @param x - Input used by `cellKey` to compute state, payload, or request behavior.
 * @param y - Input used by `cellKey` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export const cellKey = (x: number, y: number) => `${x},${y}`

/**
 * Parses or transforms values for `parseCellKey`.
 *
 * @param key - Input used by `parseCellKey` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export const parseCellKey = (key: string): BattleshipCell | null => {
  const [xRaw, yRaw] = key.split(",")
  const x = Number(xRaw)
  const y = Number(yRaw)
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null
  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return null
  return { x, y }
}

const orthogonalNeighbors = (x: number, y: number) =>
  [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ] as const

/**
 * Handles `validateFleetCells` logic.
 *
 * @param keys - Input used by `validateFleetCells` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export const validateFleetCells = (keys: Set<string>): FleetValidation => {
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

const randomInt = (maxExclusive: number) => {
  if (maxExclusive <= 0) return 0
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    const values = new Uint32Array(1)
    window.crypto.getRandomValues(values)
    return values[0] % maxExclusive
  }
  return Math.floor(Math.random() * maxExclusive)
}

const canPlaceShip = (occupied: Set<string>, cells: BattleshipCell[]) => {
  const current = new Set(cells.map((cell) => cellKey(cell.x, cell.y)))
  for (const cell of cells) {
    const key = cellKey(cell.x, cell.y)
    if (occupied.has(key)) return false
    for (const [nx, ny] of orthogonalNeighbors(cell.x, cell.y)) {
      if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) continue
      const neighborKey = cellKey(nx, ny)
      if (occupied.has(neighborKey) && !current.has(neighborKey)) return false
    }
  }
  return true
}

const generateRandomFleet = (): Set<string> => {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const occupied = new Set<string>()
    let failed = false

    for (const length of FLEET_SHIP_LENGTHS) {
      let placed = false
      for (let placeAttempt = 0; placeAttempt < 200; placeAttempt += 1) {
        const horizontal = randomInt(2) === 0
        const maxStartX = horizontal ? BOARD_SIZE - length + 1 : BOARD_SIZE
        const maxStartY = horizontal ? BOARD_SIZE : BOARD_SIZE - length + 1
        const startX = randomInt(maxStartX)
        const startY = randomInt(maxStartY)
        const cells: BattleshipCell[] = []

        for (let i = 0; i < length; i += 1) {
          cells.push({
            x: horizontal ? startX + i : startX,
            y: horizontal ? startY : startY + i,
          })
        }

        if (!canPlaceShip(occupied, cells)) continue
        for (const cell of cells) {
          occupied.add(cellKey(cell.x, cell.y))
        }
        placed = true
        break
      }

      if (!placed) {
        failed = true
        break
      }
    }

    if (failed) continue
    const validation = validateFleetCells(occupied)
    if (validation.valid) return occupied
  }

  return new Set(
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 0, y: 3 },
      { x: 1, y: 3 },
      { x: 3, y: 2 },
      { x: 4, y: 4 },
    ].map((cell) => cellKey(cell.x, cell.y))
  )
}

export const useBattleshipEngine = () => {
  const [setupCells, setSetupCells] = React.useState<Set<string>>(new Set())

  const fleetValidation = React.useMemo(() => validateFleetCells(setupCells), [setupCells])

  const toggleSetupCell = React.useCallback((x: number, y: number) => {
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
  }, [])

  const autoFleet = React.useCallback(() => {
    setSetupCells(generateRandomFleet())
  }, [])

  const clearFleet = React.useCallback(() => {
    setSetupCells(new Set())
  }, [])

  const collectSetupCells = React.useCallback(() => {
    const cells: BattleshipCell[] = []
    for (const key of setupCells) {
      const parsed = parseCellKey(key)
      if (parsed) cells.push(parsed)
    }
    return cells
  }, [setupCells])

  const syncSetupCells = React.useCallback((cells: BattleshipCell[]) => {
    setSetupCells(new Set(cells.map((cell) => cellKey(cell.x, cell.y))))
  }, [])

  return {
    setupCells,
    setSetupCells,
    fleetValidation,
    toggleSetupCell,
    autoFleet,
    clearFleet,
    collectSetupCells,
    syncSetupCells,
  }
}
