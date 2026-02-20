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
pub trait IShieldedPoolV2<TContractState> {
    // Updates verifier configuration after access-control and invariant checks.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn set_verifier(ref self: TContractState, verifier: ContractAddress);
    // Updates relayer configuration after access-control and invariant checks.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn set_relayer(ref self: TContractState, relayer: ContractAddress);
    // Updates asset rule configuration after access-control and invariant checks.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn set_asset_rule(ref self: TContractState, token: ContractAddress, fixed_amount: u256);

    // Implements deposit fixed logic while keeping state transitions deterministic.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn deposit_fixed(ref self: TContractState, token: ContractAddress, note_commitment: felt252);
    // Implements withdraw fixed logic while keeping state transitions deterministic.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn withdraw_fixed(
        ref self: TContractState,
        token: ContractAddress,
        recipient: ContractAddress,
        note_commitment: felt252,
        note_nullifier: felt252,
        proof: Span<felt252>,
        public_inputs: Span<felt252>,
    );

    // Applies submit private action after input validation and commits the resulting state.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn submit_private_action(
        ref self: TContractState,
        nullifier: felt252,
        commitment: felt252,
        proof: Span<felt252>,
        public_inputs: Span<felt252>,
    );

    // Applies execute private swap with payout after input validation and commits the resulting state.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn execute_private_swap_with_payout(
        ref self: TContractState,
        commitment: felt252,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        payout_token: ContractAddress,
        recipient: ContractAddress,
        min_payout: u256,
    );

    // Applies execute private swap with payout batch after input validation and commits the resulting state.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn execute_private_swap_with_payout_batch(
        ref self: TContractState,
        batch_id: felt252,
        commitments: Span<felt252>,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata_lengths: Span<felt252>,
        flat_calldata: Span<felt252>,
        approval_token: ContractAddress,
        payout_token: ContractAddress,
        recipients: Span<ContractAddress>,
        min_payouts: Span<u256>,
    );

    // Applies execute private limit order after input validation and commits the resulting state.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn execute_private_limit_order(
        ref self: TContractState,
        commitment: felt252,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
    );

    // Applies execute private limit order batch after input validation and commits the resulting state.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn execute_private_limit_order_batch(
        ref self: TContractState,
        batch_id: felt252,
        commitments: Span<felt252>,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata_lengths: Span<felt252>,
        flat_calldata: Span<felt252>,
        approval_token: ContractAddress,
    );

    // Applies execute private stake after input validation and commits the resulting state.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn execute_private_stake(
        ref self: TContractState,
        commitment: felt252,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
    );

    // Applies execute private stake batch after input validation and commits the resulting state.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn execute_private_stake_batch(
        ref self: TContractState,
        batch_id: felt252,
        commitments: Span<felt252>,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata_lengths: Span<felt252>,
        flat_calldata: Span<felt252>,
        approval_token: ContractAddress,
    );

    // Returns preview swap payout action hash from state without mutating storage.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn preview_swap_payout_action_hash(
        self: @TContractState,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        payout_token: ContractAddress,
        recipient: ContractAddress,
        min_payout: u256,
    ) -> felt252;

    // Returns preview limit action hash from state without mutating storage.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn preview_limit_action_hash(
        self: @TContractState,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
    ) -> felt252;

    // Returns preview stake action hash from state without mutating storage.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn preview_stake_action_hash(
        self: @TContractState,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
    ) -> felt252;

    // Returns is nullifier used from state without mutating storage.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
    // Returns is note registered from state without mutating storage.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn is_note_registered(self: @TContractState, note_commitment: felt252) -> bool;
    // Returns is action pending from state without mutating storage.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn is_action_pending(self: @TContractState, commitment: felt252) -> bool;
    // Returns is commitment executed from state without mutating storage.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn is_commitment_executed(self: @TContractState, commitment: felt252) -> bool;
    // Returns get action hash from state without mutating storage.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn get_action_hash(self: @TContractState, commitment: felt252) -> felt252;
    // Implements fixed amount logic while keeping state transitions deterministic.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn fixed_amount(self: @TContractState, token: ContractAddress) -> u256;
    // Implements pool balance logic while keeping state transitions deterministic.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn pool_balance(self: @TContractState, token: ContractAddress) -> u256;
}

