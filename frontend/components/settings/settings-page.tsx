"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useTheme } from "@/components/providers/theme-provider"
import { useWallet } from "@/hooks/wallet/use-wallet"
import { useNotifications } from "@/hooks/notifications/use-notifications"
import { useAppSettings } from "@/hooks/app/use-app-settings"
import { Moon, Sun, Globe, Eye, EyeOff, Bell, Shield, Wallet, Trash2 } from "lucide-react"

/**
 * Handles `SettingsPage` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function SettingsPage() {
  const { mode, toggleMode, theme, setTheme } = useTheme()
  const wallet = useWallet()
  const appNotifications = useNotifications()
  const {
    settings,
    updateLanguage,
    updateNotificationPrefs,
    updatePrivacy,
    saveSettings,
    resetSettings,
    isDirty,
  } = useAppSettings({ initialPrivateMode: mode === "private" })
  const [sumoToken, setSumoToken] = React.useState("")
  const [sumoAddress, setSumoAddress] = React.useState("")

  /**
   * Handles `handleThemeChange` logic.
   *
   * @param newTheme - Input used by `handleThemeChange` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleThemeChange = (newTheme: "dark" | "light") => {
    setTheme(newTheme)
  }

  /**
   * Handles `handlePrivacyChange` logic.
   *
   * @param key - Input used by `handlePrivacyChange` to compute state, payload, or request behavior.
   * @param value - Input used by `handlePrivacyChange` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handlePrivacyChange = (key: string, value: boolean) => {
    updatePrivacy({ [key]: value } as { hideBalance?: boolean; privateMode?: boolean; analytics?: boolean })
    if (key === "privateMode" && value !== (mode === "private")) {
      toggleMode()
    }
  }

  /**
   * Handles `handleConnectSumo` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleConnectSumo = async () => {
    const ok = await wallet.connectWithSumo(sumoToken, sumoAddress || undefined)
    if (!ok) {
      appNotifications.addNotification({
        type: "error",
        title: "Sumo Login failed",
        message: "Invalid token or connection error.",
      })
      return
    }
    appNotifications.addNotification({
      type: "success",
      title: "Sumo Login connected",
      message: "Your Sumo Login session is now linked.",
    })
  }

  /**
   * Handles `handleClearTradingHistory` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleClearTradingHistory = () => {
    // TODO: Connect to backend endpoint for clearing history.
    appNotifications.addNotification({
      type: "info",
      title: "Not implemented",
      message: "Clear trading history is not wired to the backend yet.",
    })
  }

  /**
   * Handles `handleDeleteAccountData` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleDeleteAccountData = () => {
    // TODO: Connect to backend endpoint for deleting account data.
    appNotifications.addNotification({
      type: "info",
      title: "Not implemented",
      message: "Delete account data is not wired to the backend yet.",
    })
  }

  /**
   * Handles `handleCancelSettings` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleCancelSettings = () => {
    resetSettings()
    appNotifications.addNotification({
      type: "info",
      title: "Changes discarded",
      message: "Settings changes were reverted.",
    })
  }

  /**
   * Handles `handleSaveSettings` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleSaveSettings = () => {
    saveSettings()
    appNotifications.addNotification({
      type: "success",
      title: "Settings saved",
      message: "Your preferences have been updated.",
    })
  }

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const storedToken = window.sessionStorage.getItem("sumo_login_token") || ""
    const storedAddress = window.sessionStorage.getItem("sumo_login_address") || ""
    setSumoToken(storedToken)
    setSumoAddress(storedAddress)
  }, [])

  return (
    <section id="settings" className="py-12">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-foreground mb-2">Settings</h2>
          <p className="text-muted-foreground">Manage your account and preferences</p>
        </div>

        <div className="space-y-6">
          {/* Appearance */}
          <div className="p-6 rounded-2xl glass-strong border border-border">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                {theme === "dark" ? <Moon className="h-5 w-5 text-primary" /> : <Sun className="h-5 w-5 text-primary" />}
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">Appearance</h3>
                <p className="text-sm text-muted-foreground">Customize your interface</p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Theme */}
              <div>
                <label className="text-sm font-medium text-foreground mb-3 block">Theme</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleThemeChange("dark")}
                    className={cn(
                      "p-4 rounded-lg border-2 transition-all",
                      theme === "dark"
                        ? "border-primary bg-primary/10"
                        : "border-border bg-surface/30 hover:border-border/80"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-zinc-900 flex items-center justify-center">
                        <Moon className="h-5 w-5 text-white" />
                      </div>
                      <div className="text-left">
                <p className="font-medium text-foreground">Dark</p>
                        <p className="text-xs text-muted-foreground">Default theme</p>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => handleThemeChange("light")}
                    className={cn(
                      "p-4 rounded-lg border-2 transition-all",
                      theme === "light"
                        ? "border-primary bg-primary/10"
                        : "border-border bg-surface/30 hover:border-border/80"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center">
                        <Sun className="h-5 w-5 text-zinc-900" />
                      </div>
                      <div className="text-left">
                <p className="font-medium text-foreground">Light</p>
                        <p className="text-xs text-muted-foreground">Coming soon</p>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Language */}
          <div className="p-6 rounded-2xl glass-strong border border-border">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-secondary/20 flex items-center justify-center">
                <Globe className="h-5 w-5 text-secondary" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">Language</h3>
                <p className="text-sm text-muted-foreground">Choose your preferred language</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => updateLanguage("en")}
                className={cn(
                  "p-4 rounded-lg border-2 transition-all text-left",
                  settings.language === "en"
                    ? "border-primary bg-primary/10"
                    : "border-border bg-surface/30 hover:border-border/80"
                )}
              >
                <p className="font-medium text-foreground">English</p>
                <p className="text-xs text-muted-foreground">Default language</p>
              </button>

              <button
                onClick={() => updateLanguage("id")}
                className={cn(
                  "p-4 rounded-lg border-2 transition-all text-left",
                  settings.language === "id"
                    ? "border-primary bg-primary/10"
                    : "border-border bg-surface/30 hover:border-border/80"
                )}
              >
                <p className="font-medium text-foreground">Indonesia</p>
                <p className="text-xs text-muted-foreground">Bahasa Indonesia</p>
              </button>
            </div>
          </div>

          {/* Privacy */}
          <div className="p-6 rounded-2xl glass-strong border border-border">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
                <Shield className="h-5 w-5 text-accent" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">Privacy & Security</h3>
                <p className="text-sm text-muted-foreground">Manage your privacy settings</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-surface/30">
                <div className="flex items-center gap-3">
                  <EyeOff className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">Hide Balance</p>
                    <p className="text-sm text-muted-foreground">Hide your balance on all pages</p>
                  </div>
                </div>
                <Switch
                  checked={settings.privacy.hideBalance}
                  onCheckedChange={(checked) => handlePrivacyChange("hideBalance", checked)}
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-surface/30">
                <div className="flex items-center gap-3">
                  <Eye className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">Private Mode</p>
                    <p className="text-sm text-muted-foreground">Enhanced privacy for trading</p>
                  </div>
                </div>
                <Switch
                  checked={settings.privacy.privateMode}
                  onCheckedChange={(checked) => handlePrivacyChange("privateMode", checked)}
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-surface/30">
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">Analytics</p>
                    <p className="text-sm text-muted-foreground">Help us improve with anonymous data</p>
                  </div>
                </div>
                <Switch
                  checked={settings.privacy.analytics}
                  onCheckedChange={(checked) => handlePrivacyChange("analytics", checked)}
                />
              </div>
            </div>
          </div>

          {/* Notifications */}
          <div className="p-6 rounded-2xl glass-strong border border-border">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <Bell className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">Notifications</h3>
                <p className="text-sm text-muted-foreground">Choose what you want to be notified about</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-surface/30">
                <div>
                  <p className="font-medium text-foreground">Trade Notifications</p>
                  <p className="text-sm text-muted-foreground">Get notified about your trades</p>
                </div>
                <Switch
                  checked={settings.notificationPrefs.trades}
                  onCheckedChange={(checked) => updateNotificationPrefs({ trades: checked })}
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-surface/30">
                <div>
                  <p className="font-medium text-foreground">Price Alerts</p>
                  <p className="text-sm text-muted-foreground">Alerts for significant price changes</p>
                </div>
                <Switch
                  checked={settings.notificationPrefs.price}
                  onCheckedChange={(checked) => updateNotificationPrefs({ price: checked })}
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-surface/30">
                <div>
                  <p className="font-medium text-foreground">Rewards & Airdrops</p>
                  <p className="text-sm text-muted-foreground">Updates about rewards and airdrops</p>
                </div>
                <Switch
                  checked={settings.notificationPrefs.rewards}
                  onCheckedChange={(checked) => updateNotificationPrefs({ rewards: checked })}
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-surface/30">
                <div>
                  <p className="font-medium text-foreground">Newsletter</p>
                  <p className="text-sm text-muted-foreground">Weekly updates and news</p>
                </div>
                <Switch
                  checked={settings.notificationPrefs.newsletter}
                  onCheckedChange={(checked) => updateNotificationPrefs({ newsletter: checked })}
                />
              </div>
            </div>
          </div>

          {/* Connected Wallets */}
          <div className="p-6 rounded-2xl glass-strong border border-border">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-success" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">Connected Wallets</h3>
                <p className="text-sm text-muted-foreground">Manage your wallet connections</p>
              </div>
            </div>

            {wallet.isConnected ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 rounded-lg bg-surface/30 border border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                      <Wallet className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground font-mono">{wallet.address}</p>
                      <p className="text-sm text-muted-foreground capitalize">{wallet.provider} Wallet</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 bg-transparent"
                    onClick={wallet.disconnect}
                  >
                    Disconnect
                  </Button>
                </div>
                <div className="p-4 rounded-lg bg-surface/30 border border-border">
                  <p className="text-sm font-medium text-foreground mb-2">Sumo Login</p>
                  <div className="space-y-2">
                    <Input
                      value={sumoToken}
                      onChange={(e) => setSumoToken(e.target.value)}
                      placeholder="Sumo login token"
                    />
                    <Input
                      value={sumoAddress}
                      onChange={(e) => setSumoAddress(e.target.value)}
                      placeholder="Wallet address (optional)"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleConnectSumo}
                      disabled={!sumoToken}
                    >
                      Link Sumo Login
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 rounded-lg bg-surface/30 border border-border text-center">
                <Wallet className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground mb-4">No wallet connected</p>
                <Button className="bg-gradient-to-r from-primary to-accent hover:opacity-90">
                  Connect Wallet
                </Button>
              </div>
            )}
          </div>

          {/* Bridge Preferences */}
          <div className="p-6 rounded-2xl glass-strong border border-border">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-accent" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">Bridge Preferences</h3>
                <p className="text-sm text-muted-foreground">BTC routing and address resolution</p>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-surface/30 p-4 text-sm text-muted-foreground">
              If you use Xverse, enter the Xverse User ID in the bridge form. If you see
              “Address not found”, verify the ID or paste a BTC receive address manually.
            </div>
          </div>

          {/* Danger Zone */}
          <div className="p-6 rounded-2xl glass-strong border border-destructive/50">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-destructive/20 flex items-center justify-center">
                <Trash2 className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-destructive">Danger Zone</h3>
                <p className="text-sm text-muted-foreground">Irreversible actions</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                <div>
                  <p className="font-medium text-foreground">Clear Trading History</p>
                  <p className="text-sm text-muted-foreground">Remove all your trading history</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 bg-transparent"
                  onClick={handleClearTradingHistory}
                >
                  Clear
                </Button>
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                <div>
                  <p className="font-medium text-foreground">Delete Account Data</p>
                  <p className="text-sm text-muted-foreground">Permanently delete all your data</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 bg-transparent"
                  onClick={handleDeleteAccountData}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex gap-3 justify-end">
            <Button
              variant="outline"
              className="bg-transparent"
              onClick={handleCancelSettings}
              disabled={!isDirty}
            >
              Cancel
            </Button>
            <Button
              className="bg-gradient-to-r from-primary to-accent hover:opacity-90"
              onClick={handleSaveSettings}
              disabled={!isDirty}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
