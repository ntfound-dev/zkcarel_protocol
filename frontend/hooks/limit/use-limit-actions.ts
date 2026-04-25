"use client"

import type { PrivacyVerificationPayload } from "@/lib/api"
import type { PendingHideNoteRecord } from "@/lib/limit-utils"
import type { useNotifications } from "@/hooks/notifications/use-notifications"
import type { WalletContextType } from "@/hooks/wallet/use-wallet"
import {
  cancelLimitOrder,
  createLimitOrder,
  preparePrivateExecution,
} from "@/lib/api"
import { decimalToU256Parts, invokeStarknetCallsFromWallet, toHexFelt } from "@/lib/onchain-trade"
import {
  buildHideBalancePrivacyCall,
  clearTradePrivacyPayload,
  expiryToSeconds,
  generateClientOrderId,
  loadPendingHideNotes,
  normalizeHexArray,
  persistTradePrivacyPayload,
  removePendingHideNote,
} from "@/lib/limit-utils"

type ConfirmOrderOptions = {
  manualExecuteFromPendingNote?: boolean
  overridePayload?: PrivacyVerificationPayload
  overrideOrderType?: "buy" | "sell"
  overrideFromToken?: string
  overrideToToken?: string
  overrideAmount?: string
  overridePrice?: string
  overrideExpiry?: string
}

type LimitOrderStateItem = {
  id: string
  type: "buy" | "sell"
  token: string
  fromToken: string
  amount: string
  price: string
  expiry: string
  status: "active" | "filled" | "cancelled"
  createdAt: string
  requestSource: "manual" | "ai"
}

type UseLimitActionsParams = {
  notifications: ReturnType<typeof useNotifications>
  wallet: WalletContextType
  resolveHideBalancePrivacyPayload: () => Promise<PrivacyVerificationPayload | undefined>
  ensureHideNoteDeposited: (params: {
    payload: PrivacyVerificationPayload
    tokenSymbol: string
    amountText: string
    fallbackTierUsdt: number
  }) => Promise<number>
  isManuallySelectedHideNote: (commitment?: string, nullifier?: string) => boolean
  clearManuallySelectedHideNote: () => void
  setHasTradePrivacyPayload: React.Dispatch<React.SetStateAction<boolean>>
  setPendingHideNotes: React.Dispatch<React.SetStateAction<PendingHideNoteRecord[]>>
  setOrders: React.Dispatch<
    React.SetStateAction<
      Array<{
        id: string
        type: "buy" | "sell"
        token: string
        fromToken: string
        amount: string
        price: string
        expiry: string
        status: "active" | "filled" | "cancelled"
        createdAt: string
        requestSource: "manual" | "ai"
      }>
    >
  >
  setShowConfirmDialog: React.Dispatch<React.SetStateAction<boolean>>
  setSubmitSuccess: React.Dispatch<React.SetStateAction<boolean>>
  setIsSubmitting: React.Dispatch<React.SetStateAction<boolean>>
  setAmount: React.Dispatch<React.SetStateAction<string>>
  setPrice: React.Dispatch<React.SetStateAction<string>>
  isSubmitting: boolean
  balanceHidden: boolean
  orderType: "buy" | "sell"
  amount: string
  price: string
  expiry: string
  payTokenSymbol: string
  selectedTokenSymbol: string
  receiveTokenSymbol: string
  selectedHideTier: { minUsdt: number }
  resolveAvailableBalance: (symbol: string) => number
  starknetProviderHint: "starknet" | "argentx" | "braavos"
  starknetLimitOrderBookAddress: string
  tokenAddressMap: Record<string, string>
  tokenDecimals: Record<string, number>
  hideBalanceRelayerPoolEnabled: boolean
  hideBalancePrivateExecutorEnabled: boolean
}

