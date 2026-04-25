import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { NFTItem } from "@/lib/api"
import type { NftTier } from "@/lib/rewards-config"

/**
 * Handles `NFTCard` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function NFTCard({
  nft,
  isOwned,
  isActive,
  ownedNft,
  isMinting,
  onMint,
}: {
  nft: NftTier
  isOwned: boolean
  isActive: boolean
  ownedNft?: NFTItem | null
  isMinting?: boolean
  onMint?: () => void
}) {
  const dynamicMaxUsage =
    typeof ownedNft?.max_usage === "number" && Number.isFinite(ownedNft.max_usage)
      ? Math.max(0, Math.floor(ownedNft.max_usage))
      : null
  const dynamicRemainingUsage =
    typeof ownedNft?.remaining_usage === "number" && Number.isFinite(ownedNft.remaining_usage)
      ? Math.max(0, Math.floor(ownedNft.remaining_usage))
      : null

  return (
    <div
      className={cn(
        "group relative p-4 rounded-2xl glass border transition-all duration-300 overflow-hidden",
        isOwned ? "border-primary/50" : "border-border"
      )}
    >
      {/* Non-transferable badge */}
      {isOwned && (
        <div className="absolute top-2 right-2 z-10">
          <span className="text-xs px-2 py-1 rounded-full bg-secondary/20 text-secondary border border-secondary/30">
            Non-transferable
          </span>
        </div>
      )}

      {/* Glow effect on hover */}
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

      {/* NFT Visual */}
      <div
        className={cn(
          "relative h-32 rounded-xl mb-3 flex items-center justify-center bg-gradient-to-br overflow-hidden",
          nft.gradient
        )}
      >
        <picture className="h-full w-full">
          <source srcSet={nft.image} type="image/svg+xml" />
          <img
            src={nft.fallbackImage || nft.image}
            alt={`${nft.name} artwork`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </picture>
        <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(to_top,rgba(0,0,0,0.35),transparent_60%)]" />

        {/* 3D effect border */}
        <div className="absolute inset-0 border-2 border-white/20 rounded-xl" />
      </div>

      <div className="relative z-10">
        <h3 className="font-bold text-foreground text-sm group-hover:text-primary transition-colors">
          {nft.name}
        </h3>
        <p className="text-xs text-muted-foreground mb-2">{nft.tier} Tier</p>

        {nft.maxUses > 0 && (
          <div className="mb-3 text-xs text-muted-foreground">
            {isOwned && dynamicMaxUsage !== null
              ? dynamicRemainingUsage !== null
                ? `Uses left: ${dynamicRemainingUsage}/${dynamicMaxUsage}`
                : `Max uses: ${dynamicMaxUsage}`
              : `Max uses: ${nft.maxUses}`}
          </div>
        )}
        {nft.rechargeCost > 0 && (
          <div className="mb-3 text-xs text-muted-foreground">
            Recharge cost: {nft.rechargeCost.toLocaleString()} pts
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
        {nft.tier !== "None" && (
          <Button
            size="sm"
            className="relative z-10 w-full bg-gradient-to-r from-primary to-accent hover:opacity-90 text-xs"
            onClick={onMint}
            disabled={isMinting}
          >
            {isMinting ? "Minting..." : isOwned ? "Mint Again" : "Mint On-chain"}
          </Button>
        )}
        {isOwned && isActive && (
          <div className="text-center py-2 px-3 rounded-lg bg-success/10 border border-success/20">
            <p className="text-xs font-medium text-success">Active</p>
          </div>
        )}
        {isOwned && !isActive && (
          <div className="text-center py-2 px-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <p className="text-xs font-medium text-amber-300">Owned (Inactive)</p>
          </div>
        )}
      </div>
    </div>
  )
}
