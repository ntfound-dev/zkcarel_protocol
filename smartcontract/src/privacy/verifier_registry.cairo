use starknet::ContractAddress;

/// @title Verifier Registry Interface
/// @author CAREL Team
/// @notice Maps action types to verifier contracts.
#[starknet::interface]
pub trait IVerifierRegistry<TContractState> {
    /// @notice Returns the verifier for an action type.
    fn get_verifier(self: @TContractState, action_type: felt252) -> ContractAddress;
}

/// @title Verifier Registry Admin Interface
/// @author CAREL Team
/// @notice Owner-only updates to verifier mapping.
#[starknet::interface]
pub trait IVerifierRegistryAdmin<TContractState> {
    /// @notice Sets verifier for an action type.
    fn set_verifier(ref self: TContractState, action_type: felt252, verifier: ContractAddress);
}

/// @title Verifier Registry Contract
/// @author CAREL Team
/// @notice Stores verifier contracts for privacy actions.
#[starknet::contract]
pub mod VerifierRegistry {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub verifiers: Map<felt252, ContractAddress>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        VerifierUpdated: VerifierUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VerifierUpdated {
        pub action_type: felt252,
        pub verifier: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.ownable.initializer(owner);
    }

    #[abi(embed_v0)]
    impl VerifierRegistryImpl of super::IVerifierRegistry<ContractState> {
        fn get_verifier(self: @ContractState, action_type: felt252) -> ContractAddress {
            self.verifiers.entry(action_type).read()
        }
    }

    #[abi(embed_v0)]
    impl VerifierRegistryAdminImpl of super::IVerifierRegistryAdmin<ContractState> {
        fn set_verifier(ref self: ContractState, action_type: felt252, verifier: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!verifier.is_zero(), "Verifier required");
            self.verifiers.entry(action_type).write(verifier);
            self.emit(Event::VerifierUpdated(VerifierUpdated { action_type, verifier }));
        }
    }
}
