use starknet::ContractAddress;

// Minimal privacy router interface used by swap modules.
// Keeps swap code decoupled from legacy privacy module layout.
#[starknet::interface]
pub trait IPrivacyRouter<TContractState> {
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
