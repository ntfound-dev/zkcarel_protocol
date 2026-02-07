use starknet::ContractAddress;

#[derive(Copy, Clone, Drop, Serde, starknet::Store)]
pub struct Transaction {
    pub target: ContractAddress,
    pub selector: felt252,
    pub calldata_hash: felt252,
    pub confirmations_count: u256,
    pub executed: bool,
}

#[starknet::interface]
pub trait IMultisig<TContractState> {
    fn submit_transaction(
        ref self: TContractState, 
        target: ContractAddress, 
        selector: felt252, 
        calldata: Span<felt252>
    ) -> u256;
    fn confirm_transaction(ref self: TContractState, tx_id: u256);
    fn revoke_confirmation(ref self: TContractState, tx_id: u256);
    fn execute_transaction(ref self: TContractState, tx_id: u256, calldata: Span<felt252>);
    fn add_owner(ref self: TContractState, new_owner: ContractAddress);
    fn remove_owner(ref self: TContractState, owner_to_remove: ContractAddress);
    fn get_owners(self: @TContractState) -> Array<ContractAddress>;
    fn get_transaction(self: @TContractState, tx_id: u256) -> Transaction;
}

#[starknet::contract]
pub mod Multisig {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_caller_address, get_contract_address, SyscallResultTrait};
    use starknet::syscalls::call_contract_syscall;
    use core::poseidon::poseidon_hash_span;
    use super::Transaction;

    #[storage]
    pub struct Storage {
        pub owners: Vec<ContractAddress>,
        pub is_owner: Map<ContractAddress, bool>,
        pub required_confirmations: u256,
        pub transactions: Map<u256, Transaction>,
        pub confirmations: Map<(u256, ContractAddress), bool>,
        pub tx_count: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, initial_owners: Span<ContractAddress>, required: u256) {
        assert!(required > 0, "Required confirmations must be > 0");
        assert!(required <= initial_owners.len().into(), "Required exceeds owner count");

        let mut i: usize = 0;
        loop {
            if i >= initial_owners.len() { break; }
            let owner = *initial_owners.at(i);
            self.owners.push(owner);
            self.is_owner.entry(owner).write(true);
            i += 1;
        };
        self.required_confirmations.write(required);
    }

    #[abi(embed_v0)]
    pub impl MultisigImpl of super::IMultisig<ContractState> {
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

        fn execute_transaction(ref self: ContractState, tx_id: u256, calldata: Span<felt252>) {
            self.assert_only_owner();
            let mut tx = self.transactions.entry(tx_id).read();

            assert!(!tx.executed, "Already executed");
            assert!(tx.confirmations_count >= self.required_confirmations.read(), "Not enough confirmations");
            assert!(poseidon_hash_span(calldata) == tx.calldata_hash, "Invalid calldata");

            tx.executed = true;
            self.transactions.entry(tx_id).write(tx);

            // Menggunakan unwrap_syscall untuk menangkap error dari sub-call
            call_contract_syscall(tx.target, tx.selector, calldata).unwrap_syscall();
        }

        fn add_owner(ref self: ContractState, new_owner: ContractAddress) {
            self.assert_only_self();
            assert!(!self.is_owner.entry(new_owner).read(), "Already an owner");
            self.owners.push(new_owner);
            self.is_owner.entry(new_owner).write(true);
        }

        fn remove_owner(ref self: ContractState, owner_to_remove: ContractAddress) {
            self.assert_only_self();
            assert!(self.is_owner.entry(owner_to_remove).read(), "Not an owner");
            self.is_owner.entry(owner_to_remove).write(false);
        }

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

        fn get_transaction(self: @ContractState, tx_id: u256) -> Transaction {
            self.transactions.entry(tx_id).read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn assert_only_owner(self: @ContractState) {
            let caller = get_caller_address();
            assert!(self.is_owner.entry(caller).read(), "Caller is not an owner");
        }

        fn assert_only_self(self: @ContractState) {
            assert!(get_caller_address() == get_contract_address(), "Only contract can call this");
        }
    }
}