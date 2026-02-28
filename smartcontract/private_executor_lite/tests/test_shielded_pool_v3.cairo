//! # ShieldedPoolV3 Unit Tests
//!
//! Focus:
//! - nullifier-based private actions (swap/limit/stake)
//! - recipient sourced from proof output (no recipient execute arg)
//! - action hash binding and replay protection
//! - fixed denomination map tiers

use private_executor_lite::shielded_pool_v3::{
    IShieldedPoolV3Dispatcher, IShieldedPoolV3DispatcherTrait,
};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;

#[starknet::interface]
pub trait IMockPoolVerifierAdminV3<TContractState> {
    fn set_should_fail(ref self: TContractState, value: bool);
}

#[starknet::interface]
pub trait IMockTokenAdminV3<TContractState> {
    fn mint(ref self: TContractState, to: ContractAddress, amount: u256);
}

#[starknet::interface]
pub trait IMockTokenV3<TContractState> {
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
}

#[starknet::interface]
pub trait IMockSwapFillerV3<TContractState> {
    fn fill_payout(ref self: TContractState, payout_token: ContractAddress, amount: u256);
}

#[starknet::contract]
pub mod MockPoolVerifierV3 {
    use starknet::storage::*;

    #[storage]
    pub struct Storage {
        pub should_fail: bool,
    }

    #[abi(embed_v0)]
    impl VerifierImpl of private_executor_lite::shielded_pool_v3::IGroth16VerifierBlsOutput<
        ContractState,
    > {
        fn verify_groth16_proof_bls12_381(
            self: @ContractState, full_proof_with_hints: Span<felt252>,
        ) -> Option<Span<u256>> {
            if self.should_fail.read() {
                return Option::None;
            }
            assert!(full_proof_with_hints.len() >= 4, "mock proof too short");

            let mut out: Array<u256> = array![];
            let mut i = 0_usize;
            loop {
                if i >= full_proof_with_hints.len() {
                    break;
                };
                out.append((*full_proof_with_hints.at(i)).try_into().unwrap());
                i += 1;
            };
            Option::Some(out.span())
        }
    }

    #[abi(embed_v0)]
    impl AdminImpl of super::IMockPoolVerifierAdminV3<ContractState> {
        fn set_should_fail(ref self: ContractState, value: bool) {
            self.should_fail.write(value);
        }
    }
}

#[starknet::contract]
pub mod MockTokenV3 {
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::*;
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    pub struct Storage {
        pub balances: Map<ContractAddress, u256>,
        pub allowances: Map<felt252, u256>,
    }

    #[abi(embed_v0)]
    impl TokenImpl of super::IMockTokenV3<ContractState> {
        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let owner = get_caller_address();
            let key = _allowance_key(owner, spender);
            self.allowances.write(key, amount);
            true
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = get_caller_address();
            let sender_balance = self.balances.read(sender);
            assert!(sender_balance >= amount, "ERC20: insufficient balance");
            self.balances.write(sender, sender_balance - amount);
            let recipient_balance = self.balances.read(recipient);
            self.balances.write(recipient, recipient_balance + amount);
            true
        }

        fn transfer_from(
            ref self: ContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
        ) -> bool {
            let caller = get_caller_address();
            let allowance_key = _allowance_key(sender, caller);
            let allowance = self.allowances.read(allowance_key);
            assert!(allowance >= amount, "ERC20: insufficient allowance");

            let sender_balance = self.balances.read(sender);
            assert!(sender_balance >= amount, "ERC20: insufficient balance");
            self.allowances.write(allowance_key, allowance - amount);
            self.balances.write(sender, sender_balance - amount);

            let recipient_balance = self.balances.read(recipient);
            self.balances.write(recipient, recipient_balance + amount);
            true
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }
    }

    #[abi(embed_v0)]
    impl AdminImpl of super::IMockTokenAdminV3<ContractState> {
        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            let current = self.balances.read(to);
            self.balances.write(to, current + amount);
        }
    }

    fn _allowance_key(owner: ContractAddress, spender: ContractAddress) -> felt252 {
        let owner_felt: felt252 = owner.into();
        let spender_felt: felt252 = spender.into();
        let mut input: Array<felt252> = array![];
        input.append(owner_felt);
        input.append(spender_felt);
        poseidon_hash_span(input.span())
    }
}

