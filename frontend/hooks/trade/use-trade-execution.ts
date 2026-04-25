import type {
  BridgeRewardsSnapshot,
  NFTItem,
  PendingBtcDepositState,
  TradeResultPopupState,
} from "@/lib/trading-types"
import { createPrivacyNote, fetchPrivacyFixedAmount } from "@/lib/api"
import { readStarknetShieldedPoolNoteDepositTimestampFromWallet } from "@/lib/onchain/onchain-trade"
import { HIDE_BALANCE_MIN_NOTE_AGE_MS, PRIVATE_ACTION_EXECUTOR_ADDRESS } from "@/lib/trading-utils"

type OnchainCall = {
  contractAddress: string
  entrypoint: string
  calldata: string[]
}

export const useTradeExecution = (deps: any) => {
  const {
    executeDisabledReason,
    notifications,
    setActivePendingHideNoteSwapKey,
    setPreviewOpen,
    setSwapState,
    hideBalanceOnchain,
    resolveHideBalancePrivacyPayload,
    isManuallySelectedHideNote,
    isCrossChain,
    receiveAddress,
    preferredReceiveAddress,
    fromToken,
    toToken,
    fromAmount,
    toAmount,
    xverseUserId,
    wallet,
    quote,
    mevProtection,
    submitOnchainBridgeTx,
    submitOnchainSwapTx,
    starknetProviderHint,
    pollGardenBridgeOrder,
    setPendingBtcDeposit,
    setIsSendingBtcDeposit,
    setLastBridgeRewards,
    setPendingHideNotes,
    setHasTradePrivacyPayload,
    removePendingHideNote,
    openTradeResultPopup,
    clearTradePrivacyPayload,
    clearManuallySelectedHideNote,
    ensureHideNoteDeposited,
    manualSelectedHideNoteRetryRef,
    manuallySelectedHideNoteRef,
    inferredHideDenomId,
    hideUsdtTierBonusPercent,
    hideAssetRuleMissingMessage,
    setActiveNft,
    setStakePointsMultiplier,
    activeSlippage,
    lastGardenOrderStatusRef,
    helpers,
    flags,
  } = deps

  const {
    buildGardenOrderExplorerLinks,
    chainFromNetwork,
    computeMinimumAmountOut,
    computeTradeDeadlineSeconds,
    formatBtcFromSats,
    formatRemainingDuration,
    isBridgePairSupportedForCurrentRoutes,
    isBridgeToStrkDisabledRoute,
    isStarknetEntrypointMissingError,
    limitBridgeApprovalToExactAmount,
    loadPendingHideNotes,
    loadTradePrivacyPayload,
    persistTradePrivacyPayload,
    normalizeGardenStarknetEntrypoint,
    resolveTokenAddress,
    resolveTradeSlippage,
    executeBridge,
    executeHideViaRelayer,
    executeSwap,
    getSwapQuote,
    getOwnedNfts,
    getRewardsPoints,
    getConnectedEvmAddressFromWallet,
    invokeStarknetCallsFromWallet,
    sendEvmTransactionFromWallet,
  } = helpers || {}

  const {
    HIDE_BALANCE_FALLBACK_TO_PUBLIC_ENABLED,
    HIDE_BALANCE_RELAYER_POOL_ENABLED,
    HIDE_BALANCE_SHIELDED_POOL,
    BRIDGE_TO_STRK_DISABLED_MESSAGE,
    UNSUPPORTED_BRIDGE_PAIR_MESSAGE,
  } = flags || {}

  const confirmTrade = async () => {
    if (executeDisabledReason) {
      notifications.addNotification({
        type: "warning",
        title: "Swap unavailable",
        message: executeDisabledReason,
      })
      setActivePendingHideNoteSwapKey(null)
      return
    }
    setPreviewOpen(false)
    setSwapState("confirming")
    setSwapState("processing")
    let tradeFinalized = true
    let shouldClearTradePrivacyPayload = false
    let submittedSwapTxHash: string | null = null
    let successPopupPayload: TradeResultPopupState | null = null
    const requestedHideBalance = hideBalanceOnchain
    let tradePrivacyPayload: any | undefined

    const tryAutoDepositHideNote = async () => {
      const denomId = (inferredHideDenomId || "").trim()
      const tokenAddress = resolveTokenAddress(fromToken.symbol).trim()
      if (!denomId) {
        throw new Error("Hide denom_id belum tersedia untuk auto note deposit.")
      }
      if (!tokenAddress) {
        throw new Error(
          `Token address for ${fromToken.symbol} is not configured for hide-mode note deposit.`
        )
      }
      const fixed = await fetchPrivacyFixedAmount({
        executor_address: PRIVATE_ACTION_EXECUTOR_ADDRESS || undefined,
        token: tokenAddress,
        denom_id: denomId,
      })
      const amountLow = BigInt(fixed.amount_low)
      const amountHigh = BigInt(fixed.amount_high || "0")
      if (amountHigh > 0n) {
        throw new Error("Hide fixed amount terlalu besar untuk auto note deposit.")
      }
      const note = await createPrivacyNote({
        note_amount: amountLow.toString(),
        note_token: tokenAddress,
      })
      const payloadForDeposit = {
        verifier: "garaga",
        note_version: "v4",
        executor_address: PRIVATE_ACTION_EXECUTOR_ADDRESS || undefined,
        note_commitment: note.note_commitment,
        nullifier: note.nullifier,
        denom_id: denomId,
        proof: [],
        public_inputs: [],
      }
      const spendableAtUnix = await ensureHideNoteDeposited(payloadForDeposit)
      if (spendableAtUnix > 0) {
        throw new Error(
          "HIDE_NOTE_READY::Hide note berhasil dideposit. Retry private swap now."
        )
      }
      throw new Error("HIDE_NOTE_READY::Hide note berhasil dideposit. Retry private swap now.")
    }

    try {
      if (requestedHideBalance) {
        try {
          tradePrivacyPayload = await resolveHideBalancePrivacyPayload()
        } catch (payloadError) {
          const message =
            payloadError instanceof Error ? payloadError.message : String(payloadError || "")
          const normalized = message.toLowerCase()
          const manualSelectionActive = Boolean(manuallySelectedHideNoteRef?.current)
          const shouldAttemptAutoDeposit =
            !manualSelectionActive &&
            flags?.HIDE_BALANCE_SHIELDED_POOL &&
            wallet?.isConnected &&
            (normalized.includes("noir inputs") ||
              normalized.includes("note commitment not found") ||
              normalized.includes("missing note_secret") ||
              normalized.includes("deposit note dulu"))
          if (shouldAttemptAutoDeposit) {
            await tryAutoDepositHideNote()
          }
          throw payloadError
        }
      }
      const effectiveHideBalance = requestedHideBalance && !!tradePrivacyPayload
      const manualSelectionActive = Boolean(manuallySelectedHideNoteRef?.current)
      if (requestedHideBalance && typeof tradePrivacyPayload?.spendable_at_unix === "number") {
        const payloadNoteCommitment = (
          tradePrivacyPayload.note_commitment ||
          tradePrivacyPayload.commitment ||
          ""
        )
          .trim()
          .toLowerCase()
        const payloadNullifier = (tradePrivacyPayload.nullifier || "").trim().toLowerCase()
        const payloadWasManuallySelected = isManuallySelectedHideNote(
          payloadNoteCommitment,
          payloadNullifier
        )
        const remainingMs = Math.max(
          0,
          tradePrivacyPayload.spendable_at_unix * 1000 - Date.now()
        )
        if (remainingMs > 0 && payloadWasManuallySelected) {
          notifications.addNotification({
            type: "warning",
            title: "Mixing window aktif",
            message: `Frontend estimate: tunggu ${formatRemainingDuration(
              remainingMs
            )}, lalu klik Execute Trade lagi.`,
          })
          setSwapState("idle")
          return
        }
      }
      if (requestedHideBalance && !tradePrivacyPayload) {
        const shouldAttemptAutoDepositWithoutPayload =
          !manualSelectionActive && HIDE_BALANCE_SHIELDED_POOL && wallet?.isConnected
        if (shouldAttemptAutoDepositWithoutPayload) {
          await tryAutoDepositHideNote()
        }
        if (!HIDE_BALANCE_FALLBACK_TO_PUBLIC_ENABLED) {
          throw new Error(
            "Garaga payload belum siap untuk Hide Balance. Cek konfigurasi auto-proof backend lalu coba lagi."
          )
        }
        notifications.addNotification({
          type: "warning",
          title: "Hide Balance unavailable",
          message:
            "Proof belum siap. Transaksi dilanjutkan dalam mode publik supaya tidak blok user.",
        })
      }
      if (effectiveHideBalance && HIDE_BALANCE_SHIELDED_POOL && !HIDE_BALANCE_RELAYER_POOL_ENABLED) {
        throw new Error(
          "Hide Balance strict mode aktif: relayer pool harus enabled. Public wallet path diblok untuk cegah kebocoran data swap di explorer."
        )
      }
      if (isCrossChain) {
        const recipient = (receiveAddress || preferredReceiveAddress).trim()
        const sourceChain = chainFromNetwork(fromToken.network)
        const toChain = chainFromNetwork(toToken.network)
        if (isBridgeToStrkDisabledRoute(sourceChain, toChain, toToken.symbol)) {
          throw new Error(BRIDGE_TO_STRK_DISABLED_MESSAGE)
        }
        if (!isBridgePairSupportedForCurrentRoutes(sourceChain, toChain, fromToken.symbol, toToken.symbol)) {
          throw new Error(UNSUPPORTED_BRIDGE_PAIR_MESSAGE)
        }
        const xverseHint = xverseUserId.trim() || undefined
        const recipientFallbackFromXverse =
          toChain === "bitcoin" && !recipient ? xverseHint : undefined
        let sourceOwner =
          sourceChain === "ethereum"
            ? wallet.evmAddress || undefined
            : sourceChain === "starknet"
            ? wallet.starknetAddress || wallet.address || undefined
            : sourceChain === "bitcoin"
            ? wallet.btcAddress || undefined
            : undefined
        if (sourceChain === "ethereum") {
          sourceOwner = await getConnectedEvmAddressFromWallet()
        }
        if (!recipient && !recipientFallbackFromXverse) {
          throw new Error(`Recipient ${toChain} address is required.`)
        }

        const isSourceBitcoin = sourceChain === "bitcoin"
        const isGardenProvider = ((quote?.provider || "").trim().toLowerCase() === "garden")
        const isGardenSourceSigningFlow =
          isGardenProvider && (sourceChain === "ethereum" || sourceChain === "starknet")
        const txNetwork: "btc" | "evm" | "starknet" =
          sourceChain === "ethereum" ? "evm" : sourceChain === "bitcoin" ? "btc" : "starknet"
        const bridgePayloadBase = {
          from_chain: sourceChain,
          to_chain: toChain,
          token: fromToken.symbol,
          to_token: toToken.symbol,
          estimated_out_amount: quote?.toAmount || toAmount || undefined,
          amount: fromAmount,
          recipient,
          source_owner: sourceOwner,
          xverse_user_id:
            sourceChain === "bitcoin" || toChain === "bitcoin" ? xverseHint : undefined,
          mode: mevProtection ? "private" : "transparent",
          hide_balance: effectiveHideBalance,
          privacy: effectiveHideBalance ? tradePrivacyPayload : undefined,
        }
        let onchainTxHash: string | null = null
        let btcDepositTxHash: string | null = null
        let btcAutoSendAttempted = false
        let btcAutoSendSucceeded = false
        let gardenStarknetCalls: Array<{
          contractAddress: string
          entrypoint: string
          calldata: string[]
        }> | null = null
        let response: Awaited<ReturnType<typeof executeBridge>>

        if (isSourceBitcoin) {
          notifications.addNotification({
            type: "info",
            title: "Create BTC bridge order",
            message:
              "Submitting Garden order. After the order is created, send BTC to the provided deposit address.",
          })
          response = await executeBridge(bridgePayloadBase)
        } else if (isGardenSourceSigningFlow) {
          notifications.addNotification({
            type: "info",
            title: "Create Garden order",
            message: "Creating order and preparing source-chain transaction for wallet signature.",
          })
          const createOrderResponse = await executeBridge(bridgePayloadBase)
          const orderId = (createOrderResponse.bridge_id || "").trim()
          if (!orderId) {
            throw new Error("Garden order id is missing. Please retry bridge creation.")
          }
          notifications.addNotification({
            type: "info",
            title: "Garden order created",
            message: `Order ${orderId.slice(0, 10)}... created. Continue with wallet signature.`,
            txExplorerUrls: buildGardenOrderExplorerLinks(orderId),
          })

          if (sourceChain === "ethereum") {
            notifications.addNotification({
              type: "info",
              title: "Wallet signature required",
              message: "Confirm Garden source transaction in MetaMask.",
            })
            if (createOrderResponse.evm_approval_transaction) {
              await sendEvmTransactionFromWallet(createOrderResponse.evm_approval_transaction)
            }
            if (!createOrderResponse.evm_initiate_transaction) {
              throw new Error("Garden initiate transaction is missing for Ethereum source flow.")
            }
            onchainTxHash = await sendEvmTransactionFromWallet(
              createOrderResponse.evm_initiate_transaction
            )
          } else {
            notifications.addNotification({
              type: "info",
              title: "Wallet signature required",
              message: "Confirm Garden source transaction in your Starknet wallet.",
            })
            const starknetCalls: Array<{
              contractAddress: string
              entrypoint: string
              calldata: string[]
            }> = []
            let approvalWasLimited = false
            if (createOrderResponse.starknet_approval_transaction) {
              const approvalTx = createOrderResponse.starknet_approval_transaction
              const safeApproval = limitBridgeApprovalToExactAmount(
                approvalTx.calldata || [],
                fromAmount,
                fromToken.symbol
              )
              approvalWasLimited = safeApproval.limited
              starknetCalls.push({
                contractAddress: approvalTx.to,
                entrypoint: normalizeGardenStarknetEntrypoint(approvalTx.selector),
                calldata: safeApproval.calldata,
              })
            }
            if (createOrderResponse.starknet_initiate_transaction) {
              starknetCalls.push({
                contractAddress: createOrderResponse.starknet_initiate_transaction.to,
                entrypoint: normalizeGardenStarknetEntrypoint(
                  createOrderResponse.starknet_initiate_transaction.selector
                ),
                calldata: createOrderResponse.starknet_initiate_transaction.calldata || [],
              })
            }
            if (!starknetCalls.length) {
              throw new Error("Garden initiate transaction is missing for Starknet source flow.")
            }
            if (approvalWasLimited) {
              notifications.addNotification({
                type: "info",
                title: "Approval safety enabled",
                message: `Approval limited to exact ${fromAmount} ${fromToken.symbol} (not unlimited).`,
              })
            }
            gardenStarknetCalls = starknetCalls
            if (starknetCalls.length > 1) {
              const approvalCall = starknetCalls[0]
              const initiateCall = starknetCalls[starknetCalls.length - 1]
              const approvalSpender = String(approvalCall?.calldata?.[0] || "").trim()
              notifications.addNotification({
                type: "info",
                title: "Wallet warning may appear",
                message:
                  `Some wallets flag any approve call as high risk. This approval is limited to exact ${fromAmount} ${fromToken.symbol} ` +
                  `(spender ${shortAddress(approvalSpender)}).`,
              })
              notifications.addNotification({
                type: "info",
                title: "Wallet signature required",
                message: `Confirm bridge approval for ${fromAmount} ${fromToken.symbol}.`,
              })
              await invokeStarknetCallsFromWallet([approvalCall], starknetProviderHint)
              notifications.addNotification({
                type: "info",
                title: "Wallet signature required",
                message: `Confirm bridge initiate ${fromAmount} ${fromToken.symbol} -> ${toToken.symbol}.`,
              })
              onchainTxHash = await invokeStarknetCallsFromWallet([initiateCall], starknetProviderHint)
            } else {
              onchainTxHash = await invokeStarknetCallsFromWallet(starknetCalls, starknetProviderHint)
            }
          }

          if (!onchainTxHash) {
            throw new Error("Bridge on-chain tx hash is missing after wallet signature.")
          }
          notifications.addNotification({
            type: "info",
            title: "Bridge pending",
            message: `Bridge ${fromAmount} ${fromToken.symbol} submitted on-chain (${onchainTxHash.slice(0, 10)}...).`,
            txHash: onchainTxHash,
            txNetwork,
          })

          const submitGardenFinalize = async (txHash: string) => {
            return executeBridge({
              ...bridgePayloadBase,
              existing_bridge_id: orderId,
              onchain_tx_hash: txHash,
            })
          }
          try {
            response = await submitGardenFinalize(onchainTxHash)
          } catch (finalizeError) {
            if (
              sourceChain === "starknet" &&
              gardenStarknetCalls &&
              gardenStarknetCalls.length >= 2 &&
              isStarknetEntrypointMissingError(finalizeError)
            ) {
              notifications.addNotification({
                type: "warning",
                title: "Retrying bridge submit",
                message:
                  "Bridge multicall hit ENTRYPOINT_NOT_FOUND. Retrying with split signatures (approve then initiate).",
              })
              const approvalCall = gardenStarknetCalls[0]
              const initiateCall = gardenStarknetCalls[gardenStarknetCalls.length - 1]
              notifications.addNotification({
                type: "info",
                title: "Wallet signature required",
                message: `Confirm bridge approval for ${fromAmount} ${fromToken.symbol}.`,
              })
              await invokeStarknetCallsFromWallet([approvalCall], starknetProviderHint)
              notifications.addNotification({
                type: "info",
                title: "Wallet signature required",
                message: `Confirm bridge initiate ${fromAmount} ${fromToken.symbol} -> ${toToken.symbol}.`,
              })
              const retryOnchainTxHash = await invokeStarknetCallsFromWallet(
                [initiateCall],
                starknetProviderHint
              )
              notifications.addNotification({
                type: "info",
                title: "Bridge pending",
                message: `Bridge ${fromAmount} ${fromToken.symbol} retry submitted (${retryOnchainTxHash.slice(0, 10)}...).`,
                txHash: retryOnchainTxHash,
                txNetwork,
              })
              response = await submitGardenFinalize(retryOnchainTxHash)
            } else {
              throw finalizeError
            }
          }
        } else {
          notifications.addNotification({
            type: "info",
            title: "Wallet signature required",
            message:
              sourceChain === "ethereum"
                ? "Confirm bridge transaction in MetaMask (StarkGate). Final value in MetaMask includes amount + L1 message fee + gas, so it may differ slightly from the UI estimate."
                : "Confirm bridge transaction in your Starknet wallet.",
          })
          onchainTxHash = await submitOnchainBridgeTx()
          if (!onchainTxHash) {
            throw new Error("Bridge on-chain tx hash is missing after wallet signature.")
          }
          notifications.addNotification({
            type: "info",
            title: "Bridge pending",
            message: `Bridge ${fromAmount} ${fromToken.symbol} submitted on-chain (${onchainTxHash.slice(0, 10)}...).`,
            txHash: onchainTxHash,
            txNetwork,
          })
          response = await executeBridge({
            ...bridgePayloadBase,
            onchain_tx_hash: onchainTxHash || undefined,
          })
        }
        const normalizedStatus = (response.status || "").toLowerCase()
        const isBridgeFinalized = normalizedStatus === "completed" || normalizedStatus === "success"
        const gardenOrderExplorerLinks =
          isGardenProvider && response.bridge_id
            ? buildGardenOrderExplorerLinks(response.bridge_id)
            : undefined
        tradeFinalized = isBridgeFinalized
        if (response.privacy_tx_hash) {
          notifications.addNotification({
            type: "info",
            title: "Garaga verification submitted",
            message: `Privacy tx ${response.privacy_tx_hash.slice(0, 12)}... was submitted on Starknet.`,
            txHash: response.privacy_tx_hash,
            txNetwork: "starknet",
          })
        }

        if (sourceChain === "bitcoin" && response.deposit_address) {
          const parsedAmountSats = Number.parseInt(String(response.deposit_amount || "0"), 10)
          const amountSats = Number.isFinite(parsedAmountSats) && parsedAmountSats > 0 ? parsedAmountSats : 0
          const btcAmountDisplay =
            amountSats > 0
              ? formatBtcFromSats(amountSats)
              : "required amount"
          setPendingBtcDeposit({
            bridgeId: response.bridge_id,
            depositAddress: response.deposit_address,
            amountSats,
            destinationChain: toChain,
            requestSource: "manual",
            burnTxHash: null,
            status: "pending_deposit",
            txHash: null,
            sourceInitiateTxHash: null,
            destinationInitiateTxHash: null,
            destinationRedeemTxHash: null,
            refundTxHash: null,
            instantRefundTx: null,
            instantRefundHash: null,
            lastUpdatedAt: Date.now(),
          })
          lastGardenOrderStatusRef.current[response.bridge_id] = "pending_deposit"
          notifications.addNotification({
            type: "info",
            title: "Bridge order created",
            message: `Order ${response.bridge_id.slice(0, 10)}... ready. Send ${btcAmountDisplay} to ${response.deposit_address} to continue settlement.`,
            txExplorerUrls: gardenOrderExplorerLinks,
          })

          if (wallet.btcAddress && amountSats > 0) {
            btcAutoSendAttempted = true
            setIsSendingBtcDeposit(true)
            try {
              notifications.addNotification({
                type: "info",
                title: "Wallet signature required",
                message: "Approve BTC transfer in UniSat/Xverse popup.",
              })
              btcDepositTxHash = await wallet.sendBtcTransaction(response.deposit_address, amountSats)
              if (!btcDepositTxHash) {
                throw new Error("BTC deposit tx hash is missing from the wallet response.")
              }
              btcAutoSendSucceeded = true
              setPendingBtcDeposit((prev: PendingBtcDepositState | null) =>
                prev && prev.bridgeId === response.bridge_id
                  ? {
                      ...prev,
                      txHash: btcDepositTxHash,
                      status: "processing",
                      lastUpdatedAt: Date.now(),
                    }
                  : prev
              )
              lastGardenOrderStatusRef.current[response.bridge_id] = "processing"
              notifications.addNotification({
                type: "success",
                title: "BTC deposit submitted",
                message: `Deposit tx ${btcDepositTxHash.slice(0, 12)}... sent to Garden address.`,
                txHash: btcDepositTxHash,
                txNetwork: "btc",
              })
              void pollGardenBridgeOrder(response.bridge_id, toChain)
              await wallet.refreshOnchainBalances()
            } catch (depositError) {
              notifications.addNotification({
                type: "warning",
                title: "Auto-send BTC skipped",
                message:
                  depositError instanceof Error
                    ? `${depositError.message} Continue with manual send via Send BTC button.`
                    : "Popup wallet dibatalkan/gagal. Continue with manual send via Send BTC button.",
              })
            } finally {
              setIsSendingBtcDeposit(false)
            }
          } else if (!wallet.btcAddress) {
            notifications.addNotification({
              type: "warning",
              title: "BTC wallet not connected",
              message: "Please connect BTC wallet to send deposit.",
            })
          }
        }

        setLastBridgeRewards((prev: BridgeRewardsSnapshot | null) => {
          if (!response.estimated_points_earned && !response.nft_discount_percent) return prev
          const estimatedPoints = Number(response.estimated_points_earned || 0)
          const discountPercent = Number(response.nft_discount_percent || 0)
          const aiBonusPercent = Number(response.ai_bonus_percent || 0)
          return {
            estimatedPoints: Number.isFinite(estimatedPoints) ? estimatedPoints : 0,
            discountPercent: Number.isFinite(discountPercent) ? discountPercent : 0,
            aiBonusPercent: Number.isFinite(aiBonusPercent) ? aiBonusPercent : 0,
            pointsPending: false,
            updatedAt: Date.now(),
          }
        })
        if (isBridgeFinalized) {
          if (btcAutoSendAttempted && !btcAutoSendSucceeded && !submittedSwapTxHash) {
            notifications.addNotification({
              type: "warning",
              title: "Bridge awaiting BTC deposit",
              message:
                "Bridge order is ready. Send BTC from wallet to continue settlement.",
              txExplorerUrls: gardenOrderExplorerLinks,
            })
          }
          if (btcAutoSendSucceeded) {
            notifications.addNotification({
              type: "info",
              title: "Bridge deposit sent",
              message: "BTC deposit submitted. Waiting for Garden settlement.",
              txHash: btcDepositTxHash || undefined,
              txNetwork: "btc",
            })
          }
        } else if (response.bridge_id) {
          void pollGardenBridgeOrder(response.bridge_id, toChain)
        }
      } else {
        const quoteSlippage = resolveTradeSlippage(activeSlippage, quote)
        const slippageValue = quoteSlippage.value
        const slippageLabel = quoteSlippage.label
        const minAmountOut = computeMinimumAmountOut(toAmount, slippageValue)
        const deadline = computeTradeDeadlineSeconds()
        const swapRequestRecipient = (receiveAddress || preferredReceiveAddress).trim()
        let response: Awaited<ReturnType<typeof executeSwap>>
        let finalTxHash: string | undefined

        let submittedPrivacyPayload = tradePrivacyPayload
        if (effectiveHideBalance && manuallySelectedHideNoteRef.current) {
          submittedPrivacyPayload = tradePrivacyPayload || loadTradePrivacyPayload()
        }

        if (effectiveHideBalance && HIDE_BALANCE_RELAYER_POOL_ENABLED) {
          notifications.addNotification({
            type: "info",
            title: "Submitting private swap",
            message: "Submitting hide-mode swap through Starknet relayer pool.",
          })
          try {
            if (HIDE_BALANCE_SHIELDED_POOL) {
              const payloadCommitment = (
                submittedPrivacyPayload?.note_commitment ||
                submittedPrivacyPayload?.commitment ||
                ""
              )
                .trim()
                .toLowerCase()
              const payloadNullifier = (submittedPrivacyPayload?.nullifier || "").trim().toLowerCase()
              const payloadIsV4 =
                (submittedPrivacyPayload?.note_version || "").toLowerCase() === "v4" ||
                HIDE_BALANCE_SHIELDED_POOL
              const payloadIsManual = isManuallySelectedHideNote(
                payloadCommitment,
                payloadNullifier
              )
              if (payloadIsV4 && submittedPrivacyPayload && !payloadIsManual && payloadCommitment) {
                const executorAddress = (submittedPrivacyPayload.executor_address || "").trim()
                if (executorAddress) {
                  try {
                    const onchainTimestamp =
                      await readStarknetShieldedPoolNoteDepositTimestampFromWallet(
                        executorAddress,
                        payloadCommitment,
                        starknetProviderHint
                      )
                    if (!onchainTimestamp || onchainTimestamp <= 0) {
                      const spendableAtUnix = await ensureHideNoteDeposited(
                        submittedPrivacyPayload
                      )
                      if (hideBalanceOnchain && submittedPrivacyPayload) {
                        shouldClearTradePrivacyPayload = true
                        persistTradePrivacyPayload(submittedPrivacyPayload)
                      }
                      if (spendableAtUnix > 0) {
                        throw new Error(
                          "HIDE_NOTE_READY::Hide note berhasil dideposit. Retry private swap now."
                        )
                      }
                      throw new Error(
                        "HIDE_NOTE_READY::Hide note berhasil dideposit. Retry private swap now."
                      )
                    } else {
                      const fallbackSpendableAt =
                        onchainTimestamp + Math.floor(HIDE_BALANCE_MIN_NOTE_AGE_MS / 1000)
                      const spendableAtUnix = Number(
                        submittedPrivacyPayload.spendable_at_unix || fallbackSpendableAt || 0
                      )
                      const remainingMs =
                        spendableAtUnix > 0
                          ? Math.max(0, spendableAtUnix * 1000 - Date.now())
                          : 0
                      if (remainingMs > 0) {
                        throw new Error(
                          `HIDE_NOTE_WAIT::Hide note belum cukup age. Tunggu ${formatRemainingDuration(
                            remainingMs
                          )} sebelum retry private swap.`
                        )
                      }
                      if (
                        submittedPrivacyPayload.spendable_at_unix === undefined &&
                        spendableAtUnix > 0
                      ) {
                        persistTradePrivacyPayload({
                          ...submittedPrivacyPayload,
                          spendable_at_unix: spendableAtUnix,
                        })
                      }
                    }
                  } catch (noteCheckError) {
                    const message =
                      noteCheckError instanceof Error
                        ? noteCheckError.message
                        : "Failed to verify hide note status."
                    if (
                      message.startsWith("HIDE_NOTE_READY::") ||
                      message.startsWith("HIDE_NOTE_WAIT::")
                    ) {
                      throw new Error(message)
                    }
                  }
                }
                const pendingNotes = loadPendingHideNotes ? loadPendingHideNotes() : []
                const matchedNote = pendingNotes.find((note: any) => {
                  const noteCommitment = (note.note_commitment || "").trim().toLowerCase()
                  const noteNullifier = (note.nullifier || "").trim().toLowerCase()
                  return noteCommitment === payloadCommitment && noteNullifier === payloadNullifier
                })
                if (matchedNote) {
                  const spendableAt = Number(
                    matchedNote.spendable_at_unix ||
                      submittedPrivacyPayload.spendable_at_unix ||
                      0
                  )
                  const remainingMs =
                    spendableAt > 0 ? Math.max(0, spendableAt * 1000 - Date.now()) : 0
                  if (remainingMs > 0) {
                    throw new Error(
                      `HIDE_NOTE_WAIT::Hide note belum cukup age. Tunggu ${formatRemainingDuration(
                        remainingMs
                      )} sebelum retry private swap.`
                    )
                  }
                } else {
                  const spendableAtUnix = await ensureHideNoteDeposited(submittedPrivacyPayload)
                  if (hideBalanceOnchain && submittedPrivacyPayload) {
                    shouldClearTradePrivacyPayload = true
                    persistTradePrivacyPayload(submittedPrivacyPayload)
                  }
                  if (spendableAtUnix > 0) {
                    throw new Error(
                      "HIDE_NOTE_READY::Hide note berhasil dideposit. Retry private swap now."
                    )
                  }
                  throw new Error(
                    "HIDE_NOTE_READY::Hide note berhasil dideposit. Retry private swap now."
                  )
                }
              }
              response = await executeSwap({
                from_token: fromToken.symbol,
                to_token: toToken.symbol,
                amount: fromAmount,
                min_amount_out: minAmountOut,
                slippage: slippageValue,
                deadline,
                recipient: swapRequestRecipient,
                mode: mevProtection ? "private" : "transparent",
                hide_balance: true,
                privacy: submittedPrivacyPayload,
              })
              finalTxHash = response.tx_hash
              submittedSwapTxHash = response.tx_hash || null
            } else {
              const fromTokenAddress = resolveTokenAddress(fromToken.symbol).trim()
              if (!fromTokenAddress) {
                throw new Error(
                  `Token address for ${fromToken.symbol} is not configured for hide-mode relayer execution.`
                )
              }
              const currentCalls: OnchainCall[] =
                quote?.type === "swap" && Array.isArray(quote.onchainCalls)
                  ? (quote.onchainCalls as OnchainCall[])
                  : []
              let swapActionCall = currentCalls.find((call) => call.entrypoint === "execute_swap")
              if (!swapActionCall) {
                const refreshedQuote = await getSwapQuote({
                  from_token: fromToken.symbol,
                  to_token: toToken.symbol,
                  amount: fromAmount,
                  slippage: slippageValue,
                  mode: mevProtection ? "private" : "transparent",
                })
                const refreshedCalls: OnchainCall[] = Array.isArray(refreshedQuote.onchain_calls)
                  ? refreshedQuote.onchain_calls
                      .filter(
                        (call: { entrypoint?: unknown }) =>
                          call &&
                          typeof call === "object" &&
                          typeof call.entrypoint === "string" &&
                          call.entrypoint
                      )
                      .map((call: { contract_address?: unknown; entrypoint?: unknown; calldata?: unknown }) => ({
                        contractAddress: String(call.contract_address || ""),
                        entrypoint: String(call.entrypoint || ""),
                        calldata: Array.isArray(call.calldata)
                          ? call.calldata.map((value: unknown) => String(value))
                          : [],
                      }))
                  : []
                swapActionCall = refreshedCalls.find((call) => call.entrypoint === "execute_swap")
              }
              if (!swapActionCall) {
                throw new Error(
                  "Swap onchain calls not available. Try again after refreshing the quote."
                )
              }
              const relayed = await executeHideViaRelayer({
                call: {
                  contractAddress: swapActionCall.contractAddress,
                  entrypoint: swapActionCall.entrypoint,
                  calldata: swapActionCall.calldata,
                },
                payload: tradePrivacyPayload,
                token_address: fromTokenAddress,
                token_symbol: fromToken.symbol,
                min_amount_out: minAmountOut,
                slippage: slippageLabel,
                deadline,
              })
              submittedPrivacyPayload = relayed.privacyPayload || submittedPrivacyPayload
              if (relayed.privacyPayload) {
                persistTradePrivacyPayload(relayed.privacyPayload)
              }
              finalTxHash = relayed.tx_hash || undefined
              submittedSwapTxHash = relayed.tx_hash || null
              response = {
                to_amount: relayed.to_amount || toAmount,
                tx_hash: relayed.tx_hash || undefined,
                privacy_tx_hash: relayed.privacy_tx_hash || undefined,
              }
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : "Private swap failed."
            if (HIDE_BALANCE_SHIELDED_POOL) {
              const noteNotRegistered = /note is not registered|note belum terdaftar|not registered yet/i.test(
                message
              )
              if (noteNotRegistered && tradePrivacyPayload) {
                try {
                  const spendableAtUnix = await ensureHideNoteDeposited(tradePrivacyPayload)
                  if (hideBalanceOnchain && tradePrivacyPayload) {
                    shouldClearTradePrivacyPayload = true
                    persistTradePrivacyPayload(tradePrivacyPayload)
                  }
                  if (spendableAtUnix > 0) {
                    throw new Error(
                      "HIDE_NOTE_READY::Hide note berhasil dideposit. Retry private swap now."
                    )
                  }
                  throw new Error(
                    "HIDE_NOTE_READY::Hide note berhasil dideposit. Retry private swap now."
                  )
                } catch (depositError) {
                  const depositMessage =
                    depositError instanceof Error ? depositError.message : "Auto-deposit failed."
                  throw new Error(
                    `HIDE_NOTE_INDEXER_WAIT::Hide note belum terdaftar dan auto-deposit gagal. Detail: ${depositMessage}`
                  )
                }
              }
              throw new Error(message)
            }
            const payloadAmount = Number.parseFloat(fromAmount || "0")
            if (payloadAmount <= 0) {
              throw new Error(message)
            }
            if (!tradePrivacyPayload) {
              throw new Error(message)
            }
            const spendableAtUnix = Number(tradePrivacyPayload?.spendable_at_unix || 0)
            const tryDeposit = await ensureHideNoteDeposited(tradePrivacyPayload)
            if (tryDeposit) {
              if (hideBalanceOnchain && tradePrivacyPayload) {
                shouldClearTradePrivacyPayload = true
                persistTradePrivacyPayload(tradePrivacyPayload)
              }
              if (message.includes("HIDE_NOTE_WAIT::")) {
                throw new Error(
                  `HIDE_NOTE_WAIT::Hide note belum cukup age. Tunggu ${message.replace("HIDE_NOTE_WAIT::", "").trim()} sebelum retry private swap.`
                )
              }
              if (message.includes("HIDE_NOTE_INDEXER_WAIT::")) {
                throw new Error(
                  `HIDE_NOTE_INDEXER_WAIT::Hide note belum terdaftar dan auto-deposit gagal. Detail: ${message}`
                )
              }
              if (spendableAtUnix > 0) {
                throw new Error(
                  "HIDE_NOTE_READY::Hide note berhasil dideposit. Retry private swap now."
                )
              }
              throw new Error(
                "HIDE_NOTE_READY::Hide note berhasil dideposit. Retry private swap now."
              )
            }
            throw new Error(
              `Hide relayer unavailable. Wallet fallback diblok agar detail swap tidak bocor di explorer. Detail: ${message}`
            )
          }
        } else {
          notifications.addNotification({
            type: "info",
            title: "Wallet signature required",
            message: "Confirm swap transaction in your Starknet wallet.",
          })
          const onchainTxHash = await submitOnchainSwapTx(tradePrivacyPayload, effectiveHideBalance)
          submittedSwapTxHash = onchainTxHash
          finalTxHash = onchainTxHash

          notifications.addNotification({
            type: "info",
            title: "Swap pending",
            message: `Swap ${fromAmount} ${fromToken.symbol} submitted on-chain (${onchainTxHash.slice(0, 10)}...).`,
            txHash: onchainTxHash,
            txNetwork: "starknet",
          })

          response = await executeSwap({
            from_token: fromToken.symbol,
            to_token: toToken.symbol,
            amount: fromAmount,
            min_amount_out: minAmountOut,
            slippage: slippageValue,
            deadline,
            recipient: swapRequestRecipient,
            onchain_tx_hash: onchainTxHash || undefined,
            mode: mevProtection ? "private" : "transparent",
            hide_balance: effectiveHideBalance,
            privacy: submittedPrivacyPayload,
          })
        }

        if (effectiveHideBalance) {
          shouldClearTradePrivacyPayload = true
          const spentNoteCommitment = (
            submittedPrivacyPayload?.note_commitment ||
            submittedPrivacyPayload?.commitment ||
            tradePrivacyPayload?.note_commitment ||
            tradePrivacyPayload?.commitment ||
            ""
          ).trim()
          const spentNullifier = (
            submittedPrivacyPayload?.nullifier ||
            tradePrivacyPayload?.nullifier ||
            ""
          ).trim()
          removePendingHideNote(spentNoteCommitment, spentNullifier)
          setPendingHideNotes(loadPendingHideNotes())
        }
        notifications.addNotification({
          type: "success",
          title: "Swap completed",
          message: `Swap ${fromAmount} ${fromToken.symbol} → ${response.to_amount} ${toToken.symbol}`,
          txHash: finalTxHash,
          txNetwork: "starknet",
        })
        const swapEstimatedPoints = Number(response.estimated_points_earned || 0)
        const swapDiscountPercent = Number(response.nft_discount_percent || 0)
        const swapDiscountSaved = Number(response.fee_discount_saved || 0)
        const hideTierLabel =
          effectiveHideBalance && hideUsdtTierBonusPercent > 0
            ? `Hide tier +${hideUsdtTierBonusPercent.toFixed(0)}% aktif.`
            : null
        const pointsLabel =
          Number.isFinite(swapEstimatedPoints) && swapEstimatedPoints > 0
            ? `Points +${swapEstimatedPoints.toFixed(2)} (estimasi)`
            : "Points +0 (estimasi)"
        const discountLabel =
          Number.isFinite(swapDiscountPercent) && swapDiscountPercent > 0
            ? `NFT discount ${swapDiscountPercent.toFixed(2)}% aktif (hemat fee ${swapDiscountSaved.toFixed(8)} ${fromToken.symbol}).`
            : "NFT discount tidak aktif di swap ini."
        notifications.addNotification({
          type: "info",
          title: "Points & Discount",
          message: `${pointsLabel}. ${discountLabel}${hideTierLabel ? ` ${hideTierLabel}` : ""}`,
        })
        if (response.privacy_tx_hash) {
          notifications.addNotification({
            type: "info",
            title: "Garaga verification submitted",
            message: `Privacy tx ${response.privacy_tx_hash.slice(0, 12)}... was submitted on Starknet.`,
            txHash: response.privacy_tx_hash,
            txNetwork: "starknet",
          })
        }
        successPopupPayload = {
          status: "success",
          title: "Swap Completed",
          message: `Swap ${fromAmount} ${fromToken.symbol} to ${response.to_amount} ${toToken.symbol} completed successfully.`,
          txHash: finalTxHash || response.privacy_tx_hash || undefined,
        }
      }
      await Promise.allSettled([wallet.refreshPortfolio(), wallet.refreshOnchainBalances()])
      const [nftState, rewardsState] = await Promise.allSettled([
        getOwnedNfts({ force: true }),
        getRewardsPoints({ force: true }),
      ])
      if (nftState.status === "fulfilled") {
        const now = Math.floor(Date.now() / 1000)
        const ownedNfts = nftState.value as NFTItem[]
        const usable = ownedNfts.find(
          (nft: NFTItem) => !nft.used && (!nft.expiry || nft.expiry > now)
        )
        setActiveNft((prev: NFTItem | null) => {
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
      if (tradeFinalized) {
        setSwapState("success")
        if (successPopupPayload) {
          openTradeResultPopup(successPopupPayload)
        }
      }
    } catch (error) {
      const rawErrorMessage = error instanceof Error ? error.message : "Failed to execute trade"
      const displayErrorMessage = /asset rule not set/i.test(rawErrorMessage)
        ? hideAssetRuleMissingMessage
        : rawErrorMessage
      if (rawErrorMessage.startsWith("HIDE_NOTE_WAIT::")) {
        manualSelectedHideNoteRetryRef.current = 0
        notifications.addNotification({
          type: "warning",
          title: "Hide note deposited",
          message: rawErrorMessage.replace("HIDE_NOTE_WAIT::", "").trim(),
        })
        setSwapState("idle")
        return
      }
      if (rawErrorMessage.startsWith("HIDE_NOTE_READY::")) {
        manualSelectedHideNoteRetryRef.current = 0
        notifications.addNotification({
          type: "info",
          title: "Hide note deposited",
          message: rawErrorMessage.replace("HIDE_NOTE_READY::", "").trim(),
        })
        setSwapState("idle")
        return
      }
      if (rawErrorMessage.startsWith("HIDE_NOTE_INDEXER_WAIT::")) {
        const [, , indexedMessage] = rawErrorMessage.split("::", 3)
        notifications.addNotification({
          type: "info",
          title: "Executor syncing",
          message:
            indexedMessage?.trim() ||
            "Hide note belum dikenali penuh oleh executor aktif. Retry private swap in a few seconds.",
        })
        setSwapState("idle")
        return
      }
      manualSelectedHideNoteRetryRef.current = 0
      const normalizedErrorMessage = rawErrorMessage.toLowerCase()
      const walletRejected =
        normalizedErrorMessage.includes("wallet signature was rejected") ||
        normalizedErrorMessage.includes("request rejected in wallet") ||
        normalizedErrorMessage.includes("user rejected") ||
        normalizedErrorMessage.includes("rejected by user") ||
        normalizedErrorMessage.includes("user denied") ||
        normalizedErrorMessage.includes("request rejected") ||
        normalizedErrorMessage.includes("transaction rejected") ||
        normalizedErrorMessage.includes("wallet rejected") ||
        normalizedErrorMessage.includes("user canceled") ||
        normalizedErrorMessage.includes("user cancelled") ||
        normalizedErrorMessage.includes("cancelled") ||
        normalizedErrorMessage.includes("canceled")
      const walletRequestPending =
        normalizedErrorMessage.includes("wallet request already pending") ||
        normalizedErrorMessage.includes("request already pending")
      if (walletRejected) {
        notifications.addNotification({
          type: "warning",
          title: "Transaksi dibatalkan",
          message: "Signature ditolak di wallet. Tidak ada transaksi yang dikirim.",
        })
        setSwapState("idle")
        return
      }
      if (walletRequestPending) {
        notifications.addNotification({
          type: "warning",
          title: "Request masih pending di wallet",
          message: "Buka extension wallet, selesaikan request yang masih terbuka, lalu coba lagi.",
        })
        setSwapState("idle")
        return
      }
      if (isCrossChain && error instanceof Error && error.message.toLowerCase().includes("xverse")) {
        notifications.addNotification({
          type: "error",
          title: "BTC address not found",
          message:
            "We could not resolve your BTC address. Check the Xverse User ID (if used) or enter a receive address manually.",
        })
      }
      const timeoutCode =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code || "").toUpperCase()
          : ""
      const isTimeoutError =
        timeoutCode === "TIMEOUT" ||
        (error instanceof Error && error.message.toLowerCase().includes("timeout"))
      if (!isCrossChain && submittedSwapTxHash && isTimeoutError) {
        if (hideBalanceOnchain) {
          shouldClearTradePrivacyPayload = true
        }
        notifications.addNotification({
          type: "warning",
          title: "Swap still processing",
          message: `Swap sudah submit on-chain (${submittedSwapTxHash.slice(0, 10)}...), tapi respons backend timeout. Cek explorer atau riwayat transaksi.`,
          txHash: submittedSwapTxHash,
          txNetwork: "starknet",
        })
        setSwapState("success")
        openTradeResultPopup({
          status: "success",
          title: "Transaction Submitted",
          message:
            "Transaction was submitted on-chain, but backend confirmation timed out. Check explorer/notifications for final status.",
          txHash: submittedSwapTxHash,
        })
        return
      }
      notifications.addNotification({
        type: "error",
        title: "Trade failed",
        message: displayErrorMessage,
      })
      openTradeResultPopup({
        status: "error",
        title: "Transaction Failed",
        message: displayErrorMessage,
        txHash: submittedSwapTxHash || undefined,
      })
      setSwapState("error")
    } finally {
      setActivePendingHideNoteSwapKey(null)
      if (hideBalanceOnchain && shouldClearTradePrivacyPayload) {
        clearTradePrivacyPayload()
        setHasTradePrivacyPayload(false)
        clearManuallySelectedHideNote()
      }
      setTimeout(() => {
        setSwapState("idle")
      }, 2500)
    }
  }

  return confirmTrade
}

// Internal helper that supports compact address display in notifications.
function shortAddress(value: string, head = 6, tail = 4): string {
  const normalized = (value || "").trim()
  if (!normalized) return "-"
  if (normalized.length <= head + tail + 3) return normalized
  return `${normalized.slice(0, head)}...${normalized.slice(-tail)}`
}
