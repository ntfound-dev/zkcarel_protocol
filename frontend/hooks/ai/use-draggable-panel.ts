import * as React from "react"

type BubblePosition = { x: number; y: number }

const AI_BUBBLE_STORAGE_KEY = "carel_ai_bubble_position_v1"
const AI_BUBBLE_SIZE_PX = 56
const AI_BUBBLE_EDGE_PADDING_PX = 16
const AI_PANEL_STORAGE_KEY = "carel_ai_panel_position_v1"
const AI_PANEL_EDGE_PADDING_PX = 16
const AI_PANEL_WIDTH_PX = 460
const AI_PANEL_MINIMIZED_HEIGHT_PX = 64
const AI_PANEL_EXPANDED_HEIGHT_PX = 700

const clampBubblePosition = (position: BubblePosition): BubblePosition => {
  if (typeof window === "undefined") return position
  const maxX = Math.max(
    AI_BUBBLE_EDGE_PADDING_PX,
    window.innerWidth - AI_BUBBLE_SIZE_PX - AI_BUBBLE_EDGE_PADDING_PX
  )
  const maxY = Math.max(
    AI_BUBBLE_EDGE_PADDING_PX,
    window.innerHeight - AI_BUBBLE_SIZE_PX - AI_BUBBLE_EDGE_PADDING_PX
  )
  return {
    x: Math.min(maxX, Math.max(AI_BUBBLE_EDGE_PADDING_PX, position.x)),
    y: Math.min(maxY, Math.max(AI_BUBBLE_EDGE_PADDING_PX, position.y)),
  }
}

const getPanelDimensions = (isMinimized: boolean): { width: number; height: number } => {
  const defaultHeight = isMinimized ? AI_PANEL_MINIMIZED_HEIGHT_PX : AI_PANEL_EXPANDED_HEIGHT_PX
  if (typeof window === "undefined") {
    return { width: AI_PANEL_WIDTH_PX, height: defaultHeight }
  }
  const width = Math.min(AI_PANEL_WIDTH_PX, Math.max(320, window.innerWidth - AI_PANEL_EDGE_PADDING_PX))
  const height = Math.min(
    defaultHeight,
    Math.max(isMinimized ? AI_PANEL_MINIMIZED_HEIGHT_PX : 320, window.innerHeight - AI_PANEL_EDGE_PADDING_PX)
  )
  return { width, height }
}

const clampPanelPosition = (position: BubblePosition, isMinimized: boolean): BubblePosition => {
  if (typeof window === "undefined") return position
  const { width, height } = getPanelDimensions(isMinimized)
  const maxX = Math.max(
    AI_PANEL_EDGE_PADDING_PX,
    window.innerWidth - width - AI_PANEL_EDGE_PADDING_PX
  )
  const maxY = Math.max(
    AI_PANEL_EDGE_PADDING_PX,
    window.innerHeight - height - AI_PANEL_EDGE_PADDING_PX
  )
  return {
    x: Math.min(maxX, Math.max(AI_PANEL_EDGE_PADDING_PX, position.x)),
    y: Math.min(maxY, Math.max(AI_PANEL_EDGE_PADDING_PX, position.y)),
  }
}

type UseDraggablePanelParams = {
  isMinimized: boolean
  setIsMinimized: React.Dispatch<React.SetStateAction<boolean>>
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>
}

type UseDraggablePanelResult = {
  bubbleStyle: React.CSSProperties
  panelStyle: React.CSSProperties
  isBubbleDragging: boolean
  isPanelDragging: boolean
  openAssistantNearBubble: () => void
  bubbleHandlers: {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void
    onPointerUp: () => void
    onPointerCancel: () => void
    onClick: () => void
  }
  panelHandlers: {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
    onPointerUp: () => void
    onPointerCancel: () => void
  }
}

