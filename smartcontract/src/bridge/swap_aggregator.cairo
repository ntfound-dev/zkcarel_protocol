use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct Route {
    pub dex_id: felt252,
    pub expected_amount_out: u256,
    pub min_amount_out: u256,
}

#[starknet::interface]
pub trait IDEXRouter<TContractState> {
    fn get_quote(self: @TContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256) -> u256;
    fn swap(ref self: TContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256, min_amount_out: u256);
}

#[starknet::interface]
pub trait ISwapAggregator<TContractState> {
    fn get_best_swap_route(self: @TContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256) -> Route;
    fn execute_swap(ref self: TContractState, route: Route, from_token: ContractAddress, to_token: ContractAddress, amount: u256, mev_protected: bool);
    fn register_dex_router(ref self: TContractState, dex_id: felt252, router_address: ContractAddress);
}

#[starknet::contract]
pub mod SwapAggregator {
    // Menghapus get_contract_address karena tidak digunakan
    use starknet::{ContractAddress, get_caller_address};
    // Wajib untuk akses storage Vec dan Map
    use starknet::storage::*;
    use super::{Route, ISwapAggregator, IDEXRouterDispatcher, IDEXRouterDispatcherTrait};

    const BASIS_POINTS: u256 = 10000;
    const DEFAULT_SLIPPAGE: u256 = 100; // 1%
    const MEV_FEE_BPS: u256 = 15;      // 0.15%

    #[storage]
    pub struct Storage {
        pub dex_ids: Vec<felt252>,
        pub dex_routers: Map<felt252, ContractAddress>,
        pub active_dexes: Map<ContractAddress, bool>,
        pub slippage_tolerance: u256,
        pub owner: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.owner.write(owner);
        self.slippage_tolerance.write(DEFAULT_SLIPPAGE);
    }

    #[abi(embed_v0)]
    impl SwapAggregatorImpl of ISwapAggregator<ContractState> {
        fn get_best_swap_route(self: @ContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256) -> Route {
            let mut best_dex_id: felt252 = 0;
            let mut highest_out: u256 = 0;

            for i in 0..self.dex_ids.len() {
                let d_id = self.dex_ids.at(i).read();
                let router_addr = self.dex_routers.entry(d_id).read();
                
                if self.active_dexes.entry(router_addr).read() {
                    let quote = IDEXRouterDispatcher { contract_address: router_addr }.get_quote(from_token, to_token, amount);
                    if quote > highest_out {
                        highest_out = quote;
                        best_dex_id = d_id;
                    }
                }
            };

            assert!(best_dex_id != 0, "No active DEX found");
            
            let slippage = self.slippage_tolerance.read();
            let min_out = (highest_out * (BASIS_POINTS - slippage)) / BASIS_POINTS;

            Route { dex_id: best_dex_id, expected_amount_out: highest_out, min_amount_out: min_out }
        }

        fn execute_swap(
            ref self: ContractState, 
            route: Route, 
            from_token: ContractAddress, 
            to_token: ContractAddress, 
            amount: u256, 
            mev_protected: bool
        ) {
            let mut final_amount = amount;
            
            if mev_protected {
                let fee = (amount * MEV_FEE_BPS) / BASIS_POINTS;
                final_amount = amount - fee;
            }

            let router_addr = self.dex_routers.entry(route.dex_id).read();
            assert!(self.active_dexes.entry(router_addr).read(), "DEX not active");

            IDEXRouterDispatcher { contract_address: router_addr }.swap(
                from_token, to_token, final_amount, route.min_amount_out
            );
        }

        fn register_dex_router(ref self: ContractState, dex_id: felt252, router_address: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            self.dex_routers.entry(dex_id).write(router_address);
            self.active_dexes.entry(router_address).write(true);
            
            // Menggunakan push() menggantikan append().write() untuk menghindari warning
            self.dex_ids.push(dex_id);
        }
    }
}