use dep::starknet_note_v4::{
    compute_merkle_root_v4,
    compute_note_commitment_v4,
    compute_nullifier_v4,
};

fn main(
    note_secret: Field,
    note_amount: u128,
    note_token: Field,
    merkle_path: [Field; 20],
    merkle_index: [bool; 20],
    target_protocol: Field,
    stake_token: Field,
    stake_amount: u128,
    min_yield_token: Field,
    lock_duration: u64,
    expected_apy_bps: u128,
    merkle_root: pub Field,
    nullifier: pub Field,
    action_hash: pub Field,
    recipient: pub Field,
    chain_id: pub Field,
    contract_address: pub Field,
) {
    let computed_nullifier = compute_nullifier_v4(note_secret);
    assert(computed_nullifier == nullifier);

    let note_commitment = compute_note_commitment_v4(note_secret, note_amount, note_token);
    let computed_root = compute_merkle_root_v4(note_commitment, merkle_path, merkle_index);
    assert(computed_root == merkle_root);

    assert(stake_amount <= note_amount);
    assert(note_token == stake_token);

    let _ = (
        action_hash,
        target_protocol,
        min_yield_token,
        lock_duration,
        expected_apy_bps,
        recipient,
        chain_id,
        contract_address,
    );
}
