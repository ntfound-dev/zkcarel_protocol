"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Gift, Diamond, Trophy, Sparkles, ArrowRight, Check, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"

const tiers = [
  { 
    name: "Bronze", 
    points: 1000, 
    discount: "5%", 
    color: "from-amber-600 to-amber-800",
    borderColor: "border-amber-600",
    achieved: true 
  },
  { 
    name: "Silver", 
    points: 5000, 
    discount: "15%", 
    color: "from-gray-300 to-gray-500",
    borderColor: "border-gray-400",
    achieved: true 
  },
  { 
    name: "Gold", 
    points: 10000, 
    discount: "25%", 
    color: "from-yellow-400 to-yellow-600",
    borderColor: "border-yellow-500",
    achieved: false 
  },
  { 
    name: "Platinum", 
    points: 25000, 
    discount: "35%", 
    color: "from-cyan-300 to-cyan-500",
    borderColor: "border-cyan-400",
    achieved: false 
  },
  { 
    name: "Onyx", 
    points: 50000, 
    discount: "50%", 
    color: "from-purple-900 to-black",
    borderColor: "border-purple-600",
    achieved: false 
  },
]

const nftTiers = [
  {
    tier: "None",
    name: "No NFT",
    discount: "0%",
    uses: 0,
    maxUses: 0,
    cost: 0,
    gradient: "from-muted to-muted-foreground",
    description: "No discount benefits",
  },
  {
    tier: "Bronze",
    name: "Cyberpunk Shield NFT",
    discount: "5%",
    uses: 5,
    maxUses: 5,
    cost: 1000,
    gradient: "from-amber-600 to-amber-800",
    description: "5% fee discount on all transactions",
  },
  {
    tier: "Silver",
    name: "Cyberpunk Blade NFT",
    discount: "10%",
    uses: 5,
    maxUses: 5,
    cost: 5000,
    gradient: "from-gray-300 to-gray-500",
    description: "10% fee discount on all transactions",
  },
  {
    tier: "Gold",
    name: "Cyberpunk Blade NFT",
    discount: "25%",
    uses: 10,
    maxUses: 10,
    cost: 10000,
    gradient: "from-yellow-400 to-yellow-600",
    description: "25% fee discount on all transactions",
  },
  {
    tier: "Platinum",
    name: "Cyberpunk Blade NFT",
    discount: "35%",
    uses: 15,
    maxUses: 15,
    cost: 25000,
    gradient: "from-cyan-300 to-cyan-500",
    description: "35% fee discount on all transactions",
  },
  {
    tier: "Onyx",
    name: "Cyberpunk Blade NFT",
    discount: "50%",
    uses: 20,
    maxUses: 20,
    cost: 50000,
    gradient: "from-purple-900 to-black",
    description: "50% fee discount on all transactions",
  },
]

const nfts = [
  {
    name: "Cyberpunk Shield NFT",
    tier: "Bronze",
    discount: "5%",
    acquired: "Owned",
  },
  {
    name: "Cyberpunk Blade NFT",
    tier: "Silver",
    discount: "10%",
    acquired: "Owned",
  },
  {
    name: "Cyberpunk Blade NFT",
    tier: "Gold",
    discount: "25%",
    acquired: "Not Owned",
  },
  {
    name: "Cyberpunk Blade NFT",
    tier: "Platinum",
    discount: "35%",
    acquired: "Not Owned",
  },
  {
    name: "Cyberpunk Blade NFT",
    tier: "Onyx",
    discount: "50%",
    acquired: "Not Owned",
  },
]

