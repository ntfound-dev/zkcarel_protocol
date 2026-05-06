/// @title ShieldedPoolV4
/// @notice ZK shielded pool with Merkle commitment tree, nullifier-gated withdrawals,
///         and proof-verified private swap/limit/stake actions.
#[starknet::contract]
mod shielded_pool_v4 {
    use core::array::{Array, ArrayTrait, Span};
    use core::poseidon::poseidon_hash_span;
    use core::num::traits::Zero;
    use core::traits::TryInto;
    use starknet::{
        ContractAddress, SyscallResultTrait, get_block_timestamp, get_caller_address,
        get_contract_address, get_tx_info,
    };
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::syscalls::call_contract_syscall;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::security::reentrancyguard::ReentrancyGuardComponent;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;
    impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    #[starknet::interface]
    trait IProofVerifier<TContractState> {
        fn verify_proof(
            self: @TContractState,
            proof: Span<felt252>,
            public_inputs: Span<felt252>,
        ) -> bool;
    }

    #[starknet::interface]
    trait IERC20<TContractState> {
        fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
        fn allowance(
            self: @TContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256;
        fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
        fn transfer_from(
            ref self: TContractState, sender: ContractAddress, recipient: ContractAddress,
            amount: u256,
        ) -> bool;
        fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    }

    #[storage]
    struct Storage {
        relayer: ContractAddress,
        paused: bool,

        swap_verifier: ContractAddress,
        limit_verifier: ContractAddress,
        stake_verifier: ContractAddress,

        fixed_amount_by_rule_key: Map<felt252, u256>,

        merkle_root: felt252,
        root_count: u64,
        root_seen: Map<felt252, bool>,
        next_leaf_index: u64,
        zero_nodes: Map<u64, felt252>,
        merkle_nodes: Map<(u64, u64), felt252>,
        merkle_leaves: Map<u64, felt252>,
        note_commitments: Map<felt252, bool>,
        note_token_by_commitment: Map<felt252, ContractAddress>,
        note_amount_by_commitment: Map<felt252, u256>,
        deposit_timestamp_by_commitment: Map<felt252, u64>,

