use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct Stake {
    pub amount: u256,
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
}

#[starknet::interface]
pub trait IBTCStaking<TContractState> {
    fn stake(ref self: TContractState, btc_token: ContractAddress, amount: u256);
    fn unstake(ref self: TContractState, btc_token: ContractAddress, amount: u256);
    fn claim_rewards(ref self: TContractState, btc_token: ContractAddress);
    fn calculate_rewards(self: @TContractState, user: ContractAddress, btc_token: ContractAddress) -> u256;
    fn is_token_accepted(self: @TContractState, btc_token: ContractAddress) -> bool;
    fn add_btc_token(ref self: TContractState, btc_token: ContractAddress);
}

#[starknet::contract]
pub mod BTCStaking {
    use starknet::storage::*;
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp, get_contract_address};
    use super::{Stake, IBTCStaking, IERC20Dispatcher, IERC20DispatcherTrait};

    const SECONDS_PER_YEAR: u64 = 31536000;
    const LOCK_PERIOD: u64 = 1209600; // 14 days
    const APY_BPS: u256 = 1200;       // 12% Fixed APY
    const BASIS_POINTS: u256 = 10000;

    #[storage]
    pub struct Storage {
        pub accepted_btc_tokens: Map<ContractAddress, bool>,
        pub stakes: Map<(ContractAddress, ContractAddress), Stake>,
        pub reward_token_address: ContractAddress,
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
        pub btc_token: ContractAddress,
        pub amount: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct Unstaked {
        pub user: ContractAddress,
        pub btc_token: ContractAddress,
        pub amount: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct RewardsClaimed {
        pub user: ContractAddress,
        pub amount: u256
    }

    #[constructor]
    fn constructor(ref self: ContractState, reward_token: ContractAddress, owner: ContractAddress) {
        self.reward_token_address.write(reward_token);
        self.owner.write(owner);
    }

    #[abi(embed_v0)]
    impl BTCStakingImpl of IBTCStaking<ContractState> {
        fn stake(ref self: ContractState, btc_token: ContractAddress, amount: u256) {
            assert!(self.accepted_btc_tokens.entry(btc_token).read(), "Token BTC tidak didukung");
            
            let user = get_caller_address();
            let now = get_block_timestamp();
            let mut current_stake = self.stakes.entry((user, btc_token)).read();

            if current_stake.amount > 0 {
                current_stake.accumulated_rewards += self._calculate_pending(@current_stake);
            }

            current_stake.amount += amount;
            current_stake.start_time = now;
            current_stake.last_claim_time = now;

            IERC20Dispatcher { contract_address: btc_token }.transfer_from(user, get_contract_address(), amount);
            self.stakes.entry((user, btc_token)).write(current_stake);

            self.emit(Event::Staked(Staked { user, btc_token, amount }));
        }

        fn unstake(ref self: ContractState, btc_token: ContractAddress, amount: u256) {
            let user = get_caller_address();
            let now = get_block_timestamp();
            let mut current_stake = self.stakes.entry((user, btc_token)).read();

            assert!(current_stake.amount >= amount, "Saldo stake tidak cukup");
            assert!(now >= current_stake.start_time + LOCK_PERIOD, "Periode lock 14 hari belum selesai");

            current_stake.accumulated_rewards += self._calculate_pending(@current_stake);
            current_stake.amount -= amount;
            current_stake.last_claim_time = now;

            self.stakes.entry((user, btc_token)).write(current_stake);
            IERC20Dispatcher { contract_address: btc_token }.transfer(user, amount);

            self.emit(Event::Unstaked(Unstaked { user, btc_token, amount }));
        }

        fn claim_rewards(ref self: ContractState, btc_token: ContractAddress) {
            let user = get_caller_address();
            let now = get_block_timestamp();
            let mut current_stake = self.stakes.entry((user, btc_token)).read();

            let total_reward = current_stake.accumulated_rewards + self._calculate_pending(@current_stake);
            assert!(total_reward > 0, "Tidak ada reward");

            current_stake.accumulated_rewards = 0;
            current_stake.last_claim_time = now;
            self.stakes.entry((user, btc_token)).write(current_stake);

            IERC20Dispatcher { contract_address: self.reward_token_address.read() }.transfer(user, total_reward);
            self.emit(Event::RewardsClaimed(RewardsClaimed { user, amount: total_reward }));
        }

        fn calculate_rewards(self: @ContractState, user: ContractAddress, btc_token: ContractAddress) -> u256 {
            let stake = self.stakes.entry((user, btc_token)).read();
            stake.accumulated_rewards + self._calculate_pending(@stake)
        }

        fn is_token_accepted(self: @ContractState, btc_token: ContractAddress) -> bool {
            self.accepted_btc_tokens.entry(btc_token).read()
        }

        fn add_btc_token(ref self: ContractState, btc_token: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Unauthorized");
            self.accepted_btc_tokens.entry(btc_token).write(true);
        }
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        fn _calculate_pending(self: @ContractState, stake: @Stake) -> u256 {
            if *stake.amount == 0 { return 0; }
            let time_diff = get_block_timestamp() - *stake.last_claim_time;
            (*stake.amount * APY_BPS * time_diff.into()) / (BASIS_POINTS * SECONDS_PER_YEAR.into())
        }
    }
}