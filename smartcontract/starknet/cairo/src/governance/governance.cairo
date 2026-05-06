use starknet::ContractAddress;

/// @notice A governance proposal with voting state and execution data.
#[derive(Drop, Serde, starknet::Store)]
pub struct Proposal {
    pub id: u256,
    pub proposer: ContractAddress,
    pub description: ByteArray,
    pub actions_hash: felt252,
    pub snapshot_block: u64,
    pub start_block: u64,
    pub end_block: u64,
    pub for_votes: u256,
    pub against_votes: u256,
    pub abstain_votes: u256,
    pub executed: bool,
    pub canceled: bool
}

/// @title IGovernance
/// @notice Proposal lifecycle: create, vote, execute, cancel.
#[starknet::interface]
pub trait IGovernance<TContractState> {
    /// @notice Creates a new governance proposal.
    /// @param targets Ordered list of contracts to call on execution.
    /// @param calldatas Encoded calldata for each target's `execute` function.
    /// @param description Human-readable proposal description.
    /// @return The new proposal ID.
    fn propose(
        ref self: TContractState,
        targets: Span<ContractAddress>,
        calldatas: Span<Span<felt252>>,
        description: ByteArray
    ) -> u256;

    /// @notice Casts a vote on a proposal.
    /// @param proposal_id The proposal to vote on.
    /// @param support 0 = against, 1 = for, 2 = abstain.
    fn vote(ref self: TContractState, proposal_id: u256, support: u8);

    /// @notice Executes a passed proposal.
    /// @dev Calls `execute(calldata)` on each target contract. Verifies actions_hash.
    /// @param proposal_id The proposal to execute.
    /// @param targets Must match the targets from the original proposal.
    /// @param calldatas Must match the calldatas from the original proposal.
    fn execute(
        ref self: TContractState,
        proposal_id: u256,
        targets: Span<ContractAddress>,
        calldatas: Span<Span<felt252>>
    );

    /// @notice Cancels a proposal before voting starts.
    /// @dev Only callable by the original proposer before `start_block`.
    /// @param proposal_id The proposal to cancel.
    fn cancel(ref self: TContractState, proposal_id: u256);

    /// @notice Returns the full proposal struct.
    /// @param proposal_id The proposal to query.
    /// @return The `Proposal` struct.
    fn get_proposal(self: @TContractState, proposal_id: u256) -> Proposal;
}

/// @title IVotesToken
/// @notice Snapshot-based voting power interface.
#[starknet::interface]
pub trait IVotesToken<TContractState> {
    fn get_past_votes(self: @TContractState, account: ContractAddress, block_number: u64) -> u256;
}

/// @title IGovernancePrivacy
/// @notice ZK privacy entrypoints for governance actions.
#[starknet::interface]
pub trait IGovernancePrivacy<TContractState> {
    /// @notice Sets the privacy router address.
    /// @dev Callable only by the contract owner. Emits `PrivacyRouterUpdated`.
    /// @param router New privacy router address (must be non-zero).
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);

    /// @notice Submits a ZK-proven governance action to the privacy router.
    /// @dev Nullifiers are replay-protected: each nullifier may only be consumed once.
    /// @param old_root Previous Merkle tree root.
    /// @param new_root Updated Merkle tree root after commitments.
    /// @param nullifiers Nullifiers for inputs being spent.
    /// @param commitments New Merkle commitments.
    /// @param public_inputs ZK circuit public inputs.
    /// @param proof Serialized ZK proof.
    fn submit_private_governance_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @title Governance
