// Defines simple registry entrypoints for protocol metadata.
// Example registry for storing user-linked data.
#[starknet::interface]
pub trait IRegistry<TContractState> {
    // Applies register data after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn register_data(ref self: TContractState, data: felt252);
    // Updates data configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn update_data(ref self: TContractState, index: u64, new_data: felt252);
    // Returns get data from state without mutating storage.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn get_data(self: @TContractState, index: u64) -> felt252;
    // Returns get all data from state without mutating storage.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn get_all_data(self: @TContractState) -> Array<felt252>;
    // Returns get user data from state without mutating storage.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn get_user_data(self: @TContractState, user: starknet::ContractAddress) -> felt252;
}

// ZK privacy entrypoints for registry actions.
#[starknet::interface]
pub trait IRegistryPrivacy<TContractState> {
    // Updates privacy router configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_privacy_router(ref self: TContractState, router: starknet::ContractAddress);
    // Applies submit private registry action after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn submit_private_registry_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

// Simple data registry for protocol metadata.
// Stores data in vector and per-user map for convenience.
#[starknet::contract]
pub mod Registry {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::get_caller_address;
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_REGISTRY;

    #[storage]
    pub struct Storage {
        // Uses Vec to store registered data entries.
        data_vector: Vec<felt252>,
        user_data_map: Map<ContractAddress, felt252>,
        foo: usize,
        privacy_router: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        DataRegistered: DataRegistered,
        DataUpdated: DataUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DataRegistered {
        pub user: ContractAddress,
        pub data: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DataUpdated {
        pub user: ContractAddress,
        pub index: u64,
        pub new_data: felt252,
    }

    // Initializes the registry.
    // Sets an initial value for internal storage.
    // `initial_data` seeds the `foo` storage field.
    #[constructor]
    // Initializes storage and role configuration during deployment.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn constructor(ref self: ContractState, initial_data: usize) {
        self.foo.write(initial_data);
    }

    #[abi(embed_v0)]
    pub impl RegistryImpl of super::IRegistry<ContractState> {
        // Applies register data after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn register_data(ref self: ContractState, data: felt252) {
            let caller = get_caller_address();
            
            // Uses `.push()` for vector append semantics.
            self.data_vector.push(data);
            
            self.user_data_map.entry(caller).write(data);
            self.emit(Event::DataRegistered(DataRegistered { user: caller, data }));
        }

        // Updates data configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn update_data(ref self: ContractState, index: u64, new_data: felt252) {
            let caller = get_caller_address();
            
            // Uses direct indexing to overwrite the selected entry.
            self.data_vector[index].write(new_data);
            
            self.user_data_map.entry(caller).write(new_data);
            self.emit(Event::DataUpdated(DataUpdated { user: caller, index, new_data }));
        }

        // Returns get data from state without mutating storage.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn get_data(self: @ContractState, index: u64) -> felt252 {
            // Uses `.at()` to read value at the selected index.
            self.data_vector.at(index).read()
        }

        // Returns get all data from state without mutating storage.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn get_all_data(self: @ContractState) -> Array<felt252> {
            let mut all_data = array![];
            for i in 0..self.data_vector.len() {
                all_data.append(self.data_vector.at(i).read());
            };
            all_data
        }

        // Returns get user data from state without mutating storage.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn get_user_data(self: @ContractState, user: ContractAddress) -> felt252 {
            self.user_data_map.entry(user).read()
        }
    }

    #[abi(embed_v0)]
    impl RegistryPrivacyImpl of super::IRegistryPrivacy<ContractState> {
        // Updates privacy router configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(!router.is_zero(), "Privacy router required");
            let current = self.privacy_router.read();
            assert!(current.is_zero(), "Privacy router already set");
            self.privacy_router.write(router);
        }

        // Applies submit private registry action after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn submit_private_registry_action(
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
                ACTION_REGISTRY,
                old_root,
                new_root,
                nullifiers,
                commitments,
                public_inputs,
                proof
            );
        }
    }
}
