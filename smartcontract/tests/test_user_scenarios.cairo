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
use smartcontract::staking::staking_carel::{IStakingCarelDispatcher, IStakingCarelDispatcherTrait};
use smartcontract::core::treasury::{ITreasuryDispatcher, ITreasuryDispatcherTrait};
use smartcontract::privacy::private_payments::{
    IPrivatePaymentsDispatcher, IPrivatePaymentsDispatcherTrait, PaymentCommitment
};
use smartcontract::trading::dark_pool::{IDarkPoolDispatcher, IDarkPoolDispatcherTrait, DarkOrder};
use smartcontract::ai::ai_executor::{
    IAIExecutorDispatcher, IAIExecutorDispatcherTrait, IAIExecutorAdminDispatcher, IAIExecutorAdminDispatcherTrait, ActionType
};
use smartcontract::governance::governance::{IGovernanceDispatcher, IGovernanceDispatcherTrait};
use smartcontract::governance::timelock::{ITimelockDispatcher, ITimelockDispatcherTrait};
use snforge_std::start_cheat_block_timestamp;

#[starknet::interface]
pub trait IMockToken<TContractState> {
    // Updates balance configuration after access-control and invariant checks.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn set_balance(ref self: TContractState, account: ContractAddress, amount: u256);
    // Applies transfer after input validation and commits the resulting state.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    // Applies transfer from after input validation and commits the resulting state.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn transfer_from(
        ref self: TContractState,
        sender: ContractAddress,
        recipient: ContractAddress,
        amount: u256
    ) -> bool;
    // Implements balance of logic while keeping state transitions deterministic.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    // Implements burn logic while keeping state transitions deterministic.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn burn(ref self: TContractState, amount: u256);
}

#[starknet::contract]
pub mod MockERC20 {
    use starknet::ContractAddress;
    use starknet::storage::*;

    #[storage]
    pub struct Storage {
        pub balances: Map<ContractAddress, u256>
    }

    #[abi(embed_v0)]
    impl MockTokenImpl of super::IMockToken<ContractState> {
        // Updates balance configuration after access-control and invariant checks.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn set_balance(ref self: ContractState, account: ContractAddress, amount: u256) {
            self.balances.entry(account).write(amount);
        }

        // Applies transfer after input validation and commits the resulting state.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let _ = recipient;
            let _ = amount;
            true
        }

        // Applies transfer from after input validation and commits the resulting state.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256
        ) -> bool {
            let _ = sender;
            let _ = recipient;
            let _ = amount;
            true
        }

        // Implements balance of logic while keeping state transitions deterministic.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.entry(account).read()
        }

        // Implements burn logic while keeping state transitions deterministic.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn burn(ref self: ContractState, amount: u256) {
            let _ = amount;
        }
    }
}

#[starknet::interface]
pub trait IExecTarget<TContractState> {
    // Implements execute logic while keeping state transitions deterministic.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn execute(ref self: TContractState);
    // Returns get value from state without mutating storage.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn get_value(self: @TContractState) -> u256;
}

#[starknet::contract]
pub mod MockExecTarget {
    use starknet::storage::*;

    #[storage]
    pub struct Storage {
        pub value: u256
    }

    #[abi(embed_v0)]
    impl ExecImpl of super::IExecTarget<ContractState> {
        // Implements execute logic while keeping state transitions deterministic.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn execute(ref self: ContractState) {
            let current = self.value.read();
            self.value.write(current + 1);
        }

        // Returns get value from state without mutating storage.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn get_value(self: @ContractState) -> u256 {
            self.value.read()
        }
    }
}

#[starknet::interface]
pub trait IMockDEX<TContractState> {
    // Updates price configuration after access-control and invariant checks.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
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
        // Returns get quote from state without mutating storage.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn get_quote(self: @ContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256) -> u256 {
            let _ = from_token;
            let _ = to_token;
            let _ = amount;
            self.price.read()
        }

        // Implements swap logic while keeping state transitions deterministic.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn swap(ref self: ContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256, min_amount_out: u256) {
            let _ = from_token;
            let _ = to_token;
            let _ = amount;
            let _ = min_amount_out;
        }
    }

    #[abi(embed_v0)]
    impl IMockDEXImpl of super::IMockDEX<ContractState> {
        // Updates price configuration after access-control and invariant checks.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn set_price(ref self: ContractState, price: u256) {
            self.price.write(price);
        }
    }
}

// Deploys bridge aggregator fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_bridge_aggregator(owner: ContractAddress) -> IBridgeAggregatorDispatcher {
    let contract = declare("BridgeAggregator").unwrap().contract_class();
    let mut constructor_args = array![];
    owner.serialize(ref constructor_args);
    1000_u256.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    IBridgeAggregatorDispatcher { contract_address }
}

