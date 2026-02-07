use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct EncryptedSwapData {
    pub ciphertext: felt252, 
    pub commitment: felt252, 
    pub is_finalized: bool,
}

#[starknet::interface]
pub trait ITongoVerifier<TContractState> {
    fn verify_proof(
        self: @TContractState, 
        proof: Span<felt252>, 
        public_inputs: Span<felt252>
    ) -> bool;
}

#[starknet::interface]
pub trait IPrivateSwap<TContractState> {
    fn initiate_private_swap(
        ref self: TContractState, 
        encrypted_data: EncryptedSwapData, 
        zk_proof: Span<felt252>
    ) -> u64;
    fn verify_private_swap(self: @TContractState, swap_id: u64, proof: Span<felt252>) -> bool;
    fn finalize_swap(ref self: TContractState, swap_id: u64, recipient: ContractAddress, nullifier: felt252);
}

#[starknet::contract]
pub mod PrivateSwap {
    // HANYA mengimpor yang benar-benar digunakan
    use starknet::ContractAddress;
    use starknet::storage::*;
    use super::{EncryptedSwapData, IPrivateSwap, ITongoVerifierDispatcher, ITongoVerifierDispatcherTrait};

    #[storage]
    pub struct Storage {
        pub tongo_verifier: ContractAddress,
        pub private_swaps: Map<u64, EncryptedSwapData>,
        pub nullifiers: Map<felt252, bool>,
        pub swap_count: u64,
    }

    #[constructor]
    fn constructor(ref self: ContractState, verifier_address: ContractAddress) {
        self.tongo_verifier.write(verifier_address);
    }

    #[abi(embed_v0)]
    impl PrivateSwapImpl of IPrivateSwap<ContractState> {
        fn initiate_private_swap(
            ref self: ContractState, 
            encrypted_data: EncryptedSwapData, 
            zk_proof: Span<felt252>
        ) -> u64 {
            // Menggunakan Dispatcher pattern untuk interaksi antar kontrak
            let verifier = ITongoVerifierDispatcher { contract_address: self.tongo_verifier.read() };
            let mut inputs = array![encrypted_data.commitment];
            
            assert!(verifier.verify_proof(zk_proof, inputs.span()), "Invalid initiation proof");

            let id = self.swap_count.read() + 1;
            self.private_swaps.entry(id).write(encrypted_data);
            self.swap_count.write(id);
            id
        }

        fn verify_private_swap(self: @ContractState, swap_id: u64, proof: Span<felt252>) -> bool {
            let swap = self.private_swaps.entry(swap_id).read();
            let verifier = ITongoVerifierDispatcher { contract_address: self.tongo_verifier.read() };
            
            let mut inputs = array![swap.commitment];
            verifier.verify_proof(proof, inputs.span())
        }

        fn finalize_swap(
            ref self: ContractState, 
            swap_id: u64, 
            recipient: ContractAddress, 
            nullifier: felt252
        ) {
            // Logika Nullifier untuk mencegah double-spending
            assert!(!self.nullifiers.entry(nullifier).read(), "Nullifier already used");
            
            let mut swap = self.private_swaps.entry(swap_id).read();
            assert!(!swap.is_finalized, "Swap already finalized");

            swap.is_finalized = true;
            self.private_swaps.entry(swap_id).write(swap);
            self.nullifiers.entry(nullifier).write(true);
        }
    }
}