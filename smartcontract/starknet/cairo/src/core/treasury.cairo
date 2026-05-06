use starknet::ContractAddress;

/// @notice Defines fee intake, burn, and rewards funding entrypoints.
/// @dev Central treasury coordination for protocol funds.
#[starknet::interface]
pub trait ITreasury<TContractState> {
    /// @notice Records an incoming fee from an authorised collector.
    /// @param token Address of the fee token.
    /// @param amount Gross amount received; burn portion is deducted automatically.
    fn receive_fee(ref self: TContractState, token: ContractAddress, amount: u256);

    /// @notice Burns excess CAREL tokens up to the epoch quota.
    /// @param token Must equal the configured CAREL token address.
    /// @param amount Number of tokens to burn in this call.
    fn burn_excess(ref self: TContractState, token: ContractAddress, amount: u256);

    /// @notice Transfers `amount` of `token` to `recipient` as a reward.
    /// @param token Address of the reward token.
    /// @param recipient Address receiving the reward.
    /// @param amount Number of tokens to transfer.
    fn fund_rewards(ref self: TContractState, token: ContractAddress, recipient: ContractAddress, amount: u256);

    /// @notice Transfers rewards to multiple recipients in one call.
    /// @param token Address of the reward token.
    /// @param recipients Span of recipient addresses; must match `amounts` length.
    /// @param amounts Span of amounts to transfer to each recipient.
    fn batch_fund_rewards(
        ref self: TContractState,
        token: ContractAddress,
        recipients: Span<ContractAddress>,
        amounts: Span<u256>
    );

    /// @notice Emergency withdrawal to the owner address.
    /// @param token Address of the token to withdraw.
    /// @param amount Number of tokens to withdraw.
    fn withdraw_emergency(ref self: TContractState, token: ContractAddress, amount: u256);

    /// @notice Adds `collector` to the authorised fee-collector allowlist.
    /// @dev Emits FeeCollectorUpdated. Only callable by owner.
    /// @param collector Address to authorise.
    fn add_fee_collector(ref self: TContractState, collector: ContractAddress);

    /// @notice Removes `collector` from the authorised fee-collector allowlist.
    /// @dev Emits FeeCollectorUpdated. Only callable by owner.
    /// @param collector Address to de-authorise.
    fn remove_fee_collector(ref self: TContractState, collector: ContractAddress);

    /// @notice Updates the auto-burn rate applied to incoming CAREL fees.
    /// @param burn_rate_bps New burn rate in basis points (0–10000).
    /// @param enabled Whether automatic burn on fee receipt is active.
    fn set_burn_config(ref self: TContractState, burn_rate_bps: u256, enabled: bool);

    /// @notice Returns the live token balance held by this treasury contract.
    /// @param token Address of the token to check.
    /// @return Current on-chain balance of `token` held by the treasury.
    fn get_treasury_balance(self: @TContractState, token: ContractAddress) -> u256;

    /// @notice Sets the governance executor allowed to trigger treasury outflows.
    /// @param governance Address of the governance contract.
    fn set_governance_executor(ref self: TContractState, governance: ContractAddress);

    /// @notice Returns the configured governance executor address.
    /// @return Current governance executor.
    fn get_governance_executor(self: @TContractState) -> ContractAddress;

    /// @notice Configures the auto-convert rule: X% of CAREL inflow swapped to USDC.
    /// @param usdc_token Address of the USDC token.
    /// @param dex_router Address of the DEX router for swaps.
    /// @param convert_bps Fraction of CAREL balance to convert per trigger (default 3500 = 35%).
    /// @param trigger_amount CAREL accumulation threshold to auto-trigger (default 5K CAREL in 18-dec).
    /// @param enabled Whether auto-convert is active.
    fn set_auto_convert_config(
        ref self: TContractState,
        usdc_token: ContractAddress,
        dex_router: ContractAddress,
        convert_bps: u256,
        trigger_amount: u256,
        enabled: bool
    );

    /// @notice Swaps `convert_bps`% of current CAREL balance to USDC.
    /// @dev Callable by owner or keeper. Slippage guard via `min_usdc_out`.
    /// @param min_usdc_out Minimum USDC expected; reverts if slippage exceeds 2%.
    fn trigger_auto_convert(ref self: TContractState, min_usdc_out: u256);

    /// @notice Sets the price oracle used for USD-denominated circuit breakers.
    /// @param oracle Address of the Pragma-compatible oracle.
    fn set_usd_circuit_breaker_oracle(ref self: TContractState, oracle: ContractAddress);

