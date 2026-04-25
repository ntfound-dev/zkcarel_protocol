"use client"

import * as React from "react"
import type { PendingBtcDepositState } from "@/lib/trading-types"
import type { useNotifications } from "@/hooks/notifications/use-notifications"
import type { WalletContextType } from "@/hooks/wallet/use-wallet"
import { getGardenOrderInstantRefundHash } from "@/lib/api"
import { broadcastBtcRawTransaction } from "@/lib/trading-utils"

type UseBtcActionsParams = {
  pendingBtcDeposit: PendingBtcDepositState | null
  notifications: ReturnType<typeof useNotifications>
  wallet: WalletContextType
  setPendingBtcDeposit: React.Dispatch<React.SetStateAction<PendingBtcDepositState | null>>
  setIsSendingBtcDeposit: React.Dispatch<React.SetStateAction<boolean>>
  setIsClaimingRefund: React.Dispatch<React.SetStateAction<boolean>>
  pollGardenBridgeOrder: (bridgeId: string, destinationChain: string) => void
  lastGardenOrderStatusRef: React.MutableRefObject<Record<string, string>>
}

export function useBtcActions({
  pendingBtcDeposit,
  notifications,
  wallet,
  setPendingBtcDeposit,
  setIsSendingBtcDeposit,
  setIsClaimingRefund,
  pollGardenBridgeOrder,
  lastGardenOrderStatusRef,
}: UseBtcActionsParams) {
  const handleSendBtcDepositFromWallet = React.useCallback(async () => {
    if (!pendingBtcDeposit) return
    if (pendingBtcDeposit.amountSats <= 0) {
      notifications.addNotification({
        type: "warning",
        title: "Invalid BTC amount",
        message: "Deposit amount from order is invalid. Create a new bridge order.",
      })
      return
    }

    setIsSendingBtcDeposit(true)
    try {
      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message: "Approve BTC transfer in UniSat/Xverse popup.",
      })
      const txHash = await wallet.sendBtcTransaction(
        pendingBtcDeposit.depositAddress,
        pendingBtcDeposit.amountSats
      )
      setPendingBtcDeposit((prev) =>
        prev
          ? {
              ...prev,
              txHash,
              status: "processing",
              lastUpdatedAt: Date.now(),
            }
          : prev
      )
      lastGardenOrderStatusRef.current[pendingBtcDeposit.bridgeId] = "processing"
      notifications.addNotification({
        type: "success",
        title: "BTC deposit submitted",
        message: `Deposit tx ${txHash.slice(0, 12)}... sent to Garden address.`,
        txHash,
        txNetwork: "btc",
      })
      void pollGardenBridgeOrder(pendingBtcDeposit.bridgeId, pendingBtcDeposit.destinationChain)
      await wallet.refreshOnchainBalances()
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Send BTC failed",
        message: error instanceof Error ? error.message : "Failed to send BTC deposit transaction.",
      })
    } finally {
      setIsSendingBtcDeposit(false)
    }
  }, [
    lastGardenOrderStatusRef,
    notifications,
    pendingBtcDeposit,
    pollGardenBridgeOrder,
    setIsSendingBtcDeposit,
    setPendingBtcDeposit,
    wallet,
  ])

  const handleClaimInstantRefund = React.useCallback(async () => {
    if (!pendingBtcDeposit) return
    setIsClaimingRefund(true)
    try {
      const orderLabel = pendingBtcDeposit.bridgeId.slice(0, 10)
      const instantRefundTx = (pendingBtcDeposit.instantRefundTx || "").trim()

      if (instantRefundTx) {
        notifications.addNotification({
          type: "info",
          title: "Broadcasting refund tx",
          message: `Broadcasting instant refund tx for order ${orderLabel}...`,
        })
        const refundTxHash = await broadcastBtcRawTransaction(instantRefundTx)
        setPendingBtcDeposit((prev) =>
          prev && prev.bridgeId === pendingBtcDeposit.bridgeId
            ? {
                ...prev,
                status: "refunded",
                refundTxHash,
                lastUpdatedAt: Date.now(),
              }
            : prev
        )
        notifications.addNotification({
          type: "success",
          title: "Refund submitted",
          message: `Refund tx ${refundTxHash.slice(0, 12)}... broadcast successfully.`,
          txHash: refundTxHash,
          txNetwork: "btc",
        })
        await wallet.refreshOnchainBalances()
        void pollGardenBridgeOrder(pendingBtcDeposit.bridgeId, pendingBtcDeposit.destinationChain)
        return
      }

      const refundResponse = await getGardenOrderInstantRefundHash(pendingBtcDeposit.bridgeId)
      const instantRefundHash =
        typeof refundResponse?.result === "string" ? refundResponse.result.trim() : ""
      if (!instantRefundHash) {
        throw new Error("Garden did not return an instant refund hash for this order.")
      }
      let copied = false
      try {
        await navigator.clipboard.writeText(instantRefundHash)
        copied = true
      } catch {
        copied = false
      }
      setPendingBtcDeposit((prev) =>
        prev && prev.bridgeId === pendingBtcDeposit.bridgeId
          ? {
              ...prev,
              instantRefundHash,
              lastUpdatedAt: Date.now(),
            }
          : prev
      )
      notifications.addNotification({
        type: "info",
        title: "Instant refund hash ready",
        message: copied
          ? `Refund hash for order ${orderLabel}... copied. Continue refund flow in wallet/Garden.`
          : `Refund hash for order ${orderLabel}... ready. Copy the hash from the panel and continue refund.`,
      })
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Claim refund failed",
        message: error instanceof Error ? error.message : "Unable to process instant refund.",
      })
    } finally {
      setIsClaimingRefund(false)
    }
  }, [
    notifications,
    pendingBtcDeposit,
    pollGardenBridgeOrder,
    setIsClaimingRefund,
    setPendingBtcDeposit,
    wallet,
  ])

  return { handleSendBtcDepositFromWallet, handleClaimInstantRefund }
}
