use starknet::ContractAddress;

/// @title IZkLendPool
/// @notice Minimal interface for depositing and withdrawing liquidity via zkLend.
#[starknet::interface]
pub trait IZkLendPool<TContractState> {
    /// @notice Deposits tokens into a zkLend lending pool.
    /// @param token Address of the token to deposit.
    /// @param amount Amount to deposit.
    /// @param recipient Address that receives the deposit receipt / yield-bearing token.
    /// @return Amount of receipt tokens minted.
    fn deposit(
        ref self: TContractState,
        token: ContractAddress,
        amount: u256,
        recipient: ContractAddress,
    ) -> u256;

    /// @notice Withdraws tokens from a zkLend lending pool.
    /// @param token Address of the token to withdraw.
    /// @param amount Amount of receipt tokens to redeem.
    /// @param recipient Address that receives the withdrawn tokens.
    /// @return Amount of underlying tokens returned.
    fn withdraw(
        ref self: TContractState,
        token: ContractAddress,
        amount: u256,
        recipient: ContractAddress,
    ) -> u256;
}
