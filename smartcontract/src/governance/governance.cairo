use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct Proposal {
    pub id: u256,
    pub proposer: ContractAddress,
    pub description: ByteArray,
    pub actions_hash: felt252,
    pub start_block: u64,
    pub end_block: u64,
    pub for_votes: u256,
    pub against_votes: u256,
    pub abstain_votes: u256,
    pub executed: bool,
    pub canceled: bool
}

// Defines proposal, voting, and execution entrypoints.
// Simple on-chain governance with block-based voting windows.
#[starknet::interface]
pub trait IGovernance<TContractState> {
    // Implements propose logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn propose(
        ref self: TContractState, 
        targets: Span<ContractAddress>, 
        calldatas: Span<Span<felt252>>, 
        description: ByteArray
    ) -> u256;
    // Implements vote logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn vote(ref self: TContractState, proposal_id: u256, support: u8);
    // Implements execute logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn execute(ref self: TContractState, proposal_id: u256, targets: Span<ContractAddress>, calldatas: Span<Span<felt252>>);
    // Implements cancel logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn cancel(ref self: TContractState, proposal_id: u256);
    // Returns get proposal from state without mutating storage.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn get_proposal(self: @TContractState, proposal_id: u256) -> Proposal;
}

// ZK privacy entrypoints for governance actions.
#[starknet::interface]
pub trait IGovernancePrivacy<TContractState> {
    // Updates privacy router configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Applies submit private governance action after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

// Simple governance contract with proposals and voting.
// Executes target calls after successful voting.
#[starknet::contract]
pub mod Governance {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_caller_address, get_block_number};
    use starknet::syscalls::call_contract_syscall;
    use core::poseidon::poseidon_hash_span;
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_GOVERNANCE;
    use super::Proposal;

    const AGAINST: u8 = 0_u8;
    const FOR: u8 = 1_u8;
    const ABSTAIN: u8 = 2_u8;

    #[storage]
    pub struct Storage {
        pub proposals: Map<u256, Proposal>,
        pub proposal_count: u256,
        pub has_voted: Map<(u256, ContractAddress), bool>,
        pub voting_delay: u64,
        pub voting_period: u64,
        pub privacy_router: ContractAddress,
    }

    // Initializes governance parameters.
    // Sets voting delay and voting period in blocks.
    // `voting_delay` offsets start block and `voting_period` sets proposal voting window.
    #[constructor]
    // Initializes storage and role configuration during deployment.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn constructor(
        ref self: ContractState, 
        voting_delay: u64, 
        voting_period: u64
    ) {
        self.voting_delay.write(voting_delay);
        self.voting_period.write(voting_period);
        self.proposal_count.write(0);
    }

    #[abi(embed_v0)]
    pub impl GovernanceImpl of super::IGovernance<ContractState> {
        // Implements propose logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn propose(
            ref self: ContractState, 
            targets: Span<ContractAddress>, 
            calldatas: Span<Span<felt252>>, 
            description: ByteArray
        ) -> u256 {
            assert!(targets.len() == calldatas.len(), "Targets/calldatas length mismatch");
            let id = self.proposal_count.read() + 1;
            let start = get_block_number() + self.voting_delay.read();
            let end = start + self.voting_period.read();
            let actions_hash = self.hash_actions(targets, calldatas);

            let new_proposal = Proposal {
                id,
                proposer: get_caller_address(),
                description,
                actions_hash,
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
            id
        }

        // Implements vote logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn vote(ref self: ContractState, proposal_id: u256, support: u8) {
            let mut proposal = self.proposals.entry(proposal_id).read();
            let caller = get_caller_address();
            let current_block = get_block_number();

            assert!(!proposal.canceled, "Proposal is canceled");
            assert!(!proposal.executed, "Proposal already executed");
            assert!(current_block >= proposal.start_block, "Voting has not started");
            assert!(current_block <= proposal.end_block, "Voting has ended");
            assert!(!self.has_voted.entry((proposal_id, caller)).read(), "User already voted");

            if support == AGAINST {
                proposal.against_votes += 1;
            } else if support == FOR {
                proposal.for_votes += 1;
            } else if support == ABSTAIN {
                proposal.abstain_votes += 1;
            } else {
                panic!("Invalid support value");
            }

            self.has_voted.entry((proposal_id, caller)).write(true);
            self.proposals.entry(proposal_id).write(proposal);
        }

        // Implements execute logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn execute(
            ref self: ContractState, 
            proposal_id: u256, 
            targets: Span<ContractAddress>, 
            calldatas: Span<Span<felt252>>
        ) {
            let mut proposal = self.proposals.entry(proposal_id).read();
            assert!(proposal.for_votes > proposal.against_votes, "Proposal did not pass");
            assert!(!proposal.executed, "Already executed");
            assert!(targets.len() == calldatas.len(), "Targets/calldatas length mismatch");
            let actions_hash = self.hash_actions(targets, calldatas);
            assert!(actions_hash == proposal.actions_hash, "Actions hash mismatch");

            proposal.executed = true;
            self.proposals.entry(proposal_id).write(proposal);

            let mut i: usize = 0;
            loop {
                if i >= targets.len() { break; }
                let _ = call_contract_syscall(*targets.at(i), selector!("execute"), *calldatas.at(i));
                i += 1;
            };
        }

        // Implements cancel logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn cancel(ref self: ContractState, proposal_id: u256) {
            let mut proposal = self.proposals.entry(proposal_id).read();
            assert!(get_caller_address() == proposal.proposer, "Only proposer can cancel");
            assert!(get_block_number() < proposal.start_block, "Voting already started");
            
            proposal.canceled = true;
            self.proposals.entry(proposal_id).write(proposal);
        }

        // Returns get proposal from state without mutating storage.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn get_proposal(self: @ContractState, proposal_id: u256) -> Proposal {
            self.proposals.entry(proposal_id).read()
        }
    }

    #[abi(embed_v0)]
    impl GovernancePrivacyImpl of super::IGovernancePrivacy<ContractState> {
        // Updates privacy router configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(!router.is_zero(), "Privacy router required");
            let current = self.privacy_router.read();
            assert!(current.is_zero(), "Privacy router already set");
            self.privacy_router.write(router);
        }

        // Applies submit private governance action after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn submit_private_governance_action(
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
        // Implements hash actions logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn hash_actions(
            self: @ContractState,
            targets: Span<ContractAddress>,
            calldatas: Span<Span<felt252>>
        ) -> felt252 {
            let mut data = array![];
            data.append(targets.len().into());
            let mut i: usize = 0;
            loop {
                if i >= targets.len() { break; }
                let target_felt: felt252 = (*targets.at(i)).into();
                data.append(target_felt);
                let call = *calldatas.at(i);
                data.append(call.len().into());
                let mut j: usize = 0;
                loop {
                    if j >= call.len() { break; }
                    data.append(*call.at(j));
                    j += 1;
                };
                i += 1;
            };
            poseidon_hash_span(data.span())
        }
    }
}
