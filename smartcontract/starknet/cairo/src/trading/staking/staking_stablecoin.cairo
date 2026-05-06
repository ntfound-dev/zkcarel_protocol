use starknet::ContractAddress;

/// @notice Per-user, per-token staking position state.
#[derive(Drop, Serde, starknet::Store)]
pub struct Stake {
    pub amount: u256,
    pub last_claim_time: u64,
    pub accumulated_rewards: u256,
}

/// @notice Minimal ERC20 interface for staking transfers.
#[starknet::interface]
pub trait IERC20<TContractState> {
    /// @notice Transfers tokens from this contract to `recipient`.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    /// @notice Transfers tokens from `sender` to `recipient` using allowance.
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256
    ) -> bool;
    /// @notice Returns the token balance for `account`.
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
}

/// @title IStakingStablecoin
/// @notice Public staking API for supported stablecoins.
///         Uses a fixed APY and an owner-managed token allowlist.
#[starknet::interface]
pub trait IStakingStablecoin<TContractState> {
    /// @notice Stakes a stablecoin and updates the caller's accrual checkpoint.
    /// @param token Allowlisted stablecoin address.
    /// @param amount Amount to stake.
    fn stake(ref self: TContractState, token: ContractAddress, amount: u256);

    /// @notice Unstakes principal and preserves accrued rewards.
    /// @param token Stablecoin address of the position.
    /// @param amount Amount to unstake.
    fn unstake(ref self: TContractState, token: ContractAddress, amount: u256);

    /// @notice Claims all accrued rewards for a position.
    /// @param token Stablecoin address of the position.
    fn claim_rewards(ref self: TContractState, token: ContractAddress);

    /// @notice Returns total rewards (stored + pending) for a position.
    /// @param user Staker address.
    /// @param token Stablecoin address.
    /// @return Total claimable reward amount.
    fn calculate_rewards(self: @TContractState, user: ContractAddress, token: ContractAddress) -> u256;

    /// @notice Returns whether a stablecoin is on the allowlist.
    /// @param token Token address to check.
    /// @return true if accepted.
    fn is_accepted_token(self: @TContractState, token: ContractAddress) -> bool;

    /// @notice Adds a stablecoin to the staking allowlist.
    /// @dev Callable only by the contract owner.
    /// @param token Token address to add.
    fn add_stablecoin(ref self: TContractState, token: ContractAddress);

    /// @notice Updates reward fee basis points and recipient.
    /// @dev Callable only by the contract owner. Emits `RewardFeeUpdated`.
    /// @param fee_bps Fee in basis points (max 10000).
    /// @param fee_recipient Address to receive fees.
    fn set_reward_fee(ref self: TContractState, fee_bps: u256, fee_recipient: ContractAddress);

    /// @notice Returns current reward fee configuration.
    /// @return Tuple of (fee_bps, fee_recipient).
    fn get_reward_fee(self: @TContractState) -> (u256, ContractAddress);
}

/// @title IStakingStablecoinPrivacy
/// @notice Hide Mode hooks for stablecoin staking through the privacy router.
#[starknet::interface]
pub trait IStakingStablecoinPrivacy<TContractState> {
    /// @notice Sets the privacy router address.
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

/// @title StakingStablecoin
/// @notice Fixed-APY stablecoin staking contract.
///         Rewards are paid from the shared `reward_token` balance.
#[starknet::contract]
pub mod StakingStablecoin {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_caller_address, get_block_timestamp, get_contract_address};
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::security::reentrancyguard::ReentrancyGuardComponent;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_STAKING;
    use super::{Stake, IStakingStablecoin, IERC20Dispatcher, IERC20DispatcherTrait};

