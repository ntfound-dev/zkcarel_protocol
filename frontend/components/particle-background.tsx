"use client"

import * as React from "react"
import { useTheme } from "@/components/theme-provider"

interface Particle {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  size: number
  opacity: number
}

/**
 * Handles `ParticleBackground` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function ParticleBackground() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const { mode } = useTheme()
  const animationRef = React.useRef<number | null>(null)
  const particlesRef = React.useRef<Particle[]>([])
  const mouseRef = React.useRef({ x: 0, y: 0 })
  const nextParticleIdRef = React.useRef(0)
  const viewportRef = React.useRef({ width: 0, height: 0, dpr: 1 })

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    /**
     * Handles `getViewportMetrics` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const getViewportMetrics = () => {
      const vv = window.visualViewport
      const width = Math.max(1, Math.round(vv?.width ?? window.innerWidth))
      const height = Math.max(1, Math.round(vv?.height ?? window.innerHeight))
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
      return { width, height, dpr }
    }

    /**
     * Handles `createParticle` logic.
     *
     * @param width - Input used by `createParticle` to compute state, payload, or request behavior.
     * @param height - Input used by `createParticle` to compute state, payload, or request behavior.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const createParticle = (width: number, height: number): Particle => {
      const isMobile = width < 768
      const speedScale = isMobile ? 0.85 : 1
      const angle = Math.random() * Math.PI * 2
      const minSpeed = (mode === "private" ? 0.55 : 0.4) * speedScale
      const maxSpeed = (mode === "private" ? 1.2 : 0.85) * speedScale
      const minParticleSize = mode === "private" ? (isMobile ? 1.6 : 1.8) : (isMobile ? 1.2 : 1.4)
      const maxParticleSize = mode === "private" ? (isMobile ? 3.2 : 3.6) : (isMobile ? 2.4 : 2.8)
      const speed = minSpeed + Math.random() * (maxSpeed - minSpeed)
      return {
        id: nextParticleIdRef.current++,
        x: Math.random() * width,
        y: Math.random() * height,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: minParticleSize + Math.random() * (maxParticleSize - minParticleSize),
        opacity: Math.random() * 0.55 + 0.25,
      }
    }

    /**
     * Handles `getTargetParticleCount` logic.
     *
     * @param width - Input used by `getTargetParticleCount` to compute state, payload, or request behavior.
     * @param height - Input used by `getTargetParticleCount` to compute state, payload, or request behavior.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const getTargetParticleCount = (width: number, height: number) => {
      const area = width * height
      const isMobile = width < 768
      if (mode === "private") {
        const densityCount = Math.round(area / (isMobile ? 34000 : 24000))
        return Math.min(70, Math.max(22, densityCount))
      }
      const densityCount = Math.round(area / (isMobile ? 52000 : 42000))
      return Math.min(36, Math.max(12, densityCount))
    }

    /**
     * Handles `syncParticleCount` logic.
     *
     * @param width - Input used by `syncParticleCount` to compute state, payload, or request behavior.
     * @param height - Input used by `syncParticleCount` to compute state, payload, or request behavior.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const syncParticleCount = (width: number, height: number) => {
      const targetCount = getTargetParticleCount(width, height)
      const currentCount = particlesRef.current.length
      if (currentCount < targetCount) {
        const toAdd = targetCount - currentCount
        for (let i = 0; i < toAdd; i += 1) {
          particlesRef.current.push(createParticle(width, height))
        }
      } else if (currentCount > targetCount) {
        particlesRef.current.splice(targetCount)
      }
    }

    /**
     * Handles `resizeCanvas` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const resizeCanvas = () => {
      const nextViewport = getViewportMetrics()
      const prevViewport = viewportRef.current
      const hasPrevViewport = prevViewport.width > 0 && prevViewport.height > 0

      canvas.style.width = `${nextViewport.width}px`
      canvas.style.height = `${nextViewport.height}px`
      canvas.width = Math.max(1, Math.round(nextViewport.width * nextViewport.dpr))
      canvas.height = Math.max(1, Math.round(nextViewport.height * nextViewport.dpr))
      ctx.setTransform(nextViewport.dpr, 0, 0, nextViewport.dpr, 0, 0)

      if (hasPrevViewport) {
        const scaleX = nextViewport.width / prevViewport.width
        const scaleY = nextViewport.height / prevViewport.height
        particlesRef.current.forEach((particle) => {
          particle.x *= scaleX
          particle.y *= scaleY
        })
      }

      viewportRef.current = nextViewport
      syncParticleCount(nextViewport.width, nextViewport.height)
    }

    resizeCanvas()
    window.addEventListener("resize", resizeCanvas, { passive: true })
    window.addEventListener("orientationchange", resizeCanvas, { passive: true })
    window.visualViewport?.addEventListener("resize", resizeCanvas)
    window.visualViewport?.addEventListener("scroll", resizeCanvas)

    /**
     * Handles `handlePointerMove` logic.
     *
     * @param e - Input used by `handlePointerMove` to compute state, payload, or request behavior.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const handlePointerMove = (e: PointerEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener("pointermove", handlePointerMove, { passive: true })

    /**
     * Handles `animate` logic.
     *
     * @returns Result consumed by caller flow, UI state updates, or async chaining.
     * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
     */
    const animate = () => {
      const viewport = viewportRef.current
      const latestViewport = getViewportMetrics()
      if (
        latestViewport.width !== viewport.width ||
        latestViewport.height !== viewport.height ||
        Math.abs(latestViewport.dpr - viewport.dpr) > 0.01
      ) {
        resizeCanvas()
      }

      const { width, height } = viewportRef.current
      const isMobile = width < 768
      const connectionDistance = isMobile ? 105 : 150
      const mouseDistance = isMobile ? 150 : 200
      ctx.clearRect(0, 0, width, height)

      const primaryColor = mode === "private"
        ? { r: 157, g: 0, b: 255 }
        : { r: 56, g: 189, b: 248 }
      const secondaryColor = mode === "private"
        ? { r: 0, g: 243, b: 255 }
        : { r: 125, g: 211, b: 252 }

      // Update and draw particles
      particlesRef.current.forEach((particle) => {
        // Update position
        particle.x += particle.vx
        particle.y += particle.vy

        // Wrap around edges
        if (particle.x < 0) particle.x = width
        if (particle.x > width) particle.x = 0
        if (particle.y < 0) particle.y = height
        if (particle.y > height) particle.y = 0

        // Draw particle
        ctx.beginPath()
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, ${particle.opacity})`
        ctx.fill()
      })

      // Draw connections
      particlesRef.current.forEach((p1, i) => {
        particlesRef.current.slice(i + 1).forEach((p2) => {
          const dx = p1.x - p2.x
          const dy = p1.y - p2.y
          const distance = Math.sqrt(dx * dx + dy * dy)

          if (distance < connectionDistance) {
            const opacity = (1 - distance / connectionDistance) * 0.24
            ctx.beginPath()
            ctx.moveTo(p1.x, p1.y)
            ctx.lineTo(p2.x, p2.y)
            ctx.strokeStyle = `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${opacity})`
            ctx.lineWidth = 0.55
            ctx.stroke()
          }
        })

        // Connection to mouse
        const dxMouse = p1.x - mouseRef.current.x
        const dyMouse = p1.y - mouseRef.current.y
        const distMouse = Math.sqrt(dxMouse * dxMouse + dyMouse * dyMouse)

        if (distMouse < mouseDistance) {
          const opacity = (1 - distMouse / mouseDistance) * 0.34
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(mouseRef.current.x, mouseRef.current.y)
          ctx.strokeStyle = `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, ${opacity})`
          ctx.lineWidth = 0.55
          ctx.stroke()
        }
      })

      animationRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener("resize", resizeCanvas)
      window.removeEventListener("orientationchange", resizeCanvas)
      window.visualViewport?.removeEventListener("resize", resizeCanvas)
      window.visualViewport?.removeEventListener("scroll", resizeCanvas)
      window.removeEventListener("pointermove", handlePointerMove)
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [mode])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 h-screen w-screen pointer-events-none z-0"
      style={{ opacity: mode === "private" ? 0.66 : 0.38 }}
    />
  )
}
