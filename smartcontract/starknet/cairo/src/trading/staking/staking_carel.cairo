use starknet::ContractAddress;

/// @notice Per-user CAREL staking state including tier and reward accrual checkpoints.
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Stake {
    pub amount: u256,
    pub tier: u8,
    pub start_time: u64,
    pub last_claim_time: u64,
    pub accumulated_rewards: u256,
}

/// @notice Minimal ERC20 interface for staking deposits and reward payouts.
#[starknet::interface]
pub trait IERC20<TContractState> {
    /// @notice Transfers tokens from this contract to `recipient`.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    /// @notice Transfers tokens from `sender` to `recipient` using allowance.
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256
    ) -> bool;
    /// @notice Returns token balance for `account`.
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
}

/// @title IStakingCarel
/// @notice Public staking API for CAREL token positions.
///         Uses tiered APY and a minimum lock period before penalty-free unstake.
#[starknet::interface]
pub trait IStakingCarel<TContractState> {
    /// @notice Stakes CAREL for the caller, compounds pending rewards, and refreshes tier.
    /// @param amount Amount of CAREL to stake.
    fn stake(ref self: TContractState, amount: u256);

    /// @notice Unstakes CAREL for the caller. Applies 10% penalty during the lock period.
    /// @param amount Amount of CAREL to unstake.
    fn unstake(ref self: TContractState, amount: u256);

    /// @notice Claims accrued staking rewards for the caller.
    fn claim_rewards(ref self: TContractState);

    /// @notice Claims rewards for multiple users in one transaction.
    /// @dev Capped at `MAX_BATCH_CLAIM` users per call.
    /// @param users Addresses to claim for.
    fn batch_claim_rewards(ref self: TContractState, users: Span<ContractAddress>);

    /// @notice Returns total rewards (stored + pending) for a position.
    /// @param user User address.
    /// @return Total claimable reward amount.
    fn calculate_rewards(self: @TContractState, user: ContractAddress) -> u256;

    /// @notice Returns current staked amount for the user.
    /// @param user User address.
    /// @return Staked token amount.
    fn get_user_stake(self: @TContractState, user: ContractAddress) -> u256;

    /// @notice Returns full stake state for the user.
    /// @param user User address.
    /// @return Stake struct.
    fn get_stake_info(self: @TContractState, user: ContractAddress) -> Stake;

    /// @notice Updates reward fee configuration.
    /// @dev Callable only by the contract owner. Emits `RewardFeeUpdated`.
    /// @param fee_bps Fee in basis points (max 10000).
    /// @param fee_recipient Address to receive the fee portion.
    fn set_reward_fee(ref self: TContractState, fee_bps: u256, fee_recipient: ContractAddress);

    /// @notice Returns reward fee configuration.
    /// @return (fee_bps, fee_recipient).
    fn get_reward_fee(self: @TContractState) -> (u256, ContractAddress);
}

/// @title IStakingCarelPrivacy
/// @notice Hide Mode hooks for CAREL staking actions through the privacy router.
#[starknet::interface]
pub trait IStakingCarelPrivacy<TContractState> {
    /// @notice Sets the privacy router for private staking actions.
    /// @dev Callable only by the contract owner. Emits `PrivacyRouterUpdated`.
    /// @param router New privacy router address (must be non-zero).
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);

    /// @notice Forwards a nullifier/commitment-bound staking payload to the privacy router.
    /// @dev Nullifiers are replay-protected: each may only be consumed once.
    /// @param old_root Previous Merkle tree root.
    /// @param new_root Updated Merkle tree root after commitments.
    /// @param nullifiers Nullifiers for inputs being spent.
    /// @param commitments New Merkle commitments.
    /// @param public_inputs ZK circuit public inputs.
    /// @param proof Serialized ZK proof.
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

/// @title StakingCarel
/// @notice CAREL staking contract with tier-based APY and early-unstake penalty.
///         Rewards are paid from `reward_pool_address`.
#[starknet::contract]
pub mod StakingCarel {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use starknet::storage::*;
    use core::traits::TryInto;
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::security::reentrancyguard::ReentrancyGuardComponent;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_STAKING;
    use super::{Stake, IStakingCarel, IERC20Dispatcher, IERC20DispatcherTrait};

