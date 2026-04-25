"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type RadarShot = {
  shooter: string
  x: number
  y: number
  is_hit: boolean
  timestamp: number
}

type RadarLogProps = {
  shots: RadarShot[]
  isPlayer: (address: string) => boolean
}

/**
 * Handles `RadarLog` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function RadarLog({ shots, isPlayer }: RadarLogProps) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold tracking-[0.15em] text-cyan-300">HUD / Recent Shots</h4>
      <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-[#7c3aed]/45 bg-[#0d0720]/80 p-3 text-xs">
        {shots.length ? (
          shots
            .slice()
            .reverse()
            .slice(0, 20)
            .map((shot, index) => (
              <div
                key={`${shot.timestamp}-${index}`}
                className="flex items-center justify-between gap-2 rounded border border-[#2f1b59] bg-[#140b2a]/70 px-2 py-1"
              >
                <span className="text-[#d9ccff]">
                  {isPlayer(shot.shooter) ? "You" : "Opponent"} fired ({shot.x},{shot.y})
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
  )
}