#[starknet::contract]
pub mod MockSwapFillerV3 {
    use starknet::storage::*;
    use starknet::{ContractAddress, get_caller_address};
    use super::IMockTokenV3DispatcherTrait;

    #[storage]
    pub struct Storage {}

    #[abi(embed_v0)]
    impl SwapImpl of super::IMockSwapFillerV3<ContractState> {
        fn fill_payout(ref self: ContractState, payout_token: ContractAddress, amount: u256) {
            let caller = get_caller_address();
            let token = super::IMockTokenV3Dispatcher { contract_address: payout_token };
            let ok = token.transfer(caller, amount);
            assert!(ok, "fill transfer failed");
        }
    }
}

fn setup_pool_v3() -> (
    IShieldedPoolV3Dispatcher,
    IMockTokenV3Dispatcher,
    IMockTokenV3Dispatcher,
    IMockSwapFillerV3Dispatcher,
    ContractAddress,
    ContractAddress,
    ContractAddress,
    felt252,
) {
    let admin: ContractAddress = 0x111.try_into().unwrap();
    let relayer: ContractAddress = 0x222.try_into().unwrap();
    let user: ContractAddress = 0x333.try_into().unwrap();
    let root: felt252 = 0x1001;

    let verifier_class = declare("MockPoolVerifierV3").unwrap().contract_class();
    let (verifier_addr, _) = verifier_class.deploy(@array![]).unwrap();

    let token_class = declare("MockTokenV3").unwrap().contract_class();
    let (token_in_addr, _) = token_class.deploy(@array![]).unwrap();
    let (token_out_addr, _) = token_class.deploy(@array![]).unwrap();
    let token_in = IMockTokenV3Dispatcher { contract_address: token_in_addr };
    let token_out = IMockTokenV3Dispatcher { contract_address: token_out_addr };
    let token_in_admin = IMockTokenAdminV3Dispatcher { contract_address: token_in_addr };
    let token_out_admin = IMockTokenAdminV3Dispatcher { contract_address: token_out_addr };

    let swap_class = declare("MockSwapFillerV3").unwrap().contract_class();
    let (swap_addr, _) = swap_class.deploy(@array![]).unwrap();
    let swap = IMockSwapFillerV3Dispatcher { contract_address: swap_addr };

    let pool_class = declare("ShieldedPoolV3").unwrap().contract_class();
    let mut constructor_args = array![];
    admin.serialize(ref constructor_args);
    verifier_addr.serialize(ref constructor_args);
    relayer.serialize(ref constructor_args);
    let (pool_addr, _) = pool_class.deploy(@constructor_args).unwrap();
    let pool = IShieldedPoolV3Dispatcher { contract_address: pool_addr };

    start_cheat_caller_address(pool.contract_address, admin);
    pool.set_root(root);
    pool.set_asset_rule(token_in_addr, 10, 100_u256);
    stop_cheat_caller_address(pool.contract_address);

    token_in_admin.mint(user, 2_000_u256);
    token_out_admin.mint(swap_addr, 10_000_u256);

    (pool, token_in, token_out, swap, admin, relayer, user, root)
}

#[test]
fn test_v3_swap_payout_uses_recipient_from_proof() {
    let (pool, token_in, token_out, swap, _admin, relayer, user, root) = setup_pool_v3();
    let note_commitment: felt252 = 0xaaa1;
    let nullifier: felt252 = 0xaaa2;
    let recipient: ContractAddress = 0x444.try_into().unwrap();
    let recipient_felt: felt252 = recipient.into();
    let selector = selector!("fill_payout");
    let payout_amount: u256 = 77_u256;
    let min_payout: u256 = 70_u256;
    let payout_token_felt: felt252 = token_out.contract_address.into();
    let calldata = array![payout_token_felt, payout_amount.low.into(), payout_amount.high.into()];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);
    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment, nullifier);
    stop_cheat_caller_address(pool.contract_address);

    let action_hash = pool
        .preview_swap_action_hash(
            swap.contract_address,
            selector,
            calldata.span(),
            token_in.contract_address,
            token_out.contract_address,
            min_payout,
        );
    let proof = array![root, nullifier, action_hash, recipient_felt];

    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_swap(root, nullifier, proof.span());
    stop_cheat_caller_address(pool.contract_address);

    start_cheat_caller_address(pool.contract_address, relayer);
    pool
        .execute_private_swap_with_payout(
            nullifier,
            swap.contract_address,
            selector,
            calldata.span(),
            token_in.contract_address,
            token_out.contract_address,
            min_payout,
        );
    stop_cheat_caller_address(pool.contract_address);

    assert(pool.is_nullifier_used(nullifier), 'NULL_SPENT');
    assert(!pool.is_pending_swap(nullifier), 'NO_PENDING');
    assert(token_out.balance_of(recipient) == payout_amount, 'RECIPIENT_PAID');
}

