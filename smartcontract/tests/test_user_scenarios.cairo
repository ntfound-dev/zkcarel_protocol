use starknet::ContractAddress;
use snforge_std::{
    declare, DeclareResultTrait, ContractClassTrait, start_cheat_caller_address,
    stop_cheat_caller_address, spy_events, EventSpyAssertionsTrait
};

use smartcontract::bridge::bridge_aggregator::{
    BridgeAggregator, BridgeProvider, BridgeRoute, IBridgeAggregatorDispatcher,
    IBridgeAggregatorDispatcherTrait
};
use smartcontract::bridge::swap_aggregator::{
    ISwapAggregatorDispatcher, ISwapAggregatorDispatcherTrait
};
use smartcontract::trading::dca_orders::{IKeeperNetworkDispatcher, IKeeperNetworkDispatcherTrait};
use smartcontract::rewards::point_storage::{
    IPointStorageDispatcher, IPointStorageDispatcherTrait,
    IPointStorageAdminDispatcher, IPointStorageAdminDispatcherTrait
};
use smartcontract::nft::discount_soulbound::{IDiscountSoulboundDispatcher, IDiscountSoulboundDispatcherTrait};
use smartcontract::rewards::referral_system::{IReferralSystemDispatcher, IReferralSystemDispatcherTrait};

#[starknet::interface]
pub trait IMockDEX<TContractState> {
    fn set_price(ref self: TContractState, price: u256);
}

#[starknet::contract]
pub mod MockDEX {
    use starknet::ContractAddress;
    use starknet::storage::*;

    #[storage]
    pub struct Storage {
        pub price: u256
    }

    #[abi(embed_v0)]
    impl IDEXRouterImpl of smartcontract::bridge::swap_aggregator::IDEXRouter<ContractState> {
        fn get_quote(self: @ContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256) -> u256 {
            let _ = from_token;
            let _ = to_token;
            let _ = amount;
            self.price.read()
        }

        fn swap(ref self: ContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256, min_amount_out: u256) {
            let _ = from_token;
            let _ = to_token;
            let _ = amount;
            let _ = min_amount_out;
        }
    }

    #[abi(embed_v0)]
    impl IMockDEXImpl of super::IMockDEX<ContractState> {
        fn set_price(ref self: ContractState, price: u256) {
            self.price.write(price);
        }
    }
}

fn deploy_bridge_aggregator(owner: ContractAddress) -> IBridgeAggregatorDispatcher {
    let contract = declare("BridgeAggregator").unwrap().contract_class();
    let mut constructor_args = array![];
    owner.serialize(ref constructor_args);
    1000_u256.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    IBridgeAggregatorDispatcher { contract_address }
}

fn deploy_swap_aggregator(owner: ContractAddress) -> ISwapAggregatorDispatcher {
    let contract = declare("SwapAggregator").unwrap().contract_class();
    let mut constructor_args = array![];
    owner.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    ISwapAggregatorDispatcher { contract_address }
}

fn deploy_keeper_network(owner: ContractAddress) -> IKeeperNetworkDispatcher {
    let contract = declare("KeeperNetwork").unwrap().contract_class();
    let mut constructor_args = array![];
    owner.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    IKeeperNetworkDispatcher { contract_address }
}

fn deploy_point_storage(signer: ContractAddress) -> IPointStorageDispatcher {
    let contract = declare("PointStorage").unwrap().contract_class();
    let mut constructor_args = array![];
    signer.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    IPointStorageDispatcher { contract_address }
}

fn deploy_discount_soulbound(point_storage: ContractAddress, epoch: u64) -> IDiscountSoulboundDispatcher {
    let contract = declare("DiscountSoulbound").unwrap().contract_class();
    let mut constructor_args = array![];
    point_storage.serialize(ref constructor_args);
    epoch.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    IDiscountSoulboundDispatcher { contract_address }
}

fn deploy_referral_system(admin: ContractAddress, signer: ContractAddress, point_storage: ContractAddress) -> IReferralSystemDispatcher {
    let contract = declare("ReferralSystem").unwrap().contract_class();
    let mut constructor_args = array![];
    admin.serialize(ref constructor_args);
    signer.serialize(ref constructor_args);
    point_storage.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    IReferralSystemDispatcher { contract_address }
}

#[test]
fn test_user_bridge_flow() {
    let owner: ContractAddress = 0x111.try_into().unwrap();
    let user: ContractAddress = 0x222.try_into().unwrap();
    let dispatcher = deploy_bridge_aggregator(owner);
    let mut spy = spy_events();
    let amount: u256 = 10_000;

    start_cheat_caller_address(dispatcher.contract_address, owner);
    let provider = BridgeProvider {
        name: "LayerSwap",
        contract_address: 0xaaa.try_into().unwrap(),
        fee_rate: 200,
        avg_time: 30,
        liquidity: 100_000,
        active: true,
    };
    dispatcher.register_bridge_provider('LSWAP', provider);
    stop_cheat_caller_address(dispatcher.contract_address);

    let route: BridgeRoute = dispatcher.get_best_route('BTC', 'CAREL', amount);

    start_cheat_caller_address(dispatcher.contract_address, user);
    dispatcher.execute_bridge(route, amount);
    stop_cheat_caller_address(dispatcher.contract_address);

    spy.assert_emitted(@array![
        (
            dispatcher.contract_address,
            BridgeAggregator::Event::BridgeExecuted(
                BridgeAggregator::BridgeExecuted { user, provider_id: 'LSWAP', amount }
            ),
        ),
    ]);
}

