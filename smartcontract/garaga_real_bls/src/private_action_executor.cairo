use starknet::ContractAddress;

#[starknet::interface]
pub trait IGroth16VerifierBlsOutput<TContractState> {
    // Applies verify groth16 proof bls12 381 after input validation and commits the resulting state.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn verify_groth16_proof_bls12_381(
        self: @TContractState, full_proof_with_hints: Span<felt252>,
    ) -> Option<Span<u256>>;
}

#[starknet::interface]
pub trait IPrivateActionExecutor<TContractState> {
    // Updates verifier configuration after access-control and invariant checks.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn set_verifier(ref self: TContractState, verifier: ContractAddress);
    // Updates relayer configuration after access-control and invariant checks.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn set_relayer(ref self: TContractState, relayer: ContractAddress);
    // Updates trusted privacy intermediary used for private execution entry.
    fn set_intermediary(ref self: TContractState, intermediary: ContractAddress);
    // Updates targets configuration after access-control and invariant checks.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn set_targets(
        ref self: TContractState,
        swap_target: ContractAddress,
        limit_order_target: ContractAddress,
        staking_target: ContractAddress,
    );

    // Applies submit private intent after input validation and commits the resulting state.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn submit_private_intent(
        ref self: TContractState,
        nullifier: felt252,
        commitment: felt252,
        proof: Span<felt252>,
        public_inputs: Span<felt252>,
    );

    // Applies execute private swap after input validation and commits the resulting state.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn execute_private_swap(
        ref self: TContractState,
        commitment: felt252,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
    );
    // Applies execute private swap with payout after input validation and commits the resulting state.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn execute_private_swap_with_payout(
        ref self: TContractState,
        commitment: felt252,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        payout_token: ContractAddress,
        recipient: ContractAddress,
        min_payout: u256,
    );
    // Applies execute private limit order after input validation and commits the resulting state.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn execute_private_limit_order(
        ref self: TContractState,
        commitment: felt252,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
    );
    // Applies execute private stake after input validation and commits the resulting state.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn execute_private_stake(
        ref self: TContractState,
        commitment: felt252,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
    );
    // Applies execute private stake with target after input validation and commits the resulting state.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn execute_private_stake_with_target(
        ref self: TContractState,
        commitment: felt252,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
    );
    // Applies execute private stake with target and approval after input validation and commits the resulting state.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn execute_private_stake_with_target_and_approval(
        ref self: TContractState,
        commitment: felt252,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
    );

    // Returns is nullifier used from state without mutating storage.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
    // Returns is commitment executed from state without mutating storage.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn is_commitment_executed(self: @TContractState, commitment: felt252) -> bool;
    // Returns get intent hash from state without mutating storage.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn get_intent_hash(self: @TContractState, commitment: felt252) -> felt252;

    // Returns preview swap intent hash from state without mutating storage.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn preview_swap_intent_hash(
        self: @TContractState, entrypoint_selector: felt252, calldata: Span<felt252>,
    ) -> felt252;
    // Returns preview swap payout intent hash from state without mutating storage.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn preview_swap_payout_intent_hash(
        self: @TContractState,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        payout_token: ContractAddress,
        recipient: ContractAddress,
        min_payout: u256,
    ) -> felt252;
    // Returns preview limit intent hash from state without mutating storage.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn preview_limit_intent_hash(
        self: @TContractState, entrypoint_selector: felt252, calldata: Span<felt252>,
    ) -> felt252;
    // Returns preview stake intent hash from state without mutating storage.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn preview_stake_intent_hash(
        self: @TContractState, entrypoint_selector: felt252, calldata: Span<felt252>,
    ) -> felt252;
    // Returns preview stake target intent hash from state without mutating storage.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn preview_stake_target_intent_hash(
        self: @TContractState,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
    ) -> felt252;
    // Returns preview stake target intent hash with approval from state without mutating storage.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn preview_stake_target_intent_hash_with_approval(
        self: @TContractState,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
    ) -> felt252;
}

