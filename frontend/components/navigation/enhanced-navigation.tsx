"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { useNavigationLogic } from "@/hooks/navigation/use-navigation-logic"
import {
  btcWalletProviders,
  externalFaucetLinks,
  formatAsset,
  formatCurrency,
  internalFaucetTokens,
  renderLinkStatus,
  shortenAddress,
  starknetWalletProviders,
  txExplorerLinks,
  txFilters,
  walletProviders,
} from "@/lib/navigation-utils"
import { formatNetworkLabel, STARKSCAN_SEPOLIA_BASE_URL } from "@/lib/network-config"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CarelBrandLogo } from "@/components/brand/carel-logo"
import { ReferralLog } from "@/components/referral/referral-log"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { WalletConnectDialog } from "@/components/navigation/wallet-connect-dialog"
import { TxHistoryDialog } from "@/components/navigation/tx-history-dialog"
import { TopUpDialog } from "@/components/navigation/top-up-dialog"
import { HelpDialog } from "@/components/navigation/help-dialog"
import { SettingsDialog } from "@/components/navigation/settings-dialog"
import {
  Wallet,
  Bell,
  User,
  Menu,
  X,
  ArrowRightLeft,
  PieChart,
  Trophy,
  Gift,
  History,
  Users,
  Settings,
  Droplets,
  ChevronDown,
  HelpCircle,
  Zap,
  Copy,
  Check,
  TrendingUp,
  Coins,
  QrCode,
  Smartphone,
  ChevronRight,
} from "lucide-react"

