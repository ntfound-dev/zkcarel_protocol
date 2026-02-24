use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct Stake {
    pub amount: u256,
    pub tier: u8,
    pub start_time: u64,
    pub last_claim_time: u64,
    pub accumulated_rewards: u256,
}

// Minimal ERC20 interface for staking transfers.
// Used for BTC wrapper tokens and reward payouts.
#[starknet::interface]
pub trait IERC20<TContractState> {
    // Transfers tokens from this contract to `recipient`.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    // Transfers tokens from `sender` to `recipient` using allowance.
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256
    ) -> bool;
}

// Public staking API for BTC-wrapper assets.
// Allows multiple BTC tokens through owner-managed allowlist.
#[starknet::interface]
pub trait IBTCStaking<TContractState> {
    // Stakes assets and updates caller position.
    fn stake(ref self: TContractState, btc_token: ContractAddress, amount: u256);
    // Unstakes assets and updates caller position.
    fn unstake(ref self: TContractState, btc_token: ContractAddress, amount: u256);
    // Claims accrued staking rewards.
    fn claim_rewards(ref self: TContractState, btc_token: ContractAddress);
    // Returns total rewards (stored + pending) for a position.
    fn calculate_rewards(self: @TContractState, user: ContractAddress, btc_token: ContractAddress) -> u256;
    // Returns whether a BTC token is allowlisted.
    fn is_token_accepted(self: @TContractState, btc_token: ContractAddress) -> bool;
    // Adds a BTC token to the staking allowlist.
    fn add_btc_token(ref self: TContractState, btc_token: ContractAddress);
}

// Hide Mode hooks for BTC staking actions.
#[starknet::interface]
pub trait IBTCStakingPrivacy<TContractState> {
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

// BTC-wrapper staking contract with tier thresholds and lock period.
// Rewards are paid in `reward_token_address`.
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

    // Initializes reward token dependency, owner authority, and default WBTC allowlist.
    #[constructor]
    // Initializes contract storage during deployment.
    fn constructor(
        ref self: ContractState,
        reward_token: ContractAddress,
        owner: ContractAddress,
        default_btc_token: ContractAddress
    ) {
        self.reward_token_address.write(reward_token);
        self.owner.write(owner);
        self.accepted_btc_tokens.entry(default_btc_token).write(true);
    }

    #[abi(embed_v0)]
    impl BTCStakingImpl of IBTCStaking<ContractState> {
        // Stakes allowlisted BTC token, compounds pending rewards, and refreshes tier.
        fn stake(ref self: ContractState, btc_token: ContractAddress, amount: u256) {
            assert!(self.accepted_btc_tokens.entry(btc_token).read(), "Token WBTC Starknet tidak didukung");
            
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

        // Unstakes BTC token after lock period and updates stake metadata.
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

        // Claims caller rewards for selected BTC token position.
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

        // Returns total claimable rewards (stored + pending) for a token position.
        fn calculate_rewards(self: @ContractState, user: ContractAddress, btc_token: ContractAddress) -> u256 {
            let stake = self.stakes.entry((user, btc_token)).read();
            stake.accumulated_rewards + self._calculate_pending(@stake)
        }

        // Returns whether a BTC token is allowlisted.
        fn is_token_accepted(self: @ContractState, btc_token: ContractAddress) -> bool {
            self.accepted_btc_tokens.entry(btc_token).read()
        }

        // Adds a BTC token to the staking allowlist.
        fn add_btc_token(ref self: ContractState, btc_token: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Unauthorized");
            self.accepted_btc_tokens.entry(btc_token).write(true);
        }
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        // Maps staked amount to reward tier thresholds.
        fn _calculate_tier(self: @ContractState, amount: u256) -> u8 {
            let one_token: u256 = 1000000000000000000;
            if amount >= 10000 * one_token { return 3; }
            if amount >= 1000 * one_token { return 2; }
            if amount >= 100 * one_token { return 1; }
            0
        }

        // Computes linear rewards since the last claim checkpoint.
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
        // Sets router used by Hide Mode staking flow.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Unauthorized owner");
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Forwards private staking payload to privacy router for proof checks.
        // `nullifiers` prevent replay and `commitments` bind action intent.
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