#[test]
fn test_v3_two_notes_same_denom_both_spendable() {
    let (pool, token_in, token_out, swap, _admin, relayer, user, root) = setup_pool_v3();
    let note_1: felt252 = 0xb001;
    let note_2: felt252 = 0xb002;
    let nullifier_1: felt252 = 0xb101;
    let nullifier_2: felt252 = 0xb102;
    let recipient_1: ContractAddress = 0x551.try_into().unwrap();
    let recipient_2: ContractAddress = 0x552.try_into().unwrap();
    let recipient_1_felt: felt252 = recipient_1.into();
    let recipient_2_felt: felt252 = recipient_2.into();
    let selector = selector!("fill_payout");
    let payout_1: u256 = 33_u256;
    let payout_2: u256 = 44_u256;
    let min_1: u256 = 30_u256;
    let min_2: u256 = 40_u256;
    let payout_token_felt: felt252 = token_out.contract_address.into();
    let calldata_1 = array![payout_token_felt, payout_1.low.into(), payout_1.high.into()];
    let calldata_2 = array![payout_token_felt, payout_2.low.into(), payout_2.high.into()];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 200_u256);
    stop_cheat_caller_address(token_in.contract_address);
    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_1, nullifier_1);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_2, nullifier_2);
    stop_cheat_caller_address(pool.contract_address);

    let hash_1 = pool
        .preview_swap_action_hash(
            swap.contract_address,
            selector,
            calldata_1.span(),
            token_in.contract_address,
            token_out.contract_address,
            min_1,
        );
    let hash_2 = pool
        .preview_swap_action_hash(
            swap.contract_address,
            selector,
            calldata_2.span(),
            token_in.contract_address,
            token_out.contract_address,
            min_2,
        );

    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_swap(root, nullifier_1, array![root, nullifier_1, hash_1, recipient_1_felt].span());
    pool.submit_private_swap(root, nullifier_2, array![root, nullifier_2, hash_2, recipient_2_felt].span());
    stop_cheat_caller_address(pool.contract_address);

    start_cheat_caller_address(pool.contract_address, relayer);
    pool
        .execute_private_swap_with_payout(
            nullifier_1,
            swap.contract_address,
            selector,
            calldata_1.span(),
            token_in.contract_address,
            token_out.contract_address,
            min_1,
        );
    pool
        .execute_private_swap_with_payout(
            nullifier_2,
            swap.contract_address,
            selector,
            calldata_2.span(),
            token_in.contract_address,
            token_out.contract_address,
            min_2,
        );
    stop_cheat_caller_address(pool.contract_address);

    assert(pool.is_nullifier_used(nullifier_1), 'N1_USED');
    assert(pool.is_nullifier_used(nullifier_2), 'N2_USED');
    assert(token_out.balance_of(recipient_1) == payout_1, 'R1_OK');
    assert(token_out.balance_of(recipient_2) == payout_2, 'R2_OK');
}

#[test]
#[should_panic(expected: "Action hash mismatch")]
fn test_v3_action_hash_mismatch_reverts() {
    let (pool, token_in, token_out, swap, _admin, relayer, user, root) = setup_pool_v3();
    let note_commitment: felt252 = 0xc001;
    let nullifier: felt252 = 0xc002;
    let recipient: ContractAddress = 0x600.try_into().unwrap();
    let recipient_felt: felt252 = recipient.into();
    let selector = selector!("fill_payout");
    let payout_token_felt: felt252 = token_out.contract_address.into();

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);
    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment, nullifier);
    stop_cheat_caller_address(pool.contract_address);

    let submit_calldata = array![payout_token_felt, 55, 0];
    let execute_calldata = array![payout_token_felt, 56, 0];
    let action_hash = pool
        .preview_swap_action_hash(
            swap.contract_address,
            selector,
            submit_calldata.span(),
            token_in.contract_address,
            token_out.contract_address,
            50_u256,
        );
    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_swap(root, nullifier, array![root, nullifier, action_hash, recipient_felt].span());
    stop_cheat_caller_address(pool.contract_address);

    start_cheat_caller_address(pool.contract_address, relayer);
    pool
        .execute_private_swap_with_payout(
            nullifier,
            swap.contract_address,
            selector,
            execute_calldata.span(),
            token_in.contract_address,
            token_out.contract_address,
            50_u256,
        );
}

