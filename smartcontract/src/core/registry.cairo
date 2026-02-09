/// @title Registry Interface
/// @author CAREL Team
/// @notice Defines simple registry entrypoints for protocol metadata.
/// @dev Example registry for storing user-linked data.
#[starknet::interface]
pub trait IRegistry<TContractState> {
    /// @notice Registers data for the caller.
    /// @dev Stores data in both vector and user map.
    /// @param data Data value to register.
    fn register_data(ref self: TContractState, data: felt252);
    /// @notice Updates data at a specific index.
    /// @dev Keeps user mapping aligned with updated data.
    /// @param index Index to update.
    /// @param new_data New data value.
    fn update_data(ref self: TContractState, index: u64, new_data: felt252);
    /// @notice Returns data at a specific index.
    /// @dev Read-only helper for consumers.
    /// @param index Index to fetch.
    /// @return data Stored data value.
    fn get_data(self: @TContractState, index: u64) -> felt252;
    /// @notice Returns all stored data.
    /// @dev Read-only helper for analytics.
    /// @return data Array of stored values.
    fn get_all_data(self: @TContractState) -> Array<felt252>;
    /// @notice Returns data associated with a user.
    /// @dev Read-only helper for per-user queries.
    /// @param user User address.
    /// @return data Stored data value.
    fn get_user_data(self: @TContractState, user: starknet::ContractAddress) -> felt252;
}

/// @title Registry Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy entrypoints for registry actions.
#[starknet::interface]
pub trait IRegistryPrivacy<TContractState> {
    /// @notice Sets privacy router address (one-time init).
    fn set_privacy_router(ref self: TContractState, router: starknet::ContractAddress);
    /// @notice Submits a private registry action proof.
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

/// @title Registry Contract
/// @author CAREL Team
/// @notice Simple data registry for protocol metadata.
/// @dev Stores data in vector and per-user map for convenience.
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
        // Menggunakan Vec untuk koleksi data di storage
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

    /// @notice Initializes the registry.
    /// @dev Sets an initial value for internal storage.
    /// @param initial_data Initial value for the `foo` field.
    #[constructor]
    fn constructor(ref self: ContractState, initial_data: usize) {
        self.foo.write(initial_data);
    }

    #[abi(embed_v0)]
    pub impl RegistryImpl of super::IRegistry<ContractState> {
        /// @notice Registers data for the caller.
        /// @dev Stores data in both vector and user map.
        /// @param data Data value to register.
        fn register_data(ref self: ContractState, data: felt252) {
            let caller = get_caller_address();
            
            // Menggunakan .push() sesuai rekomendasi compiler terbaru
            self.data_vector.push(data);
            
            self.user_data_map.entry(caller).write(data);
            self.emit(Event::DataRegistered(DataRegistered { user: caller, data }));
        }

        /// @notice Updates data at a specific index.
        /// @dev Keeps user mapping aligned with updated data.
        /// @param index Index to update.
        /// @param new_data New data value.
        fn update_data(ref self: ContractState, index: u64, new_data: felt252) {
            let caller = get_caller_address();
            
            // Menggunakan indexing langsung untuk menulis ulang data
            self.data_vector[index].write(new_data);
            
            self.user_data_map.entry(caller).write(new_data);
            self.emit(Event::DataUpdated(DataUpdated { user: caller, index, new_data }));
        }

        /// @notice Returns data at a specific index.
        /// @dev Read-only helper for consumers.
        /// @param index Index to fetch.
        /// @return data Stored data value.
        fn get_data(self: @ContractState, index: u64) -> felt252 {
            // Menggunakan .at() untuk membaca data di index tertentu
            self.data_vector.at(index).read()
        }

        /// @notice Returns all stored data.
        /// @dev Read-only helper for analytics.
        /// @return data Array of stored values.
        fn get_all_data(self: @ContractState) -> Array<felt252> {
            let mut all_data = array![];
            for i in 0..self.data_vector.len() {
                all_data.append(self.data_vector.at(i).read());
            };
            all_data
        }

        /// @notice Returns data associated with a user.
        /// @dev Read-only helper for per-user queries.
        /// @param user User address.
        /// @return data Stored data value.
        fn get_user_data(self: @ContractState, user: ContractAddress) -> felt252 {
            self.user_data_map.entry(user).read()
        }
    }

    #[abi(embed_v0)]
    impl RegistryPrivacyImpl of super::IRegistryPrivacy<ContractState> {
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(!router.is_zero(), "Privacy router required");
            let current = self.privacy_router.read();
            assert!(current.is_zero(), "Privacy router already set");
            self.privacy_router.write(router);
        }

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
