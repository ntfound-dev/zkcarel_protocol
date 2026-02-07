use starknet::ContractAddress;

// Add Copy to the derivation list
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Stake {
    pub amount: u256,
    pub tier: u8,
    pub start_time: u64,
    pub last_claim_time: u64,
    pub accumulated_rewards: u256,
}

#[starknet::interface]
pub trait IERC20<TContractState> {
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256
    ) -> bool;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
}

#[starknet::interface]
pub trait IStakingCarel<TContractState> {
    fn stake(ref self: TContractState, amount: u256);
    fn unstake(ref self: TContractState, amount: u256);
    fn claim_rewards(ref self: TContractState);
    fn calculate_rewards(self: @TContractState, user: ContractAddress) -> u256;
    fn get_stake_info(self: @TContractState, user: ContractAddress) -> Stake;
}

#[starknet::contract]
pub mod StakingCarel {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use starknet::storage::*;
    use super::{Stake, IStakingCarel, IERC20Dispatcher, IERC20DispatcherTrait};

    const SECONDS_PER_YEAR: u64 = 31536000;
    const MIN_LOCK_PERIOD: u64 = 604800;
    const BASIS_POINTS: u256 = 10000;

    #[storage]
    pub struct Storage {
        pub stakes: Map<ContractAddress, Stake>,
        pub total_staked: u256,
        pub token_address: ContractAddress,
        pub reward_pool_address: ContractAddress,
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
        pub amount: u256,
        pub tier: u8
    }

    #[derive(Drop, starknet::Event)]
    pub struct Unstaked {
        pub user: ContractAddress,
        pub amount: u256,
        pub penalty: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct RewardsClaimed {
        pub user: ContractAddress,
        pub amount: u256
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, token: ContractAddress, reward_pool: ContractAddress
    ) {
        self.token_address.write(token);
        self.reward_pool_address.write(reward_pool);
    }

    #[abi(embed_v0)]
    impl StakingCarelImpl of IStakingCarel<ContractState> {
        fn stake(ref self: ContractState, amount: u256) {
            let user = get_caller_address();
            let now = get_block_timestamp();
            let token = IERC20Dispatcher { contract_address: self.token_address.read() };

            let mut current_stake = self.stakes.entry(user).read();
            
            if current_stake.amount > 0 {
                let pending = self._calculate_pending_rewards(@current_stake);
                current_stake.accumulated_rewards += pending;
            }

            current_stake.amount += amount;
            current_stake.tier = self._calculate_tier(current_stake.amount);
            current_stake.start_time = now;
            current_stake.last_claim_time = now;

            token.transfer_from(user, starknet::get_contract_address(), amount);
            
            // Because Stake now implements Copy, current_stake is copied here, not moved.
            self.stakes.entry(user).write(current_stake);
            self.total_staked.write(self.total_staked.read() + amount);

            // current_stake is still accessible
            self.emit(Staked { user, amount, tier: current_stake.tier });
        }

        fn unstake(ref self: ContractState, amount: u256) {
            let user = get_caller_address();
            let now = get_block_timestamp();
            let mut current_stake = self.stakes.entry(user).read();
            
            assert!(current_stake.amount >= amount, "Saldo stake tidak cukup");

            let pending = self._calculate_pending_rewards(@current_stake);
            current_stake.accumulated_rewards += pending;
            current_stake.last_claim_time = now;

            let mut penalty: u256 = 0;
            if now < current_stake.start_time + MIN_LOCK_PERIOD {
                penalty = (amount * 10) / 100;
            }

            let amount_to_return = amount - penalty;
            current_stake.amount -= amount;
            
            if current_stake.amount > 0 {
                current_stake.tier = self._calculate_tier(current_stake.amount);
            } else {
                current_stake.tier = 0;
            }

            self.stakes.entry(user).write(current_stake);
            self.total_staked.write(self.total_staked.read() - amount);

            let token = IERC20Dispatcher { contract_address: self.token_address.read() };
            token.transfer(user, amount_to_return);
            if penalty > 0 {
                token.transfer(self.reward_pool_address.read(), penalty);
            }

            self.emit(Unstaked { user, amount, penalty });
        }

        fn claim_rewards(ref self: ContractState) {
            let user = get_caller_address();
            let now = get_block_timestamp();
            let mut current_stake = self.stakes.entry(user).read();

            let pending = self._calculate_pending_rewards(@current_stake);
            let total_reward = current_stake.accumulated_rewards + pending;

            assert!(total_reward > 0, "Tidak ada reward untuk diklaim");

            current_stake.accumulated_rewards = 0;
            current_stake.last_claim_time = now;
            self.stakes.entry(user).write(current_stake);

            let token = IERC20Dispatcher { contract_address: self.token_address.read() };
            token.transfer_from(self.reward_pool_address.read(), user, total_reward);

            self.emit(RewardsClaimed { user, amount: total_reward });
        }

        fn calculate_rewards(self: @ContractState, user: ContractAddress) -> u256 {
            let current_stake = self.stakes.entry(user).read();
            current_stake.accumulated_rewards + self._calculate_pending_rewards(@current_stake)
        }

        fn get_stake_info(self: @ContractState, user: ContractAddress) -> Stake {
            self.stakes.entry(user).read()
        }
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        fn _calculate_tier(self: @ContractState, amount: u256) -> u8 {
            let one_carel: u256 = 1000000000000000000;
            if amount >= 10000 * one_carel { return 3; }
            if amount >= 1000 * one_carel { return 2; }
            if amount >= 100 * one_carel { return 1; }
            
            panic!("Minimal stake adalah 100 CAREL")
        }

        fn _calculate_pending_rewards(self: @ContractState, stake: @Stake) -> u256 {
            if *stake.amount == 0 { return 0; }
            
            let now = get_block_timestamp();
            let time_diff = now - *stake.last_claim_time;
            
            let apy_bps: u256 = match *stake.tier {
                1 => 1000,
                2 => 1500,
                3 => 2000,
                _ => 0
            };

            (*stake.amount * apy_bps * time_diff.into()) / (BASIS_POINTS * SECONDS_PER_YEAR.into())
        }
    }
}