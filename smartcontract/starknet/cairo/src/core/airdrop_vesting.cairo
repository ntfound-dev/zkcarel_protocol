use starknet::ContractAddress;

/// @notice Airdrop with tiered recipient vesting — v6 tokenomics fix 6.
/// @dev Anti farm-and-dump: large claims vest linearly.
///      Stakers (min 30 days) bypass vesting and get instant unlock.
///
///      Tiers (per epoch):
///        < 1K CAREL   → instant
///        1K – 10K     → 7-day linear
///        10K – 50K    → 30-day linear
///        > 50K        → 90-day linear
///      Bypass: user has staked ≥ 1 CAREL for ≥ 30 days → instant
#[starknet::interface]
pub trait IAirdropVesting<TContractState> {
    /// @notice Sets the Merkle root for an epoch's airdrop.
    /// @param epoch Epoch identifier (monotonically increasing).
    /// @param root Merkle root of (address, amount) leaves.
    fn set_epoch_root(ref self: TContractState, epoch: u64, root: felt252);

    /// @notice Claims an airdrop allocation. Starts vesting if over threshold.
    /// @param epoch Epoch of this claim.
    /// @param amount Full allocated amount (before 5% claim fee).
    /// @param proof Merkle proof verifying (caller, amount) is in the epoch root.
    fn claim(ref self: TContractState, epoch: u64, amount: u256, proof: Span<felt252>);

    /// @notice Releases vested tokens to the caller.
    fn release_vested(ref self: TContractState);

    /// @notice Returns claimable (releasable) amount for `user` at current time.
    fn releasable(self: @TContractState, user: ContractAddress) -> u256;

    /// @notice Returns the vesting position for `user`.
    fn get_vest_info(self: @TContractState, user: ContractAddress) -> VestPosition;

    /// @notice Returns true if `epoch` has been claimed by `user`.
    fn has_claimed(self: @TContractState, user: ContractAddress, epoch: u64) -> bool;
}

/// @notice Admin interface for configuring the airdrop.
#[starknet::interface]
pub trait IAirdropVestingAdmin<TContractState> {
    /// @notice Sets the CAREL token address.
    fn set_carel_token(ref self: TContractState, token: ContractAddress);

    /// @notice Sets the treasury address (receives 1.25% fee share).
    fn set_treasury(ref self: TContractState, treasury: ContractAddress);

    /// @notice Sets the dev fund address (receives 1.25% fee share).
    fn set_dev_fund(ref self: TContractState, dev_fund: ContractAddress);

    /// @notice Sets the staking vault address for bypass verification.
    fn set_stake_vault(ref self: TContractState, vault: ContractAddress);

    /// @notice Funds the airdrop pool with CAREL tokens.
    fn fund(ref self: TContractState, amount: u256);

    /// @notice Withdraws unallocated CAREL back to owner.
    fn withdraw_unallocated(ref self: TContractState, amount: u256);
}

#[derive(Drop, Serde, Copy, starknet::Store)]
pub struct VestPosition {
    pub total: u256,       // gross after fee deduction
    pub released: u256,
    pub start_time: u64,
    pub end_time: u64,     // = start_time if instant
    pub is_instant: bool,
}

/// @notice Minimal ERC20 interface for the airdrop contract.
#[starknet::interface]
pub trait IERC20<TContractState> {
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256
    ) -> bool;
    fn burn(ref self: TContractState, amount: u256);
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
}

/// @notice Minimal stake vault interface to verify staker bypass eligibility.
/// @dev Returns the timestamp when the caller's current stake started.
#[starknet::interface]
pub trait IStakeVault<TContractState> {
    fn get_stake_start(self: @TContractState, user: ContractAddress) -> u64;
    fn get_user_stake(self: @TContractState, user: ContractAddress) -> u256;
}

/// @notice Airdrop distributor with tiered vesting and staker bypass.
#[starknet::contract]
pub mod AirdropVesting {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use starknet::get_contract_address;
    use starknet::storage::*;
    use core::num::traits::Zero;
    use core::traits::TryInto;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::security::reentrancyguard::ReentrancyGuardComponent;
    use super::{
        VestPosition, IERC20Dispatcher, IERC20DispatcherTrait,
        IStakeVaultDispatcher, IStakeVaultDispatcherTrait,
    };

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;
    impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    const ONE_TOKEN: u256 = 1_000_000_000_000_000_000_u256;
    const BPS_DENOM: u256 = 10000;
    const DAY_SECONDS: u64 = 86400;

    // Claim fee split: 5% total → 2.5% burn, 1.25% treasury, 1.25% dev
    const CLAIM_FEE_BPS: u256 = 500;
    const BURN_SHARE_BPS: u256 = 250;
    const TREASURY_SHARE_BPS: u256 = 125;
    const DEV_SHARE_BPS: u256 = 125;

