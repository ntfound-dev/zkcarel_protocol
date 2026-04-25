use dep::starknet_note_v4::{
    compute_note_commitment_v4,
    compute_nullifier_v4,
    poseidon_hash_many_2,
};

fn placeholder_merkle_hash(left: Field, right: Field) -> Field {
    poseidon_hash_many_2(left, right)
}

fn compute_merkle_root(
    leaf: Field,
    path: [Field; 32],
    index_bits: [bool; 32],
) -> Field {
    let mut hash = leaf;
    for i in 0..32 {
        let sibling = path[i];
        if index_bits[i] {
            hash = placeholder_merkle_hash(sibling, hash);
        } else {
            hash = placeholder_merkle_hash(hash, sibling);
        }
    }
    hash
}

fn main(
    note_secret: Field,
    amount_satoshi: u128,
    note_token: Field,
    txid: Field,
    merkle_path: [Field; 32],
    merkle_index: [bool; 32],
    block_merkle_root: Field,
    block_hash: Field,
    root: pub Field,
    nullifier: pub Field,
    action_hash: pub Field,
    recipient: pub Field,
    chain_id: pub Field,
    contract_address: pub Field,
    commitment: pub Field,
) {
    // TODO(v4-btc): replace placeholder_merkle_hash with a real sha256d Bitcoin gadget.
    // Until then, this circuit only aligns note/nullifier semantics with ShieldedPoolV4.
    // TODO(v4-btc): verify sha256d(raw_tx) == txid.
    // TODO(v4-btc): verify merkle root from txid matches block header merkle root (sha256d tree).
    // TODO(v4-btc): verify block header hash + PoW (sha256d(header) == block_hash).

    let _ = (block_hash, recipient, chain_id, contract_address, action_hash);

    let computed_root = compute_merkle_root(txid, merkle_path, merkle_index);
    assert(computed_root == block_merkle_root);
    assert(root == block_merkle_root);

    let computed_nullifier = compute_nullifier_v4(note_secret);
    assert(computed_nullifier == nullifier);

    let computed_commitment = compute_note_commitment_v4(note_secret, amount_satoshi, note_token);
    assert(computed_commitment == commitment);
}
