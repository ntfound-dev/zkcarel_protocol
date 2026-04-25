#[starknet::contract]
mod carel_stake_vault {
    use core::num::traits::Zero;
    use starknet::ContractAddress;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use crate::interfaces::i_external_stake::{
        IExternalStakeAdapterDispatcher, IExternalStakeAdapterDispatcherTrait
    };

    #[storage]
    struct Storage {
        owner: ContractAddress,
        external_adapter: ContractAddress,
        total_staked: u256,
        user_stakes: Map<ContractAddress, u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        StakeInternal: StakeInternal,
        StakeExternal: StakeExternal,
        Withdraw: Withdraw,
    }

    #[derive(Drop, starknet::Event)]
    struct StakeInternal {
        staker: ContractAddress,
        amount: u256,
        lock_duration: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct StakeExternal {
        staker: ContractAddress,
        token: ContractAddress,
        amount: u256,
        target_protocol: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct Withdraw {
        staker: ContractAddress,
        amount: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.owner.write(owner);
    }

    fn assert_owner(self: @ContractState) {
        let caller = starknet::get_caller_address();
        assert!(caller == self.owner.read(), "ONLY_OWNER");
    }

    #[external(v0)]
    fn set_external_adapter(ref self: ContractState, external_adapter: ContractAddress) {
        assert_owner(@self);
        assert!(!external_adapter.is_zero(), "ADAPTER_REQUIRED");
        self.external_adapter.write(external_adapter);
    }

    #[external(v0)]
    fn get_external_adapter(self: @ContractState) -> ContractAddress {
        self.external_adapter.read()
    }

    #[external(v0)]
    fn stake_internal(ref self: ContractState, amount: u256, lock_duration: u64) {
        // TODO: transfer CAREL, apply lock, mint stake receipt.
        let caller = starknet::get_caller_address();
        let _ = lock_duration;
        let current = self.user_stakes.read(caller);
        self.user_stakes.write(caller, current + amount);
        self.total_staked.write(self.total_staked.read() + amount);
        self.emit(Event::StakeInternal(StakeInternal {
            staker: caller,
            amount,
            lock_duration,
        }));
    }

    #[external(v0)]
    fn stake_external(
        ref self: ContractState,
        token: ContractAddress,
        amount: u256,
        target_protocol: ContractAddress,
        recipient: ContractAddress,
    ) {
        // TODO: validate protocol + token allowlist before calling.
        let caller = starknet::get_caller_address();
        let adapter = self.external_adapter.read();
        assert!(!adapter.is_zero(), "ADAPTER_NOT_SET");
        let dispatcher = IExternalStakeAdapterDispatcher { contract_address: adapter };
        let _ = dispatcher.stake_external(token, amount, target_protocol, recipient);
        self.emit(Event::StakeExternal(StakeExternal {
            staker: caller,
            token,
            amount,
            target_protocol,
        }));
    }

    #[external(v0)]
    fn withdraw(ref self: ContractState, amount: u256) {
        // TODO: validate lock + transfer rewards.
        let caller = starknet::get_caller_address();
        let _ = amount;
        self.emit(Event::Withdraw(Withdraw { staker: caller, amount }));
    }

    #[external(v0)]
    fn stake_of(self: @ContractState, user: ContractAddress) -> u256 {
        self.user_stakes.read(user)
    }
}
