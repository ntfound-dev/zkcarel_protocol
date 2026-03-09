use starknet::ContractAddress;

#[starknet::interface]
pub trait IGroth16VerifierBlsOutput<TContractState> {
    /// Verifies a Groth16 proof and returns decoded public outputs when valid.
    fn verify_groth16_proof_bls12_381(
        self: @TContractState, full_proof_with_hints: Span<felt252>,
    ) -> Option<Span<u256>>;
}

#[starknet::interface]
pub trait IShieldedPoolV3<TContractState> {
    /// Starts a two-step admin transfer to a new address.
    fn transfer_admin(ref self: TContractState, new_admin: ContractAddress);
    /// Accepts a pending admin transfer.
    fn accept_admin(ref self: TContractState);
    /// Pauses user-facing entrypoints during incident response.
    fn pause(ref self: TContractState);
    /// Resumes user-facing entrypoints after incident response.
    fn unpause(ref self: TContractState);
    /// Updates the verifier contract used for private-action proof checks.
    fn set_verifier(ref self: TContractState, verifier: ContractAddress);
    /// Applies a verifier update after the governance delay has elapsed.
    fn apply_verifier_update(ref self: TContractState);
    /// Updates the relayer account allowed to execute private actions.
    fn set_relayer(ref self: TContractState, relayer: ContractAddress);
    /// Stores a new accepted Merkle root for later private-action submissions.
    fn set_root(ref self: TContractState, new_root: felt252);
    /// Defines the fixed deposit amount for a token and denomination pair.
    fn set_asset_rule(
        ref self: TContractState, token: ContractAddress, denom_id: felt252, fixed_amount: u256,
    );

    /// Locks a fixed token amount and records a fresh note commitment.
    fn deposit_fixed_v3(
        ref self: TContractState,
        token: ContractAddress,
        denom_id: felt252,
        note_commitment: felt252,
    );
    /// Legacy direct withdrawal is disabled because it cannot coexist safely with unlinkable spends.
    fn withdraw_note_v3(ref self: TContractState, note_commitment: felt252);
    /// Privately exits a note to the bound recipient without revealing its deposit linkage.
    fn private_exit_v3(
        ref self: TContractState,
        root: felt252,
        nullifier: felt252,
        proof: Span<felt252>,
        token: ContractAddress,
        amount: u256,
        recipient: ContractAddress,
    );

    /// Registers a private swap action after the proof passes verification.
    fn submit_private_swap(
        ref self: TContractState, root: felt252, nullifier: felt252, proof: Span<felt252>,
    );
    /// Registers a private limit-order action after the proof passes verification.
    fn submit_private_limit(
        ref self: TContractState, root: felt252, nullifier: felt252, proof: Span<felt252>,
    );
    /// Registers a private staking action after the proof passes verification.
    fn submit_private_stake(
        ref self: TContractState, root: felt252, nullifier: felt252, proof: Span<felt252>,
    );
    /// Clears a pending private action so it can be re-submitted with different execution details.
    fn cancel_private_action(ref self: TContractState, nullifier: felt252);

    /// Executes a queued private swap and forwards any payout to the stored recipient.
    fn execute_private_swap_with_payout(
        ref self: TContractState,
        nullifier: felt252,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        approval_amount: u256,
        payout_token: ContractAddress,
        min_payout: u256,
    );
    /// Executes a queued private limit-order action and forwards any payout to the stored recipient.
    fn execute_private_limit_with_payout(
        ref self: TContractState,
        nullifier: felt252,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        approval_amount: u256,
        payout_token: ContractAddress,
        min_payout: u256,
    );
    /// Executes a queued private staking action and forwards any payout to the stored recipient.
    fn execute_private_stake_with_payout(
        ref self: TContractState,
        nullifier: felt252,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        approval_amount: u256,
        payout_token: ContractAddress,
        min_payout: u256,
    );

    /// Returns the current active Merkle root.
    fn get_root(self: @TContractState) -> felt252;
    /// Returns the current admin.
    fn get_admin(self: @TContractState) -> ContractAddress;
    /// Returns the pending admin, if any.
    fn get_pending_admin(self: @TContractState) -> ContractAddress;
    /// Returns whether user-facing entrypoints are currently paused.
    fn is_paused(self: @TContractState) -> bool;
    /// Returns the currently active verifier.
    fn get_verifier(self: @TContractState) -> ContractAddress;
    /// Returns the pending verifier, if any.
    fn get_pending_verifier(self: @TContractState) -> ContractAddress;
    /// Returns when the pending verifier can be applied.
    fn get_pending_verifier_ready_at(self: @TContractState) -> u64;
    /// Returns how many roots have been stored so far.
    fn get_root_count(self: @TContractState) -> u64;
    /// Returns the deposit timestamp recorded for a note commitment.
    fn get_note_deposit_timestamp(self: @TContractState, note_commitment: felt252) -> u64;
    /// Returns the fixed deposit amount configured for a token and denomination pair.
    fn fixed_amount(self: @TContractState, token: ContractAddress, denom_id: felt252) -> u256;

