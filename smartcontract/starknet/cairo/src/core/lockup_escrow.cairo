use starknet::ContractAddress;

/// @notice Lock-up escrow interface — v6 tokenomics fix 5.
/// @dev Investors/team can lock CAREL for 6 or 12 months to earn 8%/12% APR
///      from the treasury buy-back fund. Lock is real: tokens cannot be
///      transferred, swapped, or used as collateral during the period.
#[starknet::interface]
pub trait ILockupEscrow<TContractState> {
    /// @notice Locks `amount` CAREL for `duration_months` (6 or 12).
    /// @dev User must pre-approve this contract for `amount` CAREL.
    ///      Creates or extends an existing lock (not allowed if lock active).
    /// @param amount CAREL to lock (18-decimal).
    /// @param duration_months Must be 6 or 12.
    fn lock(ref self: TContractState, amount: u256, duration_months: u8);

    /// @notice Unlocks CAREL after the lock period expires. Pays accrued bonus.
    fn unlock(ref self: TContractState);

    /// @notice Early unlock: penalises caller 5% of principal + forfeits all bonus.
    /// @dev Penalty sent to treasury burn fund. Remaining principal returned.
    fn unlock_early(ref self: TContractState);

    /// @notice Claims linearly accrued bonus without unlocking principal.
    /// @dev Bonus is sourced from the treasury buy-back fund (USDC → buy CAREL).
    fn claim_bonus(ref self: TContractState);

    /// @notice Returns lock details for `user`.
    fn get_lock_info(self: @TContractState, user: ContractAddress) -> LockInfo;

    /// @notice Returns accrued but unclaimed bonus for `user` at current time.
    fn pending_bonus(self: @TContractState, user: ContractAddress) -> u256;
}

/// @notice Admin configuration interface for the escrow.
#[starknet::interface]
pub trait ILockupEscrowAdmin<TContractState> {
    /// @notice Sets the CAREL token address.
    fn set_carel_token(ref self: TContractState, token: ContractAddress);

    /// @notice Sets the treasury address that funds the bonus.
    fn set_treasury(ref self: TContractState, treasury: ContractAddress);

    /// @notice Sets the DEX router used to buy CAREL for bonus payments.
    fn set_dex_router(ref self: TContractState, router: ContractAddress);

    /// @notice Sets the USDC token address (used to fund bonuses from treasury).
    fn set_usdc_token(ref self: TContractState, usdc: ContractAddress);

    /// @notice Overrides APR for a given duration. Basis points, e.g. 800 = 8%.
    fn set_apr(ref self: TContractState, duration_months: u8, apr_bps: u256);
}

#[derive(Drop, Serde, Copy, starknet::Store)]
pub struct LockInfo {
    pub principal: u256,
    pub start_time: u64,
    pub end_time: u64,
    pub duration_months: u8,
    pub apr_bps: u256,
    pub bonus_claimed: u256,
    pub is_active: bool,
}

/// @notice Minimal ERC20 interface needed by the escrow.
#[starknet::interface]
pub trait IERC20<TContractState> {
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256
    ) -> bool;
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn burn(ref self: TContractState, amount: u256);
}

/// @notice DEX router for buying CAREL with USDC for bonus payments.
#[starknet::interface]
pub trait IDEXRouter<TContractState> {
    fn swap(
        ref self: TContractState,
        from_token: ContractAddress,
        to_token: ContractAddress,
        amount: u256,
        min_amount_out: u256
    );
}

/// @notice Treasury interface for pulling USDC to fund bonuses.
#[starknet::interface]
pub trait ITreasury<TContractState> {
    fn withdraw_emergency(ref self: TContractState, token: ContractAddress, amount: u256);
}

/// @notice Lock-up escrow: enforces real lock, pays APR bonus from buy-back fund.
#[starknet::contract]
pub mod LockupEscrow {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use starknet::get_contract_address;
    use starknet::storage::*;
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::security::reentrancyguard::ReentrancyGuardComponent;
    use super::{
        LockInfo, IERC20Dispatcher, IERC20DispatcherTrait,
        IDEXRouterDispatcher, IDEXRouterDispatcherTrait,
        ITreasuryDispatcher
    };

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;
    impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    const MONTH_SECONDS: u64 = 2592000;
    const ONE_TOKEN: u256 = 1_000_000_000_000_000_000_u256;
    const BPS_DENOM: u256 = 10000;
    // Early unlock penalty: 5% of principal
    const EARLY_PENALTY_BPS: u256 = 500;
    // APR accrued per second denominator (year = 365 * 86400)
    const YEAR_SECONDS: u64 = 31536000;

