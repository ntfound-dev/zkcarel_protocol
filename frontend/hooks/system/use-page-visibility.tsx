"use client"

import * as React from "react"

const getInitialVisibility = () => {
  if (typeof document === "undefined") return true
  return document.visibilityState === "visible"
}

export const usePageVisibility = () => {
  const [isVisible, setIsVisible] = React.useState(getInitialVisibility)

  React.useEffect(() => {
    if (typeof document === "undefined") return
    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === "visible")
    }
    handleVisibilityChange()
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange)
  }, [])

  return isVisible
}
