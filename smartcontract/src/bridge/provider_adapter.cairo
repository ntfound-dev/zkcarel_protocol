use starknet::ContractAddress;

/// @title Bridge Provider Adapter Interface
/// @author CAREL Team
/// @notice Defines a standardized adapter interface for bridge providers.
/// @dev Implementations wrap provider-specific logic.
#[starknet::interface]
pub trait IBridgeProviderAdapter<TContractState> {
    /// @notice Executes a bridge operation for a user.
    /// @dev Returns true if the adapter accepted the request.
    /// @param user User address.
    /// @param amount Amount to bridge.
    /// @param provider_id Provider identifier.
    /// @return ok True if accepted.
    fn execute_bridge(ref self: TContractState, user: ContractAddress, amount: u256, provider_id: felt252) -> bool;
}

/// @title Bridge Adapter Admin Interface
/// @author CAREL Team
/// @notice Admin controls for bridge adapters.
/// @dev Common admin surface for provider-specific adapters.
#[starknet::interface]
pub trait IBridgeAdapterAdmin<TContractState> {
    /// @notice Updates the provider endpoint metadata.
    /// @dev Owner-only to avoid malicious routing.
    /// @param endpoint New endpoint reference.
    fn set_endpoint(ref self: TContractState, endpoint: ByteArray);
    /// @notice Enables or disables the adapter.
    /// @dev Owner-only to allow emergency disable.
    /// @param active New active state.
    fn set_active(ref self: TContractState, active: bool);
}

/// @title Bridge Adapter Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy hooks for bridge adapters.
#[starknet::interface]
pub trait IBridgeAdapterPrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private bridge action proof.
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
