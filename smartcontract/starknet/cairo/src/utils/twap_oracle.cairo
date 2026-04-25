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
    // Grants or revokes permission to submit observations.
    fn set_authorized_feeder(ref self: TContractState, feeder: ContractAddress, authorized: bool);
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
    use starknet::get_block_timestamp;
    use starknet::get_caller_address;
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_TWAP;

    #[derive(Copy, Drop, Serde, starknet::Store)]
    pub struct TwapState {
        // Cumulative sum of price * time elapsed.
        pub running_sum: u256,
        pub count: u64,
        pub last_price: u256,
        pub last_observed_at: u64,
        pub total_time: u64,
    }

    #[storage]
    pub struct Storage {
        pub twap_state: Map<ContractAddress, TwapState>,
        pub observation_window: u64,
        pub min_observations: u256,
        pub authorized_feeders: Map<ContractAddress, bool>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        pub privacy_router: ContractAddress,
    }

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        FeederUpdated: FeederUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FeederUpdated {
        pub feeder: ContractAddress,
        pub authorized: bool,
    }

    // Initializes default observation window and minimum sample requirement.
    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.ownable.initializer(owner);
        self.authorized_feeders.entry(owner).write(true);
        self.observation_window.write(1800);
        self.min_observations.write(10);
    }

    #[abi(embed_v0)]
    pub impl TWAPOracleImpl of super::ITWAPOracle<ContractState> {
        // Adds a new price observation for TWAP calculation.
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

        // Returns current TWAP value for asset pair.
        fn get_twap(self: @ContractState, token: ContractAddress, period: u64) -> u256 {
            let state = self.twap_state.entry(token).read();
            let count = state.count;
            assert!(count.into() >= self.min_observations.read(), "Insufficient observations");
            assert!(period > 0, "Invalid period");
            let now = get_block_timestamp();
            assert!(now > state.last_observed_at, "TWAP not ready in same block");
            let elapsed = now - state.last_observed_at;
            let mut total_time = state.total_time + elapsed;
            assert!(total_time >= period, "Insufficient observation window");
            if total_time == 0 {
                return 0;
            }
            let cumulative = state.running_sum + (state.last_price * elapsed.into());
            cumulative / total_time.into()
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

        // Grants or revokes permission to submit observations.
        fn set_authorized_feeder(ref self: ContractState, feeder: ContractAddress, authorized: bool) {
            self.ownable.assert_only_owner();
            assert!(!feeder.is_zero(), "Invalid feeder");
            self.authorized_feeders.entry(feeder).write(authorized);
            self.emit(Event::FeederUpdated(FeederUpdated { feeder, authorized }));
        }
    }

    #[abi(embed_v0)]
    impl TWAPOraclePrivacyImpl of super::ITWAPOraclePrivacy<ContractState> {
        // Sets privacy router used for Hide Mode TWAP actions.
        // This contract allows one-time router wiring.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
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
