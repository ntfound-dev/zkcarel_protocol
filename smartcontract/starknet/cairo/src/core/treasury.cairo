use starknet::ContractAddress;

// Defines fee intake, burn, and rewards funding entrypoints.
// Central treasury coordination for protocol funds.
#[starknet::interface]
pub trait ITreasury<TContractState> {
    // Implements receive fee logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn receive_fee(ref self: TContractState, token: ContractAddress, amount: u256);
    // Implements burn excess logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn burn_excess(ref self: TContractState, token: ContractAddress, amount: u256);
    // Implements fund rewards logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn fund_rewards(ref self: TContractState, token: ContractAddress, recipient: ContractAddress, amount: u256);
    // Implements batch fund rewards logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn batch_fund_rewards(
        ref self: TContractState,
        token: ContractAddress,
        recipients: Span<ContractAddress>,
        amounts: Span<u256>
    );
    // Implements withdraw emergency logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn withdraw_emergency(ref self: TContractState, token: ContractAddress, amount: u256);
    // Updates fee collector configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn add_fee_collector(ref self: TContractState, collector: ContractAddress);
    // Updates burn config configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_burn_config(ref self: TContractState, burn_rate_bps: u256, enabled: bool);
    // Returns get treasury balance from state without mutating storage.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn get_treasury_balance(self: @TContractState, token: ContractAddress) -> u256;
    // Sets governance executor allowed to trigger treasury outflows.
    fn set_governance_executor(ref self: TContractState, governance: ContractAddress);
    // Returns configured governance executor.
    fn get_governance_executor(self: @TContractState) -> ContractAddress;
}

// ZK privacy entrypoints for treasury actions.
#[starknet::interface]
pub trait ITreasuryPrivacy<TContractState> {
    // Updates privacy router configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Applies submit private treasury action after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

// Minimal interface used by treasury for burns and balance.
// Keeps treasury dependency surface small.
#[starknet::interface]
pub trait ICarelToken<TContractState> {
    // Implements burn logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn burn(ref self: TContractState, amount: u256);
    // Implements balance of logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    // Applies transfer after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
}

// Tracks fees, burns, and reward allocations.
// Enforces epoch burn limits and collector allowlist.
#[starknet::contract]
pub mod Treasury {
    use starknet::ContractAddress;
    use starknet::get_block_timestamp;
    use starknet::get_caller_address;
    use starknet::get_contract_address;
    use starknet::storage::*;
    use core::traits::TryInto;
    use core::num::traits::Zero;
    
    // Corrected OpenZeppelin import path
    use openzeppelin::access::ownable::OwnableComponent;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_TREASURY;
    use super::{ICarelTokenDispatcher, ICarelTokenDispatcherTrait};

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    const EPOCH_DURATION: u64 = 2592000;

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
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
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
        #[flat]
        OwnableEvent: OwnableComponent::Event,
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

    // Initializes the treasury.
    // Sets owner and token address plus burn cap defaults.
    // `multisig_admin` becomes owner and `token` is the managed CAREL token.
    #[constructor]
    // Initializes storage and role configuration during deployment.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
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
    }

    #[abi(embed_v0)]
    impl TreasuryImpl of super::ITreasury<ContractState> {
        // Implements receive fee logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
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
            // Emit fee receipt through the enum event variant.
            self.emit(Event::FeeReceived(FeeReceived { from: caller, token, amount }));
        }

        // Implements burn excess logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn burn_excess(ref self: ContractState, token: ContractAddress, amount: u256) {
            self.assert_only_governance();
            assert!(token == self.carel_token.read(), "Only CAREL burn supported");
            
            let current_timestamp = get_block_timestamp();
            let current_epoch = current_timestamp / EPOCH_DURATION;
            
            if (self.last_burn_epoch.read() != current_epoch) {
                self.burned_this_epoch.write(0);
                self.last_burn_epoch.write(current_epoch);
            }

            let already_burned = self.burned_this_epoch.read();
            let max_allowed = self.max_burn_per_epoch.read();
            
            assert!(already_burned + amount <= max_allowed, "Epoch burn quota exceeded");

            self.burned_this_epoch.write(already_burned + amount);
            self.burned_amount.write(self.burned_amount.read() + amount);

            let token_dispatcher = ICarelTokenDispatcher { contract_address: token };
            token_dispatcher.burn(amount);

            self.emit(Event::TokensBurned(TokensBurned { token, amount, epoch: current_epoch }));
        }

        // Implements fund rewards logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn fund_rewards(ref self: ContractState, token: ContractAddress, recipient: ContractAddress, amount: u256) {
            self.assert_only_governance();
            let token_dispatcher = ICarelTokenDispatcher { contract_address: token };
            let ok = token_dispatcher.transfer(recipient, amount);
            assert!(ok, "Token transfer failed");
            let current = self.distributed_rewards.entry(token).read();
            self.distributed_rewards.entry(token).write(current + amount);
            self.emit(Event::RewardsFunded(RewardsFunded { token, recipient, amount }));
        }

        // Implements batch fund rewards logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn batch_fund_rewards(
            ref self: ContractState,
            token: ContractAddress,
            recipients: Span<ContractAddress>,
            amounts: Span<u256>
        ) {
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
        }

        // Implements withdraw emergency logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn withdraw_emergency(ref self: ContractState, token: ContractAddress, amount: u256) {
            self.assert_only_governance();
            let owner = self.ownable.owner();
            let token_dispatcher = ICarelTokenDispatcher { contract_address: token };
            let ok = token_dispatcher.transfer(owner, amount);
            assert!(ok, "Token transfer failed");
            self.emit(Event::EmergencyWithdrawn(EmergencyWithdrawn { token, recipient: owner, amount }));
        }

        // Updates fee collector configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn add_fee_collector(ref self: ContractState, collector: ContractAddress) {
            self.ownable.assert_only_owner();
            self.fee_collectors.entry(collector).write(true);
        }

        // Updates burn config configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_burn_config(ref self: ContractState, burn_rate_bps: u256, enabled: bool) {
            self.ownable.assert_only_owner();
            assert!(burn_rate_bps <= 10000, "Invalid burn rate");
            self.burn_rate_bps.write(burn_rate_bps);
            self.burn_enabled.write(enabled);
            self.emit(Event::BurnConfigUpdated(BurnConfigUpdated { burn_rate_bps, enabled }));
        }

        // Returns get treasury balance from state without mutating storage.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn get_treasury_balance(self: @ContractState, token: ContractAddress) -> u256 {
            let token_dispatcher = ICarelTokenDispatcher { contract_address: token };
            token_dispatcher.balance_of(get_contract_address())
        }

        fn set_governance_executor(ref self: ContractState, governance: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!governance.is_zero(), "Governance required");
            self.governance_executor.write(governance);
        }

        fn get_governance_executor(self: @ContractState) -> ContractAddress {
            self.governance_executor.read()
        }
    }

    #[abi(embed_v0)]
    impl TreasuryPrivacyImpl of super::ITreasuryPrivacy<ContractState> {
        // Updates privacy router configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Applies submit private treasury action after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
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
        fn assert_only_governance(self: @ContractState) {
            let governance = self.governance_executor.read();
            assert!(!governance.is_zero(), "Governance not set");
            assert!(get_caller_address() == governance, "Caller is not governance");
        }
    }
}
