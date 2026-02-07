use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct KeeperStats {
    pub total_executions: u256,
    pub successful: u256,
    pub failed: u256,
    pub earnings: u256,
}

#[starknet::interface]
pub trait IKeeperNetwork<TContractState> {
    fn register_keeper(ref self: TContractState);
    fn unregister_keeper(ref self: TContractState);
    fn execute_limit_order(ref self: TContractState, order_id: u64, order_value: u256);
    fn execute_dca(ref self: TContractState, dca_id: u64, execution_value: u256);
    fn claim_earnings(ref self: TContractState) -> u256;
    fn slash_keeper(ref self: TContractState, keeper: ContractAddress);
    fn get_keeper_stats(self: @TContractState, keeper: ContractAddress) -> KeeperStats;
    fn is_keeper(self: @TContractState, keeper: ContractAddress) -> bool;
}

#[starknet::contract]
pub mod KeeperNetwork {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    // Selalu gunakan wildcard import untuk storage sesuai panduan dokumentasi
    use starknet::storage::*;
    use super::KeeperStats;

    #[storage]
    pub struct Storage {
        pub registered_keepers: Map<ContractAddress, bool>,
        pub keeper_performance: Map<ContractAddress, KeeperStats>,
        pub execution_fee_rate: u256,
        pub owner: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        KeeperRegistered: KeeperRegistered,
        KeeperUnregistered: KeeperUnregistered,
        ExecutionProcessed: ExecutionProcessed,
        KeeperSlashed: KeeperSlashed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct KeeperRegistered {
        pub keeper: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct KeeperUnregistered {
        pub keeper: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ExecutionProcessed {
        pub keeper: ContractAddress,
        pub id: u64,
        pub fee_earned: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct KeeperSlashed {
        pub keeper: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.owner.write(owner);
        self.execution_fee_rate.write(10_u256); // 0.1%
    }

    #[abi(embed_v0)]
    impl KeeperNetworkImpl of super::IKeeperNetwork<ContractState> {
        fn register_keeper(ref self: ContractState) {
            let caller = get_caller_address();
            assert!(!self.registered_keepers.entry(caller).read(), "Already registered");
            self.registered_keepers.entry(caller).write(true);
            
            let initial_stats = KeeperStats {
                total_executions: 0,
                successful: 0,
                failed: 0,
                earnings: 0,
            };
            self.keeper_performance.entry(caller).write(initial_stats);
            self.emit(Event::KeeperRegistered(KeeperRegistered { keeper: caller }));
        }

        fn unregister_keeper(ref self: ContractState) {
            let caller = get_caller_address();
            assert!(self.registered_keepers.entry(caller).read(), "Not a registered keeper");
            self.registered_keepers.entry(caller).write(false);
            self.emit(Event::KeeperUnregistered(KeeperUnregistered { keeper: caller }));
        }

        fn execute_limit_order(ref self: ContractState, order_id: u64, order_value: u256) {
            let caller = get_caller_address();
            assert!(self.registered_keepers.entry(caller).read(), "Unauthorized keeper");

            let mut stats = self.keeper_performance.entry(caller).read();
            let fee = (order_value * self.execution_fee_rate.read()) / 10000_u256;

            stats.total_executions += 1;
            stats.successful += 1;
            stats.earnings += fee;

            self.keeper_performance.entry(caller).write(stats);
            self.emit(Event::ExecutionProcessed(ExecutionProcessed { keeper: caller, id: order_id, fee_earned: fee }));
        }

        fn execute_dca(ref self: ContractState, dca_id: u64, execution_value: u256) {
            let caller = get_caller_address();
            assert!(self.registered_keepers.entry(caller).read(), "Unauthorized keeper");

            let mut stats = self.keeper_performance.entry(caller).read();
            let fee = (execution_value * self.execution_fee_rate.read()) / 10000_u256;

            stats.total_executions += 1;
            stats.successful += 1;
            stats.earnings += fee;

            self.keeper_performance.entry(caller).write(stats);
            self.emit(Event::ExecutionProcessed(ExecutionProcessed { keeper: caller, id: dca_id, fee_earned: fee }));
        }

        fn claim_earnings(ref self: ContractState) -> u256 {
            let caller = get_caller_address();
            let mut stats = self.keeper_performance.entry(caller).read();
            let amount = stats.earnings;
            assert!(amount > 0, "No earnings to claim");
            stats.earnings = 0;
            self.keeper_performance.entry(caller).write(stats);
            amount
        }

        fn slash_keeper(ref self: ContractState, keeper: ContractAddress) {
            let caller = get_caller_address();
            assert!(caller == self.owner.read(), "Only owner can slash");
            self.registered_keepers.entry(keeper).write(false);
            self.emit(Event::KeeperSlashed(KeeperSlashed { keeper }));
        }

        fn get_keeper_stats(self: @ContractState, keeper: ContractAddress) -> KeeperStats {
            self.keeper_performance.entry(keeper).read()
        }

        // Perbaikan: Gunakan @ContractState agar compiler dapat mengakses Storage
        fn is_keeper(self: @ContractState, keeper: ContractAddress) -> bool {
            self.registered_keepers.entry(keeper).read()
        }
    }
}