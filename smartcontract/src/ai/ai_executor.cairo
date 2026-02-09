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

#[derive(Copy, Drop, Serde, starknet::Store)]
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
    pub lifetime_total: u128,
}

/// @title AI Executor Interface
/// @author CAREL Team
/// @notice Defines AI action submission and execution entrypoints.
/// @dev Designed for backend-signed execution with user rate limits.
#[starknet::interface]
pub trait IAIExecutor<TContractState> {
    /// @notice Submits an AI action request.
    /// @dev Applies rate limits and optional fee collection.
    /// @param action_type Type of action to execute.
    /// @param params Encoded action parameters.
    /// @param user_signature User signature for authorization.
    /// @return action_id Newly created action id.
    fn submit_action(
        ref self: TContractState, 
        action_type: ActionType, 
        params: ByteArray, 
        user_signature: Span<felt252>
    ) -> u64;
    /// @notice Executes a pending AI action.
    /// @dev Backend signer only to ensure trusted execution.
    /// @param action_id Action id to execute.
    /// @param backend_signature Backend signature for verification.
    fn execute_action(ref self: TContractState, action_id: u64, backend_signature: Span<felt252>);
    /// @notice Executes multiple pending AI actions in a batch.
    /// @dev Backend signer only; capped to avoid large loops.
    /// @param action_ids Action ids to execute.
    /// @param backend_signature Backend signature for verification.
    fn batch_execute_actions(
        ref self: TContractState,
        action_ids: Span<u64>,
        backend_signature: Span<felt252>
    );
    /// @notice Submits multiple AI actions in a batch.
    /// @dev Requires signature verification and fees disabled to save gas.
    /// @param action_type Type of action to execute.
    /// @param params Encoded action parameters (shared for the batch).
    /// @param count Number of actions to submit.
    /// @return start_id First action id in the batch.
    fn batch_submit_actions(
        ref self: TContractState,
        action_type: ActionType,
        params: ByteArray,
        count: u64
    ) -> u64;
    /// @notice Cancels a pending AI action.
    /// @dev Only the action owner can cancel.
    /// @param action_id Action id to cancel.
    fn cancel_action(ref self: TContractState, action_id: u64);
    /// @notice Returns pending action ids for a user.
    /// @dev Read-only helper for UI.
    /// @param user User address.
    /// @return actions Array of pending action ids.
    fn get_pending_actions(self: @TContractState, user: ContractAddress) -> Array<u64>;
    /// @notice Returns pending action ids for a user with pagination.
    /// @dev Scans a bounded range to avoid unbounded loops.
    /// @param user User address.
    /// @param start_offset Starting offset within the user's pending queue.
    /// @param limit Max number of ids to return.
    /// @return actions Array of pending action ids.
    fn get_pending_actions_page(
        self: @TContractState,
        user: ContractAddress,
        start_offset: u64,
        limit: u64
    ) -> Array<u64>;
    /// @notice Checks if a user is within rate limit.
    /// @dev Read-only helper for off-chain gating.
    /// @param user User address.
    /// @return allowed True if the user can submit.
    fn check_rate_limit(self: @TContractState, user: ContractAddress) -> bool;
    /// @notice Submits a private AI action proof.
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

/// @title AI Executor Admin Interface
/// @author CAREL Team
/// @notice Administrative controls for AI executor fees and limits.
/// @dev Owner-only configuration for pricing and rate limits.
#[starknet::interface]
pub trait IAIExecutorAdmin<TContractState> {
    /// @notice Updates fee configuration for AI levels.
    /// @dev Admin-only to prevent unauthorized pricing changes.
    /// @param level_2_price Fee for level 2 actions.
    /// @param level_3_price Fee for level 3 actions.
    /// @param fee_enabled Global fee toggle.
    fn set_fee_config(ref self: TContractState, level_2_price: u256, level_3_price: u256, fee_enabled: bool);
    /// @notice Updates the fee recipient address.
    /// @dev Admin-only to secure fee routing.
    /// @param recipient New fee recipient address.
    fn set_fee_recipient(ref self: TContractState, recipient: ContractAddress);
    /// @notice Updates per-user rate limit.
    /// @dev Admin-only to manage throughput.
    /// @param limit New rate limit value.
    fn set_rate_limit(ref self: TContractState, limit: u256);
    /// @notice Enables or disables signature verification.
    /// @dev Admin-only to configure verifier integration.
    /// @param verifier Signature verifier contract address.
    /// @param enabled Enable flag.
    fn set_signature_verification(ref self: TContractState, verifier: ContractAddress, enabled: bool);
    /// @notice Sets max action ids scanned in pending queries.
    /// @dev Admin-only to cap read loops.
    /// @param max_scan Maximum ids to scan per call.
    fn set_max_pending_scan(ref self: TContractState, max_scan: u64);
    /// @notice Sets max pending actions allowed per user.
    /// @dev Admin-only to prevent unbounded growth.
    /// @param max_actions Maximum pending actions per user.
    fn set_max_actions_per_user(ref self: TContractState, max_actions: u64);
    /// @notice Sets max batch size for batch execution.
    /// @dev Admin-only to cap loop cost.
    /// @param max_batch Maximum batch size.
    fn set_max_batch_execute(ref self: TContractState, max_batch: u64);
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
}

/// @title ERC20 Minimal Interface
/// @author CAREL Team
/// @notice Minimal ERC20 interface for fee collection.
/// @dev Used for CAREL token transfers.
#[starknet::interface]
pub trait IERC20<TContractState> {
    /// @notice Transfers tokens from a sender to a recipient.
    /// @dev Used to collect AI fees from users.
    /// @param sender Token holder address.
    /// @param recipient Fee recipient address.
    /// @param amount Amount to transfer.
    /// @return success True if transfer succeeded.
    fn transfer_from(ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool;
    /// @notice Burns tokens held by the caller.
    /// @dev Requires the caller to have burn privileges.
    /// @param amount Amount to burn.
    fn burn(ref self: TContractState, amount: u256);
}

#[starknet::interface]
pub trait ISignatureVerifier<TContractState> {
    fn verify_signature(
        self: @TContractState,
        signer: ContractAddress,
        message_hash: felt252,
        signature: Span<felt252>
    ) -> bool;
    fn verify_and_consume(
        ref self: TContractState,
        signer: ContractAddress,
        message_hash: felt252,
        signature: Span<felt252>
    ) -> bool;
}
/// @title AI Executor Contract
/// @author CAREL Team
/// @notice Manages AI action requests and backend execution.
/// @dev Stores action metadata and enforces rate limits.
#[starknet::contract]
pub mod AIExecutor {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_caller_address, get_block_timestamp, get_contract_address};
    use core::num::traits::Zero;
    use core::traits::TryInto;
    use core::poseidon::poseidon_hash_span;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_AI;
    use super::{
        ActionType, Status, UserState, IAIExecutor, IERC20Dispatcher, IERC20DispatcherTrait,
        ISignatureVerifierDispatcher, ISignatureVerifierDispatcherTrait
    };

