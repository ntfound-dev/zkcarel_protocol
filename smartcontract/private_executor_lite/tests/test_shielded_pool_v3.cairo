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
    start_cheat_block_timestamp, stop_cheat_block_timestamp, stop_cheat_caller_address,
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
    fn allowance(self: @TContractState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
}

#[starknet::interface]
pub trait IMockSwapFillerV3<TContractState> {
    fn fill_payout(ref self: TContractState, payout_token: ContractAddress, amount: u256);
    fn fill_same_token(
        ref self: TContractState, token: ContractAddress, amount_in: u256, amount_out: u256,
    );
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
            assert!(full_proof_with_hints.len() >= 3, "mock proof too short");

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

        fn allowance(self: @ContractState, owner: ContractAddress, spender: ContractAddress) -> u256 {
            self.allowances.read(_allowance_key(owner, spender))
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
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
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

        fn fill_same_token(
            ref self: ContractState, token: ContractAddress, amount_in: u256, amount_out: u256,
        ) {
            let caller = get_caller_address();
            let token_dispatcher = super::IMockTokenV3Dispatcher { contract_address: token };
            let pulled = token_dispatcher.transfer_from(caller, get_contract_address(), amount_in);
            assert!(pulled, "fill_same_token transfer_from failed");
            let returned = token_dispatcher.transfer(caller, amount_out);
            assert!(returned, "fill_same_token transfer failed");
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
    token_in_admin.mint(swap_addr, 10_000_u256);
    token_out_admin.mint(swap_addr, 10_000_u256);

    (pool, token_in, token_out, swap, admin, relayer, user, root)
}

#[test]
#[should_panic(expected: "Verifier update timelocked")]
fn test_v3_verifier_update_requires_timelock() {
    let (pool, _token_in, _token_out, _swap, admin, _relayer, _user, _root) = setup_pool_v3();

    let verifier_class = declare("MockPoolVerifierV3").unwrap().contract_class();
    let (next_verifier, _) = verifier_class.deploy(@array![]).unwrap();

    start_cheat_block_timestamp(pool.contract_address, 1_000);
    start_cheat_caller_address(pool.contract_address, admin);
    pool.set_verifier(next_verifier);
    assert(pool.get_verifier() != next_verifier, 'VERIFIER_NOT_IMMEDIATE');
    assert(pool.get_pending_verifier() == next_verifier, 'VERIFIER_PENDING');
    assert(pool.get_pending_verifier_ready_at() == 87_400, 'ETA_SET');
    pool.apply_verifier_update();
}

#[test]
fn test_v3_verifier_update_applies_after_timelock() {
    let (pool, _token_in, _token_out, _swap, admin, _relayer, _user, _root) = setup_pool_v3();

    let current_verifier = pool.get_verifier();
    let verifier_class = declare("MockPoolVerifierV3").unwrap().contract_class();
    let (next_verifier, _) = verifier_class.deploy(@array![]).unwrap();

    start_cheat_block_timestamp(pool.contract_address, 1_000);
    start_cheat_caller_address(pool.contract_address, admin);
    pool.set_verifier(next_verifier);
    stop_cheat_caller_address(pool.contract_address);
    stop_cheat_block_timestamp(pool.contract_address);

    start_cheat_block_timestamp(pool.contract_address, 87_400);
    start_cheat_caller_address(pool.contract_address, admin);
    pool.apply_verifier_update();
    stop_cheat_caller_address(pool.contract_address);
    stop_cheat_block_timestamp(pool.contract_address);

    assert(current_verifier != next_verifier, 'DIFF_VERIFIER');
    assert(pool.get_verifier() == next_verifier, 'VERIFIER_UPDATED');
    assert(pool.get_pending_verifier() == 0.try_into().unwrap(), 'NO_PENDING_VERIFIER');
    assert(pool.get_pending_verifier_ready_at() == 0, 'NO_PENDING_ETA');
}

#[test]
fn test_v3_admin_transfer_requires_acceptance() {
    let (pool, _token_in, _token_out, _swap, admin, _relayer, _user, _root) = setup_pool_v3();
    let next_admin: ContractAddress = 0x444.try_into().unwrap();

    start_cheat_caller_address(pool.contract_address, admin);
    pool.transfer_admin(next_admin);
    stop_cheat_caller_address(pool.contract_address);

    assert(pool.get_admin() == admin, 'ADMIN_UNCHANGED');
    assert(pool.get_pending_admin() == next_admin, 'PENDING_ADMIN');

    start_cheat_caller_address(pool.contract_address, next_admin);
    pool.accept_admin();
    stop_cheat_caller_address(pool.contract_address);

    assert(pool.get_admin() == next_admin, 'ADMIN_ROTATED');
    assert(pool.get_pending_admin() == 0.try_into().unwrap(), 'NO_PENDING_ADMIN');
}

#[test]
fn test_v3_pause_and_unpause_toggle_state() {
    let (pool, _token_in, _token_out, _swap, admin, _relayer, _user, _root) = setup_pool_v3();

    start_cheat_caller_address(pool.contract_address, admin);
    pool.pause();
    stop_cheat_caller_address(pool.contract_address);
    assert(pool.is_paused(), 'PAUSED');

    start_cheat_caller_address(pool.contract_address, admin);
    pool.unpause();
    stop_cheat_caller_address(pool.contract_address);
    assert(!pool.is_paused(), 'UNPAUSED');
}

#[test]
#[should_panic(expected: "Paused")]
fn test_v3_pause_blocks_deposit() {
    let (pool, token_in, _token_out, _swap, admin, _relayer, user, _root) = setup_pool_v3();

    start_cheat_caller_address(pool.contract_address, admin);
    pool.pause();
    stop_cheat_caller_address(pool.contract_address);

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, 0xaa01);
}

#[test]
fn test_v3_swap_payout_uses_recipient_from_proof() {
    let (pool, token_in, token_out, swap, _admin, relayer, user, root) = setup_pool_v3();
    let note_commitment: felt252 = 0xaaa1;
    let nullifier: felt252 = 0xaaa2;
    let recipient: ContractAddress = 0x444.try_into().unwrap();
    let recipient_felt: felt252 = recipient.into();
    let selector = selector!("fill_payout");
    let approval_token: ContractAddress = 0.try_into().unwrap();
    let approval_amount: u256 = 0_u256;
    let payout_amount: u256 = 77_u256;
    let min_payout: u256 = 70_u256;
    let payout_token_felt: felt252 = token_out.contract_address.into();
    let calldata = array![payout_token_felt, payout_amount.low.into(), payout_amount.high.into()];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);
    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment);
    stop_cheat_caller_address(pool.contract_address);

    let action_hash = pool
        .preview_swap_action_hash(
            swap.contract_address,
            selector,
            calldata.span(),
            approval_token,
            approval_amount,
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
            approval_token,
            approval_amount,
            token_out.contract_address,
            min_payout,
        );
    stop_cheat_caller_address(pool.contract_address);

    assert(pool.is_nullifier_used(nullifier), 'NULL_SPENT');
    assert(!pool.is_pending_swap(nullifier), 'NO_PENDING');
    assert(token_out.balance_of(recipient) == payout_amount, 'RECIPIENT_PAID');
}

