use starknet::ContractAddress;

/// @notice Transaction proposal stored in the multisig queue.
#[derive(Copy, Clone, Drop, Serde, starknet::Store)]
pub struct Transaction {
    pub target: ContractAddress,
    pub selector: felt252,
    pub calldata_hash: felt252,
    pub confirmations_count: u256,
    pub executed: bool,
}

/// @title IMultisig
/// @notice Multi-owner transaction gate for sensitive protocol actions.
///         Calldata is hashed on submission so approvals bind to a specific payload.
#[starknet::interface]
pub trait IMultisig<TContractState> {
    /// @notice Submits a new transaction proposal and returns its ID.
    /// @dev Callable only by registered owners. Calldata is stored as a Poseidon hash.
    /// @param target Address the transaction will call.
    /// @param selector Function selector to call on `target`.
    /// @param calldata Calldata for the call (hashed for integrity binding).
    /// @return Assigned transaction ID.
    fn submit_transaction(
        ref self: TContractState,
        target: ContractAddress,
        selector: felt252,
        calldata: Span<felt252>
    ) -> u256;

    /// @notice Confirms a pending transaction on behalf of the calling owner.
    /// @dev Callable only by registered owners. Each owner may confirm once per transaction.
    /// @param tx_id Transaction to confirm.
    fn confirm_transaction(ref self: TContractState, tx_id: u256);

    /// @notice Revokes the calling owner's confirmation for a pending transaction.
    /// @dev Callable only by registered owners. Transaction must not yet be executed.
    /// @param tx_id Transaction to revoke confirmation for.
    fn revoke_confirmation(ref self: TContractState, tx_id: u256);

    /// @notice Executes a transaction that has reached the required confirmation threshold.
    /// @dev Callable only by registered owners. Verifies calldata matches stored hash.
    /// @param tx_id Transaction to execute.
    /// @param calldata Calldata for the call (must hash to match stored hash).
    fn execute_transaction(ref self: TContractState, tx_id: u256, calldata: Span<felt252>);

    /// @notice Adds a new owner to the multisig set.
    /// @dev Callable only via a successful multisig self-call (through `execute_transaction`).
    /// @param new_owner Address to add as an owner.
    fn add_owner(ref self: TContractState, new_owner: ContractAddress);

    /// @notice Removes an existing owner from the multisig set.
    /// @dev Callable only via a successful multisig self-call.
    ///      Reduces the required threshold if it would exceed the remaining owner count.
    /// @param owner_to_remove Address to remove.
    fn remove_owner(ref self: TContractState, owner_to_remove: ContractAddress);

    /// @notice Returns the current set of active owners.
    /// @return Array of active owner addresses.
    fn get_owners(self: @TContractState) -> Array<ContractAddress>;

    /// @notice Returns metadata and execution status for a transaction.
    /// @param tx_id Transaction to query.
    /// @return Transaction struct.
    fn get_transaction(self: @TContractState, tx_id: u256) -> Transaction;
}

/// @title IMultisigPrivacy
/// @notice Hide Mode hooks for multisig actions through the privacy router.
#[starknet::interface]
pub trait IMultisigPrivacy<TContractState> {
    /// @notice Sets the privacy router for private multisig actions.
    /// @dev Callable only by a registered owner. Emits `PrivacyRouterUpdated`.
    /// @param router New privacy router address (must be non-zero).
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);

    /// @notice Forwards a nullifier/commitment-bound multisig payload to the privacy router.
    /// @dev Nullifiers are replay-protected: each may only be consumed once.
    /// @param old_root Previous Merkle tree root.
    /// @param new_root Updated Merkle tree root after commitments.
    /// @param nullifiers Nullifiers for inputs being spent.
    /// @param commitments New Merkle commitments.
    /// @param public_inputs ZK circuit public inputs.
    /// @param proof Serialized ZK proof.
    fn submit_private_multisig_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @title Multisig
