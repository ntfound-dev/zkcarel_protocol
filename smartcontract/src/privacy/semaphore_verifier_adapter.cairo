/// @title Semaphore Verifier Adapter
/// @author CAREL Team
/// @notice Adapter for Semaphore proof verification.
/// @dev Forwards proof verification to Semaphore verifier contract.
#[starknet::contract]
pub mod SemaphoreVerifierAdapter {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use openzeppelin::access::ownable::OwnableComponent;

    #[starknet::interface]
    pub trait ISemaphoreVerifier<TContractState> {
        fn verify_proof(
            self: @TContractState,
            root: felt252,
            nullifier_hash: felt252,
            signal: felt252,
            proof: Span<felt252>
        ) -> bool;
    }

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub verifier: ContractAddress,
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
        pub verifier: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, verifier: ContractAddress) {
        self.ownable.initializer(admin);
        self.verifier.write(verifier);
    }

    #[abi(embed_v0)]
    impl VerifierImpl of super::super::zk_privacy_router::IProofVerifier<ContractState> {
        fn verify_proof(self: @ContractState, proof: Span<felt252>, public_inputs: Span<felt252>) -> bool {
            // public_inputs layout: [root, nullifier_hash, signal]
            assert!(public_inputs.len() == 3, "Invalid public inputs");
            let root = *public_inputs.at(0);
            let nullifier_hash = *public_inputs.at(1);
            let signal = *public_inputs.at(2);
            let verifier = ISemaphoreVerifierDispatcher { contract_address: self.verifier.read() };
            verifier.verify_proof(root, nullifier_hash, signal, proof)
        }
    }

    #[abi(embed_v0)]
    impl AdminImpl of super::super::privacy_adapter::IPrivacyVerifierAdmin<ContractState> {
        fn set_verifier(ref self: ContractState, verifier: ContractAddress) {
            self.ownable.assert_only_owner();
            self.verifier.write(verifier);
            self.emit(Event::VerifierUpdated(VerifierUpdated { verifier }));
        }
    }
}
