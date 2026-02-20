use starknet::ContractAddress;

// Defines mint/burn and role management for CAREL token.
// Protocol-controlled minting with a hard supply cap.
#[starknet::interface]
pub trait ICarelToken<TContractState> {
    // Applies mint after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn mint(ref self: TContractState, recipient: ContractAddress, amount: u256);
    // Implements burn logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn burn(ref self: TContractState, amount: u256);
    // Updates minter configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_minter(ref self: TContractState, address: ContractAddress);
    // Updates burner configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_burner(ref self: TContractState, address: ContractAddress);
}

// ZK privacy entrypoints for token actions.
#[starknet::interface]
pub trait ICarelTokenPrivacy<TContractState> {
    // Updates privacy router configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Applies submit private token action after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn submit_private_token_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

// ERC20 token with capped supply and role-based mint/burn.
// Uses OpenZeppelin ERC20 and AccessControl components.
#[starknet::contract]
pub mod CarelToken {
    use openzeppelin::token::erc20::{ERC20Component, ERC20HooksEmptyImpl};
    use openzeppelin::access::accesscontrol::{AccessControlComponent, DEFAULT_ADMIN_ROLE};
    use openzeppelin::introspection::src5::SRC5Component;
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::storage::*;
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_TOKEN;

    component!(path: ERC20Component, storage: erc20, event: ERC20Event);
    component!(path: AccessControlComponent, storage: accesscontrol, event: AccessControlEvent);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    impl ERC20HooksImpl = ERC20HooksEmptyImpl<ContractState>;

    #[abi(embed_v0)]
    impl ERC20MixinImpl = ERC20Component::ERC20MixinImpl<ContractState>;
    impl ERC20InternalImpl = ERC20Component::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl AccessControlImpl = AccessControlComponent::AccessControlImpl<ContractState>;
    impl AccessControlInternalImpl = AccessControlComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl SRC5Impl = SRC5Component::SRC5Impl<ContractState>;

    pub const MINTER_ROLE: felt252 = selector!("MINTER_ROLE");
    pub const BURNER_ROLE: felt252 = selector!("BURNER_ROLE");

    const ONE_TOKEN: u256 = 1_000_000_000_000_000_000_u256;
    const TOTAL_SUPPLY_CAP: u256 = 1_000_000_000_u256 * ONE_TOKEN; // 1B CAREL

    #[storage]
    pub struct Storage {
        #[substorage(v0)]
        erc20: ERC20Component::Storage,
        #[substorage(v0)]
        accesscontrol: AccessControlComponent::Storage,
        #[substorage(v0)]
        src5: SRC5Component::Storage,
        pub total_minted: u256,
        pub cap: u256,
        pub privacy_router: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        ERC20Event: ERC20Component::Event,
        #[flat]
        AccessControlEvent: AccessControlComponent::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    // Initializes the CAREL token contract.
    // Sets name/symbol, admin role, and total supply cap.
    // `multisig_admin` receives DEFAULT_ADMIN_ROLE at deployment.
    #[constructor]
    // Initializes storage and role configuration during deployment.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn constructor(ref self: ContractState, multisig_admin: ContractAddress) {
        let name: ByteArray = "Carel Protocol";
        let symbol: ByteArray = "CAREL";

        self.erc20.initializer(name, symbol);
        self.accesscontrol.initializer();
        self.accesscontrol._grant_role(DEFAULT_ADMIN_ROLE, multisig_admin);
        self.total_minted.write(0);
        self.cap.write(TOTAL_SUPPLY_CAP);
    }

    #[abi(embed_v0)]
    impl CarelTokenImpl of super::ICarelToken<ContractState> {
        // Applies mint after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            self.accesscontrol.assert_only_role(MINTER_ROLE);
            let new_total = self.total_minted.read() + amount;
            assert!(new_total <= self.cap.read(), "Total supply cap exceeded");
            self.total_minted.write(new_total);
            self.erc20.mint(recipient, amount);
        }

        // Implements burn logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn burn(ref self: ContractState, amount: u256) {
            self.accesscontrol.assert_only_role(BURNER_ROLE);
            let caller = get_caller_address();
            let total = self.total_minted.read();
            assert!(total >= amount, "Burn exceeds minted supply");
            self.total_minted.write(total - amount);
            self.erc20.burn(caller, amount);
        }

        // Updates minter configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_minter(ref self: ContractState, address: ContractAddress) {
            self.accesscontrol.assert_only_role(DEFAULT_ADMIN_ROLE);
            self.accesscontrol._grant_role(MINTER_ROLE, address);
        }

        // Updates burner configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_burner(ref self: ContractState, address: ContractAddress) {
            self.accesscontrol.assert_only_role(DEFAULT_ADMIN_ROLE);
            self.accesscontrol._grant_role(BURNER_ROLE, address);
        }
    }

    #[abi(embed_v0)]
    impl CarelTokenPrivacyImpl of super::ICarelTokenPrivacy<ContractState> {
        // Updates privacy router configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.accesscontrol.assert_only_role(DEFAULT_ADMIN_ROLE);
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Applies submit private token action after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn submit_private_token_action(
            ref self: ContractState,
            old_root: felt252,
            new_root: felt252,
            nullifiers: Span<felt252>,
            commitments: Span<felt252>,
            public_inputs: Span<felt252>,
            proof: Span<felt252>
        ) {
            let router = self.privacy_router.read();
            assert!(!router.is_zero(), "Privacy router not set");
            let dispatcher = IPrivacyRouterDispatcher { contract_address: router };
            dispatcher.submit_action(
                ACTION_TOKEN,
                old_root,
                new_root,
                nullifiers,
                commitments,
                public_inputs,
                proof
            );
        }
    }
}