#[test]
fn test_v3_same_token_payout_uses_net_received_accounting() {
    let (pool, token_in, _token_out, swap, _admin, relayer, user, root) = setup_pool_v3();
    let note_commitment: felt252 = 0xaaa3;
    let nullifier: felt252 = 0xaaa4;
    let recipient: ContractAddress = 0x445.try_into().unwrap();
    let recipient_felt: felt252 = recipient.into();
    let selector = selector!("fill_same_token");
    let approval_amount: u256 = 100_u256;
    let payout_amount: u256 = 105_u256;
    let min_payout: u256 = 105_u256;
    let token_felt: felt252 = token_in.contract_address.into();
    let calldata = array![
        token_felt,
        approval_amount.low.into(),
        approval_amount.high.into(),
        payout_amount.low.into(),
        payout_amount.high.into()
    ];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, approval_amount);
    stop_cheat_caller_address(token_in.contract_address);
    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment);
    stop_cheat_caller_address(pool.contract_address);

    let action_hash = pool
        .preview_swap_action_hash(
            swap.contract_address,
            selector,
            calldata.span(),
            token_in.contract_address,
            approval_amount,
            token_in.contract_address,
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
            approval_amount,
            token_in.contract_address,
            min_payout,
        );
    stop_cheat_caller_address(pool.contract_address);

    assert(token_in.balance_of(recipient) == payout_amount, 'SAME_TOKEN_PAID');
    assert(token_in.balance_of(pool.contract_address) == 0_u256, 'NOTE_CONSUMED');
}

