use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct PaymentCommitment {
    pub ciphertext: felt252,
    pub commitment: felt252,
    pub amount_commitment: felt252,
    pub finalized: bool,
}

// Confidential payment flow with ZK proofs.
// Integrates external proof verifier.
#[starknet::interface]
pub trait IPrivatePayments<TContractState> {
    // Registers a private payment commitment for deferred settlement and proof-based finalization.
    fn submit_private_payment(
        ref self: TContractState,
        payment: PaymentCommitment,
        proof: Span<felt252>,
        public_inputs: Span<felt252>
    ) -> u64;
    // Finalizes a private payment by verifying proof inputs and consuming the settlement nullifier.
    fn finalize_private_payment(
        ref self: TContractState,
        payment_id: u64,
        recipient: ContractAddress,
        nullifier: felt252,
        proof: Span<felt252>,
        public_inputs: Span<felt252>
    );
    // Read-only check for whether a nullifier has been consumed (double-spend protection).
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
}

// Admin controls for verifier configuration.
#[starknet::interface]
pub trait IPrivatePaymentsAdmin<TContractState> {
    // Owner/admin-only setter for rotating the verifier contract used by privacy flows.
    fn set_verifier(ref self: TContractState, verifier: ContractAddress);
}

// Confidential payments via encrypted commitments.
// Uses verifier and nullifiers for safety.
#[starknet::contract]
pub mod PrivatePayments {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use openzeppelin::access::ownable::OwnableComponent;
    use core::num::traits::Zero;
    use super::PaymentCommitment;
    use super::super::zk_privacy_router::{IProofVerifierDispatcher, IProofVerifierDispatcherTrait};

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub verifier: ContractAddress,
        pub payments: Map<u64, PaymentCommitment>,
        pub nullifiers: Map<felt252, bool>,
        pub payment_count: u64,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PaymentSubmitted: PaymentSubmitted,
        PaymentFinalized: PaymentFinalized,
        VerifierUpdated: VerifierUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PaymentSubmitted {
        pub payment_id: u64,
        pub commitment: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PaymentFinalized {
        pub payment_id: u64,
        pub recipient: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VerifierUpdated {
        pub verifier: ContractAddress,
    }

    #[constructor]
    // Initializes owner/admin roles plus verifier/router dependencies required by privacy flows.
    fn constructor(ref self: ContractState, admin: ContractAddress, verifier: ContractAddress) {
        self.ownable.initializer(admin);
        self.verifier.write(verifier);
    }

    #[abi(embed_v0)]
    impl PrivatePaymentsImpl of super::IPrivatePayments<ContractState> {
        // Registers a private payment commitment for deferred settlement and proof-based finalization.
            fn submit_private_payment(
            ref self: ContractState,
            payment: PaymentCommitment,
            proof: Span<felt252>,
            public_inputs: Span<felt252>
        ) -> u64 {
            let verifier = IProofVerifierDispatcher { contract_address: self.verifier.read() };
            assert!(verifier.verify_proof(proof, public_inputs), "Invalid proof");

            let id = self.payment_count.read() + 1;
            self.payment_count.write(id);
            let commitment = payment.commitment;
            self.payments.entry(id).write(payment);
            self.emit(Event::PaymentSubmitted(PaymentSubmitted { payment_id: id, commitment }));
            id
        }

        // Finalizes a private payment by verifying proof inputs and consuming the settlement nullifier.
            fn finalize_private_payment(
            ref self: ContractState,
            payment_id: u64,
            recipient: ContractAddress,
            nullifier: felt252,
            proof: Span<felt252>,
            public_inputs: Span<felt252>
        ) {
            assert!(!self.nullifiers.entry(nullifier).read(), "Nullifier already used");
            let verifier = IProofVerifierDispatcher { contract_address: self.verifier.read() };
            assert!(verifier.verify_proof(proof, public_inputs), "Invalid proof");

            let mut payment = self.payments.entry(payment_id).read();
            assert!(!payment.finalized, "Payment already finalized");
            payment.finalized = true;
            self.payments.entry(payment_id).write(payment);
            self.nullifiers.entry(nullifier).write(true);
            self.emit(Event::PaymentFinalized(PaymentFinalized { payment_id, recipient }));
        }

        // Read-only check for whether a nullifier has been consumed (double-spend protection).
            fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.nullifiers.entry(nullifier).read()
        }
    }

    #[abi(embed_v0)]
    impl AdminImpl of super::IPrivatePaymentsAdmin<ContractState> {
        // Owner/admin-only setter for rotating the verifier contract used by privacy flows.
            fn set_verifier(ref self: ContractState, verifier: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!verifier.is_zero(), "Verifier required");
            self.verifier.write(verifier);
            self.emit(Event::VerifierUpdated(VerifierUpdated { verifier }));
        }
    }
}
