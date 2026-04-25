"use client"

import * as React from "react"
import type { PrivacyVerificationPayload } from "@/lib/api"
import type { QuoteState, TokenWithBalance } from "@/lib/trading-types"
import type { useNotifications } from "@/hooks/notifications/use-notifications"
import type { WalletContextType } from "@/hooks/wallet/use-wallet"
import {
  preparePrivateExecution,
  getBridgeQuote,
  getSwapQuote,
} from "@/lib/api"
import {
  decimalToU256Parts,
  estimateStarkgateDepositFeeWei,
  invokeStarknetCallsFromWallet,
  invokeStarknetCallFromWallet,
  parseEstimatedMinutes,
  providerIdToFeltHex,
  readStarknetErc20AllowanceFromWallet,
  sendEvmStarkgateEthDepositFromWallet,
  toHexFelt,
  unitNumberToScaledBigInt,
} from "@/lib/onchain-trade"
import {
  ALLOWANCE_CACHE_TTL_MS,
  BRIDGE_TO_STRK_DISABLED_MESSAGE,
  HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED,
  HIDE_BALANCE_NOTE_VERSION,
  PRIVATE_ACTION_EXECUTOR_ADDRESS,
  STARKGATE_ETH_BRIDGE_ADDRESS,
  STARKGATE_ETH_TOKEN_ADDRESS,
  STARKNET_BRIDGE_AGGREGATOR_ADDRESS,
  STARKNET_ZK_PRIVACY_ROUTER_ADDRESS,
  UNSUPPORTED_BRIDGE_PAIR_MESSAGE,
  buildHideBalancePrivacyCall,
  chainFromNetwork,
  inferHideRootFromPublicInputs,
  isBridgePairSupportedForCurrentRoutes,
  isBridgeToStrkDisabledRoute,
  isStarknetEntrypointMissingError,
  isSameFeltAddress,
  normalizeHexArray,
  parseApproveCallAllowance,
  persistTradePrivacyPayload,
  resolveTokenAddress,
  resolveTokenDecimals,
} from "@/lib/trading-utils"

type UseOnchainActionsParams = {
  fromToken: TokenWithBalance
  toToken: TokenWithBalance
  fromAmount: string
  quote: QuoteState | null
  activeSlippage: string
  mevProtection: boolean
  hideBalanceOnchain: boolean
  isSwapContractEventOnly: boolean
  receiveAddress: string
  preferredReceiveAddress: string
  inferredHideDenomId: string
  selectedHideUsdtTier: { minUsdt: number }
  starknetProviderHint: "starknet" | "argentx" | "braavos"
  notifications: ReturnType<typeof useNotifications>
  wallet: WalletContextType
  resolveHideBalancePrivacyPayload: () => Promise<PrivacyVerificationPayload | undefined>
  setQuote: React.Dispatch<React.SetStateAction<QuoteState | null>>
  setHasTradePrivacyPayload: React.Dispatch<React.SetStateAction<boolean>>
}

const buildHideAssetRuleMissingMessage = (tokenSymbol: string, tierUsdt: number): string => {
  const symbol = (tokenSymbol || "").trim().toUpperCase() || "TOKEN"
  const tier = Number.isFinite(tierUsdt) && tierUsdt > 0 ? Math.trunc(tierUsdt) : 0
  if (tier > 0) {
    return `Hide Balance asset rule belum di-set untuk ${symbol} (tier $${tier}). Minta admin menjalankan set_asset_rule pada executor aktif, lalu retry swap.`
  }
  return `Hide Balance asset rule belum di-set untuk ${symbol}. Minta admin menjalankan set_asset_rule pada executor aktif, lalu retry swap.`
}

