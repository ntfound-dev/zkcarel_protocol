use starknet::ContractAddress;

/// @title IMockERC20
/// @notice Minimal admin-mint interface for testnet liquidity tokens (USDC/USDT/WBTC mocks).
#[starknet::interface]
pub trait IMockERC20<TContractState> {
    /// @notice Mints `amount` tokens to `recipient`. Callable by the contract owner only.
    /// @param recipient Address that receives the minted tokens.
    /// @param amount Amount of tokens to mint.
    fn mint(ref self: TContractState, recipient: ContractAddress, amount: u256);
}

/// @title MockERC20
/// @notice ERC20 token with configurable decimals for USDC/USDT/WBTC testnet setup.
///         Supports owner-gated minting for faucet and test distribution.
#[starknet::contract]
pub mod MockERC20 {
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::token::erc20::interface;
    use openzeppelin::token::erc20::{ERC20Component, ERC20HooksEmptyImpl};
    use starknet::storage::*;
    use starknet::ContractAddress;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: ERC20Component, storage: erc20, event: ERC20Event);

    impl ERC20HooksImpl = ERC20HooksEmptyImpl<ContractState>;

    #[abi(embed_v0)]
    impl OwnableMixinImpl = OwnableComponent::OwnableMixinImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl ERC20Impl = ERC20Component::ERC20Impl<ContractState>;
    #[abi(embed_v0)]
    impl ERC20CamelOnlyImpl = ERC20Component::ERC20CamelOnlyImpl<ContractState>;
    impl ERC20InternalImpl = ERC20Component::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        pub erc20: ERC20Component::Storage,
        pub decimals: u8,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        ERC20Event: ERC20Component::Event,
    }

    /// @notice Deploys the mock token with an initial supply minted to `recipient`.
    /// @param name Token name (e.g. "Mock USDC").
    /// @param symbol Token symbol (e.g. "USDC").
    /// @param decimals Token decimals (e.g. 6 for USDC, 8 for WBTC, 18 for USDT).
    /// @param owner Address authorized to call `mint` post-deploy.
    /// @param initial_supply Amount minted to `recipient` at construction.
    /// @param recipient Address that receives the initial supply.
    #[constructor]
    fn constructor(
        ref self: ContractState,
        name: ByteArray,
        symbol: ByteArray,
        decimals: u8,
        owner: ContractAddress,
        initial_supply: u256,
        recipient: ContractAddress,
    ) {
        self.ownable.initializer(owner);
        self.decimals.write(decimals);
        self.erc20.initializer(name, symbol);
        self.erc20.mint(recipient, initial_supply);
    }

    #[abi(embed_v0)]
    impl ERC20MetadataImpl of interface::IERC20Metadata<ContractState> {
        fn name(self: @ContractState) -> ByteArray {
            self.erc20.name()
        }
        fn symbol(self: @ContractState) -> ByteArray {
            self.erc20.symbol()
        }
        /// @notice Returns the token's decimal precision, set at construction.
        fn decimals(self: @ContractState) -> u8 {
            self.decimals.read()
        }
    }

    #[abi(embed_v0)]
    impl MockERC20Impl of super::IMockERC20<ContractState> {
        /// @inheritdoc IMockERC20
        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            self.ownable.assert_only_owner();
            self.erc20.mint(recipient, amount);
        }
    }
}