#[test]
#[should_panic(expected: "Verifier output too short")]
fn test_v3_rejects_legacy_three_output_proof() {
    let (pool, token_in, token_out, swap, _admin, _relayer, user, root) = setup_pool_v3();
    let note_commitment: felt252 = 0xaaab;
    let nullifier: felt252 = 0xaaac;
    let selector = selector!("fill_payout");
    let approval_token: ContractAddress = 0.try_into().unwrap();
    let approval_amount: u256 = 0_u256;
    let min_payout: u256 = 60_u256;
    let payout_token_felt: felt252 = token_out.contract_address.into();
    let calldata = array![payout_token_felt, 66, 0];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);
    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment);
    stop_cheat_caller_address(pool.contract_address);

    let action_hash = pool
        .preview_swap_action_hash(
            swap.contract_address,
            selector,
            calldata.span(),
            approval_token,
            approval_amount,
            token_out.contract_address,
            min_payout,
        );
    let legacy_proof = array![root, nullifier, action_hash];

    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_swap(root, nullifier, legacy_proof.span());
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
    let approval_token: ContractAddress = 0.try_into().unwrap();
    let approval_amount: u256 = 0_u256;
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
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_1);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_2);
    stop_cheat_caller_address(pool.contract_address);

    let hash_1 = pool
        .preview_swap_action_hash(
            swap.contract_address,
            selector,
            calldata_1.span(),
            approval_token,
            approval_amount,
            token_out.contract_address,
            min_1,
        );
    let hash_2 = pool
        .preview_swap_action_hash(
            swap.contract_address,
            selector,
            calldata_2.span(),
            approval_token,
            approval_amount,
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
            approval_token,
            approval_amount,
            token_out.contract_address,
            min_1,
        );
    pool
        .execute_private_swap_with_payout(
            nullifier_2,
            swap.contract_address,
            selector,
            calldata_2.span(),
            approval_token,
            approval_amount,
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
    let approval_token: ContractAddress = 0.try_into().unwrap();
    let approval_amount: u256 = 0_u256;
    let payout_token_felt: felt252 = token_out.contract_address.into();

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);
    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment);
    stop_cheat_caller_address(pool.contract_address);

    let submit_calldata = array![payout_token_felt, 55, 0];
    let execute_calldata = array![payout_token_felt, 56, 0];
    let action_hash = pool
        .preview_swap_action_hash(
            swap.contract_address,
            selector,
            submit_calldata.span(),
            approval_token,
            approval_amount,
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
            approval_token,
            approval_amount,
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
    let approval_token: ContractAddress = 0.try_into().unwrap();
    let approval_amount: u256 = 0_u256;
    let payout_token_felt: felt252 = token_out.contract_address.into();
    let calldata = array![payout_token_felt, 21, 0];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);
    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment);
    stop_cheat_caller_address(pool.contract_address);

    let action_hash = pool
        .preview_swap_action_hash(
            swap.contract_address,
            selector,
            calldata.span(),
            approval_token,
            approval_amount,
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
            approval_token,
            approval_amount,
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
    let approval_token: ContractAddress = 0.try_into().unwrap();
    let approval_amount: u256 = 0_u256;
    let payout_token_felt: felt252 = token_out.contract_address.into();
    let recipient_limit: ContractAddress = 0x701.try_into().unwrap();
    let recipient_stake: ContractAddress = 0x702.try_into().unwrap();
    let recipient_limit_felt: felt252 = recipient_limit.into();
    let recipient_stake_felt: felt252 = recipient_stake.into();

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 200_u256);
    stop_cheat_caller_address(token_in.contract_address);
    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, 0xe001);
    pool.deposit_fixed_v3(token_in.contract_address, 10, 0xe002);
    stop_cheat_caller_address(pool.contract_address);

    let calldata_limit = array![payout_token_felt, 31, 0];
    let calldata_stake = array![payout_token_felt, 41, 0];
    let hash_limit = pool
        .preview_limit_action_hash(
            swap.contract_address,
            selector,
            calldata_limit.span(),
            approval_token,
            approval_amount,
            token_out.contract_address,
            30_u256,
        );
    let hash_stake = pool
        .preview_stake_action_hash(
            swap.contract_address,
            selector,
            calldata_stake.span(),
            approval_token,
            approval_amount,
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
            approval_token,
            approval_amount,
            token_out.contract_address,
            30_u256,
        );
    pool
        .execute_private_stake_with_payout(
            0xe102,
            swap.contract_address,
            selector,
            calldata_stake.span(),
            approval_token,
            approval_amount,
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
    let approval_token: ContractAddress = 0.try_into().unwrap();
    let approval_amount: u256 = 0_u256;
    let calldata = array![payout_token_felt, 25, 0];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);
    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, not_nullifier_but_note);
    stop_cheat_caller_address(pool.contract_address);

    let action_hash = pool
        .preview_swap_action_hash(
            swap.contract_address,
            selector,
            calldata.span(),
            approval_token,
            approval_amount,
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
fn test_v3_cancel_private_action_allows_resubmit_same_action_hash() {
    let (pool, token_in, token_out, swap, _admin, _relayer, user, root) = setup_pool_v3();
    let note_commitment: felt252 = 0xa991;
    let nullifier: felt252 = 0xa992;
    let recipient: ContractAddress = 0x919.try_into().unwrap();
    let recipient_felt: felt252 = recipient.into();
    let selector = selector!("fill_payout");
    let approval_token: ContractAddress = 0.try_into().unwrap();
    let approval_amount: u256 = 0_u256;
    let payout_token_felt: felt252 = token_out.contract_address.into();
    let calldata = array![payout_token_felt, 25, 0];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment);
    stop_cheat_caller_address(pool.contract_address);

    let action_hash = pool
        .preview_swap_action_hash(
            swap.contract_address,
            selector,
            calldata.span(),
            approval_token,
            approval_amount,
            token_out.contract_address,
            20_u256,
        );

    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_swap(root, nullifier, array![root, nullifier, action_hash, recipient_felt].span());
    assert(pool.is_pending_swap(nullifier), 'PENDING_BEFORE_CANCEL');
    pool.cancel_private_action(nullifier);
    assert(!pool.is_pending_swap(nullifier), 'PENDING_CLEARED');
    pool.submit_private_swap(root, nullifier, array![root, nullifier, action_hash, recipient_felt].span());
    stop_cheat_caller_address(pool.contract_address);

    assert(pool.get_pending_action_hash(nullifier) == action_hash, 'RESUBMITTED');
}

