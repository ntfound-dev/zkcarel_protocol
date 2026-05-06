use starknet::ContractAddress;

/// @title IMultiFaucet
/// @notice Admin interface for the CAREL multi-token testnet faucet.
#[starknet::interface]
pub trait IMultiFaucet<TContractState> {
    /// @notice Drips a configured amount of `token` to `recipient`. Callable by the backend relayer only.
    /// @param token ERC20 token address to drip.
    /// @param recipient Address that receives the tokens.
    fn drip(ref self: TContractState, token: ContractAddress, recipient: ContractAddress);

    /// @notice Sets the drip amount for a token. Pass `0` to effectively disable it.
    /// @param token ERC20 token address.
    /// @param amount Amount to send per drip call.
    fn set_token_drip_amount(ref self: TContractState, token: ContractAddress, amount: u256);

    /// @notice Removes a token from the supported list by setting its drip amount to zero.
    /// @param token ERC20 token address to remove.
    fn remove_token(ref self: TContractState, token: ContractAddress);

    /// @notice Updates the backend relayer address authorized to call `drip`.
    /// @param relayer New relayer address (must be non-zero).
    fn set_backend_relayer(ref self: TContractState, relayer: ContractAddress);

    /// @notice Withdraws any remaining token balance from the faucet contract.
    /// @param token ERC20 token address to withdraw.
    /// @param to Recipient address for the withdrawn tokens.
    /// @param amount Amount to withdraw.
    fn withdraw_leftover(
        ref self: TContractState, token: ContractAddress, to: ContractAddress, amount: u256
    );

    /// @notice Returns the configured drip amount for a token.
    /// @param token ERC20 token address.
    /// @return Drip amount; `0` means the token is not supported.
    fn get_token_drip_amount(self: @TContractState, token: ContractAddress) -> u256;

    /// @notice Returns the current backend relayer address.
    /// @return Relayer contract address.
    fn get_backend_relayer(self: @TContractState) -> ContractAddress;
}

/// @title CarelMultiFaucet
/// @notice Testnet faucet that distributes multiple ERC20 tokens with a per-recipient cooldown.
///         Only the configured backend relayer may call `drip`; all admin functions are owner-gated.
#[starknet::contract]
pub mod CarelMultiFaucet {
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use starknet::storage::*;
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address};
    use super::IMultiFaucet;

    /// @dev One drip per recipient per token per 24 hours.
    const COOLDOWN_SECONDS: u64 = 86400;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
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

    /// @notice Emitted when tokens are successfully dripped to a recipient.
    #[derive(Drop, starknet::Event)]
    pub struct Dripped {
        pub token: ContractAddress,
        pub recipient: ContractAddress,
        pub amount: u256,
    }

    /// @notice Emitted when a token's drip amount is configured.
    #[derive(Drop, starknet::Event)]
    pub struct TokenDripAmountSet {
        pub token: ContractAddress,
        pub amount: u256,
    }

    /// @notice Emitted when a token is removed from the supported list.
    #[derive(Drop, starknet::Event)]
    pub struct TokenRemoved {
        pub token: ContractAddress,
    }

    /// @notice Emitted when the backend relayer address is updated.
    #[derive(Drop, starknet::Event)]
    pub struct RelayerUpdated {
        pub relayer: ContractAddress,
    }

    /// @notice Emitted when leftover tokens are withdrawn by the owner.
    #[derive(Drop, starknet::Event)]
    pub struct Withdrawn {
        pub token: ContractAddress,
        pub to: ContractAddress,
        pub amount: u256,
    }

    /// @notice Initializes the faucet with an owner and backend relayer.
    /// @param owner Initial contract owner (two-step transfer via OZ OwnableComponent).
    /// @param relayer Backend relayer address authorized to call `drip`.
    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, relayer: ContractAddress) {
        assert!(!owner.is_zero(), "Owner required");
        assert!(!relayer.is_zero(), "Relayer required");
        self.ownable.initializer(owner);
        self.backend_relayer.write(relayer);
    }

    #[abi(embed_v0)]
    impl MultiFaucetImpl of IMultiFaucet<ContractState> {
        /// @inheritdoc IMultiFaucet
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

        /// @inheritdoc IMultiFaucet
        fn set_token_drip_amount(ref self: ContractState, token: ContractAddress, amount: u256) {
            self.ownable.assert_only_owner();
            self.token_drip_amounts.entry(token).write(amount);
            self.emit(Event::TokenDripAmountSet(TokenDripAmountSet { token, amount }));
        }

        /// @inheritdoc IMultiFaucet
        fn remove_token(ref self: ContractState, token: ContractAddress) {
            self.ownable.assert_only_owner();
            self.token_drip_amounts.entry(token).write(0);
            self.emit(Event::TokenRemoved(TokenRemoved { token }));
        }

        /// @inheritdoc IMultiFaucet
        fn set_backend_relayer(ref self: ContractState, relayer: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!relayer.is_zero(), "Relayer required");
            self.backend_relayer.write(relayer);
            self.emit(Event::RelayerUpdated(RelayerUpdated { relayer }));
        }

        /// @inheritdoc IMultiFaucet
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

        /// @inheritdoc IMultiFaucet
        fn get_token_drip_amount(self: @ContractState, token: ContractAddress) -> u256 {
            self.token_drip_amounts.entry(token).read()
        }

        /// @inheritdoc IMultiFaucet
        fn get_backend_relayer(self: @ContractState) -> ContractAddress {
            self.backend_relayer.read()
        }
    }
}
