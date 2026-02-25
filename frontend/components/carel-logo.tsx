"use client"

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
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img
        src="/brand/carel-logo-mark.svg"
        alt=""
        width={size}
        height={size}
        className="h-full w-full object-contain"
        loading="eager"
        decoding="async"
      />
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