    /// Precomputes the swap action hash that must match the private proof payload.
    fn preview_swap_action_hash(
        self: @TContractState,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        approval_amount: u256,
        payout_token: ContractAddress,
        min_payout: u256,
    ) -> felt252;
    /// Precomputes the limit-order action hash that must match the private proof payload.
    fn preview_limit_action_hash(
        self: @TContractState,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        approval_amount: u256,
        payout_token: ContractAddress,
        min_payout: u256,
    ) -> felt252;
    /// Precomputes the staking action hash that must match the private proof payload.
    fn preview_stake_action_hash(
        self: @TContractState,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        approval_amount: u256,
        payout_token: ContractAddress,
        min_payout: u256,
    ) -> felt252;
    /// Precomputes the exit hash that must be bound into a private exit proof.
    fn preview_exit_hash(
        self: @TContractState,
        token: ContractAddress,
        amount: u256,
        recipient: ContractAddress,
    ) -> felt252;

    /// Returns whether a nullifier has already been consumed.
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
    /// Returns whether a swap action is still pending for the nullifier.
    fn is_pending_swap(self: @TContractState, nullifier: felt252) -> bool;
    /// Returns whether a limit-order action is still pending for the nullifier.
    fn is_pending_limit(self: @TContractState, nullifier: felt252) -> bool;
    /// Returns whether a staking action is still pending for the nullifier.
    fn is_pending_stake(self: @TContractState, nullifier: felt252) -> bool;

    /// Returns the stored action hash for a pending private action.
    fn get_pending_action_hash(self: @TContractState, nullifier: felt252) -> felt252;
    /// Returns the payout recipient stored for a pending private action.
    fn get_pending_recipient(self: @TContractState, nullifier: felt252) -> ContractAddress;
    /// Returns the stored action type for a pending private action.
    fn get_pending_action_type(self: @TContractState, nullifier: felt252) -> felt252;

