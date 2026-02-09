use starknet::ContractAddress;

/// @title ERC20 Minimal Interface
/// @author CAREL Team
/// @notice Minimal ERC20 interface for refund transfers.
/// @dev Keeps dependency surface small for bridge refunds.
#[starknet::interface]
pub trait IERC20<TContractState> {
    /// @notice Transfers tokens to a recipient.
    /// @dev Used for refund payouts.
    /// @param recipient Recipient address.
    /// @param amount Amount to transfer.
    /// @return success True if transfer succeeded.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
}

#[derive(Drop, Serde, starknet::Store)]
pub struct BridgeProvider {
    pub name: ByteArray,
    pub contract_address: ContractAddress,
    pub fee_rate: u256,
    pub avg_time: u64,
    pub liquidity: u256,
    pub active: bool,
}

#[derive(Drop, Serde)]
pub struct BridgeRoute {
    pub provider_id: felt252,
    pub total_cost: u256,
    pub estimated_time: u64,
}

/// @title Bridge Aggregator Interface
/// @author CAREL Team
/// @notice Defines routing and execution for bridge providers.
/// @dev Used by frontend and backend to select optimal routes.
#[starknet::interface]
pub trait IBridgeAggregator<TContractState> {
    /// @notice Returns the best bridge route for a transfer.
    /// @dev Scores providers by cost, liquidity, and time.
    /// @param from_chain Source chain id.
    /// @param to_chain Destination chain id.
    /// @param amount Amount to bridge.
    /// @return route Selected bridge route.
    fn get_best_route(self: @TContractState, from_chain: felt252, to_chain: felt252, amount: u256) -> BridgeRoute;
    /// @notice Executes a bridge transfer with the chosen route.
    /// @dev Emits success/failure events and fee breakdown.
    /// @param route Selected bridge route.
    /// @param amount Amount to bridge.
    fn execute_bridge(ref self: TContractState, route: BridgeRoute, amount: u256);
    /// @notice Refunds a failed bridge transfer.
    /// @dev Uses ERC20 transfer to return funds.
    /// @param token_address Token to refund.
    /// @param amount Amount to refund.
    fn refund_failed_bridge(ref self: TContractState, token_address: ContractAddress, amount: u256);
    /// @notice Registers a new bridge provider.
    /// @dev Owner-only to control provider list.
    /// @param provider_id Provider identifier.
    /// @param info Provider metadata.
    fn register_bridge_provider(ref self: TContractState, provider_id: felt252, info: BridgeProvider);
    /// @notice Updates a provider's reported liquidity.
    /// @dev Provider-only to prevent spoofed liquidity.
    /// @param provider_id Provider identifier.
    /// @param liquidity Updated liquidity value.
    fn update_liquidity(ref self: TContractState, provider_id: felt252, liquidity: u256);
    /// @notice Updates bridge fee configuration.
    /// @dev Owner-only to maintain economic parameters.
    /// @param provider_fee_bps Provider fee in bps.
    /// @param dev_fee_bps Dev fee in bps.
    /// @param dev_fund Dev fund address.
    fn set_fee_config(ref self: TContractState, provider_fee_bps: u256, dev_fee_bps: u256, dev_fund: ContractAddress);
    /// @notice Sets adapter contract for a provider.
    /// @dev Owner-only to control provider integrations.
    /// @param provider_id Provider identifier.
    /// @param adapter Adapter contract address.
    fn set_provider_adapter(ref self: TContractState, provider_id: felt252, adapter: ContractAddress);
    /// @notice Sets the maximum number of bridge providers.
    /// @dev Owner-only to cap iteration cost.
    /// @param max_providers Maximum provider count.
    fn set_max_providers(ref self: TContractState, max_providers: u64);
}

/// @title Bridge Aggregator Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy entrypoints for bridge actions.
#[starknet::interface]
pub trait IBridgeAggregatorPrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private bridge action proof.
    fn submit_private_bridge_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @title Bridge Aggregator Contract
