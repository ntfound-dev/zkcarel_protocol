use starknet::ContractAddress;

/// @title Proof Verifier Interface
/// @author CAREL Team
/// @notice Minimal interface for ZK proof verification.
/// @dev Used by privacy router to validate proofs.
#[starknet::interface]
pub trait IProofVerifier<TContractState> {
    /// @notice Verifies a zero-knowledge proof.
    /// @dev Returns true if proof and public inputs are valid.
    /// @param proof Proof data.
    /// @param public_inputs Public inputs for verification.
    /// @return valid True if the proof is valid.
    fn verify_proof(
        self: @TContractState,
        proof: Span<felt252>,
        public_inputs: Span<felt252>
    ) -> bool;
}

/// @title ZK Privacy Router Interface
/// @author CAREL Team
/// @notice Defines privacy action submission and verifier control.
/// @dev Tracks nullifiers to prevent replay.
#[starknet::interface]
pub trait IZkPrivacyRouter<TContractState> {
    /// @notice Submits a private action with a proof.
    /// @dev Validates proof and consumes nullifier.
    /// @param nullifier Nullifier to prevent replay.
    /// @param commitment Commitment for private action.
    /// @param proof Zero-knowledge proof.
    /// @param public_inputs Public inputs for verification.
    fn submit_private_action(
        ref self: TContractState,
        nullifier: felt252,
        commitment: felt252,
        proof: Span<felt252>,
        public_inputs: Span<felt252>
    );
    /// @notice Checks whether a nullifier has been used.
    /// @dev Read-only helper for clients.
    /// @param nullifier Nullifier to check.
    /// @return used True if already used.
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
    /// @notice Updates the verifier contract address.
    /// @dev Owner-only to keep verification trusted.
    /// @param verifier New verifier address.
    fn set_verifier(ref self: TContractState, verifier: ContractAddress);
}

/// @title ZK Privacy Router Contract
/// @author CAREL Team
/// @notice Routes privacy-preserving actions with ZK verification.
/// @dev Consumes nullifiers to prevent replay attacks.
#[starknet::contract]
pub mod ZkPrivacyRouter {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::*;
    use openzeppelin::access::ownable::OwnableComponent;
    use super::{IProofVerifierDispatcher, IProofVerifierDispatcherTrait};
    use core::num::traits::Zero;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub verifier: ContractAddress,
        pub nullifiers: Map<felt252, bool>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PrivateActionSubmitted: PrivateActionSubmitted,
        VerifierUpdated: VerifierUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PrivateActionSubmitted {
        pub user: ContractAddress,
        pub nullifier: felt252,
        pub commitment: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VerifierUpdated {
        pub verifier: ContractAddress,
    }

    /// @notice Initializes the ZK privacy router.
    /// @dev Sets admin and verifier address.
    /// @param admin Owner/admin address.
    /// @param verifier Verifier contract address.
    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, verifier: ContractAddress) {
        self.ownable.initializer(admin);
        self.verifier.write(verifier);
    }

    #[abi(embed_v0)]
    impl ZkPrivacyRouterImpl of super::IZkPrivacyRouter<ContractState> {
        /// @notice Submits a private action with a proof.
        /// @dev Validates proof and consumes nullifier.
        /// @param nullifier Nullifier to prevent replay.
        /// @param commitment Commitment for private action.
        /// @param proof Zero-knowledge proof.
        /// @param public_inputs Public inputs for verification.
        fn submit_private_action(
            ref self: ContractState,
            nullifier: felt252,
            commitment: felt252,
            proof: Span<felt252>,
            public_inputs: Span<felt252>
        ) {
            assert!(!self.nullifiers.entry(nullifier).read(), "Nullifier already used");
            assert!(public_inputs.len() >= 2, "public_inputs must include nullifier+commitment");
            assert!(
                *public_inputs.at(0_usize) == nullifier,
                "public_inputs[0] must equal nullifier"
            );
            assert!(
                *public_inputs.at(1_usize) == commitment,
                "public_inputs[1] must equal commitment"
            );
            let verifier = self.verifier.read();
            assert!(!verifier.is_zero(), "Verifier not set");

            let dispatcher = IProofVerifierDispatcher { contract_address: verifier };
            assert!(dispatcher.verify_proof(proof, public_inputs), "Invalid proof");

            self.nullifiers.entry(nullifier).write(true);
            self.emit(Event::PrivateActionSubmitted(PrivateActionSubmitted {
                user: get_caller_address(),
                nullifier,
                commitment
            }));
        }

        /// @notice Checks whether a nullifier has been used.
        /// @dev Read-only helper for clients.
        /// @param nullifier Nullifier to check.
        /// @return used True if already used.
        fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.nullifiers.entry(nullifier).read()
        }

        /// @notice Updates the verifier contract address.
        /// @dev Owner-only to keep verification trusted.
        /// @param verifier New verifier address.
        fn set_verifier(ref self: ContractState, verifier: ContractAddress) {
            self.ownable.assert_only_owner();
            self.verifier.write(verifier);
            self.emit(Event::VerifierUpdated(VerifierUpdated { verifier }));
        }
    }
}
