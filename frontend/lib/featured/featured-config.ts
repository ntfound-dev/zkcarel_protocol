import { ArrowRightLeft, TrendingUp, Coins, Bot, Gamepad2, Sparkles } from "lucide-react"

export type SelectableFeatureId =
  | "swap-bridge"
  | "limit-order"
  | "stake-earn"
  | "soulbound-nft"
  | "ai-assistant"
  | "defi-futures"

export type FeatureStat = {
  label: string
  value: string
  numericValue?: number
  prefix?: string
  suffix?: string
}

export type FeatureConfig = {
  id: SelectableFeatureId
  title: string
  description: string
  icon: typeof ArrowRightLeft
  gradient: string
  stats: FeatureStat[]
  comingSoon?: boolean
  cta?: string
}

export const buildFeaturedConfig = (stats: {
  swap: { volume?: number; trades?: number }
  limit: { activeOrders?: number; successRate?: number }
  stake: { tvl?: number; maxApy?: number }
}): FeatureConfig[] => [
  {
    id: "swap-bridge",
    title: "Swap & Bridge",
    description: "Trade tokens seamlessly across chains with zero-knowledge privacy",
    icon: ArrowRightLeft,
    gradient: "from-primary via-accent to-secondary",
    stats: [
      { label: "Your Volume", value: "—", numericValue: stats.swap.volume, prefix: "$" },
      { label: "Your Trades", value: "—", numericValue: stats.swap.trades },
    ],
    cta: "Explore",
  },
  {
    id: "limit-order",
    title: "Limit Order",
    description: "Set your price and let the market come to you with advanced order types",
    icon: TrendingUp,
    gradient: "from-secondary via-primary to-accent",
    stats: [
      { label: "Active Orders", value: "—", numericValue: stats.limit.activeOrders },
      { label: "Success Rate", value: "—", numericValue: stats.limit.successRate, suffix: "%" },
    ],
    cta: "Open",
  },
  {
    id: "stake-earn",
    title: "Stake & Earn",
    description: "Earn passive income by staking your crypto assets with competitive APY",
    icon: Coins,
    gradient: "from-accent via-secondary to-primary",
    stats: [
      { label: "TVL", value: "—", numericValue: stats.stake.tvl, prefix: "$" },
      {
        label: "APY",
        value: stats.stake.maxApy ? `Up to ${stats.stake.maxApy.toFixed(2)}%` : "—",
        numericValue: stats.stake.maxApy,
        prefix: "Up to ",
        suffix: "%",
      },
    ],
    cta: "Open",
  },
  {
    id: "soulbound-nft",
    title: "Loyalty Hub",
    description: "Manage points and non-transferable NFT tiers to unlock fee discounts on supported executions",
    icon: Sparkles,
    gradient: "from-secondary via-accent to-success",
    stats: [
      { label: "Max Discount", value: "Up to 50%" },
      { label: "Type", value: "Non-transferable" },
    ],
    cta: "Open",
  },
  {
    id: "ai-assistant",
    title: "AI Execution",
    description: "Run swap, bridge, stake, and limit commands with guided confirmations",
    icon: Bot,
    gradient: "from-success via-primary to-accent",
    stats: [
      { label: "L2 Cost", value: "1 CAREL / exec" },
      { label: "L3 Cost", value: "2 CAREL / exec" },
    ],
    cta: "Open",
  },
  {
    id: "defi-futures",
    title: "Battleship",
    description:
      "Battleship is temporarily disabled while we fix stability issues. It will return in a later update.",
    icon: Gamepad2,
    gradient: "from-primary via-secondary to-success",
    stats: [
      { label: "Win Reward", value: "+20 pts" },
      { label: "Hit Reward", value: "+3 pts" },
    ],
    comingSoon: true,
    cta: "Soon",
  },
]
