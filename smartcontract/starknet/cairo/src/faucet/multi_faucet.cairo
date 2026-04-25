use starknet::ContractAddress;

#[starknet::interface]
pub trait IMultiFaucet<TContractState> {
    fn drip(ref self: TContractState, token: ContractAddress, recipient: ContractAddress);
    fn set_token_drip_amount(ref self: TContractState, token: ContractAddress, amount: u256);
    fn remove_token(ref self: TContractState, token: ContractAddress);
    fn set_backend_relayer(ref self: TContractState, relayer: ContractAddress);
    fn withdraw_leftover(
        ref self: TContractState, token: ContractAddress, to: ContractAddress, amount: u256
    );
    fn get_token_drip_amount(self: @TContractState, token: ContractAddress) -> u256;
    fn get_backend_relayer(self: @TContractState) -> ContractAddress;
}

#[starknet::contract]
pub mod CarelMultiFaucet {
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use starknet::storage::*;
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address};
    use super::IMultiFaucet;

    const COOLDOWN_SECONDS: u64 = 86400;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub backend_relayer: ContractAddress,
        pub token_drip_amounts: Map<ContractAddress, u256>,
        pub last_drip: Map<(ContractAddress, ContractAddress), u64>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Dripped: Dripped,
        TokenDripAmountSet: TokenDripAmountSet,
        TokenRemoved: TokenRemoved,
        RelayerUpdated: RelayerUpdated,
        Withdrawn: Withdrawn,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Dripped {
        pub token: ContractAddress,
        pub recipient: ContractAddress,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TokenDripAmountSet {
        pub token: ContractAddress,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TokenRemoved {
        pub token: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RelayerUpdated {
        pub relayer: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Withdrawn {
        pub token: ContractAddress,
        pub to: ContractAddress,
        pub amount: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, relayer: ContractAddress) {
        assert!(!owner.is_zero(), "Owner required");
        assert!(!relayer.is_zero(), "Relayer required");
        self.ownable.initializer(owner);
        self.backend_relayer.write(relayer);
    }

    #[abi(embed_v0)]
    impl MultiFaucetImpl of IMultiFaucet<ContractState> {
        fn drip(ref self: ContractState, token: ContractAddress, recipient: ContractAddress) {
            let caller = get_caller_address();
            assert!(caller == self.backend_relayer.read(), "Unauthorized relayer");
            assert!(!recipient.is_zero(), "Recipient required");

            let amount = self.token_drip_amounts.entry(token).read();
            assert!(amount > 0, "Token not supported");

            let now = get_block_timestamp();
            let key = (token, recipient);
            let last = self.last_drip.entry(key).read();
            if last != 0 {
                assert!(now >= last + COOLDOWN_SECONDS, "Cooldown");
            }

            let erc20 = IERC20Dispatcher { contract_address: token };
            let success = erc20.transfer(recipient, amount);
            assert!(success, "Transfer failed");

            self.last_drip.entry(key).write(now);
            self.emit(Event::Dripped(Dripped { token, recipient, amount }));
        }

        fn set_token_drip_amount(ref self: ContractState, token: ContractAddress, amount: u256) {
            self.ownable.assert_only_owner();
            self.token_drip_amounts.entry(token).write(amount);
            self.emit(Event::TokenDripAmountSet(TokenDripAmountSet { token, amount }));
        }

        fn remove_token(ref self: ContractState, token: ContractAddress) {
            self.ownable.assert_only_owner();
            self.token_drip_amounts.entry(token).write(0);
            self.emit(Event::TokenRemoved(TokenRemoved { token }));
        }

        fn set_backend_relayer(ref self: ContractState, relayer: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!relayer.is_zero(), "Relayer required");
            self.backend_relayer.write(relayer);
            self.emit(Event::RelayerUpdated(RelayerUpdated { relayer }));
        }

        fn withdraw_leftover(
            ref self: ContractState,
            token: ContractAddress,
            to: ContractAddress,
            amount: u256,
        ) {
            self.ownable.assert_only_owner();
            assert!(!to.is_zero(), "Recipient required");
            let erc20 = IERC20Dispatcher { contract_address: token };
            let success = erc20.transfer(to, amount);
            assert!(success, "Transfer failed");
            self.emit(Event::Withdrawn(Withdrawn { token, to, amount }));
        }

        fn get_token_drip_amount(self: @ContractState, token: ContractAddress) -> u256 {
            self.token_drip_amounts.entry(token).read()
        }

        fn get_backend_relayer(self: @ContractState) -> ContractAddress {
            self.backend_relayer.read()
        }
    }
}
