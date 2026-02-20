use starknet::ContractAddress;

// Admin controls for privacy verifier adapters.
// Common interface for swapping verifier endpoints.
#[starknet::interface]
pub trait IPrivacyVerifierAdmin<TContractState> {
    // Owner/admin-only setter for rotating the verifier contract used by privacy flows.
    fn set_verifier(ref self: TContractState, verifier: ContractAddress);
}
