use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Reputation {
    pub positive: u256,
    pub negative: u256,
    pub total_reports: u64,
    pub updated_at: u64,
}

// ERC-8004 Reputation Registry (Starknet adaptation).
// Tracks positive/negative signals by allowlisted raters.
#[starknet::interface]
pub trait IERC8004ReputationRegistry<TContractState> {
    // Enables or disables a rater.
    fn set_rater(ref self: TContractState, rater: ContractAddress, allowed: bool);
    // Updates maximum weight per report.
    fn set_max_weight(ref self: TContractState, max_weight: u256);
    // Submits reputation feedback for an agent id.
    fn submit_feedback(ref self: TContractState, agent_id: felt252, positive: bool, weight: u256);
    // Returns reputation data for a given agent id.
    fn get_reputation(self: @TContractState, agent_id: felt252) -> Reputation;
    // Returns whether a rater is allowed.
    fn is_rater_allowed(self: @TContractState, rater: ContractAddress) -> bool;
}

#[starknet::contract]
pub mod ERC8004ReputationRegistry {
    use super::{IERC8004ReputationRegistry, Reputation};
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_block_timestamp, get_caller_address};
    use openzeppelin::access::ownable::OwnableComponent;
    use core::num::traits::Zero;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub raters: Map<ContractAddress, bool>,
        pub reputations: Map<felt252, Reputation>,
        pub max_weight: u256,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        RaterUpdated: RaterUpdated,
        FeedbackSubmitted: FeedbackSubmitted,
        MaxWeightUpdated: MaxWeightUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RaterUpdated {
        pub rater: ContractAddress,
        pub allowed: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FeedbackSubmitted {
        pub agent_id: felt252,
        pub rater: ContractAddress,
        pub positive: bool,
        pub weight: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MaxWeightUpdated {
        pub max_weight: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, max_weight: u256) {
        self.ownable.initializer(admin);
        self.max_weight.write(max_weight);
    }

    fn assert_rater(self: @ContractState) -> ContractAddress {
        let caller = get_caller_address();
        let allowed = self.raters.entry(caller).read();
        assert!(allowed, "Rater not allowed");
        caller
    }

    #[abi(embed_v0)]
    impl ReputationRegistryImpl of IERC8004ReputationRegistry<ContractState> {
        fn set_rater(ref self: ContractState, rater: ContractAddress, allowed: bool) {
            self.ownable.assert_only_owner();
            assert!(!rater.is_zero(), "Rater required");
            self.raters.entry(rater).write(allowed);
            self.emit(Event::RaterUpdated(RaterUpdated { rater, allowed }));
        }

        fn set_max_weight(ref self: ContractState, max_weight: u256) {
            self.ownable.assert_only_owner();
            assert!(max_weight > 0, "Max weight required");
            self.max_weight.write(max_weight);
            self.emit(Event::MaxWeightUpdated(MaxWeightUpdated { max_weight }));
        }

        fn submit_feedback(ref self: ContractState, agent_id: felt252, positive: bool, weight: u256) {
            assert!(agent_id != 0, "Agent id required");
            let rater = assert_rater(@self);
            let max_weight = self.max_weight.read();
            assert!(weight > 0, "Weight required");
            assert!(weight <= max_weight, "Weight exceeds max");

            let mut rep = self.reputations.entry(agent_id).read();
            if positive {
                rep.positive = rep.positive + weight;
            } else {
                rep.negative = rep.negative + weight;
            }
            rep.total_reports += 1;
            rep.updated_at = get_block_timestamp();
            self.reputations.entry(agent_id).write(rep);
            self.emit(Event::FeedbackSubmitted(FeedbackSubmitted { agent_id, rater, positive, weight }));
        }

        fn get_reputation(self: @ContractState, agent_id: felt252) -> Reputation {
            self.reputations.entry(agent_id).read()
        }

        fn is_rater_allowed(self: @ContractState, rater: ContractAddress) -> bool {
            self.raters.entry(rater).read()
        }
    }
}
