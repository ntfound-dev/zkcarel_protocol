"use client"

import * as React from "react"

type DragHandlers = {
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
  onMouseMove: (event: React.MouseEvent<HTMLDivElement>) => void
  onMouseUp: () => void
  onMouseLeave: () => void
  onTouchStart: (event: React.TouchEvent<HTMLDivElement>) => void
  onTouchMove: (event: React.TouchEvent<HTMLDivElement>) => void
  onTouchEnd: () => void
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void
}

export const useDraggableScroll = () => {
  const stripRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef({
    active: false,
    moved: false,
    startX: 0,
    startScrollLeft: 0,
  })
  const [isDragging, setIsDragging] = React.useState(false)

  const beginDrag = React.useCallback((clientX: number) => {
    const strip = stripRef.current
    if (!strip) return
    dragRef.current.active = true
    dragRef.current.moved = false
    dragRef.current.startX = clientX
    dragRef.current.startScrollLeft = strip.scrollLeft
    setIsDragging(true)
  }, [])

  const moveDrag = React.useCallback((clientX: number) => {
    const strip = stripRef.current
    if (!strip || !dragRef.current.active) return
    const deltaX = clientX - dragRef.current.startX
    if (Math.abs(deltaX) > 3) {
      dragRef.current.moved = true
    }
    strip.scrollLeft = dragRef.current.startScrollLeft - deltaX
  }, [])

  const endDrag = React.useCallback(() => {
    dragRef.current.active = false
    setIsDragging(false)
    window.setTimeout(() => {
      dragRef.current.moved = false
    }, 0)
  }, [])

  const bind: DragHandlers = {
    onMouseDown: (event) => beginDrag(event.clientX),
    onMouseMove: (event) => moveDrag(event.clientX),
    onMouseUp: endDrag,
    onMouseLeave: endDrag,
    onTouchStart: (event) => beginDrag(event.touches[0]?.clientX ?? 0),
    onTouchMove: (event) => moveDrag(event.touches[0]?.clientX ?? 0),
    onTouchEnd: endDrag,
    onDragStart: (event) => event.preventDefault(),
  }

  return { stripRef, isDragging, bind }
}
