use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct Stake {
    pub amount: u256,
    pub start_time: u64,
    pub last_claim_time: u64,
    pub accumulated_rewards: u256,
}

#[derive(Drop, Serde, starknet::Store)]
pub struct PoolInfo {
    pub lp_token: ContractAddress,
    pub token0: ContractAddress,
    pub token1: ContractAddress,
    pub apy: u256, 
    pub point_multiplier: u256,
    pub active: bool,
}

#[starknet::interface]
pub trait IERC20<TContractState> {
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256
    ) -> bool;
}

#[starknet::interface]
pub trait ILPStaking<TContractState> {
    fn stake(ref self: TContractState, pool_address: ContractAddress, amount: u256);
    fn unstake(ref self: TContractState, pool_address: ContractAddress, amount: u256);
    fn claim_rewards(ref self: TContractState, pool_address: ContractAddress);
    fn get_pool_info(self: @TContractState, pool_address: ContractAddress) -> PoolInfo;
    fn calculate_rewards(self: @TContractState, user: ContractAddress, pool_address: ContractAddress) -> u256;
    fn add_pool(
        ref self: TContractState, 
        pool_address: ContractAddress, 
        lp_token: ContractAddress,
        token0: ContractAddress,
        token1: ContractAddress,
        apy: u256,
        multiplier: u256
    );
}

#[starknet::contract]
pub mod LPStaking {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_caller_address, get_block_timestamp, get_contract_address};
    use super::{Stake, PoolInfo, ILPStaking, IERC20Dispatcher, IERC20DispatcherTrait};

    const SECONDS_PER_YEAR: u64 = 31536000;
    const BASIS_POINTS: u256 = 10000;

    #[storage]
    pub struct Storage {
        pub lp_pools: Map<ContractAddress, PoolInfo>,
        pub stakes: Map<ContractAddress, Map<ContractAddress, Stake>>,
        pub reward_token: ContractAddress,
        pub owner: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Staked: Staked,
        Unstaked: Unstaked,
        RewardsClaimed: RewardsClaimed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Staked {
        pub user: ContractAddress,
        pub pool: ContractAddress,
        pub amount: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct Unstaked {
        pub user: ContractAddress,
        pub pool: ContractAddress,
        pub amount: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct RewardsClaimed {
        pub user: ContractAddress,
        pub amount: u256
    }

    #[constructor]
    fn constructor(ref self: ContractState, reward_token: ContractAddress, owner: ContractAddress) {
        self.reward_token.write(reward_token);
        self.owner.write(owner);
    }

    #[abi(embed_v0)]
    impl LPStakingImpl of ILPStaking<ContractState> {
        fn stake(ref self: ContractState, pool_address: ContractAddress, amount: u256) {
            let pool = self.lp_pools.entry(pool_address).read();
            assert!(pool.active, "Pool tidak aktif");

            let user = get_caller_address();
            let now = get_block_timestamp();
            let mut current_stake = self.stakes.entry(pool_address).entry(user).read();

            if current_stake.amount > 0 {
                current_stake.accumulated_rewards += self._calculate_pending(@current_stake, pool.apy);
            }

            current_stake.amount += amount;
            current_stake.start_time = now;
            current_stake.last_claim_time = now;

            IERC20Dispatcher { contract_address: pool.lp_token }.transfer_from(
                user, get_contract_address(), amount
            );
            
            self.stakes.entry(pool_address).entry(user).write(current_stake);
            self.emit(Event::Staked(Staked { user, pool: pool_address, amount }));
        }

        fn unstake(ref self: ContractState, pool_address: ContractAddress, amount: u256) {
            let user = get_caller_address();
            let now = get_block_timestamp();
            let pool = self.lp_pools.entry(pool_address).read();
            let mut current_stake = self.stakes.entry(pool_address).entry(user).read();

            assert!(current_stake.amount >= amount, "Saldo LP tidak cukup");

            current_stake.accumulated_rewards += self._calculate_pending(@current_stake, pool.apy);
            current_stake.amount -= amount;
            current_stake.last_claim_time = now;

            self.stakes.entry(pool_address).entry(user).write(current_stake);
            IERC20Dispatcher { contract_address: pool.lp_token }.transfer(user, amount);

            self.emit(Event::Unstaked(Unstaked { user, pool: pool_address, amount }));
        }

        fn claim_rewards(ref self: ContractState, pool_address: ContractAddress) {
            let user = get_caller_address();
            let now = get_block_timestamp();
            let pool = self.lp_pools.entry(pool_address).read();
            let mut current_stake = self.stakes.entry(pool_address).entry(user).read();

            let total_reward = current_stake.accumulated_rewards + self._calculate_pending(@current_stake, pool.apy);
            assert!(total_reward > 0, "Tidak ada reward");

            current_stake.accumulated_rewards = 0;
            current_stake.last_claim_time = now;
            self.stakes.entry(pool_address).entry(user).write(current_stake);

            IERC20Dispatcher { contract_address: self.reward_token.read() }.transfer(user, total_reward);
            self.emit(Event::RewardsClaimed(RewardsClaimed { user, amount: total_reward }));
        }

        fn get_pool_info(self: @ContractState, pool_address: ContractAddress) -> PoolInfo {
            self.lp_pools.entry(pool_address).read()
        }

        fn calculate_rewards(self: @ContractState, user: ContractAddress, pool_address: ContractAddress) -> u256 {
            let stake = self.stakes.entry(pool_address).entry(user).read();
            let pool = self.lp_pools.entry(pool_address).read();
            stake.accumulated_rewards + self._calculate_pending(@stake, pool.apy)
        }

        fn add_pool(
            ref self: ContractState, 
            pool_address: ContractAddress, 
            lp_token: ContractAddress,
            token0: ContractAddress,
            token1: ContractAddress,
            apy: u256,
            multiplier: u256
        ) {
            assert!(get_caller_address() == self.owner.read(), "Unauthorized");
            let info = PoolInfo { lp_token, token0, token1, apy, point_multiplier: multiplier, active: true };
            self.lp_pools.entry(pool_address).write(info);
        }
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        fn _calculate_pending(self: @ContractState, stake: @Stake, apy: u256) -> u256 {
            if *stake.amount == 0 { return 0; }
            let now = get_block_timestamp();
            let time_diff = now - *stake.last_claim_time;
            (*stake.amount * apy * time_diff.into()) / (BASIS_POINTS * SECONDS_PER_YEAR.into())
        }
    }
}