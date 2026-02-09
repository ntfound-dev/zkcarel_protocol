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

/// @title ERC20 Interface
/// @author CAREL Team
/// @notice Minimal ERC20 interface for LP staking transfers.
/// @dev Used for LP token deposits and withdrawals.
#[starknet::interface]
pub trait IERC20<TContractState> {
    /// @notice Transfers tokens to a recipient.
    /// @dev Used for withdrawals and rewards.
    /// @param recipient Recipient address.
    /// @param amount Amount to transfer.
    /// @return success True if transfer succeeded.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    /// @notice Transfers tokens from a sender.
    /// @dev Used for staking deposits.
    /// @param sender Token holder address.
    /// @param recipient Recipient address.
    /// @param amount Amount to transfer.
    /// @return success True if transfer succeeded.
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256
    ) -> bool;
}

/// @title LP Staking Interface
/// @author CAREL Team
/// @notice Defines staking entrypoints for LP tokens.
/// @dev Pool-based staking with per-pool APY.
#[starknet::interface]
pub trait ILPStaking<TContractState> {
    /// @notice Stakes LP tokens in a pool.
    /// @dev Requires pool to be active.
    /// @param pool_address Pool address.
    /// @param amount Amount to stake.
    fn stake(ref self: TContractState, pool_address: ContractAddress, amount: u256);
    /// @notice Unstakes LP tokens from a pool.
    /// @dev Releases principal to the user.
    /// @param pool_address Pool address.
    /// @param amount Amount to unstake.
    fn unstake(ref self: TContractState, pool_address: ContractAddress, amount: u256);
    /// @notice Claims rewards for an LP stake.
    /// @dev Transfers rewards in reward token.
    /// @param pool_address Pool address.
    fn claim_rewards(ref self: TContractState, pool_address: ContractAddress);
    /// @notice Returns pool configuration.
    /// @dev Read-only helper for UI.
    /// @param pool_address Pool address.
    /// @return info Pool info.
    fn get_pool_info(self: @TContractState, pool_address: ContractAddress) -> PoolInfo;
    /// @notice Calculates rewards for an LP stake.
    /// @dev Includes accumulated and pending rewards.
    /// @param user User address.
    /// @param pool_address Pool address.
    /// @return rewards Total rewards.
    fn calculate_rewards(self: @TContractState, user: ContractAddress, pool_address: ContractAddress) -> u256;
    /// @notice Adds a new LP pool.
    /// @dev Owner-only to control supported pools.
    /// @param pool_address Pool address.
    /// @param lp_token LP token address.
    /// @param token0 Token0 address.
    /// @param token1 Token1 address.
    /// @param apy Pool APY in bps.
    /// @param multiplier Point multiplier.
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

/// @title LP Staking Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy entrypoints for LP staking actions.
#[starknet::interface]
pub trait ILPStakingPrivacy<TContractState> {
    /// @notice Sets privacy router address.
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

/// @title LP Staking Contract
/// @author CAREL Team
/// @notice Pool-based LP staking with reward distribution.
/// @dev Tracks per-pool stakes and APY for rewards.
#[starknet::contract]
pub mod LPStaking {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_caller_address, get_block_timestamp, get_contract_address};
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_STAKING;
    use super::{Stake, PoolInfo, ILPStaking, IERC20Dispatcher, IERC20DispatcherTrait};

    const SECONDS_PER_YEAR: u64 = 31536000;
    const BASIS_POINTS: u256 = 10000;

    #[storage]
    pub struct Storage {
        pub lp_pools: Map<ContractAddress, PoolInfo>,
        pub stakes: Map<ContractAddress, Map<ContractAddress, Stake>>,
        pub reward_token: ContractAddress,
        pub owner: ContractAddress,
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

    /// @notice Initializes LP staking.
    /// @dev Sets reward token and owner.
    /// @param reward_token Reward token address.
    /// @param owner Owner/admin address.
    #[constructor]
    fn constructor(ref self: ContractState, reward_token: ContractAddress, owner: ContractAddress) {
        self.reward_token.write(reward_token);
        self.owner.write(owner);
    }

    #[abi(embed_v0)]
    impl LPStakingImpl of ILPStaking<ContractState> {
        /// @notice Stakes LP tokens in a pool.
        /// @dev Requires pool to be active.
        /// @param pool_address Pool address.
        /// @param amount Amount to stake.
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

            let ok = IERC20Dispatcher { contract_address: pool.lp_token }.transfer_from(
                user, get_contract_address(), amount
            );
            assert!(ok, "Token transfer failed");
            
            self.stakes.entry(pool_address).entry(user).write(current_stake);
            self.emit(Event::Staked(Staked { user, pool: pool_address, amount }));
        }

        /// @notice Unstakes LP tokens from a pool.
        /// @dev Releases principal to the user.
        /// @param pool_address Pool address.
        /// @param amount Amount to unstake.
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
            let ok = IERC20Dispatcher { contract_address: pool.lp_token }.transfer(user, amount);
            assert!(ok, "Token transfer failed");

            self.emit(Event::Unstaked(Unstaked { user, pool: pool_address, amount }));
        }

        /// @notice Claims rewards for an LP stake.
        /// @dev Transfers rewards in reward token.
        /// @param pool_address Pool address.
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

            let ok = IERC20Dispatcher { contract_address: self.reward_token.read() }.transfer(user, total_reward);
            assert!(ok, "Token transfer failed");
            self.emit(Event::RewardsClaimed(RewardsClaimed { user, amount: total_reward }));
        }

        /// @notice Returns pool configuration.
        /// @dev Read-only helper for UI.
        /// @param pool_address Pool address.
        /// @return info Pool info.
        fn get_pool_info(self: @ContractState, pool_address: ContractAddress) -> PoolInfo {
            self.lp_pools.entry(pool_address).read()
        }

        /// @notice Calculates rewards for an LP stake.
        /// @dev Includes accumulated and pending rewards.
        /// @param user User address.
        /// @param pool_address Pool address.
        /// @return rewards Total rewards.
        fn calculate_rewards(self: @ContractState, user: ContractAddress, pool_address: ContractAddress) -> u256 {
            let stake = self.stakes.entry(pool_address).entry(user).read();
            let pool = self.lp_pools.entry(pool_address).read();
            stake.accumulated_rewards + self._calculate_pending(@stake, pool.apy)
        }

        /// @notice Adds a new LP pool.
        /// @dev Owner-only to control supported pools.
        /// @param pool_address Pool address.
        /// @param lp_token LP token address.
        /// @param token0 Token0 address.
        /// @param token1 Token1 address.
        /// @param apy Pool APY in bps.
        /// @param multiplier Point multiplier.
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
        /// @notice Calculates pending rewards since last claim.
        /// @dev Uses pool APY and elapsed time.
        fn _calculate_pending(self: @ContractState, stake: @Stake, apy: u256) -> u256 {
            if *stake.amount == 0 { return 0; }
            let now = get_block_timestamp();
            let time_diff = now - *stake.last_claim_time;
            (*stake.amount * apy * time_diff.into()) / (BASIS_POINTS * SECONDS_PER_YEAR.into())
        }
    }

    #[abi(embed_v0)]
    impl LPStakingPrivacyImpl of super::ILPStakingPrivacy<ContractState> {
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Unauthorized owner");
            assert!(!router.is_zero(), "Privacy router required");
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
}