function TierProgressBar() {
  const currentPoints = 4200
  const currentTierIndex = 1 // Silver
  const nextTier = tiers[currentTierIndex + 1]
  const prevTier = tiers[currentTierIndex]
  const progressInCurrentTier = ((currentPoints - prevTier.points) / (nextTier.points - prevTier.points)) * 100

  return (
    <div className="p-6 rounded-2xl glass border border-border">
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="h-5 w-5 text-primary" />
        <span className="font-medium text-foreground">Tier Progression</span>
      </div>

      {/* Tier Progress Line */}
      <div className="relative mt-8 mb-12">
        {/* Background line */}
        <div className="absolute top-1/2 left-0 right-0 h-1 bg-surface -translate-y-1/2 rounded-full" />
        
        {/* Progress line */}
        <div 
          className="absolute top-1/2 left-0 h-1 bg-gradient-to-r from-primary to-secondary -translate-y-1/2 rounded-full transition-all duration-500"
          style={{ width: `${((currentTierIndex + progressInCurrentTier / 100) / (tiers.length - 1)) * 100}%` }}
        />
        
        {/* Tier markers */}
        <div className="relative flex justify-between">
          {tiers.map((tier, index) => (
            <div key={tier.name} className="flex flex-col items-center">
              <div className={cn(
                "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                tier.achieved 
                  ? `bg-gradient-to-br ${tier.color} border-transparent` 
                  : "bg-surface border-border"
              )}>
                {tier.achieved && <Check className="h-3 w-3 text-white" />}
              </div>
              <span className={cn(
                "text-xs mt-2 font-medium",
                index === currentTierIndex ? "text-primary" : tier.achieved ? "text-foreground" : "text-muted-foreground"
              )}>
                {tier.name}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Current Status */}
      <div className="p-4 rounded-xl bg-surface/50 border border-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm text-muted-foreground">Current Tier</p>
            <p className="text-xl font-bold text-foreground">{tiers[currentTierIndex].name}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Progress to {nextTier.name}</p>
            <p className="text-xl font-bold text-primary">{currentPoints.toLocaleString()} / {nextTier.points.toLocaleString()}</p>
          </div>
        </div>
        <div className="h-3 rounded-full bg-surface overflow-hidden">
          <div 
            className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all duration-500"
            style={{ width: `${progressInCurrentTier}%` }}
          />
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          Need {(nextTier.points - currentPoints).toLocaleString()} more points for {nextTier.discount} discount
        </p>
      </div>
    </div>
  )
}

function NFTCard({ 
  nft, 
  isOwned, 
  onMint 
}: { 
  nft: typeof nftTiers[0]
  isOwned: boolean
  onMint?: () => void
}) {
  const usesPercentage = nft.maxUses > 0 ? (nft.uses / nft.maxUses) * 100 : 0
  const isExpired = isOwned && nft.uses === 0

  return (
    <div className={cn(
      "group relative p-4 rounded-2xl glass border transition-all duration-300 overflow-hidden",
      isOwned && !isExpired ? "border-primary/50" : "border-border",
      isExpired && "opacity-60"
    )}>
      {/* Non-transferable badge */}
      {isOwned && (
        <div className="absolute top-2 right-2 z-10">
          <span className="text-xs px-2 py-1 rounded-full bg-secondary/20 text-secondary border border-secondary/30">
            Non-transferable
          </span>
        </div>
      )}

      {/* Expired overlay */}
      {isExpired && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
          <div className="text-center">
            <p className="text-lg font-bold text-muted-foreground mb-1">Expired</p>
            <p className="text-xs text-muted-foreground">All uses consumed</p>
          </div>
        </div>
      )}
      
      {/* Glow effect on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      
      {/* NFT Visual */}
      <div className={cn(
        "relative h-32 rounded-xl mb-3 flex items-center justify-center bg-gradient-to-br overflow-hidden",
        nft.gradient
      )}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.1),transparent)]" />
        <Sparkles className="h-12 w-12 text-white/80 animate-float" />
        
        {/* 3D effect border */}
        <div className="absolute inset-0 border-2 border-white/20 rounded-xl" />
      </div>
      
      <div>
        <h3 className="font-bold text-foreground text-sm group-hover:text-primary transition-colors">{nft.name}</h3>
        <p className="text-xs text-muted-foreground mb-2">{nft.tier} Tier</p>
        
        {/* Uses Counter */}
        {isOwned && nft.maxUses > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Uses Remaining</span>
              <span className={cn(
                "font-medium",
                nft.uses > 3 ? "text-success" : nft.uses > 0 ? "text-accent" : "text-destructive"
              )}>
                {nft.uses} / {nft.maxUses}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-surface overflow-hidden">
              <div 
                className={cn(
                  "h-full transition-all duration-300",
                  nft.uses > 3 ? "bg-success" : nft.uses > 0 ? "bg-accent" : "bg-destructive"
                )}
                style={{ width: `${usesPercentage}%` }}
              />
            </div>
          </div>
        )}
        
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-success font-medium">{nft.discount} Discount</span>
          {!isOwned && nft.tier !== "None" && (
            <span className="text-xs text-primary font-medium">{nft.cost.toLocaleString()} pts</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground mb-3">{nft.description}</p>

        {/* Action Button */}
        {!isOwned && nft.tier !== "None" && (
          <Button 
            size="sm" 
            className="w-full bg-gradient-to-r from-primary to-accent hover:opacity-90 text-xs"
            onClick={onMint}
          >
            Mint with Points
          </Button>
        )}
        {isExpired && (
          <Button 
            size="sm" 
            variant="outline"
            className="w-full text-xs bg-transparent"
            onClick={onMint}
          >
            Mint Again
          </Button>
        )}
        {isOwned && !isExpired && (
          <div className="text-center py-2 px-3 rounded-lg bg-success/10 border border-success/20">
            <p className="text-xs font-medium text-success">Active</p>
          </div>
        )}
      </div>
    </div>
  )
}

