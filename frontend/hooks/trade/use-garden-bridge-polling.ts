import * as React from "react"
import type { NFTItem } from "@/lib/api"
import type { GardenOrderProgress, PendingBtcDepositState, TradeResultPopupState } from "@/lib/trading-types"
import type { useNotifications } from "@/hooks/notifications/use-notifications"
import type { WalletContextType } from "@/hooks/wallet/use-wallet"
type GardenBridgePollingHelpers = {
  buildGardenOrderExplorerLinks: (orderId: string) => Array<{ label: string; url: string }> | undefined
  getGardenOrderById: (orderId: string) => Promise<unknown>
  unwrapGardenOrderPayload: (response: unknown) => unknown
  parseGardenOrderProgress: (payload: unknown) => GardenOrderProgress
  upsertPendingBtcDepositList: (
    items: PendingBtcDepositState[],
    next: PendingBtcDepositState
  ) => PendingBtcDepositState[]
  getOwnedNfts: (opts?: { force?: boolean }) => Promise<NFTItem[]>
  getRewardsPoints: (opts?: { force?: boolean }) => Promise<{ multiplier?: number }>
}

type UseGardenBridgePollingParams = {
  isPageVisible: boolean
  pendingBtcDeposit: PendingBtcDepositState | null
  trackedPendingBtcOrders: PendingBtcDepositState[]
  notifications: ReturnType<typeof useNotifications>
  openTradeResultPopup: (payload: TradeResultPopupState) => void
  wallet: WalletContextType
  setPendingBtcDeposit: React.Dispatch<React.SetStateAction<PendingBtcDepositState | null>>
  setPendingBtcDeposits: React.Dispatch<React.SetStateAction<PendingBtcDepositState[]>>
  setActiveNft: React.Dispatch<React.SetStateAction<NFTItem | null>>
  setStakePointsMultiplier: React.Dispatch<React.SetStateAction<number>>
  helpers: GardenBridgePollingHelpers
  finalizedStatuses: Set<string>
}

