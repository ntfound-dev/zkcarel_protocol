"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

type CarelLogoMarkProps = {
  className?: string
  size?: number
}

type CarelBrandLogoProps = {
  className?: string
  markClassName?: string
  labelClassName?: string
  iconSize?: number
  withText?: boolean
}

/**
 * Branded mark for Carel Protocol (shield + Z monogram).
 */
export function CarelLogoMark({ className, size = 34 }: CarelLogoMarkProps) {
  const uid = React.useId().replace(/:/g, "")
  const shieldStroke = `carel-shield-stroke-${uid}`
  const shieldFill = `carel-shield-fill-${uid}`
  const coreFill = `carel-core-fill-${uid}`
  const mono = `carel-mono-${uid}`

  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 36 36" className="h-full w-full" fill="none">
        <defs>
          <linearGradient id={shieldStroke} x1="6" y1="4" x2="30" y2="32" gradientUnits="userSpaceOnUse">
            <stop stopColor="#22D3EE" />
            <stop offset="0.5" stopColor="#A855F7" />
            <stop offset="1" stopColor="#F97316" />
          </linearGradient>
          <linearGradient id={shieldFill} x1="18" y1="3" x2="18" y2="33" gradientUnits="userSpaceOnUse">
            <stop stopColor="#0E132A" />
            <stop offset="1" stopColor="#060917" />
          </linearGradient>
          <radialGradient id={coreFill} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(18 18) rotate(90) scale(14 12)">
            <stop stopColor="#111A3B" />
            <stop offset="1" stopColor="#070C1F" />
          </radialGradient>
          <linearGradient id={mono} x1="12" y1="12" x2="24" y2="24" gradientUnits="userSpaceOnUse">
            <stop stopColor="#E0E7FF" />
            <stop offset="0.5" stopColor="#A5B4FC" />
            <stop offset="1" stopColor="#22D3EE" />
          </linearGradient>
        </defs>

        <path
          d="M18 2.75 29.5 6.8v10.18c0 7.53-4.84 13.58-11.5 16.01C11.34 30.56 6.5 24.51 6.5 16.98V6.8L18 2.75Z"
          fill={`url(#${shieldFill})`}
          stroke={`url(#${shieldStroke})`}
          strokeWidth="1.35"
        />

        <path
          d="M18 6 26.5 9.05v7.79c0 5.87-3.64 10.47-8.5 12.29-4.86-1.82-8.5-6.42-8.5-12.29V9.05L18 6Z"
          fill={`url(#${coreFill})`}
          stroke="#7C3AED"
          strokeOpacity="0.6"
          strokeWidth="0.75"
        />

        <g>
          <path d="M11.9 12.4h12.2" stroke={`url(#${mono})`} strokeWidth="2.2" strokeLinecap="round" />
          <path d="M24.1 12.4 11.9 23.6" stroke={`url(#${mono})`} strokeWidth="2.2" strokeLinecap="round" />
          <path d="M11.9 23.6h12.2" stroke={`url(#${mono})`} strokeWidth="2.2" strokeLinecap="round" />
        </g>
      </svg>
    </span>
  )
}

/**
 * Shared brand lockup used in header and footer.
 */
export function CarelBrandLogo({
  className,
  markClassName,
  labelClassName,
  iconSize = 34,
  withText = true,
}: CarelBrandLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <CarelLogoMark size={iconSize} className={markClassName} />
      {withText ? (
        <span className={cn("font-semibold text-foreground", labelClassName)}>Carel Protocol</span>
      ) : null}
    </span>
  )
}