#[test]
#[should_panic(expected: "Nullifier already spent")]
fn test_v3_rejects_double_spend_nullifier() {
    let (pool, token_in, token_out, swap, _admin, relayer, user, root) = setup_pool_v3();
    let note_commitment: felt252 = 0xd001;
    let nullifier: felt252 = 0xd002;
    let recipient: ContractAddress = 0x610.try_into().unwrap();
    let recipient_felt: felt252 = recipient.into();
    let selector = selector!("fill_payout");
    let payout_token_felt: felt252 = token_out.contract_address.into();
    let calldata = array![payout_token_felt, 21, 0];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);
    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment, nullifier);
    stop_cheat_caller_address(pool.contract_address);

    let action_hash = pool
        .preview_swap_action_hash(
            swap.contract_address,
            selector,
            calldata.span(),
            token_in.contract_address,
            token_out.contract_address,
            20_u256,
        );
    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_swap(root, nullifier, array![root, nullifier, action_hash, recipient_felt].span());
    stop_cheat_caller_address(pool.contract_address);

    start_cheat_caller_address(pool.contract_address, relayer);
    pool
        .execute_private_swap_with_payout(
            nullifier,
            swap.contract_address,
            selector,
            calldata.span(),
            token_in.contract_address,
            token_out.contract_address,
            20_u256,
        );
    stop_cheat_caller_address(pool.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_swap(root, nullifier, array![root, nullifier, action_hash, recipient_felt].span());
}

#[test]
fn test_v3_limit_and_stake_paths_work() {
    let (pool, token_in, token_out, swap, _admin, relayer, user, root) = setup_pool_v3();
    let selector = selector!("fill_payout");
    let payout_token_felt: felt252 = token_out.contract_address.into();
    let recipient_limit: ContractAddress = 0x701.try_into().unwrap();
    let recipient_stake: ContractAddress = 0x702.try_into().unwrap();
    let recipient_limit_felt: felt252 = recipient_limit.into();
    let recipient_stake_felt: felt252 = recipient_stake.into();

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 200_u256);
    stop_cheat_caller_address(token_in.contract_address);
    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, 0xe001, 0xe101);
    pool.deposit_fixed_v3(token_in.contract_address, 10, 0xe002, 0xe102);
    stop_cheat_caller_address(pool.contract_address);

    let calldata_limit = array![payout_token_felt, 31, 0];
    let calldata_stake = array![payout_token_felt, 41, 0];
    let hash_limit = pool
        .preview_limit_action_hash(
            swap.contract_address,
            selector,
            calldata_limit.span(),
            token_in.contract_address,
            token_out.contract_address,
            30_u256,
        );
    let hash_stake = pool
        .preview_stake_action_hash(
            swap.contract_address,
            selector,
            calldata_stake.span(),
            token_in.contract_address,
            token_out.contract_address,
            40_u256,
        );

    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_limit(root, 0xe101, array![root, 0xe101, hash_limit, recipient_limit_felt].span());
    pool.submit_private_stake(root, 0xe102, array![root, 0xe102, hash_stake, recipient_stake_felt].span());
    stop_cheat_caller_address(pool.contract_address);

    start_cheat_caller_address(pool.contract_address, relayer);
    pool
        .execute_private_limit_with_payout(
            0xe101,
            swap.contract_address,
            selector,
            calldata_limit.span(),
            token_in.contract_address,
            token_out.contract_address,
            30_u256,
        );
    pool
        .execute_private_stake_with_payout(
            0xe102,
            swap.contract_address,
            selector,
            calldata_stake.span(),
            token_in.contract_address,
            token_out.contract_address,
            40_u256,
        );
    stop_cheat_caller_address(pool.contract_address);

    assert(pool.is_nullifier_used(0xe101), 'L_USED');
    assert(pool.is_nullifier_used(0xe102), 'S_USED');
    assert(token_out.balance_of(recipient_limit) == 31_u256, 'L_PAID');
    assert(token_out.balance_of(recipient_stake) == 41_u256, 'S_PAID');
}

