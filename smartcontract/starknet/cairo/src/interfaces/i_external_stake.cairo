use starknet::ContractAddress;

/// @title IExternalStakeAdapter
/// @notice Adapter interface for delegating staking and withdrawal operations to
///         external DeFi protocols (Ekubo, Nostra, zkLend) via CarelStakeVault.
#[starknet::interface]
pub trait IExternalStakeAdapter<TContractState> {
    /// @notice Stakes tokens in an external protocol on behalf of a recipient.
    /// @param token Address of the token to stake.
    /// @param amount Amount to stake.
    /// @param target_protocol Address of the target external protocol.
    /// @param recipient Address that receives the staking position / receipt token.
    /// @return Amount of receipt tokens or position units received.
    fn stake_external(
        ref self: TContractState,
        token: ContractAddress,
        amount: u256,
        target_protocol: ContractAddress,
        recipient: ContractAddress,
    ) -> u256;

    /// @notice Withdraws a staked position from an external protocol.
    /// @param token Address of the token to withdraw.
    /// @param amount Amount of staked position / receipt tokens to redeem.
    /// @param target_protocol Address of the target external protocol.
    /// @param recipient Address that receives the withdrawn tokens.
    /// @return Amount of underlying tokens returned.
    fn withdraw_external(
        ref self: TContractState,
        token: ContractAddress,
        amount: u256,
        target_protocol: ContractAddress,
        recipient: ContractAddress,
    ) -> u256;
}
