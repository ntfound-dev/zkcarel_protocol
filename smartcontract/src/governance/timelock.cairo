use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct QueuedTransaction {
    pub target: ContractAddress,
    pub selector: felt252,
    pub value: u256,
    pub calldata_hash: felt252,
    pub eta: u64,
    pub executed: bool,
    pub canceled: bool,
}

/// @title Timelock Interface
/// @author CAREL Team
/// @notice Defines queued execution flow for governance actions.
/// @dev Enforces minimum delay before sensitive actions are executed.
#[starknet::interface]
pub trait ITimelock<TContractState> {
    /// @notice Queues a transaction for delayed execution.
    /// @dev Requires proposer permissions and minimum delay.
    /// @param target Target contract address.
    /// @param selector Target function selector.
    /// @param value Value parameter for compatibility.
    /// @param calldata Call data to execute.
    /// @param eta Earliest execution time.
    /// @return tx_id Unique transaction id.
    fn queue_transaction(
        ref self: TContractState, 
        target: ContractAddress, 
        selector: felt252,
        value: u256, 
        calldata: Span<felt252>, 
        eta: u64
    ) -> felt252;
    /// @notice Executes a queued transaction after delay.
    /// @dev Validates ETA and prevents double execution.
    /// @param target Target contract address.
    /// @param selector Target function selector.
    /// @param value Value parameter for compatibility.
    /// @param calldata Call data to execute.
    /// @param eta Earliest execution time.
    /// @return result Raw call result.
    fn execute_transaction(
        ref self: TContractState, 
        target: ContractAddress, 
        selector: felt252,
        value: u256, 
        calldata: Span<felt252>, 
        eta: u64
    ) -> Span<felt252>;
    /// @notice Cancels a queued transaction.
    /// @dev Proposer-only to allow governance to abort actions.
    /// @param tx_id Transaction id to cancel.
    fn cancel_transaction(ref self: TContractState, tx_id: felt252);
    /// @notice Returns the minimum delay for queued transactions.
    /// @dev Read-only helper for UI and audits.
    /// @return delay Minimum delay in seconds.
    fn get_min_delay(self: @TContractState) -> u64;
    /// @notice Returns stored data for a queued transaction.
    /// @dev Read-only helper for audits.
    /// @param tx_id Transaction id to fetch.
    /// @return tx Stored queued transaction.
    fn get_transaction(self: @TContractState, tx_id: felt252) -> QueuedTransaction;
}

/// @title Timelock Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy hooks for timelock actions.
#[starknet::interface]
pub trait ITimelockPrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private timelock action proof.
    fn submit_private_timelock_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @title Timelock Contract