#[test]
fn test_user_swap_flow() {
    let owner: ContractAddress = 0x333.try_into().unwrap();
    let user: ContractAddress = 0x444.try_into().unwrap();
    let token_a: ContractAddress = 0xaaa.try_into().unwrap();
    let token_b: ContractAddress = 0xbbb.try_into().unwrap();
    let dispatcher = deploy_swap_aggregator(owner);
    let amount_in: u256 = 1_000;

    let dex_class = declare("MockDEX").unwrap().contract_class();
    let (dex_low, _) = dex_class.deploy(@array![]).unwrap();
    let (dex_high, _) = dex_class.deploy(@array![]).unwrap();

    IMockDEXDispatcher { contract_address: dex_low }.set_price(900);
    IMockDEXDispatcher { contract_address: dex_high }.set_price(1200);

    start_cheat_caller_address(dispatcher.contract_address, owner);
    dispatcher.register_dex_router('DEXLOW', dex_low);
    dispatcher.register_dex_router('DEXHIGH', dex_high);
    stop_cheat_caller_address(dispatcher.contract_address);

    let route = dispatcher.get_best_swap_route(token_a, token_b, amount_in);
    assert(route.dex_id == 'DEXHIGH', 'Should select best DEX');

    start_cheat_caller_address(dispatcher.contract_address, user);
    dispatcher.execute_swap(route, token_a, token_b, amount_in, false);
    stop_cheat_caller_address(dispatcher.contract_address);
}

#[test]
fn test_user_limit_order_flow() {
    let owner: ContractAddress = 0x555.try_into().unwrap();
    let keeper: ContractAddress = 0x666.try_into().unwrap();
    let dispatcher = deploy_keeper_network(owner);
    let order_value: u256 = 20_000;

    start_cheat_caller_address(dispatcher.contract_address, keeper);
    dispatcher.register_keeper();
    dispatcher.execute_limit_order(1, order_value);
    let claimed = dispatcher.claim_earnings();
    stop_cheat_caller_address(dispatcher.contract_address);

    assert(claimed == 20, 'Claimed earnings mismatch');
}

#[test]
fn test_user_points_flow() {
    let signer: ContractAddress = 0x777.try_into().unwrap();
    let user: ContractAddress = 0x888.try_into().unwrap();
    let dispatcher = deploy_point_storage(signer);
    let epoch: u64 = 1;
    let initial_points: u256 = 1_000;
    let consume_amount: u256 = 200;
    let total_points: u256 = 800;

    start_cheat_caller_address(dispatcher.contract_address, signer);
    dispatcher.submit_points(epoch, user, initial_points);
    dispatcher.consume_points(epoch, user, consume_amount);
    dispatcher.finalize_epoch(epoch, total_points);
    stop_cheat_caller_address(dispatcher.contract_address);

    assert(dispatcher.get_user_points(epoch, user) == total_points, 'User points mismatch');
    assert(dispatcher.get_global_points(epoch) == total_points, 'Global points mismatch');
    assert(dispatcher.is_epoch_finalized(epoch), 'Epoch should be finalized');
}

#[test]
fn test_user_nft_discount_flow() {
    let backend: ContractAddress = 0x999.try_into().unwrap();
    let user: ContractAddress = 0xabc.try_into().unwrap();
    let epoch: u64 = 1;
    let dispatcher = deploy_point_storage(backend);
    let nft = deploy_discount_soulbound(dispatcher.contract_address, epoch);

    // Authorize DiscountSoulbound as points consumer
    start_cheat_caller_address(dispatcher.contract_address, backend);
    let admin = IPointStorageAdminDispatcher { contract_address: dispatcher.contract_address };
    admin.add_consumer(nft.contract_address);
    dispatcher.submit_points(epoch, user, 10_000);
    stop_cheat_caller_address(dispatcher.contract_address);

    start_cheat_caller_address(nft.contract_address, user);
    nft.mint_nft(1);
    let discount = nft.get_user_discount(user);
    assert(discount == 5, 'Discount tier mismatch');
    nft.use_discount(user);
    stop_cheat_caller_address(nft.contract_address);
}

#[test]
fn test_user_referral_flow() {
    let admin: ContractAddress = 0xaaa.try_into().unwrap();
    let backend: ContractAddress = 0xbbb.try_into().unwrap();
    let referrer: ContractAddress = 0xccc.try_into().unwrap();
    let referee: ContractAddress = 0xddd.try_into().unwrap();
    let epoch: u64 = 1;

    let point_storage = deploy_point_storage(backend);
    let referral = deploy_referral_system(admin, backend, point_storage.contract_address);

    // Authorize referral system as point producer
    start_cheat_caller_address(point_storage.contract_address, backend);
    let admin_dispatcher = IPointStorageAdminDispatcher { contract_address: point_storage.contract_address };
    admin_dispatcher.add_producer(referral.contract_address);
    stop_cheat_caller_address(point_storage.contract_address);

    // Referee registers referral
    start_cheat_caller_address(referral.contract_address, referee);
    referral.register_referral(referrer, referee);
    stop_cheat_caller_address(referral.contract_address);

    // Backend records referee points
    start_cheat_caller_address(referral.contract_address, backend);
    referral.record_referee_points(epoch, referee, 1_000);
    stop_cheat_caller_address(referral.contract_address);

    // Referrer claims bonus -> should mint points
    start_cheat_caller_address(referral.contract_address, referrer);
    let claimed = referral.claim_referral_bonus(epoch);
    stop_cheat_caller_address(referral.contract_address);

    assert(claimed == 100, 'Referral bonus mismatch');
    assert(point_storage.get_user_points(epoch, referrer) == 100, 'Point storage bonus mismatch');
}
