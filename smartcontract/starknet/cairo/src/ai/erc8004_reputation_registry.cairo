use starknet::ContractAddress;

/// @notice Aggregated reputation scores for an ERC-8004 agent.
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Reputation {
    pub positive: u256,
    pub negative: u256,
    pub total_reports: u64,
    pub updated_at: u64,
}

/// @title IERC8004ReputationRegistry
/// @notice ERC-8004 Reputation Registry (Starknet adaptation).
/// @dev Tracks positive and negative reputation signals submitted by allowlisted raters.
///      Raters are managed via AccessControlComponent with RATER_ROLE, replacing the legacy
///      boolean allowlist map. Each rater may submit feedback for a given agent exactly once (L-1 fix).
#[starknet::interface]
pub trait IERC8004ReputationRegistry<TContractState> {
    /// @notice Grants or revokes RATER_ROLE for a given address.
    /// @dev Callable only by the contract owner. Emits `RaterUpdated`.
    ///      Internally calls `_grant_role` / `_revoke_role` on AccessControlComponent.
    /// @param rater The address to update.
    /// @param allowed true to grant RATER_ROLE, false to revoke it.
    fn set_rater(ref self: TContractState, rater: ContractAddress, allowed: bool);

    /// @notice Updates the maximum weight allowed per feedback submission.
    /// @dev Callable only by the contract owner. Must be > 0. Emits `MaxWeightUpdated`.
    /// @param max_weight New per-submission weight cap (in raw u256 units).
    fn set_max_weight(ref self: TContractState, max_weight: u256);

    /// @notice Submits a positive or negative reputation signal for an agent.
    /// @dev Callable only by addresses holding RATER_ROLE.
    ///      Each rater may call this exactly once per agent (L-1 fix — tracked via `rater_submitted`).
    ///      `weight` must be in range (0, max_weight]. Emits `FeedbackSubmitted`.
    /// @param agent_id The ERC-8004 agent to rate.
    /// @param positive true to add to positive score, false to add to negative score.
    /// @param weight Signal magnitude (must be > 0 and <= `max_weight`).
    fn submit_feedback(ref self: TContractState, agent_id: felt252, positive: bool, weight: u256);

    /// @notice Returns the aggregated reputation data for an agent.
    /// @param agent_id The agent to query.
    /// @return `Reputation` struct with positive/negative totals, report count, and last update time.
    fn get_reputation(self: @TContractState, agent_id: felt252) -> Reputation;

    /// @notice Returns whether a given address currently holds RATER_ROLE.
    /// @param rater The address to query.
    /// @return true if the address has RATER_ROLE.
    fn is_rater_allowed(self: @TContractState, rater: ContractAddress) -> bool;
}