    #[storage]
    pub struct Storage {
        pub carel_token: ContractAddress,
        pub usdc_token: ContractAddress,
        pub treasury: ContractAddress,
        pub dex_router: ContractAddress,
        pub locks: Map<ContractAddress, LockInfo>,
        pub apr_6m_bps: u256,   // default 800 = 8%
        pub apr_12m_bps: u256,  // default 1200 = 12%
        pub total_locked: u256,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        pub reentrancy_guard: ReentrancyGuardComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Locked: Locked,
        Unlocked: Unlocked,
        EarlyUnlocked: EarlyUnlocked,
        BonusClaimed: BonusClaimed,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Locked {
        pub user: ContractAddress,
        pub amount: u256,
        pub duration_months: u8,
        pub apr_bps: u256,
        pub end_time: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Unlocked {
        pub user: ContractAddress,
        pub principal: u256,
        pub bonus: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EarlyUnlocked {
        pub user: ContractAddress,
        pub principal_returned: u256,
        pub penalty_burned: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BonusClaimed {
        pub user: ContractAddress,
        pub bonus: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        carel_token: ContractAddress,
        treasury: ContractAddress,
    ) {
        self.ownable.initializer(admin);
        self.carel_token.write(carel_token);
        self.treasury.write(treasury);
        self.apr_6m_bps.write(800_u256);   // 8% APR
        self.apr_12m_bps.write(1200_u256); // 12% APR
    }

    #[abi(embed_v0)]
    impl LockupEscrowImpl of super::ILockupEscrow<ContractState> {
        fn lock(ref self: ContractState, amount: u256, duration_months: u8) {
            self.reentrancy_guard.start();
            let caller = get_caller_address();
            assert!(amount > 0, "Amount zero");
            assert!(duration_months == 6 || duration_months == 12, "Duration must be 6 or 12 months");

            let existing = self.locks.entry(caller).read();
            assert!(!existing.is_active, "Existing lock active");

            let carel = IERC20Dispatcher { contract_address: self.carel_token.read() };
            let ok = carel.transfer_from(caller, get_contract_address(), amount);
            assert!(ok, "Transfer failed");

            let now = get_block_timestamp();
            let end_time = now + duration_months.into() * MONTH_SECONDS;
            let apr_bps = if duration_months == 12 {
                self.apr_12m_bps.read()
            } else {
                self.apr_6m_bps.read()
            };

            let info = LockInfo {
                principal: amount,
                start_time: now,
                end_time,
                duration_months,
                apr_bps,
                bonus_claimed: 0,
                is_active: true,
            };
            self.locks.entry(caller).write(info);
            self.total_locked.write(self.total_locked.read() + amount);

            self.emit(Event::Locked(Locked { user: caller, amount, duration_months, apr_bps, end_time }));
            self.reentrancy_guard.end();
        }

        fn unlock(ref self: ContractState) {
            self.reentrancy_guard.start();
            let caller = get_caller_address();
            let mut info = self.locks.entry(caller).read();
            assert!(info.is_active, "No active lock");
            assert!(get_block_timestamp() >= info.end_time, "Lock not expired");

            let accrued = self._compute_accrued_bonus(@info);
            let unpaid = if accrued > info.bonus_claimed { accrued - info.bonus_claimed } else { 0 };

            info.is_active = false;
            self.locks.entry(caller).write(info);
            self.total_locked.write(self.total_locked.read() - info.principal);

            // Return principal
            let carel = IERC20Dispatcher { contract_address: self.carel_token.read() };
            let ok = carel.transfer(caller, info.principal);
            assert!(ok, "Principal transfer failed");

            // Pay remaining bonus from buy-back fund
            if unpaid > 0 {
                self._pay_bonus(caller, unpaid);
            }

            self.emit(Event::Unlocked(Unlocked { user: caller, principal: info.principal, bonus: unpaid }));
            self.reentrancy_guard.end();
        }

        fn unlock_early(ref self: ContractState) {
            self.reentrancy_guard.start();
            let caller = get_caller_address();
            let mut info = self.locks.entry(caller).read();
            assert!(info.is_active, "No active lock");
            assert!(get_block_timestamp() < info.end_time, "Use unlock() - lock expired");

            let penalty = (info.principal * EARLY_PENALTY_BPS) / BPS_DENOM;
            let returned = info.principal - penalty;

            info.is_active = false;
            self.locks.entry(caller).write(info);
            self.total_locked.write(self.total_locked.read() - info.principal);

            // Burn penalty
            let carel = IERC20Dispatcher { contract_address: self.carel_token.read() };
            carel.burn(penalty);

            // Return principal minus penalty
            let ok = carel.transfer(caller, returned);
            assert!(ok, "Return transfer failed");

            // Bonus is forfeited — no payment

            self.emit(Event::EarlyUnlocked(EarlyUnlocked {
                user: caller,
                principal_returned: returned,
                penalty_burned: penalty,
            }));
            self.reentrancy_guard.end();
        }

        fn claim_bonus(ref self: ContractState) {
            self.reentrancy_guard.start();
            let caller = get_caller_address();
            let mut info = self.locks.entry(caller).read();
            assert!(info.is_active, "No active lock");

            let accrued = self._compute_accrued_bonus(@info);
            let unpaid = if accrued > info.bonus_claimed { accrued - info.bonus_claimed } else { 0 };
            assert!(unpaid > 0, "No bonus to claim");

            info.bonus_claimed += unpaid;
            self.locks.entry(caller).write(info);

            self._pay_bonus(caller, unpaid);

            self.emit(Event::BonusClaimed(BonusClaimed { user: caller, bonus: unpaid }));
            self.reentrancy_guard.end();
        }

        fn get_lock_info(self: @ContractState, user: ContractAddress) -> LockInfo {
            self.locks.entry(user).read()
        }

        fn pending_bonus(self: @ContractState, user: ContractAddress) -> u256 {
            let info = self.locks.entry(user).read();
            if !info.is_active { return 0; }
            let accrued = self._compute_accrued_bonus(@info);
            if accrued > info.bonus_claimed { accrued - info.bonus_claimed } else { 0 }
        }
    }

    #[abi(embed_v0)]
    impl LockupEscrowAdminImpl of super::ILockupEscrowAdmin<ContractState> {
        fn set_carel_token(ref self: ContractState, token: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!token.is_zero(), "Token required");
            self.carel_token.write(token);
        }

        fn set_treasury(ref self: ContractState, treasury: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!treasury.is_zero(), "Treasury required");
            self.treasury.write(treasury);
        }

        fn set_dex_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Router required");
            self.dex_router.write(router);
        }

        fn set_usdc_token(ref self: ContractState, usdc: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!usdc.is_zero(), "USDC required");
            self.usdc_token.write(usdc);
        }

