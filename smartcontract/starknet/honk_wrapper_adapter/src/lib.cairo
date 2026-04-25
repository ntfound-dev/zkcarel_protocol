#[starknet::interface]
pub trait IRawHonkVerifier<TContractState> {
    fn verify_ultra_keccak_zk_honk_proof(
        self: @TContractState, full_proof_with_hints: Span<felt252>,
    ) -> Result<Span<u256>, felt252>;
}

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

    #[constructor]
    fn constructor(ref self: ContractState, verifier: ContractAddress) {
        self.verifier.write(verifier);
    }

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
