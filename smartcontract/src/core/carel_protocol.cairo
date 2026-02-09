use starknet::ContractAddress;

/// @title CAREL Protocol Interface
/// @author CAREL Team
/// @notice High-level protocol entrypoints for swaps and BTC staking.
/// @dev Lightweight interface for integrations and event emission.
#[starknet::interface]
pub trait ICarelProtocol<TContractState> {
    /// @notice Executes a swap within the protocol.
    /// @dev Emits a swap event for downstream accounting.
    /// @param amount Amount swapped.
    /// @param token_from Input token address.
    /// @param token_to Output token address.
    fn swap(ref self: TContractState, amount: u256, token_from: ContractAddress, token_to: ContractAddress);
    /// @notice Stakes BTC via a wrapper contract.
    /// @dev Emits a staking event for downstream accounting.
    /// @param amount Amount of BTC wrapper tokens to stake.
    /// @param wrapper Wrapper contract address.
    fn stake_btc(ref self: TContractState, amount: u256, wrapper: ContractAddress);
    /// @notice Returns currently active tokens.
    /// @dev Read-only helper for UI and routing.
    /// @return tokens Array of active token addresses.
    fn get_active_tokens(self: @TContractState) -> Array<ContractAddress>;
}

/// @title CAREL Protocol Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy entrypoints for protocol actions.
#[starknet::interface]
pub trait ICarelProtocolPrivacy<TContractState> {
    /// @notice Sets privacy router address (one-time init).
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private protocol action proof.
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

/// @title CAREL Protocol Contract
/// @author CAREL Team
/// @notice Event-first protocol facade for swaps and BTC staking.
/// @dev Emits events for analytics and off-chain processing.
#[starknet::contract]
pub mod CarelProtocol {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_PROTOCOL;

    #[storage]
    pub struct Storage {
        active_wrappers: Map<ContractAddress, bool>,
        supported_tokens: Vec<ContractAddress>,
        privacy_router: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        SwapExecuted: SwapExecuted,
        BTCStaked: BTCStaked,
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

    #[abi(embed_v0)]
    pub impl CarelProtocolImpl of super::ICarelProtocol<ContractState> {
        /// @notice Executes a swap within the protocol.
        /// @dev Emits a swap event for downstream accounting.
        /// @param amount Amount swapped.
        /// @param token_from Input token address.
        /// @param token_to Output token address.
        fn swap(ref self: ContractState, amount: u256, token_from: ContractAddress, token_to: ContractAddress) {
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

        /// @notice Stakes BTC via a wrapper contract.
        /// @dev Emits a staking event for downstream accounting.
        /// @param amount Amount of BTC wrapper tokens to stake.
        /// @param wrapper Wrapper contract address.
        fn stake_btc(ref self: ContractState, amount: u256, wrapper: ContractAddress) {
            let caller = get_caller_address();
            let ts = get_block_timestamp();

            self.emit(Event::BTCStaked(BTCStaked { 
                user: caller, 
                amount, 
                wrapper, 
                timestamp: ts 
            }));
        }

        /// @notice Returns currently active tokens.
        /// @dev Read-only helper for UI and routing.
        /// @return tokens Array of active token addresses.
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
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(!router.is_zero(), "Privacy router required");
            let current = self.privacy_router.read();
            assert!(current.is_zero(), "Privacy router already set");
            self.privacy_router.write(router);
        }

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
