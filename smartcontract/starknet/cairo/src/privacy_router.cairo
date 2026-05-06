/// @title IPrivacyRouter
/// @notice Minimal privacy router interface used across core and trading modules.
///         Keeps active contracts decoupled from the legacy privacy module layout.
#[starknet::interface]
pub trait IPrivacyRouter<TContractState> {
    /// @notice Submits a privacy action to the router for proof verification and state update.
    /// @param action_type Short felt252 action identifier (see `privacy_action_types.cairo`).
    /// @param old_root Previous Merkle tree root.
    /// @param new_root Updated Merkle tree root after commitments.
    /// @param nullifiers Nullifiers for inputs being spent.
    /// @param commitments New Merkle commitments.
    /// @param public_inputs ZK circuit public inputs.
    /// @param proof Serialized ZK proof.
    fn submit_action(
        ref self: TContractState,
        action_type: felt252,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}
