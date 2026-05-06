/// @title ShadowBridgeReceiver
/// @notice Forwards bridge-received deposits to the ShieldedPoolV4 `deposit_fixed_v4` entrypoint.
///         Operator-gated deposit_shadow_note with owner/pause controls.
#[starknet::contract]
mod shadow_bridge_receiver {
    use core::num::traits::Zero;
    use starknet::{
        ContractAddress, get_caller_address, get_contract_address,
    };
    use starknet::storage::StoragePointerReadAccess;
    use starknet::storage::StoragePointerWriteAccess;
    use openzeppelin::access::ownable::OwnableComponent;

    #[starknet::interface]
    trait IERC20<TContractState> {
        fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
        fn allowance(
            self: @TContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256;
        fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    }

    #[starknet::interface]
    trait IShieldedPoolV4<TContractState> {
        fn fixed_amount(self: @TContractState, token: ContractAddress, denom_id: felt252) -> u256;
        fn deposit_fixed_v4(
            ref self: TContractState,
            token: ContractAddress,
            denom_id: felt252,
            note_commitment: felt252,
            ipfs_cid: felt252,
        );
    }

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        operator: ContractAddress,
        pool: ContractAddress,
        token: ContractAddress,
        paused: bool,
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        OperatorUpdated: OperatorUpdated,
        PoolUpdated: PoolUpdated,
        TokenUpdated: TokenUpdated,
        Paused: Paused,
        Unpaused: Unpaused,
        DepositForwarded: DepositForwarded,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    /// @notice Emitted when the operator address is updated.
    #[derive(Drop, starknet::Event)]
    struct OperatorUpdated {
        operator: ContractAddress,
    }

    /// @notice Emitted when the shielded pool address is updated.
    #[derive(Drop, starknet::Event)]
    struct PoolUpdated {
        pool: ContractAddress,
    }

    /// @notice Emitted when the bridge token address is updated.
    #[derive(Drop, starknet::Event)]
    struct TokenUpdated {
        token: ContractAddress,
    }

    /// @notice Emitted when the contract is paused.
    #[derive(Drop, starknet::Event)]
    struct Paused {}

    /// @notice Emitted when the contract is unpaused.
    #[derive(Drop, starknet::Event)]
    struct Unpaused {}

    /// @notice Emitted when a shadow deposit is forwarded to the pool.
    #[derive(Drop, starknet::Event)]
    struct DepositForwarded {
        pool: ContractAddress,
        token: ContractAddress,
        denom_id: felt252,
        note_commitment: felt252,
    }

    /// @notice Initializes the receiver with owner, operator, pool, and token.
    /// @param owner Initial contract owner (two-step transfer via OZ OwnableComponent).
    /// @param operator Trusted bridge operator for deposit forwarding.
    /// @param pool ShieldedPoolV4 contract address.
    /// @param token Bridge token address.
    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        operator: ContractAddress,
        pool: ContractAddress,
        token: ContractAddress,
    ) {
        self.ownable.initializer(owner);
        self.operator.write(operator);
        self.pool.write(pool);
        self.token.write(token);
        self.paused.write(false);
    }

    /// @notice Sets the bridge operator address. Emits `OperatorUpdated`.
    /// @dev Callable only by the contract owner.
    #[external(v0)]
    fn set_operator(ref self: ContractState, operator: ContractAddress) {
        self.ownable.assert_only_owner();
        self.operator.write(operator);
        self.emit(Event::OperatorUpdated(OperatorUpdated { operator }));
    }

    /// @notice Sets the shielded pool address. Emits `PoolUpdated`.
    /// @dev Callable only by the contract owner.
    #[external(v0)]
    fn set_pool(ref self: ContractState, pool: ContractAddress) {
        self.ownable.assert_only_owner();
        self.pool.write(pool);
        self.emit(Event::PoolUpdated(PoolUpdated { pool }));
    }

    /// @notice Sets the bridge token address. Emits `TokenUpdated`.
    /// @dev Callable only by the contract owner.
    #[external(v0)]
    fn set_token(ref self: ContractState, token: ContractAddress) {
        self.ownable.assert_only_owner();
        self.token.write(token);
        self.emit(Event::TokenUpdated(TokenUpdated { token }));
    }

    /// @notice Pauses deposit forwarding. Emits `Paused`.
    /// @dev Callable only by the contract owner.
    #[external(v0)]
    fn pause(ref self: ContractState) {
        self.ownable.assert_only_owner();
        self.paused.write(true);
        self.emit(Event::Paused(Paused {}));
    }

    /// @notice Unpauses deposit forwarding. Emits `Unpaused`.
    /// @dev Callable only by the contract owner.
    #[external(v0)]
    fn unpause(ref self: ContractState) {
        self.ownable.assert_only_owner();
        self.paused.write(false);
        self.emit(Event::Unpaused(Unpaused {}));
    }

    /// @notice Forwards a bridge shadow deposit to the shielded pool.
    /// @dev Callable only by the operator or owner. Emits `DepositForwarded`.
    /// @param denom_id Denomination identifier for the deposit rule.
    /// @param note_commitment Poseidon commitment of the deposit note.
    /// @param ipfs_cid IPFS CID of the note metadata.
    #[external(v0)]
    fn deposit_shadow_note(
        ref self: ContractState,
        denom_id: felt252,
        note_commitment: felt252,
        ipfs_cid: felt252,
    ) {
        assert_not_paused(@self);
        assert_operator_or_owner(@self);
        let pool = self.pool.read();
        let token = self.token.read();
        assert!(!pool.is_zero(), "Pool required");
        assert!(!token.is_zero(), "Token required");
        assert!(denom_id != 0, "denom_id required");
        assert!(note_commitment != 0, "note_commitment required");

        let pool_dispatcher = IShieldedPoolV4Dispatcher { contract_address: pool };
        let amount = pool_dispatcher.fixed_amount(token, denom_id);
        assert!(amount.low != 0 || amount.high != 0, "Fixed amount not set");

        let token_dispatcher = IERC20Dispatcher { contract_address: token };
        let balance = token_dispatcher.balance_of(get_contract_address());
        assert!(balance >= amount, "Insufficient token balance");
        let allowance = token_dispatcher.allowance(get_contract_address(), pool);
        if allowance < amount {
            let approved = token_dispatcher.approve(pool, amount);
            assert!(approved, "Approve failed");
        }

        pool_dispatcher.deposit_fixed_v4(token, denom_id, note_commitment, ipfs_cid);
        self.emit(Event::DepositForwarded(DepositForwarded {
            pool,
            token,
            denom_id,
            note_commitment,
        }));
    }

    /// @notice Asserts caller is the contract owner via OZ OwnableComponent.
    fn assert_owner(self: @ContractState) {
        let caller = get_caller_address();
        assert!(caller == self.ownable.owner(), "Only owner");
    }

    /// @notice Asserts caller is the operator or the contract owner.
    fn assert_operator_or_owner(self: @ContractState) {
        let operator = self.operator.read();
        let caller = get_caller_address();
        assert!(caller == self.ownable.owner() || caller == operator, "Only operator");
    }

    /// @notice Asserts the contract is not paused.
    fn assert_not_paused(self: @ContractState) {
        assert!(!self.paused.read(), "Paused");
    }
}
