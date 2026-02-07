use smartcontract::bridge::bridge_aggregator::{
    BridgeAggregator, BridgeProvider, BridgeRoute, IBridgeAggregatorDispatcher,
    IBridgeAggregatorDispatcherTrait,
};

use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_caller_address, stop_cheat_caller_address,
};

use starknet::ContractAddress;

// Fungsi pembantu untuk menyiapkan state awal pengujian
fn setup() -> (IBridgeAggregatorDispatcher, ContractAddress) {
    let owner: ContractAddress = 0x123.try_into().unwrap();
    let min_liquidity: u256 = 1000;

    // 1. Declare dan Deploy BridgeAggregator
    // Berdasarkan Contract Testing Template, kita mendeklarasikan nama kontrak sesuai Scarb.toml
    let contract = declare("BridgeAggregator").expect('Declaration failed').contract_class();
    let mut constructor_args = array![];
    owner.serialize(ref constructor_args);
    min_liquidity.serialize(ref constructor_args);

    let (contract_address, _) = contract.deploy(@constructor_args).expect('Deployment failed');
    let dispatcher = IBridgeAggregatorDispatcher { contract_address };

    // 2. Registrasi Provider awal oleh Owner
    start_cheat_caller_address(contract_address, owner);

    let provider_a = BridgeProvider {
        name: "LayerSwap",
        contract_address: 0xaaa.try_into().unwrap(),
        fee_rate: 800,
        avg_time: 30,
        liquidity: 50000,
        active: true,
    };
    dispatcher.register_bridge_provider('LSWAP', provider_a);

    let provider_b = BridgeProvider {
        name: "Atomiq",
        contract_address: 0xbbb.try_into().unwrap(),
        fee_rate: 200,
        avg_time: 300,
        liquidity: 5000,
        active: true,
    };
    dispatcher.register_bridge_provider('ATMQ', provider_b);

    stop_cheat_caller_address(contract_address);

    (dispatcher, owner)
}

#[test]
fn test_get_best_route_selection() {
    let (dispatcher, _) = setup();

    // Simulasi permintaan rute untuk 2000 unit
    let route = dispatcher.get_best_route('ETH', 'STRK', 2000);

    // Memastikan LayerSwap terpilih karena keunggulan likuiditas dan waktu
    assert(route.provider_id == 'LSWAP', 'Should select LayerSwap');
}

#[test]
fn test_execute_bridge_and_event() {
    let (dispatcher, _) = setup();
    let user: ContractAddress = 0x444.try_into().unwrap();
    let mut spy = spy_events();

    let route = BridgeRoute { provider_id: 'LSWAP', total_cost: 1300, estimated_time: 30 };

    start_cheat_caller_address(dispatcher.contract_address, user);
    dispatcher.execute_bridge(route, 1000);

    // Verifikasi emisi event menggunakan EventSpyAssertionsTrait
    spy.assert_emitted(
        @array![
            (
                dispatcher.contract_address,
                BridgeAggregator::Event::BridgeExecuted(
                    BridgeAggregator::BridgeExecuted {
                        user, 
                        provider_id: 'LSWAP', 
                        amount: 1000,
                    },
                ),
            ),
        ],
    );
    stop_cheat_caller_address(dispatcher.contract_address);
}

#[test]
#[should_panic(expected: 'Caller is not the owner')]
fn test_unauthorized_registration_fails() {
    let (dispatcher, _) = setup();
    let attacker: ContractAddress = 0x666.try_into().unwrap();

    let info = BridgeProvider {
        name: "FakeBridge",
        contract_address: attacker,
        fee_rate: 0,
        avg_time: 1,
        liquidity: 999999,
        active: true,
    };

    start_cheat_caller_address(dispatcher.contract_address, attacker);
    dispatcher.register_bridge_provider('FAKE', info);
}

#[test]
fn test_update_liquidity_by_provider() {
    let (dispatcher, _) = setup();
    let provider_addr: ContractAddress = 0xaaa.try_into().unwrap();

    // Verifikasi bahwa provider dapat memperbarui data likuiditasnya sendiri
    start_cheat_caller_address(dispatcher.contract_address, provider_addr);
    dispatcher.update_liquidity('LSWAP', 75000);
    stop_cheat_caller_address(dispatcher.contract_address);

    let route = dispatcher.get_best_route('ETH', 'STRK', 10);
    assert(route.provider_id == 'LSWAP', 'Update liquidity failed');
}