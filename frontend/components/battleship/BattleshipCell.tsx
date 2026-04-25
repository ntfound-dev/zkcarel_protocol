"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

type BattleshipCellProps = {
  label?: string
  ariaLabel?: string
  className?: string
  disabled?: boolean
  onClick?: () => void
}

/**
 * Handles `BattleshipCell` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function BattleshipCell({ label, ariaLabel, className, disabled, onClick }: BattleshipCellProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "relative flex h-12 items-center justify-center overflow-hidden rounded-md border text-[10px] font-semibold tracking-[0.14em] transition-all",
        className
      )}
    >
      <span className="relative">{label}</span>
    </button>
  )
}
