use starknet::ContractAddress;

/// @title Privacy Verifier Admin Interface
/// @author CAREL Team
/// @notice Admin controls for privacy verifier adapters.
/// @dev Common interface for swapping verifier endpoints.
#[starknet::interface]
pub trait IPrivacyVerifierAdmin<TContractState> {
    /// @notice Updates the underlying verifier contract address.
    /// @dev Owner-only to keep verification trusted.
    /// @param verifier New verifier address.
    fn set_verifier(ref self: TContractState, verifier: ContractAddress);
}
