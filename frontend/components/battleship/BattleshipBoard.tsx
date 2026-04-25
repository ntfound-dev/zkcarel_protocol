"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { BattleshipCell } from "@/components/battleship/BattleshipCell"

type BattleshipBoardProps = {
  title: string
  subtitle?: React.ReactNode
  headerRight?: React.ReactNode
  boardSize: number
  className?: string
  gridClassName?: string
  getCellProps: (x: number, y: number) => {
    label?: string
    ariaLabel?: string
    className?: string
    disabled?: boolean
    onClick?: () => void
  }
}

/**
 * Handles `BattleshipBoard` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function BattleshipBoard({
  title,
  subtitle,
  headerRight,
  boardSize,
  className,
  gridClassName,
  getCellProps,
}: BattleshipBoardProps) {
  return (
    <section className={cn("rounded-xl border border-[#a855f7]/50 bg-[#120a2b]/70 p-4 backdrop-blur-sm", className)}>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold tracking-[0.18em] text-cyan-300">{title}</h4>
        {headerRight}
      </div>
      {subtitle}
      <div className={cn("grid grid-cols-5 gap-2", gridClassName)}>
        {Array.from({ length: boardSize * boardSize }, (_, index) => {
          const x = index % boardSize
          const y = Math.floor(index / boardSize)
          const cellProps = getCellProps(x, y)
          return <BattleshipCell key={`${x}-${y}`} {...cellProps} />
        })}
      </div>
    </section>
  )
}
