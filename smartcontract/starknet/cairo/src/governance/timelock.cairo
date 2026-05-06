use starknet::ContractAddress;

/// @notice A time-locked transaction queued for execution.
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

/// @title ITimelock
/// @notice Queued execution flow for governance actions with minimum delay enforcement.
#[starknet::interface]
pub trait ITimelock<TContractState> {
    /// @notice Queues a transaction for time-delayed execution.
    /// @dev Callable only by addresses with proposer role or the owner.
    ///      `eta` must be >= `block_timestamp + min_delay`.
    /// @param target Contract to call.
    /// @param selector Function selector to invoke on `target`.
    /// @param value ETH-equivalent value (handled off-chain on Starknet).
    /// @param calldata Calldata to pass to `target`.
    /// @param eta Earliest timestamp at which the transaction may execute.
    /// @return The unique transaction ID (Poseidon hash of the parameters).
    fn queue_transaction(
        ref self: TContractState,
        target: ContractAddress,
        selector: felt252,
        value: u256,
        calldata: Span<felt252>,
        eta: u64
    ) -> felt252;

    /// @notice Executes a queued transaction after its ETA has passed.
    /// @dev Callable only by addresses with proposer role or the owner.
    /// @param target Must match the queued transaction.
    /// @param selector Must match the queued transaction.
    /// @param value Must match the queued transaction.
    /// @param calldata Must match the queued transaction.
    /// @param eta Must match the queued transaction.
    /// @return The raw return data from the target call.
    fn execute_transaction(
        ref self: TContractState,
        target: ContractAddress,
        selector: felt252,
        value: u256,
        calldata: Span<felt252>,
        eta: u64
    ) -> Span<felt252>;

    /// @notice Cancels a queued transaction before it is executed.
    /// @dev Callable only by addresses with proposer role or the owner.
    /// @param tx_id The transaction ID to cancel.
    fn cancel_transaction(ref self: TContractState, tx_id: felt252);

    /// @notice Returns the minimum enforced delay in seconds.
    /// @return Minimum delay in seconds.
    fn get_min_delay(self: @TContractState) -> u64;

    /// @notice Returns the stored data for a queued transaction.
    /// @param tx_id The transaction ID to query.
    /// @return The `QueuedTransaction` struct.
    fn get_transaction(self: @TContractState, tx_id: felt252) -> QueuedTransaction;
}

/// @title ITimelockAdmin
/// @notice Owner-only administration for proposer management and delay configuration.
#[starknet::interface]
pub trait ITimelockAdmin<TContractState> {
    /// @notice Grants proposer role to an address.
    /// @dev Callable only by the contract owner. Emits `ProposerAdded`.
    /// @param proposer Address to grant proposer role.
    fn add_proposer(ref self: TContractState, proposer: ContractAddress);

    /// @notice Revokes proposer role from an address.
    /// @dev Callable only by the contract owner. Emits `ProposerRemoved`.
    /// @param proposer Address to revoke proposer role.
    fn remove_proposer(ref self: TContractState, proposer: ContractAddress);

    /// @notice Updates the minimum delay required before execution.
    /// @dev Must be >= `MIN_DELAY_SECONDS`. Emits `MinDelayUpdated`.
    /// @param min_delay New minimum delay in seconds.
    fn set_min_delay(ref self: TContractState, min_delay: u64);
}

/// @title ITimelockPrivacy
/// @notice ZK privacy hooks for timelock actions.
#[starknet::interface]
pub trait ITimelockPrivacy<TContractState> {
    /// @notice Sets the privacy router address.
    /// @dev Callable only by the contract owner. Emits `PrivacyRouterUpdated`.
    /// @param router New privacy router address (must be non-zero).
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);

    /// @notice Submits a ZK-proven timelock action to the privacy router.
    /// @dev Nullifiers are replay-protected: each nullifier may only be consumed once.
    /// @param old_root Previous Merkle tree root.
    /// @param new_root Updated Merkle tree root after commitments.
    /// @param nullifiers Nullifiers for inputs being spent.
    /// @param commitments New Merkle commitments.
    /// @param public_inputs ZK circuit public inputs.
    /// @param proof Serialized ZK proof.
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