export function useOnchainActions({
  fromToken,
  toToken,
  fromAmount,
  quote,
  activeSlippage,
  mevProtection,
  hideBalanceOnchain,
  isSwapContractEventOnly,
  receiveAddress,
  preferredReceiveAddress,
  inferredHideDenomId,
  selectedHideUsdtTier,
  starknetProviderHint,
  notifications,
  wallet,
  resolveHideBalancePrivacyPayload,
  setQuote,
  setHasTradePrivacyPayload,
}: UseOnchainActionsParams) {
  const allowanceCacheRef = React.useRef<
    Map<string, { value: bigint | null; fetchedAt: number }>
  >(new Map())

  const readAllowanceCached = React.useCallback(
    async ({
      tokenAddress,
      ownerAddress,
      spender,
      providerHint,
      forceRefresh = false,
    }: {
      tokenAddress: string
      ownerAddress: string
      spender: string
      providerHint: "starknet" | "argentx" | "braavos"
      forceRefresh?: boolean
    }): Promise<bigint | null> => {
      const normalizedToken = tokenAddress.trim().toLowerCase()
      const normalizedOwner = ownerAddress.trim().toLowerCase()
      const normalizedSpender = spender.trim().toLowerCase()
      if (!normalizedToken || !normalizedOwner || !normalizedSpender) return null
      const cacheKey = `${normalizedToken}:${normalizedOwner}:${normalizedSpender}:${providerHint}`
      const now = Date.now()
      const cached = allowanceCacheRef.current.get(cacheKey)
      if (!forceRefresh && cached && now - cached.fetchedAt < ALLOWANCE_CACHE_TTL_MS) {
        return cached.value
      }
      const allowance = await readStarknetErc20AllowanceFromWallet(
        tokenAddress,
        ownerAddress,
        spender,
        providerHint
      )
      allowanceCacheRef.current.set(cacheKey, { value: allowance, fetchedAt: now })
      return allowance
    },
    []
  )

  const waitForAllowance = React.useCallback(
    async ({
      tokenAddress,
      ownerAddress,
      spender,
      requiredAllowance,
      providerHint,
      timeoutMs = 90_000,
    }: {
      tokenAddress: string
      ownerAddress: string
      spender: string
      requiredAllowance: bigint
      providerHint: "starknet" | "argentx" | "braavos"
      timeoutMs?: number
    }) => {
      const waitUntil = Date.now() + timeoutMs
      while (Date.now() < waitUntil) {
        try {
          const currentAllowance = await readAllowanceCached({
            tokenAddress,
            ownerAddress,
            spender,
            providerHint,
            forceRefresh: true,
          })
          if (currentAllowance !== null && currentAllowance >= requiredAllowance) {
            return true
          }
        } catch {
          // Ignore transient RPC/indexer reads while waiting for state propagation.
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1500))
      }
      return false
    },
    [readAllowanceCached]
  )

  const submitOnchainSwapTx = React.useCallback(
    async (
      privacyPayload?: PrivacyVerificationPayload,
      hideBalanceForTx: boolean = hideBalanceOnchain
    ) => {
      let resolvedPrivacyPayload: PrivacyVerificationPayload | null = null
      const fromChain = chainFromNetwork(fromToken.network)
      const toChain = chainFromNetwork(toToken.network)
      if (fromChain !== "starknet" || toChain !== "starknet") {
        throw new Error(
          "On-chain swap signing currently supports Starknet pairs only. Use Starknet ↔ Starknet pair or bridge mode."
        )
      }
      if (
        fromToken.symbol.toUpperCase() === "WBTC" ||
        toToken.symbol.toUpperCase() === "WBTC"
      ) {
        const wbtcAddress = resolveTokenAddress("WBTC")
        if (!wbtcAddress) {
          throw new Error(
            "NEXT_PUBLIC_TOKEN_WBTC_ADDRESS is not set. Configure the real Starknet WBTC token address."
          )
        }
      }
      if (isSwapContractEventOnly) {
        throw new Error(
          "Current swap contract is event-only and does not move real tokens yet. Enable/deploy the real swap router first."
        )
      }
      let preparedCalls = quote?.type === "swap" ? quote.onchainCalls || [] : []
      if (!preparedCalls.length) {
        const slippageValue = Number(activeSlippage || "0.5")
        const refreshedQuote = await getSwapQuote({
          from_token: fromToken.symbol,
          to_token: toToken.symbol,
          amount: fromAmount,
          slippage: Number.isFinite(slippageValue) && slippageValue >= 0 ? slippageValue : 0.5,
          mode: mevProtection ? "private" : "transparent",
        })
        const refreshedCalls =
          Array.isArray(refreshedQuote.onchain_calls) && refreshedQuote.onchain_calls.length > 0
            ? refreshedQuote.onchain_calls
                .filter((call) => {
                  return (
                    call &&
                    typeof call.contract_address === "string" &&
                    typeof call.entrypoint === "string" &&
                    Array.isArray(call.calldata)
                  )
                })
                .map((call) => ({
                  contractAddress: call.contract_address.trim(),
                  entrypoint: call.entrypoint.trim(),
                  calldata: call.calldata.map((item) => String(item)),
                }))
                .filter(
                  (call) =>
                    !!call.contractAddress &&
                    !!call.entrypoint &&
                    call.calldata.every((item) => typeof item === "string" && item.trim().length > 0)
                )
            : []
        if (!refreshedCalls.length) {
          throw new Error(
            "Swap quote does not include on-chain calldata yet. Refresh quote and try again."
          )
        }
        preparedCalls = refreshedCalls
        setQuote((prev) =>
          prev && prev.type === "swap"
            ? {
                ...prev,
                onchainCalls: refreshedCalls,
              }
            : prev
        )
      }

      let usedPrivateExecutor = false
      if (hideBalanceForTx) {
        const resolvedPayload = privacyPayload || (await resolveHideBalancePrivacyPayload())
        resolvedPrivacyPayload = resolvedPayload
        if (!resolvedPayload) {
          throw new Error(
            "Garaga payload belum siap untuk Hide Balance. Coba lagi, atau cek backend auto-proof config."
          )
        }

        if (HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED) {
          const swapActionIndex = preparedCalls.findIndex((call) => call.entrypoint === "execute_swap")
          if (swapActionIndex >= 0) {
            try {
              const swapActionCall = preparedCalls[swapActionIndex]
              const swapActionCalldata = swapActionCall.calldata.map((value) => String(value))
              const preparedPrivate = await preparePrivateExecution({
                verifier: (resolvedPayload.verifier || "garaga").trim() || "garaga",
                flow: "swap",
                action_entrypoint: swapActionCall.entrypoint,
                action_calldata: swapActionCalldata,
                privacy_payload: resolvedPayload,
                tx_context: {
                  flow: "swap",
                  from_token: fromToken.symbol,
                  to_token: toToken.symbol,
                  amount: fromAmount,
                  recipient:
                    resolvedPayload?.recipient ||
                    (receiveAddress || preferredReceiveAddress).trim() ||
                    undefined,
                  from_network: fromToken.network,
                  to_network: toToken.network,
                  noir_inputs: resolvedPayload?.noir_inputs,
                  note_version: HIDE_BALANCE_NOTE_VERSION,
                  action_target: swapActionCall.contractAddress,
                  action_selector: swapActionCall.entrypoint,
                  action_calldata: swapActionCalldata,
                  approval_token: swapActionCalldata[5]?.trim() || undefined,
                  approval_amount_low: swapActionCalldata[7]?.trim() || undefined,
                  approval_amount_high: swapActionCalldata[8]?.trim() || undefined,
                  payout_token: swapActionCalldata[6]?.trim() || undefined,
                  min_payout_low: swapActionCalldata[3]?.trim() || undefined,
                  min_payout_high: swapActionCalldata[4]?.trim() || undefined,
                  denom_id:
                    resolvedPayload?.denom_id ||
                    inferredHideDenomId,
                  note_commitment: resolvedPayload?.note_commitment,
                  note_deposit_tx_hash: resolvedPayload?.note_deposit_tx_hash,
                  spendable_at_unix: resolvedPayload?.spendable_at_unix,
                  nullifier: resolvedPayload?.nullifier,
                },
              })
              const preparedProof = normalizeHexArray(preparedPrivate.payload?.proof)
              const preparedPublicInputs = normalizeHexArray(preparedPrivate.payload?.public_inputs)
              const preparedPayload: PrivacyVerificationPayload = {
                verifier: (preparedPrivate.payload?.verifier || "garaga").trim() || "garaga",
                note_version:
                  preparedPrivate.payload?.note_version?.trim() ||
                  resolvedPayload?.note_version?.trim() ||
                  undefined,
                executor_address: preparedPrivate.payload?.executor_address?.trim() || undefined,
                root:
                  preparedPrivate.payload?.root?.trim() ||
                  inferHideRootFromPublicInputs(preparedPublicInputs) ||
                  resolvedPayload?.root?.trim() ||
                  undefined,
                nullifier:
                  preparedPrivate.payload?.nullifier?.trim() ||
                  resolvedPayload?.nullifier?.trim(),
                commitment:
                  preparedPrivate.payload?.commitment?.trim() ||
                  resolvedPayload?.commitment?.trim(),
                recipient:
                  resolvedPayload?.recipient ||
                  (receiveAddress || preferredReceiveAddress).trim() ||
                  undefined,
                note_commitment:
                  preparedPrivate.payload?.note_commitment?.trim() ||
                  resolvedPayload?.note_commitment?.trim() ||
                  undefined,
                denom_id:
                  preparedPrivate.payload?.denom_id?.trim() ||
                  resolvedPayload?.denom_id?.trim() ||
                  inferredHideDenomId,
                spendable_at_unix:
                  typeof preparedPrivate.payload?.spendable_at_unix === "number" &&
                  Number.isFinite(preparedPrivate.payload.spendable_at_unix)
                    ? Math.floor(preparedPrivate.payload.spendable_at_unix)
                    : typeof resolvedPayload?.spendable_at_unix === "number"
                    ? Math.floor(resolvedPayload.spendable_at_unix)
                    : undefined,
                proof: preparedProof,
                public_inputs: preparedPublicInputs,
              }
              persistTradePrivacyPayload(preparedPayload)
              setHasTradePrivacyPayload(true)

              const prefixCalls =
                swapActionIndex > 0
                  ? preparedCalls
                      .slice(0, swapActionIndex)
                      .filter((call) => call.entrypoint.toLowerCase() !== "approve")
                  : []
              const executorCalls = preparedPrivate.onchain_calls
                .filter(
                  (call) =>
                    call &&
                    typeof call.contract_address === "string" &&
                    typeof call.entrypoint === "string" &&
                    Array.isArray(call.calldata)
                )
                .map((call) => ({
                  contractAddress: call.contract_address.trim(),
                  entrypoint: call.entrypoint.trim(),
                  calldata: call.calldata.map((item) => String(item)),
                }))
                .filter(
                  (call) =>
                    !!call.contractAddress &&
                    !!call.entrypoint &&
                    call.calldata.every((item) => typeof item === "string" && item.trim().length > 0)
                )
              if (!executorCalls.length) {
                throw new Error("prepare-private-execution returned empty onchain_calls")
              }
              preparedCalls = [...prefixCalls, ...executorCalls]
              usedPrivateExecutor = true
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
        }
      }

      if (!usedPrivateExecutor) {
        const resolvedPayload = privacyPayload || (await resolveHideBalancePrivacyPayload())
        resolvedPrivacyPayload = resolvedPayload
        if (resolvedPayload) {
          const hasPrivacyCall = preparedCalls.some(
            (call) =>
              (call.entrypoint === "submit_private_action" || call.entrypoint === "submit_action") &&
              isSameFeltAddress(call.contractAddress, STARKNET_ZK_PRIVACY_ROUTER_ADDRESS)
          )
          if (!hasPrivacyCall) {
            const privacyCall = buildHideBalancePrivacyCall(resolvedPayload, "SWAP")
            preparedCalls = [privacyCall, ...preparedCalls]
          }
        }
      }

      if (process.env.NODE_ENV !== "production") {
        notifications.addNotification({
          type: "info",
          title: "Prepared Starknet calls",
          message: preparedCalls.map((call) => call.entrypoint).join(" -> "),
        })
      }

      let starknetCalls = preparedCalls.map((call) => ({
        contractAddress: call.contractAddress,
        entrypoint: call.entrypoint,
        calldata: call.calldata,
      }))

      const ownerAddress = (wallet.starknetAddress || wallet.address || "").trim()
      const approveIndex = starknetCalls.findIndex(
        (call) => call.entrypoint.toLowerCase() === "approve"
      )
      const hasExecuteSwap = starknetCalls.some(
        (call) => call.entrypoint.toLowerCase() === "execute_swap"
      )
      const approvalPlan =
        approveIndex >= 0 && hasExecuteSwap && ownerAddress
          ? (() => {
              const approveCall = starknetCalls[approveIndex]
              const parsed = parseApproveCallAllowance(approveCall)
              if (!parsed.tokenAddress || !parsed.spender || parsed.amount <= BigInt(0)) {
                return null
              }
              const remainingCalls = starknetCalls.filter((_, index) => index !== approveIndex)
              if (!remainingCalls.length) return null
              return {
                approveCall,
                remainingCalls,
                requiredAllowance: parsed.amount,
                spender: parsed.spender,
                tokenAddress: parsed.tokenAddress,
                ownerAddress,
              }
            })()
          : null

      if (approvalPlan) {
        let allowance: bigint | null = null
        try {
          allowance = await readAllowanceCached({
            tokenAddress: approvalPlan.tokenAddress,
            ownerAddress: approvalPlan.ownerAddress,
            spender: approvalPlan.spender,
            providerHint: starknetProviderHint,
          })
        } catch {
          allowance = null
        }
        const hasEnoughAllowance =
          allowance !== null && allowance >= approvalPlan.requiredAllowance
        if (hasEnoughAllowance) {
          starknetCalls = approvalPlan.remainingCalls
        } else {
          notifications.addNotification({
            type: "warning",
            title: "Approval required",
            message:
              "Allowance belum cukup. Approve akan dikirim dulu, lalu swap dieksekusi setelah allowance terbaca.",
          })
          await invokeStarknetCallsFromWallet([approvalPlan.approveCall], starknetProviderHint)
          const allowanceReady = await waitForAllowance({
            tokenAddress: approvalPlan.tokenAddress,
            ownerAddress: approvalPlan.ownerAddress,
            spender: approvalPlan.spender,
            requiredAllowance: approvalPlan.requiredAllowance,
            providerHint: starknetProviderHint,
          })
          if (!allowanceReady) {
            throw new Error(
              "Approval transaction sudah dikirim, tapi allowance belum terbaca di node. Tunggu 10-30 detik lalu retry swap."
            )
          }
          return invokeStarknetCallsFromWallet(approvalPlan.remainingCalls, starknetProviderHint)
        }
      }

      try {
        return await invokeStarknetCallsFromWallet(starknetCalls, starknetProviderHint)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "")
        if (/asset rule not set/i.test(message)) {
          throw new Error(
            buildHideAssetRuleMissingMessage(fromToken.symbol, selectedHideUsdtTier.minUsdt)
          )
        }
        if (approvalPlan) {
          try {
            const currentAllowance = await readAllowanceCached({
              tokenAddress: approvalPlan.tokenAddress,
              ownerAddress: approvalPlan.ownerAddress,
              spender: approvalPlan.spender,
              providerHint: starknetProviderHint,
              forceRefresh: true,
            })
            if (
              currentAllowance !== null &&
              currentAllowance < approvalPlan.requiredAllowance
            ) {
              notifications.addNotification({
                type: "warning",
                title: "Approval required",
                message:
                  "Allowance masih belum cukup. Approve akan dikirim dulu, lalu swap dieksekusi ulang.",
              })
              await invokeStarknetCallsFromWallet([approvalPlan.approveCall], starknetProviderHint)
              const allowanceReady = await waitForAllowance({
                tokenAddress: approvalPlan.tokenAddress,
                ownerAddress: approvalPlan.ownerAddress,
                spender: approvalPlan.spender,
                requiredAllowance: approvalPlan.requiredAllowance,
                providerHint: starknetProviderHint,
              })
              if (!allowanceReady) {
                throw new Error(
                  "Approval transaction sudah dikirim, tapi allowance belum terbaca di node. Tunggu 10-30 detik lalu retry swap."
                )
              }
              return invokeStarknetCallsFromWallet(approvalPlan.remainingCalls, starknetProviderHint)
            }
          } catch {
            // If allowance re-check fails, surface original error below.
          }
        }
        const hasPrivacyCall = starknetCalls.some(
          (call) =>
            call.entrypoint === "submit_private_action" || call.entrypoint === "submit_action"
        )
        const approveIndex = starknetCalls.findIndex(
          (call) => call.entrypoint.toLowerCase() === "approve"
        )
        const hasExecuteSwap = starknetCalls.some(
          (call) => call.entrypoint.toLowerCase() === "execute_swap"
        )
        if (
          !hasPrivacyCall &&
          approveIndex >= 0 &&
          hasExecuteSwap &&
          starknetCalls.length > 1 &&
          isStarknetEntrypointMissingError(error)
        ) {
          const approveCall = starknetCalls[approveIndex]
          const remainingCalls = starknetCalls.filter((_, index) => index !== approveIndex)
          notifications.addNotification({
            type: "warning",
            title: "Multicall gagal",
            message:
              "Wallet multicall gagal (ENTRYPOINT_NOT_FOUND). Coba ulang dengan dua tanda tangan: approve dulu, lalu swap.",
          })
          await invokeStarknetCallsFromWallet([approveCall], starknetProviderHint)
          return invokeStarknetCallsFromWallet(remainingCalls, starknetProviderHint)
        }
        if (isStarknetEntrypointMissingError(error)) {
          const callSummary = starknetCalls
            .map((call) => `${call.entrypoint}@${call.contractAddress}`)
            .join(" | ")
          const extraHint = resolvedPrivacyPayload
            ? "Pastikan router v4 benar (submit_action ada) dan frontend sudah restart."
            : "Pastikan entrypoint sesuai kontrak."
          notifications.addNotification({
            type: "error",
            title: "Entrypoint tidak ditemukan",
            message: `Call list: ${callSummary}. ${extraHint}`,
          })
        }
        throw error
      }
    },
    [
      activeSlippage,
      fromAmount,
      fromToken.network,
      fromToken.symbol,
      hideBalanceOnchain,
      inferredHideDenomId,
      isSwapContractEventOnly,
      mevProtection,
      notifications,
      preferredReceiveAddress,
      quote,
      receiveAddress,
      resolveHideBalancePrivacyPayload,
      selectedHideUsdtTier.minUsdt,
      setHasTradePrivacyPayload,
      setQuote,
      starknetProviderHint,
      toToken.network,
      toToken.symbol,
      wallet.address,
      wallet.starknetAddress,
    ]
  )

  const submitOnchainBridgeTx = React.useCallback(async () => {
    const fromChain = chainFromNetwork(fromToken.network)
    const toChain = chainFromNetwork(toToken.network)
    if (isBridgeToStrkDisabledRoute(fromChain, toChain, toToken.symbol)) {
      throw new Error(BRIDGE_TO_STRK_DISABLED_MESSAGE)
    }
    if (!isBridgePairSupportedForCurrentRoutes(fromChain, toChain, fromToken.symbol, toToken.symbol)) {
      throw new Error(UNSUPPORTED_BRIDGE_PAIR_MESSAGE)
    }
    const recipient = (receiveAddress || preferredReceiveAddress).trim()
    if (fromChain === "ethereum") {
      if (fromToken.symbol.toUpperCase() !== "ETH") {
        throw new Error(
          "Bridge Ethereum -> Starknet via StarkGate saat ini hanya mendukung ETH native."
        )
      }
      if (toChain !== "starknet") {
        throw new Error("Ethereum source bridge currently supports Starknet destination only.")
      }
      if (!recipient) {
        throw new Error("Starknet recipient address is required for StarkGate bridge.")
      }
      const estimatedFeeWei = await estimateStarkgateDepositFeeWei(STARKGATE_ETH_BRIDGE_ADDRESS)
      const quotedProtocolFeeWei =
        quote?.type === "bridge" && typeof quote.protocolFee === "number" && quote.protocolFee > 0
          ? unitNumberToScaledBigInt(quote.protocolFee, 18)
          : null
      return sendEvmStarkgateEthDepositFromWallet({
        bridgeAddress: STARKGATE_ETH_BRIDGE_ADDRESS,
        tokenAddress: STARKGATE_ETH_TOKEN_ADDRESS,
        amountEth: fromAmount,
        l2Recipient: recipient,
        feeWei: estimatedFeeWei ?? quotedProtocolFeeWei,
      })
    }

    if (fromChain !== "starknet") {
      throw new Error(
        "On-chain bridge signing currently supports Ethereum/Starknet sources only. Native BTC source must create an order first, then deposit to the Garden address."
      )
    }
    if (toChain === "ethereum") {
      throw new Error(
        "STRK/Starknet -> ETH Sepolia withdrawal is not fully supported end-to-end in this UI. The stable on-chain path currently is ETH Sepolia -> Starknet Sepolia only."
      )
    }

    if (!STARKNET_BRIDGE_AGGREGATOR_ADDRESS) {
      throw new Error(
        "NEXT_PUBLIC_STARKNET_BRIDGE_AGGREGATOR_ADDRESS is not set. Configure Starknet bridge aggregator address in frontend/.env.local."
      )
    }
    const activeBridgeQuote =
      quote?.type === "bridge"
        ? quote
        : await getBridgeQuote({
            from_chain: chainFromNetwork(fromToken.network),
            to_chain: chainFromNetwork(toToken.network),
            token: fromToken.symbol,
            to_token: toToken.symbol,
            amount: fromAmount,
          })

    const providerId = providerIdToFeltHex(
      (activeBridgeQuote as any).provider || (activeBridgeQuote as any).bridge_provider || ""
    )
    const [costLow, costHigh] = decimalToU256Parts(
      String((activeBridgeQuote as any).fee ?? 0),
      resolveTokenDecimals(fromToken.symbol)
    )
    const [amountLow, amountHigh] = decimalToU256Parts(fromAmount, resolveTokenDecimals(fromToken.symbol))
    const estimatedTime = parseEstimatedMinutes((activeBridgeQuote as any).estimatedTime || (activeBridgeQuote as any).estimated_time)

    return invokeStarknetCallFromWallet(
      {
        contractAddress: STARKNET_BRIDGE_AGGREGATOR_ADDRESS,
        entrypoint: "execute_bridge",
        calldata: [providerId, costLow, costHigh, toHexFelt(estimatedTime), amountLow, amountHigh],
      },
      starknetProviderHint
    )
  }, [
    fromAmount,
    fromToken.network,
    fromToken.symbol,
    preferredReceiveAddress,
    quote,
    receiveAddress,
    starknetProviderHint,
    toToken.network,
    toToken.symbol,
  ])

  return {
    readAllowanceCached,
    waitForAllowance,
    submitOnchainBridgeTx,
    submitOnchainSwapTx,
  }
}
