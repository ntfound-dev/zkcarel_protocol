use starknet::ContractAddress;

/// @title IPointToken
/// @notice Admin-controlled minting interface for the non-transferable point token.
#[starknet::interface]
pub trait IPointToken<TContractState> {
    /// @notice Mints `amount` point tokens to `recipient`.
    /// @dev Callable only by the contract owner.
    /// @param recipient Address to receive the minted tokens.
    /// @param amount Number of tokens to mint.
    fn mint_points(ref self: TContractState, recipient: ContractAddress, amount: u256);
}

/// @title PointToken
/// @notice ERC20-compatible point token with transfer disabled.
///         Only mint and burn are permitted; peer-to-peer transfers always revert.
#[starknet::contract]
pub mod PointToken {
    use openzeppelin::introspection::src5::SRC5Component;
    use openzeppelin::token::erc20::ERC20Component;
    use openzeppelin::access::ownable::OwnableComponent;
    use starknet::storage::*;
    use starknet::ContractAddress;
    use core::num::traits::Zero;

    component!(path: ERC20Component, storage: erc20, event: ERC20Event);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);
    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    /// @dev Disables transfers while permitting mint (from == zero) and burn (to == zero).
    impl ERC20HooksImpl of ERC20Component::ERC20HooksTrait<ContractState> {
        fn before_update(
            ref self: ERC20Component::ComponentState<ContractState>,
            from: ContractAddress,
            recipient: ContractAddress,
            amount: u256
        ) {
            let _ = amount;
            let is_mint_or_burn = from.is_zero() || recipient.is_zero();
            assert!(is_mint_or_burn, "Point token non-transferable");
        }

        fn after_update(
            ref self: ERC20Component::ComponentState<ContractState>,
            from: ContractAddress,
            recipient: ContractAddress,
            amount: u256
        ) {
            let _ = from;
            let _ = recipient;
            let _ = amount;
        }
    }

    #[abi(embed_v0)]
    impl ERC20MixinImpl = ERC20Component::ERC20MixinImpl<ContractState>;
    impl ERC20InternalImpl = ERC20Component::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl SRC5Impl = SRC5Component::SRC5Impl<ContractState>;

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        #[substorage(v0)]
        erc20: ERC20Component::Storage,
        #[substorage(v0)]
        src5: SRC5Component::Storage,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        ERC20Event: ERC20Component::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    /// @notice Initializes the ERC20 token and sets the initial owner.
    /// @param admin Initial owner address (two-step transfer via OZ OwnableComponent).
    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        let name: ByteArray = "Point";
        let symbol: ByteArray = "PT";
        self.erc20.initializer(name, symbol);
        self.ownable.initializer(admin);
    }

    #[abi(embed_v0)]
    impl PointTokenImpl of super::IPointToken<ContractState> {
        /// @inheritdoc IPointToken
        fn mint_points(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            self.ownable.assert_only_owner();
            self.erc20.mint(recipient, amount);
        }
    }
}
