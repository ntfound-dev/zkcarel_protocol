use starknet::ContractAddress;

/// @title ITWAPOracle
/// @notice Time-weighted average price oracle for manipulation-resistant price references.
///         Maintains rolling observations to smooth single-block price spikes.
#[starknet::interface]
pub trait ITWAPOracle<TContractState> {
    /// @notice Records a new price observation for TWAP calculation.
    /// @dev Callable only by authorized feeders. One observation per block per token.
    /// @param token Token address.
    /// @param price Observed spot price.
    fn update_observation(ref self: TContractState, token: ContractAddress, price: u256);

    /// @notice Returns the TWAP value averaged over `period` seconds.
    /// @dev Requires minimum observation count and sufficient cumulative time coverage.
    /// @param token Token address.
    /// @param period Desired averaging window in seconds.
    /// @return TWAP price.
    fn get_twap(self: @TContractState, token: ContractAddress, period: u64) -> u256;

    /// @notice Returns the most recent spot price observation.
    /// @param token Token address.
    /// @return Latest observed price.
    fn get_spot_price(self: @TContractState, token: ContractAddress) -> u256;

    /// @notice Returns the absolute deviation between the spot price and the TWAP.
    /// @param token Token address.
    /// @return |spot - twap|.
    fn get_price_deviation(self: @TContractState, token: ContractAddress) -> u256;

    /// @notice Grants or revokes permission to submit price observations.
    /// @dev Callable only by the contract owner. Emits `FeederUpdated`.
    /// @param feeder Address to configure.
    /// @param authorized true to authorize, false to revoke.
    fn set_authorized_feeder(ref self: TContractState, feeder: ContractAddress, authorized: bool);
}

/// @title ITWAPOraclePrivacy
/// @notice Hide Mode hooks for private TWAP updates through the privacy router.
#[starknet::interface]
pub trait ITWAPOraclePrivacy<TContractState> {
    /// @notice Sets the privacy router for private TWAP actions.
    /// @dev Callable only by the contract owner. Emits `PrivacyRouterUpdated`.
    /// @param router New privacy router address (must be non-zero).
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);

    /// @notice Forwards a nullifier/commitment-bound TWAP payload to the privacy router.
    /// @dev Nullifiers are replay-protected: each may only be consumed once.
    /// @param old_root Previous Merkle tree root.
    /// @param new_root Updated Merkle tree root after commitments.
    /// @param nullifiers Nullifiers for inputs being spent.
    /// @param commitments New Merkle commitments.
    /// @param public_inputs ZK circuit public inputs.
    /// @param proof Serialized ZK proof.
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

/// @title TWAPOracle
/// @notice Maintains rolling price observations for time-weighted average computation.
///         Resistant to single-block price manipulation.
#[starknet::contract]
pub mod TWAPOracle {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::get_block_timestamp;
    use starknet::get_caller_address;
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_TWAP;

    /// @notice Per-token TWAP accumulator state.
    #[derive(Copy, Drop, Serde, starknet::Store)]
    pub struct TwapState {
        pub running_sum: u256,
        pub count: u64,
        pub last_price: u256,
        pub last_observed_at: u64,
        pub total_time: u64,
    }

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub twap_state: Map<ContractAddress, TwapState>,
        pub observation_window: u64,
        pub min_observations: u256,
        pub authorized_feeders: Map<ContractAddress, bool>,
        pub privacy_router: ContractAddress,
        pub used_nullifiers: Map<felt252, bool>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        FeederUpdated: FeederUpdated,
        PrivacyRouterUpdated: PrivacyRouterUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    /// @notice Emitted when a feeder address is authorized or revoked.
    #[derive(Drop, starknet::Event)]
    pub struct FeederUpdated {
        pub feeder: ContractAddress,
        pub authorized: bool,
    }

    /// @notice Emitted when the privacy router address is updated.
    #[derive(Drop, starknet::Event)]
    pub struct PrivacyRouterUpdated {
        pub router: ContractAddress,
    }