        nullifiers: Map<felt252, bool>,
        pending_action_hash: Map<felt252, felt252>,
        pending_action_root: Map<felt252, felt252>,
        pending_action_kind: Map<felt252, u8>,
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        reentrancy_guard: ReentrancyGuardComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        DepositFixedV4: DepositFixedV4,
        MerkleLeafInserted: MerkleLeafInserted,
        MerkleRootUpdated: MerkleRootUpdated,
        PrivateActionSubmitted: PrivateActionSubmitted,
        PrivateActionExecuted: PrivateActionExecuted,
        NullifierUsed: NullifierUsed,
        AssetRuleUpdated: AssetRuleUpdated,
        RelayerUpdated: RelayerUpdated,
        Paused: Paused,
        Unpaused: Unpaused,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    struct DepositFixedV4 {
        token: ContractAddress,
        denom_id: felt252,
        note_commitment: felt252,
        ipfs_cid: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct MerkleLeafInserted {
        index: u64,
        note_commitment: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct MerkleRootUpdated {
        new_root: felt252,
        root_count: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct PrivateActionSubmitted {
        nullifier: felt252,
        action_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct PrivateActionExecuted {
        nullifier: felt252,
        action_hash: felt252,
        payout_token: ContractAddress,
        recipient: ContractAddress,
        payout_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct NullifierUsed {
        nullifier: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct AssetRuleUpdated {
        token: ContractAddress,
        denom_id: felt252,
        fixed_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct RelayerUpdated {
        relayer: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct Paused {}

    #[derive(Drop, starknet::Event)]
    struct Unpaused {}

    const MERKLE_DEPTH: u64 = 20;
    const ACTION_SWAP: u8 = 1;
    const ACTION_LIMIT: u8 = 2;
    const ACTION_STAKE: u8 = 3;

    const ACTION_SWAP_PAYOUT_V4: felt252 = 'SWAP_PAYOUT_V4';
    const ACTION_LIMIT_PAYOUT_V4: felt252 = 'LIMIT_PAYOUT_V4';
    const ACTION_STAKE_PAYOUT_V4: felt252 = 'STAKE_PAYOUT_V4';

    /// @notice Initializes the pool with an owner and optional pre-set Merkle root.
    /// @param owner Initial contract owner (two-step transfer via OZ OwnableComponent).
    /// @param initial_root Pre-set Merkle root, or zero to start from the empty-tree root.
    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, initial_root: felt252) {
        self.ownable.initializer(owner);
        self.relayer.write(0.try_into().unwrap());
        self.paused.write(false);
        self.next_leaf_index.write(0);

        let mut level: u64 = 0;
        let mut zero: felt252 = 0;
        while level <= MERKLE_DEPTH {
            self.zero_nodes.write(level, zero);
            zero = hash_pair(zero, zero);
            level += 1;
        }
        if initial_root != 0 {
            self.merkle_root.write(initial_root);
        } else {
            self.merkle_root.write(self.zero_nodes.read(MERKLE_DEPTH));
        }
        let root = self.merkle_root.read();
        self.root_count.write(1);
        self.root_seen.write(root, true);
    }

    #[external(v0)]
    fn get_root(self: @ContractState) -> felt252 {
        self.merkle_root.read()
    }

    #[external(v0)]
    fn get_root_count(self: @ContractState) -> u64 {
        self.root_count.read()
    }

    #[external(v0)]
    fn get_next_leaf_index(self: @ContractState) -> u64 {
        self.next_leaf_index.read()
    }

    #[external(v0)]
    fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
        self.nullifiers.read(nullifier)
    }

    #[external(v0)]
    fn get_pending_action(self: @ContractState, nullifier: felt252) -> (felt252, felt252, u8) {
        (
            self.pending_action_hash.read(nullifier),
            self.pending_action_root.read(nullifier),
            self.pending_action_kind.read(nullifier),
        )
    }

    #[external(v0)]
    fn get_note_deposit_timestamp(self: @ContractState, note_commitment: felt252) -> u64 {
        self.deposit_timestamp_by_commitment.read(note_commitment)
    }

    #[external(v0)]
    fn fixed_amount(self: @ContractState, token: ContractAddress, denom_id: felt252) -> u256 {
        let key = _asset_rule_key(token, denom_id);
        self.fixed_amount_by_rule_key.read(key)
    }

    #[external(v0)]
    fn is_paused(self: @ContractState) -> bool {
        self.paused.read()
    }

    /// @notice Sets the three Groth16 verifier contracts for swap, limit, and stake actions.
    /// @dev Callable only by the contract owner.
    #[external(v0)]
    fn set_verifiers(
        ref self: ContractState,
        swap_verifier: ContractAddress,
        limit_verifier: ContractAddress,
        stake_verifier: ContractAddress,
    ) {
        assert_owner(@self);
        self.swap_verifier.write(swap_verifier);
        self.limit_verifier.write(limit_verifier);
        self.stake_verifier.write(stake_verifier);
    }

    #[external(v0)]
    fn get_verifiers(self: @ContractState) -> (ContractAddress, ContractAddress, ContractAddress) {
        (
            self.swap_verifier.read(),
            self.limit_verifier.read(),
            self.stake_verifier.read(),
        )
    }

    /// @notice Sets the trusted relayer address.
    /// @dev Callable only by the contract owner. Emits `RelayerUpdated`.
    #[external(v0)]
    fn set_relayer(ref self: ContractState, relayer: ContractAddress) {
        assert_owner(@self);
        assert!(!relayer.is_zero(), "RELAYER_REQUIRED");
        self.relayer.write(relayer);
        self.emit(Event::RelayerUpdated(RelayerUpdated { relayer }));
    }

    /// @notice Pauses the pool. Emits `Paused`.
    /// @dev Callable only by the contract owner.
    #[external(v0)]
    fn pause(ref self: ContractState) {
        assert_owner(@self);
        self.paused.write(true);
        self.emit(Event::Paused(Paused {}));
    }

    /// @notice Unpauses the pool. Emits `Unpaused`.
    /// @dev Callable only by the contract owner.
    #[external(v0)]
    fn unpause(ref self: ContractState) {
        assert_owner(@self);
        self.paused.write(false);
        self.emit(Event::Unpaused(Unpaused {}));
    }

    /// @notice Asserts caller is the contract owner via OZ OwnableComponent.
    fn assert_owner(self: @ContractState) {
        let caller = get_caller_address();
        assert!(caller == self.ownable.owner(), "ONLY_OWNER");
    }

    /// @notice Asserts the contract is not paused.
    fn assert_not_paused(self: @ContractState) {
        assert!(!self.paused.read(), "PAUSED");
    }

    /// @notice Asserts caller is the relayer or owner.
    /// @dev If relayer is zero-address, any caller may proceed.
    fn assert_relayer_or_owner(self: @ContractState) {
        let caller = get_caller_address();
        let relayer = self.relayer.read();
        if relayer.is_zero() {
            return;
        }
        assert!(caller == relayer || caller == self.ownable.owner(), "ONLY_RELAYER_OR_OWNER");
    }

    /// @notice Begins an OZ ReentrancyGuard lock.
    fn enter_reentrancy_guard(ref self: ContractState) {
        self.reentrancy_guard.start();
    }

    /// @notice Ends an OZ ReentrancyGuard lock.
    fn exit_reentrancy_guard(ref self: ContractState) {
        self.reentrancy_guard.end();
    }

    fn hash_pair(left: felt252, right: felt252) -> felt252 {
        poseidon_hash_span(array![left, right].span())
    }

    fn get_node(self: @ContractState, level: u64, index: u64) -> felt252 {
        let stored = self.merkle_nodes.read((level, index));
        if stored == 0 {
            self.zero_nodes.read(level)
        } else {
            stored
        }
    }

    fn insert_leaf(ref self: ContractState, note_commitment: felt252) -> (u64, felt252) {
        assert!(note_commitment != 0, "ZERO_NOTE");
        let exists = self.note_commitments.read(note_commitment);
        assert!(!exists, "NOTE_EXISTS");
        let index = self.next_leaf_index.read();
        self.merkle_leaves.write(index, note_commitment);
        self.merkle_nodes.write((0, index), note_commitment);
        self.note_commitments.write(note_commitment, true);
        self.next_leaf_index.write(index + 1);
        self.emit(Event::MerkleLeafInserted(MerkleLeafInserted { index, note_commitment }));

        let mut current = note_commitment;
        let mut idx = index;
        let mut level: u64 = 0;
        while level < MERKLE_DEPTH {
            let is_right = (idx % 2) == 1;
            let left = if is_right { get_node(@self, level, idx - 1) } else { current };
            let right = if is_right { current } else { get_node(@self, level, idx + 1) };
            current = hash_pair(left, right);
            idx = idx / 2;
            self.merkle_nodes.write((level + 1, idx), current);
            level += 1;
        }

        (index, current)
    }

    fn update_root(ref self: ContractState, new_root: felt252) {
        let next = self.root_count.read() + 1;
        self.root_count.write(next);
        self.merkle_root.write(new_root);
        self.root_seen.write(new_root, true);
        self.emit(Event::MerkleRootUpdated(MerkleRootUpdated { new_root, root_count: next }));
    }

    fn read_public_inputs(
        public_inputs: @Array<felt252>,
    ) -> (felt252, felt252, felt252, felt252, felt252, felt252) {
        let len = public_inputs.len();
        assert!(len >= 6, "BAD_PUBLIC_INPUTS");
        let root = *public_inputs.at(0_usize);
        let nullifier = *public_inputs.at(1_usize);
        let action_hash = *public_inputs.at(2_usize);
        let recipient = *public_inputs.at(3_usize);
        let chain_id = *public_inputs.at(4_usize);
        let contract_address = *public_inputs.at(5_usize);
        (root, nullifier, action_hash, recipient, chain_id, contract_address)
    }

    fn verify_proof(
        self: @ContractState,
        verifier: ContractAddress,
        proof: Array<felt252>,
        public_inputs: Array<felt252>,
    ) {
        assert!(!verifier.is_zero(), "VERIFIER_NOT_SET");
        let dispatcher = IProofVerifierDispatcher { contract_address: verifier };
        let ok = dispatcher.verify_proof(proof.span(), public_inputs.span());
        assert!(ok, "INVALID_PROOF");
    }

    fn write_pending_action(
        ref self: ContractState,
        root: felt252,
        nullifier: felt252,
        action_hash: felt252,
        kind: u8,
    ) {
        assert!(!self.nullifiers.read(nullifier), "NULLIFIER_USED");
        assert!(self.pending_action_hash.read(nullifier) == 0, "PENDING_EXISTS");
        self.pending_action_hash.write(nullifier, action_hash);
        self.pending_action_root.write(nullifier, root);
        self.pending_action_kind.write(nullifier, kind);
        self.emit(Event::PrivateActionSubmitted(PrivateActionSubmitted {
            nullifier,
            action_hash,
        }));
    }

    fn clear_pending_action(ref self: ContractState, nullifier: felt252) {
        self.pending_action_hash.write(nullifier, 0);
        self.pending_action_root.write(nullifier, 0);
        self.pending_action_kind.write(nullifier, 0);
    }

    fn approve_exact_if_needed(
        self: @ContractState,
        approval_token: ContractAddress,
        target: ContractAddress,
        approval_amount: u256,
    ) {
        if approval_token.is_zero() {
            assert!(is_zero_u256(approval_amount), "approval_amount requires approval_token");
            return;
        }
        let approval_dispatcher = IERC20Dispatcher { contract_address: approval_token };
        let approved = approval_dispatcher.approve(target, approval_amount);
        assert!(approved, "Approval failed");
    }

    fn reset_approval_if_needed(
        self: @ContractState, approval_token: ContractAddress, target: ContractAddress,
    ) {
        if approval_token.is_zero() {
            return;
        }
        let approval_dispatcher = IERC20Dispatcher { contract_address: approval_token };
        let reset = approval_dispatcher.approve(target, u256 { low: 0, high: 0 });
        assert!(reset, "Approval reset failed");
    }

    fn compute_action_hash(
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

    fn compute_action_hash_with_lock_duration(
        self: @ContractState,
        action_type: felt252,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        approval_amount: u256,
        payout_token: ContractAddress,
        min_payout: u256,
        lock_duration: u64,
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
        binding.append(lock_duration.into());
        poseidon_hash_span(binding.span())
    }

    fn is_zero_u256(value: u256) -> bool {
        value.low == 0 && value.high == 0
    }

    fn asset_rule_key(token: ContractAddress, denom_id: felt252) -> felt252 {
        let token_felt: felt252 = token.into();
        let mut input: Array<felt252> = array![];
        input.append(token_felt);
        input.append(denom_id);
        poseidon_hash_span(input.span())
    }

    fn _asset_rule_key(token: ContractAddress, denom_id: felt252) -> felt252 {
        asset_rule_key(token, denom_id)
    }

    fn execute_private_action_with_payout(
        ref self: ContractState,
        verifier: ContractAddress,
        action_type: felt252,
        root: felt252,
        nullifier: felt252,
        proof: Array<felt252>,
        public_inputs: Array<felt252>,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        approval_amount: u256,
        payout_token: ContractAddress,
        min_payout: u256,
    ) {
        assert_not_paused(@self);
        assert_relayer_or_owner(@self);
        enter_reentrancy_guard(ref self);

        assert!(root != 0, "Root required");
        assert!(nullifier != 0, "Nullifier required");
        assert!(!target.is_zero(), "Action target required");
        assert!(!self.nullifiers.read(nullifier), "Nullifier already spent");
        assert!(self.root_seen.read(root), "Unknown root");

        let (root_pi, nullifier_pi, action_hash, recipient_felt, chain_id, contract_address) =
            read_public_inputs(@public_inputs);
        assert!(root_pi == root, "Proof root mismatch");
        assert!(nullifier_pi == nullifier, "Proof nullifier mismatch");
        let contract_felt: felt252 = get_contract_address().into();
        assert!(contract_address == contract_felt, "CONTRACT_MISMATCH");
        let tx_chain_id = get_tx_info().unbox().chain_id;
        assert!(chain_id == tx_chain_id, "CHAIN_ID_MISMATCH");

        verify_proof(@self, verifier, proof, public_inputs);
        assert!(action_hash != 0, "Action hash required");
        assert!(recipient_felt != 0, "Recipient required");
        let recipient: ContractAddress = recipient_felt.try_into().unwrap();
        assert!(!recipient.is_zero(), "Recipient required");

        let computed_hash = compute_action_hash(
            @self,
            action_type,
            target,
            entrypoint_selector,
            calldata,
            approval_token,
            approval_amount,
            payout_token,
            min_payout,
        );
        assert!(computed_hash == action_hash, "Action hash mismatch");

        self.nullifiers.write(nullifier, true);

        approve_exact_if_needed(@self, approval_token, target, approval_amount);

        let self_address = get_contract_address();
        let payout_amount = if payout_token.is_zero() {
            assert!(is_zero_u256(min_payout), "min_payout requires payout_token");
            let _ = call_contract_syscall(target, entrypoint_selector, calldata).unwrap_syscall();
            u256 { low: 0, high: 0 }
        } else {
            let payout_dispatcher = IERC20Dispatcher { contract_address: payout_token };
            let before_balance = payout_dispatcher.balance_of(self_address);
            let _ = call_contract_syscall(target, entrypoint_selector, calldata).unwrap_syscall();
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

        reset_approval_if_needed(@self, approval_token, target);
        self.emit(Event::PrivateActionExecuted(PrivateActionExecuted {
            nullifier,
            action_hash,
            payout_token,
            recipient,
            payout_amount,
        }));
        self.emit(Event::NullifierUsed(NullifierUsed { nullifier }));
        exit_reentrancy_guard(ref self);
    }

    fn execute_private_action_with_payout_and_lock(
        ref self: ContractState,
        verifier: ContractAddress,
        action_type: felt252,
        root: felt252,
        nullifier: felt252,
        proof: Array<felt252>,
        public_inputs: Array<felt252>,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        approval_amount: u256,
        payout_token: ContractAddress,
        min_payout: u256,
        lock_duration: u64,
    ) {
        assert_not_paused(@self);
        assert_relayer_or_owner(@self);
        enter_reentrancy_guard(ref self);

        assert!(root != 0, "Root required");
        assert!(nullifier != 0, "Nullifier required");
        assert!(!target.is_zero(), "Action target required");
        assert!(!self.nullifiers.read(nullifier), "Nullifier already spent");
        assert!(self.root_seen.read(root), "Unknown root");

        let (root_pi, nullifier_pi, action_hash, recipient_felt, chain_id, contract_address) =
            read_public_inputs(@public_inputs);
        assert!(root_pi == root, "Proof root mismatch");
        assert!(nullifier_pi == nullifier, "Proof nullifier mismatch");
        let contract_felt: felt252 = get_contract_address().into();
        assert!(contract_address == contract_felt, "CONTRACT_MISMATCH");
        let tx_chain_id = get_tx_info().unbox().chain_id;
        assert!(chain_id == tx_chain_id, "CHAIN_ID_MISMATCH");

        verify_proof(@self, verifier, proof, public_inputs);
        assert!(action_hash != 0, "Action hash required");
        assert!(recipient_felt != 0, "Recipient required");
        let recipient: ContractAddress = recipient_felt.try_into().unwrap();
        assert!(!recipient.is_zero(), "Recipient required");

        let computed_hash = compute_action_hash_with_lock_duration(
            @self,
            action_type,
            target,
            entrypoint_selector,
            calldata,
            approval_token,
            approval_amount,
            payout_token,
            min_payout,
            lock_duration,
        );
        assert!(computed_hash == action_hash, "Action hash mismatch");

        self.nullifiers.write(nullifier, true);

        approve_exact_if_needed(@self, approval_token, target, approval_amount);

        let self_address = get_contract_address();
        let payout_amount = if payout_token.is_zero() {
            assert!(is_zero_u256(min_payout), "min_payout requires payout_token");
            let _ = call_contract_syscall(target, entrypoint_selector, calldata).unwrap_syscall();
            u256 { low: 0, high: 0 }
        } else {
            let payout_dispatcher = IERC20Dispatcher { contract_address: payout_token };
            let before_balance = payout_dispatcher.balance_of(self_address);
            let _ = call_contract_syscall(target, entrypoint_selector, calldata).unwrap_syscall();
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

        reset_approval_if_needed(@self, approval_token, target);
        self.emit(Event::PrivateActionExecuted(PrivateActionExecuted {
            nullifier,
            action_hash,
            payout_token,
            recipient,
            payout_amount,
        }));
        self.emit(Event::NullifierUsed(NullifierUsed { nullifier }));
        exit_reentrancy_guard(ref self);
    }

    /// @notice Configures the fixed deposit amount for a token denomination.
    /// @dev Callable only by the contract owner. Emits `AssetRuleUpdated`.
    #[external(v0)]
    fn set_asset_rule(
        ref self: ContractState,
        token: ContractAddress,
        denom_id: felt252,
        fixed_amount: u256,
    ) {
        assert_owner(@self);
        assert!(!token.is_zero(), "Token required");
        assert!(denom_id != 0, "denom_id required");
        assert!(!is_zero_u256(fixed_amount), "Fixed amount required");
        let key = _asset_rule_key(token, denom_id);
        self.fixed_amount_by_rule_key.write(key, fixed_amount);
        self.emit(Event::AssetRuleUpdated(AssetRuleUpdated { token, denom_id, fixed_amount }));
    }

    /// @notice Deposits a fixed-denomination note into the shielded pool.
    /// @dev Transfers `fixed_amount` from caller and inserts note into Merkle tree. Emits `DepositFixedV4`.
    #[external(v0)]
    fn deposit_fixed_v4(
        ref self: ContractState,
        token: ContractAddress,
        denom_id: felt252,
        note_commitment: felt252,
        ipfs_cid: felt252,
    ) {
        assert_not_paused(@self);
        let sender = get_caller_address();
        assert!(!sender.is_zero(), "Sender required");
        assert!(!token.is_zero(), "Token required");
        assert!(denom_id != 0, "denom_id required");
        assert!(note_commitment != 0, "note_commitment required");

        let amount = fixed_amount(@self, token, denom_id);
        assert!(!is_zero_u256(amount), "Asset rule not set");

        let token_dispatcher = IERC20Dispatcher { contract_address: token };
        let self_address = get_contract_address();
        let transferred = token_dispatcher.transfer_from(sender, self_address, amount);
        assert!(transferred, "Deposit transfer_from failed");

        let ts = get_block_timestamp();
        self.deposit_timestamp_by_commitment.write(note_commitment, ts);
        self.note_token_by_commitment.write(note_commitment, token);
        self.note_amount_by_commitment.write(note_commitment, amount);

        let (_index, new_root) = insert_leaf(ref self, note_commitment);
        update_root(ref self, new_root);
        self.emit(Event::DepositFixedV4(DepositFixedV4 {
            token,
            denom_id,
            note_commitment,
            ipfs_cid,
        }));
    }

    /// @notice Submits a ZK proof for a private swap and records the pending action.
    /// @dev Verifier must be set; nullifier must be unspent; root must be known.
    #[external(v0)]
    fn submit_private_swap(
        ref self: ContractState,
        root: felt252,
        nullifier: felt252,
        proof: Array<felt252>,
        public_inputs: Array<felt252>,
    ) {
        let (root_pi, nullifier_pi, action_hash, _recipient, chain_id, contract_address) =
            read_public_inputs(@public_inputs);
        assert!(root_pi == root, "ROOT_MISMATCH");
        assert!(self.root_seen.read(root_pi), "ROOT_INACTIVE");
        assert!(nullifier_pi == nullifier, "NULLIFIER_MISMATCH");
        let _ = chain_id;
        let contract_felt: felt252 = get_contract_address().into();
        assert!(contract_address == contract_felt, "CONTRACT_MISMATCH");

        let verifier = self.swap_verifier.read();
        verify_proof(@self, verifier, proof, public_inputs);
        write_pending_action(ref self, root, nullifier, action_hash, ACTION_SWAP);
    }

    /// @notice Submits a ZK proof for a private limit order and records the pending action.
    #[external(v0)]
    fn submit_private_limit(
        ref self: ContractState,
        root: felt252,
        nullifier: felt252,
        proof: Array<felt252>,
        public_inputs: Array<felt252>,
    ) {
        let (root_pi, nullifier_pi, action_hash, _recipient, chain_id, contract_address) =
            read_public_inputs(@public_inputs);
        assert!(root_pi == root, "ROOT_MISMATCH");
        assert!(self.root_seen.read(root_pi), "ROOT_INACTIVE");
        assert!(nullifier_pi == nullifier, "NULLIFIER_MISMATCH");
        let _ = chain_id;
        let contract_felt: felt252 = get_contract_address().into();
        assert!(contract_address == contract_felt, "CONTRACT_MISMATCH");

        let verifier = self.limit_verifier.read();
        verify_proof(@self, verifier, proof, public_inputs);
        write_pending_action(ref self, root, nullifier, action_hash, ACTION_LIMIT);
    }

    /// @notice Submits a ZK proof for a private stake action and records the pending action.
    #[external(v0)]
    fn submit_private_stake(
        ref self: ContractState,
        root: felt252,
        nullifier: felt252,
        proof: Array<felt252>,
        public_inputs: Array<felt252>,
    ) {
        let (root_pi, nullifier_pi, action_hash, _recipient, chain_id, contract_address) =
            read_public_inputs(@public_inputs);
        assert!(root_pi == root, "ROOT_MISMATCH");
        assert!(self.root_seen.read(root_pi), "ROOT_INACTIVE");
        assert!(nullifier_pi == nullifier, "NULLIFIER_MISMATCH");
        let _ = chain_id;
        let contract_felt: felt252 = get_contract_address().into();
        assert!(contract_address == contract_felt, "CONTRACT_MISMATCH");

        let verifier = self.stake_verifier.read();
        verify_proof(@self, verifier, proof, public_inputs);
        write_pending_action(ref self, root, nullifier, action_hash, ACTION_STAKE);
    }

    #[external(v0)]
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
        compute_action_hash(
            self,
            ACTION_SWAP_PAYOUT_V4,
            target,
            entrypoint_selector,
            calldata,
            approval_token,
            approval_amount,
            payout_token,
            min_payout,
        )
    }

    #[external(v0)]
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
        compute_action_hash(
            self,
            ACTION_LIMIT_PAYOUT_V4,
            target,
            entrypoint_selector,
            calldata,
            approval_token,
            approval_amount,
            payout_token,
            min_payout,
        )
    }

    #[external(v0)]
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
        compute_action_hash(
            self,
            ACTION_STAKE_PAYOUT_V4,
            target,
            entrypoint_selector,
            calldata,
            approval_token,
            approval_amount,
            payout_token,
            min_payout,
        )
    }

    #[external(v0)]
    fn preview_stake_action_hash_internal(
        self: @ContractState,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Span<felt252>,
        approval_token: ContractAddress,
        approval_amount: u256,
        payout_token: ContractAddress,
        min_payout: u256,
        lock_duration: u64,
    ) -> felt252 {
        compute_action_hash_with_lock_duration(
            self,
            ACTION_STAKE_PAYOUT_V4,
            target,
            entrypoint_selector,
            calldata,
            approval_token,
            approval_amount,
            payout_token,
            min_payout,
            lock_duration,
        )
    }

    #[external(v0)]
    fn execute_private_swap_v4(
        ref self: ContractState,
        root: felt252,
        nullifier: felt252,
        proof: Array<felt252>,
        public_inputs: Array<felt252>,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Array<felt252>,
        approval_token: ContractAddress,
        approval_amount: u256,
        payout_token: ContractAddress,
        min_payout: u256,
    ) {
        let verifier = self.swap_verifier.read();
        execute_private_action_with_payout(
            ref self,
            verifier,
            ACTION_SWAP_PAYOUT_V4,
            root,
            nullifier,
            proof,
            public_inputs,
            target,
            entrypoint_selector,
            calldata.span(),
            approval_token,
            approval_amount,
            payout_token,
            min_payout,
        );
    }

    #[external(v0)]
    fn execute_private_limit_v4(
        ref self: ContractState,
        root: felt252,
        nullifier: felt252,
        proof: Array<felt252>,
        public_inputs: Array<felt252>,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Array<felt252>,
        approval_token: ContractAddress,
        approval_amount: u256,
        payout_token: ContractAddress,
        min_payout: u256,
    ) {
        let verifier = self.limit_verifier.read();
        execute_private_action_with_payout(
            ref self,
            verifier,
            ACTION_LIMIT_PAYOUT_V4,
            root,
            nullifier,
            proof,
            public_inputs,
            target,
            entrypoint_selector,
            calldata.span(),
            approval_token,
            approval_amount,
            payout_token,
            min_payout,
        );
    }

    #[external(v0)]
    fn execute_private_stake_internal_v4(
        ref self: ContractState,
        root: felt252,
        nullifier: felt252,
        proof: Array<felt252>,
        public_inputs: Array<felt252>,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Array<felt252>,
        approval_token: ContractAddress,
        approval_amount: u256,
        payout_token: ContractAddress,
        min_payout: u256,
        lock_duration: u64,
    ) {
        let verifier = self.stake_verifier.read();
        execute_private_action_with_payout_and_lock(
            ref self,
            verifier,
            ACTION_STAKE_PAYOUT_V4,
            root,
            nullifier,
            proof,
            public_inputs,
            target,
            entrypoint_selector,
            calldata.span(),
            approval_token,
            approval_amount,
            payout_token,
            min_payout,
            lock_duration,
        );
    }

    #[external(v0)]
    fn execute_private_stake_external_v4(
        ref self: ContractState,
        root: felt252,
        nullifier: felt252,
        proof: Array<felt252>,
        public_inputs: Array<felt252>,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Array<felt252>,
        approval_token: ContractAddress,
        approval_amount: u256,
        payout_token: ContractAddress,
        min_payout: u256,
    ) {
        let verifier = self.stake_verifier.read();
        execute_private_action_with_payout(
            ref self,
            verifier,
            ACTION_STAKE_PAYOUT_V4,
            root,
            nullifier,
            proof,
            public_inputs,
            target,
            entrypoint_selector,
            calldata.span(),
            approval_token,
            approval_amount,
            payout_token,
            min_payout,
        );
    }

    #[external(v0)]
    fn execute_private_unstake_v4(
        ref self: ContractState,
        root: felt252,
        nullifier: felt252,
        proof: Array<felt252>,
        public_inputs: Array<felt252>,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Array<felt252>,
        approval_token: ContractAddress,
        approval_amount: u256,
        payout_token: ContractAddress,
        min_payout: u256,
    ) {
        let verifier = self.stake_verifier.read();
        execute_private_action_with_payout(
            ref self,
            verifier,
            ACTION_STAKE_PAYOUT_V4,
            root,
            nullifier,
            proof,
            public_inputs,
            target,
            entrypoint_selector,
            calldata.span(),
            approval_token,
            approval_amount,
            payout_token,
            min_payout,
        );
    }

    #[external(v0)]
    fn execute_private_claim_v4(
        ref self: ContractState,
        root: felt252,
        nullifier: felt252,
        proof: Array<felt252>,
        public_inputs: Array<felt252>,
        target: ContractAddress,
        entrypoint_selector: felt252,
        calldata: Array<felt252>,
        approval_token: ContractAddress,
        approval_amount: u256,
        payout_token: ContractAddress,
        min_payout: u256,
    ) {
        let verifier = self.stake_verifier.read();
        execute_private_action_with_payout(
            ref self,
            verifier,
            ACTION_STAKE_PAYOUT_V4,
            root,
            nullifier,
            proof,
            public_inputs,
            target,
            entrypoint_selector,
            calldata.span(),
            approval_token,
            approval_amount,
            payout_token,
            min_payout,
        );
    }
}
