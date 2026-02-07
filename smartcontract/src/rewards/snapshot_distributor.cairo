use starknet::ContractAddress;

#[starknet::interface]
pub trait IStaking<TContractState> {
    fn get_user_stake(self: @TContractState, user: ContractAddress) -> u256;
}

#[starknet::interface]
pub trait ICarelToken<TContractState> {
    fn mint(ref self: TContractState, recipient: ContractAddress, amount: u256);
}

#[starknet::interface]
pub trait ISnapshotDistributor<TContractState> {
    fn submit_merkle_root(ref self: TContractState, epoch: u64, root: felt252);
    fn claim_reward(ref self: TContractState, epoch: u64, amount: u256, proof: Span<felt252>);
    fn is_claimed(self: @TContractState, epoch: u64, user: ContractAddress) -> bool;
}

#[starknet::contract]
pub mod SnapshotDistributor {
    use core::poseidon::PoseidonTrait;
    use core::hash::{HashStateTrait, HashStateExTrait};
    use openzeppelin_merkle_tree::merkle_proof;
    use starknet::storage::*;
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use super::{IStakingDispatcher, IStakingDispatcherTrait, ICarelTokenDispatcher, ICarelTokenDispatcherTrait};

    #[storage]
    pub struct Storage {
        pub token_address: ContractAddress,
        pub staking_contract: ContractAddress,
        pub dev_wallet: ContractAddress,
        pub treasury_wallet: ContractAddress,
        pub backend_signer: ContractAddress,
        pub merkle_roots: Map<u64, felt252>,
        pub claimed: Map<(u64, ContractAddress), bool>,
        pub start_time: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        RewardClaimed: RewardClaimed,
        RootSubmitted: RootSubmitted,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RewardClaimed {
        pub user: ContractAddress,
        pub epoch: u64,
        pub net_amount: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct RootSubmitted {
        pub epoch: u64,
        pub root: felt252
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        token: ContractAddress,
        staking: ContractAddress,
        dev: ContractAddress,
        treasury: ContractAddress,
        signer: ContractAddress,
        protocol_start: u64
    ) {
        self.token_address.write(token);
        self.staking_contract.write(staking);
        self.dev_wallet.write(dev);
        self.treasury_wallet.write(treasury);
        self.backend_signer.write(signer);
        self.start_time.write(protocol_start);
    }

    #[abi(embed_v0)]
    impl SnapshotDistributorImpl of super::ISnapshotDistributor<ContractState> {
        fn submit_merkle_root(ref self: ContractState, epoch: u64, root: felt252) {
            assert!(get_caller_address() == self.backend_signer.read(), "Bukan authorized signer");
            self.merkle_roots.entry(epoch).write(root);
            self.emit(Event::RootSubmitted(RootSubmitted { epoch, root }));
        }

        fn claim_reward(ref self: ContractState, epoch: u64, amount: u256, proof: Span<felt252>) {
            let user = get_caller_address();
            let current_time = get_block_timestamp();
            
            // Epoch duration defined as 30 days (2,592,000 seconds)
            let epoch_expiry = self.start_time.read() + ((epoch + 1) * 2592000);
            assert!(current_time < epoch_expiry, "Reward epoch ini sudah kadaluarsa");
            assert!(!self.claimed.entry((epoch, user)).read(), "Sudah melakukan claim");

            // Minimum staking requirement check
            let staking_disp = IStakingDispatcher { contract_address: self.staking_contract.read() };
            let min_stake: u256 = 100_000_000_000_000_000_000_u256; // 100 Tokens
            assert!(staking_disp.get_user_stake(user) >= min_stake, "Stake tidak mencukupi");

            // Generate leaf and verify Merkle proof using Poseidon
            let leaf = PoseidonTrait::new().update_with(user).update_with(amount).finalize();
            let root = self.merkle_roots.entry(epoch).read();
            assert!(merkle_proof::verify_poseidon(proof, root, leaf), "Merkle proof tidak valid");

            // Calculate 5% total tax (500/10000)
            let total_tax = (amount * 500) / 10000;
            let net_reward = amount - total_tax;

            // Execute minting via ICarelTokenDispatcher
            let token_disp = ICarelTokenDispatcher { contract_address: self.token_address.read() };
            token_disp.mint(user, net_reward);
            token_disp.mint(self.dev_wallet.read(), total_tax / 2);
            token_disp.mint(self.treasury_wallet.read(), total_tax / 2);

            // Update state and emit event
            self.claimed.entry((epoch, user)).write(true);
            self.emit(Event::RewardClaimed(RewardClaimed { user, epoch, net_amount: net_reward }));
        }

        fn is_claimed(self: @ContractState, epoch: u64, user: ContractAddress) -> bool {
            self.claimed.entry((epoch, user)).read()
        }
    }
}