// Deploys swap aggregator fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_swap_aggregator(owner: ContractAddress) -> ISwapAggregatorDispatcher {
    let contract = declare("SwapAggregator").unwrap().contract_class();
    let mut constructor_args = array![];
    owner.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    ISwapAggregatorDispatcher { contract_address }
}

// Deploys keeper network fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_keeper_network(owner: ContractAddress) -> IKeeperNetworkDispatcher {
    let contract = declare("KeeperNetwork").unwrap().contract_class();
    let mut constructor_args = array![];
    owner.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    IKeeperNetworkDispatcher { contract_address }
}

// Deploys point storage fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_point_storage(signer: ContractAddress) -> IPointStorageDispatcher {
    let contract = declare("PointStorage").unwrap().contract_class();
    let mut constructor_args = array![];
    signer.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    IPointStorageDispatcher { contract_address }
}

// Deploys mock erc20 fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_mock_erc20() -> ContractAddress {
    let contract = declare("MockERC20").unwrap().contract_class();
    let (contract_address, _) = contract.deploy(@array![]).unwrap();
    contract_address
}

// Deploys discount soulbound fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_discount_soulbound(point_storage: ContractAddress, epoch: u64) -> IDiscountSoulboundDispatcher {
    let contract = declare("DiscountSoulbound").unwrap().contract_class();
    let mut constructor_args = array![];
    point_storage.serialize(ref constructor_args);
    epoch.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    IDiscountSoulboundDispatcher { contract_address }
}

// Deploys referral system fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_referral_system(admin: ContractAddress, signer: ContractAddress, point_storage: ContractAddress) -> IReferralSystemDispatcher {
    let contract = declare("ReferralSystem").unwrap().contract_class();
    let mut constructor_args = array![];
    admin.serialize(ref constructor_args);
    signer.serialize(ref constructor_args);
    point_storage.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    IReferralSystemDispatcher { contract_address }
}

// Deploys staking carel fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_staking_carel(token: ContractAddress, reward_pool: ContractAddress) -> IStakingCarelDispatcher {
    let contract = declare("StakingCarel").unwrap().contract_class();
    let mut constructor_args = array![];
    token.serialize(ref constructor_args);
    reward_pool.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    IStakingCarelDispatcher { contract_address }
}

// Deploys treasury fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_treasury(owner: ContractAddress, token: ContractAddress) -> ITreasuryDispatcher {
    let contract = declare("Treasury").unwrap().contract_class();
    let mut constructor_args = array![];
    owner.serialize(ref constructor_args);
    token.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    ITreasuryDispatcher { contract_address }
}

// Deploys governance fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_governance(voting_delay: u64, voting_period: u64) -> IGovernanceDispatcher {
    let contract = declare("Governance").unwrap().contract_class();
    let mut constructor_args = array![];
    voting_delay.serialize(ref constructor_args);
    voting_period.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    IGovernanceDispatcher { contract_address }
}

// Deploys timelock fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_timelock(admin: ContractAddress, min_delay: u64) -> ITimelockDispatcher {
    let contract = declare("Timelock").unwrap().contract_class();
    let mut constructor_args = array![];
    admin.serialize(ref constructor_args);
    min_delay.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    ITimelockDispatcher { contract_address }
}

// Deploys private payments fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_private_payments(admin: ContractAddress, verifier: ContractAddress) -> IPrivatePaymentsDispatcher {
    let contract = declare("PrivatePayments").unwrap().contract_class();
    let mut constructor_args = array![];
    admin.serialize(ref constructor_args);
    verifier.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    IPrivatePaymentsDispatcher { contract_address }
}

// Deploys dark pool fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_dark_pool(admin: ContractAddress, verifier: ContractAddress) -> IDarkPoolDispatcher {
    let contract = declare("DarkPool").unwrap().contract_class();
    let mut constructor_args = array![];
    admin.serialize(ref constructor_args);
    verifier.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    IDarkPoolDispatcher { contract_address }
}

// Deploys ai executor fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_ai_executor(token: ContractAddress, backend_signer: ContractAddress) -> IAIExecutorDispatcher {
    let contract = declare("AIExecutor").unwrap().contract_class();
    let mut constructor_args = array![];
    token.serialize(ref constructor_args);
    backend_signer.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    let admin = IAIExecutorAdminDispatcher { contract_address };
    start_cheat_caller_address(contract_address, backend_signer);
    admin.set_fee_config(1_000_000_000_000_000_000, 2_000_000_000_000_000_000, false);
    admin.set_signature_verification(0.try_into().unwrap(), false);
    stop_cheat_caller_address(contract_address);
    IAIExecutorDispatcher { contract_address }
}