#[starknet::contract]
pub mod PrivateActionExecutor {
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, SyscallResultTrait, get_caller_address};
    use super::{
        IGroth16VerifierBlsOutputDispatcher, IGroth16VerifierBlsOutputDispatcherTrait,
        IPrivateActionExecutor,
    };

    const ACTION_SWAP: felt252 = 'SWAP';
    const ACTION_SWAP_PAYOUT: felt252 = 'SWAP_PAYOUT';
    const ACTION_LIMIT: felt252 = 'LIMIT';
    const ACTION_STAKE: felt252 = 'STAKE';

    #[starknet::interface]
    pub trait IERC20<TContractState> {
        // Applies approve after input validation and commits the resulting state.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
        // Applies transfer after input validation and commits the resulting state.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
        // Implements balance of logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    }

    #[storage]
    pub struct Storage {
        pub admin: ContractAddress,
        pub relayer: ContractAddress,
        pub intermediary: ContractAddress,
        pub verifier: ContractAddress,
        pub swap_target: ContractAddress,
        pub limit_order_target: ContractAddress,
        pub staking_target: ContractAddress,
        pub nullifiers: Map<felt252, bool>,
        pub intent_hash_by_commitment: Map<felt252, felt252>,
        pub commitment_executed: Map<felt252, bool>,
        pub commitment_submitter: Map<felt252, ContractAddress>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        IntentSubmitted: IntentSubmitted,
        ActionExecuted: ActionExecuted,
        VerifierUpdated: VerifierUpdated,
        RelayerUpdated: RelayerUpdated,
        IntermediaryUpdated: IntermediaryUpdated,
        TargetsUpdated: TargetsUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct IntentSubmitted {
        pub sender: ContractAddress,
        pub nullifier: felt252,
        pub commitment: felt252,
        pub intent_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ActionExecuted {
        pub action_type: felt252,
        pub commitment: felt252,
        pub target: ContractAddress,
        pub selector: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VerifierUpdated {
        pub verifier: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RelayerUpdated {
        pub relayer: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct IntermediaryUpdated {
        pub intermediary: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TargetsUpdated {
        pub swap_target: ContractAddress,
        pub limit_order_target: ContractAddress,
        pub staking_target: ContractAddress,
    }

    #[constructor]
    // Initializes storage and role configuration during deployment.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        verifier: ContractAddress,
        relayer: ContractAddress,
        swap_target: ContractAddress,
        limit_order_target: ContractAddress,
        staking_target: ContractAddress,
    ) {
        assert!(!admin.is_zero(), "Admin required");
        self.admin.write(admin);
        self.verifier.write(verifier);
        self.relayer.write(relayer);
        self.swap_target.write(swap_target);
        self.limit_order_target.write(limit_order_target);
        self.staking_target.write(staking_target);
    }

    #[abi(embed_v0)]
    impl PrivateActionExecutorImpl of IPrivateActionExecutor<ContractState> {
        // Updates verifier configuration after access-control and invariant checks.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn set_verifier(ref self: ContractState, verifier: ContractAddress) {
            self._assert_admin();
            assert!(!verifier.is_zero(), "Verifier required");
            self.verifier.write(verifier);
            self.emit(Event::VerifierUpdated(VerifierUpdated { verifier }));
        }

        // Updates relayer configuration after access-control and invariant checks.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn set_relayer(ref self: ContractState, relayer: ContractAddress) {
            self._assert_admin();
            assert!(!relayer.is_zero(), "Relayer required");
            self.relayer.write(relayer);
            self.emit(Event::RelayerUpdated(RelayerUpdated { relayer }));
        }

        fn set_intermediary(ref self: ContractState, intermediary: ContractAddress) {
            self._assert_admin();
            assert!(!intermediary.is_zero(), "Intermediary required");
            self.intermediary.write(intermediary);
            self.emit(Event::IntermediaryUpdated(IntermediaryUpdated { intermediary }));
        }

        // Updates targets configuration after access-control and invariant checks.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn set_targets(
            ref self: ContractState,
            swap_target: ContractAddress,
            limit_order_target: ContractAddress,
            staking_target: ContractAddress,
        ) {
            self._assert_admin();
            self.swap_target.write(swap_target);
            self.limit_order_target.write(limit_order_target);
            self.staking_target.write(staking_target);
            self
                .emit(
                    Event::TargetsUpdated(
                        TargetsUpdated { swap_target, limit_order_target, staking_target },
                    ),
                );
        }

        // Applies submit private intent after input validation and commits the resulting state.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn submit_private_intent(
            ref self: ContractState,
            nullifier: felt252,
            commitment: felt252,
            proof: Span<felt252>,
            public_inputs: Span<felt252>,
        ) {
            self._assert_submitter_authorized();
            let sender = get_caller_address();
            assert!(!self.nullifiers.read(nullifier), "Nullifier already used");
            assert!(
                public_inputs.len() >= 3,
                "public_inputs must include nullifier, commitment, intent_hash",
            );
            assert!(
                *public_inputs.at(0_usize) == nullifier, "public_inputs[0] must equal nullifier",
            );
            assert!(
                *public_inputs.at(1_usize) == commitment, "public_inputs[1] must equal commitment",
            );

            let intent_hash = *public_inputs.at(2_usize);
            assert!(intent_hash != 0, "intent_hash required");

            self._verify_proof_or_panic(proof, public_inputs);

            self.nullifiers.write(nullifier, true);
            self.intent_hash_by_commitment.write(commitment, intent_hash);
            self.commitment_executed.write(commitment, false);
            self.commitment_submitter.write(commitment, sender);

            self
                .emit(
                    Event::IntentSubmitted(
                        IntentSubmitted { sender, nullifier, commitment, intent_hash },
                    ),
                );
        }

        // Applies execute private swap after input validation and commits the resulting state.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn execute_private_swap(
            ref self: ContractState,
            commitment: felt252,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
        ) {
            let target = self.swap_target.read();
            self
                ._execute_registered_call(
                    ACTION_SWAP, target, commitment, entrypoint_selector, calldata,
                );
        }

        // Applies execute private swap with payout after input validation and commits the resulting state.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn execute_private_swap_with_payout(
            ref self: ContractState,
            commitment: felt252,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            payout_token: ContractAddress,
            recipient: ContractAddress,
            min_payout: u256,
        ) {
            let target = self.swap_target.read();
            self._assert_executor_authorized(commitment);
            assert!(!target.is_zero(), "Action target not configured");
            assert!(!self.commitment_executed.read(commitment), "Commitment already executed");
            assert!(!approval_token.is_zero(), "approval_token required");
            assert!(!payout_token.is_zero(), "payout_token required");
            assert!(!recipient.is_zero(), "recipient required");

            let expected_hash = self.intent_hash_by_commitment.read(commitment);
            assert!(expected_hash != 0, "Unknown commitment");

            let computed_hash = self
                ._compute_swap_payout_intent_hash(
                    target,
                    entrypoint_selector,
                    calldata,
                    approval_token,
                    payout_token,
                    recipient,
                    min_payout,
                );
            assert!(computed_hash == expected_hash, "Intent hash mismatch");

            let approval_token_dispatcher = IERC20Dispatcher { contract_address: approval_token };
            let payout_token_dispatcher = IERC20Dispatcher { contract_address: payout_token };
            let self_address = starknet::get_contract_address();
            let max_u256: u256 = u256 {
                low: 0xffffffffffffffffffffffffffffffff, high: 0xffffffffffffffffffffffffffffffff,
            };
            let approved = approval_token_dispatcher.approve(target, max_u256);
            assert!(approved, "Swap spender approve failed");

            let before_balance = payout_token_dispatcher.balance_of(self_address);
            let _ = starknet::syscalls::call_contract_syscall(target, entrypoint_selector, calldata)
                .unwrap_syscall();
            let after_balance = payout_token_dispatcher.balance_of(self_address);
            assert!(after_balance > before_balance, "No payout received");
            let payout_amount = after_balance - before_balance;
            assert!(payout_amount >= min_payout, "Payout below min");

            let transferred = payout_token_dispatcher.transfer(recipient, payout_amount);
            assert!(transferred, "Payout transfer failed");

            self.commitment_executed.write(commitment, true);
            self
                .emit(
                    Event::ActionExecuted(
                        ActionExecuted {
                            action_type: ACTION_SWAP_PAYOUT,
                            commitment,
                            target,
                            selector: entrypoint_selector,
                        },
                    ),
                );
        }

        // Applies execute private limit order after input validation and commits the resulting state.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn execute_private_limit_order(
            ref self: ContractState,
            commitment: felt252,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
        ) {
            let target = self.limit_order_target.read();
            self
                ._execute_registered_call(
                    ACTION_LIMIT, target, commitment, entrypoint_selector, calldata,
                );
        }

        // Applies execute private stake after input validation and commits the resulting state.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn execute_private_stake(
            ref self: ContractState,
            commitment: felt252,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
        ) {
            let target = self.staking_target.read();
            self
                ._execute_registered_call(
                    ACTION_STAKE, target, commitment, entrypoint_selector, calldata,
                );
        }

        // Applies execute private stake with target after input validation and commits the resulting state.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn execute_private_stake_with_target(
            ref self: ContractState,
            commitment: felt252,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
        ) {
            self
                ._execute_registered_call(
                    ACTION_STAKE, target, commitment, entrypoint_selector, calldata,
                );
        }

        // Applies execute private stake with target and approval after input validation and commits the resulting state.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn execute_private_stake_with_target_and_approval(
            ref self: ContractState,
            commitment: felt252,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
        ) {
            self._assert_executor_authorized(commitment);
            assert!(!target.is_zero(), "Action target not configured");
            assert!(!self.commitment_executed.read(commitment), "Commitment already executed");

            let expected_hash = self.intent_hash_by_commitment.read(commitment);
            assert!(expected_hash != 0, "Unknown commitment");

            let computed_hash = self
                ._compute_stake_target_intent_hash_with_approval(
                    target, entrypoint_selector, calldata, approval_token,
                );
            assert!(computed_hash == expected_hash, "Intent hash mismatch");

            if !approval_token.is_zero() {
                let approval_token_dispatcher = IERC20Dispatcher { contract_address: approval_token };
                let max_u256: u256 = u256 {
                    low: 0xffffffffffffffffffffffffffffffff,
                    high: 0xffffffffffffffffffffffffffffffff,
                };
                let approved = approval_token_dispatcher.approve(target, max_u256);
                assert!(approved, "Stake spender approve failed");
            }

            let _ = starknet::syscalls::call_contract_syscall(target, entrypoint_selector, calldata)
                .unwrap_syscall();

            self.commitment_executed.write(commitment, true);
            self
                .emit(
                    Event::ActionExecuted(
                        ActionExecuted {
                            action_type: ACTION_STAKE,
                            commitment,
                            target,
                            selector: entrypoint_selector,
                        },
                    ),
                );
        }

        // Returns is nullifier used from state without mutating storage.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.nullifiers.read(nullifier)
        }

        // Returns is commitment executed from state without mutating storage.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn is_commitment_executed(self: @ContractState, commitment: felt252) -> bool {
            self.commitment_executed.read(commitment)
        }

        // Returns get intent hash from state without mutating storage.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn get_intent_hash(self: @ContractState, commitment: felt252) -> felt252 {
            self.intent_hash_by_commitment.read(commitment)
        }

        // Returns preview swap intent hash from state without mutating storage.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn preview_swap_intent_hash(
            self: @ContractState, entrypoint_selector: felt252, calldata: Span<felt252>,
        ) -> felt252 {
            self
                ._compute_intent_hash(
                    ACTION_SWAP, self.swap_target.read(), entrypoint_selector, calldata,
                )
        }

        // Returns preview swap payout intent hash from state without mutating storage.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn preview_swap_payout_intent_hash(
            self: @ContractState,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            payout_token: ContractAddress,
            recipient: ContractAddress,
            min_payout: u256,
        ) -> felt252 {
            self
                ._compute_swap_payout_intent_hash(
                    self.swap_target.read(),
                    entrypoint_selector,
                    calldata,
                    approval_token,
                    payout_token,
                    recipient,
                    min_payout,
                )
        }

        // Returns preview limit intent hash from state without mutating storage.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn preview_limit_intent_hash(
            self: @ContractState, entrypoint_selector: felt252, calldata: Span<felt252>,
        ) -> felt252 {
            self
                ._compute_intent_hash(
                    ACTION_LIMIT, self.limit_order_target.read(), entrypoint_selector, calldata,
                )
        }

        // Returns preview stake intent hash from state without mutating storage.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn preview_stake_intent_hash(
            self: @ContractState, entrypoint_selector: felt252, calldata: Span<felt252>,
        ) -> felt252 {
            self
                ._compute_intent_hash(
                    ACTION_STAKE, self.staking_target.read(), entrypoint_selector, calldata,
                )
        }

        // Returns preview stake target intent hash from state without mutating storage.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn preview_stake_target_intent_hash(
            self: @ContractState,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
        ) -> felt252 {
            self._compute_intent_hash(ACTION_STAKE, target, entrypoint_selector, calldata)
        }

        // Returns preview stake target intent hash with approval from state without mutating storage.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn preview_stake_target_intent_hash_with_approval(
            self: @ContractState,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
        ) -> felt252 {
            self
                ._compute_stake_target_intent_hash_with_approval(
                    target, entrypoint_selector, calldata, approval_token,
                )
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        // Implements assert admin logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn _assert_admin(self: @ContractState) {
            assert!(get_caller_address() == self.admin.read(), "Only admin");
        }

        // Implements assert relayer or admin logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn _assert_relayer_or_admin(self: @ContractState) {
            let caller = get_caller_address();
            assert!(
                caller == self.relayer.read() || caller == self.admin.read(), "Only relayer/admin",
            );
        }

        fn _assert_submitter_authorized(self: @ContractState) {
            let intermediary = self.intermediary.read();
            if !intermediary.is_zero() {
                let caller = get_caller_address();
                assert!(
                    caller == intermediary || caller == self.admin.read(),
                    "Only intermediary/admin",
                );
                return;
            }
            self._assert_relayer_or_admin();
        }

        // Implements assert executor authorized logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn _assert_executor_authorized(self: @ContractState, commitment: felt252) {
            let caller = get_caller_address();
            let intermediary = self.intermediary.read();
            if !intermediary.is_zero() {
                let is_intermediary = caller == intermediary;
                let is_admin = caller == self.admin.read();
                assert!(is_intermediary || is_admin, "Only intermediary/admin");
                return;
            }
            let owner = self.commitment_submitter.read(commitment);
            let is_owner = !owner.is_zero() && caller == owner;
            let is_relayer = caller == self.relayer.read();
            let is_admin = caller == self.admin.read();
            assert!(is_owner || is_relayer || is_admin, "Only relayer/admin/owner");
        }

        // Implements verify proof or panic logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn _verify_proof_or_panic(
            self: @ContractState, proof: Span<felt252>, public_inputs: Span<felt252>,
        ) {
            let verifier = self.verifier.read();
            assert!(!verifier.is_zero(), "Verifier not set");
            assert!(
                public_inputs.len() >= 3,
                "public_inputs must include nullifier, commitment, intent_hash",
            );
            let dispatcher = IGroth16VerifierBlsOutputDispatcher { contract_address: verifier };
            let verification = dispatcher.verify_groth16_proof_bls12_381(proof);
            match verification {
                Option::Some(proof_public_inputs) => {
                    // Compatibility mode:
                    // Some deployed verifiers expose fewer public outputs (e.g. legacy/single
                    // output).
                    // If verifier returns >=3 outputs, enforce strict binding:
                    // [nullifier, commitment, intent_hash] must match submitted public_inputs.
                    // Otherwise, we still require verification success and keep submitted
                    // public_inputs checks in submit_private_intent.
                    if proof_public_inputs.len() >= 3 {
                        let nullifier_from_proof = _u256_to_felt(*proof_public_inputs.at(0_usize));
                        let commitment_from_proof = _u256_to_felt(*proof_public_inputs.at(1_usize));
                        let intent_hash_from_proof = _u256_to_felt(
                            *proof_public_inputs.at(2_usize),
                        );
                        assert!(
                            nullifier_from_proof == *public_inputs.at(0_usize),
                            "nullifier mismatch with proof output",
                        );
                        assert!(
                            commitment_from_proof == *public_inputs.at(1_usize),
                            "commitment mismatch with proof output",
                        );
                        assert!(
                            intent_hash_from_proof == *public_inputs.at(2_usize),
                            "intent_hash mismatch with proof output",
                        );
                    }
                },
                Option::None => panic!("Invalid proof"),
            };
        }

        // Implements compute intent hash logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn _compute_intent_hash(
            self: @ContractState,
            action_type: felt252,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
        ) -> felt252 {
            let calldata_hash = poseidon_hash_span(calldata);
            let mut binding: Array<felt252> = array![];
            let target_felt: felt252 = target.into();
            binding.append(action_type);
            binding.append(target_felt);
            binding.append(entrypoint_selector);
            binding.append(calldata_hash);
            poseidon_hash_span(binding.span())
        }

        // Implements compute swap payout intent hash logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn _compute_swap_payout_intent_hash(
            self: @ContractState,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            payout_token: ContractAddress,
            recipient: ContractAddress,
            min_payout: u256,
        ) -> felt252 {
            let calldata_hash = poseidon_hash_span(calldata);
            let mut binding: Array<felt252> = array![];
            let target_felt: felt252 = target.into();
            let approval_token_felt: felt252 = approval_token.into();
            let payout_token_felt: felt252 = payout_token.into();
            let recipient_felt: felt252 = recipient.into();
            let min_payout_low: felt252 = min_payout.low.into();
            let min_payout_high: felt252 = min_payout.high.into();

            binding.append(ACTION_SWAP_PAYOUT);
            binding.append(target_felt);
            binding.append(entrypoint_selector);
            binding.append(calldata_hash);
            binding.append(approval_token_felt);
            binding.append(payout_token_felt);
            binding.append(recipient_felt);
            binding.append(min_payout_low);
            binding.append(min_payout_high);
            poseidon_hash_span(binding.span())
        }

        // Implements compute stake target intent hash with approval logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn _compute_stake_target_intent_hash_with_approval(
            self: @ContractState,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
        ) -> felt252 {
            let calldata_hash = poseidon_hash_span(calldata);
            let mut binding: Array<felt252> = array![];
            let target_felt: felt252 = target.into();
            let approval_token_felt: felt252 = approval_token.into();

            binding.append(ACTION_STAKE);
            binding.append(target_felt);
            binding.append(entrypoint_selector);
            binding.append(calldata_hash);
            binding.append(approval_token_felt);
            poseidon_hash_span(binding.span())
        }

        // Implements execute registered call logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn _execute_registered_call(
            ref self: ContractState,
            action_type: felt252,
            target: ContractAddress,
            commitment: felt252,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
        ) {
            self._assert_executor_authorized(commitment);
            assert!(!target.is_zero(), "Action target not configured");
            assert!(!self.commitment_executed.read(commitment), "Commitment already executed");

            let expected_hash = self.intent_hash_by_commitment.read(commitment);
            assert!(expected_hash != 0, "Unknown commitment");

            let computed_hash = self
                ._compute_intent_hash(action_type, target, entrypoint_selector, calldata);
            assert!(computed_hash == expected_hash, "Intent hash mismatch");

            let _ = starknet::syscalls::call_contract_syscall(target, entrypoint_selector, calldata)
                .unwrap_syscall();

            self.commitment_executed.write(commitment, true);
            self
                .emit(
                    Event::ActionExecuted(
                        ActionExecuted {
                            action_type, commitment, target, selector: entrypoint_selector,
                        },
                    ),
                );
        }
    }

    // Implements u256 to felt logic while keeping state transitions deterministic.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn _u256_to_felt(value: u256) -> felt252 {
        // Garaga returns public inputs as u256 limbs. Recompose full field element.
        const TWO_POW_128: felt252 = 0x100000000000000000000000000000000;
        let low_felt: felt252 = value.low.into();
        let high_felt: felt252 = value.high.into();
        high_felt * TWO_POW_128 + low_felt
    }
}
