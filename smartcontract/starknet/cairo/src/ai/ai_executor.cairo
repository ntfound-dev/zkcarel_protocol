use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, starknet::Store)]
pub enum ActionType {
    #[default]
    Swap,
    Bridge,
    Stake,
    ClaimReward,
    MintNFT,
    MultiStep,
    Basic,
}

#[derive(Copy, Drop, Serde, PartialEq, starknet::Store)]
pub enum Status {
    #[default]
    Pending,
    Executed,
    Failed,
    Cancelled,
}

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct UserState {
    pub pending_count: u64,
    pub daily_count: u32,
    pub last_reset_day: u64,
    pub lifetime_total: u64,
}

/// @title IAIExecutor
/// @notice Defines AI action submission and execution entrypoints.
/// @dev Designed for backend-signed execution with per-user rate limits and tier-based fees.
#[starknet::interface]
pub trait IAIExecutor<TContractState> {
    /// @notice Submits an AI action after signature verification and fee collection.
    /// @dev Requires contract to be unpaused. Protected by reentrancy guard.
    ///      When signature verification is enabled, `nonce` must equal the caller's current
    ///      sequential nonce (fetch via `NoncesComponent::nonces(caller)`).
    /// @param action_type The category of action being submitted.
    /// @param params ABI-encoded action parameters.
    /// @param nonce Sequential replay-protection nonce for the caller.
    /// @param message_hash Poseidon hash of (user, action_type, params_hash, nonce, chain_id, contract).
    /// @param user_signature SRC-6 account signature over `message_hash`.
    /// @return action_id Unique monotonic identifier assigned to this action.
    fn submit_action(
        ref self: TContractState,
        action_type: ActionType,
        params: ByteArray,
        nonce: felt252,
        message_hash: felt252,
        user_signature: Span<felt252>
    ) -> u64;

    /// @notice Submits an AI action on behalf of a user using an approved plan.
    /// @dev Callable only by the registered plan router. No user signature required.
    ///      Rate limits and pending caps are still enforced.
    /// @param user Address of the user whose tier and rate limits are checked.
    /// @param action_type The category of action being submitted.
    /// @param params ABI-encoded action parameters.
    /// @param plan_id Plan identifier returned by `AIPlanRouter::approve_plan`.
    /// @return action_id Unique monotonic identifier assigned to this action.
    fn submit_action_from_plan(
        ref self: TContractState,
        user: ContractAddress,
        action_type: ActionType,
        params: ByteArray,
        plan_id: felt252
    ) -> u64;

    /// @notice Upgrades the caller to L2 tier by paying the one-time upgrade fee to the dev wallet.
    /// @dev Fee is read from `upgrade_l2_fee`, not from the per-action `level_2_price`.
    ///      Caller must have approved `upgrade_l2_fee` CAREL tokens to this contract.
    fn upgrade_to_l2(ref self: TContractState);

    /// @notice Upgrades the caller to L3 tier by paying the one-time upgrade fee to the dev wallet.
    /// @dev Fee is read from `upgrade_l3_fee`, not from the per-action `level_3_price`.
    ///      Caller must already be at L2 or below. Caller must have approved `upgrade_l3_fee` CAREL.
    fn upgrade_to_l3(ref self: TContractState);

    /// @notice Returns the current AI tier for a given user address.
    /// @param user The address to query.
    /// @return Tier value: 0 = no tier, 2 = L2, 3 = L3.
    fn get_user_tier(self: @TContractState, user: ContractAddress) -> u8;

    /// @notice Executes a single pending action, transitioning its status to Executed.
    /// @dev Callable only by the registered backend signer. Protected by reentrancy guard.
    ///      When signature verification is enabled, a valid backend signature over the action hash
    ///      is required and consumed via the verifier contract.
    /// @param action_id The action to execute.
    /// @param backend_signature Backend signer's SRC-6 signature over the action hash.
    fn execute_action(ref self: TContractState, action_id: u64, backend_signature: Span<felt252>);

    /// @notice Executes multiple pending actions in a single call.
    /// @dev Callable only by the registered backend signer. Protected by reentrancy guard.
    ///      When verification is enabled, the backend signs a Poseidon hash of all action hashes.
    ///      Batch size is capped by `max_batch_execute`.
    /// @param action_ids Ordered list of action IDs to execute.
    /// @param backend_signature Backend signer's SRC-6 signature over the aggregated batch hash.
    fn batch_execute_actions(
        ref self: TContractState,
        action_ids: Span<u64>,
        backend_signature: Span<felt252>
    );

    /// @notice Submits multiple actions in a single call without per-action signatures or fees.
    /// @dev Only available when both `signature_verification_enabled` and `fee_enabled` are false.
    ///      Requires contract to be unpaused. Rate limits and pending caps are enforced in aggregate.
    ///      All submitted actions are explicitly initialized to `Status::Pending`.
    /// @param action_type The category applied to all actions in this batch.
    /// @param params Shared ABI-encoded parameters for all actions.
    /// @param count Number of actions to submit.
    /// @return start_id The action ID of the first action; subsequent IDs are contiguous.
    fn batch_submit_actions(
        ref self: TContractState,
        action_type: ActionType,
        params: ByteArray,
        count: u64
    ) -> u64;

    /// @notice Cancels a pending action owned by the caller.
    /// @dev Only the original submitter can cancel. Action must be in `Status::Pending`.
    ///      Decrements the caller's `pending_count` by one.
    /// @param action_id The action to cancel.
    fn cancel_action(ref self: TContractState, action_id: u64);

    /// @notice Returns up to `MAX_PENDING_RESULTS` pending action IDs for a user, starting at ID 1.
    /// @dev Scans at most `max_pending_scan` entries. Use `get_pending_actions_page` for pagination.
    /// @param user The user address to query.
    /// @return Array of pending action IDs (may be shorter than MAX_PENDING_RESULTS).
    fn get_pending_actions(self: @TContractState, user: ContractAddress) -> Array<u64>;