/// @notice On-chain governance with block-based voting windows.
///         Each execution target must expose `fn execute(calldata: Span<felt252>)`.
#[starknet::contract]
pub mod Governance {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_caller_address, get_block_number};
    use starknet::syscalls::call_contract_syscall;
    use core::poseidon::poseidon_hash_span;
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_GOVERNANCE;
    use super::{Proposal, IVotesTokenDispatcher, IVotesTokenDispatcherTrait};

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub proposals: Map<u256, Proposal>,
        pub proposal_count: u256,
        pub has_voted: Map<(u256, ContractAddress), bool>,
        pub voting_delay: u64,
        pub voting_period: u64,
        pub token_address: ContractAddress,
        pub quorum_votes: u256,
        pub privacy_router: ContractAddress,
        pub used_nullifiers: Map<felt252, bool>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        ProposalCreated: ProposalCreated,
        VoteCast: VoteCast,
        ProposalExecuted: ProposalExecuted,
        ProposalCanceled: ProposalCanceled,
        PrivacyRouterUpdated: PrivacyRouterUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    /// @notice Emitted when a new proposal is created.
    #[derive(Drop, starknet::Event)]
    pub struct ProposalCreated {
        pub proposal_id: u256,
        pub proposer: ContractAddress,
        pub start_block: u64,
        pub end_block: u64,
    }

    /// @notice Emitted when a voter casts a vote.
    #[derive(Drop, starknet::Event)]
    pub struct VoteCast {
        pub voter: ContractAddress,
        pub proposal_id: u256,
        pub support: u8,
        pub weight: u256,
    }

    /// @notice Emitted when a proposal is successfully executed.
    #[derive(Drop, starknet::Event)]
    pub struct ProposalExecuted {
        pub proposal_id: u256,
    }

    /// @notice Emitted when a proposal is canceled by its proposer.
    #[derive(Drop, starknet::Event)]
    pub struct ProposalCanceled {
        pub proposal_id: u256,
    }

    /// @notice Emitted when the privacy router address is updated.
    #[derive(Drop, starknet::Event)]
    pub struct PrivacyRouterUpdated {
        pub router: ContractAddress,
    }

    /// @notice Initializes governance parameters.
    /// @param voting_delay Blocks from proposal creation to voting start.
    /// @param voting_period Blocks the voting window remains open.
    /// @param token Voting power token implementing `get_past_votes`.
    /// @param owner Initial contract owner (two-step transfer via OZ OwnableComponent).
    /// @param quorum_votes Minimum for-votes required for a proposal to pass.
    #[constructor]
    fn constructor(
        ref self: ContractState,
        voting_delay: u64,
        voting_period: u64,
        token: ContractAddress,
        owner: ContractAddress,
        quorum_votes: u256
    ) {
        assert!(!token.is_zero(), "Token required");
        self.ownable.initializer(owner);
        self.voting_delay.write(voting_delay);
        self.voting_period.write(voting_period);
        self.proposal_count.write(0);
        self.token_address.write(token);
        self.quorum_votes.write(quorum_votes);
    }

    #[abi(embed_v0)]
    pub impl GovernanceImpl of super::IGovernance<ContractState> {
        /// @inheritdoc IGovernance
        fn propose(
            ref self: ContractState,
            targets: Span<ContractAddress>,
            calldatas: Span<Span<felt252>>,
            description: ByteArray
        ) -> u256 {
            assert!(targets.len() == calldatas.len(), "Targets/calldatas length mismatch");
            let id = self.proposal_count.read() + 1;
            let snapshot_block = get_block_number();
            let start = get_block_number() + self.voting_delay.read();
            let end = start + self.voting_period.read();
            let actions_hash = self.hash_actions(targets, calldatas);
            let proposer = get_caller_address();

            let new_proposal = Proposal {
                id,
                proposer,
                description,
                actions_hash,
                snapshot_block,
                start_block: start,
                end_block: end,
                for_votes: 0,
                against_votes: 0,
                abstain_votes: 0,
                executed: false,
                canceled: false,
            };

            self.proposals.entry(id).write(new_proposal);
            self.proposal_count.write(id);
            self.emit(Event::ProposalCreated(ProposalCreated {
                proposal_id: id,
                proposer,
                start_block: start,
                end_block: end,
            }));
            id
        }

        /// @inheritdoc IGovernance
        fn vote(ref self: ContractState, proposal_id: u256, support: u8) {
            let mut proposal = self.proposals.entry(proposal_id).read();
            let caller = get_caller_address();
            let current_block = get_block_number();

            assert!(!proposal.canceled, "Proposal is canceled");
            assert!(!proposal.executed, "Proposal already executed");
            assert!(current_block >= proposal.start_block, "Voting has not started");
            assert!(current_block <= proposal.end_block, "Voting has ended");
            assert!(!self.has_voted.entry((proposal_id, caller)).read(), "User already voted");

            let token = IVotesTokenDispatcher { contract_address: self.token_address.read() };
            let weight = token.get_past_votes(caller, proposal.snapshot_block);
            assert!(weight > 0, "No voting power");

            match support {
                0_u8 => proposal.against_votes += weight,
                1_u8 => proposal.for_votes += weight,
                2_u8 => proposal.abstain_votes += weight,
                _ => panic!("Invalid support value"),
            }

            self.has_voted.entry((proposal_id, caller)).write(true);
            self.proposals.entry(proposal_id).write(proposal);
            self.emit(Event::VoteCast(VoteCast { voter: caller, proposal_id, support, weight }));
        }

        /// @inheritdoc IGovernance
        fn execute(
            ref self: ContractState,
            proposal_id: u256,
            targets: Span<ContractAddress>,
            calldatas: Span<Span<felt252>>
        ) {
            let mut proposal = self.proposals.entry(proposal_id).read();
            let current_block = get_block_number();
            assert!(current_block > proposal.end_block, "Voting not ended");
            assert!(proposal.for_votes > proposal.against_votes, "Proposal did not pass");
            let quorum = self.quorum_votes.read();
            assert!(proposal.for_votes >= quorum, "Quorum not reached");
            assert!(!proposal.executed, "Already executed");
            assert!(targets.len() == calldatas.len(), "Targets/calldatas length mismatch");
            let actions_hash = self.hash_actions(targets, calldatas);
            assert!(actions_hash == proposal.actions_hash, "Actions hash mismatch");

            proposal.executed = true;
            self.proposals.entry(proposal_id).write(proposal);

            let mut i: usize = 0;
            while i < targets.len() {
                // Each target must expose `fn execute(calldata: Span<felt252>)`.
                let _ = call_contract_syscall(*targets.at(i), selector!("execute"), *calldatas.at(i));
                i += 1;
            }
            self.emit(Event::ProposalExecuted(ProposalExecuted { proposal_id }));
        }

        /// @inheritdoc IGovernance
        fn cancel(ref self: ContractState, proposal_id: u256) {
            let mut proposal = self.proposals.entry(proposal_id).read();
            assert!(get_caller_address() == proposal.proposer, "Only proposer can cancel");
            assert!(get_block_number() < proposal.start_block, "Voting already started");

            proposal.canceled = true;
            self.proposals.entry(proposal_id).write(proposal);
            self.emit(Event::ProposalCanceled(ProposalCanceled { proposal_id }));
        }

        /// @inheritdoc IGovernance
        fn get_proposal(self: @ContractState, proposal_id: u256) -> Proposal {
            self.proposals.entry(proposal_id).read()
        }
    }

    #[abi(embed_v0)]
    impl GovernancePrivacyImpl of super::IGovernancePrivacy<ContractState> {
        /// @inheritdoc IGovernancePrivacy
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
            self.emit(Event::PrivacyRouterUpdated(PrivacyRouterUpdated { router }));
        }

        /// @inheritdoc IGovernancePrivacy
        fn submit_private_governance_action(
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
                ACTION_GOVERNANCE,
                old_root,
                new_root,
                nullifiers,
                commitments,
                public_inputs,
                proof
            );
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn hash_actions(
            self: @ContractState,
            targets: Span<ContractAddress>,
            calldatas: Span<Span<felt252>>
        ) -> felt252 {
            let mut data = array![];
            data.append(targets.len().into());
            let mut i: usize = 0;
            while i < targets.len() {
                let target_felt: felt252 = (*targets.at(i)).into();
                data.append(target_felt);
                let call = *calldatas.at(i);
                data.append(call.len().into());
                let mut j: usize = 0;
                while j < call.len() {
                    data.append(*call.at(j));
                    j += 1;
                }
                i += 1;
            }
            poseidon_hash_span(data.span())
        }
    }
}
