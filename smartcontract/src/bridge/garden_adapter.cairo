// Adapter for Garden BTC bridge provider.
// Placeholder for provider integration hooks.
#[starknet::contract]
pub mod GardenAdapter {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use openzeppelin::access::ownable::OwnableComponent;
    use core::num::traits::Zero;
    use super::super::provider_adapter::{IBridgeProviderAdapter, IBridgeAdapterAdmin, IBridgeAdapterPrivacy};
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_BRIDGE;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub endpoint: ByteArray,
        pub active: bool,
        pub privacy_router: ContractAddress,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        BridgeRequested: BridgeRequested,
        EndpointUpdated: EndpointUpdated,
        ActiveUpdated: ActiveUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BridgeRequested {
        pub user: ContractAddress,
        pub amount: u256,
        pub provider_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EndpointUpdated {
        pub endpoint: ByteArray,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ActiveUpdated {
        pub active: bool,
    }

    #[constructor]
    // Initializes storage and role configuration during deployment.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn constructor(ref self: ContractState, admin: ContractAddress, endpoint: ByteArray) {
        self.ownable.initializer(admin);
        self.endpoint.write(endpoint);
        self.active.write(true);
    }

    #[abi(embed_v0)]
    impl AdapterImpl of IBridgeProviderAdapter<ContractState> {
        // Applies execute bridge after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn execute_bridge(ref self: ContractState, user: ContractAddress, amount: u256, provider_id: felt252) -> bool {
            assert!(self.active.read(), "Adapter inactive");
            self.emit(Event::BridgeRequested(BridgeRequested { user, amount, provider_id }));
            true
        }
    }

    #[abi(embed_v0)]
    impl AdminImpl of IBridgeAdapterAdmin<ContractState> {
        // Updates endpoint configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_endpoint(ref self: ContractState, endpoint: ByteArray) {
            self.ownable.assert_only_owner();
            self.endpoint.write(endpoint.clone());
            self.emit(Event::EndpointUpdated(EndpointUpdated { endpoint }));
        }

        // Updates active configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_active(ref self: ContractState, active: bool) {
            self.ownable.assert_only_owner();
            self.active.write(active);
            self.emit(Event::ActiveUpdated(ActiveUpdated { active }));
        }
    }

    #[abi(embed_v0)]
    impl AdapterPrivacyImpl of IBridgeAdapterPrivacy<ContractState> {
        // Updates privacy router configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Applies submit private bridge action after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn submit_private_bridge_action(
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
                ACTION_BRIDGE,
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