/// @title Timelock
/// @notice Enforces time-delayed execution for governance actions.
///         Uses Poseidon hash to uniquely identify queued transactions.
#[starknet::contract]
pub mod Timelock {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_caller_address, get_block_timestamp, SyscallResultTrait};
    use starknet::syscalls::call_contract_syscall;
    use core::poseidon::poseidon_hash_span;
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use super::QueuedTransaction;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_TIMELOCK;

    /// @dev Absolute floor for min_delay: 2 days in seconds.
    const MIN_DELAY_SECONDS: u64 = 172800;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub min_delay: u64,
        pub queued_txs: Map<felt252, QueuedTransaction>,
        pub proposers: Map<ContractAddress, bool>,
        pub privacy_router: ContractAddress,
        pub used_nullifiers: Map<felt252, bool>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        TransactionQueued: TransactionQueued,
        TransactionExecuted: TransactionExecuted,
        TransactionCanceled: TransactionCanceled,
        ProposerAdded: ProposerAdded,
        ProposerRemoved: ProposerRemoved,
        MinDelayUpdated: MinDelayUpdated,
        PrivacyRouterUpdated: PrivacyRouterUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    /// @notice Emitted when a transaction is queued.
    #[derive(Drop, starknet::Event)]
    pub struct TransactionQueued {
        pub tx_id: felt252,
        pub target: ContractAddress,
        pub selector: felt252,
        pub eta: u64,
    }

    /// @notice Emitted when a queued transaction is executed.
    #[derive(Drop, starknet::Event)]
    pub struct TransactionExecuted {
        pub tx_id: felt252,
        pub target: ContractAddress,
        pub selector: felt252,
    }

    /// @notice Emitted when a queued transaction is canceled.
    #[derive(Drop, starknet::Event)]
    pub struct TransactionCanceled {
        pub tx_id: felt252,
    }

    /// @notice Emitted when an address is granted proposer role.
    #[derive(Drop, starknet::Event)]
    pub struct ProposerAdded {
        pub proposer: ContractAddress,
    }

    /// @notice Emitted when an address has proposer role revoked.
    #[derive(Drop, starknet::Event)]
    pub struct ProposerRemoved {
        pub proposer: ContractAddress,
    }

    /// @notice Emitted when the minimum delay is updated.
    #[derive(Drop, starknet::Event)]
    pub struct MinDelayUpdated {
        pub min_delay: u64,
    }

    /// @notice Emitted when the privacy router address is updated.
    #[derive(Drop, starknet::Event)]
    pub struct PrivacyRouterUpdated {
        pub router: ContractAddress,
    }

    /// @notice Initializes the timelock with admin and minimum delay.
    /// @param admin Initial owner address (granted ownership via OwnableComponent).
    /// @param min_delay Initial minimum delay in seconds (must be >= `MIN_DELAY_SECONDS`).
    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, min_delay: u64) {
        assert!(min_delay >= MIN_DELAY_SECONDS, "Min delay too short");
        self.ownable.initializer(admin);
        self.min_delay.write(min_delay);
    }

    #[abi(embed_v0)]
    pub impl TimelockImpl of super::ITimelock<ContractState> {
        /// @inheritdoc ITimelock
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
            self.emit(Event::TransactionQueued(TransactionQueued { tx_id, target, selector, eta }));
            tx_id
        }

        /// @inheritdoc ITimelock
        fn execute_transaction(
            ref self: ContractState,
            target: ContractAddress,
            selector: felt252,
            value: u256,
            calldata: Span<felt252>,
            eta: u64
        ) -> Span<felt252> {
            self.assert_only_proposer();
            let tx_id = self._hash_transaction(target, selector, value, calldata, eta);
            let mut queued_tx = self.queued_txs.entry(tx_id).read();

            assert!(queued_tx.eta != 0, "Transaction not queued");
            assert!(get_block_timestamp() >= queued_tx.eta, "Transaction not ready");
            assert!(!queued_tx.executed, "Transaction already executed");
            assert!(!queued_tx.canceled, "Transaction was canceled");

            queued_tx.executed = true;
            self.queued_txs.entry(tx_id).write(queued_tx);

            let result = call_contract_syscall(target, selector, calldata).unwrap_syscall();
            self.emit(Event::TransactionExecuted(TransactionExecuted { tx_id, target, selector }));
            result
        }

        /// @inheritdoc ITimelock
        fn cancel_transaction(ref self: ContractState, tx_id: felt252) {
            self.assert_only_proposer();
            let mut queued_tx = self.queued_txs.entry(tx_id).read();
            assert!(queued_tx.eta != 0, "Transaction not queued");
            assert!(!queued_tx.executed, "Cannot cancel executed tx");
            queued_tx.canceled = true;
            self.queued_txs.entry(tx_id).write(queued_tx);
            self.emit(Event::TransactionCanceled(TransactionCanceled { tx_id }));
        }

        /// @inheritdoc ITimelock
        fn get_min_delay(self: @ContractState) -> u64 {
            self.min_delay.read()
        }

        /// @inheritdoc ITimelock
        fn get_transaction(self: @ContractState, tx_id: felt252) -> QueuedTransaction {
            self.queued_txs.entry(tx_id).read()
        }
    }

    #[abi(embed_v0)]
    impl TimelockAdminImpl of super::ITimelockAdmin<ContractState> {
        /// @inheritdoc ITimelockAdmin
        fn add_proposer(ref self: ContractState, proposer: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!proposer.is_zero(), "Proposer required");
            self.proposers.entry(proposer).write(true);
            self.emit(Event::ProposerAdded(ProposerAdded { proposer }));
        }

        /// @inheritdoc ITimelockAdmin
        fn remove_proposer(ref self: ContractState, proposer: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!proposer.is_zero(), "Proposer required");
            self.proposers.entry(proposer).write(false);
            self.emit(Event::ProposerRemoved(ProposerRemoved { proposer }));
        }

        /// @inheritdoc ITimelockAdmin
        fn set_min_delay(ref self: ContractState, min_delay: u64) {
            self.ownable.assert_only_owner();
            assert!(min_delay >= MIN_DELAY_SECONDS, "Min delay too short");
            self.min_delay.write(min_delay);
            self.emit(Event::MinDelayUpdated(MinDelayUpdated { min_delay }));
        }
    }

    #[abi(embed_v0)]
    impl TimelockPrivacyImpl of super::ITimelockPrivacy<ContractState> {
        /// @inheritdoc ITimelockPrivacy
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
            self.emit(Event::PrivacyRouterUpdated(PrivacyRouterUpdated { router }));
        }

        /// @inheritdoc ITimelockPrivacy
        fn submit_private_timelock_action(
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
        /// @dev Reverts if the caller is neither the owner nor an allowlisted proposer.
        fn assert_only_proposer(self: @ContractState) {
            let caller = get_caller_address();
            assert!(
                caller == self.ownable.owner() || self.proposers.entry(caller).read(),
                "Caller is not a proposer"
            );
        }

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
