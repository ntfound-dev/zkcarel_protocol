"use client"

import type { WalletContextType } from "@/hooks/wallet/use-wallet"
import * as React from "react"
import {
  getNftMintStatus,
  mintNft,
  syncRewardsPointsOnchain,
  verifySocialTask,
  type NFTItem,
} from "@/lib/api"
import { invokeStarknetCallFromWallet } from "@/lib/onchain-trade"
import { STARKNET_DISCOUNT_SOULBOUND_ADDRESS, type NftTier } from "@/lib/rewards-config"

type WalletContext = WalletContextType
type NotificationsContext = ReturnType<typeof import("@/hooks/notifications/use-notifications").useNotifications>

type UseRewardsActionsParams = {
  wallet: WalletContext
  notifications: NotificationsContext
  usablePoints: number
  setUsablePoints: React.Dispatch<React.SetStateAction<number>>
  setOwnedNfts: React.Dispatch<React.SetStateAction<NFTItem[]>>
  refreshRewardsPoints: () => Promise<void>
}

type TaskStatus = Record<
  string,
  {
    status: "idle" | "verifying" | "success" | "error"
    message?: string
    points?: number
  }
>

export function useRewardsActions({
  wallet,
  notifications,
  usablePoints,
  setUsablePoints,
  setOwnedNfts,
  refreshRewardsPoints,
}: UseRewardsActionsParams) {
  const [isMintingTier, setIsMintingTier] = React.useState<number | null>(null)
  const [taskInputs, setTaskInputs] = React.useState<Record<string, string>>({})
  const [taskStatus, setTaskStatus] = React.useState<TaskStatus>({})
  const starknetProviderHint = React.useMemo<"starknet" | "argentx" | "braavos">(() => {
    if (wallet.provider === "argentx" || wallet.provider === "braavos") {
      return wallet.provider
    }
    return "starknet"
  }, [wallet.provider])

  /**
   * Handles `handleMintNFT` logic.
   *
   * @param nft - Input used by `handleMintNFT` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleMintNFT = async (nft: NftTier) => {
    if (nft.tierId === 0) return
    if (!wallet.isConnected) {
      notifications.addNotification({
        type: "error",
        title: "Wallet not connected",
        message: "Connect Starknet wallet before minting NFT.",
      })
      return
    }
    if (usablePoints < nft.cost) {
      notifications.addNotification({
        type: "error",
        title: "Insufficient points",
        message: "Your points are not enough to mint this NFT.",
      })
      return
    }

    try {
      setIsMintingTier(nft.tierId)
      if (!STARKNET_DISCOUNT_SOULBOUND_ADDRESS) {
        throw new Error(
          "NEXT_PUBLIC_STARKNET_DISCOUNT_SOULBOUND_ADDRESS is not set. Configure NFT discount contract address in frontend/.env.local."
        )
      }
      notifications.addNotification({
        type: "info",
        title: "Syncing points",
        message: "Syncing backend points to on-chain PointStorage...",
      })
      const syncResult = await syncRewardsPointsOnchain({ minimum_points: nft.cost })
      if (syncResult.onchain_points_after < nft.cost) {
        throw new Error(
          `On-chain points are insufficient for mint. Required ${nft.cost.toLocaleString()}, on-chain ${Math.floor(syncResult.onchain_points_after).toLocaleString()}.`
        )
      }
      if (syncResult.sync_tx_hash) {
        notifications.addNotification({
          type: "success",
          title: "Points synced on-chain",
          message: `On-chain points ready: ${Math.floor(syncResult.onchain_points_after).toLocaleString()} pts.`,
          txHash: syncResult.sync_tx_hash,
          txNetwork: "starknet",
        })
      }
      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message: "Confirm mint NFT transaction in your Starknet wallet.",
      })
      const onchainTxHash = await invokeStarknetCallFromWallet(
        {
          contractAddress: STARKNET_DISCOUNT_SOULBOUND_ADDRESS,
          entrypoint: "mint_nft",
          calldata: [nft.tierId],
        },
        starknetProviderHint
      )
      const minted = await mintNft({ tier: nft.tierId, onchain_tx_hash: onchainTxHash })
      if (minted && typeof minted === "object" && "status" in minted) {
        if (minted.status === "pending") {
          notifications.addNotification({
            type: "info",
            title: "Mint pending",
            message: "Transaction is pending confirmation on Starknet. We will keep checking.",
            txHash: onchainTxHash,
            txNetwork: "starknet",
          })

          const waitForConfirmation = async () => {
            for (let attempt = 0; attempt < 20; attempt += 1) {
              try {
                const status = await getNftMintStatus(onchainTxHash)
                if (status.status === "confirmed") {
                  if (status.nft) {
                    setOwnedNfts((prev) => [status.nft!, ...prev])
                  }
                  setUsablePoints((prev) => Math.max(0, prev - nft.cost))
                  notifications.addNotification({
                    type: "success",
                    title: "NFT minted",
                    message: `NFT tier ${nft.tier} minted successfully.`,
                    txHash: onchainTxHash,
                    txNetwork: "starknet",
                  })
                  return
                }
                if (status.status === "failed") {
                  notifications.addNotification({
                    type: "error",
                    title: "Mint failed",
                    message: status.message || "Mint transaction failed on-chain.",
                    txHash: onchainTxHash,
                    txNetwork: "starknet",
                  })
                  return
                }
              } catch {
                // Ignore transient polling errors.
              }
              await new Promise((resolve) => setTimeout(resolve, 4000))
            }

            notifications.addNotification({
              type: "info",
              title: "Still pending",
              message:
                "Mint transaction is still pending. You can refresh later or check the NFT status page.",
              txHash: onchainTxHash,
              txNetwork: "starknet",
            })
          }

          void waitForConfirmation()
          return
        }

        if (minted.status === "confirmed") {
          if (minted.nft) {
            setOwnedNfts((prev) => [minted.nft!, ...prev])
          }
          setUsablePoints((prev) => Math.max(0, prev - nft.cost))
          notifications.addNotification({
            type: "success",
            title: "NFT minted",
            message: `NFT tier ${nft.tier} minted successfully.`,
            txHash: onchainTxHash,
            txNetwork: "starknet",
          })
          return
        }

        notifications.addNotification({
          type: "error",
          title: "Mint failed",
          message: minted.message || "Mint transaction failed on-chain.",
          txHash: onchainTxHash,
          txNetwork: "starknet",
        })
        return
      }

      setOwnedNfts((prev) => [minted, ...prev])
      setUsablePoints((prev) => Math.max(0, prev - nft.cost))
      notifications.addNotification({
        type: "success",
        title: "NFT minted",
        message: `NFT tier ${nft.tier} minted successfully.`,
        txHash: onchainTxHash,
        txNetwork: "starknet",
      })
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Failed to mint NFT."
      let normalizedMessage = rawMessage
      if (/already has nft|already minted/i.test(rawMessage)) {
        normalizedMessage =
          "Active NFT contract is still single-mint mode. Deploy unlimited-mint version for repeated mints."
      } else if (/invalid felt hex|representative out of range/i.test(rawMessage)) {
        normalizedMessage =
          "Backend on-chain signer is invalid. Points sync failed before wallet signature. Check BACKEND_PRIVATE_KEY/BACKEND_ACCOUNT_ADDRESS and restart backend."
      }
      notifications.addNotification({
        type: "error",
        title: "Mint failed",
        message: normalizedMessage,
      })
    } finally {
      setIsMintingTier(null)
    }
  }

  /**
   * Handles `handleVerifyTask` logic.
   *
   * @param taskId - Input used by `handleVerifyTask` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleVerifyTask = async (taskId: string) => {
    const proof = taskInputs[taskId]
    if (!proof) return
    setTaskStatus((prev) => ({
      ...prev,
      [taskId]: { status: "verifying" },
    }))
    try {
      const result = await verifySocialTask({ task_type: taskId, proof })
      setTaskStatus((prev) => ({
        ...prev,
        [taskId]: {
          status: result.verified ? "success" : "error",
          message: result.message,
          points: result.points_earned,
        },
      }))
      if (result.verified) {
        await refreshRewardsPoints()
      }
      notifications.addNotification({
        type: result.verified ? "success" : "error",
        title: "Social task",
        message: result.message,
      })
    } catch (error) {
      setTaskStatus((prev) => ({
        ...prev,
        [taskId]: {
          status: "error",
          message: error instanceof Error ? error.message : "Verification failed",
        },
      }))
      notifications.addNotification({
        type: "error",
        title: "Social task",
        message: error instanceof Error ? error.message : "Verification failed",
      })
    }
  }

  return {
    isMintingTier,
    handleMintNFT,
    taskInputs,
    setTaskInputs,
    taskStatus,
    handleVerifyTask,
  }
}
