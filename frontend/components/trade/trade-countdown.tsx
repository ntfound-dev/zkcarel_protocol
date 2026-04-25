"use client"

import * as React from "react"
import { formatRemainingDuration } from "@/lib/trading-utils"

type CountdownProps = {
  targetMs: number
  className?: string
}

export function Countdown({ targetMs, className }: CountdownProps) {
  const [remainingMs, setRemainingMs] = React.useState(() => Math.max(0, targetMs - Date.now()))

  React.useEffect(() => {
    if (!Number.isFinite(targetMs) || targetMs <= 0) {
      setRemainingMs(0)
      return
    }
    let mounted = true
    let timer = 0
    const tick = () => {
      if (!mounted) return
      const next = Math.max(0, targetMs - Date.now())
      setRemainingMs(next)
      if (next <= 0 && timer) {
        window.clearInterval(timer)
      }
    }
    tick()
    timer = window.setInterval(tick, 1000)
    return () => {
      mounted = false
      window.clearInterval(timer)
    }
  }, [targetMs])

  return <span className={className}>{formatRemainingDuration(remainingMs)}</span>
}
