use starknet::ContractAddress;

/// @notice High-level protocol entrypoints for swaps and BTC staking.
/// @dev Lightweight interface for integrations and event emission.
#[starknet::interface]
pub trait ICarelProtocol<TContractState> {
    /// @notice Executes a token swap and emits a SwapExecuted event.
    /// @param amount Number of tokens to swap (must be > 0).
    /// @param token_from Source token address (must be non-zero).
    /// @param token_to Destination token address (must be non-zero).
    fn swap(ref self: TContractState, amount: u256, token_from: ContractAddress, token_to: ContractAddress);

    /// @notice Stakes wrapped BTC and emits a BTCStaked event.
    /// @param amount Amount of BTC to stake (must be > 0).
    /// @param wrapper Wrapper contract address (must be non-zero).
    fn stake_btc(ref self: TContractState, amount: u256, wrapper: ContractAddress);

    /// @notice Returns all currently active token wrapper addresses.
    /// @return Array of active wrapper contract addresses.
    fn get_active_tokens(self: @TContractState) -> Array<ContractAddress>;
}

/// @notice ZK privacy entrypoints for protocol actions.
#[starknet::interface]
pub trait ICarelProtocolPrivacy<TContractState> {
    /// @notice Sets the privacy router contract address.
    /// @dev Only callable by owner.
    /// @param router Address of the deployed privacy router (must be non-zero).
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);

    /// @notice Submits a ZK-proven private protocol action to the privacy router.
    /// @param old_root Merkle root before this action.
    /// @param new_root Merkle root after this action.
    /// @param nullifiers Span of nullifiers preventing double-spend.
    /// @param commitments Span of new Pedersen commitments.
    /// @param public_inputs Public inputs consumed by the ZK verifier.
    /// @param proof Serialised ZK proof bytes.
    fn submit_private_protocol_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @notice Event-first protocol facade for swaps and BTC staking.
/// @dev Emits events for analytics and off-chain processing.
#[starknet::contract]
pub mod CarelProtocol {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use core::num::traits::Zero;
    use core::traits::TryInto;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_PROTOCOL;
    use openzeppelin::access::ownable::OwnableComponent;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        active_wrappers: Map<ContractAddress, bool>,
        supported_tokens: Vec<ContractAddress>,
        privacy_router: ContractAddress,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        SwapExecuted: SwapExecuted,
        BTCStaked: BTCStaked,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SwapExecuted {
        #[key]
        pub user: ContractAddress,
        pub amount: u256,
        pub token_from: ContractAddress,
        pub token_to: ContractAddress,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BTCStaked {
        #[key]
        pub user: ContractAddress,
        pub amount: u256,
        pub wrapper: ContractAddress,
        pub timestamp: u64,
    }

    /// @notice Initializes the protocol facade.
    /// @param owner Address that becomes the two-step owner.
    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.ownable.initializer(owner);
    }

    #[abi(embed_v0)]
    pub impl CarelProtocolImpl of super::ICarelProtocol<ContractState> {
        /// @notice Executes a token swap and emits a SwapExecuted event.
        /// @dev Validates amount > 0 and non-zero token addresses before emitting.
        /// @param amount Number of tokens to swap.
        /// @param token_from Source token address.
        /// @param token_to Destination token address.
        fn swap(ref self: ContractState, amount: u256, token_from: ContractAddress, token_to: ContractAddress) {
            assert!(amount > 0, "Amount required");
            assert!(!token_from.is_zero(), "token_from required");
            assert!(!token_to.is_zero(), "token_to required");

            let caller = get_caller_address();
            let ts = get_block_timestamp();

            self.emit(Event::SwapExecuted(SwapExecuted {
                user: caller,
                amount,
                token_from,
                token_to,
                timestamp: ts
            }));
        }

        /// @notice Stakes wrapped BTC and emits a BTCStaked event.
        /// @dev Validates amount > 0 and non-zero wrapper address before emitting.
        /// @param amount Amount of BTC to stake.
        /// @param wrapper Wrapper contract address.
        fn stake_btc(ref self: ContractState, amount: u256, wrapper: ContractAddress) {
            assert!(amount > 0, "Amount required");
            assert!(!wrapper.is_zero(), "Wrapper required");

            let caller = get_caller_address();
            let ts = get_block_timestamp();

            self.emit(Event::BTCStaked(BTCStaked {
                user: caller,
                amount,
                wrapper,
                timestamp: ts
            }));
        }

        /// @notice Returns all currently active token wrapper addresses.
        /// @return Array of active wrapper contract addresses.
        fn get_active_tokens(self: @ContractState) -> Array<ContractAddress> {
            let mut active = array![];
            for i in 0..self.supported_tokens.len() {
                let token = self.supported_tokens.at(i).read();
                if self.active_wrappers.entry(token).read() {
                    active.append(token);
                }
            };
            active
        }
    }

    #[abi(embed_v0)]
    impl CarelProtocolPrivacyImpl of super::ICarelProtocolPrivacy<ContractState> {
        /// @notice Sets the privacy router contract address.
        /// @dev Only callable by owner. Router must be non-zero.
        /// @param router Address of the deployed privacy router.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        /// @notice Submits a ZK-proven private protocol action to the privacy router.
        /// @param old_root Merkle root before this action.
        /// @param new_root Merkle root after this action.
        /// @param nullifiers Span of nullifiers preventing double-spend.
        /// @param commitments Span of new Pedersen commitments.
        /// @param public_inputs Public inputs consumed by the ZK verifier.
        /// @param proof Serialised ZK proof bytes.
        fn submit_private_protocol_action(
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
                ACTION_PROTOCOL,
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