    /// @notice Returns a page of pending action IDs for a user starting at a given offset.
    /// @dev Scans at most `max_pending_scan` entries. Returns at most `min(limit, MAX_PENDING_RESULTS)`.
    /// @param user The user address to query.
    /// @param start_offset Action ID to begin scanning from (exclusive lower bound).
    /// @param limit Maximum number of results to return.
    /// @return Array of pending action IDs within the requested page.
    fn get_pending_actions_page(
        self: @TContractState,
        user: ContractAddress,
        start_offset: u64,
        limit: u64
    ) -> Array<u64>;

    /// @notice Returns the stored Poseidon hash for an action.
    /// @param action_id The action to query.
    /// @return The action hash, or 0 if the action was submitted without signature verification.
    fn get_action_hash(self: @TContractState, action_id: u64) -> felt252;

    /// @notice Returns whether the user has remaining daily quota.
    /// @dev Resets the quota counter if the current day differs from `last_reset_day`.
    /// @param user The address to check.
    /// @return true if the user has not yet hit `rate_limit` actions today.
    fn check_rate_limit(self: @TContractState, user: ContractAddress) -> bool;

    /// @notice Submits a ZK-proven private AI action via the privacy router.
    /// @dev Requires `privacy_router` to be set. Nullifiers are checked and stored before dispatch.
    ///      Requires contract to be unpaused.
    /// @param old_root Merkle root before the state transition.
    /// @param new_root Merkle root after the state transition.
    /// @param nullifiers Nullifiers to mark as spent (replay protection).
    /// @param commitments New commitments inserted into the tree.
    /// @param public_inputs Public inputs passed to the verifier.
    /// @param proof Garaga Honk proof bytes.
    fn submit_private_ai_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @title IAIExecutorAdmin
/// @notice Owner-only configuration interface for fees, limits, and routing addresses.
#[starknet::interface]
pub trait IAIExecutorAdmin<TContractState> {
    /// @notice Updates per-action fee prices and the fee-enabled flag.
    /// @dev Asserts that existing burn amounts do not exceed the new fee levels (H-4 guard).
    ///      Does NOT change burn amounts; use `set_ai_fee_config` for atomic fee+burn updates.
    /// @param level_2_price New per-action fee for L2 tier users (in CAREL wei).
    /// @param level_3_price New per-action fee for L3 tier users (in CAREL wei).
    /// @param fee_enabled Whether to collect fees on `submit_action`.
    fn set_fee_config(ref self: TContractState, level_2_price: u256, level_3_price: u256, fee_enabled: bool);

    /// @notice Atomically updates per-action fees and their corresponding burn amounts.
    /// @dev Enforces `l2_burn <= l2_fee` and `l3_burn <= l3_fee`. Emits `AIFeeConfigUpdated`.
    /// @param l2_fee New per-action fee for L2 tier (CAREL wei).
    /// @param l3_fee New per-action fee for L3 tier (CAREL wei).
    /// @param l2_burn Amount burned per L2 action (must be <= l2_fee).
    /// @param l3_burn Amount burned per L3 action (must be <= l3_fee).
    fn set_ai_fee_config(
        ref self: TContractState,
        l2_fee: u256,
        l3_fee: u256,
        l2_burn: u256,
        l3_burn: u256
    );

    /// @notice Updates the one-time tier upgrade fees charged in `upgrade_to_l2` / `upgrade_to_l3`.
    /// @dev These are separate from the per-action fees (`level_2_price`, `level_3_price`).
    /// @param l2_fee New one-time cost to reach L2 (CAREL wei, must be > 0).
    /// @param l3_fee New one-time cost to reach L3 (CAREL wei, must be > 0).
    fn set_upgrade_fees(ref self: TContractState, l2_fee: u256, l3_fee: u256);

    /// @notice Updates the address that receives the net fee after burn.
    /// @param recipient New fee recipient address (must be non-zero).
    fn set_fee_recipient(ref self: TContractState, recipient: ContractAddress);

    /// @notice Updates the backend signer address authorized to call `execute_action`.
    /// @param signer New backend signer address (must be non-zero).
    fn set_backend_signer(ref self: TContractState, signer: ContractAddress);

    /// @notice Initiates a two-step ownership transfer to `new_admin`.
    /// @dev `new_admin` must call `accept_ownership` to complete the transfer.
    /// @param new_admin Candidate new owner address (must be non-zero).
    fn set_admin(ref self: TContractState, new_admin: ContractAddress);

    /// @notice Updates the maximum number of actions a user may submit per day.
    /// @param limit New daily action cap (in action count units).
    fn set_rate_limit(ref self: TContractState, limit: u256);

    /// @notice Returns the current daily action rate limit.
    /// @dev Exposed as an entrypoint for backend preflight readback compatibility.
    /// @return Current rate limit value.
    fn rate_limit(self: @TContractState) -> u256;

    /// @notice Enables or disables signature verification and sets the verifier contract.
    /// @dev When `enabled` is true, `verifier` must be non-zero.
    ///      When `enabled` is false, `submit_action` bypasses signature and nonce checks.
    /// @param verifier Address of the `IAISignatureVerifier` contract.
    /// @param enabled Whether to enforce user signatures on submission.
    fn set_signature_verification(ref self: TContractState, verifier: ContractAddress, enabled: bool);

    /// @notice Updates the maximum number of storage slots scanned in `get_pending_actions`.
    /// @param max_scan New scan limit (must be > 0).
    fn set_max_pending_scan(ref self: TContractState, max_scan: u64);

