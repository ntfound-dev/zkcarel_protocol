use dep::std::hash::poseidon;

const MERKLE_DEPTH: usize = 20;
fn hash2(a: Field, b: Field) -> Field {
    poseidon::bn254::hash_2([a, b])
}

fn compute_nullifier(note_secret: Field) -> Field {
    hash2(note_secret, 0)
}

fn compute_note_commitment(note_secret: Field, note_amount: u128, note_token: Field) -> Field {
    let amount_field: Field = note_amount as Field;
    let h1 = hash2(note_secret, amount_field);
    hash2(h1, note_token)
}

fn compute_merkle_root(
    leaf: Field,
    path: [Field; MERKLE_DEPTH],
    index_bits: [bool; MERKLE_DEPTH],
) -> Field {
    let mut hash = leaf;
    for i in 0..MERKLE_DEPTH {
        let sibling = path[i];
        if index_bits[i] {
            hash = hash2(sibling, hash);
        } else {
            hash = hash2(hash, sibling);
        }
    }
    hash
}

fn main(
    note_secret: Field,
    note_amount: u128,
    note_token: Field,
    merkle_path: [Field; MERKLE_DEPTH],
    merkle_index: [bool; MERKLE_DEPTH],
    stake_amount: u128,
    lock_duration: u64,
    expected_apy_bps: u128,
    pub merkle_root: Field,
    pub nullifier: Field,
    pub action_hash: Field,
    pub recipient: Field,
    pub chain_id: Field,
    pub contract_address: Field,
) {
    let computed_nullifier = compute_nullifier(note_secret);
    assert(computed_nullifier == nullifier);

    let note_commitment = compute_note_commitment(note_secret, note_amount, note_token);
    let computed_root = compute_merkle_root(note_commitment, merkle_path, merkle_index);
    assert(computed_root == merkle_root);

    assert(stake_amount <= note_amount);

    let _ = (
        stake_amount,
        lock_duration,
        expected_apy_bps,
        recipient,
        chain_id,
        contract_address,
    );
}