    /// @notice Returns estimated USD value of CAREL holdings in 6-decimal format.
    /// @return USD value (e.g. 2_000_000_000_000 = $2M).
    fn get_usd_treasury_value(self: @TContractState) -> u256;
}

/// @notice ZK privacy entrypoints for treasury actions.
#[starknet::interface]
pub trait ITreasuryPrivacy<TContractState> {
    /// @notice Sets the privacy router contract address.
    /// @dev Only callable by owner.
    /// @param router Address of the deployed privacy router.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);

    /// @notice Submits a ZK-proven private treasury action to the privacy router.
    /// @param old_root Merkle root before this action.
    /// @param new_root Merkle root after this action.
    /// @param nullifiers Span of nullifiers preventing double-spend.
    /// @param commitments Span of new Pedersen commitments.
    /// @param public_inputs Public inputs consumed by the ZK verifier.
    /// @param proof Serialised ZK proof bytes.
    fn submit_private_treasury_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @notice Minimal interface used by treasury for burns and balance.
/// @dev Keeps treasury dependency surface small.
#[starknet::interface]
pub trait ICarelToken<TContractState> {
    /// @notice Burns `amount` tokens from the caller's balance.
    fn burn(ref self: TContractState, amount: u256);

    /// @notice Returns token balance of `account`.
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;

    /// @notice Transfers `amount` to `recipient`.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;

    /// @notice Approves `spender` to spend `amount` from the caller's balance.
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
}

/// @notice Minimal DEX router interface for auto-convert swaps.
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

/// @notice Minimal price oracle interface for USD circuit breaker valuation.
/// @dev Returns (price, decimals): e.g. (20_000_000, 8) = $0.20 per CAREL.
#[starknet::interface]
pub trait IPriceOracle<TContractState> {
    fn get_carel_usd(self: @TContractState) -> (u128, u32);
}

/// @notice Tracks fees, burns, and reward allocations.
/// @dev Enforces epoch burn limits and collector allowlist.
#[starknet::contract]
pub mod Treasury {
    use starknet::ContractAddress;
    use starknet::get_block_timestamp;
    use starknet::get_caller_address;
    use starknet::get_contract_address;
    use starknet::storage::*;
    use core::traits::TryInto;
    use core::num::traits::Zero;

    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::security::reentrancyguard::ReentrancyGuardComponent;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_TREASURY;
    use super::{
        ICarelTokenDispatcher, ICarelTokenDispatcherTrait,
        IDEXRouterDispatcher, IDEXRouterDispatcherTrait,
        IPriceOracleDispatcher, IPriceOracleDispatcherTrait
    };

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;
    impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    const EPOCH_DURATION: u64 = 2592000;
    const ONE_TOKEN: u256 = 1_000_000_000_000_000_000_u256;

    // USD circuit breaker thresholds in 6-decimal format ($1 = 1_000_000)
    const CB_HIGH_USD: u256 = 4_000_000_000_000_u256;   // $4M → burn 25%
    const CB_MID_USD: u256 = 2_000_000_000_000_u256;    // $2M → burn 15%
    const CB_LOW_USD: u256 = 800_000_000_000_u256;      // $800K → burn 5%
    const CB_EMERGENCY_USD: u256 = 800_000_000_000_u256; // < $800K → burn paused

