'use client'

import * as React from 'react'
import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'dark' | 'light'
type Mode = 'private' | 'transparent'

interface ThemeProviderContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  mode: Mode
  toggleMode: () => void
}

const ThemeProviderContext = createContext<ThemeProviderContextValue | undefined>(undefined)

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: Theme
}

/**
 * Handles `ThemeProvider` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function ThemeProvider({
  children,
  defaultTheme = 'dark',
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(defaultTheme)
  const [mode, setMode] = useState<Mode>(defaultTheme === 'dark' ? 'private' : 'transparent')

  const toggleMode = React.useCallback(() => {
    setMode((prev) => (prev === 'private' ? 'transparent' : 'private'))
  }, [])

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(theme)
  }, [theme])

  return (
    <ThemeProviderContext.Provider
      value={{
        theme,
        setTheme,
        mode,
        toggleMode,
      }}
    >
      {children}
    </ThemeProviderContext.Provider>
  )
}

/**
 * Exposes `useTheme` as a reusable hook.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function useTheme() {
  const context = useContext(ThemeProviderContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
