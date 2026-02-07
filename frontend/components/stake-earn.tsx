"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TrendingUp, Coins, Info, Clock, Check, AlertCircle, Wallet } from "lucide-react"

const stakingPools = [
  {
    symbol: "USDT",
    name: "Tether",
    icon: "₮",
    type: "Stablecoin",
    apy: "8.5",
    tvl: "2.4M",
    minStake: "100",
    lockPeriod: "Flexible",
    reward: "USDT",
    gradient: "from-green-400 to-emerald-600",
    userBalance: 5000,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    icon: "⭕",
    type: "Stablecoin",
    apy: "8.2",
    tvl: "1.8M",
    minStake: "100",
    lockPeriod: "Flexible",
    reward: "USDC",
    gradient: "from-blue-400 to-cyan-600",
    userBalance: 3000,
  },
  {
    symbol: "BTC",
    name: "Bitcoin",
    icon: "₿",
    type: "Crypto",
    apy: "5.5",
    tvl: "4.2M",
    minStake: "0.001",
    lockPeriod: "30 hari",
    reward: "BTC",
    gradient: "from-orange-400 to-amber-600",
    userBalance: 0.5,
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    icon: "Ξ",
    type: "Crypto",
    apy: "6.8",
    tvl: "3.1M",
    minStake: "0.01",
    lockPeriod: "30 hari",
    reward: "ETH",
    gradient: "from-purple-400 to-indigo-600",
    userBalance: 2.5,
  },
  {
    symbol: "STRK",
    name: "StarkNet",
    icon: "◈",
    type: "Crypto",
    apy: "12.5",
    tvl: "820K",
    minStake: "10",
    lockPeriod: "60 hari",
    reward: "STRK",
    gradient: "from-pink-400 to-rose-600",
    userBalance: 500,
  },
  {
    symbol: "CAREL",
    name: "ZkCarel",
    icon: "◐",
    type: "Crypto",
    apy: "15.0",
    tvl: "650K",
    minStake: "100",
    lockPeriod: "90 hari",
    reward: "CAREL",
    gradient: "from-violet-400 to-purple-600",
    userBalance: 1000,
  },
]

interface StakingPool {
  symbol: string
  name: string
  icon: string
  type: string
  apy: string
  tvl: string
  minStake: string
  lockPeriod: string
  reward: string
  gradient: string
  userBalance: number
}

interface StakingPosition {
  id: number
  pool: StakingPool
  amount: number
  stakedAt: string
  rewards: number
  status: "active" | "pending" | "unlocking"
}

