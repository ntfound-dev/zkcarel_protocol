use starknet::ContractAddress;

#[derive(Copy, Clone, Drop, Serde, starknet::Store)]
pub struct Transaction {
    pub target: ContractAddress,
    pub selector: felt252,
    pub calldata_hash: felt252,
    pub confirmations_count: u256,
    pub executed: bool,
}

// Multisig API for transaction proposal, confirmation, and execution.
// Coordinates sensitive protocol actions through owner quorum.
#[starknet::interface]
pub trait IMultisig<TContractState> {
    // Submits multisig transaction proposal and returns tx id.
    fn submit_transaction(
        ref self: TContractState, 
        target: ContractAddress, 
        selector: felt252, 
        calldata: Span<felt252>
    ) -> u256;
    // Confirms pending multisig transaction for caller owner key.
    fn confirm_transaction(ref self: TContractState, tx_id: u256);
    // Revokes caller confirmation on a pending transaction.
    fn revoke_confirmation(ref self: TContractState, tx_id: u256);
    // Executes multisig transaction when required confirmations reached.
    fn execute_transaction(ref self: TContractState, tx_id: u256, calldata: Span<felt252>);
    // Adds a new multisig owner through self-call governance.
    fn add_owner(ref self: TContractState, new_owner: ContractAddress);
    // Removes an existing multisig owner through self-call governance.
    fn remove_owner(ref self: TContractState, owner_to_remove: ContractAddress);
    // Returns current multisig owner set.
    fn get_owners(self: @TContractState) -> Array<ContractAddress>;
    // Returns transaction metadata and execution status by id.
    fn get_transaction(self: @TContractState, tx_id: u256) -> Transaction;
}

// Hide Mode hooks for multisig actions.
#[starknet::interface]
pub trait IMultisigPrivacy<TContractState> {
    // Sets privacy router used for Hide Mode actions.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Forwards private multisig payload to privacy router.
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

// Multi-owner execution gate for sensitive protocol actions.
// Uses calldata hashing to ensure approvals match executed payload.
#[starknet::contract]
pub mod Multisig {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_caller_address, get_contract_address, SyscallResultTrait};
    use starknet::syscalls::call_contract_syscall;
    use core::poseidon::poseidon_hash_span;
    use core::num::traits::Zero;
    use super::Transaction;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_MULTISIG;

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
    }

    // Initializes owner set and required confirmation threshold.
    // initial_owners/required: initial quorum configuration.
    #[constructor]
    fn constructor(ref self: ContractState, initial_owners: Span<ContractAddress>, required: u256) {
        assert!(required > 0, "Required confirmations must be > 0");
        assert!(required <= initial_owners.len().into(), "Required exceeds owner count");

        let mut i: usize = 0;
        while i < initial_owners.len() {
            let owner = *initial_owners.at(i);
            self.owners.push(owner);
            self.is_owner.entry(owner).write(true);
            i += 1;
        }
        self.required_confirmations.write(required);
        self.executing.write(false);
    }

    #[abi(embed_v0)]
    pub impl MultisigImpl of super::IMultisig<ContractState> {
        // Submits multisig transaction proposal and returns tx id.
        fn submit_transaction(
            ref self: ContractState, 
            target: ContractAddress, 
            selector: felt252, 
            calldata: Span<felt252>
        ) -> u256 {
            self.assert_only_owner();
            
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
            id
        }

        // Confirms pending multisig transaction for caller owner key.
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
        }

        // Revokes caller confirmation on a pending transaction.
        fn revoke_confirmation(ref self: ContractState, tx_id: u256) {
            self.assert_only_owner();
            let caller = get_caller_address();
            let mut tx = self.transactions.entry(tx_id).read();

            assert!(!tx.executed, "Transaction already executed");
            assert!(self.confirmations.entry((tx_id, caller)).read(), "Not confirmed by user");

            tx.confirmations_count -= 1;
            self.confirmations.entry((tx_id, caller)).write(false);
            self.transactions.entry(tx_id).write(tx);
        }

        // Executes multisig transaction when required confirmations reached.
        fn execute_transaction(ref self: ContractState, tx_id: u256, calldata: Span<felt252>) {
            self.assert_only_owner();
            let mut tx = self.transactions.entry(tx_id).read();

            assert!(!tx.executed, "Already executed");
            assert!(tx.confirmations_count >= self.required_confirmations.read(), "Not enough confirmations");
            assert!(poseidon_hash_span(calldata) == tx.calldata_hash, "Invalid calldata");

            tx.executed = true;
            self.transactions.entry(tx_id).write(tx);

            // Mark execution context before the downstream contract call.
            self.executing.write(true);
            call_contract_syscall(tx.target, tx.selector, calldata).unwrap_syscall();
            self.executing.write(false);
        }

        // Adds a new owner; callable only through successful multisig self-call.
        fn add_owner(ref self: ContractState, new_owner: ContractAddress) {
            self.assert_only_self();
            assert!(!self.is_owner.entry(new_owner).read(), "Already an owner");
            self.owners.push(new_owner);
            self.is_owner.entry(new_owner).write(true);
        }

        // Removes an owner and adjusts threshold if it exceeds active owner count.
        fn remove_owner(ref self: ContractState, owner_to_remove: ContractAddress) {
            self.assert_only_self();
            assert!(self.is_owner.entry(owner_to_remove).read(), "Not an owner");
            self.is_owner.entry(owner_to_remove).write(false);

            // Ensure required confirmations do not exceed active owners
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
        }

        // Returns current multisig owner set.
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

        // Returns transaction metadata and execution status by id.
        fn get_transaction(self: @ContractState, tx_id: u256) -> Transaction {
            self.transactions.entry(tx_id).read()
        }
    }

    #[abi(embed_v0)]
    impl MultisigPrivacyImpl of super::IMultisigPrivacy<ContractState> {
        // Sets privacy router used for Hide Mode multisig actions.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Relays private multisig payload for proof verification and execution.
        // `nullifiers` prevent replay and `commitments` bind intended operation.
        fn submit_private_multisig_action(
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
        // Asserts caller is one of multisig owners.
        fn assert_only_owner(self: @ContractState) {
            let caller = get_caller_address();
            assert!(self.is_owner.entry(caller).read(), "Caller is not an owner");
        }

        // Asserts call originates from the multisig contract itself.
        fn assert_only_self(self: @ContractState) {
            if self.executing.read() {
                return;
            }
            assert!(get_caller_address() == get_contract_address(), "Only contract can call this");
        }
    }
}
