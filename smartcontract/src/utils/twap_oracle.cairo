use starknet::ContractAddress;

// TWAP oracle API for smoothed pricing reads.
// Maintains rolling observations for manipulation-resistant references.
#[starknet::interface]
pub trait ITWAPOracle<TContractState> {
    // Adds a new price observation for TWAP calculation.
    fn update_observation(ref self: TContractState, token: ContractAddress, price: u256);
    // Returns current TWAP value for asset pair.
    fn get_twap(self: @TContractState, token: ContractAddress, period: u64) -> u256;
    // Returns latest spot price observation.
    fn get_spot_price(self: @TContractState, token: ContractAddress) -> u256;
    // Returns deviation between spot price and TWAP.
    fn get_price_deviation(self: @TContractState, token: ContractAddress) -> u256;
}

// Hide Mode hooks for private TWAP updates.
#[starknet::interface]
pub trait ITWAPOraclePrivacy<TContractState> {
    // Sets privacy router used for Hide Mode actions.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Forwards private TWAP payload to privacy router.
    fn submit_private_twap_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

// TWAP oracle implementation using cumulative sum and observation count.
#[starknet::contract]
pub mod TWAPOracle {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_TWAP;

    #[derive(Copy, Drop, Serde, starknet::Store)]
    pub struct TwapState {
        pub running_sum: u256,
        pub count: u64,
        pub last_price: u256,
    }

    #[storage]
    pub struct Storage {
        pub twap_state: Map<ContractAddress, TwapState>,
        pub observation_window: u64,
        pub min_observations: u256,
        pub privacy_router: ContractAddress,
    }

    // Initializes default observation window and minimum sample requirement.
    #[constructor]
    fn constructor(ref self: ContractState) {
        self.observation_window.write(1800);
        self.min_observations.write(10);
    }

    #[abi(embed_v0)]
    pub impl TWAPOracleImpl of super::ITWAPOracle<ContractState> {
        // Adds a new price observation for TWAP calculation.
        fn update_observation(ref self: ContractState, token: ContractAddress, price: u256) {
            let mut state = self.twap_state.entry(token).read();
            state.running_sum += price;
            state.count += 1;
            state.last_price = price;
            self.twap_state.entry(token).write(state);
        }

        // Returns current TWAP value for asset pair.
        fn get_twap(self: @ContractState, token: ContractAddress, period: u64) -> u256 {
            let state = self.twap_state.entry(token).read();
            let count = state.count;
            assert!(count.into() >= self.min_observations.read(), "Insufficient observations");
            assert!(period > 0, "Invalid period");
            state.running_sum / count.into()
        }

        // Returns latest spot price observation.
        fn get_spot_price(self: @ContractState, token: ContractAddress) -> u256 {
            let state = self.twap_state.entry(token).read();
            assert!(state.count > 0, "No observations found");
            state.last_price
        }

        // Returns deviation between spot price and TWAP.
        fn get_price_deviation(self: @ContractState, token: ContractAddress) -> u256 {
            let spot = self.get_spot_price(token);
            let twap = self.get_twap(token, self.observation_window.read());
            
            if spot > twap {
                spot - twap
            } else {
                twap - spot
            }
        }
    }

    #[abi(embed_v0)]
    impl TWAPOraclePrivacyImpl of super::ITWAPOraclePrivacy<ContractState> {
        // Sets privacy router used for Hide Mode TWAP actions.
        // This contract allows one-time router wiring.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(!router.is_zero(), "Privacy router required");
            let current = self.privacy_router.read();
            assert!(current.is_zero(), "Privacy router already set");
            self.privacy_router.write(router);
        }

        // Relays private TWAP payload for proof verification and execution.
        // `nullifiers` prevent replay and `commitments` bind intended update state.
        fn submit_private_twap_action(
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
                ACTION_TWAP,
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
