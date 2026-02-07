"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Shield, Wallet, Bell, User, Menu, X, ArrowRightLeft, PieChart, Trophy, Gift, Bot, History, Users, Settings, Droplets, CreditCard, ChevronDown } from "lucide-react"

const navItems = [
  { label: "Trade", href: "#trade", icon: ArrowRightLeft },
  { label: "Portfolio", href: "#portfolio", icon: PieChart },
  { label: "Leaderboard", href: "#leaderboard", icon: Trophy },
  { label: "Rewards", href: "#rewards", icon: Gift },
]

const secondaryItems = [
  { label: "AI Assistant", href: "#ai", icon: Bot },
  { label: "History", href: "#history", icon: History },
  { label: "Referral", href: "#referral", icon: Users },
  { label: "Settings", href: "#settings", icon: Settings },
]

const faucetTokens = [
  { symbol: "BTC", name: "Bitcoin", amount: "0.001" },
  { symbol: "STRK", name: "StarkNet", amount: "10" },
  { symbol: "CAREL", name: "ZkCarel", amount: "100" },
]

export function Navigation() {
  const { mode, toggleMode } = useTheme()
  const [isConnected, setIsConnected] = React.useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [depositOpen, setDepositOpen] = React.useState(false)
  const [walletAddress] = React.useState("0x8f...4e2d")
  const [carelBalance, setCarelBalance] = React.useState(245)
  const [claimedFaucet, setClaimedFaucet] = React.useState<string[]>([])

  const handleConnect = () => {
    setIsConnected(true)
  }

  const handleClaimFaucet = (symbol: string, amount: string) => {
    if (claimedFaucet.includes(symbol)) return
    setClaimedFaucet([...claimedFaucet, symbol])
    if (symbol === "CAREL") {
      setCarelBalance(prev => prev + Number.parseFloat(amount))
    }
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 glass-strong">
      <div className="container flex h-16 items-center justify-between px-4 mx-auto">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="relative">
            <Shield className="h-8 w-8 text-primary animate-pulse-glow" />
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-primary-foreground">
              Z
            </span>
          </div>
          <span className="font-sans text-xl font-bold tracking-wider text-foreground group-hover:text-primary transition-colors">
            ZkCarel
          </span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden lg:flex items-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-primary/10 rounded-lg transition-all duration-200"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 glass-strong border-border">
              {secondaryItems.map((item) => (
                <DropdownMenuItem key={item.label} asChild>
                  <Link href={item.href} className="flex items-center gap-2 text-foreground">
                    <item.icon className="h-4 w-4 text-primary" />
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>

        {/* Right Side Actions */}
        <div className="flex items-center gap-3">
          {/* Faucet Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="sm"
                className="hidden sm:flex gap-1.5 text-success hover:bg-success/10 h-8 px-2"
              >
                <Droplets className="h-4 w-4" />
                <span className="text-xs">Faucet</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 glass-strong border-border">
              <div className="px-3 py-2 border-b border-border">
                <p className="text-xs font-medium text-foreground">Testnet Faucet</p>
                <p className="text-xs text-muted-foreground">Claim free tokens</p>
              </div>
              {faucetTokens.map((token) => (
                <DropdownMenuItem 
                  key={token.symbol}
                  className={cn(
                    "flex items-center justify-between cursor-pointer",
                    claimedFaucet.includes(token.symbol) && "opacity-50"
                  )}
                  onClick={() => handleClaimFaucet(token.symbol, token.amount)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{token.symbol}</span>
                    <span className="text-xs text-muted-foreground">{token.name}</span>
                  </div>
                  <span className={cn(
                    "text-xs font-medium",
                    claimedFaucet.includes(token.symbol) ? "text-muted-foreground" : "text-success"
                  )}>
                    {claimedFaucet.includes(token.symbol) ? "Claimed" : `+${token.amount}`}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Deposit Button */}
          <DropdownMenu open={depositOpen} onOpenChange={setDepositOpen}>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="sm"
                className="hidden sm:flex gap-1.5 text-secondary hover:bg-secondary/10 h-8 px-2"
              >
                <CreditCard className="h-4 w-4" />
                <span className="text-xs">Deposit</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 glass-strong border-border">
              <div className="px-3 py-2 border-b border-border">
                <p className="text-xs font-medium text-foreground">Deposit Funds</p>
                <p className="text-xs text-muted-foreground">Choose payment method</p>
              </div>
              <DropdownMenuItem className="flex items-center gap-3 cursor-pointer py-3">
                <div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center">
                  <span className="text-lg">🏦</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Bank Transfer</p>
                  <p className="text-xs text-muted-foreground">BCA, BNI, Mandiri, BRI</p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem className="flex items-center gap-3 cursor-pointer py-3">
                <div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center">
                  <span className="text-lg">📱</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">QRIS</p>
                  <p className="text-xs text-muted-foreground">Scan QR to pay</p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem className="flex items-center gap-3 cursor-pointer py-3">
                <div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center">
                  <span className="text-lg">💳</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Visa / Mastercard</p>
                  <p className="text-xs text-muted-foreground">Credit & Debit cards</p>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Network Selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-border text-sm hover:border-primary/50 transition-colors">
                <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                <span className="text-foreground font-medium">Testnet</span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 glass-strong border-border">
              <DropdownMenuItem className="flex items-center gap-2 cursor-pointer">
                <span className="h-2 w-2 rounded-full bg-success" />
                <span className="text-foreground font-medium">Testnet</span>
                <span className="ml-auto text-xs text-success">Active</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="flex items-center gap-2 cursor-not-allowed opacity-50" disabled>
                <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                <span className="text-muted-foreground">Mainnet</span>
                <span className="ml-auto text-xs text-muted-foreground">Soon</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Mode Toggle */}
          <button
            onClick={toggleMode}
            className={cn(
              "hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-300",
              mode === "private"
                ? "bg-primary/20 text-primary border border-primary/50"
                : "bg-secondary/20 text-secondary border border-secondary/50"
            )}
          >
            <span className={cn(
              "h-2 w-2 rounded-full transition-colors",
              mode === "private" ? "bg-primary" : "bg-secondary"
            )} />
            {mode === "private" ? "Private" : "Transparent"}
          </button>

          {/* Wallet / Connect */}
          {isConnected ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="outline" 
                  className="gap-2 border-primary/50 hover:bg-primary/10 text-foreground bg-transparent"
                >
                  <Wallet className="h-4 w-4 text-primary" />
                  <span className="hidden sm:inline font-mono text-sm">{walletAddress}</span>
                  <span className="text-xs text-muted-foreground">{carelBalance} CAREL</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 glass-strong border-border">
                <div className="px-3 py-2">
                  <p className="text-xs text-muted-foreground">Connected Wallet</p>
                  <p className="font-mono text-sm text-foreground">{walletAddress}</p>
                </div>
                <DropdownMenuSeparator className="bg-border" />
                <div className="px-3 py-2">
                  <p className="text-xs text-muted-foreground">Balance</p>
                  <p className="text-lg font-bold text-primary">{carelBalance} CAREL</p>
                </div>
                <DropdownMenuSeparator className="bg-border" />
                <DropdownMenuItem className="text-destructive">
                  Disconnect
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button 
              onClick={handleConnect}
              className="bg-gradient-to-r from-primary to-accent hover:opacity-90 text-primary-foreground font-medium animate-pulse-glow"
            >
              <Wallet className="h-4 w-4 mr-2" />
              Connect
            </Button>
          )}

          {/* Notifications */}
          <Button variant="ghost" size="icon" className="relative text-foreground hover:bg-primary/10">
            <Bell className="h-5 w-5" />
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-accent text-[10px] flex items-center justify-center text-accent-foreground">
              3
            </span>
          </Button>

          {/* User Profile */}
          <Button variant="ghost" size="icon" className="text-foreground hover:bg-primary/10">
            <User className="h-5 w-5" />
          </Button>

          {/* Mobile Menu Toggle */}
          <Button 
            variant="ghost" 
            size="icon" 
            className="lg:hidden text-foreground"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-border glass-strong">
          <nav className="container px-4 py-4 mx-auto">
            <div className="flex flex-col gap-2">
              {navItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex items-center gap-3 px-4 py-3 text-foreground hover:bg-primary/10 rounded-lg transition-colors"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <item.icon className="h-5 w-5 text-primary" />
                  {item.label}
                </Link>
              ))}
              <div className="h-px bg-border my-2" />
              {secondaryItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex items-center gap-3 px-4 py-3 text-muted-foreground hover:text-foreground hover:bg-primary/10 rounded-lg transition-colors"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <item.icon className="h-5 w-5" />
                  {item.label}
                </Link>
              ))}
              {/* Mobile Mode Toggle */}
              <button
                onClick={toggleMode}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-lg transition-all mt-2",
                  mode === "private"
                    ? "bg-primary/20 text-primary"
                    : "bg-secondary/20 text-secondary"
                )}
              >
                <span className={cn(
                  "h-3 w-3 rounded-full",
                  mode === "private" ? "bg-primary" : "bg-secondary"
                )} />
                {mode === "private" ? "Private Mode" : "Transparent Mode"}
              </button>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
