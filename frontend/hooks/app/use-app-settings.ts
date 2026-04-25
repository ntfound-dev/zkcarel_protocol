"use client"

import * as React from "react"

type Language = "en" | "id"

type NotificationPrefs = {
  trades: boolean
  price: boolean
  rewards: boolean
  newsletter: boolean
}

type PrivacyPrefs = {
  hideBalance: boolean
  privateMode: boolean
  analytics: boolean
}

type AppSettings = {
  language: Language
  notificationPrefs: NotificationPrefs
  privacy: PrivacyPrefs
}

type UseAppSettingsParams = {
  initialPrivateMode?: boolean
}

const STORAGE_KEY = "carel_app_settings_v1"

const defaultSettings: AppSettings = {
  language: "en",
  notificationPrefs: {
    trades: true,
    price: true,
    rewards: true,
    newsletter: false,
  },
  privacy: {
    hideBalance: false,
    privateMode: false,
    analytics: true,
  },
}

const normalizeSettings = (input: unknown, initialPrivateMode?: boolean): AppSettings => {
  const source = typeof input === "object" && input ? (input as Record<string, unknown>) : {}
  const language = source.language === "id" ? "id" : "en"
  const notificationPrefsInput =
    typeof source.notificationPrefs === "object" && source.notificationPrefs
      ? (source.notificationPrefs as Record<string, unknown>)
      : {}
  const privacyInput =
    typeof source.privacy === "object" && source.privacy ? (source.privacy as Record<string, unknown>) : {}

  const notificationPrefs: NotificationPrefs = {
    trades: typeof notificationPrefsInput.trades === "boolean" ? notificationPrefsInput.trades : defaultSettings.notificationPrefs.trades,
    price: typeof notificationPrefsInput.price === "boolean" ? notificationPrefsInput.price : defaultSettings.notificationPrefs.price,
    rewards: typeof notificationPrefsInput.rewards === "boolean" ? notificationPrefsInput.rewards : defaultSettings.notificationPrefs.rewards,
    newsletter:
      typeof notificationPrefsInput.newsletter === "boolean"
        ? notificationPrefsInput.newsletter
        : defaultSettings.notificationPrefs.newsletter,
  }

  const privacy: PrivacyPrefs = {
    hideBalance:
      typeof privacyInput.hideBalance === "boolean" ? privacyInput.hideBalance : defaultSettings.privacy.hideBalance,
    privateMode:
      typeof privacyInput.privateMode === "boolean" ? privacyInput.privateMode : defaultSettings.privacy.privateMode,
    analytics: typeof privacyInput.analytics === "boolean" ? privacyInput.analytics : defaultSettings.privacy.analytics,
  }

  if (typeof initialPrivateMode === "boolean") {
    privacy.privateMode = initialPrivateMode
  }

  return {
    language,
    notificationPrefs,
    privacy,
  }
}

const loadSettings = (initialPrivateMode?: boolean) => {
  if (typeof window === "undefined") return normalizeSettings(null, initialPrivateMode)
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return normalizeSettings(null, initialPrivateMode)
    return normalizeSettings(JSON.parse(raw), initialPrivateMode)
  } catch {
    return normalizeSettings(null, initialPrivateMode)
  }
}

const persistSettings = (settings: AppSettings) => {
  if (typeof window === "undefined") return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function useAppSettings({ initialPrivateMode }: UseAppSettingsParams = {}) {
  const [savedSettings, setSavedSettings] = React.useState<AppSettings>(() =>
    loadSettings(initialPrivateMode)
  )
  const [settings, setSettings] = React.useState<AppSettings>(() =>
    loadSettings(initialPrivateMode)
  )
  const [isLoaded, setIsLoaded] = React.useState(false)

  React.useEffect(() => {
    const loaded = loadSettings(initialPrivateMode)
    setSavedSettings(loaded)
    setSettings(loaded)
    setIsLoaded(true)
  }, [])

  React.useEffect(() => {
    if (!isLoaded) return
    if (typeof initialPrivateMode !== "boolean") return
    setSettings((prev) => {
      if (prev.privacy.privateMode === initialPrivateMode) return prev
      return {
        ...prev,
        privacy: { ...prev.privacy, privateMode: initialPrivateMode },
      }
    })
    setSavedSettings((prev) => {
      if (prev.privacy.privateMode === initialPrivateMode) return prev
      const next = { ...prev, privacy: { ...prev.privacy, privateMode: initialPrivateMode } }
      persistSettings(next)
      return next
    })
  }, [initialPrivateMode, isLoaded])

  const updateLanguage = React.useCallback((language: Language) => {
    setSettings((prev) => ({ ...prev, language }))
  }, [])

  const updateNotificationPrefs = React.useCallback((next: Partial<NotificationPrefs>) => {
    setSettings((prev) => ({
      ...prev,
      notificationPrefs: { ...prev.notificationPrefs, ...next },
    }))
  }, [])

  const updatePrivacy = React.useCallback((next: Partial<PrivacyPrefs>) => {
    setSettings((prev) => ({
      ...prev,
      privacy: { ...prev.privacy, ...next },
    }))
  }, [])

  const saveSettings = React.useCallback(() => {
    persistSettings(settings)
    setSavedSettings(settings)
  }, [settings])

  const resetSettings = React.useCallback(() => {
    setSettings(savedSettings)
  }, [savedSettings])

  const isDirty = React.useMemo(() => {
    return JSON.stringify(settings) !== JSON.stringify(savedSettings)
  }, [savedSettings, settings])

  return {
    settings,
    updateLanguage,
    updateNotificationPrefs,
    updatePrivacy,
    saveSettings,
    resetSettings,
    isDirty,
    isLoaded,
  }
}