#[test]
#[should_panic(expected: "Pending action expired")]
fn test_v3_execute_rejects_expired_pending_action() {
    let (pool, token_in, token_out, swap, _admin, relayer, user, root) = setup_pool_v3();
    let note_commitment: felt252 = 0xaa91;
    let nullifier: felt252 = 0xaa92;
    let recipient: ContractAddress = 0x920.try_into().unwrap();
    let recipient_felt: felt252 = recipient.into();
    let selector = selector!("fill_payout");
    let approval_token: ContractAddress = 0.try_into().unwrap();
    let approval_amount: u256 = 0_u256;
    let payout_token_felt: felt252 = token_out.contract_address.into();
    let calldata = array![payout_token_felt, 25, 0];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment);
    stop_cheat_caller_address(pool.contract_address);

    let action_hash = pool.preview_swap_action_hash(
        swap.contract_address,
        selector,
        calldata.span(),
        approval_token,
        approval_amount,
        token_out.contract_address,
        20_u256,
    );

    start_cheat_block_timestamp(pool.contract_address, 1_000);
    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_swap(root, nullifier, array![root, nullifier, action_hash, recipient_felt].span());
    stop_cheat_caller_address(pool.contract_address);
    stop_cheat_block_timestamp(pool.contract_address);

    start_cheat_block_timestamp(pool.contract_address, 87_401);
    start_cheat_caller_address(pool.contract_address, relayer);
    pool.execute_private_swap_with_payout(
        nullifier,
        swap.contract_address,
        selector,
        calldata.span(),
        approval_token,
        approval_amount,
        token_out.contract_address,
        20_u256,
    );
}

