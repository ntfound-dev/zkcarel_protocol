/// @title CarelStakeVault
/// @notice Aggregates internal CAREL staking and external protocol staking via an adapter.
#[starknet::contract]
mod carel_stake_vault {
    use core::num::traits::Zero;
    use starknet::ContractAddress;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use openzeppelin::access::ownable::OwnableComponent;
    use crate::interfaces::i_external_stake::{
        IExternalStakeAdapterDispatcher, IExternalStakeAdapterDispatcherTrait
    };

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        external_adapter: ContractAddress,
        total_staked: u256,
        user_stakes: Map<ContractAddress, u256>,
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        StakeInternal: StakeInternal,
        StakeExternal: StakeExternal,
        Withdraw: Withdraw,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    /// @notice Emitted when a user stakes CAREL internally.
    #[derive(Drop, starknet::Event)]
    struct StakeInternal {
        staker: ContractAddress,
        amount: u256,
        lock_duration: u64,
    }

    /// @notice Emitted when a user stakes externally via the adapter.
    #[derive(Drop, starknet::Event)]
    struct StakeExternal {
        staker: ContractAddress,
        token: ContractAddress,
        amount: u256,
        target_protocol: ContractAddress,
    }

    /// @notice Emitted when a user withdraws staked tokens.
    #[derive(Drop, starknet::Event)]
    struct Withdraw {
        staker: ContractAddress,
        amount: u256,
    }

    /// @notice Initializes the vault with an owner.
    /// @param owner Initial contract owner (two-step transfer via OZ OwnableComponent).
    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.ownable.initializer(owner);
    }

    /// @notice Sets the external staking adapter.
    /// @dev Callable only by the contract owner.
    #[external(v0)]
    fn set_external_adapter(ref self: ContractState, external_adapter: ContractAddress) {
        self.ownable.assert_only_owner();
        assert!(!external_adapter.is_zero(), "ADAPTER_REQUIRED");
        self.external_adapter.write(external_adapter);
    }

    /// @notice Returns the configured external adapter address.
    #[external(v0)]
    fn get_external_adapter(self: @ContractState) -> ContractAddress {
        self.external_adapter.read()
    }

    /// @notice Stakes CAREL tokens internally with a lock duration.
    /// @dev TODO: transfer CAREL, apply lock, mint stake receipt.
    #[external(v0)]
    fn stake_internal(ref self: ContractState, amount: u256, lock_duration: u64) {
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

    /// @notice Stakes tokens externally via the configured adapter.
    /// @dev TODO: validate protocol + token allowlist before calling.
    #[external(v0)]
    fn stake_external(
        ref self: ContractState,
        token: ContractAddress,
        amount: u256,
        target_protocol: ContractAddress,
        recipient: ContractAddress,
    ) {
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

    /// @notice Withdraws staked tokens.
    /// @dev TODO: validate lock + transfer rewards.
    #[external(v0)]
    fn withdraw(ref self: ContractState, amount: u256) {
        let caller = starknet::get_caller_address();
        let _ = amount;
        self.emit(Event::Withdraw(Withdraw { staker: caller, amount }));
    }

    /// @notice Returns the staked amount for a user.
    #[external(v0)]
    fn stake_of(self: @ContractState, user: ContractAddress) -> u256 {
        self.user_stakes.read(user)
    }
}