    // Backward-compatible getters kept for existing backend probes.
    /// Legacy getter kept for older backend swap probes.
    fn get_pending_swap_action_hash(self: @TContractState, nullifier: felt252) -> felt252;
    /// Legacy getter kept for older backend swap probes.
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
        get_contract_address, get_tx_info,
    };
    use super::{
        IGroth16VerifierBlsOutputDispatcher, IGroth16VerifierBlsOutputDispatcherTrait,
        IShieldedPoolV3,
    };

    const ACTION_SWAP_PAYOUT_V3: felt252 = 'SWAP_PAYOUT_V3';
    const ACTION_LIMIT_PAYOUT_V3: felt252 = 'LIMIT_PAYOUT_V3';
    const ACTION_STAKE_PAYOUT_V3: felt252 = 'STAKE_PAYOUT_V3';
    const ACTION_PRIVATE_EXIT_V3: felt252 = 'PRIVATE_EXIT_V3';
    const VERIFIER_UPDATE_DELAY_SECS: u64 = 86400;
    const PENDING_ACTION_EXPIRY_SECS: u64 = 86400;

    #[starknet::interface]
    pub trait IERC20<TContractState> {
        /// Grants an allowance to a spender.
        fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
        /// Returns the current allowance from owner to spender.
        fn allowance(
            self: @TContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256;
        /// Transfers tokens from the caller to a recipient.
        fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
        /// Transfers tokens from one account to another using allowance.
        fn transfer_from(
            ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
        ) -> bool;
        /// Returns the token balance for an account.
        fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    }

    #[storage]
    pub struct Storage {
        pub admin: ContractAddress,
        pub pending_admin: ContractAddress,
        pub relayer: ContractAddress,
        pub verifier: ContractAddress,
        pub pending_verifier: ContractAddress,
        pub pending_verifier_ready_at: u64,
        pub paused: bool,

        pub fixed_amount_by_rule_key: Map<felt252, u256>,

        pub current_root: felt252,
        pub root_count: u64,
        pub roots: Map<u64, felt252>,
        pub root_seen: Map<felt252, bool>,

        pub reentrancy_lock: bool,

        pub nullifier_used: Map<felt252, bool>,
        pub pending_action_exists_by_nullifier: Map<felt252, bool>,
        pub pending_action_type_by_nullifier: Map<felt252, felt252>,
        pub pending_action_hash_by_nullifier: Map<felt252, felt252>,
        pub pending_recipient_by_nullifier: Map<felt252, ContractAddress>,
        pub pending_submitter_by_nullifier: Map<felt252, ContractAddress>,
        pub authorized_submitter_by_nullifier: Map<felt252, ContractAddress>,
        pub pending_submitted_at_by_nullifier: Map<felt252, u64>,

        pub note_seen: Map<felt252, bool>,
        pub deposit_timestamp_by_commitment: Map<felt252, u64>,
        pub note_owner_by_commitment: Map<felt252, ContractAddress>,
        pub note_token_by_commitment: Map<felt252, ContractAddress>,
        pub note_amount_by_commitment: Map<felt252, u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        AdminTransferStarted: AdminTransferStarted,
        AdminTransferred: AdminTransferred,
        Paused: Paused,
        Unpaused: Unpaused,
        VerifierUpdated: VerifierUpdated,
        VerifierUpdateScheduled: VerifierUpdateScheduled,
        RelayerUpdated: RelayerUpdated,
        RootUpdated: RootUpdated,
        AssetRuleUpdated: AssetRuleUpdated,
        DepositRegisteredV3: DepositRegisteredV3,
        PrivateExitV3: PrivateExitV3,
        PrivateActionSubmittedV3: PrivateActionSubmittedV3,
        PrivateActionCancelledV3: PrivateActionCancelledV3,
        PrivateActionExecutedV3: PrivateActionExecutedV3,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AdminTransferStarted {
        pub current_admin: ContractAddress,
        pub pending_admin: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AdminTransferred {
        pub previous_admin: ContractAddress,
        pub new_admin: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Paused {
        pub admin: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Unpaused {
        pub admin: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VerifierUpdated {
        pub verifier: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VerifierUpdateScheduled {
        pub current_verifier: ContractAddress,
        pub proposed_verifier: ContractAddress,
        pub executable_at: u64,
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
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PrivateExitV3 {
        pub nullifier: felt252,
        pub exit_hash: felt252,
        pub token: ContractAddress,
        pub recipient: ContractAddress,
        pub amount: u256,
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
    pub struct PrivateActionCancelledV3 {
        pub canceled_by: ContractAddress,
        pub nullifier: felt252,
        pub action_type: felt252,
        pub action_hash: felt252,
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
    /// Initializes admin, verifier, relayer, and an empty root state.
    fn constructor(
        ref self: ContractState, admin: ContractAddress, verifier: ContractAddress, relayer: ContractAddress,
    ) {
        assert!(!admin.is_zero(), "Admin required");
        self.admin.write(admin);
        self.verifier.write(verifier);
        self.relayer.write(relayer);
        self.current_root.write(0);
        self.root_count.write(0);
        self.reentrancy_lock.write(false);
    }

    #[abi(embed_v0)]
    impl ShieldedPoolV3Impl of IShieldedPoolV3<ContractState> {
        /// Starts a two-step admin transfer so key rotation is possible without instant handover.
        fn transfer_admin(ref self: ContractState, new_admin: ContractAddress) {
            self._assert_admin();
            assert!(!new_admin.is_zero(), "Pending admin required");
            assert!(new_admin != self.admin.read(), "Admin unchanged");
            self.pending_admin.write(new_admin);
            self
                .emit(
                    Event::AdminTransferStarted(
                        AdminTransferStarted {
                            current_admin: self.admin.read(), pending_admin: new_admin,
                        },
                    ),
                );
        }

        /// Finalizes the admin handover from the pending admin address.
        fn accept_admin(ref self: ContractState) {
            let caller = get_caller_address();
            let pending_admin = self.pending_admin.read();
            assert!(!pending_admin.is_zero(), "No pending admin");
            assert!(caller == pending_admin, "Only pending admin");

            let previous_admin = self.admin.read();
            self.admin.write(pending_admin);
            self.pending_admin.write(_zero_address());
            self
                .emit(
                    Event::AdminTransferred(
                        AdminTransferred { previous_admin, new_admin: pending_admin },
                    ),
                );
        }

        /// Stops deposits, submits, exits, and executes during incident response.
        fn pause(ref self: ContractState) {
            self._assert_admin();
            assert!(!self.paused.read(), "Already paused");
            self.paused.write(true);
            self.emit(Event::Paused(Paused { admin: get_caller_address() }));
        }

        /// Re-enables normal user flows after the incident is resolved.
        fn unpause(ref self: ContractState) {
            self._assert_admin();
            assert!(self.paused.read(), "Not paused");
            self.paused.write(false);
            self.emit(Event::Unpaused(Unpaused { admin: get_caller_address() }));
        }

        /// Admin-only setter for the active proof verifier.
        fn set_verifier(ref self: ContractState, verifier: ContractAddress) {
            self._assert_admin();
            assert!(!verifier.is_zero(), "Verifier required");
            let current = self.verifier.read();
            assert!(current != verifier, "Verifier unchanged");

            let executable_at = get_block_timestamp() + VERIFIER_UPDATE_DELAY_SECS;
            self.pending_verifier.write(verifier);
            self.pending_verifier_ready_at.write(executable_at);
            self
                .emit(
                    Event::VerifierUpdateScheduled(
                        VerifierUpdateScheduled {
                            current_verifier: current, proposed_verifier: verifier, executable_at,
                        },
                    ),
                );
        }

        /// Applies a previously scheduled verifier update once the delay has elapsed.
        fn apply_verifier_update(ref self: ContractState) {
            self._assert_admin();

            let proposed = self.pending_verifier.read();
            assert!(!proposed.is_zero(), "No verifier update pending");

            let executable_at = self.pending_verifier_ready_at.read();
            assert!(get_block_timestamp() >= executable_at, "Verifier update timelocked");

            self.verifier.write(proposed);
            self.pending_verifier.write(_zero_address());
            self.pending_verifier_ready_at.write(0);
            self.emit(Event::VerifierUpdated(VerifierUpdated { verifier: proposed }));
        }

        /// Admin-only setter for the relayer allowed to execute private actions.
        fn set_relayer(ref self: ContractState, relayer: ContractAddress) {
            self._assert_admin();
            assert!(!relayer.is_zero(), "Relayer required");
            self.relayer.write(relayer);
            self.emit(Event::RelayerUpdated(RelayerUpdated { relayer }));
        }

        /// Registers a new accepted root and keeps a simple append-only root history.
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

        /// Sets the fixed deposit amount for a token and denomination used by note deposits.
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

        /// Pulls the configured token amount into the pool and records a fresh note.
        fn deposit_fixed_v3(
            ref self: ContractState,
            token: ContractAddress,
            denom_id: felt252,
            note_commitment: felt252,
        ) {
            self._assert_not_paused();
            let sender = get_caller_address();
            assert!(!sender.is_zero(), "Sender required");
            assert!(!token.is_zero(), "Token required");
            assert!(denom_id != 0, "denom_id required");
            assert!(note_commitment != 0, "note_commitment required");
            assert!(!self.note_seen.read(note_commitment), "Note already exists");

            let amount = self.fixed_amount(token, denom_id);
            assert!(!_is_zero_u256(amount), "Asset rule not set");

            let token_dispatcher = IERC20Dispatcher { contract_address: token };
            let self_address = get_contract_address();
            let transferred = token_dispatcher.transfer_from(sender, self_address, amount);
            assert!(transferred, "Deposit transfer_from failed");

            let ts = get_block_timestamp();
            self.note_seen.write(note_commitment, true);
            self.deposit_timestamp_by_commitment.write(note_commitment, ts);
            self.note_owner_by_commitment.write(note_commitment, sender);
            self.note_token_by_commitment.write(note_commitment, token);
            self.note_amount_by_commitment.write(note_commitment, amount);
            self
                .emit(
                    Event::DepositRegisteredV3(
                        DepositRegisteredV3 {
                            sender, token, denom_id, amount, note_commitment, timestamp: ts,
                        },
                    ),
                );
        }

        /// Disabled because direct owner withdrawal is fundamentally incompatible with unlinkable spend nullifiers.
        fn withdraw_note_v3(ref self: ContractState, note_commitment: felt252) {
            let _ = note_commitment;
            panic!("Direct note withdrawal disabled")
        }

        /// Verifies a proof-bound exit and transfers the proven note amount to the bound recipient.
        fn private_exit_v3(
            ref self: ContractState,
            root: felt252,
            nullifier: felt252,
            proof: Span<felt252>,
            token: ContractAddress,
            amount: u256,
            recipient: ContractAddress,
        ) {
            self._assert_not_paused();
            self._enter_reentrancy_guard();

            assert!(root != 0, "Root required");
            assert!(nullifier != 0, "Nullifier required");
            assert!(!token.is_zero(), "Token required");
            assert!(!_is_zero_u256(amount), "Amount required");
            assert!(!recipient.is_zero(), "Recipient required");
            assert!(!self.nullifier_used.read(nullifier), "Nullifier already spent");
            assert!(!self.pending_action_exists_by_nullifier.read(nullifier), "Pending action exists");

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
                    let exit_hash = _u256_to_felt(*outputs.at(2_usize));
                    let recipient_felt = _u256_to_felt(*outputs.at(3_usize));

                    assert!(out_root == root, "Proof root mismatch");
                    assert!(out_nullifier == nullifier, "Proof nullifier mismatch");
                    assert!(exit_hash != 0, "Exit hash required");
                    assert!(recipient_felt != 0, "Recipient required");

                    let proof_recipient: ContractAddress = recipient_felt.try_into().unwrap();
                    assert!(proof_recipient == recipient, "Proof recipient mismatch");

                    let computed_hash = self._compute_exit_hash(token, amount, recipient);
                    assert!(computed_hash == exit_hash, "Exit hash mismatch");

                    self.nullifier_used.write(nullifier, true);

                    let token_dispatcher = IERC20Dispatcher { contract_address: token };
                    let transferred = token_dispatcher.transfer(recipient, amount);
                    assert!(transferred, "Exit transfer failed");

                    self
                        .emit(
                            Event::PrivateExitV3(
                                PrivateExitV3 { nullifier, exit_hash, token, recipient, amount },
                            ),
                        );
                    self._exit_reentrancy_guard();
                },
                Option::None => panic!("Invalid proof"),
            };
        }

        /// Thin wrapper for submitting a private swap action.
        fn submit_private_swap(
            ref self: ContractState, root: felt252, nullifier: felt252, proof: Span<felt252>,
        ) {
            self._submit_private_action(root, nullifier, proof, ACTION_SWAP_PAYOUT_V3);
        }

        /// Thin wrapper for submitting a private limit-order action.
        fn submit_private_limit(
            ref self: ContractState, root: felt252, nullifier: felt252, proof: Span<felt252>,
        ) {
            self._submit_private_action(root, nullifier, proof, ACTION_LIMIT_PAYOUT_V3);
        }

        /// Thin wrapper for submitting a private staking action.
        fn submit_private_stake(
            ref self: ContractState, root: felt252, nullifier: felt252, proof: Span<felt252>,
        ) {
            self._submit_private_action(root, nullifier, proof, ACTION_STAKE_PAYOUT_V3);
        }

        /// Lets the original submitter or admin clear a pending action for safe re-submission.
        fn cancel_private_action(ref self: ContractState, nullifier: felt252) {
            assert!(nullifier != 0, "Nullifier required");
            assert!(self.pending_action_exists_by_nullifier.read(nullifier), "Pending action not found");

            let caller = get_caller_address();
            let submitter = self.pending_submitter_by_nullifier.read(nullifier);
            let admin = self.admin.read();
            assert!(caller == submitter || caller == admin, "Only submitter/admin");

            let action_type = self.pending_action_type_by_nullifier.read(nullifier);
            let action_hash = self.pending_action_hash_by_nullifier.read(nullifier);
            self._clear_pending_action(nullifier);
            self
                .emit(
                    Event::PrivateActionCancelledV3(
                        PrivateActionCancelledV3 { canceled_by: caller, nullifier, action_type, action_hash },
                    ),
                );
        }

        /// Executes a queued private swap and handles optional payout forwarding.
        fn execute_private_swap_with_payout(
            ref self: ContractState,
            nullifier: felt252,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            approval_amount: u256,
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
                    approval_amount,
                    payout_token,
                    min_payout,
                );
        }

        /// Executes a queued private limit-order action and handles optional payout forwarding.
        fn execute_private_limit_with_payout(
            ref self: ContractState,
            nullifier: felt252,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            approval_amount: u256,
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
                    approval_amount,
                    payout_token,
                    min_payout,
                );
        }

        /// Executes a queued private staking action and handles optional payout forwarding.
        fn execute_private_stake_with_payout(
            ref self: ContractState,
            nullifier: felt252,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            approval_amount: u256,
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
                    approval_amount,
                    payout_token,
                    min_payout,
                );
        }

        /// Returns the current active root.
        fn get_root(self: @ContractState) -> felt252 {
            self.current_root.read()
        }

        /// Returns the current admin address.
        fn get_admin(self: @ContractState) -> ContractAddress {
            self.admin.read()
        }

        /// Returns the pending admin address.
        fn get_pending_admin(self: @ContractState) -> ContractAddress {
            self.pending_admin.read()
        }

        /// Returns whether incident pause mode is active.
        fn is_paused(self: @ContractState) -> bool {
            self.paused.read()
        }

        /// Returns the active verifier address.
        fn get_verifier(self: @ContractState) -> ContractAddress {
            self.verifier.read()
        }

        /// Returns the pending verifier update address.
        fn get_pending_verifier(self: @ContractState) -> ContractAddress {
            self.pending_verifier.read()
        }

        /// Returns when the pending verifier update becomes executable.
        fn get_pending_verifier_ready_at(self: @ContractState) -> u64 {
            self.pending_verifier_ready_at.read()
        }

        /// Returns how many roots have been stored.
        fn get_root_count(self: @ContractState) -> u64 {
            self.root_count.read()
        }

        /// Returns when a note was originally deposited.
        fn get_note_deposit_timestamp(self: @ContractState, note_commitment: felt252) -> u64 {
            self.deposit_timestamp_by_commitment.read(note_commitment)
        }

        /// Returns the configured fixed amount for a token and denomination pair.
        fn fixed_amount(self: @ContractState, token: ContractAddress, denom_id: felt252) -> u256 {
            let key = _asset_rule_key(token, denom_id);
            self.fixed_amount_by_rule_key.read(key)
        }

        /// Computes the swap action hash off-chain callers should expect to bind into proofs.
        fn preview_swap_action_hash(
            self: @ContractState,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            approval_amount: u256,
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
                    approval_amount,
                    payout_token,
                    min_payout,
                )
        }

        /// Computes the limit-order action hash off-chain callers should expect to bind into proofs.
        fn preview_limit_action_hash(
            self: @ContractState,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            approval_amount: u256,
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
                    approval_amount,
                    payout_token,
                    min_payout,
                )
        }

        /// Computes the staking action hash off-chain callers should expect to bind into proofs.
        fn preview_stake_action_hash(
            self: @ContractState,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            approval_amount: u256,
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
                    approval_amount,
                    payout_token,
                    min_payout,
                )
        }

        /// Computes the exit hash off-chain callers should bind into private exit proofs.
        fn preview_exit_hash(
            self: @ContractState,
            token: ContractAddress,
            amount: u256,
            recipient: ContractAddress,
        ) -> felt252 {
            self._compute_exit_hash(token, amount, recipient)
        }

        /// Returns whether the nullifier has been permanently consumed.
        fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.nullifier_used.read(nullifier)
        }

        /// Returns true only when a swap action is still pending for this nullifier.
        fn is_pending_swap(self: @ContractState, nullifier: felt252) -> bool {
            self.pending_action_exists_by_nullifier.read(nullifier)
                && self.pending_action_type_by_nullifier.read(nullifier) == ACTION_SWAP_PAYOUT_V3
        }

        /// Returns true only when a limit-order action is still pending for this nullifier.
        fn is_pending_limit(self: @ContractState, nullifier: felt252) -> bool {
            self.pending_action_exists_by_nullifier.read(nullifier)
                && self.pending_action_type_by_nullifier.read(nullifier) == ACTION_LIMIT_PAYOUT_V3
        }

        /// Returns true only when a staking action is still pending for this nullifier.
        fn is_pending_stake(self: @ContractState, nullifier: felt252) -> bool {
            self.pending_action_exists_by_nullifier.read(nullifier)
                && self.pending_action_type_by_nullifier.read(nullifier) == ACTION_STAKE_PAYOUT_V3
        }

        /// Returns the stored action hash for the pending private action.
        fn get_pending_action_hash(self: @ContractState, nullifier: felt252) -> felt252 {
            self.pending_action_hash_by_nullifier.read(nullifier)
        }

        /// Returns the stored payout recipient for the pending private action.
        fn get_pending_recipient(self: @ContractState, nullifier: felt252) -> ContractAddress {
            self.pending_recipient_by_nullifier.read(nullifier)
        }

        /// Returns the stored action type for the pending private action.
        fn get_pending_action_type(self: @ContractState, nullifier: felt252) -> felt252 {
            self.pending_action_type_by_nullifier.read(nullifier)
        }

        /// Legacy alias kept so older backend code can still read the action hash.
        fn get_pending_swap_action_hash(self: @ContractState, nullifier: felt252) -> felt252 {
            if self.pending_action_type_by_nullifier.read(nullifier) == ACTION_SWAP_PAYOUT_V3 {
                self.pending_action_hash_by_nullifier.read(nullifier)
            } else {
                0
            }
        }

        /// Legacy alias kept so older backend code can still read the recipient.
        fn get_pending_swap_recipient(self: @ContractState, nullifier: felt252) -> ContractAddress {
            if self.pending_action_type_by_nullifier.read(nullifier) == ACTION_SWAP_PAYOUT_V3 {
                self.pending_recipient_by_nullifier.read(nullifier)
            } else {
                _zero_address()
            }
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// Ensures only the admin can call the current code path.
        fn _assert_admin(self: @ContractState) {
            assert!(get_caller_address() == self.admin.read(), "Only admin");
        }

        /// Blocks normal user entrypoints while the contract is paused for incident response.
        fn _assert_not_paused(self: @ContractState) {
            assert!(!self.paused.read(), "Paused");
        }

        /// Ensures the caller is either the relayer or the admin override account.
        fn _assert_relayer_or_admin(self: @ContractState) {
            let caller = get_caller_address();
            assert!(
                caller == self.relayer.read() || caller == self.admin.read(),
                "Only relayer/admin",
            );
        }

        /// Lightweight global reentrancy guard for paths that perform external calls.
        fn _enter_reentrancy_guard(ref self: ContractState) {
            assert!(!self.reentrancy_lock.read(), "Reentrancy blocked");
            self.reentrancy_lock.write(true);
        }

        /// Releases the reentrancy guard once the external-call path is complete.
        fn _exit_reentrancy_guard(ref self: ContractState) {
            self.reentrancy_lock.write(false);
        }

        /// Verifies a proof, extracts its bound action data, and stores the pending action.
        fn _submit_private_action(
            ref self: ContractState,
            root: felt252,
            nullifier: felt252,
            proof: Span<felt252>,
            action_type: felt252,
        ) {
            self._assert_not_paused();
            self._enter_reentrancy_guard();

            let sender = get_caller_address();
            assert!(root != 0, "Root required");
            assert!(nullifier != 0, "Nullifier required");
            assert!(!self.nullifier_used.read(nullifier), "Nullifier already spent");
            assert!(!self.pending_action_exists_by_nullifier.read(nullifier), "Pending action exists");

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
                    let authorized_submitter = self.authorized_submitter_by_nullifier.read(nullifier);
                    if authorized_submitter.is_zero() {
                        self.authorized_submitter_by_nullifier.write(nullifier, sender);
                    } else {
                        assert!(authorized_submitter == sender, "Only original submitter");
                    }

                    let submitted_at = get_block_timestamp();
                    self.pending_action_exists_by_nullifier.write(nullifier, true);
                    self.pending_action_type_by_nullifier.write(nullifier, action_type);
                    self.pending_action_hash_by_nullifier.write(nullifier, action_hash);
                    self.pending_recipient_by_nullifier.write(nullifier, recipient);
                    self.pending_submitter_by_nullifier.write(nullifier, sender);
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
                    self._exit_reentrancy_guard();
                },
                Option::None => panic!("Invalid proof"),
            };
        }

        /// Executes a previously queued private action using exact approvals and state-first replay protection.
        fn _execute_private_action_with_payout(
            ref self: ContractState,
            nullifier: felt252,
            action_type: felt252,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            approval_amount: u256,
            payout_token: ContractAddress,
            min_payout: u256,
        ) {
            self._assert_relayer_or_admin();
            self._assert_not_paused();
            self._enter_reentrancy_guard();

            assert!(nullifier != 0, "Nullifier required");
            assert!(!self.nullifier_used.read(nullifier), "Nullifier already spent");
            assert!(self.pending_action_exists_by_nullifier.read(nullifier), "Pending action not found");
            assert!(!target.is_zero(), "Action target required");

            let expected_type = self.pending_action_type_by_nullifier.read(nullifier);
            assert!(expected_type == action_type, "Action type mismatch");

            let expected_hash = self.pending_action_hash_by_nullifier.read(nullifier);
            let recipient = self.pending_recipient_by_nullifier.read(nullifier);
            assert!(!recipient.is_zero(), "Recipient missing");
            let submitted_at = self.pending_submitted_at_by_nullifier.read(nullifier);
            assert!(
                get_block_timestamp() <= submitted_at + PENDING_ACTION_EXPIRY_SECS,
                "Pending action expired",
            );

            let computed_hash = self
                ._compute_action_hash(
                    action_type,
                    target,
                    entrypoint_selector,
                    calldata,
                    approval_token,
                    approval_amount,
                    payout_token,
                    min_payout,
                );
            assert!(computed_hash == expected_hash, "Action hash mismatch");

            self._clear_pending_action(nullifier);
            self.nullifier_used.write(nullifier, true);

            self._approve_exact_if_needed(approval_token, target, approval_amount);

            let self_address = get_contract_address();
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
                let payout_amount_local = if approval_token == payout_token {
                    let remaining_allowance = payout_dispatcher.allowance(self_address, target);
                    assert!(approval_amount >= remaining_allowance, "Allowance accounting invalid");
                    let approval_spent = approval_amount - remaining_allowance;
                    let total_received = after_balance + approval_spent;
                    assert!(total_received >= before_balance, "Payout underflow");
                    total_received - before_balance
                } else {
                    assert!(after_balance >= before_balance, "Payout underflow");
                    after_balance - before_balance
                };
                assert!(payout_amount_local >= min_payout, "Payout below min");
                let transferred = payout_dispatcher.transfer(recipient, payout_amount_local);
                assert!(transferred, "Payout transfer failed");
                payout_amount_local
            };

            self._reset_approval_if_needed(approval_token, target);
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
            self._exit_reentrancy_guard();
        }

        /// Clears all pending-action fields for a nullifier after execution or cancellation.
        fn _clear_pending_action(ref self: ContractState, nullifier: felt252) {
            self.pending_action_exists_by_nullifier.write(nullifier, false);
            self.pending_action_type_by_nullifier.write(nullifier, 0);
            self.pending_action_hash_by_nullifier.write(nullifier, 0);
            self.pending_recipient_by_nullifier.write(nullifier, _zero_address());
            self.pending_submitter_by_nullifier.write(nullifier, _zero_address());
            self.pending_submitted_at_by_nullifier.write(nullifier, 0);
        }

        /// Grants only the exact allowance needed for the current action.
        fn _approve_exact_if_needed(
            self: @ContractState,
            approval_token: ContractAddress,
            target: ContractAddress,
            approval_amount: u256,
        ) {
            if approval_token.is_zero() {
                assert!(_is_zero_u256(approval_amount), "approval_amount requires approval_token");
                return;
            }

            let approval_dispatcher = IERC20Dispatcher { contract_address: approval_token };
            let approved = approval_dispatcher.approve(target, approval_amount);
            assert!(approved, "Approval failed");
        }

        /// Resets allowance back to zero after the action completes.
        fn _reset_approval_if_needed(
            self: @ContractState, approval_token: ContractAddress, target: ContractAddress,
        ) {
            if approval_token.is_zero() {
                return;
            }

            let approval_dispatcher = IERC20Dispatcher { contract_address: approval_token };
            let reset = approval_dispatcher.approve(target, u256 { low: 0, high: 0 });
            assert!(reset, "Approval reset failed");
        }

        /// Hashes the execution payload so the proof and relayer execution bind to the same action on this deployment.
        fn _compute_action_hash(
            self: @ContractState,
            action_type: felt252,
            target: ContractAddress,
            entrypoint_selector: felt252,
            calldata: Span<felt252>,
            approval_token: ContractAddress,
            approval_amount: u256,
            payout_token: ContractAddress,
            min_payout: u256,
        ) -> felt252 {
            let contract_address_felt: felt252 = get_contract_address().into();
            let chain_id = get_tx_info().unbox().chain_id;
            let target_felt: felt252 = target.into();
            let approval_token_felt: felt252 = approval_token.into();
            let payout_token_felt: felt252 = payout_token.into();
            let approval_amount_low: felt252 = approval_amount.low.into();
            let approval_amount_high: felt252 = approval_amount.high.into();
            let min_payout_low: felt252 = min_payout.low.into();
            let min_payout_high: felt252 = min_payout.high.into();
            let calldata_hash = poseidon_hash_span(calldata);

            let mut binding: Array<felt252> = array![];
            binding.append(contract_address_felt);
            binding.append(chain_id);
            binding.append(action_type);
            binding.append(target_felt);
            binding.append(entrypoint_selector);
            binding.append(calldata_hash);
            binding.append(approval_token_felt);
            binding.append(approval_amount_low);
            binding.append(approval_amount_high);
            binding.append(payout_token_felt);
            binding.append(min_payout_low);
            binding.append(min_payout_high);
            poseidon_hash_span(binding.span())
        }

        /// Hashes the private-exit payload so the proof and withdrawal recipient bind to this deployment only.
        fn _compute_exit_hash(
            self: @ContractState, token: ContractAddress, amount: u256, recipient: ContractAddress,
        ) -> felt252 {
            let contract_address_felt: felt252 = get_contract_address().into();
            let chain_id = get_tx_info().unbox().chain_id;
            let token_felt: felt252 = token.into();
            let recipient_felt: felt252 = recipient.into();
            let amount_low: felt252 = amount.low.into();
            let amount_high: felt252 = amount.high.into();

            let mut binding: Array<felt252> = array![];
            binding.append(contract_address_felt);
            binding.append(chain_id);
            binding.append(ACTION_PRIVATE_EXIT_V3);
            binding.append(token_felt);
            binding.append(amount_low);
            binding.append(amount_high);
            binding.append(recipient_felt);
            poseidon_hash_span(binding.span())
        }
    }

    /// Returns true when both u256 limbs are zero.
    fn _is_zero_u256(value: u256) -> bool {
        value.low == 0 && value.high == 0
    }

    /// Converts a u256 into a single felt252 when the value fits the field representation used here.
    fn _u256_to_felt(value: u256) -> felt252 {
        const TWO_POW_128: felt252 = 0x100000000000000000000000000000000;
        let low_felt: felt252 = value.low.into();
        let high_felt: felt252 = value.high.into();
        high_felt * TWO_POW_128 + low_felt
    }

    /// Builds the storage key for a token and denomination fixed-amount rule.
    fn _asset_rule_key(token: ContractAddress, denom_id: felt252) -> felt252 {
        let token_felt: felt252 = token.into();
        let mut input: Array<felt252> = array![];
        input.append(token_felt);
        input.append(denom_id);
        poseidon_hash_span(input.span())
    }

    /// Returns the zero contract address used when clearing recipient fields.
    fn _zero_address() -> ContractAddress {
        0.try_into().unwrap()
    }
}