/**
 * Handles `EnhancedNavigation` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function EnhancedNavigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)
  const [walletDialogOpen, setWalletDialogOpen] = React.useState(false)
  const [notificationsOpen, setNotificationsOpen] = React.useState(false)
  const [txHistoryOpen, setTxHistoryOpen] = React.useState(false)
  const [helpOpen, setHelpOpen] = React.useState(false)
  const [topUpOpen, setTopUpOpen] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [referralLogOpen, setReferralLogOpen] = React.useState(false)

  const {
    wallet,
    notifications,
    faucetStatus,
    faucetLoading,
    faucetTx,
    copiedAddress,
    copiedReceiveNetwork,
    activeReceiveNetwork,
    setActiveReceiveNetwork,
    txFilter,
    setTxFilter,
    txHistory,
    txHistoryLoading,
    walletConnectPending,
    btcConnectPending,
    displayName,
    manualBtcAddress,
    setManualBtcAddress,
    btcManualLinkPending,
    effectiveStarknetAddress,
    receiveTargets,
    selectedReceiveTarget,
    selectedReceiveFaucetUrl,
    connectedTestnetSummary,
    primaryConnectedTestnet,
    networkStatusHeadline,
    effectivePortfolioBalance,
    handleWalletConnect,
    handleBtcConnect,
    handleSetDisplayName,
    handleManualBtcLink,
    handleClaimFaucet,
    openExternalFaucet,
    copyAddress,
    copyReceiveAddress,
    openDeFiFeature,
  } = useNavigationLogic({
    txHistoryOpen,
    topUpOpen,
    onWalletDialogClose: () => setWalletDialogOpen(false),
  })

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b border-border/40 glass-strong">
        <div className="container flex h-16 items-center justify-between px-4 mx-auto">
          <Link href="/" className="flex items-center gap-2 group">
            <CarelBrandLogo
              iconSize={34}
              markClassName="transition-transform duration-300 group-hover:scale-[1.04]"
              labelClassName="text-xl font-bold tracking-wider text-foreground transition-colors group-hover:text-primary carel-tech-title"
            />
          </Link>

          <div className="hidden lg:flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 text-success hover:bg-success/10">
                  <Droplets className="h-4 w-4" />
                  Faucet
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60 glass-strong border-border">
                <DropdownMenuLabel>
                  <div>
                    <p className="text-sm font-medium text-foreground">Testnet Faucet</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-2 pb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Internal (25/day)
                  </p>
                </div>
                {internalFaucetTokens.map((token) => {
                  const walletReady = wallet.isConnected && Boolean(effectiveStarknetAddress)
                  const status = walletReady ? faucetStatus[token.symbol] : undefined
                  const statusKnown = typeof status?.can_claim === "boolean"
                  const canClaim = walletReady && (statusKnown ? Boolean(status?.can_claim) : true)
                  const isLoading = faucetLoading[token.symbol]
                  const nextClaimAtMs = status?.next_claim_at
                    ? new Date(status.next_claim_at).getTime()
                    : NaN
                  const isCooldown = Number.isFinite(nextClaimAtMs) && nextClaimAtMs > Date.now()
                  const isDisabled = !walletReady || isLoading || (statusKnown && !canClaim)
                  const label = isLoading
                    ? "Claiming..."
                    : !wallet.isConnected
                    ? "Connect"
                    : !effectiveStarknetAddress
                    ? "Link Starknet"
                    : !statusKnown
                    ? `+${token.amount}`
                    : canClaim
                    ? `+${token.amount}`
                    : isCooldown
                    ? "Cooldown"
                    : "Unavailable"

                  return (
                    <DropdownMenuItem
                      key={token.symbol}
                      className={cn(
                        "flex items-center justify-between cursor-pointer py-3",
                        isDisabled && "opacity-50"
                      )}
                      onClick={() => handleClaimFaucet(token.symbol)}
                      disabled={isDisabled}
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">{token.symbol}</p>
                        <p className="text-xs text-muted-foreground">{token.name}</p>
                        {faucetTx[token.symbol] && (
                          <a
                            href={`${STARKSCAN_SEPOLIA_BASE_URL}/tx/${faucetTx[token.symbol]}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-primary hover:underline"
                          >
                            View Tx
                          </a>
                        )}
                      </div>
                      <span
                        className={cn(
                          "text-xs font-medium px-2 py-1 rounded",
                          canClaim ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"
                        )}
                      >
                        {label}
                      </span>
                    </DropdownMenuItem>
                  )
                })}
                <DropdownMenuSeparator />
                <div className="px-2 pb-1 pt-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    External
                  </p>
                </div>
                {externalFaucetLinks.map((token) => (
                  <DropdownMenuItem
                    key={token.symbol}
                    className="flex items-center justify-between cursor-pointer py-3"
                    onClick={() => openExternalFaucet(token.url)}
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">{token.symbol}</p>
                      <p className="text-xs text-muted-foreground">{token.name}</p>
                    </div>
                    <span className="text-xs font-medium px-2 py-1 rounded bg-primary/15 text-primary">
                      {token.action}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                  Testnet
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 glass-strong border-border">
                <DropdownMenuItem className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-success" />
                    <span>{formatNetworkLabel("starknet")}</span>
                  </div>
                  <Check className="h-4 w-4 text-success" />
                </DropdownMenuItem>
                <DropdownMenuItem className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-success" />
                    <span>{formatNetworkLabel("evm")}</span>
                  </div>
                  <Check className="h-4 w-4 text-success" />
                </DropdownMenuItem>
                <DropdownMenuItem className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-success" />
                    <span>{formatNetworkLabel("btc")}</span>
                  </div>
                  <Check className="h-4 w-4 text-success" />
                </DropdownMenuItem>
                <DropdownMenuItem disabled className="flex items-center justify-between opacity-50">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                    <span>Mainnet</span>
                  </div>
                  <span className="text-xs text-muted-foreground">Soon</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {wallet?.isConnected ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="gap-2 border-primary/50 hover:bg-primary/10 bg-transparent"
                    title={connectedTestnetSummary}
                  >
                    <Wallet className="h-4 w-4 text-primary" />
                    <span className="font-mono text-xs">{shortenAddress(wallet.address)}</span>
                    <span className="hidden xl:inline text-[10px] font-medium text-success">
                      {primaryConnectedTestnet}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-80 max-h-[75vh] overflow-y-auto glass-strong border-border"
                >
                  <div className="p-3 space-y-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Wallet Address</p>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="font-mono text-sm text-foreground">{wallet.address}</p>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={copyAddress}
                        >
                          {copiedAddress ? (
                            <Check className="h-3 w-3 text-success" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-lg border border-success/30 bg-success/10 p-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-success">
                        Network Status
                      </p>
                      <p className="mt-1 text-xs font-medium text-success">{networkStatusHeadline}</p>
                      <p className="mt-1 text-xs text-foreground">{connectedTestnetSummary}</p>
                    </div>
                    <DropdownMenuSeparator />
                    <div>
                      <p className="text-xs text-muted-foreground">Linked Networks</p>
                      <div className="space-y-1 mt-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Starknet Sepolia</span>
                          <span className="font-mono text-foreground">
                            {renderLinkStatus(effectiveStarknetAddress)}
                          </span>
                        </div>
                        {!effectiveStarknetAddress && (
                          <div className="flex flex-wrap gap-1">
                            {starknetWalletProviders.map((starknetProvider) => (
                              <Button
                                key={`linked-${starknetProvider.id}`}
                                size="sm"
                                variant="secondary"
                                className="h-6 px-2 text-[10px]"
                                disabled={walletConnectPending}
                                onClick={() => handleWalletConnect(starknetProvider.id)}
                              >
                                {starknetProvider.icon} Connect {starknetProvider.name}
                              </Button>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">ETH Sepolia</span>
                          <span className="font-mono text-foreground">
                            {renderLinkStatus(wallet.evmAddress)}
                          </span>
                        </div>
                        {!wallet.evmAddress && (
                          <div>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-6 px-2 text-[10px]"
                              disabled={walletConnectPending}
                              onClick={() => handleWalletConnect("metamask")}
                            >
                              🦊 Connect MetaMask
                            </Button>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Bitcoin Testnet</span>
                          <span className="font-mono text-foreground">
                            {renderLinkStatus(wallet.btcAddress)}
                          </span>
                        </div>
                        {!wallet.btcAddress && (
                          <div className="flex flex-wrap gap-1">
                            {btcWalletProviders.map((btc) => (
                              <Button
                                key={`linked-${btc.id}`}
                                size="sm"
                                variant="secondary"
                                className="h-6 px-2 text-[10px]"
                                disabled={btcConnectPending}
                                onClick={() => handleBtcConnect(btc.id)}
                              >
                                {btc.icon} Connect {btc.name}
                              </Button>
                            ))}
                          </div>
                        )}
                        {!wallet.btcAddress && (
                          <div className="mt-2 rounded-md border border-border/60 bg-surface/40 p-2">
                            <p className="text-[10px] text-muted-foreground">
                              No BTC extension found? Link a Bitcoin testnet address manually.
                            </p>
                            <div className="mt-1 flex items-center gap-1">
                              <Input
                                value={manualBtcAddress}
                                onChange={(event) => setManualBtcAddress(event.target.value)}
                                placeholder="tb1..."
                                className="h-7 text-[10px] font-mono"
                              />
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 px-2 text-[10px]"
                                disabled={btcManualLinkPending || !manualBtcAddress.trim()}
                                onClick={handleManualBtcLink}
                              >
                                {btcManualLinkPending ? "Linking..." : "Link"}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <DropdownMenuSeparator />
                    <div>
                      <p className="text-xs text-muted-foreground">Total Portfolio (backend)</p>
                      <p className="text-2xl font-bold text-foreground">
                        ${formatCurrency(wallet?.totalValueUSD)}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Dari aktivitas backend, bukan saldo on-chain.
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Portfolio (effective)</p>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div className="p-2 rounded-lg bg-surface/50">
                          <p className="text-xs text-muted-foreground">BTC</p>
                          <p className="text-sm font-medium">{formatAsset(effectivePortfolioBalance.BTC)}</p>
                        </div>
                        <div className="p-2 rounded-lg bg-surface/50">
                          <p className="text-xs text-muted-foreground">ETH</p>
                          <p className="text-sm font-medium">{formatAsset(effectivePortfolioBalance.ETH)}</p>
                        </div>
                        <div className="p-2 rounded-lg bg-surface/50">
                          <p className="text-xs text-muted-foreground">STRK</p>
                          <p className="text-sm font-medium">{formatAsset(effectivePortfolioBalance.STRK)}</p>
                        </div>
                        <div className="p-2 rounded-lg bg-surface/50">
                          <p className="text-xs text-muted-foreground">CAREL</p>
                          <p className="text-sm font-medium">{formatAsset(effectivePortfolioBalance.CAREL)}</p>
                        </div>
                        <div className="p-2 rounded-lg bg-surface/50">
                          <p className="text-xs text-muted-foreground">USDC</p>
                          <p className="text-sm font-medium">{formatAsset(effectivePortfolioBalance.USDC)}</p>
                        </div>
                        <div className="p-2 rounded-lg bg-surface/50">
                          <p className="text-xs text-muted-foreground">USDT</p>
                          <p className="text-sm font-medium">{formatAsset(effectivePortfolioBalance.USDT)}</p>
                        </div>
                        <div className="p-2 rounded-lg bg-surface/50">
                          <p className="text-xs text-muted-foreground">WBTC</p>
                          <p className="text-sm font-medium">{formatAsset(effectivePortfolioBalance.WBTC)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive cursor-pointer" onClick={wallet.disconnect}>
                    Disconnect Wallet
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                onClick={() => setWalletDialogOpen(true)}
                className="bg-gradient-to-r from-primary to-accent hover:opacity-90 text-primary-foreground animate-pulse-glow"
              >
                <Wallet className="h-4 w-4 mr-2" />
                Connect Wallet
              </Button>
            )}

            <DropdownMenu open={notificationsOpen} onOpenChange={setNotificationsOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative">
                  <Bell className="h-5 w-5" />
                  {Number(notifications?.unreadCount ?? 0) > 0 && (
                    <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-accent text-[10px] font-bold flex items-center justify-center text-accent-foreground animate-pulse">
                      {notifications.unreadCount}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 glass-strong border-border p-0">
                <div className="p-3 border-b border-border flex items-center justify-between">
                  <h3 className="font-medium text-foreground">Notifications</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={notifications.markAllAsRead}
                  >
                    Mark all read
                  </Button>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {!notifications?.notifications || notifications.notifications.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                      <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No notifications</p>
                    </div>
                  ) : (
                    notifications.notifications.map((notif) => (
                      <div
                        key={notif.id}
                        className={cn(
                          "p-3 border-b border-border/50 hover:bg-surface/50 cursor-pointer transition-colors",
                          !notif.read && "bg-primary/5"
                        )}
                        onClick={() => notifications.markAsRead(notif.id)}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={cn(
                              "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                              notif.type === "success" && "bg-success/20",
                              notif.type === "error" && "bg-destructive/20",
                              notif.type === "info" && "bg-secondary/20",
                              notif.type === "warning" && "bg-accent/20"
                            )}
                          >
                            {notif.type === "success" && (
                              <Check className="h-4 w-4 text-success" />
                            )}
                            {notif.type === "error" && <X className="h-4 w-4 text-destructive" />}
                            {notif.type === "info" && <Bell className="h-4 w-4 text-secondary" />}
                            {notif.type === "warning" && <Zap className="h-4 w-4 text-accent" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground">{notif.title}</p>
                            <p className="text-xs text-muted-foreground mt-1">{notif.message}</p>
                            {notif.txHash && (
                              <p className="text-xs text-primary mt-1 font-mono">
                                Tx: {shortenAddress(notif.txHash)}
                              </p>
                            )}
                            {notif.txExplorerUrls && notif.txExplorerUrls.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-2">
                                {notif.txExplorerUrls.map((link) => (
                                  <a
                                    key={`${notif.id}-${link.url}`}
                                    href={link.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(event) => event.stopPropagation()}
                                    className="text-[11px] text-primary hover:underline"
                                  >
                                    {link.label}
                                  </a>
                                ))}
                              </div>
                            )}
                            <p className="text-xs text-muted-foreground mt-1">
                              {notif.timestamp ? new Date(notif.timestamp).toLocaleTimeString() : ""}
                            </p>
                          </div>
                          {!notif.read && (
                            <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <User className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 glass-strong border-border">
                <DropdownMenuLabel>
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Profile</p>
                      {wallet?.isConnected && (
                        <p className="text-xs text-muted-foreground font-mono">
                          {shortenAddress(wallet.address)}
                        </p>
                      )}
                      {wallet?.isConnected && displayName && (
                        <p className="text-xs text-primary mt-0.5">{displayName}</p>
                      )}
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/#portfolio" className="flex items-center gap-2">
                    <PieChart className="h-4 w-4" />
                    Portfolio
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/#leaderboard" className="flex items-center gap-2">
                    <Trophy className="h-4 w-4" />
                    Leaderboard
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setReferralLogOpen(true)}>
                  <Users className="h-4 w-4 mr-2" />
                  Referral
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      window.dispatchEvent(new Event("carel:open-loyalty-hub"))
                    }
                  }}
                >
                  <Gift className="h-4 w-4 mr-2" />
                  Loyalty Hub
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleSetDisplayName}
                  disabled={!wallet?.isConnected}
                  className={!wallet?.isConnected ? "opacity-50 cursor-not-allowed" : ""}
                >
                  <User className="h-4 w-4 mr-2" />
                  {displayName ? "Change Display Name" : "Set Display Name"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                  <Settings className="h-4 w-4 mr-2" />
                  Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 glass-strong border-border">
                <DropdownMenuLabel>DeFi</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => openDeFiFeature("swap-bridge")}
                  onSelect={() => openDeFiFeature("swap-bridge")}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <ArrowRightLeft className="h-4 w-4" />
                    Swap & Bridge
                  </div>
                  <ChevronRight className="h-4 w-4" />
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => openDeFiFeature("limit-order")}
                  onSelect={() => openDeFiFeature("limit-order")}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Limit Order
                  </div>
                  <ChevronRight className="h-4 w-4" />
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => openDeFiFeature("stake-earn")}
                  onSelect={() => openDeFiFeature("stake-earn")}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Coins className="h-4 w-4" />
                    Stake & Earn
                  </div>
                  <ChevronRight className="h-4 w-4" />
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Top Up</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setTopUpOpen(true)}>
                  <QrCode className="h-4 w-4 mr-2" />
                  Receive Crypto
                </DropdownMenuItem>
                <DropdownMenuItem disabled className="opacity-50 cursor-not-allowed">
                  <div className="flex items-center gap-2">
                    <Smartphone className="h-4 w-4" />
                    Buy with Fiat
                  </div>
                  <span className="ml-auto text-xs text-secondary">Soon</span>
                </DropdownMenuItem>
                <DropdownMenuItem disabled className="opacity-50 cursor-not-allowed">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Sell Crypto
                  </div>
                  <span className="ml-auto text-xs text-secondary">Soon</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setHelpOpen(true)}>
                  <HelpCircle className="h-4 w-4 mr-2" />
                  Help Center
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTxHistoryOpen(true)}>
                  <History className="h-4 w-4 mr-2" />
                  Transaction History
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>

        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-border glass-strong p-4">
            <div className="space-y-2">
              {!wallet?.isConnected && (
                <Button
                  onClick={() => {
                    setWalletDialogOpen(true)
                    setMobileMenuOpen(false)
                  }}
                  className="w-full bg-gradient-to-r from-primary to-accent"
                >
                  <Wallet className="h-4 w-4 mr-2" />
                  Connect Wallet
                </Button>
              )}
              <button
                type="button"
                onClick={() => {
                  openDeFiFeature("swap-bridge")
                  setMobileMenuOpen(false)
                }}
                className="w-full text-left px-4 py-3 rounded-lg hover:bg-surface transition-colors"
              >
                <div className="flex items-center gap-2">
                  <ArrowRightLeft className="h-5 w-5 text-primary" />
                  <span className="font-medium">Swap & Bridge</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  openDeFiFeature("limit-order")
                  setMobileMenuOpen(false)
                }}
                className="w-full text-left px-4 py-3 rounded-lg hover:bg-surface transition-colors"
              >
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  <span className="font-medium">Limit Order</span>
                </div>
              </button>
              <button
                onClick={() => {
                  openDeFiFeature("stake-earn")
                  setMobileMenuOpen(false)
                }}
                className="w-full text-left px-4 py-3 rounded-lg hover:bg-surface transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Coins className="h-5 w-5 text-primary" />
                  <span className="font-medium">Stake & Earn</span>
                </div>
              </button>
              <Link
                href="/#portfolio"
                className="block px-4 py-3 rounded-lg hover:bg-surface transition-colors"
              >
                <div className="flex items-center gap-2">
                  <PieChart className="h-5 w-5 text-primary" />
                  <span className="font-medium">Portfolio</span>
                </div>
              </Link>
              <Link
                href="/#leaderboard"
                className="block px-4 py-3 rounded-lg hover:bg-surface transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-primary" />
                  <span className="font-medium">Leaderboard</span>
                </div>
              </Link>
            </div>
          </div>
        )}
      </header>

      <WalletConnectDialog
        open={walletDialogOpen}
        onOpenChange={setWalletDialogOpen}
        walletProviders={walletProviders}
        btcWalletProviders={btcWalletProviders}
        walletConnectPending={walletConnectPending}
        btcConnectPending={btcConnectPending}
        onWalletConnect={handleWalletConnect}
        onBtcConnect={handleBtcConnect}
      />

      <ReferralLog isOpen={referralLogOpen} onOpenChange={setReferralLogOpen} showTrigger={false} />

      <TxHistoryDialog
        open={txHistoryOpen}
        onOpenChange={setTxHistoryOpen}
        txFilter={txFilter}
        onTxFilterChange={setTxFilter}
        txFilters={txFilters}
        txHistory={txHistory}
        txHistoryLoading={txHistoryLoading}
        shortenAddress={shortenAddress}
        txExplorerLinks={txExplorerLinks}
      />

      <TopUpDialog
        open={topUpOpen}
        onOpenChange={setTopUpOpen}
        receiveTargets={receiveTargets}
        activeReceiveNetwork={activeReceiveNetwork}
        onSelectReceiveNetwork={setActiveReceiveNetwork}
        selectedReceiveTarget={selectedReceiveTarget}
        selectedReceiveFaucetUrl={selectedReceiveFaucetUrl}
        copiedReceiveNetwork={copiedReceiveNetwork}
        onCopyReceiveAddress={copyReceiveAddress}
        onOpenWalletDialog={() => {
          setTopUpOpen(false)
          setWalletDialogOpen(true)
        }}
        manualBtcAddress={manualBtcAddress}
        onManualBtcAddressChange={setManualBtcAddress}
        btcManualLinkPending={btcManualLinkPending}
        onManualBtcLink={handleManualBtcLink}
      />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  )
}