    const ONE_CAREL: u256 = 1_000_000_000_000_000_000;
    const MAX_PENDING_RESULTS: u64 = 10;

    #[storage]
    pub struct Storage {
        pub carel_token: ContractAddress,
        pub ai_backend_signer: ContractAddress,
        pub admin: ContractAddress,
        pub fee_recipient: ContractAddress,
        pub signature_verifier: ContractAddress,
        pub signature_verification_enabled: bool,
        pub action_count: u64,
        pub action_user: Map<u64, ContractAddress>,
        pub action_status: Map<u64, Status>,
        pub action_hashes: Map<u64, felt252>,
        pub user_states: Map<ContractAddress, UserState>,
        pub rate_limit: u256,
        pub max_pending_scan: u64,
        pub max_actions_per_user: u64,
        pub max_batch_execute: u64,
        pub level_2_price: u256,
        pub level_3_price: u256,
        pub fee_enabled: bool,
        pub privacy_router: ContractAddress,
    }

    /// @notice Initializes the AI executor.
    /// @dev Sets token, backend signer, and default fee/rate settings.
    /// @param carel_token CAREL token address for fee collection.
    /// @param backend_signer Backend signer address.
    #[constructor]
    fn constructor(
        ref self: ContractState, 
        carel_token: ContractAddress, 
        backend_signer: ContractAddress
    ) {
        self.carel_token.write(carel_token);
        self.ai_backend_signer.write(backend_signer);
        self.admin.write(backend_signer);
        self.fee_recipient.write(backend_signer);
        let zero: ContractAddress = 0.try_into().unwrap();
        self.signature_verifier.write(zero);
        self.signature_verification_enabled.write(false);
        self.rate_limit.write(10);
        self.max_pending_scan.write(100);
        self.max_actions_per_user.write(100);
        self.max_batch_execute.write(20);
        self.level_2_price.write(ONE_CAREL); 
        self.level_3_price.write(ONE_CAREL * 2); 
        self.fee_enabled.write(true);
    }

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

