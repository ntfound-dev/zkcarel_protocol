"use client"

import * as React from "react"
import type { PrivacyVerificationPayload } from "@/lib/api"
import type { useNotifications } from "@/hooks/notifications/use-notifications"
import { preparePrivateExecution } from "@/lib/api"
import { decimalToU256Parts, invokeStarknetCallsFromWallet, toHexFelt } from "@/lib/onchain-trade"
import { normalizeHexArray } from "@/hooks/stake/use-stake-privacy"

type UseStakeOnchainParams = {
  notifications: ReturnType<typeof useNotifications>
  starknetProviderHint: "starknet" | "argentx" | "braavos"
  poolDecimals: Record<string, number>
  stakingCarelAddress: string
  stakingStablecoinAddress: string
  stakingWbtcAddress: string
  tokenAddresses: {
    carel: string
    usdc: string
    usdt: string
    wbtc: string
    strk: string
  }
  hideBalancePrivateExecutorEnabled: boolean
  buildHideBalancePrivacyCall: (payload: PrivacyVerificationPayload) => {
    contractAddress: string
    entrypoint: string
    calldata: string[]
  }
  persistTradePrivacyPayload: (payload: PrivacyVerificationPayload) => void
  setHasTradePrivacyPayload: React.Dispatch<React.SetStateAction<boolean>>
}

