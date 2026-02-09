use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct PaymentCommitment {
    pub ciphertext: felt252,
    pub commitment: felt252,
    pub amount_commitment: felt252,
    pub finalized: bool,
}

/// @title Private Payments Interface
/// @author CAREL Team
/// @notice Confidential payment flow with ZK proofs.
/// @dev Integrates external proof verifier.
#[starknet::interface]
pub trait IPrivatePayments<TContractState> {
    /// @notice Submits a private payment commitment.
    /// @dev Verifies proof before accepting.
    /// @param payment Encrypted payment commitment.
    /// @param proof ZK proof.
    /// @param public_inputs Public inputs.
    /// @return payment_id Newly created payment id.
    fn submit_private_payment(
        ref self: TContractState,
        payment: PaymentCommitment,
        proof: Span<felt252>,
        public_inputs: Span<felt252>
    ) -> u64;
    /// @notice Finalizes a private payment.
    /// @dev Uses nullifier to prevent reuse.
    /// @param payment_id Payment id.
    /// @param recipient Recipient address.
    /// @param nullifier Nullifier value.
    /// @param proof ZK proof.
    /// @param public_inputs Public inputs.
    fn finalize_private_payment(
        ref self: TContractState,
        payment_id: u64,
        recipient: ContractAddress,
        nullifier: felt252,
        proof: Span<felt252>,
        public_inputs: Span<felt252>
    );
    /// @notice Checks if a nullifier has been used.
    /// @param nullifier Nullifier to check.
    /// @return used True if used.
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
}

/// @title Private Payments Admin Interface
/// @author CAREL Team
/// @notice Admin controls for verifier configuration.
#[starknet::interface]
pub trait IPrivatePaymentsAdmin<TContractState> {
    /// @notice Updates verifier address.
    /// @dev Owner-only.
    /// @param verifier New verifier address.
    fn set_verifier(ref self: TContractState, verifier: ContractAddress);
}

/// @title Private Payments Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy hooks for private payments.
#[starknet::interface]
pub trait IPrivatePaymentsPrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private payments action proof.
    fn submit_private_payments_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @title Private Payments Contract
/// @author CAREL Team
/// @notice Confidential payments via encrypted commitments.
/// @dev Uses verifier and nullifiers for safety.
#[starknet::contract]
pub mod PrivatePayments {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use openzeppelin::access::ownable::OwnableComponent;
    use core::num::traits::Zero;
    use super::PaymentCommitment;
    use super::super::zk_privacy_router::{IProofVerifierDispatcher, IProofVerifierDispatcherTrait};
    use super::super::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use super::super::action_types::ACTION_PRIVATE_PAYMENTS;

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
        pub privacy_router: ContractAddress,
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
    fn constructor(ref self: ContractState, admin: ContractAddress, verifier: ContractAddress) {
        self.ownable.initializer(admin);
        self.verifier.write(verifier);
    }

    #[abi(embed_v0)]
    impl PrivatePaymentsImpl of super::IPrivatePayments<ContractState> {
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

        fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.nullifiers.entry(nullifier).read()
        }
    }

    #[abi(embed_v0)]
    impl AdminImpl of super::IPrivatePaymentsAdmin<ContractState> {
        fn set_verifier(ref self: ContractState, verifier: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!verifier.is_zero(), "Verifier required");
            self.verifier.write(verifier);
            self.emit(Event::VerifierUpdated(VerifierUpdated { verifier }));
        }
    }

    #[abi(embed_v0)]
    impl PrivatePaymentsPrivacyImpl of super::IPrivatePaymentsPrivacy<ContractState> {
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        fn submit_private_payments_action(
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
                ACTION_PRIVATE_PAYMENTS,
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