export const useDraggablePanel = ({
  isMinimized,
  setIsMinimized,
  setIsOpen,
}: UseDraggablePanelParams): UseDraggablePanelResult => {
  const [bubblePosition, setBubblePosition] = React.useState<BubblePosition | null>(null)
  const [panelPosition, setPanelPosition] = React.useState<BubblePosition | null>(null)
  const [isBubbleDragging, setIsBubbleDragging] = React.useState(false)
  const [isPanelDragging, setIsPanelDragging] = React.useState(false)
  const bubbleDragRef = React.useRef({
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    moved: false,
  })
  const panelDragRef = React.useRef({
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  })
  const suppressBubbleClickRef = React.useRef(false)

  const getDefaultBubblePosition = React.useCallback((): BubblePosition => {
    if (typeof window === "undefined") {
      return { x: AI_BUBBLE_EDGE_PADDING_PX, y: AI_BUBBLE_EDGE_PADDING_PX }
    }
    return clampBubblePosition({
      x: window.innerWidth - AI_BUBBLE_SIZE_PX - 20,
      y: window.innerHeight - AI_BUBBLE_SIZE_PX - 20,
    })
  }, [])

  const getDefaultPanelPosition = React.useCallback((minimized: boolean): BubblePosition => {
    if (typeof window === "undefined") {
      return { x: AI_PANEL_EDGE_PADDING_PX, y: AI_PANEL_EDGE_PADDING_PX }
    }
    const { width, height } = getPanelDimensions(minimized)
    return clampPanelPosition(
      {
        x: window.innerWidth - width - AI_PANEL_EDGE_PADDING_PX,
        y: window.innerHeight - height - AI_PANEL_EDGE_PADDING_PX,
      },
      minimized
    )
  }, [])

  const getPanelPositionFromBubble = React.useCallback(
    (minimized: boolean): BubblePosition => {
      const anchor = bubblePosition || getDefaultBubblePosition()
      const { width, height } = getPanelDimensions(minimized)
      const preferred = {
        x: anchor.x + AI_BUBBLE_SIZE_PX - width,
        y: anchor.y + AI_BUBBLE_SIZE_PX - height,
      }
      return clampPanelPosition(preferred, minimized)
    },
    [bubblePosition, getDefaultBubblePosition]
  )

  const openAssistantNearBubble = React.useCallback(() => {
    const minimized = false
    setPanelPosition(getPanelPositionFromBubble(minimized))
    setIsMinimized(minimized)
    setIsOpen(true)
  }, [getPanelPositionFromBubble, setIsMinimized, setIsOpen])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    let initialPosition = getDefaultBubblePosition()
    let initialPanelPosition = getDefaultPanelPosition(false)
    try {
      const raw = window.localStorage.getItem(AI_BUBBLE_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<BubblePosition>
        if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
          initialPosition = clampBubblePosition({
            x: Number(parsed.x),
            y: Number(parsed.y),
          })
        }
      }
      const rawPanel = window.localStorage.getItem(AI_PANEL_STORAGE_KEY)
      if (rawPanel) {
        const parsedPanel = JSON.parse(rawPanel) as Partial<BubblePosition>
        if (Number.isFinite(parsedPanel?.x) && Number.isFinite(parsedPanel?.y)) {
          initialPanelPosition = clampPanelPosition(
            { x: Number(parsedPanel.x), y: Number(parsedPanel.y) },
            false
          )
        }
      }
    } catch {
      // ignore malformed local storage values
    }
    setBubblePosition(initialPosition)
    setPanelPosition(initialPanelPosition)

    const handleResize = () => {
      setBubblePosition((prev) => clampBubblePosition(prev || getDefaultBubblePosition()))
      setPanelPosition((prev) =>
        clampPanelPosition(prev || getDefaultPanelPosition(isMinimized), isMinimized)
      )
    }
    window.addEventListener("resize", handleResize)
    return () => {
      window.removeEventListener("resize", handleResize)
    }
  }, [getDefaultBubblePosition, getDefaultPanelPosition, isMinimized])

  React.useEffect(() => {
    if (!bubblePosition || typeof window === "undefined") return
    try {
      window.localStorage.setItem(AI_BUBBLE_STORAGE_KEY, JSON.stringify(bubblePosition))
    } catch {
      // ignore storage write issues
    }
  }, [bubblePosition])

  React.useEffect(() => {
    if (!panelPosition || typeof window === "undefined") return
    try {
      window.localStorage.setItem(AI_PANEL_STORAGE_KEY, JSON.stringify(panelPosition))
    } catch {
      // ignore storage write issues
    }
  }, [panelPosition])

  React.useEffect(() => {
    setPanelPosition((prev) =>
      clampPanelPosition(prev || getDefaultPanelPosition(isMinimized), isMinimized)
    )
  }, [getDefaultPanelPosition, isMinimized])

  const handleBubblePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return
      const origin = bubblePosition || getDefaultBubblePosition()
      bubbleDragRef.current = {
        active: true,
        startX: event.clientX,
        startY: event.clientY,
        originX: origin.x,
        originY: origin.y,
        moved: false,
      }
      setIsBubbleDragging(true)
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [bubblePosition, getDefaultBubblePosition]
  )

  const handleBubblePointerMove = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = bubbleDragRef.current
    if (!drag.active) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      drag.moved = true
    }
    setBubblePosition(
      clampBubblePosition({
        x: drag.originX + dx,
        y: drag.originY + dy,
      })
    )
  }, [])

  const endBubbleDrag = React.useCallback(() => {
    const drag = bubbleDragRef.current
    if (!drag.active) return
    bubbleDragRef.current.active = false
    if (drag.moved) {
      suppressBubbleClickRef.current = true
      window.setTimeout(() => {
        suppressBubbleClickRef.current = false
      }, 120)
    }
    setIsBubbleDragging(false)
  }, [])

  const handlePanelPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return
      const targetElement = event.target as HTMLElement
      if (
        targetElement.closest("button") ||
        targetElement.closest("input") ||
        targetElement.closest("textarea") ||
        targetElement.closest("a") ||
        targetElement.closest("[data-no-drag='true']")
      ) {
        return
      }
      const origin = panelPosition || getDefaultPanelPosition(isMinimized)
      panelDragRef.current = {
        active: true,
        startX: event.clientX,
        startY: event.clientY,
        originX: origin.x,
        originY: origin.y,
      }
      setIsPanelDragging(true)
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [panelPosition, getDefaultPanelPosition, isMinimized]
  )

  const handlePanelPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = panelDragRef.current
      if (!drag.active) return
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      setPanelPosition(
        clampPanelPosition(
          {
            x: drag.originX + dx,
            y: drag.originY + dy,
          },
          isMinimized
        )
      )
    },
    [isMinimized]
  )

  const endPanelDrag = React.useCallback(() => {
    if (!panelDragRef.current.active) return
    panelDragRef.current.active = false
    setIsPanelDragging(false)
  }, [])

  const bubbleStyle: React.CSSProperties = bubblePosition
    ? {
        left: bubblePosition.x,
        top: bubblePosition.y,
        touchAction: "none",
      }
    : {
        right: 20,
        bottom: 20,
        touchAction: "none",
      }

  const panelStyle: React.CSSProperties = panelPosition
    ? {
        left: panelPosition.x,
        top: panelPosition.y,
      }
    : {
        right: 16,
        bottom: 16,
      }

  return {
    bubbleStyle,
    panelStyle,
    isBubbleDragging,
    isPanelDragging,
    openAssistantNearBubble,
    bubbleHandlers: {
      onPointerDown: handleBubblePointerDown,
      onPointerMove: handleBubblePointerMove,
      onPointerUp: endBubbleDrag,
      onPointerCancel: endBubbleDrag,
      onClick: () => {
        if (suppressBubbleClickRef.current) return
        openAssistantNearBubble()
      },
    },
    panelHandlers: {
      onPointerDown: handlePanelPointerDown,
      onPointerMove: handlePanelPointerMove,
      onPointerUp: endPanelDrag,
      onPointerCancel: endPanelDrag,
    },
  }
}
