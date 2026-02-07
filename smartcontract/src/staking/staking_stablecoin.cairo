use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct Stake {
    pub amount: u256,
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
pub trait IStakingStablecoin<TContractState> {
    fn stake(ref self: TContractState, token: ContractAddress, amount: u256);
    fn unstake(ref self: TContractState, token: ContractAddress, amount: u256);
    fn claim_rewards(ref self: TContractState, token: ContractAddress);
    fn calculate_rewards(self: @TContractState, user: ContractAddress, token: ContractAddress) -> u256;
    fn is_accepted_token(self: @TContractState, token: ContractAddress) -> bool;
    fn add_stablecoin(ref self: TContractState, token: ContractAddress);
}

#[starknet::contract]
pub mod StakingStablecoin {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_caller_address, get_block_timestamp, get_contract_address};
    use super::{Stake, IStakingStablecoin, IERC20Dispatcher, IERC20DispatcherTrait};

    const SECONDS_PER_YEAR: u64 = 31536000;
    const APY_BPS: u256 = 500; // 5% Fixed APY
    const BASIS_POINTS: u256 = 10000;

    #[storage]
    pub struct Storage {
        pub accepted_tokens: Map<ContractAddress, bool>,
        pub stakes: Map<(ContractAddress, ContractAddress), Stake>,
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
        pub token: ContractAddress,
        pub amount: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct Unstaked {
        pub user: ContractAddress,
        pub token: ContractAddress,
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
    impl StakingStablecoinImpl of IStakingStablecoin<ContractState> {
        fn stake(ref self: ContractState, token: ContractAddress, amount: u256) {
            assert!(self.accepted_tokens.entry(token).read(), "Token tidak didukung");
            
            let user = get_caller_address();
            let now = get_block_timestamp();
            let mut current_stake = self.stakes.entry((user, token)).read();

            if current_stake.amount > 0 {
                current_stake.accumulated_rewards += self._calculate_pending(@current_stake);
            }

            current_stake.amount += amount;
            current_stake.last_claim_time = now;

            IERC20Dispatcher { contract_address: token }.transfer_from(user, get_contract_address(), amount);
            self.stakes.entry((user, token)).write(current_stake);

            // Correct emission syntax: Event::Variant(Struct)
            self.emit(Event::Staked(Staked { user, token, amount }));
        }

        fn unstake(ref self: ContractState, token: ContractAddress, amount: u256) {
            let user = get_caller_address();
            let now = get_block_timestamp();
            let mut current_stake = self.stakes.entry((user, token)).read();

            assert!(current_stake.amount >= amount, "Saldo tidak cukup");

            current_stake.accumulated_rewards += self._calculate_pending(@current_stake);
            current_stake.amount -= amount;
            current_stake.last_claim_time = now;

            self.stakes.entry((user, token)).write(current_stake);
            IERC20Dispatcher { contract_address: token }.transfer(user, amount);

            self.emit(Event::Unstaked(Unstaked { user, token, amount }));
        }

        fn claim_rewards(ref self: ContractState, token: ContractAddress) {
            let user = get_caller_address();
            let now = get_block_timestamp();
            let mut current_stake = self.stakes.entry((user, token)).read();

            let total_reward = current_stake.accumulated_rewards + self._calculate_pending(@current_stake);
            assert!(total_reward > 0, "Tidak ada reward");

            current_stake.accumulated_rewards = 0;
            current_stake.last_claim_time = now;
            self.stakes.entry((user, token)).write(current_stake);

            IERC20Dispatcher { contract_address: self.reward_token.read() }.transfer(user, total_reward);
            self.emit(Event::RewardsClaimed(RewardsClaimed { user, amount: total_reward }));
        }

        fn calculate_rewards(self: @ContractState, user: ContractAddress, token: ContractAddress) -> u256 {
            let stake = self.stakes.entry((user, token)).read();
            stake.accumulated_rewards + self._calculate_pending(@stake)
        }

        fn is_accepted_token(self: @ContractState, token: ContractAddress) -> bool {
            self.accepted_tokens.entry(token).read()
        }

        fn add_stablecoin(ref self: ContractState, token: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Unauthorized");
            self.accepted_tokens.entry(token).write(true);
        }
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        fn _calculate_pending(self: @ContractState, stake: @Stake) -> u256 {
            if *stake.amount == 0 { return 0; }
            let now = get_block_timestamp();
            let time_diff = now - *stake.last_claim_time;
            
            (*stake.amount * APY_BPS * time_diff.into()) / (BASIS_POINTS * SECONDS_PER_YEAR.into())
        }
    }
}