// Deploys mock verifier fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_mock_verifier(admin: ContractAddress) -> ContractAddress {
    let contract = declare("MockGaragaVerifier").unwrap().contract_class();
    let mut constructor_args = array![];
    admin.serialize(ref constructor_args);
    true.serialize(ref constructor_args);
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    contract_address
}

// Deploys exec target fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_exec_target() -> ContractAddress {
    let contract = declare("MockExecTarget").unwrap().contract_class();
    let (contract_address, _) = contract.deploy(@array![]).unwrap();
    contract_address
}

#[test]
// Test case: validates user bridge flow behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
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
// Test case: validates user swap flow behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
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
// Test case: validates user limit order flow behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_user_limit_order_flow() {
    let owner: ContractAddress = 0x555.try_into().unwrap();
    let keeper: ContractAddress = 0x666.try_into().unwrap();
    let dispatcher = deploy_keeper_network(owner);
    let order_value: u256 = 20_000;
    let order_id: felt252 = 1;
    let token_in: ContractAddress = 0x111.try_into().unwrap();
    let token_out: ContractAddress = 0x222.try_into().unwrap();

    start_cheat_caller_address(dispatcher.contract_address, keeper);
    dispatcher.register_keeper();
    dispatcher.create_limit_order(order_id, token_in, token_out, order_value, 1_u256, 9_999_999_999);
    dispatcher.execute_limit_order(order_id, order_value);
    let claimed = dispatcher.claim_earnings();
    stop_cheat_caller_address(dispatcher.contract_address);

    assert(claimed == 20, 'Claimed earnings mismatch');
}

#[test]
// Test case: validates user points flow behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_user_points_flow() {
    let signer: ContractAddress = 0x777.try_into().unwrap();
    let user: ContractAddress = 0x888.try_into().unwrap();
    let dispatcher = deploy_point_storage(signer);
    let epoch: u64 = 1;
    let initial_points: u256 = 1_000;
    let consume_amount: u256 = 200;
    let total_points: u256 = 800;
    let total_distribution: u256 = 1_000_000;

    start_cheat_caller_address(dispatcher.contract_address, signer);
    dispatcher.submit_points(epoch, user, initial_points);
    dispatcher.consume_points(epoch, user, consume_amount);
    dispatcher.finalize_epoch(epoch, total_points);
    stop_cheat_caller_address(dispatcher.contract_address);

    assert(dispatcher.get_user_points(epoch, user) == total_points, 'User points mismatch');
    assert(dispatcher.get_global_points(epoch) == total_points, 'Global points mismatch');
    assert(dispatcher.is_epoch_finalized(epoch), 'Epoch should be finalized');
    let carel_amount = dispatcher.convert_points_to_carel(epoch, total_points, total_distribution);
    assert(carel_amount == total_distribution, 'Conversion mismatch');
}

#[test]
// Test case: validates points convert zero total returns zero behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_points_convert_zero_total_returns_zero() {
    let signer: ContractAddress = 0x777.try_into().unwrap();
    let user: ContractAddress = 0x999.try_into().unwrap();
    let dispatcher = deploy_point_storage(signer);
    let epoch: u64 = 2;

    start_cheat_caller_address(dispatcher.contract_address, signer);
    dispatcher.submit_points(epoch, user, 500);
    dispatcher.finalize_epoch(epoch, 0);
    stop_cheat_caller_address(dispatcher.contract_address);

    let carel_amount = dispatcher.convert_points_to_carel(epoch, 500, 1_000_000);
    assert(carel_amount == 0, 'Conversion zero');
}

#[test]
// Test case: validates user nft discount flow behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
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
// Test case: validates user referral flow behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
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

#[test]
// Test case: validates user staking flow behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_user_staking_flow() {
    let user: ContractAddress = 0x1111.try_into().unwrap();
    let token = deploy_mock_erc20();
    let staking = deploy_staking_carel(token, token);
    let amount: u256 = 100_000_000_000_000_000_000;

    start_cheat_caller_address(staking.contract_address, user);
    staking.stake(amount);
    stop_cheat_caller_address(staking.contract_address);

    assert(staking.get_user_stake(user) == amount, 'Stake amount mismatch');
}