/// @author CAREL Team
/// @notice Selects bridge routes and tracks provider fees/refunds.
/// @dev Maintains provider registry and fee configuration.
#[starknet::contract]
pub mod BridgeAggregator {
    use starknet::{ContractAddress, get_caller_address};
    // Wajib untuk trait Vec, Map, dan Storage Access
    use starknet::storage::*;
    // Menggunakan path openzeppelin standar
    use openzeppelin::access::ownable::OwnableComponent;
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_BRIDGE;
    use super::{BridgeProvider, BridgeRoute, IBridgeAggregator, IERC20Dispatcher, IERC20DispatcherTrait};
    use crate::bridge::provider_adapter::{IBridgeProviderAdapterDispatcher, IBridgeProviderAdapterDispatcherTrait};

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableMixinImpl = OwnableComponent::OwnableMixinImpl<ContractState>;
    // Dibutuhkan agar fungsi initializer dan assert_only_owner tersedia
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub provider_ids: Vec<felt252>,
        pub bridge_providers: Map<felt252, BridgeProvider>,
        pub provider_adapters: Map<felt252, ContractAddress>,
        pub refund_balances: Map<ContractAddress, u256>,
        pub min_liquidity_threshold: u256,
        pub max_retry_attempts: u8,
        pub dev_fee_bps: u256,
        pub provider_fee_bps: u256,
        pub max_providers: u64,
        pub dev_fund: ContractAddress,
        pub privacy_router: ContractAddress,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        BridgeExecuted: BridgeExecuted,
        BridgeFailed: BridgeFailed,
        RefundClaimed: RefundClaimed,
        BridgeFeeCharged: BridgeFeeCharged,
        ProviderAdapterSet: ProviderAdapterSet,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BridgeExecuted {
        #[key]
        pub user: ContractAddress,
        pub provider_id: felt252,
        pub amount: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct BridgeFailed {
        #[key]
        pub user: ContractAddress,
        pub amount: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct RefundClaimed {
        #[key]
        pub user: ContractAddress,
        pub amount: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct BridgeFeeCharged {
        #[key]
        pub user: ContractAddress,
        pub provider_id: felt252,
        pub provider_fee: u256,
        pub dev_fee: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct ProviderAdapterSet {
        pub provider_id: felt252,
        pub adapter: ContractAddress,
    }

    /// @notice Initializes the bridge aggregator.
    /// @dev Sets owner, liquidity threshold, and default fees.
    /// @param owner Owner/admin address.
    /// @param min_liquidity Minimum liquidity threshold.
    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, min_liquidity: u256) {
        // Inisialisasi pemilik
        self.ownable.initializer(owner);
        self.min_liquidity_threshold.write(min_liquidity);
        self.max_retry_attempts.write(2);
        self.dev_fee_bps.write(10); // 0.1%
        self.provider_fee_bps.write(30); // 0.3%
        self.max_providers.write(50);
        self.dev_fund.write(owner);
    }

    #[abi(embed_v0)]
    impl BridgeAggregatorImpl of IBridgeAggregator<ContractState> {
        /// @notice Returns the best bridge route for a transfer.
        /// @dev Scores providers by cost, liquidity, and time.
        /// @param from_chain Source chain id.
        /// @param to_chain Destination chain id.
        /// @param amount Amount to bridge.
        /// @return route Selected bridge route.
        fn get_best_route(self: @ContractState, from_chain: felt252, to_chain: felt252, amount: u256) -> BridgeRoute {
            let mut best_provider_id: felt252 = 0;
            let mut highest_score: u256 = 0;
            let mut best_cost: u256 = 0;
            let mut best_time: u64 = 0;

            for i in 0..self.provider_ids.len() {
                let p_id = self.provider_ids.at(i).read();
                let provider = self.bridge_providers.entry(p_id).read();

                if provider.active && provider.liquidity >= amount {
                    let gas_estimate: u256 = 500;
                    let total_cost = provider.fee_rate + gas_estimate;
                    if provider.avg_time == 0 {
                        continue;
                    }
                    
                    let score = (400000 / total_cost) + 
                                (300000 * provider.liquidity / total_cost) + 
                                (300000 / provider.avg_time.into());

                    if score > highest_score {
                        highest_score = score;
                        best_provider_id = p_id;
                        best_cost = total_cost;
                        best_time = provider.avg_time;
                    }
                }
            };

            assert!(best_provider_id != 0, "No suitable route found");
            BridgeRoute { provider_id: best_provider_id, total_cost: best_cost, estimated_time: best_time }
        }

        /// @notice Executes a bridge transfer with the chosen route.
        /// @dev Emits success/failure events and fee breakdown.
        /// @param route Selected bridge route.
        /// @param amount Amount to bridge.
        fn execute_bridge(ref self: ContractState, route: BridgeRoute, amount: u256) {
            let user = get_caller_address();
            let mut attempts: u8 = 0;
            let mut success = false;
            let max_retries = self.max_retry_attempts.read();

            let adapter_addr = self.provider_adapters.entry(route.provider_id).read();
            if !adapter_addr.is_zero() {
                let adapter = IBridgeProviderAdapterDispatcher { contract_address: adapter_addr };
                success = adapter.execute_bridge(user, amount, route.provider_id);
            } else {
            while attempts <= max_retries {
                if amount > 0 { 
                    success = true;
                    break;
                }
                attempts += 1;
            };
            }

            if success {
                let provider_fee = (amount * self.provider_fee_bps.read()) / 10000;
                let dev_fee = (amount * self.dev_fee_bps.read()) / 10000;
                self.emit(Event::BridgeFeeCharged(BridgeFeeCharged {
                    user,
                    provider_id: route.provider_id,
                    provider_fee,
                    dev_fee
                }));
                self.emit(Event::BridgeExecuted(BridgeExecuted { user, provider_id: route.provider_id, amount }));
            } else {
                let current_refund = self.refund_balances.entry(user).read();
                self.refund_balances.entry(user).write(current_refund + amount);
                self.emit(Event::BridgeFailed(BridgeFailed { user, amount }));
            }
        }

        /// @notice Refunds a failed bridge transfer.
        /// @dev Uses ERC20 transfer to return funds.
        /// @param token_address Token to refund.
        /// @param amount Amount to refund.
        fn refund_failed_bridge(ref self: ContractState, token_address: ContractAddress, amount: u256) {
            let user = get_caller_address();
            let available = self.refund_balances.entry(user).read();
            assert!(available >= amount, "Insufficient refund balance");

            self.refund_balances.entry(user).write(available - amount);
            
            let token = IERC20Dispatcher { contract_address: token_address };
            token.transfer(user, amount);

            self.emit(Event::RefundClaimed(RefundClaimed { user, amount }));
        }

        /// @notice Registers a new bridge provider.
        /// @dev Owner-only to control provider list.
        /// @param provider_id Provider identifier.
        /// @param info Provider metadata.
        fn register_bridge_provider(ref self: ContractState, provider_id: felt252, info: BridgeProvider) {
            // Memerlukan OwnableInternalImpl agar fungsi ini dikenali
            self.ownable.assert_only_owner();
            let current: u64 = self.provider_ids.len().into();
            assert!(current < self.max_providers.read(), "Provider limit reached");
            
            self.bridge_providers.entry(provider_id).write(info);
            // push() adalah metode yang direkomendasikan untuk Vec
            self.provider_ids.push(provider_id);
        }

        /// @notice Updates a provider's reported liquidity.
        /// @dev Provider-only to prevent spoofed liquidity.
        /// @param provider_id Provider identifier.
        /// @param liquidity Updated liquidity value.
        fn update_liquidity(ref self: ContractState, provider_id: felt252, liquidity: u256) {
            let mut provider = self.bridge_providers.entry(provider_id).read();
            assert!(get_caller_address() == provider.contract_address, "Unauthorized provider");
            provider.liquidity = liquidity;
            self.bridge_providers.entry(provider_id).write(provider);
        }

        /// @notice Updates bridge fee configuration.
        /// @dev Owner-only to maintain economic parameters.
        /// @param provider_fee_bps Provider fee in bps.
        /// @param dev_fee_bps Dev fee in bps.
        /// @param dev_fund Dev fund address.
        fn set_fee_config(ref self: ContractState, provider_fee_bps: u256, dev_fee_bps: u256, dev_fund: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(provider_fee_bps + dev_fee_bps <= 1000, "Bridge fee too high");
            assert!(!dev_fund.is_zero(), "Dev fund required");
            self.provider_fee_bps.write(provider_fee_bps);
            self.dev_fee_bps.write(dev_fee_bps);
            self.dev_fund.write(dev_fund);
        }

        fn set_provider_adapter(ref self: ContractState, provider_id: felt252, adapter: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!adapter.is_zero(), "Adapter required");
            self.provider_adapters.entry(provider_id).write(adapter);
            self.emit(Event::ProviderAdapterSet(ProviderAdapterSet { provider_id, adapter }));
        }

        fn set_max_providers(ref self: ContractState, max_providers: u64) {
            self.ownable.assert_only_owner();
            assert!(max_providers > 0, "Max providers required");
            self.max_providers.write(max_providers);
        }
    }

    #[abi(embed_v0)]
    impl BridgeAggregatorPrivacyImpl of super::IBridgeAggregatorPrivacy<ContractState> {
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        fn submit_private_bridge_action(
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
                ACTION_BRIDGE,
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