    fn compute_action_hash(
        user: ContractAddress,
        action_type: ActionType,
        params: ByteArray,
        timestamp: u64
    ) -> felt252 {
        let mut data = array![];
        user.serialize(ref data);
        action_type_to_felt(action_type).serialize(ref data);
        params.serialize(ref data);
        timestamp.serialize(ref data);
        poseidon_hash_span(data.span())
    }

    fn verify_sig_and_consume(
        verifier_addr: ContractAddress,
        signer: ContractAddress,
        msg_hash: felt252,
        signature: Span<felt252>
    ) -> bool {
        let dispatcher = ISignatureVerifierDispatcher { contract_address: verifier_addr };
        dispatcher.verify_and_consume(signer, msg_hash, signature)
    }

    #[abi(embed_v0)]
    impl AIExecutorImpl of IAIExecutor<ContractState> {
        /// @notice Submits an AI action request.
        /// @dev Applies rate limits and optional fee collection.
        /// @param action_type Type of action to execute.
        /// @param params Encoded action parameters.
        /// @param user_signature User signature for authorization.
        /// @return action_id Newly created action id.
        fn submit_action(
            ref self: ContractState, 
            action_type: ActionType, 
            params: ByteArray, 
            user_signature: Span<felt252>
        ) -> u64 {
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
            state.lifetime_total += 1_u128;

            let now = get_block_timestamp();
            let mut action_hash: felt252 = 0;
            if self.signature_verification_enabled.read() {
                let verifier = self.signature_verifier.read();
                assert!(!verifier.is_zero(), "Verifier not set");
                action_hash = compute_action_hash(caller, action_type, params, now);
                let ok = verify_sig_and_consume(verifier, caller, action_hash, user_signature);
                assert!(ok, "Invalid user signature");
            }

            let mut fee: u256 = 0;
            if self.fee_enabled.read() {
                fee = match action_type {
                    ActionType::MultiStep => self.level_3_price.read(),
                    ActionType::Basic => 0,
                    _ => self.level_2_price.read(),
                };

                if fee > 0 {
                    let token = IERC20Dispatcher { contract_address: self.carel_token.read() };
                    let ok = token.transfer_from(caller, get_contract_address(), fee);
                    assert!(ok, "Fee transfer failed");
                    token.burn(fee);
                }
            }

            let action_id = self.action_count.read() + 1;

            self.action_user.entry(action_id).write(caller);
            if action_hash != 0 {
                self.action_hashes.entry(action_id).write(action_hash);
            }
            self.action_count.write(action_id);
            self.user_states.entry(caller).write(state);
            action_id
        }

        fn batch_submit_actions(
            ref self: ContractState,
            action_type: ActionType,
            params: ByteArray,
            count: u64
        ) -> u64 {
            assert!(count > 0, "Count required");
            // Keep batch fast-path only when verification/fees disabled.
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
            state.lifetime_total += count.into();

            let start_id = self.action_count.read() + 1;
            let mut i: u64 = 0;
            while i < count {
                let action_id = start_id + i;
                self.action_user.entry(action_id).write(caller);
                i += 1;
            }

            self.action_count.write(start_id + count - 1);
            self.user_states.entry(caller).write(state);
            start_id
        }

        /// @notice Executes a pending AI action.
        /// @dev Backend signer only to ensure trusted execution.
        /// @param action_id Action id to execute.
        /// @param backend_signature Backend signature for verification.
        fn execute_action(ref self: ContractState, action_id: u64, backend_signature: Span<felt252>) {
            let caller = get_caller_address();
            assert!(caller == self.ai_backend_signer.read(), "Unauthorized backend signer");

            let user = self.action_user.entry(action_id).read();
            assert!(!user.is_zero(), "Action not found");
            let status = self.action_status.entry(action_id).read();
            if let Status::Pending = status {
                // ok
            } else {
                panic!("Action not pending");
            }
            if self.signature_verification_enabled.read() {
                let verifier = self.signature_verifier.read();
                assert!(!verifier.is_zero(), "Verifier not set");
                let action_hash = self.action_hashes.entry(action_id).read();
                assert!(action_hash != 0, "Action hash missing");
                let ok = verify_sig_and_consume(verifier, caller, action_hash, backend_signature);
                assert!(ok, "Invalid backend signature");
            }
            self.action_status.entry(action_id).write(Status::Executed);
            let mut state: UserState = self.user_states.entry(user).read();
            if state.pending_count > 0 {
                state.pending_count -= 1;
                self.user_states.entry(user).write(state);
            }
        }

