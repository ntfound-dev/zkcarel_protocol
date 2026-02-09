use starknet::ContractAddress;

/// @title TWAP Oracle Interface
/// @author CAREL Team
/// @notice Defines time-weighted average price entrypoints.
/// @dev Designed for low-manipulation pricing in protocol logic.
#[starknet::interface]
pub trait ITWAPOracle<TContractState> {
    /// @notice Records a new price observation.
    /// @dev Used to build TWAP history over time.
    /// @param token Token address.
    /// @param price Observed spot price.
    fn update_observation(ref self: TContractState, token: ContractAddress, price: u256);
    /// @notice Returns the TWAP for a token over a period.
    /// @dev Requires sufficient observations to prevent manipulation.
    /// @param token Token address.
    /// @param period Time window in seconds.
    /// @return twap Time-weighted average price.
    fn get_twap(self: @TContractState, token: ContractAddress, period: u64) -> u256;
    /// @notice Returns the latest spot price for a token.
    /// @dev Read-only helper for monitoring.
    /// @param token Token address.
    /// @return price Latest spot price.
    fn get_spot_price(self: @TContractState, token: ContractAddress) -> u256;
    /// @notice Returns the absolute deviation between spot and TWAP.
    /// @dev Useful for detecting potential manipulation.
    /// @param token Token address.
    /// @return deviation Absolute deviation value.
    fn get_price_deviation(self: @TContractState, token: ContractAddress) -> u256;
}

/// @title TWAP Oracle Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy entrypoints for TWAP updates.
#[starknet::interface]
pub trait ITWAPOraclePrivacy<TContractState> {
    /// @notice Sets privacy router address (one-time init).
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private TWAP update proof.
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

/// @title TWAP Oracle Contract
/// @author CAREL Team
/// @notice Stores observations and computes TWAP pricing.
/// @dev Uses cumulative pricing to compute time-weighted averages.
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

    /// @notice Initializes the TWAP oracle.
    /// @dev Sets default observation window and minimum observations.
    #[constructor]
    fn constructor(ref self: ContractState) {
        self.observation_window.write(1800);
        self.min_observations.write(10);
    }

    #[abi(embed_v0)]
    pub impl TWAPOracleImpl of super::ITWAPOracle<ContractState> {
        /// @notice Records a new price observation.
        /// @dev Builds cumulative price history for TWAP.
        /// @param token Token address.
        /// @param price Observed spot price.
        fn update_observation(ref self: ContractState, token: ContractAddress, price: u256) {
            let mut state = self.twap_state.entry(token).read();
            state.running_sum += price;
            state.count += 1;
            state.last_price = price;
            self.twap_state.entry(token).write(state);
        }

        /// @notice Returns the TWAP for a token over a period.
        /// @dev Requires sufficient observations to reduce manipulation risk.
        /// @param token Token address.
        /// @param period Time window in seconds.
        /// @return twap Time-weighted average price.
        fn get_twap(self: @ContractState, token: ContractAddress, period: u64) -> u256 {
            let state = self.twap_state.entry(token).read();
            let count = state.count;
            assert!(count.into() >= self.min_observations.read(), "Insufficient observations");
            assert!(period > 0, "Invalid period");
            state.running_sum / count.into()
        }

        /// @notice Returns the latest spot price for a token.
        /// @dev Read-only helper for monitoring.
        /// @param token Token address.
        /// @return price Latest spot price.
        fn get_spot_price(self: @ContractState, token: ContractAddress) -> u256 {
            let state = self.twap_state.entry(token).read();
            assert!(state.count > 0, "No observations found");
            state.last_price
        }

        /// @notice Returns the absolute deviation between spot and TWAP.
        /// @dev Useful for detecting potential manipulation.
        /// @param token Token address.
        /// @return deviation Absolute deviation value.
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
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(!router.is_zero(), "Privacy router required");
            let current = self.privacy_router.read();
            assert!(current.is_zero(), "Privacy router already set");
            self.privacy_router.write(router);
        }

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
