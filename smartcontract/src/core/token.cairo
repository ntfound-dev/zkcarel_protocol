use starknet::ContractAddress;

/// @title CAREL Token Interface
/// @author CAREL Team
/// @notice Defines mint/burn and role management for CAREL token.
/// @dev Protocol-controlled minting with a hard supply cap.
#[starknet::interface]
pub trait ICarelToken<TContractState> {
    /// @notice Mints CAREL to a recipient.
    /// @dev Restricted to MINTER_ROLE to enforce supply cap.
    /// @param recipient Address receiving minted tokens.
    /// @param amount Amount to mint (18 decimals).
    fn mint(ref self: TContractState, recipient: ContractAddress, amount: u256);
    /// @notice Burns CAREL from the caller.
    /// @dev Restricted to BURNER_ROLE to prevent unauthorized burns.
    /// @param amount Amount to burn (18 decimals).
    fn burn(ref self: TContractState, amount: u256);
    /// @notice Grants MINTER_ROLE to an address.
    /// @dev Admin-only to keep minting authority controlled.
    /// @param address Address to grant minter role.
    fn set_minter(ref self: TContractState, address: ContractAddress);
    /// @notice Grants BURNER_ROLE to an address.
    /// @dev Admin-only to keep burning authority controlled.
    /// @param address Address to grant burner role.
    fn set_burner(ref self: TContractState, address: ContractAddress);
}

/// @title CAREL Token Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy entrypoints for token actions.
#[starknet::interface]
pub trait ICarelTokenPrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private token action proof.
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

/// @title CAREL Token Contract
/// @author CAREL Team
/// @notice ERC20 token with capped supply and role-based mint/burn.
/// @dev Uses OpenZeppelin ERC20 and AccessControl components.
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

    /// @notice Initializes the CAREL token contract.
    /// @dev Sets name/symbol, admin role, and total supply cap.
    /// @param multisig_admin Address receiving DEFAULT_ADMIN_ROLE.
    #[constructor]
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
        /// @notice Mints CAREL to a recipient.
        /// @dev Restricted to MINTER_ROLE to enforce supply cap.
        /// @param recipient Address receiving minted tokens.
        /// @param amount Amount to mint (18 decimals).
        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            self.accesscontrol.assert_only_role(MINTER_ROLE);
            let new_total = self.total_minted.read() + amount;
            assert!(new_total <= self.cap.read(), "Total supply cap exceeded");
            self.total_minted.write(new_total);
            self.erc20.mint(recipient, amount);
        }

        /// @notice Burns CAREL from the caller.
        /// @dev Restricted to BURNER_ROLE to prevent unauthorized burns.
        /// @param amount Amount to burn (18 decimals).
        fn burn(ref self: ContractState, amount: u256) {
            self.accesscontrol.assert_only_role(BURNER_ROLE);
            let caller = get_caller_address();
            let total = self.total_minted.read();
            assert!(total >= amount, "Burn exceeds minted supply");
            self.total_minted.write(total - amount);
            self.erc20.burn(caller, amount);
        }

        /// @notice Grants MINTER_ROLE to an address.
        /// @dev Admin-only to keep minting authority controlled.
        /// @param address Address to grant minter role.
        fn set_minter(ref self: ContractState, address: ContractAddress) {
            self.accesscontrol.assert_only_role(DEFAULT_ADMIN_ROLE);
            self.accesscontrol._grant_role(MINTER_ROLE, address);
        }

        /// @notice Grants BURNER_ROLE to an address.
        /// @dev Admin-only to keep burning authority controlled.
        /// @param address Address to grant burner role.
        fn set_burner(ref self: ContractState, address: ContractAddress) {
            self.accesscontrol.assert_only_role(DEFAULT_ADMIN_ROLE);
            self.accesscontrol._grant_role(BURNER_ROLE, address);
        }
    }

    #[abi(embed_v0)]
    impl CarelTokenPrivacyImpl of super::ICarelTokenPrivacy<ContractState> {
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.accesscontrol.assert_only_role(DEFAULT_ADMIN_ROLE);
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

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
