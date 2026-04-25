"use client"

import * as React from "react"

// Animated counter for dynamic stats - starts at 0 on server, animates on client
export const useAnimatedValue = (end: number, duration: number = 1500) => {
  const [value, setValue] = React.useState(0)
  const [hasAnimated, setHasAnimated] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  React.useEffect(() => {
    if (!mounted) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated) {
          setHasAnimated(true)
          let startTime: number | null = null

          const animate = (timestamp: number) => {
            if (!startTime) startTime = timestamp
            const progress = Math.min((timestamp - startTime) / duration, 1)
            const easeOut = 1 - Math.pow(1 - progress, 3)
            setValue(Math.floor(easeOut * end))

            if (progress < 1) {
              requestAnimationFrame(animate)
            }
          }

          requestAnimationFrame(animate)
        }
      },
      { threshold: 0.1 }
    )

    if (ref.current) {
      observer.observe(ref.current)
    }

    return () => observer.disconnect()
  }, [end, duration, hasAnimated, mounted])

  React.useEffect(() => {
    if (!mounted || !hasAnimated) return
    setValue(Math.floor(end))
  }, [end, mounted, hasAnimated])

  return { value, ref }
}