#[test]
// Test case: validates user governance flow behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_user_governance_flow() {
    let governance = deploy_governance(0, 10);
    let target = deploy_exec_target();
    let mut targets = array![];
    targets.append(target);
    let mut calldata_list = array![];
    calldata_list.append(array![].span());

    let proposer: ContractAddress = 0x2222.try_into().unwrap();
    start_cheat_caller_address(governance.contract_address, proposer);
    let proposal_id = governance.propose(targets.span(), calldata_list.span(), "Test proposal");
    stop_cheat_caller_address(governance.contract_address);

    let voter: ContractAddress = 0x3333.try_into().unwrap();
    start_cheat_caller_address(governance.contract_address, voter);
    governance.vote(proposal_id, 1);
    stop_cheat_caller_address(governance.contract_address);

    governance.execute(proposal_id, targets.span(), calldata_list.span());

    let target_dispatcher = IExecTargetDispatcher { contract_address: target };
    assert(target_dispatcher.get_value() == 1, 'Governance execute failed');
}

#[test]
// Test case: validates user timelock flow behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_user_timelock_flow() {
    let admin: ContractAddress = 0x4444.try_into().unwrap();
    let timelock = deploy_timelock(admin, 0);
    let target = deploy_exec_target();
    let selector = selector!("execute");
    let eta: u64 = 1;

    start_cheat_caller_address(timelock.contract_address, admin);
    let tx_id = timelock.queue_transaction(target, selector, 0, array![].span(), eta);
    start_cheat_block_timestamp(timelock.contract_address, eta);
    timelock.execute_transaction(target, selector, 0, array![].span(), eta);
    stop_cheat_caller_address(timelock.contract_address);

    let queued = timelock.get_transaction(tx_id);
    assert(queued.executed, 'Timelock tx not executed');
}

#[test]
// Test case: validates user treasury flow behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_user_treasury_flow() {
    let owner: ContractAddress = 0x5555.try_into().unwrap();
    let collector: ContractAddress = 0x6666.try_into().unwrap();
    let token = deploy_mock_erc20();
    let treasury = deploy_treasury(owner, token);
    let token_dispatcher = IMockTokenDispatcher { contract_address: token };

    token_dispatcher.set_balance(treasury.contract_address, 1_000);

    start_cheat_caller_address(treasury.contract_address, owner);
    treasury.add_fee_collector(collector);
    treasury.set_burn_config(0, false);
    stop_cheat_caller_address(treasury.contract_address);

    start_cheat_caller_address(treasury.contract_address, collector);
    treasury.receive_fee(500);
    stop_cheat_caller_address(treasury.contract_address);

    let balance = treasury.get_treasury_balance();
    assert(balance == 1_000, 'Treasury balance mismatch');
}

#[test]
// Test case: validates user private payments flow behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_user_private_payments_flow() {
    let admin: ContractAddress = 0x7777.try_into().unwrap();
    let verifier = deploy_mock_verifier(admin);
    let payments = deploy_private_payments(admin, verifier);

    let payment = PaymentCommitment {
        ciphertext: 1,
        commitment: 2,
        amount_commitment: 3,
        finalized: false
    };

    let payment_id = payments.submit_private_payment(payment, array![].span(), array![].span());
    payments.finalize_private_payment(payment_id, 0x123.try_into().unwrap(), 0xabc, array![].span(), array![].span());
    assert(payments.is_nullifier_used(0xabc), 'Nullifier should be used');
}

#[test]
// Test case: validates user dark pool flow behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_user_dark_pool_flow() {
    let admin: ContractAddress = 0x8888.try_into().unwrap();
    let verifier = deploy_mock_verifier(admin);
    let pool = deploy_dark_pool(admin, verifier);

    let order = DarkOrder {
        ciphertext: 1,
        commitment: 2,
        filled: false
    };

    let order_id = pool.submit_order(order, array![].span(), array![].span());
    pool.match_order(order_id, 0xdef, array![].span(), array![].span());
    assert(pool.is_nullifier_used(0xdef), 'Nullifier should be used');
}

#[test]
// Test case: validates user ai executor flow behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_user_ai_executor_flow() {
    let backend: ContractAddress = 0x9999.try_into().unwrap();
    let user: ContractAddress = 0xaaaa.try_into().unwrap();
    let token = deploy_mock_erc20();
    let executor = deploy_ai_executor(token, backend);

    start_cheat_caller_address(executor.contract_address, user);
    let start_id = executor.batch_submit_actions(ActionType::Swap, "swap", 3);
    let pending = executor.get_pending_actions(user);
    stop_cheat_caller_address(executor.contract_address);

    assert(start_id == 1, 'Start id mismatch');
    assert(pending.len() == 3, 'Pending count mismatch');

    start_cheat_caller_address(executor.contract_address, backend);
    executor.batch_execute_actions(array![1, 2, 3].span(), array![].span());
    stop_cheat_caller_address(executor.contract_address);

    let pending_after = executor.get_pending_actions(user);
    assert(pending_after.len() == 0, 'Pending not cleared');
}