export const useLimitActions = ({
  notifications,
  resolveHideBalancePrivacyPayload,
  ensureHideNoteDeposited,
  isManuallySelectedHideNote,
  clearManuallySelectedHideNote,
  setHasTradePrivacyPayload,
  setPendingHideNotes,
  setOrders,
  setShowConfirmDialog,
  setSubmitSuccess,
  setIsSubmitting,
  setAmount,
  setPrice,
  isSubmitting,
  balanceHidden,
  orderType,
  amount,
  price,
  expiry,
  payTokenSymbol,
  selectedTokenSymbol,
  receiveTokenSymbol,
  selectedHideTier,
  resolveAvailableBalance,
  starknetProviderHint,
  starknetLimitOrderBookAddress,
  tokenAddressMap,
  tokenDecimals,
  hideBalanceRelayerPoolEnabled,
  hideBalancePrivateExecutorEnabled,
}: UseLimitActionsParams) => {
  /**
   * Handles `handleSubmitOrder` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const handleSubmitOrder = () => {
    const parsedPrice = Number.parseFloat(price)
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      notifications.addNotification({
        type: "error",
        title: "Price is required",
        message: "Set a valid target price before creating the order.",
      })
      return
    }
    const parsedAmount = Number.parseFloat(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      notifications.addNotification({
        type: "error",
        title: "Amount is required",
        message: "Set a valid amount before creating the order.",
      })
      return
    }
    const sourceToken = orderType === "buy" ? payTokenSymbol : selectedTokenSymbol
    const available = Number(resolveAvailableBalance(sourceToken))
    const hasUsableSnapshot = Number.isFinite(available) && available > 0
    const tolerance = hasUsableSnapshot ? Math.max(available * 1e-6, 1e-8) : 0
    if (hasUsableSnapshot && parsedAmount > available + tolerance) {
      notifications.addNotification({
        type: "error",
        title: "Insufficient balance",
        message: `Amount exceeds your ${sourceToken} balance (${available.toLocaleString(undefined, {
          maximumFractionDigits: 8,
        })}).`,
      })
      return
    }
    setShowConfirmDialog(true)
  }

  /**
   * Handles `confirmOrder` logic.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const confirmOrder = async (options?: ConfirmOrderOptions) => {
    if (isSubmitting) return
    const effectiveOrderType = options?.overrideOrderType || orderType
    const effectiveAmount = (options?.overrideAmount || amount || "").trim()
    const effectivePrice = (options?.overridePrice || price || "").trim()
    const effectiveExpiry = (options?.overrideExpiry || expiry || "").trim() || expiry
    const effectiveFromToken = (
      options?.overrideFromToken ||
      (effectiveOrderType === "buy" ? payTokenSymbol : selectedTokenSymbol)
    ).toUpperCase()
    const effectiveToToken = (
      options?.overrideToToken ||
      (effectiveOrderType === "buy" ? selectedTokenSymbol : receiveTokenSymbol)
    ).toUpperCase()
    const parsedAmount = Number.parseFloat(effectiveAmount)
    const parsedPrice = Number.parseFloat(effectivePrice)
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      notifications.addNotification({
        type: "error",
        title: "Price is required",
        message: "Set a valid target price before creating the order.",
      })
      return
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      notifications.addNotification({
        type: "error",
        title: "Amount is required",
        message: "Set a valid amount before creating the order.",
      })
      return
    }
    if (effectiveOrderType === "buy" && effectiveToToken === "BTC") {
      notifications.addNotification({
        type: "info",
        title: "Coming Soon",
        message: "Limit Order BTC Buy is still in final integration.",
      })
      return
    }
    setIsSubmitting(true)
    let orderCreated = false
    try {
      const effectiveHideBalance = balanceHidden
      if (effectiveFromToken === effectiveToToken) {
        throw new Error("Source and destination tokens cannot be the same.")
      }
      const available = Number(resolveAvailableBalance(effectiveFromToken))
      const hasUsableSnapshot = Number.isFinite(available) && available > 0
      const tolerance = hasUsableSnapshot ? Math.max(available * 1e-6, 1e-8) : 0
      if (hasUsableSnapshot && parsedAmount > available + tolerance) {
        throw new Error(
          `Amount exceeds your ${effectiveFromToken} balance (${available.toLocaleString(undefined, {
            maximumFractionDigits: 8,
          })}).`
        )
      }
      const fromTokenAddress = tokenAddressMap[effectiveFromToken]
      const toTokenAddress = tokenAddressMap[effectiveToToken]
      if (!fromTokenAddress || !toTokenAddress) {
        throw new Error("Token pair is not supported for Starknet on-chain limit orders.")
      }
      if (!starknetLimitOrderBookAddress) {
        throw new Error(
          "NEXT_PUBLIC_STARKNET_LIMIT_ORDER_BOOK_ADDRESS is not set. Configure the limit order contract address in frontend/.env.local."
        )
      }
      const useRelayerPoolHide = effectiveHideBalance && hideBalanceRelayerPoolEnabled
      const manualPendingExecution = Boolean(options?.manualExecuteFromPendingNote)
      const shouldDepositOnly = useRelayerPoolHide && effectiveHideBalance && !manualPendingExecution

      if (shouldDepositOnly) {
        clearManuallySelectedHideNote()
        clearTradePrivacyPayload()
        setHasTradePrivacyPayload(false)
      }

      const clientOrderId = generateClientOrderId()
      const [amountLow, amountHigh] = decimalToU256Parts(
        effectiveAmount,
        tokenDecimals[effectiveFromToken] || 18
      )
      const [priceLow, priceHigh] = decimalToU256Parts(effectivePrice, 18)
      const expiryTs = Math.floor(Date.now() / 1000) + expiryToSeconds(effectiveExpiry)
      const resolvedPrivacyPayload =
        options?.overridePayload ||
        (effectiveHideBalance ? await resolveHideBalancePrivacyPayload() : undefined)
      if (effectiveHideBalance && !resolvedPrivacyPayload) {
        throw new Error("Garaga payload is not ready for Hide Balance. Check backend auto-proof config.")
      }
      let payloadForBackend = resolvedPrivacyPayload

      if (shouldDepositOnly && payloadForBackend) {
        await ensureHideNoteDeposited({
          payload: payloadForBackend,
          tokenSymbol: effectiveFromToken,
          amountText: effectiveAmount,
          fallbackTierUsdt: selectedHideTier.minUsdt,
        })
        throw new Error("HIDE_NOTE_READY::Hide note berhasil dideposit. Retry private order now.")
      }

      const createOrderCall = {
        contractAddress: starknetLimitOrderBookAddress,
        entrypoint: "create_limit_order",
        calldata: [
          clientOrderId,
          fromTokenAddress,
          toTokenAddress,
          amountLow,
          amountHigh,
          priceLow,
          priceHigh,
          toHexFelt(expiryTs),
        ],
      }

      let preparedCalls = [createOrderCall]
      if (effectiveHideBalance && resolvedPrivacyPayload && !useRelayerPoolHide) {
        let usedPrivateExecutor = false
        if (hideBalancePrivateExecutorEnabled) {
          try {
            const preparedPrivate = await preparePrivateExecution({
              verifier: (resolvedPrivacyPayload.verifier || "garaga").trim() || "garaga",
              flow: "limit",
              action_entrypoint: createOrderCall.entrypoint,
              action_calldata: createOrderCall.calldata,
              privacy_payload: resolvedPrivacyPayload,
              tx_context: {
                flow: "limit_order",
                from_token: effectiveFromToken,
                to_token: effectiveToToken,
                amount: effectiveAmount,
                from_network: "starknet",
                to_network: "starknet",
                noir_inputs: resolvedPrivacyPayload?.noir_inputs,
              },
            })
            const preparedProof = normalizeHexArray(preparedPrivate.payload?.proof)
            const preparedPublicInputs = normalizeHexArray(preparedPrivate.payload?.public_inputs)
            payloadForBackend = {
              verifier: (preparedPrivate.payload?.verifier || "garaga").trim() || "garaga",
              note_version:
                preparedPrivate.payload?.note_version?.trim() ||
                resolvedPrivacyPayload?.note_version?.trim() ||
                undefined,
              root:
                preparedPrivate.payload?.root?.trim() ||
                resolvedPrivacyPayload?.root?.trim() ||
                undefined,
              nullifier: preparedPrivate.payload?.nullifier?.trim(),
              commitment: preparedPrivate.payload?.commitment?.trim(),
              note_commitment:
                preparedPrivate.payload?.note_commitment?.trim() ||
                resolvedPrivacyPayload?.note_commitment?.trim() ||
                undefined,
              noir_inputs: resolvedPrivacyPayload?.noir_inputs,
              denom_id:
                preparedPrivate.payload?.denom_id?.trim() ||
                resolvedPrivacyPayload?.denom_id?.trim() ||
                undefined,
              spendable_at_unix:
                typeof preparedPrivate.payload?.spendable_at_unix === "number" &&
                Number.isFinite(preparedPrivate.payload.spendable_at_unix)
                  ? Math.floor(preparedPrivate.payload.spendable_at_unix)
                  : typeof resolvedPrivacyPayload?.spendable_at_unix === "number"
                  ? Math.floor(resolvedPrivacyPayload.spendable_at_unix)
                  : undefined,
              proof:
                preparedProof.length > 0
                  ? preparedProof
                  : normalizeHexArray(resolvedPrivacyPayload?.proof),
              public_inputs:
                preparedPublicInputs.length > 0
                  ? preparedPublicInputs
                  : normalizeHexArray(resolvedPrivacyPayload?.public_inputs),
            }
            persistTradePrivacyPayload(payloadForBackend)
            setHasTradePrivacyPayload(true)
            preparedCalls = preparedPrivate.onchain_calls.map((call) => ({
              contractAddress: call.contract_address,
              entrypoint: call.entrypoint,
              calldata: call.calldata.map((item) => String(item)),
            }))
            usedPrivateExecutor = preparedCalls.length > 0
          } catch (error) {
            notifications.addNotification({
              type: "warning",
              title: "Private executor fallback",
              message:
                error instanceof Error
                  ? `Using legacy privacy call path: ${error.message}`
                  : "Using legacy privacy call path.",
            })
          }
        }
        if (!usedPrivateExecutor) {
          preparedCalls = [buildHideBalancePrivacyCall(resolvedPrivacyPayload), createOrderCall]
        }
      }
      let onchainTxHash: string | undefined
      if (!useRelayerPoolHide) {
        notifications.addNotification({
          type: "info",
          title: "Wallet signature required",
          message: "Confirm create limit order transaction in your Starknet wallet.",
        })
        onchainTxHash = await invokeStarknetCallsFromWallet(preparedCalls, starknetProviderHint)
        notifications.addNotification({
          type: "info",
          title: "Order pending",
          message: `Order ${effectiveOrderType === "buy" ? "buy" : "sell"} ${effectiveAmount} ${effectiveFromToken} submitted on-chain.`,
          txHash: onchainTxHash,
          txNetwork: "starknet",
        })
      } else {
        notifications.addNotification({
          type: "info",
          title: "Submitting private order",
          message: "Submitting hide-mode limit order via backend relayer pool.",
        })
      }
      let response: Awaited<ReturnType<typeof createLimitOrder>>
      try {
        response = await createLimitOrder({
          from_token: effectiveFromToken,
          to_token: effectiveToToken,
          amount: effectiveAmount,
          price: effectivePrice,
          expiry: effectiveExpiry,
          recipient: null,
          client_order_id: clientOrderId,
          onchain_tx_hash: onchainTxHash,
          hide_balance: effectiveHideBalance,
          privacy: effectiveHideBalance ? payloadForBackend : undefined,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "")
        if (useRelayerPoolHide && /nullifier already spent/i.test(message)) {
          const spentCommitment = (
            payloadForBackend?.note_commitment ||
            payloadForBackend?.commitment ||
            ""
          ).trim()
          const spentNullifier = (payloadForBackend?.nullifier || "").trim()
          removePendingHideNote(spentCommitment, spentNullifier)
          setPendingHideNotes(loadPendingHideNotes())
          if (isManuallySelectedHideNote(spentCommitment, spentNullifier)) {
            clearManuallySelectedHideNote()
          }
          clearTradePrivacyPayload()
          setHasTradePrivacyPayload(false)
          throw new Error(
            "HIDE_NOTE_SPENT::Selected hide note was already spent. Refreshing note state and retrying with a fresh payload."
          )
        }
        if (
          useRelayerPoolHide &&
          /note belum terdaftar|note not registered|note is not registered yet/i.test(message) &&
          payloadForBackend
        ) {
          const selectedCommitment = (
            payloadForBackend.note_commitment ||
            payloadForBackend.commitment ||
            ""
          )
            .trim()
            .toLowerCase()
          const selectedNullifier = (payloadForBackend.nullifier || "").trim().toLowerCase()
          if (isManuallySelectedHideNote(selectedCommitment, selectedNullifier)) {
            throw new Error(
              "Selected hide note is not recognized by the active executor/relayer. Auto-deposit is disabled for manually selected notes. Please choose another pending note or withdraw this note."
            )
          }
          throw new Error("Hide Balance note belum terdaftar. Deposit note dulu lalu tunggu mixing window.")
        }
        if (useRelayerPoolHide) {
          throw new Error(
            `Hide relayer unavailable. Wallet fallback is disabled so order details never leak in explorer. Detail: ${message}`
          )
        }
        throw error
      }
      if (response.privacy_tx_hash) {
        notifications.addNotification({
          type: "info",
          title: "Garaga verification submitted",
          message: `Privacy tx ${response.privacy_tx_hash.slice(0, 12)}... was submitted on Starknet.`,
          txHash: response.privacy_tx_hash,
          txNetwork: "starknet",
        })
      }
      if (effectiveHideBalance) {
        const spentCommitment = (
          payloadForBackend?.note_commitment ||
          payloadForBackend?.commitment ||
          ""
        ).trim()
        const spentNullifier = (payloadForBackend?.nullifier || "").trim()
        removePendingHideNote(spentCommitment, spentNullifier)
        setPendingHideNotes(loadPendingHideNotes())
        if (isManuallySelectedHideNote(spentCommitment, spentNullifier)) {
          clearManuallySelectedHideNote()
        }
        clearTradePrivacyPayload()
        setHasTradePrivacyPayload(false)
      }

      const newOrder: LimitOrderStateItem = {
        id: response.order_id,
        type: effectiveOrderType,
        token: effectiveOrderType === "buy" ? effectiveToToken : effectiveFromToken,
        fromToken: effectiveFromToken,
        amount: effectiveAmount,
        price: effectivePrice,
        expiry: effectiveExpiry,
        status: "active",
        createdAt: "Just now",
        requestSource: "manual",
      }

      setOrders((prev) => [newOrder, ...prev])
      orderCreated = true
      setSubmitSuccess(true)
      notifications.addNotification({
        type: "success",
        title: "Order created",
        message: `Order ${effectiveOrderType === "buy" ? "buy" : "sell"} ${effectiveAmount} ${effectiveFromToken} created successfully`,
        txHash: onchainTxHash || response.privacy_tx_hash,
        txNetwork: "starknet",
      })
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : "Unexpected error while creating order"
      if (rawMessage.startsWith("HIDE_NOTE_WAIT::")) {
        notifications.addNotification({
          type: "warning",
          title: "Mixing window active",
          message: rawMessage.replace("HIDE_NOTE_WAIT::", "").trim(),
        })
        setShowConfirmDialog(false)
        return
      }
      if (rawMessage.startsWith("HIDE_NOTE_READY::")) {
        notifications.addNotification({
          type: "success",
          title: "Hide note deposited",
          message: rawMessage.replace("HIDE_NOTE_READY::", "").trim(),
        })
        setShowConfirmDialog(false)
        return
      }
      if (rawMessage.startsWith("HIDE_NOTE_SPENT::")) {
        notifications.addNotification({
          type: "warning",
          title: "Hide note refreshed",
          message: rawMessage.replace("HIDE_NOTE_SPENT::", "").trim(),
        })
        setShowConfirmDialog(false)
        return
      }
      notifications.addNotification({
        type: "error",
        title: "Failed to create order",
        message: rawMessage,
      })
    } finally {
      setIsSubmitting(false)
      if (orderCreated) {
        setTimeout(() => {
          setShowConfirmDialog(false)
          setSubmitSuccess(false)
          setAmount("")
          setPrice("")
        }, 1500)
      }
    }
  }

  /**
   * Runs `cancelOrder` and handles related side effects.
   *
   * @param orderId - Input used by `cancelOrder` to compute state, payload, or request behavior.
   *
   * @returns Result consumed by caller flow, UI state updates, or async chaining.
   * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
   */
  const cancelOrder = async (orderId: string) => {
    try {
      const effectiveHideBalance = balanceHidden
      const useRelayerPoolHide = effectiveHideBalance && hideBalanceRelayerPoolEnabled
      if (!starknetLimitOrderBookAddress) {
        throw new Error(
          "NEXT_PUBLIC_STARKNET_LIMIT_ORDER_BOOK_ADDRESS is not set. Configure the limit order contract address in frontend/.env.local."
        )
      }
      const resolvedPrivacyPayload = effectiveHideBalance
        ? await resolveHideBalancePrivacyPayload()
        : undefined
      if (effectiveHideBalance && !resolvedPrivacyPayload) {
        throw new Error("Garaga payload is not ready for Hide Balance. Check backend auto-proof config.")
      }
      const cancelCall = {
        contractAddress: starknetLimitOrderBookAddress,
        entrypoint: "cancel_limit_order",
        calldata: [orderId],
      }
      let payloadForBackend = resolvedPrivacyPayload
      let preparedCalls = [cancelCall]
      if (effectiveHideBalance && resolvedPrivacyPayload && !useRelayerPoolHide) {
        let usedPrivateExecutor = false
        if (hideBalancePrivateExecutorEnabled) {
          try {
            const preparedPrivate = await preparePrivateExecution({
              verifier: (resolvedPrivacyPayload.verifier || "garaga").trim() || "garaga",
              flow: "limit",
              action_entrypoint: cancelCall.entrypoint,
              action_calldata: cancelCall.calldata,
              privacy_payload: resolvedPrivacyPayload,
              tx_context: {
                flow: "limit_order_cancel",
                from_network: "starknet",
                to_network: "starknet",
              },
            })
            const preparedProof = normalizeHexArray(preparedPrivate.payload?.proof)
            const preparedPublicInputs = normalizeHexArray(preparedPrivate.payload?.public_inputs)
            payloadForBackend = {
              verifier: (preparedPrivate.payload?.verifier || "garaga").trim() || "garaga",
              note_version:
                preparedPrivate.payload?.note_version?.trim() ||
                resolvedPrivacyPayload?.note_version?.trim() ||
                undefined,
              root:
                preparedPrivate.payload?.root?.trim() ||
                resolvedPrivacyPayload?.root?.trim() ||
                undefined,
              nullifier: preparedPrivate.payload?.nullifier?.trim(),
              commitment: preparedPrivate.payload?.commitment?.trim(),
              note_commitment:
                preparedPrivate.payload?.note_commitment?.trim() ||
                resolvedPrivacyPayload?.note_commitment?.trim() ||
                undefined,
              denom_id:
                preparedPrivate.payload?.denom_id?.trim() ||
                resolvedPrivacyPayload?.denom_id?.trim() ||
                undefined,
              spendable_at_unix:
                typeof preparedPrivate.payload?.spendable_at_unix === "number" &&
                Number.isFinite(preparedPrivate.payload.spendable_at_unix)
                  ? Math.floor(preparedPrivate.payload.spendable_at_unix)
                  : typeof resolvedPrivacyPayload?.spendable_at_unix === "number"
                  ? Math.floor(resolvedPrivacyPayload.spendable_at_unix)
                  : undefined,
              proof:
                preparedProof.length > 0
                  ? preparedProof
                  : normalizeHexArray(resolvedPrivacyPayload?.proof),
              public_inputs:
                preparedPublicInputs.length > 0
                  ? preparedPublicInputs
                  : normalizeHexArray(resolvedPrivacyPayload?.public_inputs),
            }
            persistTradePrivacyPayload(payloadForBackend)
            setHasTradePrivacyPayload(true)
            preparedCalls = preparedPrivate.onchain_calls.map((call) => ({
              contractAddress: call.contract_address,
              entrypoint: call.entrypoint,
              calldata: call.calldata.map((item) => String(item)),
            }))
            usedPrivateExecutor = preparedCalls.length > 0
          } catch (error) {
            notifications.addNotification({
              type: "warning",
              title: "Private executor fallback",
              message:
                error instanceof Error
                  ? `Using legacy privacy call path: ${error.message}`
                  : "Using legacy privacy call path.",
            })
          }
        }
        if (!usedPrivateExecutor) {
          preparedCalls = [buildHideBalancePrivacyCall(resolvedPrivacyPayload), cancelCall]
        }
      }
      let onchainTxHash: string | undefined
      if (!useRelayerPoolHide) {
        notifications.addNotification({
          type: "info",
          title: "Wallet signature required",
          message: "Confirm cancel limit order transaction in your Starknet wallet.",
        })
        onchainTxHash = await invokeStarknetCallsFromWallet(preparedCalls, starknetProviderHint)
      } else {
        notifications.addNotification({
          type: "info",
          title: "Submitting private cancel",
          message: "Submitting hide-mode cancel via backend relayer pool.",
        })
      }
      try {
        await cancelLimitOrder(orderId, {
          onchain_tx_hash: onchainTxHash,
          hide_balance: effectiveHideBalance,
          privacy: effectiveHideBalance ? payloadForBackend : undefined,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "")
        if (useRelayerPoolHide) {
          throw new Error(
            `Hide relayer unavailable. Wallet fallback is disabled so order details never leak in explorer. Detail: ${message}`
          )
        }
        throw error
      }
      setOrders((prev) => prev.filter((order) => order.id !== orderId))
      notifications.addNotification({
        type: "success",
        title: "Order cancelled",
        message: "Order cancelled successfully",
        txHash: onchainTxHash,
        txNetwork: "starknet",
      })
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Failed to cancel",
        message: error instanceof Error ? error.message : "Unable to cancel order",
      })
    }
  }

  return { handleSubmitOrder, confirmOrder, cancelOrder }
}
