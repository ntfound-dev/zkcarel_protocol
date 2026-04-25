"use client"

import * as React from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

export type StatCardProps = {
  icon: React.ElementType
  label: string
  value: string | number
  valueTitle?: string
  subValue?: string
  progress?: number
  trend?: {
    value: string
    isPositive: boolean
  }
  className?: string
}

/**
 * Handles `StatCard` logic.
 *
 * @param icon - Input used by `StatCard` to compute state, payload, or request behavior.
 * @param label - Input used by `StatCard` to compute state, payload, or request behavior.
 * @param value - Input used by `StatCard` to compute state, payload, or request behavior.
 * @param subValue - Input used by `StatCard` to compute state, payload, or request behavior.
 * @param progress - Input used by `StatCard` to compute state, payload, or request behavior.
 * @param trend - Input used by `StatCard` to compute state, payload, or request behavior.
 * @param className - Input used by `StatCard` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  valueTitle,
  subValue,
  progress,
  trend,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "p-4 rounded-xl glass border border-border hover:border-primary/50 transition-all duration-300 group",
        className
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-primary group-hover:animate-pulse-glow" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider carel-tech-label">
          {label}
        </span>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <p
            title={valueTitle}
            className="text-xl lg:text-2xl font-bold text-foreground leading-tight whitespace-normal [overflow-wrap:anywhere] carel-tech-title"
          >
            {value}
          </p>
          {subValue && <p className="text-xs text-muted-foreground mt-1">{subValue}</p>}
        </div>
        {trend && (
          <div
            className={cn(
              "flex items-center gap-1 text-sm font-medium",
              trend.isPositive ? "text-success" : "text-destructive"
            )}
          >
            {trend.isPositive ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {trend.value}
          </div>
        )}
      </div>
      {progress !== undefined && (
        <div className="mt-3">
          <div className="h-2 rounded-full bg-surface overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all duration-500"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
