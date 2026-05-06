/// @title RawHonkProofVerifierAdapter
/// @notice Adapter that wraps a raw Garaga UltraKeccakZKHonk verifier contract into the
///         `IProofVerifier` interface consumed by ShieldedPoolV4.
///         Deploy this contract pointing at the standalone Garaga verifier address,
///         then register its address as the verifier in ShieldedPoolV4.

/// @notice Interface for a raw Garaga-generated UltraKeccak ZK Honk verifier.
#[starknet::interface]
pub trait IRawHonkVerifier<TContractState> {
    fn verify_ultra_keccak_zk_honk_proof(
        self: @TContractState, full_proof_with_hints: Span<felt252>,
    ) -> Result<Span<u256>, felt252>;
}

/// @notice Simplified proof verifier interface used by ShieldedPoolV4.
#[starknet::interface]
pub trait IProofVerifier<TContractState> {
    fn verify_proof(
        self: @TContractState,
        proof: Span<felt252>,
        public_inputs: Span<felt252>,
    ) -> bool;
}

#[starknet::contract]
mod RawHonkProofVerifierAdapter {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::ContractAddress;
    use super::{IRawHonkVerifierDispatcher, IRawHonkVerifierDispatcherTrait, IProofVerifier};

    #[storage]
    struct Storage {
        verifier: ContractAddress,
    }

    /// @notice Initializes the adapter with the address of the raw Garaga verifier contract.
    /// @param verifier Address of the deployed UltraKeccakZKHonk verifier.
    #[constructor]
    fn constructor(ref self: ContractState, verifier: ContractAddress) {
        self.verifier.write(verifier);
    }

    /// @notice Checks that the public inputs returned by the raw verifier match the expected values.
    /// @param expected Expected public inputs as felt252 (from the caller).
    /// @param actual Actual public inputs as u256 (returned by the raw verifier).
    /// @return True if lengths and all values match.
    fn proof_public_inputs_match(
        expected: Span<felt252>, actual: Span<u256>,
    ) -> bool {
        let len = expected.len();
        if len != actual.len() {
            return false;
        }
        let mut i = 0;
        while i < len {
            let expected_item: u256 = (*expected.at(i)).into();
            let actual_item = *actual.at(i);
            if actual_item != expected_item {
                return false;
            }
            i += 1;
        };
        true
    }

    #[abi(embed_v0)]
    impl ProofVerifierImpl of IProofVerifier<ContractState> {
        /// @inheritdoc IProofVerifier
        /// @notice Calls the raw Garaga verifier and checks the returned public inputs.
        /// @param proof Serialized ZK proof with hints (Garaga format).
        /// @param public_inputs Expected circuit public inputs.
        /// @return True if proof verifies and public inputs match; false otherwise.
        fn verify_proof(
            self: @ContractState,
            proof: Span<felt252>,
            public_inputs: Span<felt252>,
        ) -> bool {
            let raw_verifier = self.verifier.read();
            let dispatcher = IRawHonkVerifierDispatcher { contract_address: raw_verifier };
            match dispatcher.verify_ultra_keccak_zk_honk_proof(proof) {
                Result::Ok(proof_public_inputs) => {
                    proof_public_inputs_match(public_inputs, proof_public_inputs)
                },
                Result::Err(_) => false,
            }
        }
    }
}