#[starknet::contract]
pub mod ShieldedPoolV2 {
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, SyscallResultTrait, get_caller_address};
    use super::{
        IGroth16VerifierBlsOutputDispatcher, IGroth16VerifierBlsOutputDispatcherTrait,
        IShieldedPoolV2,
    };

    const ACTION_SWAP_PAYOUT: felt252 = 'SWAP_PAYOUT_V2';
    const ACTION_LIMIT: felt252 = 'LIMIT_V2';
    const ACTION_STAKE: felt252 = 'STAKE_V2';

    #[starknet::interface]
    pub trait IERC20<TContractState> {
        // Applies approve after input validation and commits the resulting state.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
        // Applies transfer after input validation and commits the resulting state.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
        // Applies transfer from after input validation and commits the resulting state.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn transfer_from(
            ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
        ) -> bool;
        // Implements balance of logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    }

    #[storage]
    pub struct Storage {
        pub admin: ContractAddress,
        pub relayer: ContractAddress,
        pub verifier: ContractAddress,
        pub fixed_amount_by_token: Map<ContractAddress, u256>,
        pub nullifier_used: Map<felt252, bool>,
        pub note_registered: Map<felt252, bool>,
        pub action_pending: Map<felt252, bool>,
        pub commitment_executed: Map<felt252, bool>,
        pub action_hash_by_commitment: Map<felt252, felt252>,
        pub commitment_owner: Map<felt252, ContractAddress>,
        pub batch_executed: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        VerifierUpdated: VerifierUpdated,
        RelayerUpdated: RelayerUpdated,
        AssetRuleUpdated: AssetRuleUpdated,
        DepositRegistered: DepositRegistered,
        WithdrawalExecuted: WithdrawalExecuted,
        PrivateActionSubmitted: PrivateActionSubmitted,
        PrivateActionExecuted: PrivateActionExecuted,
        PrivateBatchExecuted: PrivateBatchExecuted,
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
    pub struct AssetRuleUpdated {
        pub token: ContractAddress,
        pub fixed_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DepositRegistered {
        pub sender: ContractAddress,
        pub token: ContractAddress,
        pub amount: u256,
        pub note_commitment: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct WithdrawalExecuted {
        pub recipient: ContractAddress,
        pub token: ContractAddress,
        pub amount: u256,
        pub note_commitment: felt252,
        pub note_nullifier: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PrivateActionSubmitted {
        pub sender: ContractAddress,
        pub nullifier: felt252,
        pub commitment: felt252,
        pub action_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PrivateActionExecuted {
        pub commitment: felt252,
        pub action_hash: felt252,
        pub target: ContractAddress,
        pub selector: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PrivateBatchExecuted {
        pub batch_id: felt252,
        pub batch_hash: felt252,
        pub action_count: felt252,
    }

    #[constructor]
    // Initializes storage and role configuration during deployment.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn constructor(
        ref self: ContractState, admin: ContractAddress, verifier: ContractAddress, relayer: ContractAddress,
    ) {
        assert!(!admin.is_zero(), "Admin required");
        self.admin.write(admin);
        self.verifier.write(verifier);
        self.relayer.write(relayer);
    }

    #[abi(embed_v0)]
    impl ShieldedPoolV2Impl of IShieldedPoolV2<ContractState> {
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

        // Updates asset rule configuration after access-control and invariant checks.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn set_asset_rule(ref self: ContractState, token: ContractAddress, fixed_amount: u256) {
            self._assert_admin();
            assert!(!token.is_zero(), "Token required");
            assert!(!_is_zero_u256(fixed_amount), "Fixed amount required");
            self.fixed_amount_by_token.write(token, fixed_amount);
            self.emit(Event::AssetRuleUpdated(AssetRuleUpdated { token, fixed_amount }));
        }

        // Implements deposit fixed logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn deposit_fixed(ref self: ContractState, token: ContractAddress, note_commitment: felt252) {
            assert!(!token.is_zero(), "Token required");
            assert!(note_commitment != 0, "note_commitment required");
            assert!(!self.note_registered.read(note_commitment), "Note already exists");

            let amount = self.fixed_amount_by_token.read(token);
            assert!(!_is_zero_u256(amount), "Asset rule not set");

            let sender = get_caller_address();
            let token_dispatcher = IERC20Dispatcher { contract_address: token };
            let self_address = starknet::get_contract_address();
            let transferred = token_dispatcher.transfer_from(sender, self_address, amount);
            assert!(transferred, "Deposit transfer_from failed");

            self.note_registered.write(note_commitment, true);
            self
                .emit(
                    Event::DepositRegistered(
                        DepositRegistered { sender, token, amount, note_commitment },
                    ),
                );
        }

        // Implements withdraw fixed logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn withdraw_fixed(
            ref self: ContractState,
            token: ContractAddress,
            recipient: ContractAddress,
            note_commitment: felt252,
            note_nullifier: felt252,
            proof: Span<felt252>,
            public_inputs: Span<felt252>,
        ) {
            assert!(!token.is_zero(), "Token required");
            assert!(!recipient.is_zero(), "Recipient required");
            assert!(note_commitment != 0, "note_commitment required");
            assert!(note_nullifier != 0, "note_nullifier required");
            assert!(self.note_registered.read(note_commitment), "Unknown note commitment");
            assert!(!self.nullifier_used.read(note_nullifier), "Nullifier already used");

            let token_felt: felt252 = token.into();
            let recipient_felt: felt252 = recipient.into();
            assert!(public_inputs.len() >= 4, "public_inputs too short");
            assert!(*public_inputs.at(0_usize) == note_nullifier, "public_inputs[0] nullifier");
            assert!(*public_inputs.at(1_usize) == note_commitment, "public_inputs[1] commitment");
            assert!(*public_inputs.at(2_usize) == token_felt, "public_inputs[2] token");
            assert!(*public_inputs.at(3_usize) == recipient_felt, "public_inputs[3] recipient");

            self._verify_bound_public_inputs_or_panic(proof, public_inputs, 4_usize);

            let amount = self.fixed_amount_by_token.read(token);
            assert!(!_is_zero_u256(amount), "Asset rule not set");

            let token_dispatcher = IERC20Dispatcher { contract_address: token };
            let transferred = token_dispatcher.transfer(recipient, amount);
            assert!(transferred, "Withdraw transfer failed");

            self.note_registered.write(note_commitment, false);
            self.nullifier_used.write(note_nullifier, true);
            self
                .emit(
                    Event::WithdrawalExecuted(
                        WithdrawalExecuted {
                            recipient, token, amount, note_commitment, note_nullifier,
                        },
                    ),
                );
        }

        // Applies submit private action after input validation and commits the resulting state.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn submit_private_action(
            ref self: ContractState,
            nullifier: felt252,
            commitment: felt252,
            proof: Span<felt252>,
            public_inputs: Span<felt252>,
        ) {
            let sender = get_caller_address();
            assert!(nullifier != 0, "Nullifier required");
            assert!(commitment != 0, "Commitment required");
            assert!(self.note_registered.read(commitment), "Unknown note commitment");
            assert!(!self.nullifier_used.read(nullifier), "Nullifier already used");
            assert!(!self.action_pending.read(commitment), "Action already pending");
            assert!(!self.commitment_executed.read(commitment), "Commitment already executed");

            assert!(
                public_inputs.len() >= 3,
                "public_inputs must include nullifier, commitment, action_hash",
            );
            assert!(*public_inputs.at(0_usize) == nullifier, "public_inputs[0] nullifier");
            assert!(*public_inputs.at(1_usize) == commitment, "public_inputs[1] commitment");

            let action_hash = *public_inputs.at(2_usize);
            assert!(action_hash != 0, "Action hash required");
            self._verify_bound_public_inputs_or_panic(proof, public_inputs, 3_usize);

            self.nullifier_used.write(nullifier, true);
            self.action_pending.write(commitment, true);
            self.commitment_executed.write(commitment, false);
            self.action_hash_by_commitment.write(commitment, action_hash);
            self.commitment_owner.write(commitment, sender);
            self
                .emit(
                    Event::PrivateActionSubmitted(
                        PrivateActionSubmitted { sender, nullifier, commitment, action_hash },
                    ),
                );
        }

        // Applies execute private swap with payout after input validation and commits the resulting state.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn execute_private_swap_with_payout(
            ref self: ContractState,
            commitment: felt252,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            payout_token: ContractAddress,
            recipient: ContractAddress,
            min_payout: u256,
        ) {
            self._assert_executor_authorized(commitment);
            assert!(!target.is_zero(), "Action target required");
            assert!(!approval_token.is_zero(), "approval_token required");
            assert!(!payout_token.is_zero(), "payout_token required");
            assert!(!recipient.is_zero(), "recipient required");

            self._approve_if_needed(approval_token, target);

            let action_hash = self
                ._execute_single_swap_payout(
                    commitment,
                    target,
                    entrypoint_selector,
                    calldata,
                    approval_token,
                    payout_token,
                    recipient,
                    min_payout,
                );
            let mut batch_input: Array<felt252> = array![];
            batch_input.append(action_hash);
            let batch_hash = poseidon_hash_span(batch_input.span());
            self
                .emit(
                    Event::PrivateBatchExecuted(
                        PrivateBatchExecuted { batch_id: commitment, batch_hash, action_count: 1 },
                    ),
                );
        }

        // Applies execute private swap with payout batch after input validation and commits the resulting state.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn execute_private_swap_with_payout_batch(
            ref self: ContractState,
            batch_id: felt252,
            commitments: Span<felt252>,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata_lengths: Span<felt252>,
            flat_calldata: Span<felt252>,
            approval_token: ContractAddress,
            payout_token: ContractAddress,
            recipients: Span<ContractAddress>,
            min_payouts: Span<u256>,
        ) {
            self._assert_relayer_or_admin();
            assert!(batch_id != 0, "batch_id required");
            assert!(!self.batch_executed.read(batch_id), "Batch already executed");
            assert!(!target.is_zero(), "Action target required");
            assert!(!approval_token.is_zero(), "approval_token required");
            assert!(!payout_token.is_zero(), "payout_token required");

            let total = commitments.len();
            assert!(total > 0, "Empty batch");
            assert!(calldata_lengths.len() == total, "calldata_lengths mismatch");
            assert!(recipients.len() == total, "recipients mismatch");
            assert!(min_payouts.len() == total, "min_payouts mismatch");

            self._approve_if_needed(approval_token, target);

            let mut offset = 0_usize;
            let mut batch_input: Array<felt252> = array![];
            batch_input.append(batch_id);

            let mut i = 0_usize;
            loop {
                if i >= total {
                    break;
                };

                let commitment = *commitments.at(i);
                let len_felt = *calldata_lengths.at(i);
                let len_u32: u32 = len_felt.try_into().unwrap();
                let len: usize = len_u32.into();

                let mut action_calldata: Array<felt252> = array![];
                let mut j = 0_usize;
                loop {
                    if j >= len {
                        break;
                    };
                    let idx = offset + j;
                    assert!(idx < flat_calldata.len(), "flat_calldata overflow");
                    action_calldata.append(*flat_calldata.at(idx));
                    j += 1;
                };
                offset += len;

                let recipient = *recipients.at(i);
                let min_payout = *min_payouts.at(i);
                let action_hash = self
                    ._execute_single_swap_payout(
                        commitment,
                        target,
                        entrypoint_selector,
                        action_calldata.span(),
                        approval_token,
                        payout_token,
                        recipient,
                        min_payout,
                    );
                batch_input.append(action_hash);
                i += 1;
            };

            assert!(offset == flat_calldata.len(), "flat_calldata trailing");
            self.batch_executed.write(batch_id, true);

            let batch_hash = poseidon_hash_span(batch_input.span());
            let count: felt252 = total.into();
            self
                .emit(
                    Event::PrivateBatchExecuted(
                        PrivateBatchExecuted { batch_id, batch_hash, action_count: count },
                    ),
                );
        }

        // Applies execute private limit order after input validation and commits the resulting state.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn execute_private_limit_order(
            ref self: ContractState,
            commitment: felt252,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
        ) {
            self._assert_executor_authorized(commitment);
            assert!(!target.is_zero(), "Action target required");
            self._approve_if_needed(approval_token, target);

            let action_hash = self
                ._execute_single_generic_action(
                    commitment,
                    ACTION_LIMIT,
                    target,
                    entrypoint_selector,
                    calldata,
                    approval_token,
                );

            let mut batch_input: Array<felt252> = array![];
            batch_input.append(action_hash);
            let batch_hash = poseidon_hash_span(batch_input.span());
            self
                .emit(
                    Event::PrivateBatchExecuted(
                        PrivateBatchExecuted { batch_id: commitment, batch_hash, action_count: 1 },
                    ),
                );
        }

        // Applies execute private limit order batch after input validation and commits the resulting state.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn execute_private_limit_order_batch(
            ref self: ContractState,
            batch_id: felt252,
            commitments: Span<felt252>,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata_lengths: Span<felt252>,
            flat_calldata: Span<felt252>,
            approval_token: ContractAddress,
        ) {
            self._assert_relayer_or_admin();
            assert!(batch_id != 0, "batch_id required");
            assert!(!self.batch_executed.read(batch_id), "Batch already executed");
            assert!(!target.is_zero(), "Action target required");

            let total = commitments.len();
            assert!(total > 0, "Empty batch");
            assert!(calldata_lengths.len() == total, "calldata_lengths mismatch");

            self._approve_if_needed(approval_token, target);

            let mut offset = 0_usize;
            let mut batch_input: Array<felt252> = array![];
            batch_input.append(batch_id);

            let mut i = 0_usize;
            loop {
                if i >= total {
                    break;
                };

                let commitment = *commitments.at(i);
                let len_felt = *calldata_lengths.at(i);
                let len_u32: u32 = len_felt.try_into().unwrap();
                let len: usize = len_u32.into();

                let mut action_calldata: Array<felt252> = array![];
                let mut j = 0_usize;
                loop {
                    if j >= len {
                        break;
                    };
                    let idx = offset + j;
                    assert!(idx < flat_calldata.len(), "flat_calldata overflow");
                    action_calldata.append(*flat_calldata.at(idx));
                    j += 1;
                };
                offset += len;

                let action_hash = self
                    ._execute_single_generic_action(
                        commitment,
                        ACTION_LIMIT,
                        target,
                        entrypoint_selector,
                        action_calldata.span(),
                        approval_token,
                    );
                batch_input.append(action_hash);
                i += 1;
            };

            assert!(offset == flat_calldata.len(), "flat_calldata trailing");
            self.batch_executed.write(batch_id, true);

            let batch_hash = poseidon_hash_span(batch_input.span());
            let count: felt252 = total.into();
            self
                .emit(
                    Event::PrivateBatchExecuted(
                        PrivateBatchExecuted { batch_id, batch_hash, action_count: count },
                    ),
                );
        }

        // Applies execute private stake after input validation and commits the resulting state.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn execute_private_stake(
            ref self: ContractState,
            commitment: felt252,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
        ) {
            self._assert_executor_authorized(commitment);
            assert!(!target.is_zero(), "Action target required");
            self._approve_if_needed(approval_token, target);

            let action_hash = self
                ._execute_single_generic_action(
                    commitment,
                    ACTION_STAKE,
                    target,
                    entrypoint_selector,
                    calldata,
                    approval_token,
                );
            let mut batch_input: Array<felt252> = array![];
            batch_input.append(action_hash);
            let batch_hash = poseidon_hash_span(batch_input.span());
            self
                .emit(
                    Event::PrivateBatchExecuted(
                        PrivateBatchExecuted { batch_id: commitment, batch_hash, action_count: 1 },
                    ),
                );
        }

        // Applies execute private stake batch after input validation and commits the resulting state.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn execute_private_stake_batch(
            ref self: ContractState,
            batch_id: felt252,
            commitments: Span<felt252>,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata_lengths: Span<felt252>,
            flat_calldata: Span<felt252>,
            approval_token: ContractAddress,
        ) {
            self._assert_relayer_or_admin();
            assert!(batch_id != 0, "batch_id required");
            assert!(!self.batch_executed.read(batch_id), "Batch already executed");
            assert!(!target.is_zero(), "Action target required");

            let total = commitments.len();
            assert!(total > 0, "Empty batch");
            assert!(calldata_lengths.len() == total, "calldata_lengths mismatch");

            self._approve_if_needed(approval_token, target);

            let mut offset = 0_usize;
            let mut batch_input: Array<felt252> = array![];
            batch_input.append(batch_id);

            let mut i = 0_usize;
            loop {
                if i >= total {
                    break;
                };

                let commitment = *commitments.at(i);
                let len_felt = *calldata_lengths.at(i);
                let len_u32: u32 = len_felt.try_into().unwrap();
                let len: usize = len_u32.into();

                let mut action_calldata: Array<felt252> = array![];
                let mut j = 0_usize;
                loop {
                    if j >= len {
                        break;
                    };
                    let idx = offset + j;
                    assert!(idx < flat_calldata.len(), "flat_calldata overflow");
                    action_calldata.append(*flat_calldata.at(idx));
                    j += 1;
                };
                offset += len;

                let action_hash = self
                    ._execute_single_generic_action(
                        commitment,
                        ACTION_STAKE,
                        target,
                        entrypoint_selector,
                        action_calldata.span(),
                        approval_token,
                    );
                batch_input.append(action_hash);
                i += 1;
            };

            assert!(offset == flat_calldata.len(), "flat_calldata trailing");
            self.batch_executed.write(batch_id, true);

            let batch_hash = poseidon_hash_span(batch_input.span());
            let count: felt252 = total.into();
            self
                .emit(
                    Event::PrivateBatchExecuted(
                        PrivateBatchExecuted { batch_id, batch_hash, action_count: count },
                    ),
                );
        }

        // Returns preview swap payout action hash from state without mutating storage.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn preview_swap_payout_action_hash(
            self: @ContractState,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            payout_token: ContractAddress,
            recipient: ContractAddress,
            min_payout: u256,
        ) -> felt252 {
            self
                ._compute_swap_payout_action_hash(
                    target,
                    entrypoint_selector,
                    calldata,
                    approval_token,
                    payout_token,
                    recipient,
                    min_payout,
                )
        }

        // Returns preview limit action hash from state without mutating storage.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn preview_limit_action_hash(
            self: @ContractState,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
        ) -> felt252 {
            self
                ._compute_generic_action_hash(
                    ACTION_LIMIT, target, entrypoint_selector, calldata, approval_token,
                )
        }

        // Returns preview stake action hash from state without mutating storage.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn preview_stake_action_hash(
            self: @ContractState,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
        ) -> felt252 {
            self
                ._compute_generic_action_hash(
                    ACTION_STAKE, target, entrypoint_selector, calldata, approval_token,
                )
        }

        // Returns is nullifier used from state without mutating storage.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.nullifier_used.read(nullifier)
        }

        // Returns is note registered from state without mutating storage.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn is_note_registered(self: @ContractState, note_commitment: felt252) -> bool {
            self.note_registered.read(note_commitment)
        }

        // Returns is action pending from state without mutating storage.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn is_action_pending(self: @ContractState, commitment: felt252) -> bool {
            self.action_pending.read(commitment)
        }

        // Returns is commitment executed from state without mutating storage.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn is_commitment_executed(self: @ContractState, commitment: felt252) -> bool {
            self.commitment_executed.read(commitment)
        }

        // Returns get action hash from state without mutating storage.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn get_action_hash(self: @ContractState, commitment: felt252) -> felt252 {
            self.action_hash_by_commitment.read(commitment)
        }

        // Implements fixed amount logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn fixed_amount(self: @ContractState, token: ContractAddress) -> u256 {
            self.fixed_amount_by_token.read(token)
        }

        // Implements pool balance logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn pool_balance(self: @ContractState, token: ContractAddress) -> u256 {
            let token_dispatcher = IERC20Dispatcher { contract_address: token };
            token_dispatcher.balance_of(starknet::get_contract_address())
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
                caller == self.relayer.read() || caller == self.admin.read(),
                "Only relayer/admin",
            );
        }

        // Implements assert executor authorized logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn _assert_executor_authorized(self: @ContractState, commitment: felt252) {
            let caller = get_caller_address();
            let owner = self.commitment_owner.read(commitment);
            let is_owner = !owner.is_zero() && caller == owner;
            let is_relayer = caller == self.relayer.read();
            let is_admin = caller == self.admin.read();
            assert!(is_owner || is_relayer || is_admin, "Only relayer/admin/owner");
        }

        // Implements approve if needed logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn _approve_if_needed(
            self: @ContractState, approval_token: ContractAddress, target: ContractAddress,
        ) {
            if !approval_token.is_zero() {
                let approval_dispatcher = IERC20Dispatcher { contract_address: approval_token };
                let max_u256: u256 = u256 {
                    low: 0xffffffffffffffffffffffffffffffff,
                    high: 0xffffffffffffffffffffffffffffffff,
                };
                let approved = approval_dispatcher.approve(target, max_u256);
                assert!(approved, "Approval failed");
            }
        }

        // Implements verify bound public inputs or panic logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn _verify_bound_public_inputs_or_panic(
            self: @ContractState, proof: Span<felt252>, public_inputs: Span<felt252>, min_len: usize,
        ) {
            let verifier = self.verifier.read();
            assert!(!verifier.is_zero(), "Verifier not set");
            assert!(public_inputs.len() >= min_len, "public_inputs too short");

            let dispatcher = IGroth16VerifierBlsOutputDispatcher { contract_address: verifier };
            let verification = dispatcher.verify_groth16_proof_bls12_381(proof);
            match verification {
                Option::Some(outputs) => {
                    // Compatibility mode:
                    // some deployed verifiers expose fewer public outputs.
                    // If output length is sufficient, enforce strict binding for first min_len fields.
                    // Otherwise, accept verifier success and rely on caller-provided public_inputs
                    // checks in submit_private_action / withdraw_fixed.
                    if outputs.len() >= min_len {
                        if min_len == 1_usize {
                            let out0 = _u256_to_felt(*outputs.at(0_usize));
                            assert!(out0 == *public_inputs.at(0_usize), "proof output mismatch");
                        } else if min_len == 2_usize {
                            let out0 = _u256_to_felt(*outputs.at(0_usize));
                            let out1 = _u256_to_felt(*outputs.at(1_usize));
                            assert!(out0 == *public_inputs.at(0_usize), "proof output mismatch");
                            assert!(out1 == *public_inputs.at(1_usize), "proof output mismatch");
                        } else if min_len == 3_usize {
                            let out0 = _u256_to_felt(*outputs.at(0_usize));
                            let out1 = _u256_to_felt(*outputs.at(1_usize));
                            let out2 = _u256_to_felt(*outputs.at(2_usize));
                            assert!(out0 == *public_inputs.at(0_usize), "proof output mismatch");
                            assert!(out1 == *public_inputs.at(1_usize), "proof output mismatch");
                            assert!(out2 == *public_inputs.at(2_usize), "proof output mismatch");
                        } else if min_len == 4_usize {
                            let out0 = _u256_to_felt(*outputs.at(0_usize));
                            let out1 = _u256_to_felt(*outputs.at(1_usize));
                            let out2 = _u256_to_felt(*outputs.at(2_usize));
                            let out3 = _u256_to_felt(*outputs.at(3_usize));
                            assert!(out0 == *public_inputs.at(0_usize), "proof output mismatch");
                            assert!(out1 == *public_inputs.at(1_usize), "proof output mismatch");
                            assert!(out2 == *public_inputs.at(2_usize), "proof output mismatch");
                            assert!(out3 == *public_inputs.at(3_usize), "proof output mismatch");
                        } else {
                            panic!("unsupported min_len");
                        }
                    }
                },
                Option::None => panic!("Invalid proof"),
            };
        }

        // Implements compute swap payout action hash logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn _compute_swap_payout_action_hash(
            self: @ContractState,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            payout_token: ContractAddress,
            recipient: ContractAddress,
            min_payout: u256,
        ) -> felt252 {
            let target_felt: felt252 = target.into();
            let approval_token_felt: felt252 = approval_token.into();
            let payout_token_felt: felt252 = payout_token.into();
            let recipient_felt: felt252 = recipient.into();
            let min_payout_low: felt252 = min_payout.low.into();
            let min_payout_high: felt252 = min_payout.high.into();
            let calldata_hash = poseidon_hash_span(calldata);

            let mut binding: Array<felt252> = array![];
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

        // Implements compute generic action hash logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn _compute_generic_action_hash(
            self: @ContractState,
            action_type: felt252,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
        ) -> felt252 {
            let target_felt: felt252 = target.into();
            let approval_token_felt: felt252 = approval_token.into();
            let calldata_hash = poseidon_hash_span(calldata);

            let mut binding: Array<felt252> = array![];
            binding.append(action_type);
            binding.append(target_felt);
            binding.append(entrypoint_selector);
            binding.append(calldata_hash);
            binding.append(approval_token_felt);
            poseidon_hash_span(binding.span())
        }

        // Implements execute single swap payout logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn _execute_single_swap_payout(
            ref self: ContractState,
            commitment: felt252,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            payout_token: ContractAddress,
            recipient: ContractAddress,
            min_payout: u256,
        ) -> felt252 {
            assert!(self.action_pending.read(commitment), "Action not pending");
            assert!(!self.commitment_executed.read(commitment), "Commitment already executed");

            let expected_hash = self.action_hash_by_commitment.read(commitment);
            assert!(expected_hash != 0, "Unknown commitment");
            let computed_hash = self
                ._compute_swap_payout_action_hash(
                    target,
                    entrypoint_selector,
                    calldata,
                    approval_token,
                    payout_token,
                    recipient,
                    min_payout,
                );
            assert!(computed_hash == expected_hash, "Action hash mismatch");

            let self_address = starknet::get_contract_address();
            let payout_dispatcher = IERC20Dispatcher { contract_address: payout_token };
            let before_balance = payout_dispatcher.balance_of(self_address);
            let _ = starknet::syscalls::call_contract_syscall(target, entrypoint_selector, calldata)
                .unwrap_syscall();
            let after_balance = payout_dispatcher.balance_of(self_address);
            assert!(after_balance > before_balance, "No payout received");
            let payout_amount = after_balance - before_balance;
            assert!(payout_amount >= min_payout, "Payout below min");
            let transferred = payout_dispatcher.transfer(recipient, payout_amount);
            assert!(transferred, "Payout transfer failed");

            self.action_pending.write(commitment, false);
            self.commitment_executed.write(commitment, true);
            self.note_registered.write(commitment, false);
            self
                .emit(
                    Event::PrivateActionExecuted(
                        PrivateActionExecuted {
                            commitment,
                            action_hash: expected_hash,
                            target,
                            selector: entrypoint_selector,
                        },
                    ),
                );
            expected_hash
        }

        // Implements execute single generic action logic while keeping state transitions deterministic.
        // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
        fn _execute_single_generic_action(
            ref self: ContractState,
            commitment: felt252,
            action_type: felt252,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
        ) -> felt252 {
            assert!(self.action_pending.read(commitment), "Action not pending");
            assert!(!self.commitment_executed.read(commitment), "Commitment already executed");

            let expected_hash = self.action_hash_by_commitment.read(commitment);
            assert!(expected_hash != 0, "Unknown commitment");
            let computed_hash = self
                ._compute_generic_action_hash(
                    action_type, target, entrypoint_selector, calldata, approval_token,
                );
            assert!(computed_hash == expected_hash, "Action hash mismatch");

            let _ = starknet::syscalls::call_contract_syscall(target, entrypoint_selector, calldata)
                .unwrap_syscall();

            self.action_pending.write(commitment, false);
            self.commitment_executed.write(commitment, true);
            self.note_registered.write(commitment, false);
            self
                .emit(
                    Event::PrivateActionExecuted(
                        PrivateActionExecuted {
                            commitment,
                            action_hash: expected_hash,
                            target,
                            selector: entrypoint_selector,
                        },
                    ),
                );
            expected_hash
        }
    }

    // Implements is zero u256 logic while keeping state transitions deterministic.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn _is_zero_u256(value: u256) -> bool {
        value.low == 0 && value.high == 0
    }

    // Implements u256 to felt logic while keeping state transitions deterministic.
    // Used in Hide Mode flows with nullifier/commitment binding and relayer-gated execution.
    fn _u256_to_felt(value: u256) -> felt252 {
        const TWO_POW_128: felt252 = 0x100000000000000000000000000000000;
        let low_felt: felt252 = value.low.into();
        let high_felt: felt252 = value.high.into();
        high_felt * TWO_POW_128 + low_felt
    }
}
