"use client"

import * as React from "react"
import type { LucideIcon } from "lucide-react"

type FeatureHighlightProps = {
  icon: LucideIcon
  title: string
  description: string
}

/**
 * Handles `FeatureHighlight` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function FeatureHighlight({ icon: Icon, title, description }: FeatureHighlightProps) {
  return (
    <div className="p-4 lg:p-5 rounded-xl glass border border-border hover:border-primary/30 transition-colors group">
      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <h3 className="font-bold text-foreground text-sm lg:text-base mb-1">{title}</h3>
      <p className="text-xs lg:text-sm text-muted-foreground">{description}</p>
    </div>
  )
}