export const useStakeOnchain = ({
  notifications,
  starknetProviderHint,
  poolDecimals,
  stakingCarelAddress,
  stakingStablecoinAddress,
  stakingWbtcAddress,
  tokenAddresses,
  hideBalancePrivateExecutorEnabled,
  buildHideBalancePrivacyCall,
  persistTradePrivacyPayload,
  setHasTradePrivacyPayload,
}: UseStakeOnchainParams) => {
  const submitOnchainStakeTx = React.useCallback(
    async (
      poolSymbol: string,
      entrypoint: "stake" | "unstake",
      amount: string,
      privacyPayload?: PrivacyVerificationPayload
    ): Promise<{ txHash: string; privacyPayload?: PrivacyVerificationPayload }> => {
      const symbol = poolSymbol.toUpperCase()
      if (symbol === "BTC") {
        throw new Error("Native BTC staking will be enabled via Garden API.")
      }

      const decimals = poolDecimals[symbol] ?? 18
      const [amountLow, amountHigh] = decimalToU256Parts(amount, decimals)
      const isStake = entrypoint === "stake"

      const invokeWithHideMode = async (
        calls: Array<{ contractAddress: string; entrypoint: string; calldata: string[] }>
      ): Promise<{ txHash: string; privacyPayload?: PrivacyVerificationPayload }> => {
        if (!privacyPayload) {
          const txHash = await invokeStarknetCallsFromWallet(calls, starknetProviderHint)
          return { txHash }
        }

        if (hideBalancePrivateExecutorEnabled && calls.length > 0) {
          try {
            const actionCall = calls[calls.length - 1]
            const preCalls = calls.length > 1 ? calls.slice(0, calls.length - 1) : []
            const preparedPrivate = await preparePrivateExecution({
              verifier: (privacyPayload.verifier || "garaga").trim() || "garaga",
              flow: "stake",
              action_entrypoint: actionCall.entrypoint,
              action_calldata: actionCall.calldata,
              privacy_payload: privacyPayload,
              tx_context: {
                flow: isStake ? "stake" : "unstake",
                from_token: symbol,
                to_token: symbol,
                amount,
                from_network: "starknet",
                to_network: "starknet",
                noir_inputs: privacyPayload?.noir_inputs,
              },
            })
            const preparedProof = normalizeHexArray(preparedPrivate.payload?.proof)
            const preparedPublicInputs = normalizeHexArray(preparedPrivate.payload?.public_inputs)
            const preparedPayload: PrivacyVerificationPayload = {
              verifier: (preparedPrivate.payload?.verifier || "garaga").trim() || "garaga",
              note_version:
                preparedPrivate.payload?.note_version?.trim() ||
                privacyPayload?.note_version?.trim() ||
                undefined,
              root:
                preparedPrivate.payload?.root?.trim() ||
                privacyPayload?.root?.trim() ||
                undefined,
              nullifier: preparedPrivate.payload?.nullifier?.trim(),
              commitment: preparedPrivate.payload?.commitment?.trim(),
              note_commitment:
                preparedPrivate.payload?.note_commitment?.trim() ||
                privacyPayload?.note_commitment?.trim() ||
                undefined,
              noir_inputs: privacyPayload?.noir_inputs,
              denom_id:
                preparedPrivate.payload?.denom_id?.trim() ||
                privacyPayload?.denom_id?.trim() ||
                undefined,
              spendable_at_unix:
                typeof preparedPrivate.payload?.spendable_at_unix === "number" &&
                Number.isFinite(preparedPrivate.payload.spendable_at_unix)
                  ? Math.floor(preparedPrivate.payload.spendable_at_unix)
                  : typeof privacyPayload?.spendable_at_unix === "number"
                  ? Math.floor(privacyPayload.spendable_at_unix)
                  : undefined,
              proof:
                preparedProof.length > 0 ? preparedProof : normalizeHexArray(privacyPayload?.proof),
              public_inputs:
                preparedPublicInputs.length > 0
                  ? preparedPublicInputs
                  : normalizeHexArray(privacyPayload?.public_inputs),
            }
            persistTradePrivacyPayload(preparedPayload)
            setHasTradePrivacyPayload(true)
            const executorCalls = preparedPrivate.onchain_calls.map((call) => ({
              contractAddress: call.contract_address,
              entrypoint: call.entrypoint,
              calldata: call.calldata.map((item) => String(item)),
            }))
            const txHash = await invokeStarknetCallsFromWallet(
              [...preCalls, ...executorCalls],
              starknetProviderHint
            )
            return { txHash, privacyPayload: preparedPayload }
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

        const txHash = await invokeStarknetCallsFromWallet(
          [buildHideBalancePrivacyCall(privacyPayload), ...calls],
          starknetProviderHint
        )
        return { txHash, privacyPayload }
      }

      if (symbol === "CAREL") {
        if (!stakingCarelAddress) {
          throw new Error(
            "NEXT_PUBLIC_STARKNET_STAKING_CAREL_ADDRESS is not set. Configure CAREL staking contract address in frontend/.env.local."
          )
        }
        if (isStake) {
          return invokeWithHideMode([
            {
              contractAddress: tokenAddresses.carel,
              entrypoint: "approve",
              calldata: [stakingCarelAddress, amountLow, amountHigh],
            },
            {
              contractAddress: stakingCarelAddress,
              entrypoint: "stake",
              calldata: [amountLow, amountHigh],
            },
          ])
        }
        return invokeWithHideMode([
          {
            contractAddress: stakingCarelAddress,
            entrypoint,
            calldata: [amountLow, amountHigh],
          },
        ])
      }

      if (symbol === "USDC" || symbol === "USDT" || symbol === "STRK") {
        if (!stakingStablecoinAddress) {
          throw new Error(
            "NEXT_PUBLIC_STARKNET_STAKING_STABLECOIN_ADDRESS is not set for stablecoin staking."
          )
        }
        const tokenAddress =
          symbol === "USDC"
            ? tokenAddresses.usdc
            : symbol === "USDT"
            ? tokenAddresses.usdt
            : tokenAddresses.strk
        if (isStake) {
          return invokeWithHideMode([
            {
              contractAddress: tokenAddress,
              entrypoint: "approve",
              calldata: [stakingStablecoinAddress, amountLow, amountHigh],
            },
            {
              contractAddress: stakingStablecoinAddress,
              entrypoint: "stake",
              calldata: [tokenAddress, amountLow, amountHigh],
            },
          ])
        }
        return invokeWithHideMode([
          {
            contractAddress: stakingStablecoinAddress,
            entrypoint,
            calldata: [tokenAddress, amountLow, amountHigh],
          },
        ])
      }

      if (symbol === "WBTC") {
        if (!stakingWbtcAddress) {
          throw new Error(
            "NEXT_PUBLIC_STARKNET_STAKING_WBTC_ADDRESS is not set for WBTC staking."
          )
        }
        if (!tokenAddresses.wbtc) {
          throw new Error(
            "NEXT_PUBLIC_TOKEN_WBTC_ADDRESS is not set. Configure the real Starknet WBTC token address."
          )
        }
        if (isStake) {
          return invokeWithHideMode([
            {
              contractAddress: tokenAddresses.wbtc,
              entrypoint: "approve",
              calldata: [stakingWbtcAddress, amountLow, amountHigh],
            },
            {
              contractAddress: stakingWbtcAddress,
              entrypoint: "stake",
              calldata: [tokenAddresses.wbtc, amountLow, amountHigh],
            },
          ])
        }
        return invokeWithHideMode([
          {
            contractAddress: stakingWbtcAddress,
            entrypoint,
            calldata: [tokenAddresses.wbtc, amountLow, amountHigh],
          },
        ])
      }

      throw new Error(`Pool ${symbol} is not supported for on-chain staking.`)
    },
    [
      buildHideBalancePrivacyCall,
      hideBalancePrivateExecutorEnabled,
      notifications,
      persistTradePrivacyPayload,
      poolDecimals,
      setHasTradePrivacyPayload,
      starknetProviderHint,
      stakingWbtcAddress,
      stakingCarelAddress,
      stakingStablecoinAddress,
      tokenAddresses.carel,
      tokenAddresses.strk,
      tokenAddresses.usdc,
      tokenAddresses.usdt,
      tokenAddresses.wbtc,
    ]
  )

  const submitOnchainClaimTx = React.useCallback(
    async (
      poolSymbol: string,
      privacyPayload?: PrivacyVerificationPayload
    ): Promise<{ txHash: string; privacyPayload?: PrivacyVerificationPayload }> => {
      const symbol = poolSymbol.toUpperCase()
      if (symbol === "BTC") {
        throw new Error("Native BTC staking will be enabled via Garden API.")
      }

      const invokeWithHideMode = async (
        calls: Array<{ contractAddress: string; entrypoint: string; calldata: string[] }>
      ): Promise<{ txHash: string; privacyPayload?: PrivacyVerificationPayload }> => {
        if (!privacyPayload) {
          const txHash = await invokeStarknetCallsFromWallet(calls, starknetProviderHint)
          return { txHash }
        }

        if (hideBalancePrivateExecutorEnabled && calls.length > 0) {
          try {
            const actionCall = calls[calls.length - 1]
            const preCalls = calls.length > 1 ? calls.slice(0, calls.length - 1) : []
            const preparedPrivate = await preparePrivateExecution({
              verifier: (privacyPayload.verifier || "garaga").trim() || "garaga",
              flow: "stake",
              action_entrypoint: actionCall.entrypoint,
              action_calldata: actionCall.calldata,
              privacy_payload: privacyPayload,
              tx_context: {
                flow: "stake_claim",
                from_token: symbol,
                to_token: symbol,
                from_network: "starknet",
                to_network: "starknet",
              },
            })
            const preparedProof = normalizeHexArray(preparedPrivate.payload?.proof)
            const preparedPublicInputs = normalizeHexArray(preparedPrivate.payload?.public_inputs)
            const preparedPayload: PrivacyVerificationPayload = {
              verifier: (preparedPrivate.payload?.verifier || "garaga").trim() || "garaga",
              note_version:
                preparedPrivate.payload?.note_version?.trim() ||
                privacyPayload?.note_version?.trim() ||
                undefined,
              root:
                preparedPrivate.payload?.root?.trim() ||
                privacyPayload?.root?.trim() ||
                undefined,
              nullifier: preparedPrivate.payload?.nullifier?.trim(),
              commitment: preparedPrivate.payload?.commitment?.trim(),
              note_commitment:
                preparedPrivate.payload?.note_commitment?.trim() ||
                privacyPayload?.note_commitment?.trim() ||
                undefined,
              noir_inputs: privacyPayload?.noir_inputs,
              denom_id:
                preparedPrivate.payload?.denom_id?.trim() ||
                privacyPayload?.denom_id?.trim() ||
                undefined,
              spendable_at_unix:
                typeof preparedPrivate.payload?.spendable_at_unix === "number" &&
                Number.isFinite(preparedPrivate.payload.spendable_at_unix)
                  ? Math.floor(preparedPrivate.payload.spendable_at_unix)
                  : typeof privacyPayload?.spendable_at_unix === "number"
                  ? Math.floor(privacyPayload.spendable_at_unix)
                  : undefined,
              proof:
                preparedProof.length > 0 ? preparedProof : normalizeHexArray(privacyPayload?.proof),
              public_inputs:
                preparedPublicInputs.length > 0
                  ? preparedPublicInputs
                  : normalizeHexArray(privacyPayload?.public_inputs),
            }
            persistTradePrivacyPayload(preparedPayload)
            setHasTradePrivacyPayload(true)
            const executorCalls = preparedPrivate.onchain_calls.map((call) => ({
              contractAddress: call.contract_address,
              entrypoint: call.entrypoint,
              calldata: call.calldata.map((item) => String(item)),
            }))
            const txHash = await invokeStarknetCallsFromWallet(
              [...preCalls, ...executorCalls],
              starknetProviderHint
            )
            return { txHash, privacyPayload: preparedPayload }
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

        const txHash = await invokeStarknetCallsFromWallet(
          [buildHideBalancePrivacyCall(privacyPayload), ...calls],
          starknetProviderHint
        )
        return { txHash, privacyPayload }
      }

      if (symbol === "CAREL") {
        if (!stakingCarelAddress) {
          throw new Error(
            "NEXT_PUBLIC_STARKNET_STAKING_CAREL_ADDRESS is not set. Configure CAREL staking contract address in frontend/.env.local."
          )
        }
        return invokeWithHideMode([
          {
            contractAddress: stakingCarelAddress,
            entrypoint: "claim_rewards",
            calldata: [],
          },
        ])
      }

      if (symbol === "USDC" || symbol === "USDT" || symbol === "STRK") {
        if (!stakingStablecoinAddress) {
          throw new Error(
            "NEXT_PUBLIC_STARKNET_STAKING_STABLECOIN_ADDRESS is not set for stablecoin staking."
          )
        }
        const tokenAddress =
          symbol === "USDC"
            ? tokenAddresses.usdc
            : symbol === "USDT"
            ? tokenAddresses.usdt
            : tokenAddresses.strk
        return invokeWithHideMode([
          {
            contractAddress: stakingStablecoinAddress,
            entrypoint: "claim_rewards",
            calldata: [tokenAddress],
          },
        ])
      }

      if (symbol === "WBTC") {
        if (!stakingWbtcAddress) {
          throw new Error(
            "NEXT_PUBLIC_STARKNET_STAKING_WBTC_ADDRESS is not set for WBTC staking."
          )
        }
        if (!tokenAddresses.wbtc) {
          throw new Error(
            "NEXT_PUBLIC_TOKEN_WBTC_ADDRESS is not set. Configure the real Starknet WBTC token address."
          )
        }
        return invokeWithHideMode([
          {
            contractAddress: stakingWbtcAddress,
            entrypoint: "claim_rewards",
            calldata: [tokenAddresses.wbtc],
          },
        ])
      }

      throw new Error(`Pool ${symbol} is not supported for staking reward claim.`)
    },
    [
      buildHideBalancePrivacyCall,
      hideBalancePrivateExecutorEnabled,
      notifications,
      persistTradePrivacyPayload,
      setHasTradePrivacyPayload,
      starknetProviderHint,
      stakingWbtcAddress,
      stakingCarelAddress,
      stakingStablecoinAddress,
      tokenAddresses.strk,
      tokenAddresses.usdc,
      tokenAddresses.usdt,
      tokenAddresses.wbtc,
    ]
  )

  return { submitOnchainStakeTx, submitOnchainClaimTx }
}
