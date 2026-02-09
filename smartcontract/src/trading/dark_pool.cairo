use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct DarkOrder {
    pub ciphertext: felt252,
    pub commitment: felt252,
    pub filled: bool,
}

/// @title Dark Pool Interface
/// @author CAREL Team
/// @notice Private orderbook for hidden trade intent.
/// @dev Uses ZK proofs and nullifiers.
#[starknet::interface]
pub trait IDarkPool<TContractState> {
    /// @notice Submits a hidden order commitment.
    /// @param order Encrypted order commitment.
    /// @param proof ZK proof.
    /// @param public_inputs Public inputs.
    /// @return order_id New order id.
    fn submit_order(
        ref self: TContractState,
        order: DarkOrder,
        proof: Span<felt252>,
        public_inputs: Span<felt252>
    ) -> u64;
    /// @notice Matches an order using proof.
    /// @param order_id Order id.
    /// @param nullifier Nullifier to prevent replay.
    /// @param proof ZK proof.
    /// @param public_inputs Public inputs.
    fn match_order(
        ref self: TContractState,
        order_id: u64,
        nullifier: felt252,
        proof: Span<felt252>,
        public_inputs: Span<felt252>
    );
    /// @notice Checks if a nullifier has been used.
    /// @param nullifier Nullifier to check.
    /// @return used True if used.
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
}

/// @title Dark Pool Admin Interface
/// @author CAREL Team
/// @notice Admin controls for verifier configuration.
#[starknet::interface]
pub trait IDarkPoolAdmin<TContractState> {
    /// @notice Updates verifier address.
    /// @dev Owner-only.
    /// @param verifier New verifier address.
    fn set_verifier(ref self: TContractState, verifier: ContractAddress);
}

/// @title Dark Pool Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy hooks for dark pool actions.
#[starknet::interface]
pub trait IDarkPoolPrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private dark pool action proof.
    fn submit_private_dark_pool_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @title Dark Pool Contract
/// @author CAREL Team
/// @notice Private orderbook with ZK verification.
/// @dev Uses external verifier.
#[starknet::contract]
pub mod DarkPool {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use openzeppelin::access::ownable::OwnableComponent;
    use core::num::traits::Zero;
    use super::DarkOrder;
    use crate::privacy::zk_privacy_router::{IProofVerifierDispatcher, IProofVerifierDispatcherTrait};
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_DARK_POOL;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub verifier: ContractAddress,
        pub orders: Map<u64, DarkOrder>,
        pub nullifiers: Map<felt252, bool>,
        pub order_count: u64,
        pub privacy_router: ContractAddress,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        OrderSubmitted: OrderSubmitted,
        OrderMatched: OrderMatched,
        VerifierUpdated: VerifierUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OrderSubmitted {
        pub order_id: u64,
        pub commitment: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OrderMatched {
        pub order_id: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VerifierUpdated {
        pub verifier: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, verifier: ContractAddress) {
        self.ownable.initializer(admin);
        self.verifier.write(verifier);
    }

    #[abi(embed_v0)]
    impl DarkPoolImpl of super::IDarkPool<ContractState> {
        fn submit_order(
            ref self: ContractState,
            order: DarkOrder,
            proof: Span<felt252>,
            public_inputs: Span<felt252>
        ) -> u64 {
            let verifier = IProofVerifierDispatcher { contract_address: self.verifier.read() };
            assert!(verifier.verify_proof(proof, public_inputs), "Invalid proof");

            let id = self.order_count.read() + 1;
            self.order_count.write(id);
            let commitment = order.commitment;
            self.orders.entry(id).write(order);
            self.emit(Event::OrderSubmitted(OrderSubmitted { order_id: id, commitment }));
            id
        }

        fn match_order(
            ref self: ContractState,
            order_id: u64,
            nullifier: felt252,
            proof: Span<felt252>,
            public_inputs: Span<felt252>
        ) {
            assert!(!self.nullifiers.entry(nullifier).read(), "Nullifier already used");
            let verifier = IProofVerifierDispatcher { contract_address: self.verifier.read() };
            assert!(verifier.verify_proof(proof, public_inputs), "Invalid proof");

            let mut order = self.orders.entry(order_id).read();
            assert!(!order.filled, "Order already filled");
            order.filled = true;
            self.orders.entry(order_id).write(order);
            self.nullifiers.entry(nullifier).write(true);
            self.emit(Event::OrderMatched(OrderMatched { order_id }));
        }

        fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.nullifiers.entry(nullifier).read()
        }
    }

    #[abi(embed_v0)]
    impl DarkPoolPrivacyImpl of super::IDarkPoolPrivacy<ContractState> {
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        fn submit_private_dark_pool_action(
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
                ACTION_DARK_POOL,
                old_root,
                new_root,
                nullifiers,
                commitments,
                public_inputs,
                proof
            );
        }
    }

    #[abi(embed_v0)]
    impl AdminImpl of super::IDarkPoolAdmin<ContractState> {
        fn set_verifier(ref self: ContractState, verifier: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!verifier.is_zero(), "Verifier required");
            self.verifier.write(verifier);
            self.emit(Event::VerifierUpdated(VerifierUpdated { verifier }));
        }
    }
}
