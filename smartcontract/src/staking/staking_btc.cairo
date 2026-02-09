use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
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
/// @dev Used for BTC wrapper tokens and reward payouts.
#[starknet::interface]
pub trait IERC20<TContractState> {
    /// @notice Transfers tokens to a recipient.
    /// @dev Used for withdrawals.
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

/// @title BTC Staking Interface
/// @author CAREL Team
/// @notice Defines staking entrypoints for BTC wrapper tokens.
/// @dev Supports multiple BTC-wrapped tokens.
#[starknet::interface]
pub trait IBTCStaking<TContractState> {
    /// @notice Stakes a supported BTC token.
    /// @dev Records stake and tier.
    /// @param btc_token BTC token address.
    /// @param amount Amount to stake.
    fn stake(ref self: TContractState, btc_token: ContractAddress, amount: u256);
    /// @notice Unstakes a supported BTC token.
    /// @dev Enforces lock period.
    /// @param btc_token BTC token address.
    /// @param amount Amount to unstake.
    fn unstake(ref self: TContractState, btc_token: ContractAddress, amount: u256);
    /// @notice Claims rewards for a BTC stake.
    /// @dev Transfers rewards in reward token.
    /// @param btc_token BTC token address.
    fn claim_rewards(ref self: TContractState, btc_token: ContractAddress);
    /// @notice Calculates rewards for a BTC stake.
    /// @dev Includes accumulated and pending rewards.
    /// @param user User address.
    /// @param btc_token BTC token address.
    /// @return rewards Total rewards.
    fn calculate_rewards(self: @TContractState, user: ContractAddress, btc_token: ContractAddress) -> u256;
    /// @notice Checks if a BTC token is accepted.
    /// @dev Read-only helper for UI.
    /// @param btc_token BTC token address.
    /// @return accepted True if supported.
    fn is_token_accepted(self: @TContractState, btc_token: ContractAddress) -> bool;
    /// @notice Adds a BTC token to the accepted list.
    /// @dev Owner-only to control supported tokens.
    /// @param btc_token BTC token address.
    fn add_btc_token(ref self: TContractState, btc_token: ContractAddress);
}

/// @title BTC Staking Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy entrypoints for BTC staking actions.
#[starknet::interface]
pub trait IBTCStakingPrivacy<TContractState> {
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

/// @title BTC Staking Contract
/// @author CAREL Team
/// @notice Tiered staking for BTC wrapper tokens.
/// @dev Enforces lock period and tiered APY.
#[starknet::contract]
pub mod BTCStaking {
    use starknet::storage::*;
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp, get_contract_address};
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_STAKING;
    use super::{Stake, IBTCStaking, IERC20Dispatcher, IERC20DispatcherTrait};

    const SECONDS_PER_YEAR: u64 = 31536000;
    const LOCK_PERIOD: u64 = 1209600; // 14 days
    const BASIS_POINTS: u256 = 10000;

    #[storage]
    pub struct Storage {
        pub accepted_btc_tokens: Map<ContractAddress, bool>,
        pub stakes: Map<(ContractAddress, ContractAddress), Stake>,
        pub reward_token_address: ContractAddress,
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

    /// @notice Initializes BTC staking.
    /// @dev Sets reward token and owner.
    /// @param reward_token Reward token address.
    /// @param owner Owner/admin address.
    #[constructor]
    fn constructor(ref self: ContractState, reward_token: ContractAddress, owner: ContractAddress) {
        self.reward_token_address.write(reward_token);
        self.owner.write(owner);
    }

    #[abi(embed_v0)]
    impl BTCStakingImpl of IBTCStaking<ContractState> {
        /// @notice Stakes a supported BTC token.
        /// @dev Records stake and tier.
        /// @param btc_token BTC token address.
        /// @param amount Amount to stake.
        fn stake(ref self: ContractState, btc_token: ContractAddress, amount: u256) {
            assert!(self.accepted_btc_tokens.entry(btc_token).read(), "Token BTC tidak didukung");
            
            let user = get_caller_address();
            let now = get_block_timestamp();
            let mut current_stake = self.stakes.entry((user, btc_token)).read();

            if current_stake.amount > 0 {
                current_stake.accumulated_rewards += self._calculate_pending(@current_stake);
            }

            current_stake.amount += amount;
            current_stake.tier = self._calculate_tier(current_stake.amount);
            current_stake.start_time = now;
            current_stake.last_claim_time = now;

            let ok = IERC20Dispatcher { contract_address: btc_token }.transfer_from(user, get_contract_address(), amount);
            assert!(ok, "Token transfer failed");
            self.stakes.entry((user, btc_token)).write(current_stake);

            self.emit(Event::Staked(Staked { user, btc_token, amount }));
        }

