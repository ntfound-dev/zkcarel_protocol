use starknet::ContractAddress;

#[starknet::interface]
pub trait IExternalStakeAdapter<TContractState> {
    fn stake_external(
        ref self: TContractState,
        token: ContractAddress,
        amount: u256,
        target_protocol: ContractAddress,
        recipient: ContractAddress,
    ) -> u256;

    fn withdraw_external(
        ref self: TContractState,
        token: ContractAddress,
        amount: u256,
        target_protocol: ContractAddress,
        recipient: ContractAddress,
    ) -> u256;
}