        fn batch_execute_actions(
            ref self: ContractState,
            action_ids: Span<u64>,
            backend_signature: Span<felt252>
        ) {
            let caller = get_caller_address();
            assert!(caller == self.ai_backend_signer.read(), "Unauthorized backend signer");
            let max_batch = self.max_batch_execute.read();
            assert!(action_ids.len().into() <= max_batch, "Batch too large");

            let mut i: u64 = 0;
            let total: u64 = action_ids.len().into();
            while i < total {
                let idx: u32 = i.try_into().unwrap();
                let action_id = *action_ids.at(idx);
                self.execute_action(action_id, backend_signature);
                i += 1;
            };
        }

        /// @notice Cancels a pending AI action.
        /// @dev Only the action owner can cancel.
        /// @param action_id Action id to cancel.
        fn cancel_action(ref self: ContractState, action_id: u64) {
            let user = self.action_user.entry(action_id).read();
            assert!(!user.is_zero(), "Action not found");
            assert!(get_caller_address() == user, "Only user can cancel");

            let status = self.action_status.entry(action_id).read();
            if let Status::Pending = status {
                self.action_status.entry(action_id).write(Status::Cancelled);
                let mut state: UserState = self.user_states.entry(user).read();
                if state.pending_count > 0 {
                    state.pending_count -= 1;
                    self.user_states.entry(user).write(state);
                }
            } else {
                panic!("Cannot cancel");
            }
        }

        /// @notice Returns pending action ids for a user.
        /// @dev Read-only helper for UI.
        /// @param user User address.
        /// @return actions Array of pending action ids.
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
                    if let Status::Pending = status {
                        result.append(i);
                        produced += 1;
                    }
                }
                scanned += 1;
                i += 1;
            }
            result
        }

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
                    if let Status::Pending = status {
                        result.append(i);
                        remaining -= 1;
                    }
                }
                scanned += 1;
                i += 1;
            }
            result
        }

        /// @notice Checks if a user is within rate limit.
        /// @dev Read-only helper for off-chain gating.
        /// @param user User address.
        /// @return allowed True if the user can submit.
        fn check_rate_limit(self: @ContractState, user: ContractAddress) -> bool {
            let day = get_block_timestamp() / 86400;
            let state: UserState = self.user_states.entry(user).read();
            let current: u32 = if state.last_reset_day == day { state.daily_count } else { 0_u32 };
            current.into() < self.rate_limit.read()
        }

        fn submit_private_ai_action(
            ref self: ContractState,
            old_root: felt252,
            new_root: felt252,
            nullifiers: Span<felt252>,
            commitments: Span<felt252>,
            public_inputs: Span<felt252>,
            proof: Span<felt252>
        ) {
            let router = self.privacy_router.read();
            assert!(!router.is_zero(), "Privacy router not set");
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
        /// @notice Updates fee configuration for AI levels.
        /// @dev Admin-only to prevent unauthorized pricing changes.
        /// @param level_2_price Fee for level 2 actions.
        /// @param level_3_price Fee for level 3 actions.
        /// @param fee_enabled Global fee toggle.
        fn set_fee_config(ref self: ContractState, level_2_price: u256, level_3_price: u256, fee_enabled: bool) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized admin");
            self.level_2_price.write(level_2_price);
            self.level_3_price.write(level_3_price);
            self.fee_enabled.write(fee_enabled);
        }

        /// @notice Updates the fee recipient address.
        /// @dev Admin-only to secure fee routing.
        /// @param recipient New fee recipient address.
        fn set_fee_recipient(ref self: ContractState, recipient: ContractAddress) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized admin");
            assert!(!recipient.is_zero(), "Recipient required");
            self.fee_recipient.write(recipient);
        }

        /// @notice Updates per-user rate limit.
        /// @dev Admin-only to manage throughput.
        /// @param limit New rate limit value.
        fn set_rate_limit(ref self: ContractState, limit: u256) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized admin");
            self.rate_limit.write(limit);
        }

        fn set_signature_verification(ref self: ContractState, verifier: ContractAddress, enabled: bool) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized admin");
            if enabled {
                assert!(!verifier.is_zero(), "Verifier required");
            }
            self.signature_verifier.write(verifier);
            self.signature_verification_enabled.write(enabled);
        }

        fn set_max_pending_scan(ref self: ContractState, max_scan: u64) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized admin");
            assert!(max_scan > 0, "Max scan required");
            self.max_pending_scan.write(max_scan);
        }

        fn set_max_actions_per_user(ref self: ContractState, max_actions: u64) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized admin");
            assert!(max_actions > 0, "Max actions required");
            self.max_actions_per_user.write(max_actions);
        }

        fn set_max_batch_execute(ref self: ContractState, max_batch: u64) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized admin");
            assert!(max_batch > 0, "Max batch required");
            self.max_batch_execute.write(max_batch);
        }

        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized admin");
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }
    }
}