/// @title ERC8004ReputationRegistry
/// @notice Implements IERC8004ReputationRegistry with OZ OwnableTwoStepComponent
///         and AccessControlComponent (RATER_ROLE).
#[starknet::contract]
pub mod ERC8004ReputationRegistry {
    use super::{IERC8004ReputationRegistry, Reputation};
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_block_timestamp, get_caller_address};
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::access::accesscontrol::{AccessControlComponent, DEFAULT_ADMIN_ROLE};
    use openzeppelin::introspection::src5::SRC5Component;
    use core::num::traits::Zero;

    /// @dev Keccak selector for the string "RATER_ROLE".
    const RATER_ROLE: felt252 = selector!("RATER_ROLE");

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: AccessControlComponent, storage: access_control, event: AccessControlEvent);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;
    #[abi(embed_v0)]
    impl AccessControlImpl = AccessControlComponent::AccessControlImpl<ContractState>;
    impl AccessControlInternalImpl = AccessControlComponent::InternalImpl<ContractState>;
    #[abi(embed_v0)]
    impl SRC5Impl = SRC5Component::SRC5Impl<ContractState>;

    #[storage]
    pub struct Storage {
        /// @dev Key: agent_id → aggregated Reputation struct.
        pub reputations: Map<felt252, Reputation>,
        /// @dev Maximum weight a single rater submission may carry.
        pub max_weight: u256,
        /// @dev Key: (agent_id, rater) → true if this rater has already submitted for this agent.
        pub rater_submitted: Map<(felt252, ContractAddress), bool>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        pub access_control: AccessControlComponent::Storage,
        #[substorage(v0)]
        pub src5: SRC5Component::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        RaterUpdated: RaterUpdated,
        FeedbackSubmitted: FeedbackSubmitted,
        MaxWeightUpdated: MaxWeightUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        AccessControlEvent: AccessControlComponent::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    /// @notice Emitted when a rater's role is granted or revoked.
    #[derive(Drop, starknet::Event)]
    pub struct RaterUpdated {
        pub rater: ContractAddress,
        pub allowed: bool,
    }

    /// @notice Emitted when a rater submits feedback for an agent.
    #[derive(Drop, starknet::Event)]
    pub struct FeedbackSubmitted {
        pub agent_id: felt252,
        pub rater: ContractAddress,
        pub positive: bool,
        pub weight: u256,
    }

    /// @notice Emitted when the owner updates the per-submission weight cap.
    #[derive(Drop, starknet::Event)]
    pub struct MaxWeightUpdated {
        pub max_weight: u256,
    }

    /// @notice Initializes the registry, sets the weight cap, and grants `DEFAULT_ADMIN_ROLE`.
    /// @param admin Initial owner and access control admin address.
    /// @param max_weight Initial maximum weight per feedback submission.
    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, max_weight: u256) {
        self.ownable.initializer(admin);
        self.access_control.initializer();
        self.access_control._grant_role(DEFAULT_ADMIN_ROLE, admin);
        self.max_weight.write(max_weight);
    }

    /// @notice Asserts the caller holds RATER_ROLE and returns their address.
    /// @dev Panics with "Rater not allowed" if the caller does not have the role.
    /// @return The caller's address.
    fn assert_rater(self: @ContractState) -> ContractAddress {
        let caller = get_caller_address();
        assert!(self.access_control.has_role(RATER_ROLE, caller), "Rater not allowed");
        caller
    }

    #[abi(embed_v0)]
    impl ReputationRegistryImpl of IERC8004ReputationRegistry<ContractState> {
        /// @inheritdoc IERC8004ReputationRegistry
        fn set_rater(ref self: ContractState, rater: ContractAddress, allowed: bool) {
            self.ownable.assert_only_owner();
            assert!(!rater.is_zero(), "Rater required");
            if allowed {
                self.access_control._grant_role(RATER_ROLE, rater);
            } else {
                self.access_control._revoke_role(RATER_ROLE, rater);
            }
            self.emit(Event::RaterUpdated(RaterUpdated { rater, allowed }));
        }

        /// @inheritdoc IERC8004ReputationRegistry
        fn set_max_weight(ref self: ContractState, max_weight: u256) {
            self.ownable.assert_only_owner();
            assert!(max_weight > 0, "Max weight required");
            self.max_weight.write(max_weight);
            self.emit(Event::MaxWeightUpdated(MaxWeightUpdated { max_weight }));
        }

        /// @inheritdoc IERC8004ReputationRegistry
        fn submit_feedback(ref self: ContractState, agent_id: felt252, positive: bool, weight: u256) {
            assert!(agent_id != 0, "Agent id required");
            let rater = assert_rater(@self);
            let max_weight = self.max_weight.read();
            assert!(weight > 0, "Weight required");
            assert!(weight <= max_weight, "Weight exceeds max");
            let submitted_key = (agent_id, rater);
            assert!(!self.rater_submitted.entry(submitted_key).read(), "Already submitted");
            self.rater_submitted.entry(submitted_key).write(true);

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

        /// @inheritdoc IERC8004ReputationRegistry
        fn get_reputation(self: @ContractState, agent_id: felt252) -> Reputation {
            self.reputations.entry(agent_id).read()
        }

        /// @inheritdoc IERC8004ReputationRegistry
        fn is_rater_allowed(self: @ContractState, rater: ContractAddress) -> bool {
            self.access_control.has_role(RATER_ROLE, rater)
        }
    }
}