    /// @notice Updates the maximum number of pending actions allowed per user.
    /// @param max_actions New pending cap per user (must be > 0).
    fn set_max_actions_per_user(ref self: TContractState, max_actions: u64);

    /// @notice Updates the maximum number of actions that may be included in a single batch call.
    /// @param max_batch New batch size limit (must be > 0).
    fn set_max_batch_execute(ref self: TContractState, max_batch: u64);

    /// @notice Sets the privacy router address used by `submit_private_ai_action`.
    /// @param router Address of the `IPrivacyRouter` contract (must be non-zero).
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);

    /// @notice Updates the chain ID embedded in action hashes to prevent cross-chain replay.
    /// @dev Must be non-zero. Use Starknet chain IDs, e.g. SN_MAIN = 0x534e5f4d41494e.
    /// @param chain_id New chain ID value (must be != 0).
    fn set_chain_id(ref self: TContractState, chain_id: felt252);

    /// @notice Updates the address tokens are sent to when burned.
    /// @param burn_address New burn sink address (must be non-zero).
    fn set_burn_address(ref self: TContractState, burn_address: ContractAddress);

    /// @notice Sets the plan router address authorized to call `submit_action_from_plan`.
    /// @param router Address of the `AIPlanRouter` contract (must be non-zero).
    fn set_plan_router(ref self: TContractState, router: ContractAddress);

    /// @notice Pauses all user-facing submission entrypoints.
    /// @dev Callable only by owner. Affects `submit_action`, `submit_action_from_plan`,
    ///      `batch_submit_actions`, and `submit_private_ai_action`.
    fn pause(ref self: TContractState);

    /// @notice Unpauses user-facing submission entrypoints.
    /// @dev Callable only by owner.
    fn unpause(ref self: TContractState);
}

/// @notice Minimal ERC20 interface used for CAREL fee collection and burning.
#[starknet::interface]
pub trait IERC20<TContractState> {
    /// @notice Transfers `amount` from `sender` to `recipient` using caller's allowance.
    /// @return true on success.
    fn transfer_from(ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool;
    /// @notice Transfers `amount` from this contract to `recipient`.
    /// @return true on success.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    /// @notice Burns `amount` tokens from this contract's balance.
    fn burn(ref self: TContractState, amount: u256);
}

/// @notice Minimal interface for the AI signature verifier contract.
#[starknet::interface]
pub trait ISignatureVerifier<TContractState> {
    /// @notice Verifies a SRC-6 account signature without consuming it.
    /// @param signer The account contract that produced the signature.
    /// @param message_hash Hash that was signed.
    /// @param signature Raw signature span from the account.
    /// @return true if the signature is valid.
    fn verify_signature(
        self: @TContractState,
        signer: ContractAddress,
        message_hash: felt252,
        signature: Span<felt252>
    ) -> bool;

    /// @notice Verifies and marks the hash as consumed, preventing replay.
    /// @dev Panics if the hash has already been consumed (M-5 fix).
    /// @param signer The account contract that produced the signature.
    /// @param message_hash Hash that was signed.
    /// @param signature Raw signature span from the account.
    /// @return true if the signature is valid and was not previously consumed.
    fn verify_and_consume(
        ref self: TContractState,
        signer: ContractAddress,
        message_hash: felt252,
        signature: Span<felt252>
    ) -> bool;
}

/// @title AIExecutor
/// @notice Manages AI action requests, tier-based fee collection, and backend execution.
/// @dev Uses OZ OwnableComponent, PausableComponent, ReentrancyGuardComponent,
///      and NoncesComponent. Supports private ZK actions via the privacy router.
#[starknet::contract]
pub mod AIExecutor {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_caller_address, get_block_timestamp, get_contract_address};
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::security::pausable::PausableComponent;
    use openzeppelin::security::reentrancyguard::ReentrancyGuardComponent;
    use openzeppelin::utils::cryptography::nonces::NoncesComponent;
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use core::serde::Serde;
    use core::traits::TryInto;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_AI;
    use super::{
        ActionType, Status, UserState, IAIExecutor, IERC20Dispatcher, IERC20DispatcherTrait,
        ISignatureVerifierDispatcher, ISignatureVerifierDispatcherTrait
    };

