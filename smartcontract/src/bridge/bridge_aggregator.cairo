use starknet::ContractAddress;

#[starknet::interface]
pub trait IERC20<TContractState> {
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

#[starknet::interface]
pub trait IBridgeAggregator<TContractState> {
    fn get_best_route(self: @TContractState, from_chain: felt252, to_chain: felt252, amount: u256) -> BridgeRoute;
    fn execute_bridge(ref self: TContractState, route: BridgeRoute, amount: u256);
    fn refund_failed_bridge(ref self: TContractState, token_address: ContractAddress, amount: u256);
    fn register_bridge_provider(ref self: TContractState, provider_id: felt252, info: BridgeProvider);
    fn update_liquidity(ref self: TContractState, provider_id: felt252, liquidity: u256);
}

#[starknet::contract]
pub mod BridgeAggregator {
    use starknet::{ContractAddress, get_caller_address};
    // Wajib untuk trait Vec, Map, dan Storage Access
    use starknet::storage::*;
    // Menggunakan path openzeppelin standar
    use openzeppelin::access::ownable::OwnableComponent;
    use super::{BridgeProvider, BridgeRoute, IBridgeAggregator, IERC20Dispatcher, IERC20DispatcherTrait};

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableMixinImpl = OwnableComponent::OwnableMixinImpl<ContractState>;
    // Dibutuhkan agar fungsi initializer dan assert_only_owner tersedia
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub provider_ids: Vec<felt252>,
        pub bridge_providers: Map<felt252, BridgeProvider>,
        pub refund_balances: Map<ContractAddress, u256>,
        pub min_liquidity_threshold: u256,
        pub max_retry_attempts: u8,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        BridgeExecuted: BridgeExecuted,
        BridgeFailed: BridgeFailed,
        RefundClaimed: RefundClaimed,
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

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, min_liquidity: u256) {
        // Inisialisasi pemilik
        self.ownable.initializer(owner);
        self.min_liquidity_threshold.write(min_liquidity);
        self.max_retry_attempts.write(2);
    }

    #[abi(embed_v0)]
    impl BridgeAggregatorImpl of IBridgeAggregator<ContractState> {
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

        fn execute_bridge(ref self: ContractState, route: BridgeRoute, amount: u256) {
            let user = get_caller_address();
            let mut attempts: u8 = 0;
            let mut success = false;
            let max_retries = self.max_retry_attempts.read();

            while attempts <= max_retries {
                if amount > 0 { 
                    success = true;
                    break;
                }
                attempts += 1;
            };

            if success {
                self.emit(Event::BridgeExecuted(BridgeExecuted { user, provider_id: route.provider_id, amount }));
            } else {
                let current_refund = self.refund_balances.entry(user).read();
                self.refund_balances.entry(user).write(current_refund + amount);
                self.emit(Event::BridgeFailed(BridgeFailed { user, amount }));
            }
        }

        fn refund_failed_bridge(ref self: ContractState, token_address: ContractAddress, amount: u256) {
            let user = get_caller_address();
            let available = self.refund_balances.entry(user).read();
            assert!(available >= amount, "Insufficient refund balance");

            self.refund_balances.entry(user).write(available - amount);
            
            let token = IERC20Dispatcher { contract_address: token_address };
            token.transfer(user, amount);

            self.emit(Event::RefundClaimed(RefundClaimed { user, amount }));
        }

        fn register_bridge_provider(ref self: ContractState, provider_id: felt252, info: BridgeProvider) {
            // Memerlukan OwnableInternalImpl agar fungsi ini dikenali
            self.ownable.assert_only_owner();
            
            self.bridge_providers.entry(provider_id).write(info);
            // push() adalah metode yang direkomendasikan untuk Vec
            self.provider_ids.push(provider_id);
        }

        fn update_liquidity(ref self: ContractState, provider_id: felt252, liquidity: u256) {
            let mut provider = self.bridge_providers.entry(provider_id).read();
            assert!(get_caller_address() == provider.contract_address, "Unauthorized provider");
            provider.liquidity = liquidity;
            self.bridge_providers.entry(provider_id).write(provider);
        }
    }
}