#[cfg(test)]
mod tests {
    use starknet::ContractAddress;
    use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};
    use snforge_std::{start_cheat_caller_address, stop_cheat_caller_address, spy_events, EventSpyAssertionsTrait};
    use starknet::storage::*;
    
    // Perbaikan: Hanya mengimpor apa yang benar-benar digunakan untuk menghilangkan warning
    use smartcontract::trading::dca_orders::{IKeeperNetworkDispatcher, IKeeperNetworkDispatcherTrait};
    use smartcontract::trading::dca_orders::KeeperNetwork;
    use smartcontract::trading::dca_orders::KeeperNetwork::KeeperRegistered;

    fn deploy_keeper(owner: ContractAddress) -> IKeeperNetworkDispatcher {
        let contract = declare("KeeperNetwork").unwrap().contract_class();
        let mut constructor_calldata = array![owner.into()];
        let (contract_address, _) = contract.deploy(@constructor_calldata).unwrap();
        IKeeperNetworkDispatcher { contract_address }
    }

    #[test]
    fn test_registration_and_stats() {
        let owner: ContractAddress = 0x123.try_into().unwrap();
        let keeper: ContractAddress = 0x456.try_into().unwrap();
        let dispatcher = deploy_keeper(owner);
        let mut spy = spy_events();

        start_cheat_caller_address(dispatcher.contract_address, keeper);
        dispatcher.register_keeper();
        stop_cheat_caller_address(dispatcher.contract_address);

        assert!(dispatcher.is_keeper(keeper), "Should be registered");
        
        let stats = dispatcher.get_keeper_stats(keeper);
        assert!(stats.total_executions == 0, "Initial stats wrong");

        // KeeperRegistered digunakan di sini, sehingga tidak memicu warning
        spy.assert_emitted(@array![
            (
                dispatcher.contract_address,
                KeeperNetwork::Event::KeeperRegistered(KeeperRegistered { keeper })
            )
        ]);
    }

    #[test]
    fn test_execution_fee_logic() {
        let owner: ContractAddress = 0x123.try_into().unwrap();
        let keeper: ContractAddress = 0x456.try_into().unwrap();
        let dispatcher = deploy_keeper(owner);

        start_cheat_caller_address(dispatcher.contract_address, keeper);
        dispatcher.register_keeper();

        let order_value: u256 = 10000;
        let order_id: felt252 = 1;
        let token_in: ContractAddress = 0x111.try_into().unwrap();
        let token_out: ContractAddress = 0x222.try_into().unwrap();
        dispatcher.create_limit_order(order_id, token_in, token_out, order_value, 1_u256, 9_999_999_999);
        dispatcher.execute_limit_order(order_id, order_value);

        let stats = dispatcher.get_keeper_stats(keeper);
        assert!(stats.earnings == 10, "Fee calculation mismatch");
        stop_cheat_caller_address(dispatcher.contract_address);
    }

    #[test]
    fn test_claim_earnings() {
        let owner: ContractAddress = 0x123.try_into().unwrap();
        let keeper: ContractAddress = 0x456.try_into().unwrap();
        let dispatcher = deploy_keeper(owner);

        start_cheat_caller_address(dispatcher.contract_address, keeper);
        dispatcher.register_keeper();
        let order_id: felt252 = 1;
        let order_value: u256 = 20000;
        let token_in: ContractAddress = 0x111.try_into().unwrap();
        let token_out: ContractAddress = 0x222.try_into().unwrap();
        dispatcher.create_limit_order(order_id, token_in, token_out, order_value, 1_u256, 9_999_999_999);
        dispatcher.execute_limit_order(order_id, order_value);

        let claimed = dispatcher.claim_earnings();
        assert!(claimed == 20, "Claimed amount wrong");
        stop_cheat_caller_address(dispatcher.contract_address);
    }

    #[test]
    #[should_panic(expected: "Only owner can slash")]
    fn test_slash_unauthorized() {
        let owner: ContractAddress = 0x123.try_into().unwrap();
        let keeper: ContractAddress = 0x456.try_into().unwrap();
        let dispatcher = deploy_keeper(owner);

        start_cheat_caller_address(dispatcher.contract_address, keeper);
        dispatcher.slash_keeper(keeper);
    }

    #[test]
    fn test_slash_by_owner() {
        let owner: ContractAddress = 0x123.try_into().unwrap();
        let keeper: ContractAddress = 0x456.try_into().unwrap();
        let dispatcher = deploy_keeper(owner);

        start_cheat_caller_address(dispatcher.contract_address, keeper);
        dispatcher.register_keeper();
        stop_cheat_caller_address(dispatcher.contract_address);

        start_cheat_caller_address(dispatcher.contract_address, owner);
        dispatcher.slash_keeper(keeper);

        assert!(!dispatcher.is_keeper(keeper), "Keeper should be removed");
        stop_cheat_caller_address(dispatcher.contract_address);
    }
}