export const useGardenBridgePolling = ({
  isPageVisible,
  pendingBtcDeposit,
  trackedPendingBtcOrders,
  notifications,
  openTradeResultPopup,
  wallet,
  setPendingBtcDeposit,
  setPendingBtcDeposits,
  setActiveNft,
  setStakePointsMultiplier,
  helpers,
  finalizedStatuses,
}: UseGardenBridgePollingParams) => {
  const {
    buildGardenOrderExplorerLinks,
    getGardenOrderById,
    unwrapGardenOrderPayload,
    parseGardenOrderProgress,
    upsertPendingBtcDepositList,
    getOwnedNfts,
    getRewardsPoints,
  } = helpers

  const lastGardenOrderStatusRef = React.useRef<Record<string, string>>({})
  const gardenOrderPollingRef = React.useRef<Record<string, boolean>>({})

  const pollGardenBridgeOrder = React.useCallback(
    async (bridgeId: string, destinationChain: string) => {
      if (!isPageVisible) return
      const normalizedBridgeId = (bridgeId || "").trim()
      if (!normalizedBridgeId) return
      if (gardenOrderPollingRef.current[normalizedBridgeId]) return
      gardenOrderPollingRef.current[normalizedBridgeId] = true

      const maxAttempts = 18
      const intervalMs = 10_000
      const txNetwork: "btc" | "evm" | "starknet" =
        destinationChain === "bitcoin"
          ? "btc"
          : destinationChain === "ethereum"
          ? "evm"
          : "starknet"
      const orderExplorerLinks = buildGardenOrderExplorerLinks(normalizedBridgeId)

      try {
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          if (attempt > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, intervalMs))
          }
          try {
            const orderResponse = await getGardenOrderById(normalizedBridgeId)
            const orderPayload = unwrapGardenOrderPayload(orderResponse)
            const progress = parseGardenOrderProgress(orderPayload)
            const previousStatus = lastGardenOrderStatusRef.current[normalizedBridgeId]
            const didStatusChange = previousStatus !== progress.status
            lastGardenOrderStatusRef.current[normalizedBridgeId] = progress.status

            setPendingBtcDeposit((prev) =>
              prev && prev.bridgeId === normalizedBridgeId
                ? {
                    ...prev,
                    status: progress.status,
                    sourceInitiateTxHash: progress.sourceInitiateTxHash || null,
                    destinationInitiateTxHash: progress.destinationInitiateTxHash || null,
                    destinationRedeemTxHash: progress.destinationRedeemTxHash || null,
                    refundTxHash:
                      progress.sourceRefundTxHash ||
                      progress.destinationRefundTxHash ||
                      prev.refundTxHash ||
                      null,
                    instantRefundTx: progress.instantRefundTx || prev.instantRefundTx || null,
                    lastUpdatedAt: Date.now(),
                  }
                : prev
            )
            setPendingBtcDeposits((prev) =>
              upsertPendingBtcDepositList(prev, {
                bridgeId: normalizedBridgeId,
                depositAddress: pendingBtcDeposit?.bridgeId === normalizedBridgeId
                  ? pendingBtcDeposit.depositAddress
                  : prev.find((item) => item.bridgeId === normalizedBridgeId)?.depositAddress || "",
                amountSats: pendingBtcDeposit?.bridgeId === normalizedBridgeId
                  ? pendingBtcDeposit.amountSats
                  : prev.find((item) => item.bridgeId === normalizedBridgeId)?.amountSats || 0,
                destinationChain:
                  pendingBtcDeposit?.bridgeId === normalizedBridgeId
                    ? pendingBtcDeposit.destinationChain
                    : prev.find((item) => item.bridgeId === normalizedBridgeId)?.destinationChain ||
                      destinationChain,
                requestSource:
                  pendingBtcDeposit?.bridgeId === normalizedBridgeId
                    ? pendingBtcDeposit.requestSource
                    : prev.find((item) => item.bridgeId === normalizedBridgeId)?.requestSource ||
                      "manual",
                burnTxHash:
                  pendingBtcDeposit?.bridgeId === normalizedBridgeId
                    ? pendingBtcDeposit.burnTxHash
                    : prev.find((item) => item.bridgeId === normalizedBridgeId)?.burnTxHash || null,
                status: progress.status,
                txHash:
                  pendingBtcDeposit?.bridgeId === normalizedBridgeId
                    ? pendingBtcDeposit.txHash
                    : prev.find((item) => item.bridgeId === normalizedBridgeId)?.txHash || null,
                sourceInitiateTxHash: progress.sourceInitiateTxHash || null,
                destinationInitiateTxHash: progress.destinationInitiateTxHash || null,
                destinationRedeemTxHash: progress.destinationRedeemTxHash || null,
                refundTxHash: progress.sourceRefundTxHash || progress.destinationRefundTxHash || null,
                instantRefundTx: progress.instantRefundTx || null,
                instantRefundHash:
                  prev.find((item) => item.bridgeId === normalizedBridgeId)?.instantRefundHash || null,
                lastUpdatedAt: Date.now(),
              })
            )

            if (progress.isCompleted) {
              const redeemTxHash =
                progress.destinationRedeemTxHash || progress.destinationInitiateTxHash || undefined
              if (didStatusChange) {
                notifications.addNotification({
                  type: "success",
                  title: "Bridge completed",
                  message: `Order ${normalizedBridgeId.slice(0, 10)}... completed successfully.`,
                  txHash: redeemTxHash,
                  txNetwork,
                  txExplorerUrls: orderExplorerLinks,
                })
              }
              openTradeResultPopup({
                status: "success",
                title: "Bridge Completed",
                message: `Order ${normalizedBridgeId.slice(0, 10)}... is completed.`,
                txHash: redeemTxHash,
              })
              setPendingBtcDeposit((prev) =>
                prev && prev.bridgeId === normalizedBridgeId ? null : prev
              )
              delete lastGardenOrderStatusRef.current[normalizedBridgeId]
              await Promise.allSettled([
                wallet.refreshPortfolio(),
                wallet.refreshOnchainBalances(),
              ])
              const [nftState, rewardsState] = await Promise.allSettled([
                getOwnedNfts({ force: true }),
                getRewardsPoints({ force: true }),
              ])
              if (nftState.status === "fulfilled") {
                const now = Math.floor(Date.now() / 1000)
                const usable = nftState.value.find(
                  (nft) => !nft.used && (!nft.expiry || nft.expiry > now)
                )
                setActiveNft((prev) => {
                  if (usable) return usable
                  if (prev && !prev.used && (!prev.expiry || prev.expiry > now)) return prev
                  return null
                })
              }
              if (rewardsState.status === "fulfilled") {
                const parsedMultiplier = Number(rewardsState.value.multiplier)
                setStakePointsMultiplier(
                  Number.isFinite(parsedMultiplier) && parsedMultiplier > 0 ? parsedMultiplier : 1
                )
              }
              return
            }

            if (progress.isRefunded) {
              const refundTxHash =
                progress.sourceRefundTxHash || progress.destinationRefundTxHash || undefined
              if (didStatusChange) {
                notifications.addNotification({
                  type: "success",
                  title: "Refund completed",
                  message: `Order ${normalizedBridgeId.slice(0, 10)}... refunded successfully.`,
                  txHash: refundTxHash,
                  txNetwork: "btc",
                  txExplorerUrls: orderExplorerLinks,
                })
              }
              openTradeResultPopup({
                status: "success",
                title: "Bridge Refunded",
                message: `Order ${normalizedBridgeId.slice(0, 10)}... was refunded.`,
                txHash: refundTxHash,
              })
              setPendingBtcDeposit((prev) =>
                prev && prev.bridgeId === normalizedBridgeId ? null : prev
              )
              delete lastGardenOrderStatusRef.current[normalizedBridgeId]
              await wallet.refreshOnchainBalances()
              return
            }

            const isFailed =
              progress.status === "failed" ||
              progress.status === "cancelled" ||
              progress.status === "expired" ||
              progress.isExpired
            if (isFailed) {
              if (didStatusChange) {
                notifications.addNotification({
                  type: "error",
                  title: "Bridge failed",
                  message: `Order ${normalizedBridgeId.slice(0, 10)}... ended as ${progress.status || "failed"}.`,
                  txExplorerUrls: orderExplorerLinks,
                })
              }
              openTradeResultPopup({
                status: "error",
                title: "Bridge Failed",
                message: `Order ${normalizedBridgeId.slice(0, 10)}... status: ${progress.status || "failed"}.`,
              })
              setPendingBtcDeposit((prev) =>
                prev && prev.bridgeId === normalizedBridgeId ? null : prev
              )
              delete lastGardenOrderStatusRef.current[normalizedBridgeId]
              return
            }

            if (
              didStatusChange &&
              (progress.status === "initiated" || progress.status === "processing")
            ) {
              notifications.addNotification({
                type: "info",
                title: "Bridge processing",
                message: `Order ${normalizedBridgeId.slice(0, 10)}... is waiting for settlement.`,
                txExplorerUrls: orderExplorerLinks,
              })
            }
          } catch {
            // ignore transient polling errors
          }
        }

        const status = lastGardenOrderStatusRef.current[normalizedBridgeId]
        if (status !== "completed" && status !== "refunded") {
          notifications.addNotification({
            type: "info",
            title: "Bridge still processing",
            message: `Order ${normalizedBridgeId.slice(0, 10)}... is still processing. Check again in a few minutes.`,
            txExplorerUrls: orderExplorerLinks,
          })
        }
      } finally {
        delete gardenOrderPollingRef.current[normalizedBridgeId]
      }
    },
    [
      buildGardenOrderExplorerLinks,
      getGardenOrderById,
      isPageVisible,
      notifications,
      openTradeResultPopup,
      parseGardenOrderProgress,
      pendingBtcDeposit,
      setActiveNft,
      setPendingBtcDeposit,
      setPendingBtcDeposits,
      setStakePointsMultiplier,
      unwrapGardenOrderPayload,
      upsertPendingBtcDepositList,
      wallet,
    ]
  )

  React.useEffect(() => {
    if (!isPageVisible) return
    if (!pendingBtcDeposit?.bridgeId || !pendingBtcDeposit.destinationChain) return
    const status = (pendingBtcDeposit.status || "").trim().toLowerCase()
    if (
      status === "completed" ||
      status === "refunded" ||
      status === "failed" ||
      status === "cancelled" ||
      status === "expired"
    ) {
      return
    }

    void pollGardenBridgeOrder(pendingBtcDeposit.bridgeId, pendingBtcDeposit.destinationChain)
    const timer = window.setInterval(() => {
      void pollGardenBridgeOrder(pendingBtcDeposit.bridgeId, pendingBtcDeposit.destinationChain)
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [
    isPageVisible,
    pendingBtcDeposit?.bridgeId,
    pendingBtcDeposit?.destinationChain,
    pendingBtcDeposit?.status,
    pollGardenBridgeOrder,
  ])

  React.useEffect(() => {
    if (!isPageVisible) return
    const activeOrders = trackedPendingBtcOrders.filter((order) => {
      const status = (order.status || "").trim().toLowerCase()
      return !finalizedStatuses.has(status)
    })
    if (activeOrders.length === 0) return

    for (const order of activeOrders) {
      void pollGardenBridgeOrder(order.bridgeId, order.destinationChain)
    }
    const timer = window.setInterval(() => {
      for (const order of activeOrders) {
        void pollGardenBridgeOrder(order.bridgeId, order.destinationChain)
      }
    }, 45_000)
    return () => window.clearInterval(timer)
  }, [finalizedStatuses, isPageVisible, pollGardenBridgeOrder, trackedPendingBtcOrders])

  return { pollGardenBridgeOrder, lastGardenOrderStatusRef }
}
