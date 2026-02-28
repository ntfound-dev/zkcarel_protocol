use starknet::ContractAddress;

#[starknet::interface]
pub trait IGroth16VerifierBlsOutput<TContractState> {
    fn verify_groth16_proof_bls12_381(
        self: @TContractState, full_proof_with_hints: Span<felt252>,
    ) -> Option<Span<u256>>;
}

#[starknet::interface]
pub trait IShieldedPoolV3<TContractState> {
    fn set_verifier(ref self: TContractState, verifier: ContractAddress);
    fn set_relayer(ref self: TContractState, relayer: ContractAddress);
    fn set_root(ref self: TContractState, new_root: felt252);
    fn set_asset_rule(
        ref self: TContractState, token: ContractAddress, denom_id: felt252, fixed_amount: u256,
    );

    fn deposit_fixed_v3(
        ref self: TContractState,
        token: ContractAddress,
        denom_id: felt252,
        note_commitment: felt252,
        nullifier: felt252,
    );
    fn withdraw_note_v3(ref self: TContractState, note_commitment: felt252);

    fn submit_private_swap(
        ref self: TContractState, root: felt252, nullifier: felt252, proof: Span<felt252>,
    );
    fn submit_private_limit(
        ref self: TContractState, root: felt252, nullifier: felt252, proof: Span<felt252>,
    );
    fn submit_private_stake(
        ref self: TContractState, root: felt252, nullifier: felt252, proof: Span<felt252>,
    );

    fn execute_private_swap_with_payout(
        ref self: TContractState,
        nullifier: felt252,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        payout_token: ContractAddress,
        min_payout: u256,
    );
    fn execute_private_limit_with_payout(
        ref self: TContractState,
        nullifier: felt252,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        payout_token: ContractAddress,
        min_payout: u256,
    );
    fn execute_private_stake_with_payout(
        ref self: TContractState,
        nullifier: felt252,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        payout_token: ContractAddress,
        min_payout: u256,
    );

    fn get_root(self: @TContractState) -> felt252;
    fn get_root_count(self: @TContractState) -> u64;
    fn get_note_deposit_timestamp(self: @TContractState, note_commitment: felt252) -> u64;
    fn fixed_amount(self: @TContractState, token: ContractAddress, denom_id: felt252) -> u256;

    fn preview_swap_action_hash(
        self: @TContractState,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        payout_token: ContractAddress,
        min_payout: u256,
    ) -> felt252;
    fn preview_limit_action_hash(
        self: @TContractState,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        payout_token: ContractAddress,
        min_payout: u256,
    ) -> felt252;
    fn preview_stake_action_hash(
        self: @TContractState,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        payout_token: ContractAddress,
        min_payout: u256,
    ) -> felt252;

    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
    fn is_pending_swap(self: @TContractState, nullifier: felt252) -> bool;
    fn is_pending_limit(self: @TContractState, nullifier: felt252) -> bool;
    fn is_pending_stake(self: @TContractState, nullifier: felt252) -> bool;

    fn get_pending_action_hash(self: @TContractState, nullifier: felt252) -> felt252;
    fn get_pending_recipient(self: @TContractState, nullifier: felt252) -> ContractAddress;
    fn get_pending_action_type(self: @TContractState, nullifier: felt252) -> felt252;

    // Backward-compatible getters kept for existing backend probes.
    fn get_pending_swap_action_hash(self: @TContractState, nullifier: felt252) -> felt252;
    fn get_pending_swap_recipient(self: @TContractState, nullifier: felt252) -> ContractAddress;
}

#[starknet::contract]
pub mod ShieldedPoolV3 {
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{
        ContractAddress, SyscallResultTrait, get_block_timestamp, get_caller_address,
    };
    use super::{
        IGroth16VerifierBlsOutputDispatcher, IGroth16VerifierBlsOutputDispatcherTrait,
        IShieldedPoolV3,
    };

    const ACTION_SWAP_PAYOUT_V3: felt252 = 'SWAP_PAYOUT_V3';
    const ACTION_LIMIT_PAYOUT_V3: felt252 = 'LIMIT_PAYOUT_V3';
    const ACTION_STAKE_PAYOUT_V3: felt252 = 'STAKE_PAYOUT_V3';

    #[starknet::interface]
    pub trait IERC20<TContractState> {
        fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
        fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
        fn transfer_from(
            ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
        ) -> bool;
        fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    }

    #[storage]
    pub struct Storage {
        pub admin: ContractAddress,
        pub relayer: ContractAddress,
        pub verifier: ContractAddress,

