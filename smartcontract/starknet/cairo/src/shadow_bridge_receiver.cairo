#[starknet::contract]
mod shadow_bridge_receiver {
    use core::num::traits::Zero;
    use starknet::{
        ContractAddress, get_caller_address, get_contract_address,
    };
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

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

    #[storage]
    struct Storage {
        owner: ContractAddress,
        operator: ContractAddress,
        pool: ContractAddress,
        token: ContractAddress,
        paused: bool,
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
    }

    #[derive(Drop, starknet::Event)]
    struct OperatorUpdated {
        operator: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct PoolUpdated {
        pool: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct TokenUpdated {
        token: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct Paused {}

    #[derive(Drop, starknet::Event)]
    struct Unpaused {}

    #[derive(Drop, starknet::Event)]
    struct DepositForwarded {
        pool: ContractAddress,
        token: ContractAddress,
        denom_id: felt252,
        note_commitment: felt252,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        operator: ContractAddress,
        pool: ContractAddress,
        token: ContractAddress,
    ) {
        self.owner.write(owner);
        self.operator.write(operator);
        self.pool.write(pool);
        self.token.write(token);
        self.paused.write(false);
    }

    #[external(v0)]
    fn set_operator(ref self: ContractState, operator: ContractAddress) {
        assert_owner(@self);
        self.operator.write(operator);
        self.emit(Event::OperatorUpdated(OperatorUpdated { operator }));
    }

    #[external(v0)]
    fn set_pool(ref self: ContractState, pool: ContractAddress) {
        assert_owner(@self);
        self.pool.write(pool);
        self.emit(Event::PoolUpdated(PoolUpdated { pool }));
    }

    #[external(v0)]
    fn set_token(ref self: ContractState, token: ContractAddress) {
        assert_owner(@self);
        self.token.write(token);
        self.emit(Event::TokenUpdated(TokenUpdated { token }));
    }

    #[external(v0)]
    fn pause(ref self: ContractState) {
        assert_owner(@self);
        self.paused.write(true);
        self.emit(Event::Paused(Paused {}));
    }

    #[external(v0)]
    fn unpause(ref self: ContractState) {
        assert_owner(@self);
        self.paused.write(false);
        self.emit(Event::Unpaused(Unpaused {}));
    }

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

    fn assert_owner(self: @ContractState) {
        let owner = self.owner.read();
        let caller = get_caller_address();
        assert!(caller == owner, "Only owner");
    }

    fn assert_operator_or_owner(self: @ContractState) {
        let owner = self.owner.read();
        let operator = self.operator.read();
        let caller = get_caller_address();
        assert!(caller == owner || caller == operator, "Only operator");
    }

    fn assert_not_paused(self: @ContractState) {
        assert!(!self.paused.read(), "Paused");
    }
}
