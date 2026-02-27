"use client"

import {
  preparePrivateExecution,
  relayPrivateExecution,
  type PrivacyVerificationPayload,
} from "@/lib/api"
import {
  decimalToU256Parts,
  signStarknetMessageHashFromWallet,
  type StarknetInvokeCall,
} from "@/lib/onchain-trade"

type StarknetWalletHint = "starknet" | "argentx" | "braavos"

const DEFAULT_PRIVACY_SIGNATURE_SELECTOR =
  (process.env.NEXT_PUBLIC_PRIVACY_SIGNATURE_SELECTOR || "is_valid_signature").trim()

type HideRelayerFlow = "swap" | "limit" | "stake"

type HideRelayerExecutionOptions = {
  flow: HideRelayerFlow
  actionCall: StarknetInvokeCall
  tokenAddress: string
  amount: string
  tokenDecimals: number
  providerHint?: StarknetWalletHint
  verifier?: string
  signatureSelector?: string
  nonce?: string
  deadline?: number
  txContext?: {
    flow?: string
    from_token?: string
    to_token?: string
    amount?: string
    recipient?: string
    from_network?: string
    to_network?: string
    note_version?: string
    root?: string
    intent_hash?: string
    action_hash?: string
    action_target?: string
    action_selector?: string
    calldata_hash?: string
    approval_token?: string
    payout_token?: string
    min_payout?: string
    note_commitment?: string
    denom_id?: string
    spendable_at_unix?: number
    nullifier?: string
  }
}

type HideRelayerExecutionResult = {
  txHash: string
  privacyPayload: PrivacyVerificationPayload
}

export async function executeHideViaRelayer(
  options: HideRelayerExecutionOptions
): Promise<HideRelayerExecutionResult> {
  const tokenAddress = (options.tokenAddress || "").trim()
  if (!tokenAddress) {
    throw new Error("Hide relayer requires a token address for transferFrom.")
  }
  const [amountLow, amountHigh] = decimalToU256Parts(options.amount, options.tokenDecimals)

  const prepared = await preparePrivateExecution({
    verifier: options.verifier,
    flow: options.flow,
    action_entrypoint: options.actionCall.entrypoint,
    action_calldata: options.actionCall.calldata.map((item) => String(item)),
    token: tokenAddress,
    amount_low: amountLow,
    amount_high: amountHigh,
    signature_selector:
      (options.signatureSelector || DEFAULT_PRIVACY_SIGNATURE_SELECTOR).trim() ||
      "is_valid_signature",
    nonce: options.nonce,
    deadline: options.deadline,
    tx_context: options.txContext,
  })

  const draft = prepared.relayer
  if (!draft) {
    throw new Error("prepare-private-execution did not return relayer draft payload.")
  }

  const signature = await signStarknetMessageHashFromWallet(
    draft.message_hash,
    options.providerHint || "starknet"
  )

  const relayed = await relayPrivateExecution({
    user: draft.user,
    token: draft.token,
    amount_low: draft.amount_low,
    amount_high: draft.amount_high,
    signature,
    signature_selector: draft.signature_selector,
    submit_selector: draft.submit_selector,
    execute_selector: draft.execute_selector,
    nullifier: draft.nullifier,
    commitment: draft.commitment,
    action_selector: draft.action_selector,
    nonce: draft.nonce,
    deadline: draft.deadline,
    proof: draft.proof,
    public_inputs: draft.public_inputs,
    action_calldata: draft.action_calldata,
  })

  const privacyPayload: PrivacyVerificationPayload = {
    verifier: (prepared.payload?.verifier || options.verifier || "garaga").trim() || "garaga",
    note_version: prepared.payload?.note_version?.trim() || undefined,
    root: prepared.payload?.root?.trim() || undefined,
    nullifier: prepared.payload?.nullifier?.trim(),
    commitment: prepared.payload?.commitment?.trim(),
    recipient:
      (prepared.payload as PrivacyVerificationPayload | undefined)?.recipient?.trim() ||
      options.txContext?.recipient?.trim() ||
      undefined,
    note_commitment: prepared.payload?.note_commitment?.trim() || undefined,
    denom_id: prepared.payload?.denom_id?.trim() || undefined,
    spendable_at_unix:
      typeof prepared.payload?.spendable_at_unix === "number"
        ? prepared.payload.spendable_at_unix
        : undefined,
    proof: Array.isArray(prepared.payload?.proof)
      ? prepared.payload.proof.map((item) => String(item).trim()).filter(Boolean)
      : [],
    public_inputs: Array.isArray(prepared.payload?.public_inputs)
      ? prepared.payload.public_inputs.map((item) => String(item).trim()).filter(Boolean)
      : [],
  }

  return {
    txHash: relayed.tx_hash,
    privacyPayload,
  }
}
