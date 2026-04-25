use starknet::ContractAddress;

#[starknet::interface]
trait IZkLendPool<TContractState> {
    fn deposit(
        ref self: TContractState,
        token: ContractAddress,
        amount: u256,
        recipient: ContractAddress,
    ) -> u256;

    fn withdraw(
        ref self: TContractState,
        token: ContractAddress,
        amount: u256,
        recipient: ContractAddress,
    ) -> u256;
}