    const ONE_CAREL: u256 = 1_000_000_000_000_000_000;
    const MAX_PENDING_RESULTS: u64 = 10;
    const TIER_L2: u8 = 2;
    const TIER_L3: u8 = 3;
    const DEFAULT_BURN_ADDRESS: felt252 =
        0x0700000000000000000000000000000000000000000000000000000000dead;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: PausableComponent, storage: pausable, event: PausableEvent);
    component!(path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent);
    component!(path: NoncesComponent, storage: nonces, event: NoncesEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;
    #[abi(embed_v0)]
    impl PausableImpl = PausableComponent::PausableImpl<ContractState>;
    impl PausableInternalImpl = PausableComponent::InternalImpl<ContractState>;
    impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;
    #[abi(embed_v0)]
    impl NoncesImpl = NoncesComponent::NoncesImpl<ContractState>;
    impl NoncesInternalImpl = NoncesComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub carel_token: ContractAddress,
        pub ai_backend_signer: ContractAddress,
        pub fee_recipient: ContractAddress,
        pub signature_verifier: ContractAddress,
        pub signature_verification_enabled: bool,
        pub action_count: u64,
        pub action_user: Map<u64, ContractAddress>,
        pub action_status: Map<u64, Status>,
        pub action_hashes: Map<u64, felt252>,
        pub private_nullifiers: Map<felt252, bool>,
        pub user_states: Map<ContractAddress, UserState>,
        pub user_tiers: Map<ContractAddress, u8>,
        pub rate_limit: u256,
        pub max_pending_scan: u64,
        pub max_actions_per_user: u64,
        pub max_batch_execute: u64,
        pub level_2_price: u256,  // per-action fee for L2 tier
        pub level_3_price: u256,  // per-action fee for L3 tier
        pub upgrade_l2_fee: u256, // one-time upgrade cost to reach L2
        pub upgrade_l3_fee: u256, // one-time upgrade cost to reach L3
        pub ai_l2_burn_amount: u256,
        pub ai_l3_burn_amount: u256,
        pub fee_enabled: bool,
        pub privacy_router: ContractAddress,
        pub plan_router: ContractAddress,
        pub burn_address: ContractAddress,
        pub chain_id: felt252,
        pub action_plan: Map<u64, felt252>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        pub pausable: PausableComponent::Storage,
        #[substorage(v0)]
        pub reentrancy_guard: ReentrancyGuardComponent::Storage,
        #[substorage(v0)]
        pub nonces: NoncesComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        AIFeeBurned: AIFeeBurned,
        TierUpgraded: TierUpgraded,
        AIFeeConfigUpdated: AIFeeConfigUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        PausableEvent: PausableComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
        #[flat]
        NoncesEvent: NoncesComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AIFeeBurned {
        pub payer: ContractAddress,
        pub action_id: u64,
        pub action_type: felt252,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TierUpgraded {
        pub user: ContractAddress,
        pub tier: u8,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AIFeeConfigUpdated {
        pub l2_fee: u256,
        pub l3_fee: u256,
        pub l2_burn: u256,
        pub l3_burn: u256,
    }

    /// @notice Initializes the AI executor with token address, backend signer, and chain ID.
    /// @dev `chain_id` must be non-zero; it is embedded in every action hash to prevent
    ///      cross-chain replay. Default per-action fees: L2 = 5 CAREL, L3 = 10 CAREL.
    ///      Default upgrade fees: L2 = 50 CAREL, L3 = 100 CAREL.
    /// @param carel_token Address of the CAREL ERC20 token used for fees.
    /// @param backend_signer Address authorized to call `execute_action`; also set as initial owner.
    /// @param chain_id Starknet chain ID (e.g. SN_MAIN = 0x534e5f4d41494e). Must be != 0.
    #[constructor]
    fn constructor(
        ref self: ContractState,
        carel_token: ContractAddress,
        backend_signer: ContractAddress,
        chain_id: felt252
    ) {
        assert!(chain_id != 0, "Chain id required");
        self.ownable.initializer(backend_signer);
        self.carel_token.write(carel_token);
        self.ai_backend_signer.write(backend_signer);
        self.fee_recipient.write(backend_signer);
        let zero: ContractAddress = 0.try_into().unwrap();
        self.signature_verifier.write(zero);
        self.signature_verification_enabled.write(false);
        self.rate_limit.write(10);
        self.max_pending_scan.write(100);
        self.max_actions_per_user.write(100);
        self.max_batch_execute.write(20);
        self.level_2_price.write(ONE_CAREL * 5);
        self.level_3_price.write(ONE_CAREL * 10);
        self.upgrade_l2_fee.write(ONE_CAREL * 50);
        self.upgrade_l3_fee.write(ONE_CAREL * 100);
        self.ai_l2_burn_amount.write(ONE_CAREL * 2);
        self.ai_l3_burn_amount.write(ONE_CAREL * 3);
        self.fee_enabled.write(true);
        let burn_address: ContractAddress = DEFAULT_BURN_ADDRESS.try_into().unwrap();
        self.burn_address.write(burn_address);
        self.chain_id.write(chain_id);
        let zero: ContractAddress = 0.try_into().unwrap();
        self.plan_router.write(zero);
    }

    /// @notice Converts an `ActionType` enum variant to its felt252 numeric representation.
    /// @param action_type The action type to convert.
    /// @return felt252 integer: Swap=0, Bridge=1, Stake=2, ClaimReward=3, MintNFT=4, MultiStep=5, Basic=6.
    fn action_type_to_felt(action_type: ActionType) -> felt252 {
        match action_type {
            ActionType::Swap => 0,
            ActionType::Bridge => 1,
            ActionType::Stake => 2,
            ActionType::ClaimReward => 3,
            ActionType::MintNFT => 4,
            ActionType::MultiStep => 5,
            ActionType::Basic => 6,
        }
    }

    /// @notice Returns the per-action fee for a given tier.
    /// @param tier User tier value (TIER_L2 or TIER_L3).
    /// @return Fee in CAREL wei, or 0 for unknown tiers.
    fn tier_fee(self: @ContractState, tier: u8) -> u256 {
        if tier == TIER_L2 {
            self.level_2_price.read()
        } else if tier == TIER_L3 {
            self.level_3_price.read()
        } else {
            0
        }
    }

    /// @notice Returns the burn portion of the per-action fee for a given tier.
    /// @param tier User tier value (TIER_L2 or TIER_L3).
    /// @return Burn amount in CAREL wei, or 0 for unknown tiers.
    fn tier_burn_amount(self: @ContractState, tier: u8) -> u256 {
        if tier == TIER_L2 {
            self.ai_l2_burn_amount.read()
        } else if tier == TIER_L3 {
            self.ai_l3_burn_amount.read()
        } else {
            0
        }
    }

    /// @notice Computes the Poseidon action hash used for signature binding.
    /// @dev Hash inputs: (user_felt, action_type_felt, params_hash, nonce, chain_id, contract_address).
    ///      `params` is first hashed individually to keep the outer array small.
    /// @param user Address of the action submitter.
    /// @param action_type The action category.
    /// @param params ABI-encoded action parameters.
    /// @param nonce The submitter's current sequential nonce.
    /// @return Poseidon hash over the six-element field array.
    fn compute_action_hash(
        self: @ContractState,
        user: ContractAddress,
        action_type: ActionType,
        params: ByteArray,
        nonce: felt252
    ) -> felt252 {
        let mut params_data: Array<felt252> = array![];
        params.serialize(ref params_data);
        let params_hash = poseidon_hash_span(params_data.span());

        let mut fields: Array<felt252> = array![];
        let user_felt: felt252 = user.into();
        fields.append(user_felt);
        fields.append(action_type_to_felt(action_type));
        fields.append(params_hash);
        fields.append(nonce);
        fields.append(self.chain_id.read());
        let contract_felt: felt252 = get_contract_address().into();
        fields.append(contract_felt);
        poseidon_hash_span(fields.span())
    }

    /// @notice Delegates signature verification and nonce consumption to the verifier contract.
    /// @param verifier_addr Address of the deployed `AISignatureVerifier`.
    /// @param signer Account address that produced the signature.
    /// @param msg_hash Hash to verify against.
    /// @param signature Raw SRC-6 signature bytes.
    /// @return true if signature is valid and was not previously consumed.
    fn verify_sig_and_consume(
        verifier_addr: ContractAddress,
        signer: ContractAddress,
        msg_hash: felt252,
        signature: Span<felt252>
    ) -> bool {
        let dispatcher = ISignatureVerifierDispatcher { contract_address: verifier_addr };
        dispatcher.verify_and_consume(signer, msg_hash, signature)
    }

    /// @notice Transitions a pending action to Executed and decrements the owner's pending count.
    /// @dev Internal helper shared by `execute_action` and `batch_execute_actions`.
    ///      Panics if the action is not found or is not in `Status::Pending`.
    /// @param action_id The action to execute.
    fn execute_action_internal(ref self: ContractState, action_id: u64) {
        let user = self.action_user.entry(action_id).read();
        assert!(!user.is_zero(), "Action not found");
        let status = self.action_status.entry(action_id).read();
        assert!(status == Status::Pending, "Action not pending");
        self.action_status.entry(action_id).write(Status::Executed);
        let mut state: UserState = self.user_states.entry(user).read();
        if state.pending_count > 0 {
            state.pending_count -= 1;
            self.user_states.entry(user).write(state);
        }
    }

    /// @notice Collects the per-action fee from `payer`, burns the burn portion, and forwards the rest.
    /// @dev Panics if `payer`'s tier has no active fee, if burn exceeds fee,
    ///      or if any token transfer fails. Emits `AIFeeBurned`.
    /// @param payer Address that pays the fee (must have approved this contract).
    /// @param action_id The action ID being paid for (used in the event).
    /// @param action_type The action type (used in the event).
    fn collect_fee(ref self: ContractState, payer: ContractAddress, action_id: u64, action_type: ActionType) {
        let tier = self.user_tiers.entry(payer).read();
        let fee = tier_fee(@self, tier);
        assert!(fee > 0, "Tier not active");
        let token = IERC20Dispatcher { contract_address: self.carel_token.read() };
        let ok = token.transfer_from(payer, get_contract_address(), fee);
        assert!(ok, "Fee transfer failed");
        let burn_amount = tier_burn_amount(@self, tier);
        assert!(burn_amount <= fee, "Burn exceeds fee");
        if burn_amount > 0 {
            token.burn(burn_amount);
        }
        let net_amount = fee - burn_amount;
        if net_amount > 0 {
            let recipient = self.fee_recipient.read();
            assert!(!recipient.is_zero(), "Fee recipient required");
            let ok = token.transfer(recipient, net_amount);
            assert!(ok, "Fee transfer failed");
        }
        self.emit(Event::AIFeeBurned(AIFeeBurned {
            payer,
            action_id,
            action_type: action_type_to_felt(action_type),
            amount: burn_amount,
        }));
    }

    #[abi(embed_v0)]
    impl AIExecutorImpl of IAIExecutor<ContractState> {
        /// @inheritdoc IAIExecutor
        fn submit_action(
            ref self: ContractState,
            action_type: ActionType,
            params: ByteArray,
            nonce: felt252,
            message_hash: felt252,
            user_signature: Span<felt252>
        ) -> u64 {
            self.pausable.assert_not_paused();
            self.reentrancy_guard.start();

            let caller = get_caller_address();
            let day = get_block_timestamp() / 86400;
            let mut state: UserState = self.user_states.entry(caller).read();
            if state.last_reset_day != day {
                state.daily_count = 0_u32;
                state.last_reset_day = day;
            }
            assert!(state.pending_count < self.max_actions_per_user.read(), "Too many pending actions");
            assert!(state.daily_count.into() < self.rate_limit.read(), "Rate limit exceeded");
            state.pending_count += 1;
            state.daily_count += 1_u32;
            state.lifetime_total += 1_u64;

            let mut action_hash: felt252 = 0;
            if self.signature_verification_enabled.read() {
                let verifier = self.signature_verifier.read();
                assert!(!verifier.is_zero(), "Verifier not set");
                assert!(nonce != 0, "Nonce required");
                self.nonces.use_checked_nonce(caller, nonce);
                let computed_hash = compute_action_hash(@self, caller, action_type, params, nonce);
                assert!(message_hash != 0, "Message hash required");
                assert!(message_hash == computed_hash, "Message hash mismatch");
                action_hash = computed_hash;
                let ok = verify_sig_and_consume(verifier, caller, action_hash, user_signature);
                assert!(ok, "Invalid user signature");
            }

            let action_id = self.action_count.read() + 1;
            if self.fee_enabled.read() {
                collect_fee(ref self, caller, action_id, action_type);
            }

            self.action_user.entry(action_id).write(caller);
            self.action_status.entry(action_id).write(Status::Pending);
            if action_hash != 0 {
                self.action_hashes.entry(action_id).write(action_hash);
            }
            self.action_count.write(action_id);
            self.user_states.entry(caller).write(state);

            self.reentrancy_guard.end();
            action_id
        }

        /// @inheritdoc IAIExecutor
        fn submit_action_from_plan(
            ref self: ContractState,
            user: ContractAddress,
            action_type: ActionType,
            params: ByteArray,
            plan_id: felt252
        ) -> u64 {
            self.pausable.assert_not_paused();
            self.reentrancy_guard.start();

            let router = self.plan_router.read();
            assert!(!router.is_zero(), "Plan router not set");
            assert!(get_caller_address() == router, "Not plan router");
            assert!(!user.is_zero(), "User required");
            assert!(plan_id != 0, "Plan id required");

            let day = get_block_timestamp() / 86400;
            let mut state: UserState = self.user_states.entry(user).read();
            if state.last_reset_day != day {
                state.daily_count = 0_u32;
                state.last_reset_day = day;
            }
            assert!(state.pending_count < self.max_actions_per_user.read(), "Too many pending actions");
            assert!(state.daily_count.into() < self.rate_limit.read(), "Rate limit exceeded");
            state.pending_count += 1;
            state.daily_count += 1_u32;
            state.lifetime_total += 1_u64;

            let action_id = self.action_count.read() + 1;
            let action_id_felt: felt252 = action_id.try_into().unwrap();
            let mut nonce_fields: Array<felt252> = array![];
            nonce_fields.append(plan_id);
            nonce_fields.append(action_id_felt);
            let nonce = poseidon_hash_span(nonce_fields.span());
            let action_hash = compute_action_hash(@self, user, action_type, params, nonce);

            if self.fee_enabled.read() {
                collect_fee(ref self, user, action_id, action_type);
            }

            self.action_user.entry(action_id).write(user);
            self.action_status.entry(action_id).write(Status::Pending);
            self.action_hashes.entry(action_id).write(action_hash);
            self.action_plan.entry(action_id).write(plan_id);
            self.action_count.write(action_id);
            self.user_states.entry(user).write(state);

            self.reentrancy_guard.end();
            action_id
        }

        /// @inheritdoc IAIExecutor
        fn upgrade_to_l2(ref self: ContractState) {
            let caller = get_caller_address();
            let current = self.user_tiers.entry(caller).read();
            assert!(current < TIER_L2, "Already L2");
            let fee = self.upgrade_l2_fee.read();
            assert!(fee > 0, "Tier price not set");
            let dev_wallet = self.fee_recipient.read();
            assert!(!dev_wallet.is_zero(), "Dev wallet required");
            let token = IERC20Dispatcher { contract_address: self.carel_token.read() };
            let ok = token.transfer_from(caller, dev_wallet, fee);
            assert!(ok, "Tier fee transfer failed");
            self.user_tiers.entry(caller).write(TIER_L2);
            self.emit(Event::TierUpgraded(TierUpgraded { user: caller, tier: TIER_L2, amount: fee }));
        }

        /// @inheritdoc IAIExecutor
        fn upgrade_to_l3(ref self: ContractState) {
            let caller = get_caller_address();
            let current = self.user_tiers.entry(caller).read();
            assert!(current < TIER_L3, "Already L3");
            let fee = self.upgrade_l3_fee.read();
            assert!(fee > 0, "Tier price not set");
            let dev_wallet = self.fee_recipient.read();
            assert!(!dev_wallet.is_zero(), "Dev wallet required");
            let token = IERC20Dispatcher { contract_address: self.carel_token.read() };
            let ok = token.transfer_from(caller, dev_wallet, fee);
            assert!(ok, "Tier fee transfer failed");
            self.user_tiers.entry(caller).write(TIER_L3);
            self.emit(Event::TierUpgraded(TierUpgraded { user: caller, tier: TIER_L3, amount: fee }));
        }

        /// @inheritdoc IAIExecutor
        fn get_user_tier(self: @ContractState, user: ContractAddress) -> u8 {
            self.user_tiers.entry(user).read()
        }

        /// @inheritdoc IAIExecutor
        fn batch_submit_actions(
            ref self: ContractState,
            action_type: ActionType,
            params: ByteArray,
            count: u64
        ) -> u64 {
            self.pausable.assert_not_paused();
            assert!(count > 0, "Count required");
            assert!(!self.signature_verification_enabled.read(), "Batch requires verification disabled");
            assert!(!self.fee_enabled.read(), "Batch requires fee disabled");

            let max_batch = self.max_batch_execute.read();
            assert!(count <= max_batch, "Batch too large");

            let caller = get_caller_address();
            let day = get_block_timestamp() / 86400;
            let mut state: UserState = self.user_states.entry(caller).read();
            if state.last_reset_day != day {
                state.daily_count = 0_u32;
                state.last_reset_day = day;
            }

            assert!(state.pending_count + count <= self.max_actions_per_user.read(), "Too many pending actions");
            let count_u32: u32 = count.try_into().unwrap();
            let new_daily: u256 = state.daily_count.into() + count.into();
            assert!(new_daily <= self.rate_limit.read(), "Rate limit exceeded");

            state.pending_count += count;
            state.daily_count += count_u32;
            state.lifetime_total += count;

            let start_id = self.action_count.read() + 1;
            let mut i: u64 = 0;
            while i < count {
                let action_id = start_id + i;
                self.action_user.entry(action_id).write(caller);
                self.action_status.entry(action_id).write(Status::Pending);
                i += 1;
            }

            self.action_count.write(start_id + count - 1);
            self.user_states.entry(caller).write(state);
            start_id
        }

        /// @inheritdoc IAIExecutor
        fn execute_action(ref self: ContractState, action_id: u64, backend_signature: Span<felt252>) {
            self.reentrancy_guard.start();
            let caller = get_caller_address();
            assert!(caller == self.ai_backend_signer.read(), "Unauthorized backend signer");

            if self.signature_verification_enabled.read() {
                let verifier = self.signature_verifier.read();
                assert!(!verifier.is_zero(), "Verifier not set");
                let action_hash = self.action_hashes.entry(action_id).read();
                assert!(action_hash != 0, "Action hash missing");
                let ok = verify_sig_and_consume(verifier, caller, action_hash, backend_signature);
                assert!(ok, "Invalid backend signature");
            }
            execute_action_internal(ref self, action_id);
            self.reentrancy_guard.end();
        }

        /// @inheritdoc IAIExecutor
        fn batch_execute_actions(
            ref self: ContractState,
            action_ids: Span<u64>,
            backend_signature: Span<felt252>
        ) {
            self.reentrancy_guard.start();
            let caller = get_caller_address();
            assert!(caller == self.ai_backend_signer.read(), "Unauthorized backend signer");
            let max_batch = self.max_batch_execute.read();
            assert!(action_ids.len().into() <= max_batch, "Batch too large");

            if self.signature_verification_enabled.read() {
                let verifier = self.signature_verifier.read();
                assert!(!verifier.is_zero(), "Verifier not set");
                let mut fields: Array<felt252> = array![];
                let contract_felt: felt252 = get_contract_address().into();
                fields.append(contract_felt);
                let caller_felt: felt252 = caller.into();
                fields.append(caller_felt);
                let total: u64 = action_ids.len().into();
                fields.append(total.into());

                let mut i: u64 = 0;
                while i < total {
                    let idx: u32 = i.try_into().unwrap();
                    let action_id = *action_ids.at(idx);
                    let action_hash = self.action_hashes.entry(action_id).read();
                    assert!(action_hash != 0, "Action hash missing");
                    fields.append(action_hash);
                    i += 1;
                };

                let batch_hash = poseidon_hash_span(fields.span());
                let ok = verify_sig_and_consume(verifier, caller, batch_hash, backend_signature);
                assert!(ok, "Invalid backend signature");
            }

            let mut j: u64 = 0;
            let total: u64 = action_ids.len().into();
            while j < total {
                let idx: u32 = j.try_into().unwrap();
                let action_id = *action_ids.at(idx);
                execute_action_internal(ref self, action_id);
                j += 1;
            };
            self.reentrancy_guard.end();
        }

        /// @inheritdoc IAIExecutor
        fn cancel_action(ref self: ContractState, action_id: u64) {
            let user = self.action_user.entry(action_id).read();
            assert!(!user.is_zero(), "Action not found");
            assert!(get_caller_address() == user, "Only user can cancel");

            let status = self.action_status.entry(action_id).read();
            assert!(status == Status::Pending, "Cannot cancel");
            self.action_status.entry(action_id).write(Status::Cancelled);
            let mut state: UserState = self.user_states.entry(user).read();
            if state.pending_count > 0 {
                state.pending_count -= 1;
                self.user_states.entry(user).write(state);
            }
        }

        /// @inheritdoc IAIExecutor
        fn get_pending_actions(self: @ContractState, user: ContractAddress) -> Array<u64> {
            let mut result = array![];
            let max_scan = self.max_pending_scan.read();
            let total = self.action_count.read();
            let mut scanned: u64 = 0;
            let mut produced: u64 = 0;
            let mut i: u64 = 1;

            while i <= total && scanned < max_scan && produced < MAX_PENDING_RESULTS {
                let action_user = self.action_user.entry(i).read();
                if action_user == user {
                    let status = self.action_status.entry(i).read();
                    if status == Status::Pending {
                        result.append(i);
                        produced += 1;
                    }
                }
                scanned += 1;
                i += 1;
            }
            result
        }

        /// @inheritdoc IAIExecutor
        fn get_pending_actions_page(
            self: @ContractState,
            user: ContractAddress,
            start_offset: u64,
            limit: u64
        ) -> Array<u64> {
            let mut result = array![];
            if limit == 0 {
                return result;
            }
            let max_scan = self.max_pending_scan.read();
            let mut remaining = if limit > MAX_PENDING_RESULTS { MAX_PENDING_RESULTS } else { limit };
            let mut scanned: u64 = 0;
            let total = self.action_count.read();
            let mut i: u64 = start_offset + 1;

            while i <= total && remaining > 0 && scanned < max_scan {
                let action_user = self.action_user.entry(i).read();
                if action_user == user {
                    let status = self.action_status.entry(i).read();
                    if status == Status::Pending {
                        result.append(i);
                        remaining -= 1;
                    }
                }
                scanned += 1;
                i += 1;
            }
            result
        }

        /// @inheritdoc IAIExecutor
        fn check_rate_limit(self: @ContractState, user: ContractAddress) -> bool {
            let day = get_block_timestamp() / 86400;
            let state: UserState = self.user_states.entry(user).read();
            let current: u32 = if state.last_reset_day == day { state.daily_count } else { 0_u32 };
            current.into() < self.rate_limit.read()
        }

        /// @inheritdoc IAIExecutor
        fn get_action_hash(self: @ContractState, action_id: u64) -> felt252 {
            self.action_hashes.entry(action_id).read()
        }

        /// @inheritdoc IAIExecutor
        fn submit_private_ai_action(
            ref self: ContractState,
            old_root: felt252,
            new_root: felt252,
            nullifiers: Span<felt252>,
            commitments: Span<felt252>,
            public_inputs: Span<felt252>,
            proof: Span<felt252>
        ) {
            self.pausable.assert_not_paused();
            let router = self.privacy_router.read();
            assert!(!router.is_zero(), "Privacy router not set");
            let total: u64 = nullifiers.len().into();
            let mut i: u64 = 0;
            while i < total {
                let idx: u32 = i.try_into().unwrap();
                let nf = *nullifiers.at(idx);
                assert!(!self.private_nullifiers.read(nf), "Nullifier already used");
                self.private_nullifiers.write(nf, true);
                i += 1;
            };
            let dispatcher = IPrivacyRouterDispatcher { contract_address: router };
            dispatcher.submit_action(
                ACTION_AI,
                old_root,
                new_root,
                nullifiers,
                commitments,
                public_inputs,
                proof
            );
        }
    }

    #[abi(embed_v0)]
    impl AIExecutorAdminImpl of super::IAIExecutorAdmin<ContractState> {
        /// @inheritdoc IAIExecutorAdmin
        fn set_fee_config(ref self: ContractState, level_2_price: u256, level_3_price: u256, fee_enabled: bool) {
            self.ownable.assert_only_owner();
            assert!(self.ai_l2_burn_amount.read() <= level_2_price, "L2 burn exceeds fee");
            assert!(self.ai_l3_burn_amount.read() <= level_3_price, "L3 burn exceeds fee");
            self.level_2_price.write(level_2_price);
            self.level_3_price.write(level_3_price);
            self.fee_enabled.write(fee_enabled);
        }

        /// @inheritdoc IAIExecutorAdmin
        fn set_ai_fee_config(
            ref self: ContractState,
            l2_fee: u256,
            l3_fee: u256,
            l2_burn: u256,
            l3_burn: u256
        ) {
            self.ownable.assert_only_owner();
            assert!(l2_burn <= l2_fee, "Burn exceeds fee");
            assert!(l3_burn <= l3_fee, "Burn exceeds fee");
            self.level_2_price.write(l2_fee);
            self.level_3_price.write(l3_fee);
            self.ai_l2_burn_amount.write(l2_burn);
            self.ai_l3_burn_amount.write(l3_burn);
            self.emit(Event::AIFeeConfigUpdated(AIFeeConfigUpdated { l2_fee, l3_fee, l2_burn, l3_burn }));
        }

        /// @inheritdoc IAIExecutorAdmin
        fn set_upgrade_fees(ref self: ContractState, l2_fee: u256, l3_fee: u256) {
            self.ownable.assert_only_owner();
            assert!(l2_fee > 0, "L2 upgrade fee required");
            assert!(l3_fee > 0, "L3 upgrade fee required");
            self.upgrade_l2_fee.write(l2_fee);
            self.upgrade_l3_fee.write(l3_fee);
        }

        /// @inheritdoc IAIExecutorAdmin
        fn set_fee_recipient(ref self: ContractState, recipient: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!recipient.is_zero(), "Recipient required");
            self.fee_recipient.write(recipient);
        }

        /// @inheritdoc IAIExecutorAdmin
        fn set_backend_signer(ref self: ContractState, signer: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!signer.is_zero(), "Backend signer required");
            self.ai_backend_signer.write(signer);
        }

        /// @inheritdoc IAIExecutorAdmin
        fn set_admin(ref self: ContractState, new_admin: ContractAddress) {
            assert!(!new_admin.is_zero(), "Admin required");
            self.ownable.transfer_ownership(new_admin);
        }

        /// @inheritdoc IAIExecutorAdmin
        fn set_rate_limit(ref self: ContractState, limit: u256) {
            self.ownable.assert_only_owner();
            self.rate_limit.write(limit);
        }

        /// @inheritdoc IAIExecutorAdmin
        fn rate_limit(self: @ContractState) -> u256 {
            self.rate_limit.read()
        }

        /// @inheritdoc IAIExecutorAdmin
        fn set_signature_verification(ref self: ContractState, verifier: ContractAddress, enabled: bool) {
            self.ownable.assert_only_owner();
            if enabled {
                assert!(!verifier.is_zero(), "Verifier required");
            }
            self.signature_verifier.write(verifier);
            self.signature_verification_enabled.write(enabled);
        }

        /// @inheritdoc IAIExecutorAdmin
        fn set_max_pending_scan(ref self: ContractState, max_scan: u64) {
            self.ownable.assert_only_owner();
            assert!(max_scan > 0, "Max scan required");
            self.max_pending_scan.write(max_scan);
        }

        /// @inheritdoc IAIExecutorAdmin
        fn set_max_actions_per_user(ref self: ContractState, max_actions: u64) {
            self.ownable.assert_only_owner();
            assert!(max_actions > 0, "Max actions required");
            self.max_actions_per_user.write(max_actions);
        }

        /// @inheritdoc IAIExecutorAdmin
        fn set_max_batch_execute(ref self: ContractState, max_batch: u64) {
            self.ownable.assert_only_owner();
            assert!(max_batch > 0, "Max batch required");
            self.max_batch_execute.write(max_batch);
        }

        /// @inheritdoc IAIExecutorAdmin
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        /// @inheritdoc IAIExecutorAdmin
        fn set_chain_id(ref self: ContractState, chain_id: felt252) {
            self.ownable.assert_only_owner();
            assert!(chain_id != 0, "Chain id required");
            self.chain_id.write(chain_id);
        }

        /// @inheritdoc IAIExecutorAdmin
        fn set_burn_address(ref self: ContractState, burn_address: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!burn_address.is_zero(), "Burn address required");
            self.burn_address.write(burn_address);
        }

        /// @inheritdoc IAIExecutorAdmin
        fn set_plan_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Plan router required");
            self.plan_router.write(router);
        }

        /// @inheritdoc IAIExecutorAdmin
        fn pause(ref self: ContractState) {
            self.ownable.assert_only_owner();
            self.pausable.pause();
        }

        /// @inheritdoc IAIExecutorAdmin
        fn unpause(ref self: ContractState) {
            self.ownable.assert_only_owner();
            self.pausable.unpause();
        }
    }
}
