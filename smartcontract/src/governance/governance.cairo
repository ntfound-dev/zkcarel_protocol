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

#[starknet::interface]
pub trait IGovernance<TContractState> {
    fn propose(
        ref self: TContractState, 
        targets: Span<ContractAddress>, 
        calldatas: Span<Span<felt252>>, 
        description: ByteArray
    ) -> u256;
    fn vote(ref self: TContractState, proposal_id: u256, support: u8);
    fn execute(ref self: TContractState, proposal_id: u256, targets: Span<ContractAddress>, calldatas: Span<Span<felt252>>);
    fn cancel(ref self: TContractState, proposal_id: u256);
    fn get_proposal(self: @TContractState, proposal_id: u256) -> Proposal;
}

#[starknet::contract]
pub mod Governance {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_caller_address, get_block_number};
    use starknet::syscalls::call_contract_syscall;
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
    }

    #[constructor]
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
        fn propose(
            ref self: ContractState, 
            targets: Span<ContractAddress>, 
            calldatas: Span<Span<felt252>>, 
            description: ByteArray
        ) -> u256 {
            let id = self.proposal_count.read() + 1;
            let start = get_block_number() + self.voting_delay.read();
            let end = start + self.voting_period.read();

            let new_proposal = Proposal {
                id,
                proposer: get_caller_address(),
                description,
                actions_hash: 0,
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

        fn execute(
            ref self: ContractState, 
            proposal_id: u256, 
            targets: Span<ContractAddress>, 
            calldatas: Span<Span<felt252>>
        ) {
            let mut proposal = self.proposals.entry(proposal_id).read();
            assert!(proposal.for_votes > proposal.against_votes, "Proposal did not pass");
            assert!(!proposal.executed, "Already executed");

            proposal.executed = true;
            self.proposals.entry(proposal_id).write(proposal);

            let mut i: usize = 0;
            loop {
                if i >= targets.len() { break; }
                let _ = call_contract_syscall(*targets.at(i), selector!("execute"), *calldatas.at(i));
                i += 1;
            };
        }

        fn cancel(ref self: ContractState, proposal_id: u256) {
            let mut proposal = self.proposals.entry(proposal_id).read();
            assert!(get_caller_address() == proposal.proposer, "Only proposer can cancel");
            assert!(get_block_number() < proposal.start_block, "Voting already started");
            
            proposal.canceled = true;
            self.proposals.entry(proposal_id).write(proposal);
        }

        fn get_proposal(self: @ContractState, proposal_id: u256) -> Proposal {
            self.proposals.entry(proposal_id).read()
        }
    }
}

