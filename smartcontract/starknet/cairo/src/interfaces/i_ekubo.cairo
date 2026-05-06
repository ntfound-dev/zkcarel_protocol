use starknet::ContractAddress;

/// @title IEkubo
/// @notice Minimal interface for swapping tokens via the Ekubo DEX router.
#[starknet::interface]
pub trait IEkubo<TContractState> {
    /// @notice Executes a token swap through Ekubo.
    /// @param token_in Address of the input token.
    /// @param token_out Address of the output token.
    /// @param amount_in Amount of `token_in` to swap.
    /// @param min_amount_out Minimum acceptable amount of `token_out` (slippage guard).
    /// @param recipient Address that receives the output tokens.
    /// @return Amount of `token_out` received.
    fn swap(
        ref self: TContractState,
        token_in: ContractAddress,
        token_out: ContractAddress,
        amount_in: u256,
        min_amount_out: u256,
        recipient: ContractAddress,
    ) -> u256;
}