        /// @notice Unstakes a supported BTC token.
        /// @dev Enforces lock period.
        /// @param btc_token BTC token address.
        /// @param amount Amount to unstake.
        fn unstake(ref self: ContractState, btc_token: ContractAddress, amount: u256) {
            let user = get_caller_address();
            let now = get_block_timestamp();
            let mut current_stake = self.stakes.entry((user, btc_token)).read();

            assert!(current_stake.amount >= amount, "Saldo stake tidak cukup");
            assert!(now >= current_stake.start_time + LOCK_PERIOD, "Periode lock 14 hari belum selesai");

            current_stake.accumulated_rewards += self._calculate_pending(@current_stake);
            current_stake.amount -= amount;
            current_stake.last_claim_time = now;

            if current_stake.amount > 0 {
                current_stake.tier = self._calculate_tier(current_stake.amount);
            } else {
                current_stake.tier = 0;
            }

            self.stakes.entry((user, btc_token)).write(current_stake);
            let ok = IERC20Dispatcher { contract_address: btc_token }.transfer(user, amount);
            assert!(ok, "Token transfer failed");

            self.emit(Event::Unstaked(Unstaked { user, btc_token, amount }));
        }

        /// @notice Claims rewards for a BTC stake.
        /// @dev Transfers rewards in reward token.
        /// @param btc_token BTC token address.
        fn claim_rewards(ref self: ContractState, btc_token: ContractAddress) {
            let user = get_caller_address();
            let now = get_block_timestamp();
            let mut current_stake = self.stakes.entry((user, btc_token)).read();

            let total_reward = current_stake.accumulated_rewards + self._calculate_pending(@current_stake);
            assert!(total_reward > 0, "Tidak ada reward");

            current_stake.accumulated_rewards = 0;
            current_stake.last_claim_time = now;
            self.stakes.entry((user, btc_token)).write(current_stake);

            let ok = IERC20Dispatcher { contract_address: self.reward_token_address.read() }.transfer(user, total_reward);
            assert!(ok, "Token transfer failed");
            self.emit(Event::RewardsClaimed(RewardsClaimed { user, amount: total_reward }));
        }

        /// @notice Calculates rewards for a BTC stake.
        /// @dev Includes accumulated and pending rewards.
        /// @param user User address.
        /// @param btc_token BTC token address.
        /// @return rewards Total rewards.
        fn calculate_rewards(self: @ContractState, user: ContractAddress, btc_token: ContractAddress) -> u256 {
            let stake = self.stakes.entry((user, btc_token)).read();
            stake.accumulated_rewards + self._calculate_pending(@stake)
        }

        /// @notice Checks if a BTC token is accepted.
        /// @dev Read-only helper for UI.
        /// @param btc_token BTC token address.
        /// @return accepted True if supported.
        fn is_token_accepted(self: @ContractState, btc_token: ContractAddress) -> bool {
            self.accepted_btc_tokens.entry(btc_token).read()
        }

        /// @notice Adds a BTC token to the accepted list.
        /// @dev Owner-only to control supported tokens.
        /// @param btc_token BTC token address.
        fn add_btc_token(ref self: ContractState, btc_token: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Unauthorized");
            self.accepted_btc_tokens.entry(btc_token).write(true);
        }
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        /// @notice Calculates staking tier based on amount.
        /// @dev Used to apply tiered APY.
        fn _calculate_tier(self: @ContractState, amount: u256) -> u8 {
            let one_token: u256 = 1000000000000000000;
            if amount >= 10000 * one_token { return 3; }
            if amount >= 1000 * one_token { return 2; }
            if amount >= 100 * one_token { return 1; }
            0
        }

        /// @notice Calculates pending rewards since last claim.
        /// @dev Uses tier-specific APY and elapsed time.
        fn _calculate_pending(self: @ContractState, stake: @Stake) -> u256 {
            if *stake.amount == 0 { return 0; }
            let time_diff = get_block_timestamp() - *stake.last_claim_time;
            let apy_bps: u256 = match *stake.tier {
                1 => 600,
                2 => 600,
                3 => 600,
                _ => 0
            };
            (*stake.amount * apy_bps * time_diff.into()) / (BASIS_POINTS * SECONDS_PER_YEAR.into())
        }
    }

    #[abi(embed_v0)]
    impl BTCStakingPrivacyImpl of super::IBTCStakingPrivacy<ContractState> {
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