    // Tier thresholds
    const TIER_1_THRESHOLD: u256 = 1_000_u256; // 1K CAREL → instant
    const TIER_2_THRESHOLD: u256 = 10_000_u256; // 1K–10K → 7 days
    const TIER_3_THRESHOLD: u256 = 50_000_u256; // 10K–50K → 30 days
    // > 50K → 90 days
    const TIER_2_DAYS: u64 = 7;
    const TIER_3_DAYS: u64 = 30;
    const TIER_4_DAYS: u64 = 90;

    // Staker bypass: min stake and min stake duration
    const BYPASS_STAKE_SECONDS: u64 = 2592000; // 30 days

    #[storage]
    pub struct Storage {
        pub carel_token: ContractAddress,
        pub treasury: ContractAddress,
        pub dev_fund: ContractAddress,
        pub stake_vault: ContractAddress,
        pub epoch_roots: Map<u64, felt252>,
        pub claimed: Map<(ContractAddress, u64), bool>,
        pub vest_positions: Map<ContractAddress, VestPosition>,
        pub funded_amount: u256,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        pub reentrancy_guard: ReentrancyGuardComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        EpochRootSet: EpochRootSet,
        Claimed: Claimed,
        VestedReleased: VestedReleased,
        Funded: Funded,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EpochRootSet {
        pub epoch: u64,
        pub root: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Claimed {
        pub user: ContractAddress,
        pub epoch: u64,
        pub gross_amount: u256,
        pub net_amount: u256,
        pub vesting_days: u64,
        pub instant: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VestedReleased {
        pub user: ContractAddress,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Funded {
        pub amount: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        carel_token: ContractAddress,
        treasury: ContractAddress,
        dev_fund: ContractAddress,
    ) {
        self.ownable.initializer(admin);
        self.carel_token.write(carel_token);
        self.treasury.write(treasury);
        self.dev_fund.write(dev_fund);
    }

    #[abi(embed_v0)]
    impl AirdropVestingImpl of super::IAirdropVesting<ContractState> {
        fn set_epoch_root(ref self: ContractState, epoch: u64, root: felt252) {
            self.ownable.assert_only_owner();
            self.epoch_roots.entry(epoch).write(root);
            self.emit(Event::EpochRootSet(EpochRootSet { epoch, root }));
        }

        fn claim(ref self: ContractState, epoch: u64, amount: u256, proof: Span<felt252>) {
            self.reentrancy_guard.start();
            let caller = get_caller_address();
            assert!(amount > 0, "Amount zero");
            assert!(!self.claimed.entry((caller, epoch)).read(), "Already claimed");

            let root = self.epoch_roots.entry(epoch).read();
            assert!(root != 0, "Epoch not set");

            // Merkle proof verification
            assert!(self._verify_proof(caller, amount, proof, root), "Invalid proof");

            self.claimed.entry((caller, epoch)).write(true);

            // Deduct 5% claim fee
            let fee = (amount * CLAIM_FEE_BPS) / BPS_DENOM;
            let burn_part = (amount * BURN_SHARE_BPS) / BPS_DENOM;
            let treasury_part = (amount * TREASURY_SHARE_BPS) / BPS_DENOM;
            let dev_part = fee - burn_part - treasury_part;
            let net = amount - fee;

            let carel = IERC20Dispatcher { contract_address: self.carel_token.read() };

            // Distribute fee
            carel.burn(burn_part);
            let ok1 = carel.transfer(self.treasury.read(), treasury_part);
            assert!(ok1, "Treasury transfer failed");
            if dev_part > 0 {
                let ok2 = carel.transfer(self.dev_fund.read(), dev_part);
                assert!(ok2, "Dev transfer failed");
            }

            // Determine vesting duration (in CAREL units, not wei)
            let amount_carel = amount / ONE_TOKEN;
            let is_staker_bypass = self._check_staker_bypass(caller);
            let (vesting_days, instant) = if is_staker_bypass || amount_carel < TIER_1_THRESHOLD {
                (0_u64, true)
            } else if amount_carel < TIER_2_THRESHOLD {
                (TIER_2_DAYS, false)
            } else if amount_carel < TIER_3_THRESHOLD {
                (TIER_3_DAYS, false)
            } else {
                (TIER_4_DAYS, false)
            };

            let now = get_block_timestamp();
            if instant {
                let ok = carel.transfer(caller, net);
                assert!(ok, "Transfer failed");
                // Still record a zero-duration position for historical queries
                let pos = VestPosition {
                    total: net,
                    released: net,
                    start_time: now,
                    end_time: now,
                    is_instant: true,
                };
                self.vest_positions.entry(caller).write(pos);
            } else {
                // Accumulate onto any existing unvested position
                let existing = self.vest_positions.entry(caller).read();
                // If there is an active vest position, roll its unvested remainder forward
                let combined_total = if !existing.is_instant && existing.total > existing.released {
                    (existing.total - existing.released) + net
                } else {
                    net
                };
                let pos = VestPosition {
                    total: combined_total,
                    released: 0,
                    start_time: now,
                    end_time: now + vesting_days * DAY_SECONDS,
                    is_instant: false,
                };
                self.vest_positions.entry(caller).write(pos);
            }

            self.emit(Event::Claimed(Claimed {
                user: caller,
                epoch,
                gross_amount: amount,
                net_amount: net,
                vesting_days,
                instant,
            }));
            self.reentrancy_guard.end();
        }

        fn release_vested(ref self: ContractState) {
            self.reentrancy_guard.start();
            let caller = get_caller_address();
            let releasable = self.releasable(caller);
            assert!(releasable > 0, "Nothing to release");

            let mut pos = self.vest_positions.entry(caller).read();
            pos.released += releasable;
            self.vest_positions.entry(caller).write(pos);

            let carel = IERC20Dispatcher { contract_address: self.carel_token.read() };
            let ok = carel.transfer(caller, releasable);
            assert!(ok, "Release transfer failed");

            self.emit(Event::VestedReleased(VestedReleased { user: caller, amount: releasable }));
            self.reentrancy_guard.end();
        }

        fn releasable(self: @ContractState, user: ContractAddress) -> u256 {
            let pos = self.vest_positions.entry(user).read();
            if pos.total == 0 || pos.released >= pos.total { return 0; }
            if pos.is_instant { return 0; } // already paid out at claim time

            let now = get_block_timestamp();
            if now >= pos.end_time {
                return pos.total - pos.released;
            }
            let elapsed = now - pos.start_time;
            let duration = pos.end_time - pos.start_time;
            let vested = (pos.total * elapsed.into()) / duration.into();
            if vested <= pos.released { 0 } else { vested - pos.released }
        }

        fn get_vest_info(self: @ContractState, user: ContractAddress) -> VestPosition {
            self.vest_positions.entry(user).read()
        }

        fn has_claimed(self: @ContractState, user: ContractAddress, epoch: u64) -> bool {
            self.claimed.entry((user, epoch)).read()
        }
    }

    #[abi(embed_v0)]
    impl AirdropVestingAdminImpl of super::IAirdropVestingAdmin<ContractState> {
        fn set_carel_token(ref self: ContractState, token: ContractAddress) {
            self.ownable.assert_only_owner();
            self.carel_token.write(token);
        }

        fn set_treasury(ref self: ContractState, treasury: ContractAddress) {
            self.ownable.assert_only_owner();
            self.treasury.write(treasury);
        }

        fn set_dev_fund(ref self: ContractState, dev_fund: ContractAddress) {
            self.ownable.assert_only_owner();
            self.dev_fund.write(dev_fund);
        }

        fn set_stake_vault(ref self: ContractState, vault: ContractAddress) {
            self.ownable.assert_only_owner();
            self.stake_vault.write(vault);
        }

        fn fund(ref self: ContractState, amount: u256) {
            let caller = get_caller_address();
            let carel = IERC20Dispatcher { contract_address: self.carel_token.read() };
            let ok = carel.transfer_from(caller, get_contract_address(), amount);
            assert!(ok, "Fund transfer failed");
            self.funded_amount.write(self.funded_amount.read() + amount);
            self.emit(Event::Funded(Funded { amount }));
        }

        fn withdraw_unallocated(ref self: ContractState, amount: u256) {
            self.ownable.assert_only_owner();
            let carel = IERC20Dispatcher { contract_address: self.carel_token.read() };
            let ok = carel.transfer(self.ownable.owner(), amount);
            assert!(ok, "Withdraw failed");
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// @dev Returns true if user qualifies for staker bypass:
        ///      stake > 0 AND staked for at least 30 days.
        fn _check_staker_bypass(self: @ContractState, user: ContractAddress) -> bool {
            let vault_addr = self.stake_vault.read();
            if vault_addr.is_zero() { return false; }

            let vault = IStakeVaultDispatcher { contract_address: vault_addr };
            let stake = vault.get_user_stake(user);
            if stake == 0 { return false; }

            let stake_start = vault.get_stake_start(user);
            let now = get_block_timestamp();
            if stake_start == 0 { return false; }
            now >= stake_start + BYPASS_STAKE_SECONDS
        }

        /// @dev Simple Merkle proof verification.
        ///      Leaf = Pedersen(Pedersen(address_felt, amount_low), amount_high).
        fn _verify_proof(
            self: @ContractState,
            user: ContractAddress,
            amount: u256,
            proof: Span<felt252>,
            root: felt252
        ) -> bool {
            let user_felt: felt252 = user.into();
            let amount_low: felt252 = (amount & 0xffffffffffffffffffffffffffffffff_u256).try_into().unwrap();
            let amount_high: felt252 = (amount / 0x100000000000000000000000000000000_u256).try_into().unwrap();

            let mut leaf = core::pedersen::pedersen(
                core::pedersen::pedersen(user_felt, amount_low),
                amount_high
            );

            let mut i: u32 = 0;
            let len = proof.len();
            loop {
                if i >= len { break; }
                let sibling = *proof.at(i);
                leaf = if leaf < sibling {
                    core::pedersen::pedersen(leaf, sibling)
                } else {
                    core::pedersen::pedersen(sibling, leaf)
                };
                i += 1;
            };

            leaf == root
        }
    }

}
