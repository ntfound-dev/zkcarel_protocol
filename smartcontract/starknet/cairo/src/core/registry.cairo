/// @notice Defines simple registry entrypoints for protocol metadata.
/// @dev Example registry for storing user-linked data and protocol addresses.
#[starknet::interface]
pub trait IRegistry<TContractState> {
    /// @notice Registers a new data entry for the caller.
    /// @param data The felt252 value to store.
    fn register_data(ref self: TContractState, data: felt252);

    /// @notice Updates an existing data entry at `index`.
    /// @dev Caller must be the entry owner or the contract owner.
    /// @param index Index of the entry to update.
    /// @param new_data New felt252 value to write.
    fn update_data(ref self: TContractState, index: u64, new_data: felt252);

    /// @notice Returns the data entry stored at `index`.
    /// @param index Index to look up.
    /// @return The felt252 value stored at that index.
    fn get_data(self: @TContractState, index: u64) -> felt252;

    /// @notice Returns all registered data entries as an array.
    /// @return Array of all stored felt252 values.
    fn get_all_data(self: @TContractState) -> Array<felt252>;

    /// @notice Returns the most recently registered data for `user`.
    /// @param user Address whose data is queried.
    /// @return The felt252 value associated with `user`.
    fn get_user_data(self: @TContractState, user: starknet::ContractAddress) -> felt252;

    /// @notice Stores a protocol contract address under a symbolic `key`.
    /// @dev Only callable by owner. Address must be non-zero.
    /// @param key Symbolic key (e.g. selector!("ROUTER")).
    /// @param address Contract address to associate with `key`.
    fn set_address(ref self: TContractState, key: felt252, address: starknet::ContractAddress);

    /// @notice Returns the protocol address stored under `key`.
    /// @param key Symbolic key to look up.
    /// @return Stored contract address (zero if not set).
    fn get_address(self: @TContractState, key: felt252) -> starknet::ContractAddress;
}

/// @notice ZK privacy entrypoints for registry actions.
#[starknet::interface]
pub trait IRegistryPrivacy<TContractState> {
    /// @notice Sets the privacy router contract address.
    /// @dev Only callable by owner. Router must be non-zero. Replaces any existing router.
    /// @param router Address of the deployed privacy router.
    fn set_privacy_router(ref self: TContractState, router: starknet::ContractAddress);

    /// @notice Submits a ZK-proven private registry action to the privacy router.
    /// @param old_root Merkle root before this action.
    /// @param new_root Merkle root after this action.
    /// @param nullifiers Span of nullifiers preventing double-spend.
    /// @param commitments Span of new Pedersen commitments.
    /// @param public_inputs Public inputs consumed by the ZK verifier.
    /// @param proof Serialised ZK proof bytes.
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

/// @notice Simple data registry for protocol metadata.
/// @dev Stores data in a vector and per-user map for convenience.
#[starknet::contract]
pub mod Registry {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::get_caller_address;
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_REGISTRY;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        data_vector: Vec<felt252>,
        user_data_map: Map<ContractAddress, felt252>,
        data_owner: Map<u64, ContractAddress>,
        address_book: Map<felt252, ContractAddress>,
        foo: usize,
        privacy_router: ContractAddress,
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        DataRegistered: DataRegistered,
        DataUpdated: DataUpdated,
        AddressUpdated: AddressUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
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

    #[derive(Drop, starknet::Event)]
    pub struct AddressUpdated {
        pub key: felt252,
        pub address: ContractAddress,
    }

    /// @notice Initializes the registry.
    /// @dev The deployer becomes owner via `get_caller_address()`.
    /// @param initial_data Seeds the internal `foo` storage field.
    #[constructor]
    fn constructor(ref self: ContractState, initial_data: usize) {
        self.ownable.initializer(get_caller_address());
        self.foo.write(initial_data);
    }

    #[abi(embed_v0)]
    pub impl RegistryImpl of super::IRegistry<ContractState> {
        /// @notice Registers a new data entry for the caller.
        /// @param data The felt252 value to store.
        fn register_data(ref self: ContractState, data: felt252) {
            let caller = get_caller_address();
            let index = self.data_vector.len();
            self.data_vector.push(data);
            self.data_owner.entry(index).write(caller);
            self.user_data_map.entry(caller).write(data);
            self.emit(Event::DataRegistered(DataRegistered { user: caller, data }));
        }

        /// @notice Updates an existing data entry at `index`.
        /// @dev Caller must be the entry owner or the contract owner.
        /// @param index Index of the entry to update.
        /// @param new_data New felt252 value to write.
        fn update_data(ref self: ContractState, index: u64, new_data: felt252) {
            let caller = get_caller_address();
            let entry_owner = self.data_owner.entry(index).read();
            let contract_owner = self.ownable.owner();
            assert!(
                entry_owner == caller || caller == contract_owner,
                "Not authorized to update"
            );
            self.data_vector[index].write(new_data);
            self.user_data_map.entry(caller).write(new_data);
            self.emit(Event::DataUpdated(DataUpdated { user: caller, index, new_data }));
        }

        /// @notice Returns the data entry stored at `index`.
        /// @param index Index to look up.
        /// @return The felt252 value stored at that index.
        fn get_data(self: @ContractState, index: u64) -> felt252 {
            self.data_vector.at(index).read()
        }

        /// @notice Returns all registered data entries as an array.
        /// @return Array of all stored felt252 values.
        fn get_all_data(self: @ContractState) -> Array<felt252> {
            let mut all_data = array![];
            for i in 0..self.data_vector.len() {
                all_data.append(self.data_vector.at(i).read());
            };
            all_data
        }

        /// @notice Returns the most recently registered data for `user`.
        /// @param user Address whose data is queried.
        /// @return The felt252 value associated with `user`.
        fn get_user_data(self: @ContractState, user: ContractAddress) -> felt252 {
            self.user_data_map.entry(user).read()
        }

        /// @notice Stores a protocol contract address under a symbolic `key`.
        /// @dev Only callable by owner. Address must be non-zero.
        /// @param key Symbolic key to associate.
        /// @param address Contract address to store.
        fn set_address(ref self: ContractState, key: felt252, address: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!address.is_zero(), "Address required");
            self.address_book.entry(key).write(address);
            self.emit(Event::AddressUpdated(AddressUpdated { key, address }));
        }

        /// @notice Returns the protocol address stored under `key`.
        /// @param key Symbolic key to look up.
        /// @return Stored contract address (zero if not set).
        fn get_address(self: @ContractState, key: felt252) -> ContractAddress {
            self.address_book.entry(key).read()
        }
    }

    #[abi(embed_v0)]
    impl RegistryPrivacyImpl of super::IRegistryPrivacy<ContractState> {
        /// @notice Sets the privacy router contract address.
        /// @dev Only callable by owner. Replaces any existing router.
        /// @param router Address of the deployed privacy router (must be non-zero).
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        /// @notice Submits a ZK-proven private registry action to the privacy router.
        /// @param old_root Merkle root before this action.
        /// @param new_root Merkle root after this action.
        /// @param nullifiers Span of nullifiers preventing double-spend.
        /// @param commitments Span of new Pedersen commitments.
        /// @param public_inputs Public inputs consumed by the ZK verifier.
        /// @param proof Serialised ZK proof bytes.
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
