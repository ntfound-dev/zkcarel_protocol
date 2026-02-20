use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct Stake {
    pub amount: u256,
    pub last_claim_time: u64,
    pub accumulated_rewards: u256,
}

// Minimal ERC20 interface for staking transfers.
// Used for stablecoin staking and rewards.
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

// Public staking API for supported stablecoins.
// Uses fixed APY and owner-managed token allowlist.
#[starknet::interface]
pub trait IStakingStablecoin<TContractState> {
    // Stakes assets and updates caller position.
    fn stake(ref self: TContractState, token: ContractAddress, amount: u256);
    // Unstakes assets and updates caller position.
    fn unstake(ref self: TContractState, token: ContractAddress, amount: u256);
    // Claims accrued staking rewards.
    fn claim_rewards(ref self: TContractState, token: ContractAddress);
    // Returns total rewards (stored + pending) for a position.
    fn calculate_rewards(self: @TContractState, user: ContractAddress, token: ContractAddress) -> u256;
    // Returns whether a stablecoin is allowlisted.
    fn is_accepted_token(self: @TContractState, token: ContractAddress) -> bool;
    // Adds a stablecoin to the staking allowlist.
    fn add_stablecoin(ref self: TContractState, token: ContractAddress);
}

// Hide Mode hooks for stablecoin staking actions.
#[starknet::interface]
pub trait IStakingStablecoinPrivacy<TContractState> {
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

// Fixed-APY stablecoin staking contract.
// Rewards are paid from shared `reward_token`.
#[starknet::contract]
pub mod StakingStablecoin {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_caller_address, get_block_timestamp, get_contract_address};
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_STAKING;
    use super::{Stake, IStakingStablecoin, IERC20Dispatcher, IERC20DispatcherTrait};

    const SECONDS_PER_YEAR: u64 = 31536000;
    const APY_BPS: u256 = 700; // 7% Fixed APY
    const BASIS_POINTS: u256 = 10000;

    #[storage]
    pub struct Storage {
        pub accepted_tokens: Map<ContractAddress, bool>,
        pub stakes: Map<(ContractAddress, ContractAddress), Stake>,
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

    // Initializes reward token dependency and owner authority.
    #[constructor]
    // Initializes contract storage during deployment.
    fn constructor(ref self: ContractState, reward_token: ContractAddress, owner: ContractAddress) {
        self.reward_token.write(reward_token);
        self.owner.write(owner);
    }

    #[abi(embed_v0)]
    impl StakingStablecoinImpl of IStakingStablecoin<ContractState> {
        // Stakes allowlisted stablecoin and updates caller accrual checkpoint.
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

            let ok = IERC20Dispatcher { contract_address: token }.transfer_from(user, get_contract_address(), amount);
            assert!(ok, "Token transfer failed");
            self.stakes.entry((user, token)).write(current_stake);

            self.emit(Event::Staked(Staked { user, token, amount }));
        }

        // Unstakes stablecoin principal and preserves accrued rewards.
        fn unstake(ref self: ContractState, token: ContractAddress, amount: u256) {
            let user = get_caller_address();
            let now = get_block_timestamp();
            let mut current_stake = self.stakes.entry((user, token)).read();

            assert!(current_stake.amount >= amount, "Saldo tidak cukup");

            current_stake.accumulated_rewards += self._calculate_pending(@current_stake);
            current_stake.amount -= amount;
            current_stake.last_claim_time = now;

            self.stakes.entry((user, token)).write(current_stake);
            let ok = IERC20Dispatcher { contract_address: token }.transfer(user, amount);
            assert!(ok, "Token transfer failed");

            self.emit(Event::Unstaked(Unstaked { user, token, amount }));
        }

        // Claims caller rewards for a specific stablecoin position.
        fn claim_rewards(ref self: ContractState, token: ContractAddress) {
            let user = get_caller_address();
            let now = get_block_timestamp();
            let mut current_stake = self.stakes.entry((user, token)).read();

            let total_reward = current_stake.accumulated_rewards + self._calculate_pending(@current_stake);
            assert!(total_reward > 0, "Tidak ada reward");

            current_stake.accumulated_rewards = 0;
            current_stake.last_claim_time = now;
            self.stakes.entry((user, token)).write(current_stake);

            let ok = IERC20Dispatcher { contract_address: self.reward_token.read() }.transfer(user, total_reward);
            assert!(ok, "Token transfer failed");
            self.emit(Event::RewardsClaimed(RewardsClaimed { user, amount: total_reward }));
        }

        // Returns total claimable rewards (stored + pending) for a position.
        fn calculate_rewards(self: @ContractState, user: ContractAddress, token: ContractAddress) -> u256 {
            let stake = self.stakes.entry((user, token)).read();
            stake.accumulated_rewards + self._calculate_pending(@stake)
        }

        // Returns whether a stablecoin is allowlisted.
        fn is_accepted_token(self: @ContractState, token: ContractAddress) -> bool {
            self.accepted_tokens.entry(token).read()
        }

        // Adds a stablecoin to the staking allowlist.
        fn add_stablecoin(ref self: ContractState, token: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Unauthorized");
            self.accepted_tokens.entry(token).write(true);
        }
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        // Computes linear rewards since `last_claim_time` using fixed APY.
        fn _calculate_pending(self: @ContractState, stake: @Stake) -> u256 {
            if *stake.amount == 0 { return 0; }
            let now = get_block_timestamp();
            let time_diff = now - *stake.last_claim_time;
            
            (*stake.amount * APY_BPS * time_diff.into()) / (BASIS_POINTS * SECONDS_PER_YEAR.into())
        }
    }

    #[abi(embed_v0)]
    impl StakingStablecoinPrivacyImpl of super::IStakingStablecoinPrivacy<ContractState> {
        // Sets router used by Hide Mode stablecoin staking flow.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Unauthorized owner");
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Forwards private staking payload to privacy router for proof verification.
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
