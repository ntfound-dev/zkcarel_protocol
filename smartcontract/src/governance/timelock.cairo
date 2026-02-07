use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct QueuedTransaction {
    pub target: ContractAddress,
    pub value: u256,
    pub calldata_hash: felt252,
    pub eta: u64,
    pub executed: bool,
    pub canceled: bool,
}

#[starknet::interface]
pub trait ITimelock<TContractState> {
    fn queue_transaction(
        ref self: TContractState, 
        target: ContractAddress, 
        value: u256, 
        calldata: Span<felt252>, 
        eta: u64
    ) -> felt252;
    fn execute_transaction(
        ref self: TContractState, 
        target: ContractAddress, 
        value: u256, 
        calldata: Span<felt252>, 
        eta: u64
    ) -> Span<felt252>;
    fn cancel_transaction(ref self: TContractState, tx_id: felt252);
    fn get_min_delay(self: @TContractState) -> u64;
    fn get_transaction(self: @TContractState, tx_id: felt252) -> QueuedTransaction;
}

#[starknet::contract]
pub mod Timelock {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_caller_address, get_block_timestamp};
    use starknet::syscalls::call_contract_syscall;
    use core::poseidon::poseidon_hash_span;
    use super::QueuedTransaction;

    #[storage]
    pub struct Storage {
        pub min_delay: u64,
        pub queued_txs: Map<felt252, QueuedTransaction>,
        pub admin: ContractAddress,
        pub proposers: Map<ContractAddress, bool>,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, min_delay: u64) {
        self.admin.write(admin);
        self.min_delay.write(min_delay);
    }

    #[abi(embed_v0)]
    pub impl TimelockImpl of super::ITimelock<ContractState> {
        fn queue_transaction(
            ref self: ContractState, 
            target: ContractAddress, 
            value: u256, 
            calldata: Span<felt252>, 
            eta: u64
        ) -> felt252 {
            self.assert_only_proposer();
            
            let min_delay = self.min_delay.read();
            let current_time = get_block_timestamp();
            
            assert!(eta >= current_time + min_delay, "ETA below minimum delay");

            let tx_id = self._hash_transaction(target, value, calldata, eta);
            assert!(self.queued_txs.entry(tx_id).eta.read() == 0, "Transaction already queued");

            let queued_tx = QueuedTransaction {
                target,
                value,
                calldata_hash: poseidon_hash_span(calldata),
                eta,
                executed: false,
                canceled: false,
            };

            self.queued_txs.entry(tx_id).write(queued_tx);
            tx_id
        }

        fn execute_transaction(
            ref self: ContractState, 
            target: ContractAddress, 
            value: u256, 
            calldata: Span<felt252>, 
            eta: u64
        ) -> Span<felt252> {
            let tx_id = self._hash_transaction(target, value, calldata, eta);
            let mut queued_tx = self.queued_txs.entry(tx_id).read();

            assert!(queued_tx.eta != 0, "Transaction not queued");
            assert!(get_block_timestamp() >= queued_tx.eta, "Transaction not ready");
            assert!(!queued_tx.executed, "Transaction already executed");
            assert!(!queued_tx.canceled, "Transaction was canceled");

            queued_tx.executed = true;
            self.queued_txs.entry(tx_id).write(queued_tx);

            // In Starknet, 'value' (ETH) is typically handled via a separate 
            // ERC20 transfer, but we proceed with the target call here.
            let result = call_contract_syscall(target, selector!("execute"), calldata).unwrap();
            result
        }

        fn cancel_transaction(ref self: ContractState, tx_id: felt252) {
            self.assert_only_proposer();
            let mut queued_tx = self.queued_txs.entry(tx_id).read();
            
            assert!(queued_tx.eta != 0, "Transaction not queued");
            assert!(!queued_tx.executed, "Cannot cancel executed tx");
            
            queued_tx.canceled = true;
            self.queued_txs.entry(tx_id).write(queued_tx);
        }

        fn get_min_delay(self: @ContractState) -> u64 {
            self.min_delay.read()
        }

        fn get_transaction(self: @ContractState, tx_id: felt252) -> QueuedTransaction {
            self.queued_txs.entry(tx_id).read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn assert_only_proposer(self: @ContractState) {
            let caller = get_caller_address();
            assert!(
                caller == self.admin.read() || self.proposers.entry(caller).read(), 
                "Caller is not a proposer"
            );
        }

        fn _hash_transaction(
            self: @ContractState, 
            target: ContractAddress, 
            value: u256, 
            calldata: Span<felt252>, 
            eta: u64
        ) -> felt252 {
            let mut data = array![];
            target.serialize(ref data);
            value.serialize(ref data);
            poseidon_hash_span(calldata).serialize(ref data);
            eta.serialize(ref data);
            poseidon_hash_span(data.span())
        }
    }
}


