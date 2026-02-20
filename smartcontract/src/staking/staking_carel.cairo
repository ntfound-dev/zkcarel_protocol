use starknet::ContractAddress;

// Per-user CAREL staking state including tier and reward accrual checkpoints.
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Stake {
    pub amount: u256,
    pub tier: u8,
    pub start_time: u64,
    pub last_claim_time: u64,
    pub accumulated_rewards: u256,
}

// Minimal ERC20 interface for staking transfers.
// Used for staking deposits and reward payouts.
#[starknet::interface]
pub trait IERC20<TContractState> {
    // Transfers tokens from this contract to `recipient`.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    // Transfers tokens from `sender` to `recipient` using allowance.
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256
    ) -> bool;
    // Returns token balance for `account`.
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
}

// Public staking API for CAREL token positions.
// Uses tiered APY and a minimum lock period before penalty-free unstake.
#[starknet::interface]
pub trait IStakingCarel<TContractState> {
    // Stakes assets and updates caller position.
    fn stake(ref self: TContractState, amount: u256);
    // Unstakes assets and updates caller position.
    fn unstake(ref self: TContractState, amount: u256);
    // Claims accrued staking rewards.
    fn claim_rewards(ref self: TContractState);
    // Claims rewards for multiple users in one transaction.
    fn batch_claim_rewards(ref self: TContractState, users: Span<ContractAddress>);
    // Returns total rewards (stored + pending) for a position.
    fn calculate_rewards(self: @TContractState, user: ContractAddress) -> u256;
    // Returns current staked amount for the user.
    fn get_user_stake(self: @TContractState, user: ContractAddress) -> u256;
    // Returns full stake state for the user.
    fn get_stake_info(self: @TContractState, user: ContractAddress) -> Stake;
}

// Hide Mode hooks for staking actions submitted through the privacy router.
#[starknet::interface]
pub trait IStakingCarelPrivacy<TContractState> {
    // Sets the privacy router used for Hide Mode staking actions.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Forwards nullifier/commitment-bound staking payload to the privacy router.
    fn submit_private_staking_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

// CAREL staking contract with tier-based APY and early-unstake penalty.
// Rewards are paid from `reward_pool_address`.
#[starknet::contract]
pub mod StakingCarel {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use starknet::storage::*;
    use core::traits::TryInto;
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_STAKING;
    use super::{Stake, IStakingCarel, IERC20Dispatcher, IERC20DispatcherTrait};

    const SECONDS_PER_YEAR: u64 = 31536000;
    const MIN_LOCK_PERIOD: u64 = 604800;
    const BASIS_POINTS: u256 = 10000;
    const MAX_BATCH_CLAIM: u64 = 20;

    #[storage]
    pub struct Storage {
        pub stakes: Map<ContractAddress, Stake>,
        pub total_staked: u256,
        pub token_address: ContractAddress,
        pub reward_pool_address: ContractAddress,
        pub privacy_router: ContractAddress,
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

    // Initializes staking token and reward funding pool dependencies.
    #[constructor]
    // Initializes contract storage during deployment.
    fn constructor(
        ref self: ContractState, token: ContractAddress, reward_pool: ContractAddress
    ) {
        self.token_address.write(token);
        self.reward_pool_address.write(reward_pool);
    }

    #[abi(embed_v0)]
    impl StakingCarelImpl of IStakingCarel<ContractState> {
        // Stakes CAREL for caller, compounds pending rewards, and refreshes tier.
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

            let ok = token.transfer_from(user, starknet::get_contract_address(), amount);
            assert!(ok, "Token transfer failed");
            
            // Persist updated position and global total.
            self.stakes.entry(user).write(current_stake);
            self.total_staked.write(self.total_staked.read() + amount);

            self.emit(Staked { user, amount, tier: current_stake.tier });
        }

        // Unstakes CAREL for caller and applies 10% penalty during lock period.
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
            let ok = token.transfer(user, amount_to_return);
            assert!(ok, "Token transfer failed");
            if penalty > 0 {
                let ok_penalty = token.transfer(self.reward_pool_address.read(), penalty);
                assert!(ok_penalty, "Token transfer failed");
            }

            self.emit(Unstaked { user, amount, penalty });
        }