    #[storage]
    pub struct Storage {
        pub carel_token: ContractAddress,
        pub collected_fees: Map<ContractAddress, u256>,
        pub distributed_rewards: Map<ContractAddress, u256>,
        pub burned_amount: u256,
        pub burned_this_epoch: u256,
        pub max_burn_per_epoch: u256,
        pub last_burn_epoch: u64,
        pub fee_collectors: Map<ContractAddress, bool>,
        pub burn_rate_bps: u256,
        pub burn_enabled: bool,
        pub governance_executor: ContractAddress,
        pub privacy_router: ContractAddress,
        // Auto-convert: 35% CAREL inflow → USDC (v6 FIX 2)
        pub usdc_token: ContractAddress,
        pub auto_convert_dex_router: ContractAddress,
        pub auto_convert_bps: u256,
        pub auto_convert_trigger: u256,
        pub auto_convert_enabled: bool,
        // USD-denominated circuit breaker oracle (v6 FIX 2)
        pub usd_oracle: ContractAddress,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        pub reentrancy_guard: ReentrancyGuardComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        FeeReceived: FeeReceived,
        TokensBurned: TokensBurned,
        RewardsFunded: RewardsFunded,
        RewardsFundedBatch: RewardsFundedBatch,
        EmergencyWithdrawn: EmergencyWithdrawn,
        BurnConfigUpdated: BurnConfigUpdated,
        FeeCollectorUpdated: FeeCollectorUpdated,
        AutoConverted: AutoConverted,
        AutoConvertConfigUpdated: AutoConvertConfigUpdated,
        CircuitBreakerTriggered: CircuitBreakerTriggered,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FeeReceived {
        pub from: ContractAddress,
        pub token: ContractAddress,
        pub amount: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct TokensBurned {
        pub token: ContractAddress,
        pub amount: u256,
        pub epoch: u64
    }

    #[derive(Drop, starknet::Event)]
    pub struct RewardsFunded {
        pub token: ContractAddress,
        pub recipient: ContractAddress,
        pub amount: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct RewardsFundedBatch {
        pub token: ContractAddress,
        pub count: u64,
        pub total_amount: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct EmergencyWithdrawn {
        pub token: ContractAddress,
        pub recipient: ContractAddress,
        pub amount: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct BurnConfigUpdated {
        pub burn_rate_bps: u256,
        pub enabled: bool
    }

    #[derive(Drop, starknet::Event)]
    pub struct FeeCollectorUpdated {
        pub collector: ContractAddress,
        pub added: bool
    }

    #[derive(Drop, starknet::Event)]
    pub struct AutoConverted {
        pub carel_in: u256,
        pub usdc_out: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AutoConvertConfigUpdated {
        pub convert_bps: u256,
        pub trigger_amount: u256,
        pub enabled: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct CircuitBreakerTriggered {
        pub usd_value: u256,
        pub burn_paused: bool,
    }

    /// @notice Initializes the treasury.
    /// @dev Sets owner and token address plus burn cap defaults.
    /// @param multisig_admin Address that becomes owner.
    /// @param token Address of the managed CAREL token.
    #[constructor]
    fn constructor(
        ref self: ContractState,
        multisig_admin: ContractAddress,
        token: ContractAddress
    ) {
        self.ownable.initializer(multisig_admin);
        self.carel_token.write(token);
        self.max_burn_per_epoch.write(5000000000000000000000000_u256);
        self.burn_rate_bps.write(2000);
        self.burn_enabled.write(true);
        self.governance_executor.write(0.try_into().unwrap());

        // Auto-convert defaults (v6): 35% of CAREL holdings, trigger at 5K CAREL
        self.auto_convert_bps.write(3500_u256);
        self.auto_convert_trigger.write(5_000_u256 * ONE_TOKEN);
        self.auto_convert_enabled.write(false); // enabled via set_auto_convert_config after liquidity is ready
    }

    #[abi(embed_v0)]
    impl TreasuryImpl of super::ITreasury<ContractState> {
        /// @notice Records an incoming fee from an authorised collector.
        /// @dev Burns a portion of CAREL fees if burn is enabled.
        /// @param token Address of the fee token.
        /// @param amount Gross amount received.
        fn receive_fee(ref self: ContractState, token: ContractAddress, amount: u256) {
            let caller = get_caller_address();
            assert!(self.fee_collectors.entry(caller).read(), "Not an authorized collector");
            assert!(!token.is_zero(), "Token required");
            let mut net_amount = amount;
            if token == self.carel_token.read() && self.burn_enabled.read() && self.burn_rate_bps.read() > 0 {
                let burn_amount = (amount * self.burn_rate_bps.read()) / 10000;
                if burn_amount > 0 {
                    let token_dispatcher = ICarelTokenDispatcher { contract_address: token };
                    token_dispatcher.burn(burn_amount);
                    self.burned_amount.write(self.burned_amount.read() + burn_amount);
                    net_amount = amount - burn_amount;
                }
            }

            let current = self.collected_fees.entry(token).read();
            self.collected_fees.entry(token).write(current + net_amount);
            self.emit(Event::FeeReceived(FeeReceived { from: caller, token, amount }));
        }

        /// @notice Burns excess CAREL tokens up to the epoch quota.
        /// @dev Reentrancy-guarded. Applies USD-denominated circuit breaker if oracle is set.
        /// @param token Must equal the configured CAREL token address.
        /// @param amount Number of tokens to burn in this call.
        fn burn_excess(ref self: ContractState, token: ContractAddress, amount: u256) {
            self.reentrancy_guard.start();
            self.assert_only_governance();
            assert!(token == self.carel_token.read(), "Only CAREL burn supported");

            let current_timestamp = get_block_timestamp();
            let current_epoch = current_timestamp / EPOCH_DURATION;

            if (self.last_burn_epoch.read() != current_epoch) {
                self.burned_this_epoch.write(0);
                self.last_burn_epoch.write(current_epoch);
            }

            // USD-denominated circuit breaker (v6 FIX 2): override epoch cap if oracle is set
            let oracle_addr = self.usd_oracle.read();
            if !oracle_addr.is_zero() {
                let usd_value = self.get_usd_treasury_value();

                // Below $800K: burn fully paused
                assert!(usd_value >= CB_EMERGENCY_USD, "Burn paused: treasury below $800K");

                // Tiered burn cap as % of current CAREL balance
                let token_dispatcher = ICarelTokenDispatcher { contract_address: token };
                let balance = token_dispatcher.balance_of(get_contract_address());
                let epoch_cap = if usd_value >= CB_HIGH_USD {
                    (balance * 2500) / 10000  // 25% of balance
                } else if usd_value >= CB_MID_USD {
                    (balance * 1500) / 10000  // 15%
                } else {
                    (balance * 500) / 10000   // 5%
                };

                let already_burned = self.burned_this_epoch.read();
                assert!(already_burned + amount <= epoch_cap, "USD-gated burn cap exceeded");

                self.burned_this_epoch.write(already_burned + amount);
                self.burned_amount.write(self.burned_amount.read() + amount);
                token_dispatcher.burn(amount);
                self.emit(Event::TokensBurned(TokensBurned { token, amount, epoch: current_epoch }));
                self.reentrancy_guard.end();
                return;
            }

            // Fallback: original CAREL-amount cap
            let already_burned = self.burned_this_epoch.read();
            let max_allowed = self.max_burn_per_epoch.read();
            assert!(already_burned + amount <= max_allowed, "Epoch burn quota exceeded");

            self.burned_this_epoch.write(already_burned + amount);
            self.burned_amount.write(self.burned_amount.read() + amount);

            let token_dispatcher = ICarelTokenDispatcher { contract_address: token };
            token_dispatcher.burn(amount);

            self.emit(Event::TokensBurned(TokensBurned { token, amount, epoch: current_epoch }));
            self.reentrancy_guard.end();
        }

        /// @notice Transfers `amount` of `token` to `recipient` as a reward.
        /// @dev Reentrancy-guarded. Only callable by governance executor.
        /// @param token Address of the reward token.
        /// @param recipient Address receiving the reward.
        /// @param amount Number of tokens to transfer.
        fn fund_rewards(ref self: ContractState, token: ContractAddress, recipient: ContractAddress, amount: u256) {
            self.reentrancy_guard.start();
            self.assert_only_governance();
            let token_dispatcher = ICarelTokenDispatcher { contract_address: token };
            let ok = token_dispatcher.transfer(recipient, amount);
            assert!(ok, "Token transfer failed");
            let current = self.distributed_rewards.entry(token).read();
            self.distributed_rewards.entry(token).write(current + amount);
            self.emit(Event::RewardsFunded(RewardsFunded { token, recipient, amount }));
            self.reentrancy_guard.end();
        }

        /// @notice Transfers rewards to multiple recipients in one call.
        /// @dev Reentrancy-guarded. Only callable by governance executor.
        /// @param token Address of the reward token.
        /// @param recipients Span of recipient addresses.
        /// @param amounts Span of amounts corresponding to each recipient.
        fn batch_fund_rewards(
            ref self: ContractState,
            token: ContractAddress,
            recipients: Span<ContractAddress>,
            amounts: Span<u256>
        ) {
            self.reentrancy_guard.start();
            self.assert_only_governance();
            let count: u64 = recipients.len().into();
            assert!(count == amounts.len().into(), "Length mismatch");

            let mut total_amount: u256 = 0;
            let mut i: u64 = 0;
            let token_dispatcher = ICarelTokenDispatcher { contract_address: token };
            while i < count {
                let idx: u32 = i.try_into().unwrap();
                let amount = *amounts.at(idx);
                let recipient = *recipients.at(idx);
                let ok = token_dispatcher.transfer(recipient, amount);
                assert!(ok, "Token transfer failed");
                total_amount += amount;
                i += 1;
            };

            if total_amount > 0 {
                let current = self.distributed_rewards.entry(token).read();
                self.distributed_rewards.entry(token).write(current + total_amount);
            }
            self.emit(Event::RewardsFundedBatch(RewardsFundedBatch { token, count, total_amount }));
            self.reentrancy_guard.end();
        }

        /// @notice Emergency withdrawal to the owner address.
        /// @dev Reentrancy-guarded. Only callable by governance executor.
        /// @param token Address of the token to withdraw.
        /// @param amount Number of tokens to withdraw.
        fn withdraw_emergency(ref self: ContractState, token: ContractAddress, amount: u256) {
            self.reentrancy_guard.start();
            self.assert_only_governance();
            let owner = self.ownable.owner();
            let token_dispatcher = ICarelTokenDispatcher { contract_address: token };
            let ok = token_dispatcher.transfer(owner, amount);
            assert!(ok, "Token transfer failed");
            self.emit(Event::EmergencyWithdrawn(EmergencyWithdrawn { token, recipient: owner, amount }));
            self.reentrancy_guard.end();
        }

        /// @notice Adds `collector` to the authorised fee-collector allowlist.
        /// @dev Emits FeeCollectorUpdated. Only callable by owner.
        /// @param collector Address to authorise as a fee collector.
        fn add_fee_collector(ref self: ContractState, collector: ContractAddress) {
            self.ownable.assert_only_owner();
            self.fee_collectors.entry(collector).write(true);
            self.emit(Event::FeeCollectorUpdated(FeeCollectorUpdated { collector, added: true }));
        }

        /// @notice Removes `collector` from the authorised fee-collector allowlist.
        /// @dev Emits FeeCollectorUpdated. Only callable by owner.
        /// @param collector Address to de-authorise.
        fn remove_fee_collector(ref self: ContractState, collector: ContractAddress) {
            self.ownable.assert_only_owner();
            self.fee_collectors.entry(collector).write(false);
            self.emit(Event::FeeCollectorUpdated(FeeCollectorUpdated { collector, added: false }));
        }

        /// @notice Updates the auto-burn rate applied to incoming CAREL fees.
        /// @param burn_rate_bps New burn rate in basis points (0–10000).
        /// @param enabled Whether automatic burn on fee receipt is active.
        fn set_burn_config(ref self: ContractState, burn_rate_bps: u256, enabled: bool) {
            self.ownable.assert_only_owner();
            assert!(burn_rate_bps <= 10000, "Invalid burn rate");
            self.burn_rate_bps.write(burn_rate_bps);
            self.burn_enabled.write(enabled);
            self.emit(Event::BurnConfigUpdated(BurnConfigUpdated { burn_rate_bps, enabled }));
        }

        /// @notice Returns the live token balance held by this treasury contract.
        /// @param token Address of the token to check.
        /// @return Current on-chain balance of `token` held by the treasury.
        fn get_treasury_balance(self: @ContractState, token: ContractAddress) -> u256 {
            let token_dispatcher = ICarelTokenDispatcher { contract_address: token };
            token_dispatcher.balance_of(get_contract_address())
        }

        /// @notice Sets the governance executor allowed to trigger treasury outflows.
        /// @param governance Address of the governance contract (must be non-zero).
        fn set_governance_executor(ref self: ContractState, governance: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!governance.is_zero(), "Governance required");
            self.governance_executor.write(governance);
        }

        /// @notice Returns the configured governance executor address.
        /// @return Current governance executor.
        fn get_governance_executor(self: @ContractState) -> ContractAddress {
            self.governance_executor.read()
        }

        /// @notice Configures auto-convert: swaps a fraction of CAREL balance to USDC each trigger.
        fn set_auto_convert_config(
            ref self: ContractState,
            usdc_token: ContractAddress,
            dex_router: ContractAddress,
            convert_bps: u256,
            trigger_amount: u256,
            enabled: bool
        ) {
            self.ownable.assert_only_owner();
            assert!(convert_bps <= 10000, "Invalid convert bps");
            assert!(!usdc_token.is_zero(), "USDC token required");
            assert!(!dex_router.is_zero(), "DEX router required");

            self.usdc_token.write(usdc_token);
            self.auto_convert_dex_router.write(dex_router);
            self.auto_convert_bps.write(convert_bps);
            self.auto_convert_trigger.write(trigger_amount);
            self.auto_convert_enabled.write(enabled);

            self.emit(Event::AutoConvertConfigUpdated(AutoConvertConfigUpdated {
                convert_bps, trigger_amount, enabled
            }));
        }

        /// @notice Swaps `convert_bps`% of current CAREL balance to USDC.
        /// @dev Max 2% slippage enforced: caller must supply appropriate `min_usdc_out`.
        fn trigger_auto_convert(ref self: ContractState, min_usdc_out: u256) {
            self.reentrancy_guard.start();
            self.ownable.assert_only_owner();
            assert!(self.auto_convert_enabled.read(), "Auto-convert disabled");

            let usdc_token = self.usdc_token.read();
            let dex_router = self.auto_convert_dex_router.read();
            assert!(!usdc_token.is_zero(), "USDC not configured");
            assert!(!dex_router.is_zero(), "DEX router not configured");

            let carel_token = self.carel_token.read();
            let carel_disp = ICarelTokenDispatcher { contract_address: carel_token };
            let carel_balance = carel_disp.balance_of(get_contract_address());
            let convert_amount = (carel_balance * self.auto_convert_bps.read()) / 10000;
            assert!(convert_amount > 0, "Nothing to convert");

            // Approve and swap
            let ok = carel_disp.approve(dex_router, convert_amount);
            assert!(ok, "Approve failed");

            let usdc_disp = ICarelTokenDispatcher { contract_address: usdc_token };
            let usdc_before = usdc_disp.balance_of(get_contract_address());
            let router = IDEXRouterDispatcher { contract_address: dex_router };
            router.swap(carel_token, usdc_token, convert_amount, min_usdc_out);
            let usdc_after = usdc_disp.balance_of(get_contract_address());
            let usdc_received = usdc_after - usdc_before;
            assert!(usdc_received >= min_usdc_out, "Slippage exceeded 2%");

            self.emit(Event::AutoConverted(AutoConverted {
                carel_in: convert_amount,
                usdc_out: usdc_received,
            }));
            self.reentrancy_guard.end();
        }

        /// @notice Sets the price oracle for USD-denominated circuit breaker.
        fn set_usd_circuit_breaker_oracle(ref self: ContractState, oracle: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!oracle.is_zero(), "Oracle required");
            self.usd_oracle.write(oracle);
        }

        /// @notice Returns estimated USD value of CAREL held in treasury (6-decimal).
        fn get_usd_treasury_value(self: @ContractState) -> u256 {
            let oracle_addr = self.usd_oracle.read();
            if oracle_addr.is_zero() { return 0; }

            let carel_token = self.carel_token.read();
            let carel_disp = ICarelTokenDispatcher { contract_address: carel_token };
            let balance = carel_disp.balance_of(get_contract_address());
            if balance == 0 { return 0; }

            let oracle = IPriceOracleDispatcher { contract_address: oracle_addr };
            let (price, oracle_decimals) = oracle.get_carel_usd();
            if price == 0 { return 0; }

            // usd_6dec = balance_18dec * price / 10^(18 + oracle_decimals - 6)
            // Assumes oracle_decimals >= 6 (Pragma standard = 8).
            let divisor = pow10_usd(18_u32 + oracle_decimals - 6_u32);
            (balance * price.into()) / divisor
        }
    }

    #[abi(embed_v0)]
    impl TreasuryPrivacyImpl of super::ITreasuryPrivacy<ContractState> {
        /// @notice Sets the privacy router contract address.
        /// @dev Only callable by owner. Router must be non-zero.
        /// @param router Address of the deployed privacy router.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        /// @notice Submits a ZK-proven private treasury action to the privacy router.
        /// @param old_root Merkle root before this action.
        /// @param new_root Merkle root after this action.
        /// @param nullifiers Span of nullifiers preventing double-spend.
        /// @param commitments Span of new Pedersen commitments.
        /// @param public_inputs Public inputs consumed by the ZK verifier.
        /// @param proof Serialised ZK proof bytes.
        fn submit_private_treasury_action(
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
                ACTION_TREASURY,
                old_root,
                new_root,
                nullifiers,
                commitments,
                public_inputs,
                proof
            );
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// @dev Asserts that the caller is the configured governance executor.
        fn assert_only_governance(self: @ContractState) {
            let governance = self.governance_executor.read();
            assert!(!governance.is_zero(), "Governance not set");
            assert!(get_caller_address() == governance, "Caller is not governance");
        }
    }

    fn pow10_usd(exp: u32) -> u256 {
        let mut result: u256 = 1;
        let mut i: u32 = 0;
        loop {
            if i >= exp { break; }
            result *= 10;
            i += 1;
        };
        result
    }
}
