use starknet::ContractAddress;
use core::array::ArrayTrait;
use core::traits::TryInto;
use snforge_std::{
    declare, DeclareResultTrait, ContractClassTrait, 
    start_cheat_caller_address, stop_cheat_caller_address
};

use smartcontract::ai::ai_executor::{
    IAIExecutorDispatcher, IAIExecutorDispatcherTrait, ActionType,
    IAIExecutorAdminDispatcher, IAIExecutorAdminDispatcherTrait
};

fn deploy_executor() -> (IAIExecutorDispatcher, ContractAddress, ContractAddress) {
    let carel_token: ContractAddress = 0x111.try_into().unwrap();
    let admin: ContractAddress = 0x222.try_into().unwrap();
    let user: ContractAddress = 0x333.try_into().unwrap();

    let contract = declare("AIExecutor").unwrap().contract_class();
    let mut constructor_args = array![];
    carel_token.serialize(ref constructor_args);
    admin.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();

    (IAIExecutorDispatcher { contract_address }, admin, user)
}

#[test]
fn test_ai_executor_burst_load() {
    let (dispatcher, admin, user) = deploy_executor();

    // Configure for load: disable fees/signature checks and raise rate limit.
    start_cheat_caller_address(dispatcher.contract_address, admin);
    let admin_dispatcher = IAIExecutorAdminDispatcher { contract_address: dispatcher.contract_address };
    admin_dispatcher.set_fee_config(1, 2, false);
    admin_dispatcher.set_signature_verification(0.try_into().unwrap(), false);
    admin_dispatcher.set_rate_limit(1000);
    admin_dispatcher.set_max_pending_scan(2000);
    admin_dispatcher.set_max_batch_execute(200);
    stop_cheat_caller_address(dispatcher.contract_address);

    start_cheat_caller_address(dispatcher.contract_address, user);
    dispatcher.batch_submit_actions(ActionType::Swap, "load", 100);
    stop_cheat_caller_address(dispatcher.contract_address);

    let mut total: u64 = 0;
    let mut offset: u64 = 0;
    loop {
        let page = dispatcher.get_pending_actions_page(user, offset, 10);
        let page_len: u64 = page.len().into();
        total += page_len;
        if page_len < 10 {
            break;
        }
        offset += 10;
    };
    assert!(total == 100, "Should accumulate 100 pending actions");
}