#[test]
#[should_panic(expected: "Paused")]
fn test_v3_pause_blocks_execute() {
    let (pool, token_in, token_out, swap, admin, relayer, user, root) = setup_pool_v3();
    let note_commitment: felt252 = 0xaa95;
    let nullifier: felt252 = 0xaa96;
    let recipient: ContractAddress = 0x925.try_into().unwrap();
    let recipient_felt: felt252 = recipient.into();
    let selector = selector!("fill_payout");
    let approval_token: ContractAddress = 0.try_into().unwrap();
    let approval_amount: u256 = 0_u256;
    let payout_token_felt: felt252 = token_out.contract_address.into();
    let calldata = array![payout_token_felt, 31, 0];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment);
    stop_cheat_caller_address(pool.contract_address);

    let action_hash = pool.preview_swap_action_hash(
        swap.contract_address,
        selector,
        calldata.span(),
        approval_token,
        approval_amount,
        token_out.contract_address,
        30_u256,
    );

    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_swap(root, nullifier, array![root, nullifier, action_hash, recipient_felt].span());
    stop_cheat_caller_address(pool.contract_address);

    start_cheat_caller_address(pool.contract_address, admin);
    pool.pause();
    stop_cheat_caller_address(pool.contract_address);

    start_cheat_caller_address(pool.contract_address, relayer);
    pool.execute_private_swap_with_payout(
        nullifier,
        swap.contract_address,
        selector,
        calldata.span(),
        approval_token,
        approval_amount,
        token_out.contract_address,
        30_u256,
    );
}

#[test]
fn test_v3_legacy_swap_getters_ignore_non_swap_actions() {
    let (pool, token_in, token_out, swap, _admin, _relayer, user, root) = setup_pool_v3();
    let note_commitment: felt252 = 0xaa93;
    let nullifier: felt252 = 0xaa94;
    let recipient: ContractAddress = 0x924.try_into().unwrap();
    let recipient_felt: felt252 = recipient.into();
    let selector = selector!("fill_payout");
    let approval_token: ContractAddress = 0.try_into().unwrap();
    let approval_amount: u256 = 0_u256;
    let payout_token_felt: felt252 = token_out.contract_address.into();
    let calldata = array![payout_token_felt, 31, 0];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment);
    stop_cheat_caller_address(pool.contract_address);

    let action_hash = pool.preview_limit_action_hash(
        swap.contract_address,
        selector,
        calldata.span(),
        approval_token,
        approval_amount,
        token_out.contract_address,
        30_u256,
    );

    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_limit(root, nullifier, array![root, nullifier, action_hash, recipient_felt].span());
    stop_cheat_caller_address(pool.contract_address);

    assert(pool.get_pending_swap_action_hash(nullifier) == 0, 'LEGACY_SWAP_HASH_ZERO');
    assert(
        pool.get_pending_swap_recipient(nullifier) == 0.try_into().unwrap(),
        'LEGACY_SWAP_RECIP_ZERO',
    );
}

#[test]
fn test_v3_private_exit_transfers_to_bound_recipient() {
    let (pool, token_in, _token_out, _swap, _admin, _relayer, user, root) = setup_pool_v3();
    let note_commitment: felt252 = 0xab11;
    let nullifier: felt252 = 0xab12;
    let recipient: ContractAddress = 0x921.try_into().unwrap();
    let recipient_felt: felt252 = recipient.into();
    let exit_amount: u256 = 100_u256;

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, exit_amount);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment);
    stop_cheat_caller_address(pool.contract_address);

    let exit_hash = pool.preview_exit_hash(token_in.contract_address, exit_amount, recipient);
    let proof = array![root, nullifier, exit_hash, recipient_felt];

    start_cheat_caller_address(pool.contract_address, user);
    pool.private_exit_v3(
        root, nullifier, proof.span(), token_in.contract_address, exit_amount, recipient,
    );
    stop_cheat_caller_address(pool.contract_address);

    assert(pool.is_nullifier_used(nullifier), 'EXIT_SPENT');
    assert(token_in.balance_of(recipient) == exit_amount, 'EXIT_RECIPIENT_PAID');
    assert(token_in.balance_of(pool.contract_address) == 0_u256, 'POOL_EMPTIED');
}