/// @author CAREL Team
/// @notice Enforces time-delayed execution for governance actions.
/// @dev Uses poseidon hash to uniquely identify queued actions.
#[starknet::contract]
pub mod Timelock {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_caller_address, get_block_timestamp};
    use starknet::syscalls::call_contract_syscall;
    use core::poseidon::poseidon_hash_span;
    use core::num::traits::Zero;
    use super::QueuedTransaction;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_TIMELOCK;

    #[storage]
    pub struct Storage {
        pub min_delay: u64,
        pub queued_txs: Map<felt252, QueuedTransaction>,
        pub admin: ContractAddress,
        pub proposers: Map<ContractAddress, bool>,
        pub privacy_router: ContractAddress,
    }

    /// @notice Initializes the timelock.
    /// @dev Sets admin and minimum delay.
    /// @param admin Admin address with proposer powers.
    /// @param min_delay Minimum delay in seconds.
    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, min_delay: u64) {
        self.admin.write(admin);
        self.min_delay.write(min_delay);
    }

    #[abi(embed_v0)]
    pub impl TimelockImpl of super::ITimelock<ContractState> {
        /// @notice Queues a transaction for delayed execution.
        /// @dev Requires proposer permissions and minimum delay.
        /// @param target Target contract address.
        /// @param selector Target function selector.
        /// @param value Value parameter for compatibility.
        /// @param calldata Call data to execute.
        /// @param eta Earliest execution time.
        /// @return tx_id Unique transaction id.
        fn queue_transaction(
            ref self: ContractState, 
            target: ContractAddress, 
            selector: felt252,
            value: u256, 
            calldata: Span<felt252>, 
            eta: u64
        ) -> felt252 {
            self.assert_only_proposer();
            
            let min_delay = self.min_delay.read();
            let current_time = get_block_timestamp();
            
            assert!(eta >= current_time + min_delay, "ETA below minimum delay");

            let tx_id = self._hash_transaction(target, selector, value, calldata, eta);
            assert!(self.queued_txs.entry(tx_id).eta.read() == 0, "Transaction already queued");

            let queued_tx = QueuedTransaction {
                target,
                selector,
                value,
                calldata_hash: poseidon_hash_span(calldata),
                eta,
                executed: false,
                canceled: false,
            };

            self.queued_txs.entry(tx_id).write(queued_tx);
            tx_id
        }

        /// @notice Executes a queued transaction after delay.
        /// @dev Validates ETA and prevents double execution.
        /// @param target Target contract address.
        /// @param selector Target function selector.
        /// @param value Value parameter for compatibility.
        /// @param calldata Call data to execute.
        /// @param eta Earliest execution time.
        /// @return result Raw call result.
        fn execute_transaction(
            ref self: ContractState, 
            target: ContractAddress, 
            selector: felt252,
            value: u256, 
            calldata: Span<felt252>, 
            eta: u64
        ) -> Span<felt252> {
            let tx_id = self._hash_transaction(target, selector, value, calldata, eta);
            let mut queued_tx = self.queued_txs.entry(tx_id).read();

            assert!(queued_tx.eta != 0, "Transaction not queued");
            assert!(get_block_timestamp() >= queued_tx.eta, "Transaction not ready");
            assert!(!queued_tx.executed, "Transaction already executed");
            assert!(!queued_tx.canceled, "Transaction was canceled");

            queued_tx.executed = true;
            self.queued_txs.entry(tx_id).write(queued_tx);

            // In Starknet, 'value' (ETH) is typically handled via a separate 
            // ERC20 transfer, but we proceed with the target call here.
            let result = call_contract_syscall(target, selector, calldata).unwrap();
            result
        }

        /// @notice Cancels a queued transaction.
        /// @dev Proposer-only to allow governance to abort actions.
        /// @param tx_id Transaction id to cancel.
        fn cancel_transaction(ref self: ContractState, tx_id: felt252) {
            self.assert_only_proposer();
            let mut queued_tx = self.queued_txs.entry(tx_id).read();
            
            assert!(queued_tx.eta != 0, "Transaction not queued");
            assert!(!queued_tx.executed, "Cannot cancel executed tx");
            
            queued_tx.canceled = true;
            self.queued_txs.entry(tx_id).write(queued_tx);
        }

        /// @notice Returns the minimum delay for queued transactions.
        /// @dev Read-only helper for UI and audits.
        /// @return delay Minimum delay in seconds.
        fn get_min_delay(self: @ContractState) -> u64 {
            self.min_delay.read()
        }

        /// @notice Returns stored data for a queued transaction.
        /// @dev Read-only helper for audits.
        /// @param tx_id Transaction id to fetch.
        /// @return tx Stored queued transaction.
        fn get_transaction(self: @ContractState, tx_id: felt252) -> QueuedTransaction {
            self.queued_txs.entry(tx_id).read()
        }
    }

    #[abi(embed_v0)]
    impl TimelockPrivacyImpl of super::ITimelockPrivacy<ContractState> {
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            let caller = get_caller_address();
            assert!(caller == self.admin.read(), "Caller is not admin");
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        fn submit_private_timelock_action(
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
                ACTION_TIMELOCK,
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
        /// @notice Ensures the caller has proposer permissions.
        /// @dev Allows admin or explicitly authorized proposers.
        fn assert_only_proposer(self: @ContractState) {
            let caller = get_caller_address();
            assert!(
                caller == self.admin.read() || self.proposers.entry(caller).read(), 
                "Caller is not a proposer"
            );
        }

        /// @notice Computes a unique hash for a queued transaction.
        /// @dev Uses poseidon to bind target, selector, value, calldata, and ETA.
        fn _hash_transaction(
            self: @ContractState, 
            target: ContractAddress, 
            selector: felt252,
            value: u256, 
            calldata: Span<felt252>, 
            eta: u64
        ) -> felt252 {
            let mut data = array![];
            target.serialize(ref data);
            selector.serialize(ref data);
            value.serialize(ref data);
            poseidon_hash_span(calldata).serialize(ref data);
            eta.serialize(ref data);
            poseidon_hash_span(data.span())
        }
    }
}
