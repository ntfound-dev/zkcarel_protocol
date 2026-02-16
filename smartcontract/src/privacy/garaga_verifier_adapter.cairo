/// @title Garaga Verifier Adapter
/// @author CAREL Team
/// @notice Adapter for Garaga proof verification on Starknet.
/// @dev Forwards proof verification to Garaga verifier contract.
#[starknet::contract]
pub mod GaragaVerifierAdapter {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;

    /// Legacy generic interface (used by mock verifier and older adapters).
    #[starknet::interface]
    pub trait IGaragaVerifier<TContractState> {
        fn verify_proof(self: @TContractState, proof: Span<felt252>, public_inputs: Span<felt252>) -> bool;
    }

    /// Garaga generated Starknet Honk verifier interface.
    #[starknet::interface]
    pub trait IGaragaUltraStarknetHonkVerifier<TContractState> {
        fn verify_ultra_starknet_honk_proof(self: @TContractState, full_proof_with_hints: Span<felt252>) -> bool;
    }

    /// Garaga generated Groth16 BN254 verifier interface.
    #[starknet::interface]
    pub trait IGaragaGroth16Bn254Verifier<TContractState> {
        fn verify_groth16_proof_bn254(self: @TContractState, full_proof_with_hints: Span<felt252>) -> bool;
    }

    /// Garaga generated Groth16 BLS12-381 verifier interface.
    #[starknet::interface]
    pub trait IGaragaGroth16Bls12381Verifier<TContractState> {
        fn verify_groth16_proof_bls12_381(self: @TContractState, full_proof_with_hints: Span<felt252>) -> bool;
    }

    /// Admin interface for selecting Garaga verifier function mode.
    #[starknet::interface]
    pub trait IGaragaVerifierModeAdmin<TContractState> {
        fn set_verification_mode(ref self: TContractState, mode: u8);
        fn get_verification_mode(self: @TContractState) -> u8;
    }

    const MODE_LEGACY: u8 = 0;
    const MODE_ULTRA_STARKNET_HONK: u8 = 1;
    const MODE_GROTH16_BN254: u8 = 2;
    const MODE_GROTH16_BLS12_381: u8 = 3;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub verifier: ContractAddress,
        pub verification_mode: u8,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        VerifierUpdated: VerifierUpdated,
        VerificationModeUpdated: VerificationModeUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VerifierUpdated {
        pub verifier: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VerificationModeUpdated {
        pub mode: u8,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, verifier: ContractAddress) {
        self.ownable.initializer(admin);
        assert!(!verifier.is_zero(), "Verifier required");
        self.verifier.write(verifier);
        self.verification_mode.write(MODE_LEGACY);
    }

    #[abi(embed_v0)]
    impl VerifierImpl of super::super::zk_privacy_router::IProofVerifier<ContractState> {
        fn verify_proof(self: @ContractState, proof: Span<felt252>, public_inputs: Span<felt252>) -> bool {
            let verifier_address = self.verifier.read();
            assert!(!verifier_address.is_zero(), "Verifier not set");

            let mode = self.verification_mode.read();
            if mode == MODE_ULTRA_STARKNET_HONK {
                let verifier = IGaragaUltraStarknetHonkVerifierDispatcher { contract_address: verifier_address };
                return verifier.verify_ultra_starknet_honk_proof(proof);
            }
            if mode == MODE_GROTH16_BN254 {
                let verifier = IGaragaGroth16Bn254VerifierDispatcher { contract_address: verifier_address };
                return verifier.verify_groth16_proof_bn254(proof);
            }
            if mode == MODE_GROTH16_BLS12_381 {
                let verifier = IGaragaGroth16Bls12381VerifierDispatcher { contract_address: verifier_address };
                return verifier.verify_groth16_proof_bls12_381(proof);
            }

            let verifier = IGaragaVerifierDispatcher { contract_address: verifier_address };
            verifier.verify_proof(proof, public_inputs)
        }
    }

    #[abi(embed_v0)]
    impl AdminImpl of super::super::privacy_adapter::IPrivacyVerifierAdmin<ContractState> {
        fn set_verifier(ref self: ContractState, verifier: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!verifier.is_zero(), "Verifier required");
            self.verifier.write(verifier);
            self.emit(Event::VerifierUpdated(VerifierUpdated { verifier }));
        }
    }

    #[abi(embed_v0)]
    impl ModeAdminImpl of IGaragaVerifierModeAdmin<ContractState> {
        fn set_verification_mode(ref self: ContractState, mode: u8) {
            self.ownable.assert_only_owner();
            assert!(mode <= MODE_GROTH16_BLS12_381, "Unsupported mode");
            self.verification_mode.write(mode);
            self.emit(Event::VerificationModeUpdated(VerificationModeUpdated { mode }));
        }

        fn get_verification_mode(self: @ContractState) -> u8 {
            self.verification_mode.read()
        }
    }
}
