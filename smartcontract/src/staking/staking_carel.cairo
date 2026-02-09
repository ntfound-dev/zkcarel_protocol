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

/// @title ERC20 Interface
/// @author CAREL Team
/// @notice Minimal ERC20 interface for staking transfers.
/// @dev Used for staking deposits and reward payouts.
#[starknet::interface]
pub trait IERC20<TContractState> {
    /// @notice Transfers tokens to a recipient.
    /// @dev Used for withdrawals and penalties.
    /// @param recipient Recipient address.
    /// @param amount Amount to transfer.
    /// @return success True if transfer succeeded.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    /// @notice Transfers tokens from a sender.
    /// @dev Used for staking deposits and reward payouts.
    /// @param sender Token holder address.
    /// @param recipient Recipient address.
    /// @param amount Amount to transfer.
    /// @return success True if transfer succeeded.
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256
    ) -> bool;
    /// @notice Returns token balance of an account.
    /// @dev Read-only helper.
    /// @param account Account address.
    /// @return balance Token balance.
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
}

/// @title CAREL Staking Interface
/// @author CAREL Team
/// @notice Defines staking entrypoints for CAREL token.
/// @dev Tiered APY with minimum lock period.
#[starknet::interface]
pub trait IStakingCarel<TContractState> {
    /// @notice Stakes CAREL tokens.
    /// @dev Updates tier and accumulates pending rewards.
    /// @param amount Amount to stake.
    fn stake(ref self: TContractState, amount: u256);
    /// @notice Unstakes CAREL tokens.
    /// @dev Applies early withdrawal penalty.
    /// @param amount Amount to unstake.
    fn unstake(ref self: TContractState, amount: u256);
    /// @notice Claims accumulated staking rewards.
    /// @dev Transfers rewards from reward pool.
    fn claim_rewards(ref self: TContractState);
    /// @notice Claims rewards for multiple users in one call.
    /// @dev Bounded batch to reduce per-user tx overhead.
    /// @param users Users to claim for.
    fn batch_claim_rewards(ref self: TContractState, users: Span<ContractAddress>);
    /// @notice Calculates total rewards for a user.
    /// @dev Includes accumulated and pending rewards.
    /// @param user User address.
    /// @return rewards Total rewards.
    fn calculate_rewards(self: @TContractState, user: ContractAddress) -> u256;
    /// @notice Returns staked amount for a user.
    /// @dev Read-only helper for UI.
    /// @param user User address.
    /// @return amount Staked amount.
    fn get_user_stake(self: @TContractState, user: ContractAddress) -> u256;
    /// @notice Returns staking info for a user.
    /// @dev Read-only helper for UI and audits.
    /// @param user User address.
    /// @return stake Stake data.
    fn get_stake_info(self: @TContractState, user: ContractAddress) -> Stake;
}

/// @title CAREL Staking Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy entrypoints for staking actions.
#[starknet::interface]
pub trait IStakingCarelPrivacy<TContractState> {
    /// @notice Sets privacy router address (one-time init).
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private staking action proof.
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

/// @title CAREL Staking Contract
/// @author CAREL Team
/// @notice Tiered staking for CAREL token with rewards.
/// @dev Applies lock period penalty and tiered APY.
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

    /// @notice Initializes CAREL staking.
    /// @dev Sets staking token and reward pool addresses.
    /// @param token CAREL token address.
    /// @param reward_pool Reward pool address.
    #[constructor]
    fn constructor(
        ref self: ContractState, token: ContractAddress, reward_pool: ContractAddress
    ) {
        self.token_address.write(token);
        self.reward_pool_address.write(reward_pool);
    }

    #[abi(embed_v0)]
    impl StakingCarelImpl of IStakingCarel<ContractState> {
        /// @notice Stakes CAREL tokens.
        /// @dev Updates tier and accumulates pending rewards.
        /// @param amount Amount to stake.
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
            
            // Because Stake now implements Copy, current_stake is copied here, not moved.
            self.stakes.entry(user).write(current_stake);
            self.total_staked.write(self.total_staked.read() + amount);

            // current_stake is still accessible
            self.emit(Staked { user, amount, tier: current_stake.tier });
        }

        /// @notice Unstakes CAREL tokens.
        /// @dev Applies early withdrawal penalty.
        /// @param amount Amount to unstake.
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

        /// @notice Claims accumulated staking rewards.
        /// @dev Transfers rewards from reward pool.
        fn claim_rewards(ref self: ContractState) {
            let user = get_caller_address();
            let now = get_block_timestamp();
            let amount = _claim_rewards_for_user(ref self, user, now);
            assert!(amount > 0, "Tidak ada reward untuk diklaim");
        }

        /// @notice Claims rewards for multiple users in one call.
        /// @dev Skips users with zero rewards.
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

        /// @notice Calculates total rewards for a user.
        /// @dev Includes accumulated and pending rewards.
        /// @param user User address.
        /// @return rewards Total rewards.
        fn calculate_rewards(self: @ContractState, user: ContractAddress) -> u256 {
            let current_stake = self.stakes.entry(user).read();
            current_stake.accumulated_rewards + self._calculate_pending_rewards(@current_stake)
        }

        /// @notice Returns staked amount for a user.
        /// @dev Read-only helper for UI.
        /// @param user User address.
        /// @return amount Staked amount.
        fn get_user_stake(self: @ContractState, user: ContractAddress) -> u256 {
            self.stakes.entry(user).read().amount
        }

        /// @notice Returns staking info for a user.
        /// @dev Read-only helper for UI and audits.
        /// @param user User address.
        /// @return stake Stake data.
        fn get_stake_info(self: @ContractState, user: ContractAddress) -> Stake {
            self.stakes.entry(user).read()
        }
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        /// @notice Calculates staking tier based on amount.
        /// @dev Enforces minimum stake requirement.
        fn _calculate_tier(self: @ContractState, amount: u256) -> u8 {
            let one_carel: u256 = 1000000000000000000;
            if amount >= 10000 * one_carel { return 3; }
            if amount >= 1000 * one_carel { return 2; }
            if amount >= 100 * one_carel { return 1; }
            
            panic!("Minimal stake adalah 100 CAREL")
        }

        /// @notice Calculates pending rewards since last claim.
        /// @dev Uses tier-specific APY and elapsed time.
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
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(!router.is_zero(), "Privacy router required");
            let current = self.privacy_router.read();
            assert!(current.is_zero(), "Privacy router already set");
            self.privacy_router.write(router);
        }

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
