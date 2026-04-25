import {
  ArrowRightLeft,
  PieChart,
  Trophy,
  Gift,
  Bot,
  History,
  Users,
  Settings,
  type LucideIcon,
} from "lucide-react"

export type NavItem = {
  label: string
  href: string
  icon: LucideIcon
}

export type FaucetToken = {
  symbol: string
  name: string
  amount: string
}

export const navItems: NavItem[] = [
  { label: "Trade", href: "#trade", icon: ArrowRightLeft },
  { label: "Portfolio", href: "#portfolio", icon: PieChart },
  { label: "Leaderboard", href: "#leaderboard", icon: Trophy },
  { label: "Rewards", href: "#rewards", icon: Gift },
]

export const secondaryItems: NavItem[] = [
  { label: "AI Assistant", href: "#ai", icon: Bot },
  { label: "History", href: "#history", icon: History },
  { label: "Referral", href: "#referral", icon: Users },
  { label: "Settings", href: "#settings", icon: Settings },
]

export const faucetTokens: FaucetToken[] = [
  { symbol: "BTC", name: "Bitcoin", amount: "0.001" },
  { symbol: "STRK", name: "StarkNet", amount: "10" },
  { symbol: "CAREL", name: "Carel Protocol", amount: "100" },
]
