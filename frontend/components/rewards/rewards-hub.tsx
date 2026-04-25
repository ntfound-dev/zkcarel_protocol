"use client"
import { cn } from "@/lib/utils"
import { Gift, Diamond, Trophy, Sparkles, ArrowRight, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWallet } from "@/hooks/wallet/use-wallet"
import { useNotifications } from "@/hooks/notifications/use-notifications"
import { nftTiers, SOCIAL_TASKS_COMING_SOON } from "@/lib/rewards-config"
import { TierProgressBar } from "@/components/rewards/tier-progress-bar"
import { NFTCard } from "@/components/rewards/nft-card"
import { useRewardsData } from "@/hooks/rewards/use-rewards-data"
import { useRewardsActions } from "@/hooks/rewards/use-rewards-actions"

/**
 * Handles `RewardsHub` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function RewardsHub() {
  const wallet = useWallet()
  const notifications = useNotifications()
  const {
    usablePoints,
    everPoints,
    estimatedCAREL,
    socialTasks,
    currentEpoch,
    convertEpoch,
    setConvertEpoch,
    convertDistribution,
    setConvertDistribution,
    showAdvancedConvert,
    setShowAdvancedConvert,
    distributionLabel,
    distributionPoolLabel,
    claimFeeLabel,
    activeOwnedNft,
    activeNftTier,
    tiers,
    currentTierName,
    ownedNftByTier,
    setOwnedNfts,
    setUsablePoints,
    refreshRewardsPoints,
  } = useRewardsData({ wallet })
  const {
    isMintingTier,
    handleMintNFT,
    taskInputs,
    setTaskInputs,
    taskStatus,
    handleVerifyTask,
  } = useRewardsActions({
    wallet,
    notifications,
    usablePoints,
    setUsablePoints,
    setOwnedNfts,
    refreshRewardsPoints,
  })

  /**
   * Handles `handleConvert` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleConvert = async () => {
    notifications.addNotification({
      type: "info",
      title: "Coming Soon",
      message: "Convert Points to CAREL feature will be available soon.",
    })
  }

  /**
   * Handles `handleClaim` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleClaim = async () => {
    notifications.addNotification({
      type: "info",
      title: "Coming Soon",
      message: "Claim Rewards feature will be available soon.",
    })
  }

  return (
    <section id="rewards" className="py-12">
      <div className="flex items-center gap-3 mb-6">
        <Gift className="h-6 w-6 text-primary" />
        <h2 className="text-2xl font-bold text-foreground">Loyalty Hub</h2>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Tier Progression */}
        <div className="lg:col-span-2">
          <TierProgressBar
            currentPoints={usablePoints}
            currentTierId={activeNftTier?.tierId ?? 0}
            tiers={tiers}
          />
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
              <p className="text-xs text-muted-foreground">Current tier: {currentTierName}</p>
              <p className="text-xs text-accent mt-1">Resets per season</p>
            </div>

            <div className="p-4 rounded-xl bg-surface/50 border border-primary/30">
              <div className="flex items-center gap-2 mb-1">
                <Diamond className="h-4 w-4 text-secondary" />
                <span className="text-sm text-muted-foreground">Current Points</span>
              </div>
              <p className="text-2xl font-bold text-secondary">{usablePoints.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Use for NFTs or conversion</p>
              <p className="text-xs text-muted-foreground">
                {distributionLabel}: {distributionPoolLabel} CAREL
              </p>
              <p className="text-xs text-muted-foreground">{claimFeeLabel}</p>
              <p className="text-xs text-accent mt-1">
                Estimated reward: ≈ {estimatedCAREL.toFixed(2)} CAREL
              </p>
              <p className="text-xs text-muted-foreground">
                Estimation uses global epoch points and your linked-wallet points aggregate.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-accent/10 border border-accent/20">
              <div className="flex items-start gap-2">
                <Sparkles className="h-4 w-4 text-accent flex-shrink-0 mt-0.5" />
                <p className="text-xs text-foreground">
                  Points decrease when minting NFTs. Earn more through trading volume!
                </p>
              </div>
            </div>

            <div className="grid gap-2">
              <button
                onClick={() => setShowAdvancedConvert((prev) => !prev)}
                className="text-xs text-muted-foreground text-left"
              >
                {showAdvancedConvert ? "Hide advanced convert" : "Advanced convert (epoch/distribution)"}
              </button>
              {showAdvancedConvert && (
                <div className="grid gap-2 p-3 rounded-lg bg-surface/50 border border-border">
                  <div>
                    <label className="text-xs text-muted-foreground">Epoch</label>
                    <input
                      type="number"
                      value={convertEpoch}
                      onChange={(e) => setConvertEpoch(e.target.value)}
                      placeholder={currentEpoch ? String(currentEpoch) : "0"}
                      className="w-full mt-1 px-3 py-2 rounded-lg bg-surface border border-border text-foreground text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Total distribution (CAREL)</label>
                    <input
                      type="number"
                      value={convertDistribution}
                      onChange={(e) => setConvertDistribution(e.target.value)}
                      placeholder="Optional"
                      className="w-full mt-1 px-3 py-2 rounded-lg bg-surface border border-border text-foreground text-sm"
                    />
                  </div>
                </div>
              )}
              <Button
                onClick={handleConvert}
                disabled={usablePoints <= 0}
                className="w-full bg-gradient-to-r from-primary to-accent hover:opacity-90 text-primary-foreground"
              >
                Convert to CAREL (Coming Soon) <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
              <Button onClick={handleClaim} variant="outline" className="w-full bg-transparent">
                Claim Rewards (Coming Soon)
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Current NFT Status */}
      {activeNftTier && activeOwnedNft && (
        <div className="mt-6 p-6 rounded-2xl glass border border-primary/50">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-foreground mb-1">Active NFT Discount</h3>
              <p className="text-sm text-muted-foreground">Your current fee discount NFT</p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-primary">{activeOwnedNft.discount}%</p>
              <p className="text-sm text-muted-foreground">Fee Discount</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-4">
            <div className="p-3 rounded-lg bg-surface/50">
              <p className="text-xs text-muted-foreground">NFT Tier</p>
              <p className="text-sm font-medium text-foreground">{activeNftTier.tier}</p>
            </div>
            <div className="p-3 rounded-lg bg-surface/50">
              <p className="text-xs text-muted-foreground">Expiry</p>
              <p className="text-sm font-medium text-foreground">
                {activeOwnedNft.expiry
                  ? new Date(activeOwnedNft.expiry * 1000).toLocaleDateString("id-ID")
                  : "—"}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-surface/50">
              <p className="text-xs text-muted-foreground">Status</p>
              <p
                className={cn(
                  "text-sm font-medium",
                  activeOwnedNft.used ? "text-destructive" : "text-success"
                )}
              >
                {activeOwnedNft.used ? "Expired" : "Active"}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-surface/50">
              <p className="text-xs text-muted-foreground">Usage Left</p>
              <p className="text-sm font-medium text-foreground">
                {typeof activeOwnedNft.remaining_usage === "number" &&
                typeof activeOwnedNft.max_usage === "number"
                  ? `${Math.max(0, Math.floor(activeOwnedNft.remaining_usage))}/${Math.max(
                      0,
                      Math.floor(activeOwnedNft.max_usage)
                    )}`
                  : "—"}
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
            Limited uses • Non-transferable • Auto inactive when depleted
          </div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {nftTiers.map((nft) => {
            const ownedNft = ownedNftByTier.get(nft.tierId) || null
            return (
              <NFTCard
                key={nft.tier}
                nft={nft}
                isOwned={Boolean(ownedNft)}
                isActive={(activeNftTier?.tierId ?? 0) === nft.tierId}
                ownedNft={ownedNft}
                isMinting={isMintingTier === nft.tierId}
                onMint={() => handleMintNFT(nft)}
              />
            )
          })}
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
                  <p className="text-xs text-muted-foreground">
                    Mint on-chain. Points are consumed by contract logic.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-primary">2</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Get Fee Discounts</p>
                  <p className="text-xs text-muted-foreground">
                    Each eligible transaction consumes NFT usage quota
                  </p>
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
                  <p className="text-xs text-muted-foreground">
                    NFT stays owned but automatically becomes inactive when usage quota is exhausted
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-primary">4</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Mint Again Anytime</p>
                  <p className="text-xs text-muted-foreground">
                    Unlimited mint is allowed as long as point requirement is met
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 p-3 rounded-lg bg-secondary/10 border border-secondary/20">
            <p className="text-xs text-foreground flex items-start gap-2">
              <Shield className="h-4 w-4 text-secondary flex-shrink-0" />
              <span>
                All NFTs are non-transferable and bound to your wallet to prevent abuse. Points
                are earned from swap, bridge, limit order, and staking activities.
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Social Tasks */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-foreground">Social Tasks</h3>
          <div className="flex items-center gap-2">
            <div className="text-sm text-muted-foreground">Earn bonus points</div>
            {SOCIAL_TASKS_COMING_SOON && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide border border-amber-400/40 bg-amber-400/10 text-amber-300">
                Coming Soon
              </span>
            )}
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {socialTasks.map((task) => {
            const status = taskStatus[task.id]?.status || "idle"
            return (
              <div key={task.id} className="p-4 rounded-2xl glass border border-border">
                <h4 className="font-medium text-foreground mb-1">{task.title}</h4>
                <p className="text-xs text-muted-foreground mb-3">{task.description}</p>
                {SOCIAL_TASKS_COMING_SOON ? (
                  <div className="space-y-2">
                    <div className="px-3 py-2 rounded-lg bg-surface border border-border text-xs text-muted-foreground">
                      {task.placeholder}
                    </div>
                    <Button disabled className="w-full">
                      Coming Soon
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <input
                        value={taskInputs[task.id] || ""}
                        onChange={(e) =>
                          setTaskInputs((prev) => ({ ...prev, [task.id]: e.target.value }))
                        }
                        placeholder={task.placeholder}
                        className="flex-1 px-3 py-2 rounded-lg bg-surface border border-border text-foreground text-xs"
                      />
                      <Button
                        onClick={() => handleVerifyTask(task.id)}
                        disabled={status === "verifying" || !(taskInputs[task.id] || "").trim()}
                      >
                        {status === "verifying" ? "Verifying..." : "Verify"}
                      </Button>
                    </div>
                    {taskStatus[task.id]?.message && (
                      <p
                        className={cn(
                          "text-xs mt-2",
                          status === "success"
                            ? "text-success"
                            : status === "error"
                            ? "text-destructive"
                            : "text-muted-foreground"
                        )}
                      >
                        {taskStatus[task.id]?.message}
                      </p>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