export function StakeEarn() {
  const [selectedPool, setSelectedPool] = React.useState<StakingPool | null>(null)
  const [stakeDialogOpen, setStakeDialogOpen] = React.useState(false)
  const [stakeAmount, setStakeAmount] = React.useState("")
  const [isStaking, setIsStaking] = React.useState(false)
  const [stakeSuccess, setStakeSuccess] = React.useState(false)
  const [positions, setPositions] = React.useState<StakingPosition[]>([
    {
      id: 1,
      pool: stakingPools[0],
      amount: 1000,
      stakedAt: "5 hari lalu",
      rewards: 1.16,
      status: "active"
    },
    {
      id: 2,
      pool: stakingPools[3],
      amount: 0.5,
      stakedAt: "12 hari lalu",
      rewards: 0.0028,
      status: "active"
    }
  ])

  const handleStake = (pool: StakingPool) => {
    setSelectedPool(pool)
    setStakeAmount("")
    setStakeSuccess(false)
    setStakeDialogOpen(true)
  }

  const handleAmountPreset = (percent: number) => {
    if (selectedPool) {
      const amount = selectedPool.userBalance * percent / 100
      setStakeAmount(amount.toString())
    }
  }

  const confirmStake = async () => {
    if (!selectedPool) return
    
    setIsStaking(true)
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    const newPosition: StakingPosition = {
      id: positions.length + 1,
      pool: selectedPool,
      amount: Number.parseFloat(stakeAmount),
      stakedAt: "Baru saja",
      rewards: 0,
      status: "active"
    }
    
    setPositions([newPosition, ...positions])
    setIsStaking(false)
    setStakeSuccess(true)
  }

  const handleUnstake = (positionId: number) => {
    setPositions(positions.map(p => 
      p.id === positionId ? { ...p, status: "unlocking" as const } : p
    ))
    // Simulate unstake after delay
    setTimeout(() => {
      setPositions(positions.filter(p => p.id !== positionId))
    }, 2000)
  }

  const handleClaimRewards = (positionId: number) => {
    setPositions(positions.map(p => 
      p.id === positionId ? { ...p, rewards: 0 } : p
    ))
  }

  const totalStaked = positions.reduce((acc, p) => {
    const price = p.pool.symbol === "BTC" ? 65000 : p.pool.symbol === "ETH" ? 2450 : 1
    return acc + (p.amount * price)
  }, 0)

  const totalRewards = positions.reduce((acc, p) => {
    const price = p.pool.symbol === "BTC" ? 65000 : p.pool.symbol === "ETH" ? 2450 : 1
    return acc + (p.rewards * price)
  }, 0)

  return (
    <section id="stake" className="py-12">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/20 border border-primary/30 mb-4">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-primary">Testnet Active</span>
          </div>
          <h2 className="text-3xl font-bold text-foreground mb-2">Stake & Earn</h2>
          <p className="text-muted-foreground">Dapatkan passive income dari aset crypto Anda</p>
        </div>

        {/* Stats */}
        <div className="grid md:grid-cols-4 gap-6 mb-8">
          <div className="p-6 rounded-xl glass border border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">Total Value Locked</p>
            </div>
            <p className="text-2xl font-bold text-foreground">$13.0M</p>
            <p className="text-xs text-success mt-1">+12.4% bulan ini</p>
          </div>

          <div className="p-6 rounded-xl glass border border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-secondary/20 flex items-center justify-center">
                <Coins className="h-5 w-5 text-secondary" />
              </div>
              <p className="text-sm text-muted-foreground">Staker Aktif</p>
            </div>
            <p className="text-2xl font-bold text-foreground">4,238</p>
            <p className="text-xs text-success mt-1">+8.2% minggu ini</p>
          </div>

          <div className="p-6 rounded-xl glass border border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-accent" />
              </div>
              <p className="text-sm text-muted-foreground">Total Staked Anda</p>
            </div>
            <p className="text-2xl font-bold text-foreground">${totalStaked.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">{positions.length} posisi aktif</p>
          </div>

          <div className="p-6 rounded-xl glass border border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-success" />
              </div>
              <p className="text-sm text-muted-foreground">Total Rewards</p>
            </div>
            <p className="text-2xl font-bold text-success">${totalRewards.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground mt-1">Siap diklaim</p>
          </div>
        </div>

        {/* Info Banner */}
        <div className="mb-8 p-4 rounded-xl bg-secondary/10 border border-secondary/20">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-secondary flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Mode Testnet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Staking menggunakan token testnet. Rewards dihitung secara simulasi dan tidak menggunakan dana riil.
              </p>
            </div>
          </div>
        </div>

        {/* Staking Pools */}
        <div className="space-y-6">
          {/* Stablecoins Section */}
          <div>
            <h3 className="text-lg font-bold text-foreground mb-4">Stablecoins</h3>
            <div className="grid md:grid-cols-2 gap-4">
              {stakingPools
                .filter((pool) => pool.type === "Stablecoin")
                .map((pool) => (
                  <StakingCard key={pool.symbol} pool={pool} onStake={() => handleStake(pool)} />
                ))}
            </div>
          </div>

          {/* Cryptocurrencies Section */}
          <div>
            <h3 className="text-lg font-bold text-foreground mb-4">Cryptocurrencies</h3>
            <div className="grid md:grid-cols-2 gap-4">
              {stakingPools
                .filter((pool) => pool.type === "Crypto")
                .map((pool) => (
                  <StakingCard key={pool.symbol} pool={pool} onStake={() => handleStake(pool)} />
                ))}
            </div>
          </div>
        </div>

        {/* Your Staking Positions */}
        <div className="mt-12 p-6 rounded-2xl glass-strong border border-border">
          <h3 className="text-lg font-bold text-foreground mb-4">Posisi Staking Anda</h3>
          
          {positions.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-full bg-muted/20 flex items-center justify-center mx-auto mb-4">
                <Clock className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground">Belum ada posisi staking</p>
              <p className="text-sm text-muted-foreground mt-2">
                Stake token Anda untuk mulai mendapatkan rewards
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {positions.map((position) => (
                <div key={position.id} className="p-4 rounded-xl bg-surface/50 border border-border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center",
                        position.pool.gradient
                      )}>
                        <span className="text-xl text-white">{position.pool.icon}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-foreground">{position.pool.symbol}</h4>
                          <span className={cn(
                            "px-2 py-0.5 text-xs rounded-full",
                            position.status === "active" ? "bg-success/20 text-success" :
                            position.status === "unlocking" ? "bg-secondary/20 text-secondary" :
                            "bg-muted/20 text-muted-foreground"
                          )}>
                            {position.status === "active" ? "Aktif" : 
                             position.status === "unlocking" ? "Unlocking..." : "Pending"}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {position.amount} {position.pool.symbol} staked
                        </p>
                        <p className="text-xs text-muted-foreground">{position.stakedAt}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">APY</p>
                        <p className="text-lg font-bold text-success">{position.pool.apy}%</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Rewards</p>
                        <p className="text-lg font-bold text-foreground">
                          {position.rewards.toFixed(4)} {position.pool.symbol}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {position.rewards > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleClaimRewards(position.id)}
                            className="text-success border-success/30 hover:bg-success/10"
                          >
                            Klaim
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleUnstake(position.id)}
                          disabled={position.status === "unlocking"}
                          className="text-muted-foreground"
                        >
                          {position.status === "unlocking" ? "Unlocking..." : "Unstake"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Stake Dialog */}
      <Dialog open={stakeDialogOpen} onOpenChange={setStakeDialogOpen}>
        <DialogContent className="max-w-md glass-strong border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedPool && (
                <>
                  <div className={cn(
                    "w-8 h-8 rounded-full bg-gradient-to-br flex items-center justify-center",
                    selectedPool.gradient
                  )}>
                    <span className="text-lg text-white">{selectedPool.icon}</span>
                  </div>
                  Stake {selectedPool.symbol}
                </>
              )}
            </DialogTitle>
          </DialogHeader>

          {stakeSuccess ? (
            <div className="py-8 text-center">
              <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
                <Check className="h-8 w-8 text-success" />
              </div>
              <p className="text-lg font-medium text-foreground">Staking Berhasil!</p>
              <p className="text-sm text-muted-foreground mt-2">
                {stakeAmount} {selectedPool?.symbol} telah di-stake
              </p>
              <Button
                onClick={() => setStakeDialogOpen(false)}
                className="mt-4"
              >
                Tutup
              </Button>
            </div>
          ) : (
            <Tabs defaultValue="stake">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="stake">Stake</TabsTrigger>
                <TabsTrigger value="info">Info Pool</TabsTrigger>
              </TabsList>

              <TabsContent value="stake" className="space-y-4">
                {selectedPool && (
                  <>
                    <div className="p-4 rounded-xl bg-surface/50 border border-border">
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-muted-foreground">APY</span>
                        <span className="text-lg font-bold text-success">{selectedPool.apy}%</span>
                      </div>
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-muted-foreground">Lock Period</span>
                        <span className="text-sm font-medium text-foreground">{selectedPool.lockPeriod}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Min. Stake</span>
                        <span className="text-sm font-medium text-foreground">{selectedPool.minStake} {selectedPool.symbol}</span>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between mb-2">
                        <label className="text-sm font-medium text-foreground">Jumlah</label>
                        <span className="text-xs text-muted-foreground">
                          Saldo: {selectedPool.userBalance.toLocaleString()} {selectedPool.symbol}
                        </span>
                      </div>
                      <input
                        type="number"
                        value={stakeAmount}
                        onChange={(e) => setStakeAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                      <div className="flex gap-2 mt-2">
                        {[25, 50, 75, 100].map((percent) => (
                          <button
                            key={percent}
                            onClick={() => handleAmountPreset(percent)}
                            className="flex-1 px-2 py-1 text-xs rounded-md bg-surface text-muted-foreground hover:text-foreground hover:bg-surface/80 transition-colors"
                          >
                            {percent}%
                          </button>
                        ))}
                      </div>
                    </div>

                    {Number.parseFloat(stakeAmount) > 0 && (
                      <div className="p-3 rounded-lg bg-success/10 border border-success/20">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Estimasi Reward/Bulan</span>
                          <span className="font-medium text-success">
                            {(Number.parseFloat(stakeAmount) * Number.parseFloat(selectedPool.apy) / 100 / 12).toFixed(4)} {selectedPool.symbol}
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="p-3 rounded-lg bg-secondary/10 border border-secondary/20">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-secondary flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-foreground">
                          Token testnet. Rewards dihitung secara simulasi.
                        </p>
                      </div>
                    </div>

                    <Button
                      onClick={confirmStake}
                      disabled={!stakeAmount || Number.parseFloat(stakeAmount) < Number.parseFloat(selectedPool.minStake) || isStaking}
                      className="w-full bg-primary hover:bg-primary/90"
                    >
                      {isStaking ? "Memproses..." : `Stake ${selectedPool.symbol}`}
                    </Button>
                  </>
                )}
              </TabsContent>

              <TabsContent value="info" className="space-y-4">
                {selectedPool && (
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-surface/50 border border-border">
                      <h4 className="font-medium text-foreground mb-3">Detail Pool</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Total Value Locked</span>
                          <span className="text-sm font-medium text-foreground">${selectedPool.tvl}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">APY</span>
                          <span className="text-sm font-medium text-success">{selectedPool.apy}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Lock Period</span>
                          <span className="text-sm font-medium text-foreground">{selectedPool.lockPeriod}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Min. Stake</span>
                          <span className="text-sm font-medium text-foreground">{selectedPool.minStake} {selectedPool.symbol}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Reward Token</span>
                          <span className="text-sm font-medium text-foreground">{selectedPool.reward}</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-surface/50 border border-border">
                      <h4 className="font-medium text-foreground mb-3">Cara Kerja</h4>
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        <li className="flex items-start gap-2">
                          <span className="text-primary">1.</span>
                          Stake token Anda ke pool
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-primary">2.</span>
                          Rewards terakumulasi setiap blok
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-primary">3.</span>
                          Klaim rewards kapan saja
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-primary">4.</span>
                          Unstake setelah lock period selesai
                        </li>
                      </ul>
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}

function StakingCard({ pool, onStake }: { pool: StakingPool; onStake: () => void }) {
  return (
    <div className="p-6 rounded-xl glass border border-border hover:border-primary/30 transition-all group">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={cn("w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center", pool.gradient)}>
            <span className="text-2xl text-white">{pool.icon}</span>
          </div>
          <div>
            <h4 className="font-bold text-foreground">{pool.symbol}</h4>
            <p className="text-sm text-muted-foreground">{pool.name}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">APY</p>
          <p className="text-2xl font-bold text-success">{pool.apy}%</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <p className="text-xs text-muted-foreground">TVL</p>
          <p className="text-sm font-medium text-foreground">${pool.tvl}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Min. Stake</p>
          <p className="text-sm font-medium text-foreground">
            {pool.minStake} {pool.symbol}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Lock Period</p>
          <p className="text-sm font-medium text-foreground">{pool.lockPeriod}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Saldo Anda</p>
          <p className="text-sm font-medium text-foreground">{pool.userBalance.toLocaleString()}</p>
        </div>
      </div>

      <Button
        onClick={onStake}
        className="w-full bg-primary hover:bg-primary/90"
      >
        Stake {pool.symbol}
      </Button>
    </div>
  )
}