#[test]
#[should_panic(expected: "Paused")]
fn test_v3_pause_blocks_private_exit() {
    let (pool, token_in, _token_out, _swap, admin, _relayer, user, root) = setup_pool_v3();
    let note_commitment: felt252 = 0xab21;
    let nullifier: felt252 = 0xab22;
    let recipient: ContractAddress = 0x926.try_into().unwrap();
    let recipient_felt: felt252 = recipient.into();
    let exit_amount: u256 = 100_u256;

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, exit_amount);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment);
    stop_cheat_caller_address(pool.contract_address);

    start_cheat_caller_address(pool.contract_address, admin);
    pool.pause();
    stop_cheat_caller_address(pool.contract_address);

    let exit_hash = pool.preview_exit_hash(token_in.contract_address, exit_amount, recipient);
    let proof = array![root, nullifier, exit_hash, recipient_felt];

    start_cheat_caller_address(pool.contract_address, user);
    pool.private_exit_v3(
        root, nullifier, proof.span(), token_in.contract_address, exit_amount, recipient,
    );
}

#[test]
#[should_panic(expected: "Exit hash mismatch")]
fn test_v3_private_exit_rejects_mismatched_hash() {
    let (pool, token_in, _token_out, _swap, _admin, _relayer, user, root) = setup_pool_v3();
    let note_commitment: felt252 = 0xac11;
    let nullifier: felt252 = 0xac12;
    let recipient: ContractAddress = 0x922.try_into().unwrap();
    let recipient_felt: felt252 = recipient.into();

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment);
    stop_cheat_caller_address(pool.contract_address);

    let exit_hash = pool.preview_exit_hash(token_in.contract_address, 100_u256, recipient);
    let proof = array![root, nullifier, exit_hash, recipient_felt];

    start_cheat_caller_address(pool.contract_address, user);
    pool.private_exit_v3(
        root, nullifier, proof.span(), token_in.contract_address, 99_u256, recipient,
    );
}

#[test]
#[should_panic(expected: "Pending action exists")]
fn test_v3_private_exit_rejects_pending_nullifier() {
    let (pool, token_in, token_out, swap, _admin, _relayer, user, root) = setup_pool_v3();
    let note_commitment: felt252 = 0xad11;
    let nullifier: felt252 = 0xad12;
    let recipient: ContractAddress = 0x923.try_into().unwrap();
    let recipient_felt: felt252 = recipient.into();
    let selector = selector!("fill_payout");
    let approval_token: ContractAddress = 0.try_into().unwrap();
    let approval_amount: u256 = 0_u256;
    let payout_token_felt: felt252 = token_out.contract_address.into();
    let action_calldata = array![payout_token_felt, 21, 0];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment);
    stop_cheat_caller_address(pool.contract_address);

    let action_hash = pool.preview_swap_action_hash(
        swap.contract_address,
        selector,
        action_calldata.span(),
        approval_token,
        approval_amount,
        token_out.contract_address,
        20_u256,
    );

    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_swap(root, nullifier, array![root, nullifier, action_hash, recipient_felt].span());

    let exit_hash = pool.preview_exit_hash(token_in.contract_address, 100_u256, recipient);
    let exit_proof = array![root, nullifier, exit_hash, recipient_felt];
    pool.private_exit_v3(
        root, nullifier, exit_proof.span(), token_in.contract_address, 100_u256, recipient,
    );
}

#[test]
#[should_panic(expected: "Direct note withdrawal disabled")]
fn test_v3_direct_withdraw_is_disabled() {
    let (pool, token_in, _token_out, _swap, _admin, _relayer, user, _root) = setup_pool_v3();
    let note_commitment: felt252 = 0xaa11;

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment);
    pool.withdraw_note_v3(note_commitment);
}