export function RewardsHub() {
  const everPoints = 4200
  const [usablePoints, setUsablePoints] = React.useState(5850)
  const [ownedNFT, setOwnedNFT] = React.useState<typeof nftTiers[0] | null>({
    ...nftTiers[1], // Bronze NFT
    uses: 3, // 3 uses remaining out of 5
  })

  const handleMintNFT = (nft: typeof nftTiers[0]) => {
    if (usablePoints >= nft.cost) {
      setUsablePoints(prev => prev - nft.cost)
      setOwnedNFT({...nft})
      // Show success notification
      console.log("[v0] NFT minted:", nft.tier)
    } else {
      console.log("[v0] Insufficient points for minting NFT")
    }
  }

  const carelConversionRate = 0.5 // 1 point = 0.5 CAREL
  const estimatedCAREL = usablePoints * carelConversionRate

  return (
    <section id="rewards" className="py-12">
      <div className="flex items-center gap-3 mb-6">
        <Gift className="h-6 w-6 text-primary" />
        <h2 className="text-2xl font-bold text-foreground">Loyalty Hub</h2>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Tier Progression */}
        <div className="lg:col-span-2">
          <TierProgressBar />
        </div>

        {/* Points Balance */}
        <div className="p-6 rounded-2xl glass border border-border">
          <h3 className="font-medium text-foreground mb-4">Point Balance</h3>
          
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-surface/50 border border-border">
              <div className="flex items-center gap-2 mb-1">
                <Trophy className="h-4 w-4 text-primary" />
                <span className="text-sm text-muted-foreground">Lifetime Points</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{everPoints.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Current tier: Silver</p>
              <p className="text-xs text-accent mt-1">Resets per season</p>
            </div>

            <div className="p-4 rounded-xl bg-surface/50 border border-primary/30">
              <div className="flex items-center gap-2 mb-1">
                <Diamond className="h-4 w-4 text-secondary" />
                <span className="text-sm text-muted-foreground">Current Points</span>
              </div>
              <p className="text-2xl font-bold text-secondary">{usablePoints.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Use for NFTs or conversion</p>
              <p className="text-xs text-accent mt-1">≈ {estimatedCAREL.toFixed(1)} CAREL</p>
            </div>

            <div className="p-3 rounded-lg bg-accent/10 border border-accent/20">
              <div className="flex items-start gap-2">
                <Sparkles className="h-4 w-4 text-accent flex-shrink-0 mt-0.5" />
                <p className="text-xs text-foreground">
                  Points decrease when minting NFTs. Earn more through trading volume!
                </p>
              </div>
            </div>

            <Button className="w-full bg-gradient-to-r from-primary to-accent hover:opacity-90 text-primary-foreground">
              Convert to CAREL <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      </div>

      {/* Current NFT Status */}
      {ownedNFT && ownedNFT.tier !== "None" && (
        <div className="mt-6 p-6 rounded-2xl glass border border-primary/50">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-foreground mb-1">Active NFT Discount</h3>
              <p className="text-sm text-muted-foreground">Your current fee discount NFT</p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-primary">{ownedNFT.discount}</p>
              <p className="text-sm text-muted-foreground">Fee Discount</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className="p-3 rounded-lg bg-surface/50">
              <p className="text-xs text-muted-foreground">NFT Tier</p>
              <p className="text-sm font-medium text-foreground">{ownedNFT.tier}</p>
            </div>
            <div className="p-3 rounded-lg bg-surface/50">
              <p className="text-xs text-muted-foreground">Uses Left</p>
              <p className="text-sm font-medium text-foreground">{ownedNFT.uses} / {ownedNFT.maxUses}</p>
            </div>
            <div className="p-3 rounded-lg bg-surface/50">
              <p className="text-xs text-muted-foreground">Status</p>
              <p className={cn(
                "text-sm font-medium",
                ownedNFT.uses > 0 ? "text-success" : "text-destructive"
              )}>
                {ownedNFT.uses > 0 ? "Active" : "Expired"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* NFT Gallery */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-foreground">NFT Discount System</h3>
          <div className="text-sm text-muted-foreground">
            Limited uses • Non-transferable
          </div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {nftTiers.map((nft) => (
            <NFTCard 
              key={nft.tier} 
              nft={nft.tier === ownedNFT?.tier ? ownedNFT : nft}
              isOwned={nft.tier === ownedNFT?.tier}
              onMint={() => handleMintNFT(nft)}
            />
          ))}
        </div>

        {/* How NFT System Works */}
        <div className="mt-6 p-6 rounded-2xl glass border border-border">
          <h4 className="font-bold text-foreground mb-4">How NFT Discount System Works</h4>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-primary">1</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Mint NFT with Points</p>
                  <p className="text-xs text-muted-foreground">Use your points to mint discount NFTs</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-primary">2</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Get Fee Discounts</p>
                  <p className="text-xs text-muted-foreground">Each transaction uses one count from your NFT</p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-primary">3</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Uses Depleted</p>
                  <p className="text-xs text-muted-foreground">After all uses, you return to None tier</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-primary">4</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Mint Again</p>
                  <p className="text-xs text-muted-foreground">Buy new NFTs with points to continue discounts</p>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 p-3 rounded-lg bg-secondary/10 border border-secondary/20">
            <p className="text-xs text-foreground flex items-start gap-2">
              <Shield className="h-4 w-4 text-secondary flex-shrink-0" />
              <span>All NFTs are non-transferable and bound to your wallet to prevent abuse. Points are earned from swap, bridge, limit order, and staking activities.</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