    const SECONDS_PER_YEAR: u64 = 31536000;
    const APY_BPS: u256 = 700; // 7% fixed APY
    const BASIS_POINTS: u256 = 10000;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;
    impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub accepted_tokens: Map<ContractAddress, bool>,
        pub stakes: Map<(ContractAddress, ContractAddress), Stake>,
        pub reward_token: ContractAddress,
        pub reward_fee_bps: u256,
        pub fee_recipient: ContractAddress,
        pub privacy_router: ContractAddress,
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
        RewardFeeUpdated: RewardFeeUpdated,
        PrivacyRouterUpdated: PrivacyRouterUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
    }

    /// @notice Emitted when a user stakes a stablecoin.
    #[derive(Drop, starknet::Event)]
    pub struct Staked {
        pub user: ContractAddress,
        pub token: ContractAddress,
        pub amount: u256
    }

    /// @notice Emitted when a user unstakes a stablecoin.
    #[derive(Drop, starknet::Event)]
    pub struct Unstaked {
        pub user: ContractAddress,
        pub token: ContractAddress,
        pub amount: u256
    }

    /// @notice Emitted when a user claims staking rewards.
    #[derive(Drop, starknet::Event)]
    pub struct RewardsClaimed {
        pub user: ContractAddress,
        pub amount: u256
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

    /// @notice Initializes the reward token dependency and owner authority.
    /// @param owner Initial contract owner (two-step transfer via OZ OwnableComponent).
    /// @param reward_token Reward token address paid to stakers.
    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, reward_token: ContractAddress) {
        self.ownable.initializer(owner);
        self.reward_token.write(reward_token);
        self.reward_fee_bps.write(0);
        self.fee_recipient.write(owner);
    }

    #[abi(embed_v0)]
    impl StakingStablecoinImpl of IStakingStablecoin<ContractState> {
        /// @inheritdoc IStakingStablecoin
        fn stake(ref self: ContractState, token: ContractAddress, amount: u256) {
            self.reentrancy_guard.start();
            assert!(self.accepted_tokens.entry(token).read(), "Token not accepted");
            let user = get_caller_address();
            let now = get_block_timestamp();
            let mut current_stake = self.stakes.entry((user, token)).read();
            if current_stake.amount > 0 {
                current_stake.accumulated_rewards += self._calculate_pending(@current_stake);
            }
            current_stake.amount += amount;
            current_stake.last_claim_time = now;
            let ok = IERC20Dispatcher { contract_address: token }
                .transfer_from(user, get_contract_address(), amount);
            assert!(ok, "Token transfer failed");
            self.stakes.entry((user, token)).write(current_stake);
            self.emit(Event::Staked(Staked { user, token, amount }));
            self.reentrancy_guard.end();
        }

        /// @inheritdoc IStakingStablecoin
        fn unstake(ref self: ContractState, token: ContractAddress, amount: u256) {
            self.reentrancy_guard.start();
            let user = get_caller_address();
            let now = get_block_timestamp();
            let mut current_stake = self.stakes.entry((user, token)).read();
            assert!(current_stake.amount >= amount, "Insufficient balance");
            current_stake.accumulated_rewards += self._calculate_pending(@current_stake);
            current_stake.amount -= amount;
            current_stake.last_claim_time = now;
            self.stakes.entry((user, token)).write(current_stake);
            let ok = IERC20Dispatcher { contract_address: token }.transfer(user, amount);
            assert!(ok, "Token transfer failed");
            self.emit(Event::Unstaked(Unstaked { user, token, amount }));
            self.reentrancy_guard.end();
        }

        /// @inheritdoc IStakingStablecoin
        fn claim_rewards(ref self: ContractState, token: ContractAddress) {
            self.reentrancy_guard.start();
            let user = get_caller_address();
            let now = get_block_timestamp();
            let mut current_stake = self.stakes.entry((user, token)).read();
            let total_reward = current_stake.accumulated_rewards + self._calculate_pending(@current_stake);
            if total_reward == 0 {
                self.reentrancy_guard.end();
                return;
            }
            let fee_bps = self.reward_fee_bps.read();
            let fee_amount = (total_reward * fee_bps) / BASIS_POINTS;
            if total_reward <= fee_amount {
                self.reentrancy_guard.end();
                return;
            }
            let net_reward = total_reward - fee_amount;
            current_stake.accumulated_rewards = 0;
            current_stake.last_claim_time = now;
            self.stakes.entry((user, token)).write(current_stake);
            if fee_amount > 0 {
                let ok_fee = IERC20Dispatcher { contract_address: self.reward_token.read() }
                    .transfer(self.fee_recipient.read(), fee_amount);
                assert!(ok_fee, "Fee transfer failed");
            }
            let ok = IERC20Dispatcher { contract_address: self.reward_token.read() }
                .transfer(user, net_reward);
            assert!(ok, "Token transfer failed");
            self.emit(Event::RewardsClaimed(RewardsClaimed { user, amount: net_reward }));
            self.reentrancy_guard.end();
        }

        /// @inheritdoc IStakingStablecoin
        fn calculate_rewards(self: @ContractState, user: ContractAddress, token: ContractAddress) -> u256 {
            let stake = self.stakes.entry((user, token)).read();
            stake.accumulated_rewards + self._calculate_pending(@stake)
        }

        /// @inheritdoc IStakingStablecoin
        fn is_accepted_token(self: @ContractState, token: ContractAddress) -> bool {
            self.accepted_tokens.entry(token).read()
        }

        /// @inheritdoc IStakingStablecoin
        fn add_stablecoin(ref self: ContractState, token: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!token.is_zero(), "Invalid token");
            self.accepted_tokens.entry(token).write(true);
        }

        /// @inheritdoc IStakingStablecoin
        fn set_reward_fee(ref self: ContractState, fee_bps: u256, fee_recipient: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(fee_bps <= BASIS_POINTS, "Fee too high");
            assert!(!fee_recipient.is_zero(), "Fee recipient required");
            self.reward_fee_bps.write(fee_bps);
            self.fee_recipient.write(fee_recipient);
            self.emit(Event::RewardFeeUpdated(RewardFeeUpdated { fee_bps, fee_recipient }));
        }

        /// @inheritdoc IStakingStablecoin
        fn get_reward_fee(self: @ContractState) -> (u256, ContractAddress) {
            (self.reward_fee_bps.read(), self.fee_recipient.read())
        }
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        /// @notice Computes linear rewards since `last_claim_time` using the fixed APY.
        fn _calculate_pending(self: @ContractState, stake: @Stake) -> u256 {
            if *stake.amount == 0 { return 0; }
            let now = get_block_timestamp();
            let time_diff = now - *stake.last_claim_time;
            (*stake.amount * APY_BPS * time_diff.into()) / (BASIS_POINTS * SECONDS_PER_YEAR.into())
        }
    }

    #[abi(embed_v0)]
    impl StakingStablecoinPrivacyImpl of super::IStakingStablecoinPrivacy<ContractState> {
        /// @inheritdoc IStakingStablecoinPrivacy
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
            self.emit(Event::PrivacyRouterUpdated(PrivacyRouterUpdated { router }));
        }

        /// @inheritdoc IStakingStablecoinPrivacy
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
}