    const SECONDS_PER_YEAR: u64 = 31536000;
    const MIN_LOCK_PERIOD: u64 = 604800;
    const EPOCH_DURATION: u64 = 86400;
    const BASIS_POINTS: u256 = 10000;
    const MAX_BATCH_CLAIM: u64 = 20;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;
    impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub stakes: Map<ContractAddress, Stake>,
        pub total_staked: u256,
        pub token_address: ContractAddress,
        pub reward_pool_address: ContractAddress,
        pub reward_fee_bps: u256,
        pub fee_recipient: ContractAddress,
        pub privacy_router: ContractAddress,
        pub stake_epoch: Map<ContractAddress, u64>,
        pub min_stake_epoch_duration: u64,
        pub used_nullifiers: Map<felt252, bool>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        pub reentrancy_guard: ReentrancyGuardComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Staked: Staked,
        Unstaked: Unstaked,
        RewardsClaimed: RewardsClaimed,
        StakeEpochInvalidated: StakeEpochInvalidated,
        RewardFeeUpdated: RewardFeeUpdated,
        PrivacyRouterUpdated: PrivacyRouterUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
    }

    /// @notice Emitted when tokens are staked.
    #[derive(Drop, starknet::Event)]
    pub struct Staked {
        pub user: ContractAddress,
        pub amount: u256,
        pub tier: u8,
    }

    /// @notice Emitted when tokens are unstaked.
    #[derive(Drop, starknet::Event)]
    pub struct Unstaked {
        pub user: ContractAddress,
        pub amount: u256,
        pub penalty: u256,
    }

    /// @notice Emitted when staking rewards are claimed.
    #[derive(Drop, starknet::Event)]
    pub struct RewardsClaimed {
        pub user: ContractAddress,
        pub amount: u256,
    }

    /// @notice Emitted when an unstake occurs within the minimum epoch window.
    #[derive(Drop, starknet::Event)]
    pub struct StakeEpochInvalidated {
        pub user: ContractAddress,
        pub epoch: u64,
    }

    /// @notice Emitted when the reward fee configuration is updated.
    #[derive(Drop, starknet::Event)]
    pub struct RewardFeeUpdated {
        pub fee_bps: u256,
        pub fee_recipient: ContractAddress,
    }

    /// @notice Emitted when the privacy router address is updated.
    #[derive(Drop, starknet::Event)]
    pub struct PrivacyRouterUpdated {
        pub router: ContractAddress,
    }

    /// @notice Initializes staking token, reward pool, and owner.
    /// @param owner Initial contract owner (two-step transfer via OZ OwnableComponent).
    /// @param token CAREL token address used for staking deposits.
    /// @param reward_pool Address that funds reward payouts.
    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        token: ContractAddress,
        reward_pool: ContractAddress,
    ) {
        self.ownable.initializer(owner);
        self.token_address.write(token);
        self.reward_pool_address.write(reward_pool);
        self.reward_fee_bps.write(0);
        self.fee_recipient.write(owner);
        self.min_stake_epoch_duration.write(1);
    }

    fn current_epoch(self: @ContractState) -> u64 {
        get_block_timestamp() / EPOCH_DURATION
    }

    #[abi(embed_v0)]
    impl StakingCarelImpl of IStakingCarel<ContractState> {
        /// @inheritdoc IStakingCarel
        fn stake(ref self: ContractState, amount: u256) {
            self.reentrancy_guard.start();
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
            let epoch = current_epoch(@self);
            self.stake_epoch.entry(user).write(epoch);

            let ok = token.transfer_from(user, starknet::get_contract_address(), amount);
            assert!(ok, "Token transfer failed");
            self.stakes.entry(user).write(current_stake);
            self.total_staked.write(self.total_staked.read() + amount);
            self.reentrancy_guard.end();

            self.emit(Event::Staked(Staked { user, amount, tier: current_stake.tier }));
        }

        /// @inheritdoc IStakingCarel
        fn unstake(ref self: ContractState, amount: u256) {
            self.reentrancy_guard.start();
            let user = get_caller_address();
            let now = get_block_timestamp();
            let mut current_stake = self.stakes.entry(user).read();
            assert!(current_stake.amount >= amount, "Insufficient stake balance");

            let pending = self._calculate_pending_rewards(@current_stake);
            current_stake.accumulated_rewards += pending;
            current_stake.last_claim_time = now;

            let mut penalty: u256 = 0;
            if now < current_stake.start_time + MIN_LOCK_PERIOD {
                penalty = (amount * 10) / 100;
            }

            let stake_epoch = self.stake_epoch.entry(user).read();
            let current_epoch_val = current_epoch(@self);
            let min_epochs = self.min_stake_epoch_duration.read();
            if current_epoch_val < stake_epoch + min_epochs {
                self.emit(Event::StakeEpochInvalidated(StakeEpochInvalidated { user, epoch: current_epoch_val }));
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
                assert!(ok_penalty, "Penalty transfer failed");
            }
            self.reentrancy_guard.end();

            self.emit(Event::Unstaked(Unstaked { user, amount, penalty }));
        }

        /// @inheritdoc IStakingCarel
        fn claim_rewards(ref self: ContractState) {
            self.reentrancy_guard.start();
            let user = get_caller_address();
            let now = get_block_timestamp();
            _claim_rewards_for_user(ref self, user, now);
            self.reentrancy_guard.end();
        }

        /// @inheritdoc IStakingCarel
        fn batch_claim_rewards(ref self: ContractState, users: Span<ContractAddress>) {
            self.reentrancy_guard.start();
            let now = get_block_timestamp();
            let total: u64 = users.len().into();
            assert!(total <= MAX_BATCH_CLAIM, "Batch too large");
            let mut i: u64 = 0;
            while i < total {
                let idx: u32 = i.try_into().unwrap();
                let user = *users.at(idx);
                _claim_rewards_for_user(ref self, user, now);
                i += 1;
            };
            self.reentrancy_guard.end();
        }

        /// @inheritdoc IStakingCarel
        fn calculate_rewards(self: @ContractState, user: ContractAddress) -> u256 {
            let current_stake = self.stakes.entry(user).read();
            current_stake.accumulated_rewards + self._calculate_pending_rewards(@current_stake)
        }

        /// @inheritdoc IStakingCarel
        fn get_user_stake(self: @ContractState, user: ContractAddress) -> u256 {
            self.stakes.entry(user).read().amount
        }

        /// @inheritdoc IStakingCarel
        fn get_stake_info(self: @ContractState, user: ContractAddress) -> Stake {
            self.stakes.entry(user).read()
        }

        /// @inheritdoc IStakingCarel
        fn set_reward_fee(ref self: ContractState, fee_bps: u256, fee_recipient: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(fee_bps <= BASIS_POINTS, "Fee too high");
            assert!(!fee_recipient.is_zero(), "Fee recipient required");
            self.reward_fee_bps.write(fee_bps);
            self.fee_recipient.write(fee_recipient);
            self.emit(Event::RewardFeeUpdated(RewardFeeUpdated { fee_bps, fee_recipient }));
        }

        /// @inheritdoc IStakingCarel
        fn get_reward_fee(self: @ContractState) -> (u256, ContractAddress) {
            (self.reward_fee_bps.read(), self.fee_recipient.read())
        }
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        /// Maps staked amount to tier thresholds used by the APY schedule.
        fn _calculate_tier(self: @ContractState, amount: u256) -> u8 {
            let one_carel: u256 = 1000000000000000000;
            if amount >= 10000 * one_carel { return 3; }
            if amount >= 1000 * one_carel { return 2; }
            if amount >= 100 * one_carel { return 1; }
            0
        }

        /// Computes linear pending rewards since `last_claim_time`.
        fn _calculate_pending_rewards(self: @ContractState, stake: @Stake) -> u256 {
            if *stake.amount == 0 { return 0; }
            let now = get_block_timestamp();
            let time_diff = now - *stake.last_claim_time;
            let apy_bps: u256 = match *stake.tier {
                1 => 800,
                2 => 1200,
                3 => 1500,
                _ => 0,
            };
            (*stake.amount * apy_bps * time_diff.into()) / (BASIS_POINTS * SECONDS_PER_YEAR.into())
        }
    }

    #[abi(embed_v0)]
    impl StakingCarelPrivacyImpl of super::IStakingCarelPrivacy<ContractState> {
        /// @inheritdoc IStakingCarelPrivacy
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
            self.emit(Event::PrivacyRouterUpdated(PrivacyRouterUpdated { router }));
        }

        /// @inheritdoc IStakingCarelPrivacy
        fn submit_private_staking_action(
            ref self: ContractState,
            old_root: felt252,
            new_root: felt252,
            nullifiers: Span<felt252>,
            commitments: Span<felt252>,
            public_inputs: Span<felt252>,
            proof: Span<felt252>
        ) {
            let total: u64 = nullifiers.len().into();
            let mut i: u64 = 0;
            while i < total {
                let idx: u32 = i.try_into().unwrap();
                let nf = *nullifiers.at(idx);
                assert!(!self.used_nullifiers.entry(nf).read(), "Nullifier already used");
                self.used_nullifiers.entry(nf).write(true);
                i += 1;
            };
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

    /// Internal claim helper reused by `claim_rewards` and `batch_claim_rewards`.
    /// Pulls reward tokens from `reward_pool_address` and resets accrued balance.
    fn _claim_rewards_for_user(
        ref self: ContractState,
        user: ContractAddress,
        now: u64,
    ) -> u256 {
        let mut current_stake = self.stakes.entry(user).read();
        let pending = self._calculate_pending_rewards(@current_stake);
        let total_reward = current_stake.accumulated_rewards + pending;
        if total_reward == 0 {
            return 0;
        }

        let fee_bps = self.reward_fee_bps.read();
        let fee_amount = (total_reward * fee_bps) / BASIS_POINTS;
        if total_reward <= fee_amount {
            return 0;
        }
        let net_reward = total_reward - fee_amount;

        current_stake.accumulated_rewards = 0;
        current_stake.last_claim_time = now;
        self.stakes.entry(user).write(current_stake);

        let token = IERC20Dispatcher { contract_address: self.token_address.read() };
        if fee_amount > 0 {
            let ok_fee = token.transfer_from(self.reward_pool_address.read(), self.fee_recipient.read(), fee_amount);
            assert!(ok_fee, "Fee transfer failed");
        }
        let ok = token.transfer_from(self.reward_pool_address.read(), user, net_reward);
        assert!(ok, "Reward transfer failed");

        self.emit(Event::RewardsClaimed(RewardsClaimed { user, amount: net_reward }));
        net_reward
    }
}