        // Claims caller rewards from reward pool into user wallet.
        fn claim_rewards(ref self: ContractState) {
            let user = get_caller_address();
            let now = get_block_timestamp();
            let amount = _claim_rewards_for_user(ref self, user, now);
            assert!(amount > 0, "Tidak ada reward untuk diklaim");
        }

        // Claims rewards for multiple users, capped by `MAX_BATCH_CLAIM`.
        fn batch_claim_rewards(ref self: ContractState, users: Span<ContractAddress>) {
            let now = get_block_timestamp();
            let total: u64 = users.len().into();
            assert!(total <= MAX_BATCH_CLAIM, "Batch too large");

            let mut i: u64 = 0;
            while i < total {
                let idx: u32 = i.try_into().unwrap();
                let user = *users.at(idx);
                let _ = _claim_rewards_for_user(ref self, user, now);
                i += 1;
            };
        }

        // Returns total claimable rewards (stored rewards + current pending).
        fn calculate_rewards(self: @ContractState, user: ContractAddress) -> u256 {
            let current_stake = self.stakes.entry(user).read();
            current_stake.accumulated_rewards + self._calculate_pending_rewards(@current_stake)
        }

        // Returns current staked amount for the user.
        fn get_user_stake(self: @ContractState, user: ContractAddress) -> u256 {
            self.stakes.entry(user).read().amount
        }

        // Returns full stake state for the user.
        fn get_stake_info(self: @ContractState, user: ContractAddress) -> Stake {
            self.stakes.entry(user).read()
        }
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        // Maps staked amount to tier thresholds used by APY schedule.
        fn _calculate_tier(self: @ContractState, amount: u256) -> u8 {
            let one_carel: u256 = 1000000000000000000;
            if amount >= 10000 * one_carel { return 3; }
            if amount >= 1000 * one_carel { return 2; }
            if amount >= 100 * one_carel { return 1; }
            
            panic!("Minimal stake adalah 100 CAREL")
        }

        // Computes linear pending rewards since `last_claim_time`.
        fn _calculate_pending_rewards(self: @ContractState, stake: @Stake) -> u256 {
            if *stake.amount == 0 { return 0; }
            
            let now = get_block_timestamp();
            let time_diff = now - *stake.last_claim_time;
            
            let apy_bps: u256 = match *stake.tier {
                1 => 800,
                2 => 1200,
                3 => 1500,
                _ => 0
            };

            (*stake.amount * apy_bps * time_diff.into()) / (BASIS_POINTS * SECONDS_PER_YEAR.into())
        }
    }

    #[abi(embed_v0)]
    impl StakingCarelPrivacyImpl of super::IStakingCarelPrivacy<ContractState> {
        // Sets privacy router for Hide Mode staking; can be configured only once.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(!router.is_zero(), "Privacy router required");
            let current = self.privacy_router.read();
            assert!(current.is_zero(), "Privacy router already set");
            self.privacy_router.write(router);
        }

        // Forwards private staking payload to privacy router for proof validation.
        // `nullifiers` prevent replay and `commitments` bind intended state transition.
        fn submit_private_staking_action(
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
                ACTION_STAKING,
                old_root,
                new_root,
                nullifiers,
                commitments,
                public_inputs,
                proof
            );
        }
    }

    // Internal claim helper reused by single and batch claim paths.
    // Pulls reward tokens from `reward_pool_address` and resets accrued balance.
    fn _claim_rewards_for_user(
        ref self: ContractState,
        user: ContractAddress,
        now: u64
    ) -> u256 {
        let mut current_stake = self.stakes.entry(user).read();
        let pending = self._calculate_pending_rewards(@current_stake);
        let total_reward = current_stake.accumulated_rewards + pending;

        if total_reward == 0 {
            return 0;
        }

        current_stake.accumulated_rewards = 0;
        current_stake.last_claim_time = now;
        self.stakes.entry(user).write(current_stake);

        let token = IERC20Dispatcher { contract_address: self.token_address.read() };
        let ok = token.transfer_from(self.reward_pool_address.read(), user, total_reward);
        assert!(ok, "Token transfer failed");

        self.emit(RewardsClaimed { user, amount: total_reward });
        total_reward
    }
}