        pub fixed_amount_by_rule_key: Map<felt252, u256>,

        pub current_root: felt252,
        pub root_count: u64,
        pub roots: Map<u64, felt252>,
        pub root_seen: Map<felt252, bool>,

        pub nullifier_used: Map<felt252, bool>,
        pub pending_action_exists_by_nullifier: Map<felt252, bool>,
        pub pending_action_type_by_nullifier: Map<felt252, felt252>,
        pub pending_action_hash_by_nullifier: Map<felt252, felt252>,
        pub pending_recipient_by_nullifier: Map<felt252, ContractAddress>,
        pub pending_submitted_at_by_nullifier: Map<felt252, u64>,

        pub note_seen: Map<felt252, bool>,
        pub deposit_timestamp_by_commitment: Map<felt252, u64>,
        pub note_owner_by_commitment: Map<felt252, ContractAddress>,
        pub note_token_by_commitment: Map<felt252, ContractAddress>,
        pub note_amount_by_commitment: Map<felt252, u256>,
        pub note_nullifier_by_commitment: Map<felt252, felt252>,
        pub note_commitment_by_nullifier: Map<felt252, felt252>,
        pub note_spent_by_commitment: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        VerifierUpdated: VerifierUpdated,
        RelayerUpdated: RelayerUpdated,
        RootUpdated: RootUpdated,
        AssetRuleUpdated: AssetRuleUpdated,
        DepositRegisteredV3: DepositRegisteredV3,
        NoteWithdrawnV3: NoteWithdrawnV3,
        PrivateActionSubmittedV3: PrivateActionSubmittedV3,
        PrivateActionExecutedV3: PrivateActionExecutedV3,
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
    pub struct RootUpdated {
        pub root: felt252,
        pub root_count: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AssetRuleUpdated {
        pub token: ContractAddress,
        pub denom_id: felt252,
        pub fixed_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DepositRegisteredV3 {
        pub sender: ContractAddress,
        pub token: ContractAddress,
        pub denom_id: felt252,
        pub amount: u256,
        pub note_commitment: felt252,
        pub nullifier: felt252,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct NoteWithdrawnV3 {
        pub sender: ContractAddress,
        pub token: ContractAddress,
        pub amount: u256,
        pub note_commitment: felt252,
        pub nullifier: felt252,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PrivateActionSubmittedV3 {
        pub sender: ContractAddress,
        pub root: felt252,
        pub nullifier: felt252,
        pub action_type: felt252,
        pub action_hash: felt252,
        pub recipient: ContractAddress,
        pub submitted_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PrivateActionExecutedV3 {
        pub nullifier: felt252,
        pub action_type: felt252,
        pub action_hash: felt252,
        pub target: ContractAddress,
        pub selector: felt252,
        pub payout_token: ContractAddress,
        pub recipient: ContractAddress,
        pub payout_amount: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, admin: ContractAddress, verifier: ContractAddress, relayer: ContractAddress,
    ) {
        assert!(!admin.is_zero(), "Admin required");
        self.admin.write(admin);
        self.verifier.write(verifier);
        self.relayer.write(relayer);
        self.current_root.write(0);
        self.root_count.write(0);
    }

    #[abi(embed_v0)]
    impl ShieldedPoolV3Impl of IShieldedPoolV3<ContractState> {
        fn set_verifier(ref self: ContractState, verifier: ContractAddress) {
            self._assert_admin();
            assert!(!verifier.is_zero(), "Verifier required");
            self.verifier.write(verifier);
            self.emit(Event::VerifierUpdated(VerifierUpdated { verifier }));
        }

        fn set_relayer(ref self: ContractState, relayer: ContractAddress) {
            self._assert_admin();
            assert!(!relayer.is_zero(), "Relayer required");
            self.relayer.write(relayer);
            self.emit(Event::RelayerUpdated(RelayerUpdated { relayer }));
        }

        fn set_root(ref self: ContractState, new_root: felt252) {
            self._assert_admin();
            assert!(new_root != 0, "Root required");
            self.current_root.write(new_root);
            let next = self.root_count.read() + 1;
            self.root_count.write(next);
            self.roots.write(next, new_root);
            self.root_seen.write(new_root, true);
            self.emit(Event::RootUpdated(RootUpdated { root: new_root, root_count: next }));
        }

        fn set_asset_rule(
            ref self: ContractState, token: ContractAddress, denom_id: felt252, fixed_amount: u256,
        ) {
            self._assert_admin();
            assert!(!token.is_zero(), "Token required");
            assert!(denom_id != 0, "denom_id required");
            assert!(!_is_zero_u256(fixed_amount), "Fixed amount required");
            let key = _asset_rule_key(token, denom_id);
            self.fixed_amount_by_rule_key.write(key, fixed_amount);
            self.emit(Event::AssetRuleUpdated(AssetRuleUpdated { token, denom_id, fixed_amount }));
        }

        fn deposit_fixed_v3(
            ref self: ContractState,
            token: ContractAddress,
            denom_id: felt252,
            note_commitment: felt252,
            nullifier: felt252,
        ) {
            let sender = get_caller_address();
            assert!(!sender.is_zero(), "Sender required");
            assert!(!token.is_zero(), "Token required");
            assert!(denom_id != 0, "denom_id required");
            assert!(note_commitment != 0, "note_commitment required");
            assert!(nullifier != 0, "Nullifier required");
            assert!(!self.note_seen.read(note_commitment), "Note already exists");
            assert!(!self.nullifier_used.read(nullifier), "Nullifier already spent");
            assert!(self.note_commitment_by_nullifier.read(nullifier) == 0, "Nullifier already bound");

            let amount = self.fixed_amount(token, denom_id);
            assert!(!_is_zero_u256(amount), "Asset rule not set");

            let token_dispatcher = IERC20Dispatcher { contract_address: token };
            let self_address = starknet::get_contract_address();
            let transferred = token_dispatcher.transfer_from(sender, self_address, amount);
            assert!(transferred, "Deposit transfer_from failed");

            let ts = get_block_timestamp();
            self.note_seen.write(note_commitment, true);
            self.deposit_timestamp_by_commitment.write(note_commitment, ts);
            self.note_owner_by_commitment.write(note_commitment, sender);
            self.note_token_by_commitment.write(note_commitment, token);
            self.note_amount_by_commitment.write(note_commitment, amount);
            self.note_nullifier_by_commitment.write(note_commitment, nullifier);
            self.note_commitment_by_nullifier.write(nullifier, note_commitment);
            self.note_spent_by_commitment.write(note_commitment, false);
            self
                .emit(
                    Event::DepositRegisteredV3(
                        DepositRegisteredV3 {
                            sender, token, denom_id, amount, note_commitment, nullifier, timestamp: ts,
                        },
                    ),
                );
        }

        fn withdraw_note_v3(ref self: ContractState, note_commitment: felt252) {
            let sender = get_caller_address();
            assert!(!sender.is_zero(), "Sender required");
            assert!(note_commitment != 0, "note_commitment required");
            assert!(self.note_seen.read(note_commitment), "Note not found");
            let owner = self.note_owner_by_commitment.read(note_commitment);
            assert!(owner == sender, "Only note owner");
            assert!(!self.note_spent_by_commitment.read(note_commitment), "Note already spent");

            let token = self.note_token_by_commitment.read(note_commitment);
            assert!(!token.is_zero(), "Note token missing");
            let amount = self.note_amount_by_commitment.read(note_commitment);
            assert!(!_is_zero_u256(amount), "Note amount missing");
            let nullifier = self.note_nullifier_by_commitment.read(note_commitment);
            assert!(nullifier != 0, "Note nullifier missing");
            assert!(!self.pending_action_exists_by_nullifier.read(nullifier), "Pending action exists");
            assert!(!self.nullifier_used.read(nullifier), "Nullifier already spent");

            let token_dispatcher = IERC20Dispatcher { contract_address: token };
            let transferred = token_dispatcher.transfer(sender, amount);
            assert!(transferred, "Withdraw transfer failed");

            self.note_spent_by_commitment.write(note_commitment, true);
            self.nullifier_used.write(nullifier, true);

            let ts = get_block_timestamp();
            self
                .emit(
                    Event::NoteWithdrawnV3(
                        NoteWithdrawnV3 {
                            sender,
                            token,
                            amount,
                            note_commitment,
                            nullifier,
                            timestamp: ts,
                        },
                    ),
                );
        }

        fn submit_private_swap(
            ref self: ContractState, root: felt252, nullifier: felt252, proof: Span<felt252>,
        ) {
            self._submit_private_action(root, nullifier, proof, ACTION_SWAP_PAYOUT_V3);
        }

        fn submit_private_limit(
            ref self: ContractState, root: felt252, nullifier: felt252, proof: Span<felt252>,
        ) {
            self._submit_private_action(root, nullifier, proof, ACTION_LIMIT_PAYOUT_V3);
        }

        fn submit_private_stake(
            ref self: ContractState, root: felt252, nullifier: felt252, proof: Span<felt252>,
        ) {
            self._submit_private_action(root, nullifier, proof, ACTION_STAKE_PAYOUT_V3);
        }

        fn execute_private_swap_with_payout(
            ref self: ContractState,
            nullifier: felt252,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            payout_token: ContractAddress,
            min_payout: u256,
        ) {
            self
                ._execute_private_action_with_payout(
                    nullifier,
                    ACTION_SWAP_PAYOUT_V3,
                    target,
                    entrypoint_selector,
                    calldata,
                    approval_token,
                    payout_token,
                    min_payout,
                );
        }

        fn execute_private_limit_with_payout(
            ref self: ContractState,
            nullifier: felt252,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            payout_token: ContractAddress,
            min_payout: u256,
        ) {
            self
                ._execute_private_action_with_payout(
                    nullifier,
                    ACTION_LIMIT_PAYOUT_V3,
                    target,
                    entrypoint_selector,
                    calldata,
                    approval_token,
                    payout_token,
                    min_payout,
                );
        }

        fn execute_private_stake_with_payout(
            ref self: ContractState,
            nullifier: felt252,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            payout_token: ContractAddress,
            min_payout: u256,
        ) {
            self
                ._execute_private_action_with_payout(
                    nullifier,
                    ACTION_STAKE_PAYOUT_V3,
                    target,
                    entrypoint_selector,
                    calldata,
                    approval_token,
                    payout_token,
                    min_payout,
                );
        }

        fn get_root(self: @ContractState) -> felt252 {
            self.current_root.read()
        }

        fn get_root_count(self: @ContractState) -> u64 {
            self.root_count.read()
        }

        fn get_note_deposit_timestamp(self: @ContractState, note_commitment: felt252) -> u64 {
            self.deposit_timestamp_by_commitment.read(note_commitment)
        }

        fn fixed_amount(self: @ContractState, token: ContractAddress, denom_id: felt252) -> u256 {
            let key = _asset_rule_key(token, denom_id);
            self.fixed_amount_by_rule_key.read(key)
        }

        fn preview_swap_action_hash(
            self: @ContractState,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            payout_token: ContractAddress,
            min_payout: u256,
        ) -> felt252 {
            self
                ._compute_action_hash(
                    ACTION_SWAP_PAYOUT_V3,
                    target,
                    entrypoint_selector,
                    calldata,
                    approval_token,
                    payout_token,
                    min_payout,
                )
        }

        fn preview_limit_action_hash(
            self: @ContractState,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            payout_token: ContractAddress,
            min_payout: u256,
        ) -> felt252 {
            self
                ._compute_action_hash(
                    ACTION_LIMIT_PAYOUT_V3,
                    target,
                    entrypoint_selector,
                    calldata,
                    approval_token,
                    payout_token,
                    min_payout,
                )
        }

        fn preview_stake_action_hash(
            self: @ContractState,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            payout_token: ContractAddress,
            min_payout: u256,
        ) -> felt252 {
            self
                ._compute_action_hash(
                    ACTION_STAKE_PAYOUT_V3,
                    target,
                    entrypoint_selector,
                    calldata,
                    approval_token,
                    payout_token,
                    min_payout,
                )
        }

        fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.nullifier_used.read(nullifier)
        }

        fn is_pending_swap(self: @ContractState, nullifier: felt252) -> bool {
            self.pending_action_exists_by_nullifier.read(nullifier)
                && self.pending_action_type_by_nullifier.read(nullifier) == ACTION_SWAP_PAYOUT_V3
        }

        fn is_pending_limit(self: @ContractState, nullifier: felt252) -> bool {
            self.pending_action_exists_by_nullifier.read(nullifier)
                && self.pending_action_type_by_nullifier.read(nullifier) == ACTION_LIMIT_PAYOUT_V3
        }

        fn is_pending_stake(self: @ContractState, nullifier: felt252) -> bool {
            self.pending_action_exists_by_nullifier.read(nullifier)
                && self.pending_action_type_by_nullifier.read(nullifier) == ACTION_STAKE_PAYOUT_V3
        }

        fn get_pending_action_hash(self: @ContractState, nullifier: felt252) -> felt252 {
            self.pending_action_hash_by_nullifier.read(nullifier)
        }

        fn get_pending_recipient(self: @ContractState, nullifier: felt252) -> ContractAddress {
            self.pending_recipient_by_nullifier.read(nullifier)
        }

        fn get_pending_action_type(self: @ContractState, nullifier: felt252) -> felt252 {
            self.pending_action_type_by_nullifier.read(nullifier)
        }

        fn get_pending_swap_action_hash(self: @ContractState, nullifier: felt252) -> felt252 {
            self.pending_action_hash_by_nullifier.read(nullifier)
        }

        fn get_pending_swap_recipient(self: @ContractState, nullifier: felt252) -> ContractAddress {
            self.pending_recipient_by_nullifier.read(nullifier)
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_admin(self: @ContractState) {
            assert!(get_caller_address() == self.admin.read(), "Only admin");
        }

        fn _assert_relayer_or_admin(self: @ContractState) {
            let caller = get_caller_address();
            assert!(
                caller == self.relayer.read() || caller == self.admin.read(),
                "Only relayer/admin",
            );
        }

        fn _submit_private_action(
            ref self: ContractState,
            root: felt252,
            nullifier: felt252,
            proof: Span<felt252>,
            action_type: felt252,
        ) {
            let sender = get_caller_address();
            assert!(root != 0, "Root required");
            assert!(nullifier != 0, "Nullifier required");
            assert!(!self.nullifier_used.read(nullifier), "Nullifier already spent");
            assert!(!self.pending_action_exists_by_nullifier.read(nullifier), "Pending action exists");
            let note_commitment = self.note_commitment_by_nullifier.read(nullifier);
            assert!(note_commitment != 0, "Nullifier note missing");
            assert!(self.note_seen.read(note_commitment), "Note missing");
            assert!(!self.note_spent_by_commitment.read(note_commitment), "Note already spent");

            let current_root = self.current_root.read();
            assert!(current_root != 0, "Root not initialized");
            assert!(self.root_seen.read(root), "Unknown root");

            let verifier = self.verifier.read();
            assert!(!verifier.is_zero(), "Verifier not set");
            let dispatcher = IGroth16VerifierBlsOutputDispatcher { contract_address: verifier };
            let verification = dispatcher.verify_groth16_proof_bls12_381(proof);
            match verification {
                Option::Some(outputs) => {
                    assert!(outputs.len() >= 4, "Verifier output too short");
                    let out_root = _u256_to_felt(*outputs.at(0_usize));
                    let out_nullifier = _u256_to_felt(*outputs.at(1_usize));
                    let action_hash = _u256_to_felt(*outputs.at(2_usize));
                    let recipient_felt = _u256_to_felt(*outputs.at(3_usize));

                    assert!(out_root == root, "Proof root mismatch");
                    assert!(out_nullifier == nullifier, "Proof nullifier mismatch");
                    assert!(action_hash != 0, "Action hash required");
                    assert!(recipient_felt != 0, "Recipient required");

                    let recipient: ContractAddress = recipient_felt.try_into().unwrap();
                    assert!(!recipient.is_zero(), "Recipient required");

                    let submitted_at = get_block_timestamp();
                    self.pending_action_exists_by_nullifier.write(nullifier, true);
                    self.pending_action_type_by_nullifier.write(nullifier, action_type);
                    self.pending_action_hash_by_nullifier.write(nullifier, action_hash);
                    self.pending_recipient_by_nullifier.write(nullifier, recipient);
                    self.pending_submitted_at_by_nullifier.write(nullifier, submitted_at);
                    self
                        .emit(
                            Event::PrivateActionSubmittedV3(
                                PrivateActionSubmittedV3 {
                                    sender,
                                    root,
                                    nullifier,
                                    action_type,
                                    action_hash,
                                    recipient,
                                    submitted_at,
                                },
                            ),
                        );
                },
                Option::None => panic!("Invalid proof"),
            };
        }

        fn _execute_private_action_with_payout(
            ref self: ContractState,
            nullifier: felt252,
            action_type: felt252,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            payout_token: ContractAddress,
            min_payout: u256,
        ) {
            self._assert_relayer_or_admin();
            assert!(nullifier != 0, "Nullifier required");
            assert!(!self.nullifier_used.read(nullifier), "Nullifier already spent");
            assert!(self.pending_action_exists_by_nullifier.read(nullifier), "Pending action not found");
            assert!(!target.is_zero(), "Action target required");

            let expected_type = self.pending_action_type_by_nullifier.read(nullifier);
            assert!(expected_type == action_type, "Action type mismatch");

            let expected_hash = self.pending_action_hash_by_nullifier.read(nullifier);
            assert!(expected_hash != 0, "Unknown nullifier");
            let recipient = self.pending_recipient_by_nullifier.read(nullifier);
            assert!(!recipient.is_zero(), "Recipient missing");

            let computed_hash = self
                ._compute_action_hash(
                    action_type,
                    target,
                    entrypoint_selector,
                    calldata,
                    approval_token,
                    payout_token,
                    min_payout,
                );
            assert!(computed_hash == expected_hash, "Action hash mismatch");

            self._approve_if_needed(approval_token, target);

            let self_address = starknet::get_contract_address();
            let payout_amount = if payout_token.is_zero() {
                assert!(_is_zero_u256(min_payout), "min_payout requires payout_token");
                let _ = starknet::syscalls::call_contract_syscall(target, entrypoint_selector, calldata)
                    .unwrap_syscall();
                u256 { low: 0, high: 0 }
            } else {
                let payout_dispatcher = IERC20Dispatcher { contract_address: payout_token };
                let before_balance = payout_dispatcher.balance_of(self_address);
                let _ = starknet::syscalls::call_contract_syscall(target, entrypoint_selector, calldata)
                    .unwrap_syscall();
                let after_balance = payout_dispatcher.balance_of(self_address);
                assert!(after_balance >= before_balance, "Payout underflow");
                let payout_amount_local = after_balance - before_balance;
                assert!(payout_amount_local >= min_payout, "Payout below min");
                let transferred = payout_dispatcher.transfer(recipient, payout_amount_local);
                assert!(transferred, "Payout transfer failed");
                payout_amount_local
            };

            self._clear_pending_action(nullifier);
            self.nullifier_used.write(nullifier, true);
            let note_commitment = self.note_commitment_by_nullifier.read(nullifier);
            if note_commitment != 0 {
                self.note_spent_by_commitment.write(note_commitment, true);
            }

            self
                .emit(
                    Event::PrivateActionExecutedV3(
                        PrivateActionExecutedV3 {
                            nullifier,
                            action_type,
                            action_hash: expected_hash,
                            target,
                            selector: entrypoint_selector,
                            payout_token,
                            recipient,
                            payout_amount,
                        },
                    ),
                );
        }

        fn _clear_pending_action(ref self: ContractState, nullifier: felt252) {
            self.pending_action_exists_by_nullifier.write(nullifier, false);
            self.pending_action_type_by_nullifier.write(nullifier, 0);
            self.pending_action_hash_by_nullifier.write(nullifier, 0);
            self.pending_recipient_by_nullifier.write(nullifier, _zero_address());
            self.pending_submitted_at_by_nullifier.write(nullifier, 0);
        }

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

        fn _compute_action_hash(
            self: @ContractState,
            action_type: felt252,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            payout_token: ContractAddress,
            min_payout: u256,
        ) -> felt252 {
            let target_felt: felt252 = target.into();
            let approval_token_felt: felt252 = approval_token.into();
            let payout_token_felt: felt252 = payout_token.into();
            let min_payout_low: felt252 = min_payout.low.into();
            let min_payout_high: felt252 = min_payout.high.into();
            let calldata_hash = poseidon_hash_span(calldata);

            let mut binding: Array<felt252> = array![];
            binding.append(action_type);
            binding.append(target_felt);
            binding.append(entrypoint_selector);
            binding.append(calldata_hash);
            binding.append(approval_token_felt);
            binding.append(payout_token_felt);
            binding.append(min_payout_low);
            binding.append(min_payout_high);
            poseidon_hash_span(binding.span())
        }
    }

    fn _is_zero_u256(value: u256) -> bool {
        value.low == 0 && value.high == 0
    }

    fn _u256_to_felt(value: u256) -> felt252 {
        const TWO_POW_128: felt252 = 0x100000000000000000000000000000000;
        let low_felt: felt252 = value.low.into();
        let high_felt: felt252 = value.high.into();
        high_felt * TWO_POW_128 + low_felt
    }

    fn _asset_rule_key(token: ContractAddress, denom_id: felt252) -> felt252 {
        let token_felt: felt252 = token.into();
        let mut input: Array<felt252> = array![];
        input.append(token_felt);
        input.append(denom_id);
        poseidon_hash_span(input.span())
    }

    fn _zero_address() -> ContractAddress {
        0.try_into().unwrap()
    }
}
