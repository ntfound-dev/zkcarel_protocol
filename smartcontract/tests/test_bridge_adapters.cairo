use starknet::ContractAddress;
use core::traits::TryInto;
use core::byte_array::ByteArray;

use snforge_std::{
    declare, DeclareResultTrait, ContractClassTrait, EventSpyAssertionsTrait, spy_events,
    start_cheat_caller_address, stop_cheat_caller_address
};

use smartcontract::bridge::bridge_aggregator::{
    BridgeProvider, BridgeRoute,
    IBridgeAggregatorDispatcher, IBridgeAggregatorDispatcherTrait
};
use smartcontract::bridge::provider_adapter::{
    IBridgeAdapterAdminDispatcher, IBridgeAdapterAdminDispatcherTrait,
    IBridgeProviderAdapterDispatcher, IBridgeProviderAdapterDispatcherTrait
};
use smartcontract::bridge::atomiq_adapter::AtomiqAdapter;
use smartcontract::bridge::garden_adapter::GardenAdapter;
use smartcontract::bridge::layerswap_adapter::LayerSwapAdapter;

fn deploy_aggregator(owner: ContractAddress) -> IBridgeAggregatorDispatcher {
    let min_liquidity: u256 = 1000;
    let contract = declare("BridgeAggregator").unwrap().contract_class();
    let mut constructor_args = array![];
    owner.serialize(ref constructor_args);
    min_liquidity.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    IBridgeAggregatorDispatcher { contract_address }
}

fn register_provider(
    dispatcher: IBridgeAggregatorDispatcher,
    owner: ContractAddress,
    provider_id: felt252,
    provider_addr: ContractAddress
) {
    let info = BridgeProvider {
        name: "Provider",
        contract_address: provider_addr,
        fee_rate: 100,
        avg_time: 60,
        liquidity: 100000,
        active: true,
    };

    start_cheat_caller_address(dispatcher.contract_address, owner);
    dispatcher.register_bridge_provider(provider_id, info);
    stop_cheat_caller_address(dispatcher.contract_address);
}

#[test]
fn test_atomiq_adapter_emits_event() {
    let admin: ContractAddress = 0x111.try_into().unwrap();
    let contract = declare("AtomiqAdapter").unwrap().contract_class();
    let mut constructor_args = array![];
    admin.serialize(ref constructor_args);
    let endpoint: ByteArray = "";
    endpoint.serialize(ref constructor_args);
    let (adapter_address, _) = contract.deploy(@constructor_args).unwrap();

    let mut spy = spy_events();
    start_cheat_caller_address(adapter_address, admin);
    let adapter_admin = IBridgeAdapterAdminDispatcher { contract_address: adapter_address };
    adapter_admin.set_active(true);
    stop_cheat_caller_address(adapter_address);

    let dispatcher = IBridgeProviderAdapterDispatcher { contract_address: adapter_address };
    dispatcher.execute_bridge(0xABC.try_into().unwrap(), 1000, 'ATMQ');

    spy.assert_emitted(
        @array![
            (
                adapter_address,
                AtomiqAdapter::Event::BridgeRequested(
                    AtomiqAdapter::BridgeRequested {
                        user: 0xABC.try_into().unwrap(),
                        amount: 1000,
                        provider_id: 'ATMQ',
                    },
                ),
            ),
        ],
    );
}

#[test]
fn test_garden_adapter_emits_event() {
    let admin: ContractAddress = 0x111.try_into().unwrap();
    let contract = declare("GardenAdapter").unwrap().contract_class();
    let mut constructor_args = array![];
    admin.serialize(ref constructor_args);
    let endpoint: ByteArray = "";
    endpoint.serialize(ref constructor_args);
    let (adapter_address, _) = contract.deploy(@constructor_args).unwrap();

    let mut spy = spy_events();
    let dispatcher = IBridgeProviderAdapterDispatcher { contract_address: adapter_address };
    dispatcher.execute_bridge(0xABC.try_into().unwrap(), 1000, 'GARD');

    spy.assert_emitted(
        @array![
            (
                adapter_address,
                GardenAdapter::Event::BridgeRequested(
                    GardenAdapter::BridgeRequested {
                        user: 0xABC.try_into().unwrap(),
                        amount: 1000,
                        provider_id: 'GARD',
                    },
                ),
            ),
        ],
    );
}

#[test]
fn test_layerswap_adapter_emits_event() {
    let admin: ContractAddress = 0x111.try_into().unwrap();
    let contract = declare("LayerSwapAdapter").unwrap().contract_class();
    let mut constructor_args = array![];
    admin.serialize(ref constructor_args);
    let endpoint: ByteArray = "";
    endpoint.serialize(ref constructor_args);
    let (adapter_address, _) = contract.deploy(@constructor_args).unwrap();

    let mut spy = spy_events();
    let dispatcher = IBridgeProviderAdapterDispatcher { contract_address: adapter_address };
    dispatcher.execute_bridge(0xABC.try_into().unwrap(), 1000, 'LSWP');

    spy.assert_emitted(
        @array![
            (
                adapter_address,
                LayerSwapAdapter::Event::BridgeRequested(
                    LayerSwapAdapter::BridgeRequested {
                        user: 0xABC.try_into().unwrap(),
                        amount: 1000,
                        provider_id: 'LSWP',
                    },
                ),
            ),
        ],
    );
}

#[test]
fn test_bridge_aggregator_calls_adapter() {
    let owner: ContractAddress = 0x999.try_into().unwrap();
    let dispatcher = deploy_aggregator(owner);

    let adapter_contract = declare("AtomiqAdapter").unwrap().contract_class();
    let mut adapter_args = array![];
    owner.serialize(ref adapter_args);
    let endpoint: ByteArray = "";
    endpoint.serialize(ref adapter_args);
    let (adapter_address, _) = adapter_contract.deploy(@adapter_args).unwrap();

    register_provider(dispatcher, owner, 'ATMQ', 0xAAA.try_into().unwrap());

    start_cheat_caller_address(dispatcher.contract_address, owner);
    dispatcher.set_provider_adapter('ATMQ', adapter_address);
    stop_cheat_caller_address(dispatcher.contract_address);

    let route = BridgeRoute { provider_id: 'ATMQ', total_cost: 100, estimated_time: 60 };
    let mut spy = spy_events();

    start_cheat_caller_address(dispatcher.contract_address, 0xABC.try_into().unwrap());
    dispatcher.execute_bridge(route, 2000);
    stop_cheat_caller_address(dispatcher.contract_address);

    spy.assert_emitted(
        @array![
            (
                adapter_address,
                AtomiqAdapter::Event::BridgeRequested(
                    AtomiqAdapter::BridgeRequested {
                        user: 0xABC.try_into().unwrap(),
                        amount: 2000,
                        provider_id: 'ATMQ',
                    },
                ),
            ),
        ],
    );
}
