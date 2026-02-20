use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct DarkOrder {
    pub ciphertext: felt252,
    pub commitment: felt252,
    pub filled: bool,
}

// Dark-pool API for hidden order commitments.
// Uses ZK proofs and nullifiers to prevent replay/double-match.
#[starknet::interface]
pub trait IDarkPool<TContractState> {
    // Submits encrypted order intent and stores commitment under new order id.
    fn submit_order(
        ref self: TContractState,
        order: DarkOrder,
        proof: Span<felt252>,
        public_inputs: Span<felt252>
    ) -> u64;
    // Matches an order after proof verification and consumes provided nullifier.
    fn match_order(
        ref self: TContractState,
        order_id: u64,
        nullifier: felt252,
        proof: Span<felt252>,
        public_inputs: Span<felt252>
    );
    // Returns whether a dark-pool nullifier has already been consumed.
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
}

// Admin controls for verifier dependency updates.
#[starknet::interface]
pub trait IDarkPoolAdmin<TContractState> {
    // Updates verifier contract used by proof checks (admin only).
    fn set_verifier(ref self: TContractState, verifier: ContractAddress);
}

// Private orderbook implementation with external proof verifier.
// Stores commitments on-chain while order ciphertext remains opaque.
#[starknet::contract]
pub mod DarkPool {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use openzeppelin::access::ownable::OwnableComponent;
    use core::num::traits::Zero;
    use super::DarkOrder;
    use crate::privacy::zk_privacy_router::{IProofVerifierDispatcher, IProofVerifierDispatcherTrait};

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

    // Initializes owner authority and verifier dependency.
    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, verifier: ContractAddress) {
        self.ownable.initializer(admin);
        self.verifier.write(verifier);
    }

    #[abi(embed_v0)]
    impl DarkPoolImpl of super::IDarkPool<ContractState> {
        // Submits a dark order after proof verification.
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

        // Matches a dark order and consumes provided nullifier.
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

        // Returns whether a dark-pool nullifier has already been consumed.
        fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.nullifiers.entry(nullifier).read()
        }
    }

    #[abi(embed_v0)]
    impl AdminImpl of super::IDarkPoolAdmin<ContractState> {
        // Updates verifier contract used by proof checks (admin only).
        fn set_verifier(ref self: ContractState, verifier: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!verifier.is_zero(), "Verifier required");
            self.verifier.write(verifier);
            self.emit(Event::VerifierUpdated(VerifierUpdated { verifier }));
        }
    }
}
