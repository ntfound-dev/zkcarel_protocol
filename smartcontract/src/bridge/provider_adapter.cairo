use starknet::ContractAddress;

// Defines a standardized adapter interface for bridge providers.
// Implementations wrap provider-specific logic.
#[starknet::interface]
pub trait IBridgeProviderAdapter<TContractState> {
    // Applies execute bridge after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn execute_bridge(ref self: TContractState, user: ContractAddress, amount: u256, provider_id: felt252) -> bool;
}

// Admin controls for bridge adapters.
// Common admin surface for provider-specific adapters.
#[starknet::interface]
pub trait IBridgeAdapterAdmin<TContractState> {
    // Updates endpoint configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_endpoint(ref self: TContractState, endpoint: ByteArray);
    // Updates active configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_active(ref self: TContractState, active: bool);
}

// ZK privacy hooks for bridge adapters.
#[starknet::interface]
pub trait IBridgeAdapterPrivacy<TContractState> {
    // Updates privacy router configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Applies submit private bridge action after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn submit_private_bridge_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}