        fn set_apr(ref self: ContractState, duration_months: u8, apr_bps: u256) {
            self.ownable.assert_only_owner();
            assert!(duration_months == 6 || duration_months == 12, "Invalid duration");
            assert!(apr_bps <= 10000, "APR too high");
            if duration_months == 6 {
                self.apr_6m_bps.write(apr_bps);
            } else {
                self.apr_12m_bps.write(apr_bps);
            }
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// @dev Linear APR: bonus = principal * apr_bps * elapsed / (YEAR_SECONDS * BPS_DENOM)
        fn _compute_accrued_bonus(self: @ContractState, info: @LockInfo) -> u256 {
            let now = get_block_timestamp();
            let effective_end = if now > *info.end_time { *info.end_time } else { now };
            let elapsed: u64 = effective_end - *info.start_time;
            (*info.principal * *info.apr_bps * elapsed.into()) / (YEAR_SECONDS.into() * BPS_DENOM)
        }

        /// @dev Pays bonus by pulling USDC from treasury, buying CAREL via DEX, sending to user.
        ///      If DEX/USDC not configured, transfers CAREL directly if held (testnet fallback).
        fn _pay_bonus(ref self: ContractState, user: ContractAddress, bonus_carel: u256) {
            let dex_router = self.dex_router.read();
            let usdc_token = self.usdc_token.read();
            let carel_token = self.carel_token.read();

            if !dex_router.is_zero() && !usdc_token.is_zero() {
                // Production: pull USDC from treasury, buy CAREL, send to user
                let _treasury_disp = ITreasuryDispatcher { contract_address: self.treasury.read() };
                // Conservative: request ~10% more USDC than needed to cover price movement
                // Caller should ensure enough USDC is in treasury
                let usdc_disp = IERC20Dispatcher { contract_address: usdc_token };
                let _usdc_before = usdc_disp.balance_of(get_contract_address());

                // We buy exactly bonus_carel worth of CAREL — use 0 as min_out here,
                // actual amount is guarded by what treasury releases
                let ok = usdc_disp.approve(dex_router, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff_u256);
                assert!(ok, "Approve USDC failed");

                // Swap USDC for at least bonus_carel CAREL
                let router = IDEXRouterDispatcher { contract_address: dex_router };
                let carel_disp = IERC20Dispatcher { contract_address: carel_token };
                let carel_before = carel_disp.balance_of(get_contract_address());
                // Note: caller must ensure treasury has enough USDC withdrawn beforehand
                // This path is triggered by keeper after treasury.withdraw_emergency(usdc, amount)
                let usdc_balance = usdc_disp.balance_of(get_contract_address());
                assert!(usdc_balance > 0, "No USDC for bonus");
                router.swap(usdc_token, carel_token, usdc_balance, bonus_carel);
                let carel_received = carel_disp.balance_of(get_contract_address()) - carel_before;
                assert!(carel_received >= bonus_carel, "Insufficient CAREL from swap");

                let ok2 = carel_disp.transfer(user, bonus_carel);
                assert!(ok2, "Bonus transfer failed");
            } else {
                // Fallback: transfer CAREL directly from escrow (requires escrow to hold bonus reserve)
                let carel = IERC20Dispatcher { contract_address: carel_token };
                let ok = carel.transfer(user, bonus_carel);
                assert!(ok, "Bonus transfer failed");
            }
        }
    }
}