    /// @notice Initializes the observation window, minimum sample count, and grants the owner feeder rights.
    /// @param owner Initial contract owner (two-step transfer via OZ OwnableComponent).
    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.ownable.initializer(owner);
        self.authorized_feeders.entry(owner).write(true);
        self.observation_window.write(1800);
        self.min_observations.write(10);
    }

    #[abi(embed_v0)]
    pub impl TWAPOracleImpl of super::ITWAPOracle<ContractState> {
        /// @inheritdoc ITWAPOracle
        fn update_observation(ref self: ContractState, token: ContractAddress, price: u256) {
            let caller = get_caller_address();
            assert!(self.authorized_feeders.entry(caller).read(), "Not authorized");
            let mut state = self.twap_state.entry(token).read();
            let now = get_block_timestamp();
            if state.count > 0 {
                assert!(now > state.last_observed_at, "Observation already updated this block");
                let elapsed = now - state.last_observed_at;
                if elapsed > 0 {
                    state.running_sum += state.last_price * elapsed.into();
                    state.total_time += elapsed;
                }
            }
            state.count += 1;
            state.last_price = price;
            state.last_observed_at = now;
            self.twap_state.entry(token).write(state);
        }

        /// @inheritdoc ITWAPOracle
        fn get_twap(self: @ContractState, token: ContractAddress, period: u64) -> u256 {
            let state = self.twap_state.entry(token).read();
            let count = state.count;
            assert!(count.into() >= self.min_observations.read(), "Insufficient observations");
            assert!(period > 0, "Invalid period");
            let now = get_block_timestamp();
            assert!(now > state.last_observed_at, "TWAP not ready in same block");
            let elapsed = now - state.last_observed_at;
            let total_time = state.total_time + elapsed;
            assert!(total_time >= period, "Insufficient observation window");
            if total_time == 0 {
                return 0;
            }
            let cumulative = state.running_sum + (state.last_price * elapsed.into());
            cumulative / total_time.into()
        }

        /// @inheritdoc ITWAPOracle
        fn get_spot_price(self: @ContractState, token: ContractAddress) -> u256 {
            let state = self.twap_state.entry(token).read();
            assert!(state.count > 0, "No observations found");
            state.last_price
        }

        /// @inheritdoc ITWAPOracle
        fn get_price_deviation(self: @ContractState, token: ContractAddress) -> u256 {
            let spot = self.get_spot_price(token);
            let twap = self.get_twap(token, self.observation_window.read());
            if spot > twap {
                spot - twap
            } else {
                twap - spot
            }
        }

        /// @inheritdoc ITWAPOracle
        fn set_authorized_feeder(
            ref self: ContractState,
            feeder: ContractAddress,
            authorized: bool
        ) {
            self.ownable.assert_only_owner();
            assert!(!feeder.is_zero(), "Invalid feeder");
            self.authorized_feeders.entry(feeder).write(authorized);
            self.emit(Event::FeederUpdated(FeederUpdated { feeder, authorized }));
        }
    }

    #[abi(embed_v0)]
    impl TWAPOraclePrivacyImpl of super::ITWAPOraclePrivacy<ContractState> {
        /// @inheritdoc ITWAPOraclePrivacy
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
            self.emit(Event::PrivacyRouterUpdated(PrivacyRouterUpdated { router }));
        }

        /// @inheritdoc ITWAPOraclePrivacy
        fn submit_private_twap_action(
            ref self: ContractState,
            old_root: felt252,
            new_root: felt252,
            nullifiers: Span<felt252>,
            commitments: Span<felt252>,
            public_inputs: Span<felt252>,
            proof: Span<felt252>
        ) {
            let total: u64 = nullifiers.len().into();
            let mut i: u64 = 0;
            while i < total {
                let idx: u32 = i.try_into().unwrap();
                let nf = *nullifiers.at(idx);
                assert!(!self.used_nullifiers.entry(nf).read(), "Nullifier already used");
                self.used_nullifiers.entry(nf).write(true);
                i += 1;
            };
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