/// @notice Multi-owner execution gate. Sensitive protocol actions require quorum approval.
///         Calldata hashing ensures confirmations bind to the exact execution payload.
#[starknet::contract]
pub mod Multisig {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_caller_address, get_contract_address, SyscallResultTrait};
    use starknet::syscalls::call_contract_syscall;
    use core::poseidon::poseidon_hash_span;
    use core::num::traits::Zero;
    use super::Transaction;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_MULTISIG;

    #[storage]
    pub struct Storage {
        pub owners: Vec<ContractAddress>,
        pub is_owner: Map<ContractAddress, bool>,
        pub required_confirmations: u256,
        pub transactions: Map<u256, Transaction>,
        pub confirmations: Map<(u256, ContractAddress), bool>,
        pub tx_count: u256,
        pub executing: bool,
        pub privacy_router: ContractAddress,
        pub used_nullifiers: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        TransactionSubmitted: TransactionSubmitted,
        TransactionConfirmed: TransactionConfirmed,
        ConfirmationRevoked: ConfirmationRevoked,
        TransactionExecuted: TransactionExecuted,
        OwnerAdded: OwnerAdded,
        OwnerRemoved: OwnerRemoved,
        PrivacyRouterUpdated: PrivacyRouterUpdated,
    }

    /// @notice Emitted when a new transaction is submitted for quorum approval.
    #[derive(Drop, starknet::Event)]
    pub struct TransactionSubmitted {
        pub tx_id: u256,
        pub submitter: ContractAddress,
        pub target: ContractAddress,
    }

    /// @notice Emitted when an owner confirms a pending transaction.
    #[derive(Drop, starknet::Event)]
    pub struct TransactionConfirmed {
        pub tx_id: u256,
        pub owner: ContractAddress,
    }

    /// @notice Emitted when an owner revokes their confirmation.
    #[derive(Drop, starknet::Event)]
    pub struct ConfirmationRevoked {
        pub tx_id: u256,
        pub owner: ContractAddress,
    }

    /// @notice Emitted when a transaction is successfully executed.
    #[derive(Drop, starknet::Event)]
    pub struct TransactionExecuted {
        pub tx_id: u256,
        pub executor: ContractAddress,
    }

    /// @notice Emitted when a new owner is added to the multisig.
    #[derive(Drop, starknet::Event)]
    pub struct OwnerAdded {
        pub owner: ContractAddress,
    }

    /// @notice Emitted when an owner is removed from the multisig.
    #[derive(Drop, starknet::Event)]
    pub struct OwnerRemoved {
        pub owner: ContractAddress,
    }

    /// @notice Emitted when the privacy router address is updated.
    #[derive(Drop, starknet::Event)]
    pub struct PrivacyRouterUpdated {
        pub router: ContractAddress,
    }

    /// @notice Initializes the owner set and required confirmation threshold.
    /// @param initial_owners Initial set of authorized owners (must be non-empty, no duplicates).
    /// @param required Minimum confirmations required to execute (must be > 0 and ≤ owner count).
    #[constructor]
    fn constructor(ref self: ContractState, initial_owners: Span<ContractAddress>, required: u256) {
        assert!(required > 0, "Required confirmations must be > 0");
        assert!(required <= initial_owners.len().into(), "Required exceeds owner count");

        let mut i: usize = 0;
        while i < initial_owners.len() {
            let owner = *initial_owners.at(i);
            assert!(!owner.is_zero(), "Owner required");
            assert!(!self.is_owner.entry(owner).read(), "Duplicate owner");
            self.owners.push(owner);
            self.is_owner.entry(owner).write(true);
            i += 1;
        }
        self.required_confirmations.write(required);
        self.executing.write(false);
    }

    #[abi(embed_v0)]
    pub impl MultisigImpl of super::IMultisig<ContractState> {
        /// @inheritdoc IMultisig
        fn submit_transaction(
            ref self: ContractState,
            target: ContractAddress,
            selector: felt252,
            calldata: Span<felt252>
        ) -> u256 {
            self.assert_only_owner();
            let caller = get_caller_address();
            let id = self.tx_count.read() + 1;
            let new_tx = Transaction {
                target,
                selector,
                calldata_hash: poseidon_hash_span(calldata),
                confirmations_count: 0,
                executed: false,
            };
            self.transactions.entry(id).write(new_tx);
            self.tx_count.write(id);
            self.emit(Event::TransactionSubmitted(TransactionSubmitted { tx_id: id, submitter: caller, target }));
            id
        }

        /// @inheritdoc IMultisig
        fn confirm_transaction(ref self: ContractState, tx_id: u256) {
            self.assert_only_owner();
            let caller = get_caller_address();
            let mut tx = self.transactions.entry(tx_id).read();
            assert!(tx_id <= self.tx_count.read() && tx_id > 0, "Transaction does not exist");
            assert!(!tx.executed, "Transaction already executed");
            assert!(!self.confirmations.entry((tx_id, caller)).read(), "Already confirmed");
            tx.confirmations_count += 1;
            self.confirmations.entry((tx_id, caller)).write(true);
            self.transactions.entry(tx_id).write(tx);
            self.emit(Event::TransactionConfirmed(TransactionConfirmed { tx_id, owner: caller }));
        }

        /// @inheritdoc IMultisig
        fn revoke_confirmation(ref self: ContractState, tx_id: u256) {
            self.assert_only_owner();
            let caller = get_caller_address();
            let mut tx = self.transactions.entry(tx_id).read();
            assert!(!tx.executed, "Transaction already executed");
            assert!(self.confirmations.entry((tx_id, caller)).read(), "Not confirmed by user");
            tx.confirmations_count -= 1;
            self.confirmations.entry((tx_id, caller)).write(false);
            self.transactions.entry(tx_id).write(tx);
            self.emit(Event::ConfirmationRevoked(ConfirmationRevoked { tx_id, owner: caller }));
        }

        /// @inheritdoc IMultisig
        fn execute_transaction(ref self: ContractState, tx_id: u256, calldata: Span<felt252>) {
            self.assert_only_owner();
            let caller = get_caller_address();
            let mut tx = self.transactions.entry(tx_id).read();
            assert!(!tx.executed, "Already executed");
            assert!(tx.confirmations_count >= self.required_confirmations.read(), "Not enough confirmations");
            assert!(poseidon_hash_span(calldata) == tx.calldata_hash, "Invalid calldata");
            tx.executed = true;
            self.transactions.entry(tx_id).write(tx);
            self.executing.write(true);
            call_contract_syscall(tx.target, tx.selector, calldata).unwrap_syscall();
            self.executing.write(false);
            self.emit(Event::TransactionExecuted(TransactionExecuted { tx_id, executor: caller }));
        }

        /// @inheritdoc IMultisig
        fn add_owner(ref self: ContractState, new_owner: ContractAddress) {
            self.assert_only_self();
            assert!(!self.is_owner.entry(new_owner).read(), "Already an owner");
            self.owners.push(new_owner);
            self.is_owner.entry(new_owner).write(true);
            self.emit(Event::OwnerAdded(OwnerAdded { owner: new_owner }));
        }

        /// @inheritdoc IMultisig
        fn remove_owner(ref self: ContractState, owner_to_remove: ContractAddress) {
            self.assert_only_self();
            assert!(self.is_owner.entry(owner_to_remove).read(), "Not an owner");
            self.is_owner.entry(owner_to_remove).write(false);
            let mut active_count: u256 = 0;
            for i in 0..self.owners.len() {
                let owner = self.owners.at(i).read();
                if self.is_owner.entry(owner).read() {
                    active_count += 1;
                }
            };
            let required = self.required_confirmations.read();
            if required > active_count {
                self.required_confirmations.write(active_count);
            }
            self.emit(Event::OwnerRemoved(OwnerRemoved { owner: owner_to_remove }));
        }

        /// @inheritdoc IMultisig
        fn get_owners(self: @ContractState) -> Array<ContractAddress> {
            let mut result = array![];
            for i in 0..self.owners.len() {
                let owner = self.owners.at(i).read();
                if self.is_owner.entry(owner).read() {
                    result.append(owner);
                }
            };
            result
        }

        /// @inheritdoc IMultisig
        fn get_transaction(self: @ContractState, tx_id: u256) -> Transaction {
            self.transactions.entry(tx_id).read()
        }
    }

    #[abi(embed_v0)]
    impl MultisigPrivacyImpl of super::IMultisigPrivacy<ContractState> {
        /// @inheritdoc IMultisigPrivacy
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
            self.emit(Event::PrivacyRouterUpdated(PrivacyRouterUpdated { router }));
        }

        /// @inheritdoc IMultisigPrivacy
        fn submit_private_multisig_action(
            ref self: ContractState,
            old_root: felt252,
            new_root: felt252,
            nullifiers: Span<felt252>,
            commitments: Span<felt252>,
            public_inputs: Span<felt252>,
            proof: Span<felt252>
        ) {
            let total: u64 = nullifiers.len().into();
            let mut i: u64 = 0;
            while i < total {
                let idx: u32 = i.try_into().unwrap();
                let nf = *nullifiers.at(idx);
                assert!(!self.used_nullifiers.entry(nf).read(), "Nullifier already used");
                self.used_nullifiers.entry(nf).write(true);
                i += 1;
            };
            let router = self.privacy_router.read();
            assert!(!router.is_zero(), "Privacy router not set");
            let dispatcher = IPrivacyRouterDispatcher { contract_address: router };
            dispatcher.submit_action(
                ACTION_MULTISIG,
                old_root,
                new_root,
                nullifiers,
                commitments,
                public_inputs,
                proof
            );
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// Asserts caller is one of the registered multisig owners.
        fn assert_only_owner(self: @ContractState) {
            let caller = get_caller_address();
            assert!(self.is_owner.entry(caller).read(), "Caller is not an owner");
        }

        /// Asserts call originates from the multisig contract itself (via execute_transaction).
        fn assert_only_self(self: @ContractState) {
            assert!(get_caller_address() == get_contract_address(), "Only contract can call this");
        }
    }
}