#[test]
fn test_v3_pending_action_is_keyed_by_nullifier() {
    let (pool, token_in, token_out, swap, _admin, _relayer, user, root) = setup_pool_v3();
    let selector = selector!("fill_payout");
    let nullifier: felt252 = 0xf101;
    let not_nullifier_but_note: felt252 = 0xf001;
    let recipient: ContractAddress = 0x808.try_into().unwrap();
    let recipient_felt: felt252 = recipient.into();
    let payout_token_felt: felt252 = token_out.contract_address.into();
    let calldata = array![payout_token_felt, 25, 0];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);
    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, not_nullifier_but_note, nullifier);
    stop_cheat_caller_address(pool.contract_address);

    let action_hash = pool
        .preview_swap_action_hash(
            swap.contract_address,
            selector,
            calldata.span(),
            token_in.contract_address,
            token_out.contract_address,
            20_u256,
        );
    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_swap(root, nullifier, array![root, nullifier, action_hash, recipient_felt].span());
    stop_cheat_caller_address(pool.contract_address);

    assert(pool.get_pending_action_hash(nullifier) == action_hash, 'PENDING_BY_NULL');
    assert(pool.get_pending_action_hash(not_nullifier_but_note) == 0, 'NOT_BY_NOTE');
}

#[test]
fn test_v3_denom_tiers_configurable() {
    let (pool, token_in, _token_out, _swap, admin, _relayer, _user, _root) = setup_pool_v3();
    start_cheat_caller_address(pool.contract_address, admin);
    pool.set_asset_rule(token_in.contract_address, 1, 1_u256);
    pool.set_asset_rule(token_in.contract_address, 5, 5_u256);
    pool.set_asset_rule(token_in.contract_address, 10, 10_u256);
    pool.set_asset_rule(token_in.contract_address, 50, 50_u256);
    pool.set_asset_rule(token_in.contract_address, 100, 100_u256);
    stop_cheat_caller_address(pool.contract_address);

    assert(pool.fixed_amount(token_in.contract_address, 1) == 1_u256, 'D1');
    assert(pool.fixed_amount(token_in.contract_address, 5) == 5_u256, 'D5');
    assert(pool.fixed_amount(token_in.contract_address, 10) == 10_u256, 'D10');
    assert(pool.fixed_amount(token_in.contract_address, 50) == 50_u256, 'D50');
    assert(pool.fixed_amount(token_in.contract_address, 100) == 100_u256, 'D100');
}

#[test]
fn test_v3_withdraw_note_returns_original_token_and_blocks_spend() {
    let (pool, token_in, _token_out, _swap, _admin, _relayer, user, _root) = setup_pool_v3();
    let note_commitment: felt252 = 0xa991;
    let nullifier: felt252 = 0xa992;

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment, nullifier);
    stop_cheat_caller_address(pool.contract_address);

    assert(token_in.balance_of(user) == 1_900_u256, 'USER_AFTER_DEPOSIT');

    start_cheat_caller_address(pool.contract_address, user);
    pool.withdraw_note_v3(note_commitment);
    stop_cheat_caller_address(pool.contract_address);

    assert(token_in.balance_of(user) == 2_000_u256, 'USER_AFTER_WITHDRAW');
    assert(pool.is_nullifier_used(nullifier), 'NULL_CONSUMED');
}

#[test]
#[should_panic(expected: "Only note owner")]
fn test_v3_withdraw_note_only_owner() {
    let (pool, token_in, _token_out, _swap, _admin, _relayer, user, _root) = setup_pool_v3();
    let note_commitment: felt252 = 0xaa11;
    let nullifier: felt252 = 0xaa12;
    let attacker: ContractAddress = 0xdead.try_into().unwrap();

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment, nullifier);
    stop_cheat_caller_address(pool.contract_address);

    start_cheat_caller_address(pool.contract_address, attacker);
    pool.withdraw_note_v3(note_commitment);
}
