/// @title BtcLightClient
/// @notice Stub on-chain light client for Bitcoin header chain and ZK proof verification.
///         Stores known block hashes and emits events on proof verification.
///         Full PoW validation and proof circuit verification are pending (TODO).
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

    /// @notice Emitted when a Bitcoin block header is stored on-chain.
    #[derive(Drop, starknet::Event)]
    struct HeaderStored {
        block_hash: felt252,
    }

    /// @notice Emitted when a ZK proof of a Bitcoin transaction is verified.
    #[derive(Drop, starknet::Event)]
    struct ProofVerified {
        txid: felt252,
        amount_satoshi: u64,
        note_commitment: felt252,
        proof_cid: felt252,
    }

    /// @notice Stores a Bitcoin block header and updates the best block hash.
    /// @dev TODO: verify PoW and header chain linkage before accepting.
    /// @param header Serialized Bitcoin block header fields.
    /// @param pow_proof Proof-of-work auxiliary data (reserved for future validation).
    #[external(v0)]
    fn store_header(ref self: ContractState, header: Array<felt252>, pow_proof: Array<felt252>) {
        // TODO: verify PoW + header chain linkage.
        let _ = (header, pow_proof);
        let block_hash = 0;
        self.known_block_hashes.write(block_hash, true);
        self.best_block_hash.write(block_hash);
        self.emit(Event::HeaderStored(HeaderStored { block_hash }));
    }

    /// @notice Verifies a ZK proof attesting to a Bitcoin transaction inclusion.
    /// @dev TODO: fetch proof via IPFS CID, verify hash and circuit proof before emitting.
    /// @param proof_cid IPFS CID of the stored ZK proof.
    /// @param proof_hash Expected hash of the proof data (integrity check).
    /// @param txid Bitcoin transaction ID being proven.
    /// @param amount_satoshi Amount transferred in the proven transaction, in satoshis.
    /// @param note_commitment Poseidon commitment of the corresponding deposit note.
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

    /// @notice Returns whether a given block hash has been stored.
    /// @param block_hash The Bitcoin block hash to look up.
    /// @return True if the hash is known, false otherwise.
    #[external(v0)]
    fn is_known_block(self: @ContractState, block_hash: felt252) -> bool {
        self.known_block_hashes.read(block_hash)
    }

    /// @notice Returns the most recently stored Bitcoin block hash.
    /// @return The best known block hash as a felt252.
    #[external(v0)]
    fn get_best_block(self: @ContractState) -> felt252 {
        self.best_block_hash.read()
    }
}
