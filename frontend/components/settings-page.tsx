"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useTheme } from "@/components/theme-provider"
import { useWallet } from "@/hooks/use-wallet"
import { Moon, Sun, Globe, Eye, EyeOff, Bell, Shield, Wallet, Trash2 } from "lucide-react"

export function SettingsPage() {
  const { mode, toggleMode } = useTheme()
  const wallet = useWallet()
  const [theme, setTheme] = React.useState<"dark" | "light">("dark")
  const [language, setLanguage] = React.useState<"en" | "id">("en")
  const [notifications, setNotifications] = React.useState({
    trades: true,
    price: true,
    rewards: true,
    newsletter: false,
  })
  const [privacy, setPrivacy] = React.useState({
    hideBalance: false,
    privateMode: mode === "private",
    analytics: true,
  })

  const handleThemeChange = (newTheme: "dark" | "light") => {
    setTheme(newTheme)
    // Implement theme change logic
  }

  const handlePrivacyChange = (key: string, value: boolean) => {
    setPrivacy(prev => ({ ...prev, [key]: value }))
    if (key === "privateMode" && value !== (mode === "private")) {
      toggleMode()
    }
  }

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
                onClick={() => setLanguage("en")}
                className={cn(
                  "p-4 rounded-lg border-2 transition-all text-left",
                  language === "en"
                    ? "border-primary bg-primary/10"
                    : "border-border bg-surface/30 hover:border-border/80"
                )}
              >
                <p className="font-medium text-foreground">English</p>
                <p className="text-xs text-muted-foreground">Default language</p>
              </button>

              <button
                onClick={() => setLanguage("id")}
                className={cn(
                  "p-4 rounded-lg border-2 transition-all text-left",
                  language === "id"
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
                  checked={privacy.hideBalance}
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
                  checked={privacy.privateMode}
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
                  checked={privacy.analytics}
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
                  checked={notifications.trades}
                  onCheckedChange={(checked) => setNotifications(prev => ({ ...prev, trades: checked }))}
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-surface/30">
                <div>
                  <p className="font-medium text-foreground">Price Alerts</p>
                  <p className="text-sm text-muted-foreground">Alerts for significant price changes</p>
                </div>
                <Switch
                  checked={notifications.price}
                  onCheckedChange={(checked) => setNotifications(prev => ({ ...prev, price: checked }))}
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-surface/30">
                <div>
                  <p className="font-medium text-foreground">Rewards & Airdrops</p>
                  <p className="text-sm text-muted-foreground">Updates about rewards and airdrops</p>
                </div>
                <Switch
                  checked={notifications.rewards}
                  onCheckedChange={(checked) => setNotifications(prev => ({ ...prev, rewards: checked }))}
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-surface/30">
                <div>
                  <p className="font-medium text-foreground">Newsletter</p>
                  <p className="text-sm text-muted-foreground">Weekly updates and news</p>
                </div>
                <Switch
                  checked={notifications.newsletter}
                  onCheckedChange={(checked) => setNotifications(prev => ({ ...prev, newsletter: checked }))}
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
                <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10 bg-transparent">
                  Clear
                </Button>
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                <div>
                  <p className="font-medium text-foreground">Delete Account Data</p>
                  <p className="text-sm text-muted-foreground">Permanently delete all your data</p>
                </div>
                <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10 bg-transparent">
                  Delete
                </Button>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex gap-3 justify-end">
            <Button variant="outline" className="bg-transparent">
              Cancel
            </Button>
            <Button className="bg-gradient-to-r from-primary to-accent hover:opacity-90">
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
