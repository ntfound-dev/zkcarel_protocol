import type { SocialTaskItem } from "@/lib/api"

export type SocialTaskUi = SocialTaskItem & { placeholder: string }

export const tierDefinitions = [
  {
    tierId: 1,
    name: "Bronze",
    points: 5000,
    discount: "5%",
    color: "from-amber-600 to-amber-800",
    borderColor: "border-amber-600",
  },
  {
    tierId: 2,
    name: "Silver",
    points: 15000,
    discount: "10%",
    color: "from-gray-300 to-gray-500",
    borderColor: "border-gray-400",
  },
  {
    tierId: 3,
    name: "Gold",
    points: 50000,
    discount: "25%",
    color: "from-yellow-400 to-yellow-600",
    borderColor: "border-yellow-500",
  },
  {
    tierId: 4,
    name: "Platinum",
    points: 150000,
    discount: "35%",
    color: "from-cyan-300 to-cyan-500",
    borderColor: "border-cyan-400",
  },
  {
    tierId: 5,
    name: "Onyx",
    points: 500000,
    discount: "50%",
    color: "from-purple-900 to-black",
    borderColor: "border-purple-600",
  },
]

export const nftTiers = [
  {
    tierId: 0,
    tier: "None",
    name: "No NFT",
    image: "/nft/none-tier-animated.svg",
    fallbackImage: "/nft/none-tier.png",
    discount: "0%",
    uses: 0,
    maxUses: 0,
    rechargeCost: 0,
    cost: 0,
    gradient: "from-muted to-muted-foreground",
    description: "No discount benefits",
  },
  {
    tierId: 1,
    tier: "Bronze",
    name: "Cyberpunk Shield NFT",
    image: "/nft/bronze-shield-animated.svg",
    fallbackImage: "/nft/bronze-shield.png",
    discount: "5%",
    uses: 5,
    maxUses: 5,
    rechargeCost: 0,
    cost: 5000,
    gradient: "from-amber-600 to-amber-800",
    description: "5% fee discount on all transactions",
  },
  {
    tierId: 2,
    tier: "Silver",
    name: "Cyberpunk Blade NFT",
    image: "/nft/silver-blade-animated.svg",
    fallbackImage: "/nft/silver-blade.png",
    discount: "10%",
    uses: 7,
    maxUses: 7,
    rechargeCost: 0,
    cost: 15000,
    gradient: "from-gray-300 to-gray-500",
    description: "10% fee discount on all transactions",
  },
  {
    tierId: 3,
    tier: "Gold",
    name: "Cyberpunk Blade NFT",
    image: "/nft/gold-blade-animated.svg",
    fallbackImage: "/nft/gold-blade.png",
    discount: "25%",
    uses: 10,
    maxUses: 10,
    rechargeCost: 0,
    cost: 50000,
    gradient: "from-yellow-400 to-yellow-600",
    description: "25% fee discount on all transactions",
  },
  {
    tierId: 4,
    tier: "Platinum",
    name: "Cyberpunk Blade NFT",
    image: "/nft/platinum-blade-animated.svg",
    fallbackImage: "/nft/platinum-blade.png",
    discount: "35%",
    uses: 15,
    maxUses: 15,
    rechargeCost: 0,
    cost: 150000,
    gradient: "from-cyan-300 to-cyan-500",
    description: "35% fee discount on all transactions",
  },
  {
    tierId: 5,
    tier: "Onyx",
    name: "Cyberpunk Blade NFT",
    image: "/nft/onyx-blade-animated.svg",
    fallbackImage: "/nft/onyx-blade.png",
    discount: "50%",
    uses: 20,
    maxUses: 20,
    rechargeCost: 0,
    cost: 500000,
    gradient: "from-purple-900 to-black",
    description: "50% fee discount on all transactions",
  },
]

export type TierDefinition = (typeof tierDefinitions)[number]
export type TierInfo = TierDefinition & { achieved: boolean }
export type NftTier = (typeof nftTiers)[number]

export const defaultSocialTasks: SocialTaskUi[] = [
  {
    id: "twitter_follow",
    title: "X: Follow",
    description: "Follow @carelprotocol and paste your profile link or handle. (+5 pts)",
    points: 5,
    provider: "twitter",
    placeholder: "https://x.com/your_handle",
  },
  {
    id: "twitter_like",
    title: "X: Like",
    description: "Like announcement tweet and paste the tweet URL. (+2 pts)",
    points: 2,
    provider: "twitter",
    placeholder: "https://x.com/carelprotocol/status/...",
  },
  {
    id: "twitter_retweet",
    title: "X: Retweet",
    description: "Retweet announcement tweet and paste the tweet URL. (+3 pts)",
    points: 3,
    provider: "twitter",
    placeholder: "https://x.com/carelprotocol/status/...",
  },
  {
    id: "twitter_comment",
    title: "X: Comment",
    description: "Comment on announcement tweet and paste the tweet URL. (+10 pts)",
    points: 10,
    provider: "twitter",
    placeholder: "https://x.com/carelprotocol/status/...",
  },
  {
    id: "telegram_join_channel",
    title: "Telegram: Join Channel",
    description: "Join official channel and paste your Telegram username. (+5 pts)",
    points: 5,
    provider: "telegram",
    placeholder: "@username",
  },
  {
    id: "telegram_join_group",
    title: "Telegram: Join Group",
    description: "Join official group and paste your Telegram username. (+5 pts)",
    points: 5,
    provider: "telegram",
    placeholder: "@username",
  },
  {
    id: "discord_join",
    title: "Discord: Join",
    description: "Join our Discord server and paste your Discord tag. (+5 pts)",
    points: 5,
    provider: "discord",
    placeholder: "username#1234",
  },
  {
    id: "discord_verify",
    title: "Discord: Verify",
    description: "Complete verification and paste your Discord tag/proof. (+10 pts)",
    points: 10,
    provider: "discord",
    placeholder: "username#1234",
  },
  {
    id: "discord_role",
    title: "Discord: Get Role",
    description: "Get community role and paste your Discord tag/proof. (+5 pts)",
    points: 5,
    provider: "discord",
    placeholder: "username#1234",
  },
]

export const STARKNET_DISCOUNT_SOULBOUND_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_DISCOUNT_SOULBOUND_ADDRESS ||
  process.env.NEXT_PUBLIC_DISCOUNT_SOULBOUND_ADDRESS ||
  ""

export const SOCIAL_TASKS_COMING_SOON = true
