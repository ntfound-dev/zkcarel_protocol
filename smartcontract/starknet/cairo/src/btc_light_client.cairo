#[starknet::contract]
mod btc_light_client {
    use core::array::Array;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };

    #[storage]
    struct Storage {
        known_block_hashes: Map<felt252, bool>,
        best_block_hash: felt252,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        HeaderStored: HeaderStored,
        ProofVerified: ProofVerified,
    }

    #[derive(Drop, starknet::Event)]
    struct HeaderStored {
        block_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct ProofVerified {
        txid: felt252,
        amount_satoshi: u64,
        note_commitment: felt252,
        proof_cid: felt252,
    }

    #[external(v0)]
    fn store_header(ref self: ContractState, header: Array<felt252>, pow_proof: Array<felt252>) {
        // TODO: verify PoW + header chain linkage.
        let _ = (header, pow_proof);
        let block_hash = 0;
        self.known_block_hashes.write(block_hash, true);
        self.best_block_hash.write(block_hash);
        self.emit(Event::HeaderStored(HeaderStored { block_hash }));
    }

    #[external(v0)]
    fn verify_btc_zk_proof(
        ref self: ContractState,
        proof_cid: felt252,
        proof_hash: felt252,
        txid: felt252,
        amount_satoshi: u64,
        note_commitment: felt252,
    ) {
        // TODO: fetch proof via CID, verify hash + circuit proof.
        let _ = proof_hash;
        self.emit(Event::ProofVerified(ProofVerified {
            txid,
            amount_satoshi,
            note_commitment,
            proof_cid,
        }));
    }

    #[external(v0)]
    fn is_known_block(self: @ContractState, block_hash: felt252) -> bool {
        self.known_block_hashes.read(block_hash)
    }

    #[external(v0)]
    fn get_best_block(self: @ContractState) -> felt252 {
        self.best_block_hash.read()
    }
}
