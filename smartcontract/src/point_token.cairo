use starknet::ContractAddress;

/// @title Point Token Interface
/// @notice ERC20 point token with admin-only minting.
#[starknet::interface]
pub trait IPointToken<TContractState> {
    /// @notice Mint points to a recipient.
    /// @dev Callable only by admin_address in storage.
    fn mint_points(ref self: TContractState, recipient: ContractAddress, amount: u256);
}

/// @title Point Token
/// @notice ERC20 token used for bridge reward points.
#[starknet::contract]
pub mod PointToken {
    use openzeppelin::introspection::src5::SRC5Component;
    use openzeppelin::token::erc20::{ERC20Component, ERC20HooksEmptyImpl};
    use starknet::storage::*;
    use starknet::{ContractAddress, get_caller_address};

    component!(path: ERC20Component, storage: erc20, event: ERC20Event);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    impl ERC20HooksImpl = ERC20HooksEmptyImpl<ContractState>;

    #[abi(embed_v0)]
    impl ERC20MixinImpl = ERC20Component::ERC20MixinImpl<ContractState>;
    impl ERC20InternalImpl = ERC20Component::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl SRC5Impl = SRC5Component::SRC5Impl<ContractState>;

    #[storage]
    pub struct Storage {
        #[substorage(v0)]
        erc20: ERC20Component::Storage,
        #[substorage(v0)]
        src5: SRC5Component::Storage,
        pub admin_address: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        ERC20Event: ERC20Component::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin_address: ContractAddress) {
        let name: ByteArray = "Point";
        let symbol: ByteArray = "PT";

        self.erc20.initializer(name, symbol);
        self.admin_address.write(admin_address);
    }

    #[abi(embed_v0)]
    impl PointTokenImpl of super::IPointToken<ContractState> {
        fn mint_points(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            assert!(get_caller_address() == self.admin_address.read(), "Unauthorized");
            self.erc20.mint(recipient, amount);
        }
    }
}
