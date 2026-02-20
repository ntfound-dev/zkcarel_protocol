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

// Defines AI action submission and execution entrypoints.
// Designed for backend-signed execution with user rate limits.
#[starknet::interface]
pub trait IAIExecutor<TContractState> {
    // Applies submit action after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn submit_action(
        ref self: TContractState, 
        action_type: ActionType, 
        params: ByteArray, 
        user_signature: Span<felt252>
    ) -> u64;
    // Applies execute action after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn execute_action(ref self: TContractState, action_id: u64, backend_signature: Span<felt252>);
    // Implements batch execute actions logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn batch_execute_actions(
        ref self: TContractState,
        action_ids: Span<u64>,
        backend_signature: Span<felt252>
    );
    // Implements batch submit actions logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn batch_submit_actions(
        ref self: TContractState,
        action_type: ActionType,
        params: ByteArray,
        count: u64
    ) -> u64;
    // Applies cancel action after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn cancel_action(ref self: TContractState, action_id: u64);
    // Returns get pending actions from state without mutating storage.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn get_pending_actions(self: @TContractState, user: ContractAddress) -> Array<u64>;
    // Returns get pending actions page from state without mutating storage.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn get_pending_actions_page(
        self: @TContractState,
        user: ContractAddress,
        start_offset: u64,
        limit: u64
    ) -> Array<u64>;
    // Implements check rate limit logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn check_rate_limit(self: @TContractState, user: ContractAddress) -> bool;
    // Applies submit private ai action after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

// Administrative controls for AI executor fees and limits.
// Owner-only configuration for pricing and rate limits.
#[starknet::interface]
pub trait IAIExecutorAdmin<TContractState> {
    // Updates fee config configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_fee_config(ref self: TContractState, level_2_price: u256, level_3_price: u256, fee_enabled: bool);
    // Updates fee recipient configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_fee_recipient(ref self: TContractState, recipient: ContractAddress);
    // Updates rate limit configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_rate_limit(ref self: TContractState, limit: u256);
    // Updates signature verification configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_signature_verification(ref self: TContractState, verifier: ContractAddress, enabled: bool);
    // Updates max pending scan configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_max_pending_scan(ref self: TContractState, max_scan: u64);
    // Updates max actions per user configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_max_actions_per_user(ref self: TContractState, max_actions: u64);
    // Updates max batch execute configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_max_batch_execute(ref self: TContractState, max_batch: u64);
    // Updates privacy router configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
}

// Minimal ERC20 interface for fee collection.
// Used for CAREL token transfers.
#[starknet::interface]
pub trait IERC20<TContractState> {
    // Applies transfer from after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn transfer_from(ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool;
    // Implements burn logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn burn(ref self: TContractState, amount: u256);
}

#[starknet::interface]
pub trait ISignatureVerifier<TContractState> {
    // Applies verify signature after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn verify_signature(
        self: @TContractState,
        signer: ContractAddress,
        message_hash: felt252,
        signature: Span<felt252>
    ) -> bool;
    // Applies verify and consume after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn verify_and_consume(
        ref self: TContractState,
        signer: ContractAddress,
        message_hash: felt252,
        signature: Span<felt252>
    ) -> bool;
}
// Manages AI action requests and backend execution.
// Stores action metadata and enforces rate limits.
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

    // Initializes the AI executor.
    // Sets token, backend signer, and default fee/rate settings.
    // `carel_token` is used for fee settlement and `backend_signer` authorizes AI actions.
    #[constructor]
    // Initializes storage and role configuration during deployment.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

    // Implements action type to felt logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

    // Implements compute action hash logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

    // Applies verify sig and consume after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
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
        // Applies submit action after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

        // Implements batch submit actions logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

        // Applies execute action after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

        // Implements batch execute actions logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

        // Applies cancel action after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

        // Returns get pending actions from state without mutating storage.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

        // Returns get pending actions page from state without mutating storage.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

        // Implements check rate limit logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn check_rate_limit(self: @ContractState, user: ContractAddress) -> bool {
            let day = get_block_timestamp() / 86400;
            let state: UserState = self.user_states.entry(user).read();
            let current: u32 = if state.last_reset_day == day { state.daily_count } else { 0_u32 };
            current.into() < self.rate_limit.read()
        }

        // Applies submit private ai action after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
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
        // Updates fee config configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_fee_config(ref self: ContractState, level_2_price: u256, level_3_price: u256, fee_enabled: bool) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized admin");
            self.level_2_price.write(level_2_price);
            self.level_3_price.write(level_3_price);
            self.fee_enabled.write(fee_enabled);
        }

        // Updates fee recipient configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_fee_recipient(ref self: ContractState, recipient: ContractAddress) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized admin");
            assert!(!recipient.is_zero(), "Recipient required");
            self.fee_recipient.write(recipient);
        }

        // Updates rate limit configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_rate_limit(ref self: ContractState, limit: u256) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized admin");
            self.rate_limit.write(limit);
        }

        // Updates signature verification configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_signature_verification(ref self: ContractState, verifier: ContractAddress, enabled: bool) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized admin");
            if enabled {
                assert!(!verifier.is_zero(), "Verifier required");
            }
            self.signature_verifier.write(verifier);
            self.signature_verification_enabled.write(enabled);
        }

        // Updates max pending scan configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_max_pending_scan(ref self: ContractState, max_scan: u64) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized admin");
            assert!(max_scan > 0, "Max scan required");
            self.max_pending_scan.write(max_scan);
        }

        // Updates max actions per user configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_max_actions_per_user(ref self: ContractState, max_actions: u64) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized admin");
            assert!(max_actions > 0, "Max actions required");
            self.max_actions_per_user.write(max_actions);
        }

        // Updates max batch execute configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_max_batch_execute(ref self: ContractState, max_batch: u64) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized admin");
            assert!(max_batch > 0, "Max batch required");
            self.max_batch_execute.write(max_batch);
        }

        // Updates privacy router configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized admin");
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }
    }
}
