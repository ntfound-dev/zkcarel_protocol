//! # ShieldedPoolV3 Security Regression Tests
//!
//! These tests lock in the hardened behavior for the V3 pool.

use private_executor_lite::shielded_pool_v3::{
    IShieldedPoolV3Dispatcher, IShieldedPoolV3DispatcherTrait, ShieldedPoolV3,
};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_block_timestamp, start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;

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
pub trait IMockActionTargetV3<TContractState> {
    fn mark(ref self: TContractState, value: felt252);
    fn get_mark(self: @TContractState) -> felt252;
}

#[starknet::interface]
pub trait IMockDrainTargetV3<TContractState> {
    fn drain(
        ref self: TContractState,
        token: ContractAddress,
        from: ContractAddress,
        to: ContractAddress,
        amount: u256,
    );
}

#[starknet::interface]
pub trait IMaliciousRelayerTargetV3<TContractState> {
    fn attack(
        ref self: TContractState,
        pool: ContractAddress,
        nullifier: felt252,
        approval_token: ContractAddress,
        approval_amount: u256,
        payout_token: ContractAddress,
        min_payout: u256,
        payout_amount: u256,
    );
}

#[starknet::contract]
pub mod PocPoolVerifierV3 {
    #[storage]
    pub struct Storage {}

    #[abi(embed_v0)]
    impl VerifierImpl of private_executor_lite::shielded_pool_v3::IGroth16VerifierBlsOutput<
        ContractState,
    > {
        fn verify_groth16_proof_bls12_381(
            self: @ContractState, full_proof_with_hints: Span<felt252>,
        ) -> Option<Span<u256>> {
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
}

#[starknet::contract]
pub mod PocMaliciousSubmitVerifierV3 {
    use starknet::ContractAddress;
    use private_executor_lite::shielded_pool_v3::{
        IShieldedPoolV3Dispatcher, IShieldedPoolV3DispatcherTrait,
    };

    #[storage]
    pub struct Storage {}

    #[abi(embed_v0)]
    impl VerifierImpl of private_executor_lite::shielded_pool_v3::IGroth16VerifierBlsOutput<
        ContractState,
    > {
        fn verify_groth16_proof_bls12_381(
            self: @ContractState, full_proof_with_hints: Span<felt252>,
        ) -> Option<Span<u256>> {
            assert!(full_proof_with_hints.len() >= 5, "mock proof too short");

            if *full_proof_with_hints.at(0_usize) == 1 {
                assert!(full_proof_with_hints.len() >= 10, "reenter proof too short");
                let pool: ContractAddress = (*full_proof_with_hints.at(5_usize)).try_into().unwrap();
                let inner_root = *full_proof_with_hints.at(6_usize);
                let inner_nullifier = *full_proof_with_hints.at(7_usize);
                let inner_action_hash = *full_proof_with_hints.at(8_usize);
                let inner_recipient = *full_proof_with_hints.at(9_usize);
                let inner_proof = array![0, inner_root, inner_nullifier, inner_action_hash, inner_recipient];
                let pool_dispatcher = IShieldedPoolV3Dispatcher { contract_address: pool };
                pool_dispatcher.submit_private_swap(inner_root, inner_nullifier, inner_proof.span());
            }

            let mut out: Array<u256> = array![];
            let mut i = 1_usize;
            loop {
                if i >= 5 {
                    break;
                };
                out.append((*full_proof_with_hints.at(i)).try_into().unwrap());
                i += 1;
            };
            Option::Some(out.span())
        }
    }
}

#[starknet::contract]
pub mod PocTokenV3 {
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
pub mod PocActionTargetV3 {
    use starknet::storage::*;

    #[storage]
    pub struct Storage {
        pub mark: felt252,
    }

    #[abi(embed_v0)]
    impl TargetImpl of super::IMockActionTargetV3<ContractState> {
        fn mark(ref self: ContractState, value: felt252) {
            self.mark.write(value);
        }

        fn get_mark(self: @ContractState) -> felt252 {
            self.mark.read()
        }
    }
}

#[starknet::contract]
pub mod PocDrainTargetV3 {
    use starknet::ContractAddress;
    use super::IMockTokenV3DispatcherTrait;

    #[storage]
    pub struct Storage {}

    #[abi(embed_v0)]
    impl TargetImpl of super::IMockDrainTargetV3<ContractState> {
        fn drain(
            ref self: ContractState,
            token: ContractAddress,
            from: ContractAddress,
            to: ContractAddress,
            amount: u256,
        ) {
            let token_dispatcher = super::IMockTokenV3Dispatcher { contract_address: token };
            let ok = token_dispatcher.transfer_from(from, to, amount);
            assert!(ok, "drain transfer_from failed");
        }
    }
}

#[starknet::contract]
pub mod PocMaliciousRelayerTargetV3 {
    use starknet::storage::*;
    use starknet::{ContractAddress, get_contract_address};
    use private_executor_lite::shielded_pool_v3::{
        IShieldedPoolV3Dispatcher, IShieldedPoolV3DispatcherTrait,
    };
    use super::IMockTokenV3DispatcherTrait;

    #[storage]
    pub struct Storage {
        pub entered: bool,
    }

    #[abi(embed_v0)]
    impl TargetImpl of super::IMaliciousRelayerTargetV3<ContractState> {
        fn attack(
            ref self: ContractState,
            pool: ContractAddress,
            nullifier: felt252,
            approval_token: ContractAddress,
            approval_amount: u256,
            payout_token: ContractAddress,
            min_payout: u256,
            payout_amount: u256,
        ) {
            if !self.entered.read() {
                self.entered.write(true);
                let self_address = get_contract_address();
                let mut inner_calldata: Array<felt252> = array![];
                let pool_felt: felt252 = pool.into();
                let approval_token_felt: felt252 = approval_token.into();
                let payout_token_felt: felt252 = payout_token.into();
                inner_calldata.append(pool_felt);
                inner_calldata.append(nullifier);
                inner_calldata.append(approval_token_felt);
                inner_calldata.append(approval_amount.low.into());
                inner_calldata.append(approval_amount.high.into());
                inner_calldata.append(payout_token_felt);
                inner_calldata.append(min_payout.low.into());
                inner_calldata.append(min_payout.high.into());
                inner_calldata.append(payout_amount.low.into());
                inner_calldata.append(payout_amount.high.into());

                let pool_dispatcher = IShieldedPoolV3Dispatcher { contract_address: pool };
                pool_dispatcher.execute_private_swap_with_payout(
                    nullifier,
                    self_address,
                    selector!("attack"),
                    inner_calldata.span(),
                    approval_token,
                    approval_amount,
                    payout_token,
                    min_payout,
                );
            }

            let payout_dispatcher = super::IMockTokenV3Dispatcher { contract_address: payout_token };
            let ok = payout_dispatcher.transfer(pool, payout_amount);
            assert!(ok, "attack transfer failed");
        }
    }
}

fn setup_pool_v3(
    relayer: ContractAddress,
) -> (
    IShieldedPoolV3Dispatcher,
    IMockTokenV3Dispatcher,
    IMockTokenV3Dispatcher,
    ContractAddress,
    ContractAddress,
    ContractAddress,
    felt252,
) {
    let admin: ContractAddress = 0x111.try_into().unwrap();
    let user: ContractAddress = 0x333.try_into().unwrap();
    let root: felt252 = 0x1001;

    let verifier_class = declare("PocPoolVerifierV3").unwrap().contract_class();
    let (verifier_addr, _) = verifier_class.deploy(@array![]).unwrap();

    let token_class = declare("PocTokenV3").unwrap().contract_class();
    let (token_in_addr, _) = token_class.deploy(@array![]).unwrap();
    let (token_out_addr, _) = token_class.deploy(@array![]).unwrap();
    let token_in = IMockTokenV3Dispatcher { contract_address: token_in_addr };
    let token_out = IMockTokenV3Dispatcher { contract_address: token_out_addr };
    let token_in_admin = IMockTokenAdminV3Dispatcher { contract_address: token_in_addr };

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

    (pool, token_in, token_out, verifier_addr, admin, user, root)
}

#[test]
fn test_v3_deposit_event_no_longer_emits_nullifier() {
    let relayer: ContractAddress = 0x222.try_into().unwrap();
    let (pool, token_in, _token_out, _verifier, _admin, user, _root) = setup_pool_v3(relayer);
    let note_commitment: felt252 = 0xabc1;
    let mut spy = spy_events();

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, note_commitment);
    stop_cheat_caller_address(pool.contract_address);

    spy.assert_emitted(@array![
        (
            pool.contract_address,
            ShieldedPoolV3::Event::DepositRegisteredV3(
                ShieldedPoolV3::DepositRegisteredV3 {
                    sender: user,
                    token: token_in.contract_address,
                    denom_id: 10,
                    amount: 100_u256,
                    note_commitment,
                    timestamp: 0,
                }
            )
        )
    ]);
}

#[test]
#[should_panic(expected: "Verifier update timelocked")]
fn test_v3_verifier_update_is_delayed() {
    let relayer: ContractAddress = 0x222.try_into().unwrap();
    let (pool, _token_in, _token_out, _verifier, admin, _user, _root) = setup_pool_v3(relayer);
    let verifier_class = declare("PocPoolVerifierV3").unwrap().contract_class();
    let (next_verifier, _) = verifier_class.deploy(@array![]).unwrap();

    start_cheat_block_timestamp(pool.contract_address, 1_000);
    start_cheat_caller_address(pool.contract_address, admin);
    pool.set_verifier(next_verifier);
    assert(pool.get_pending_verifier() == next_verifier, 'VERIFIER_PENDING');
    pool.apply_verifier_update();
}

#[test]
#[should_panic(expected: "Verifier output too short")]
fn test_v3_rejects_short_proof_and_zero_hash_bypass() {
    let relayer: ContractAddress = 0x222.try_into().unwrap();
    let (pool, token_in, _token_out, _verifier, _admin, user, root) = setup_pool_v3(relayer);

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, 0xb001);
    pool.submit_private_swap(root, 0xb002, array![12345].span());
}

#[test]
#[should_panic(expected: "ERC20: insufficient allowance")]
fn test_v3_exact_approval_blocks_pool_drain() {
    let relayer: ContractAddress = 0x222.try_into().unwrap();
    let attacker: ContractAddress = 0xdead.try_into().unwrap();
    let (pool, token_in, _token_out, _verifier, _admin, user, root) = setup_pool_v3(relayer);

    let drain_target_class = declare("PocDrainTargetV3").unwrap().contract_class();
    let (drain_target_addr, _) = drain_target_class.deploy(@array![]).unwrap();
    let drain_target = IMockDrainTargetV3Dispatcher { contract_address: drain_target_addr };

    let pool_felt: felt252 = pool.contract_address.into();
    let token_felt: felt252 = token_in.contract_address.into();
    let attacker_felt: felt252 = attacker.into();
    let drain_amount: u256 = 100_u256;
    let approval_amount: u256 = 10_u256;
    let calldata = array![
        token_felt,
        pool_felt,
        attacker_felt,
        drain_amount.low.into(),
        drain_amount.high.into()
    ];
    let recipient_felt: felt252 = user.into();

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, 0xc001);
    stop_cheat_caller_address(pool.contract_address);

    let action_hash = pool.preview_swap_action_hash(
        drain_target.contract_address,
        selector!("drain"),
        calldata.span(),
        token_in.contract_address,
        approval_amount,
        0.try_into().unwrap(),
        0_u256,
    );

    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_swap(root, 0xc002, array![root, 0xc002, action_hash, recipient_felt].span());
    stop_cheat_caller_address(pool.contract_address);

    start_cheat_caller_address(pool.contract_address, relayer);
    pool.execute_private_swap_with_payout(
        0xc002,
        drain_target.contract_address,
        selector!("drain"),
        calldata.span(),
        token_in.contract_address,
        approval_amount,
        0.try_into().unwrap(),
        0_u256,
    );
}

#[test]
fn test_v3_action_hash_is_domain_separated_by_deployment() {
    let admin: ContractAddress = 0x111.try_into().unwrap();
    let relayer: ContractAddress = 0x222.try_into().unwrap();

    let verifier_class = declare("PocPoolVerifierV3").unwrap().contract_class();
    let (verifier_addr, _) = verifier_class.deploy(@array![]).unwrap();

    let pool_class = declare("ShieldedPoolV3").unwrap().contract_class();
    let mut constructor_args = array![];
    admin.serialize(ref constructor_args);
    verifier_addr.serialize(ref constructor_args);
    relayer.serialize(ref constructor_args);
    let (pool_a_addr, _) = pool_class.deploy(@constructor_args).unwrap();
    let (pool_b_addr, _) = pool_class.deploy(@constructor_args).unwrap();

    let pool_a = IShieldedPoolV3Dispatcher { contract_address: pool_a_addr };
    let pool_b = IShieldedPoolV3Dispatcher { contract_address: pool_b_addr };
    let target: ContractAddress = 0xabc.try_into().unwrap();
    let approval_token: ContractAddress = 0xdef.try_into().unwrap();
    let payout_token: ContractAddress = 0x123.try_into().unwrap();
    let calldata = array![11, 22, 33];

    let hash_a = pool_a.preview_swap_action_hash(
        target,
        selector!("mark"),
        calldata.span(),
        approval_token,
        7_u256,
        payout_token,
        9_u256,
    );
    let hash_b = pool_b.preview_swap_action_hash(
        target,
        selector!("mark"),
        calldata.span(),
        approval_token,
        7_u256,
        payout_token,
        9_u256,
    );
    assert(hash_a != hash_b, 'DOMAIN_BY_CONTRACT');
}

#[test]
fn test_v3_submitter_can_cancel_pending_action_and_retry() {
    let relayer: ContractAddress = 0x222.try_into().unwrap();
    let (pool, token_in, token_out, _verifier, _admin, user, root) = setup_pool_v3(relayer);
    let action_target_class = declare("PocActionTargetV3").unwrap().contract_class();
    let (action_target_addr, _) = action_target_class.deploy(@array![]).unwrap();
    let recipient_felt: felt252 = user.into();
    let approval_amount: u256 = 0_u256;
    let calldata_a = array![0x77];
    let calldata_b = array![0x88];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, 0xd001);
    stop_cheat_caller_address(pool.contract_address);

    let action_hash_a = pool.preview_swap_action_hash(
        action_target_addr,
        selector!("mark"),
        calldata_a.span(),
        0.try_into().unwrap(),
        approval_amount,
        token_out.contract_address,
        0_u256,
    );
    let action_hash_b = pool.preview_swap_action_hash(
        action_target_addr,
        selector!("mark"),
        calldata_b.span(),
        0.try_into().unwrap(),
        approval_amount,
        token_out.contract_address,
        0_u256,
    );

    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_swap(root, 0xd002, array![root, 0xd002, action_hash_a, recipient_felt].span());
    assert(pool.is_pending_swap(0xd002), 'PENDING_SET');
    pool.cancel_private_action(0xd002);
    assert(!pool.is_pending_swap(0xd002), 'PENDING_CLEARED');
    pool.submit_private_swap(root, 0xd002, array![root, 0xd002, action_hash_b, recipient_felt].span());
    stop_cheat_caller_address(pool.contract_address);

    assert(pool.get_pending_action_hash(0xd002) == action_hash_b, 'RETRY_OK');
}

#[test]
fn test_v3_cancel_does_not_permanently_block_same_action_hash() {
    let relayer: ContractAddress = 0x222.try_into().unwrap();
    let (pool, token_in, token_out, _verifier, _admin, user, root) = setup_pool_v3(relayer);
    let action_target_class = declare("PocActionTargetV3").unwrap().contract_class();
    let (action_target_addr, _) = action_target_class.deploy(@array![]).unwrap();
    let recipient_felt: felt252 = user.into();
    let approval_amount: u256 = 0_u256;
    let calldata = array![0x77];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, 0xd101);
    stop_cheat_caller_address(pool.contract_address);

    let action_hash = pool.preview_swap_action_hash(
        action_target_addr,
        selector!("mark"),
        calldata.span(),
        0.try_into().unwrap(),
        approval_amount,
        token_out.contract_address,
        0_u256,
    );
    let proof = array![root, 0xd102, action_hash, recipient_felt];

    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_swap(root, 0xd102, proof.span());
    pool.cancel_private_action(0xd102);
    pool.submit_private_swap(root, 0xd102, proof.span());
    stop_cheat_caller_address(pool.contract_address);

    assert(pool.get_pending_action_hash(0xd102) == action_hash, 'SAME_HASH_OK');
}

#[test]
#[should_panic(expected: "Only original submitter")]
fn test_v3_cancelled_proof_cannot_be_replayed_by_other_submitter() {
    let relayer: ContractAddress = 0x222.try_into().unwrap();
    let attacker: ContractAddress = 0x444.try_into().unwrap();
    let (pool, token_in, token_out, _verifier, _admin, user, root) = setup_pool_v3(relayer);
    let action_target_class = declare("PocActionTargetV3").unwrap().contract_class();
    let (action_target_addr, _) = action_target_class.deploy(@array![]).unwrap();
    let recipient_felt: felt252 = user.into();
    let approval_amount: u256 = 0_u256;
    let calldata = array![0x99];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, 0xd151);
    stop_cheat_caller_address(pool.contract_address);

    let action_hash = pool.preview_swap_action_hash(
        action_target_addr,
        selector!("mark"),
        calldata.span(),
        0.try_into().unwrap(),
        approval_amount,
        token_out.contract_address,
        0_u256,
    );
    let proof = array![root, 0xd152, action_hash, recipient_felt];

    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_swap(root, 0xd152, proof.span());
    pool.cancel_private_action(0xd152);
    stop_cheat_caller_address(pool.contract_address);

    start_cheat_caller_address(pool.contract_address, attacker);
    pool.submit_private_swap(root, 0xd152, proof.span());
}

#[test]
#[should_panic(expected: "Only submitter/admin")]
fn test_v3_relayer_cannot_cancel_user_pending_action() {
    let relayer: ContractAddress = 0x222.try_into().unwrap();
    let (pool, token_in, token_out, _verifier, _admin, user, root) = setup_pool_v3(relayer);
    let action_target_class = declare("PocActionTargetV3").unwrap().contract_class();
    let (action_target_addr, _) = action_target_class.deploy(@array![]).unwrap();
    let recipient_felt: felt252 = user.into();
    let approval_amount: u256 = 0_u256;
    let calldata = array![0x77];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, 0xd201);
    stop_cheat_caller_address(pool.contract_address);

    let action_hash = pool.preview_swap_action_hash(
        action_target_addr,
        selector!("mark"),
        calldata.span(),
        0.try_into().unwrap(),
        approval_amount,
        token_out.contract_address,
        0_u256,
    );

    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_swap(root, 0xd202, array![root, 0xd202, action_hash, recipient_felt].span());
    stop_cheat_caller_address(pool.contract_address);

    start_cheat_caller_address(pool.contract_address, relayer);
    pool.cancel_private_action(0xd202);
}

#[test]
#[should_panic(expected: "Reentrancy blocked")]
fn test_v3_blocks_submit_reentrancy() {
    let relayer: ContractAddress = 0x222.try_into().unwrap();
    let admin: ContractAddress = 0x111.try_into().unwrap();
    let user: ContractAddress = 0x333.try_into().unwrap();
    let root: felt252 = 0x1001;
    let recipient_felt: felt252 = user.into();

    let verifier_class = declare("PocMaliciousSubmitVerifierV3").unwrap().contract_class();
    let (verifier_addr, _) = verifier_class.deploy(@array![]).unwrap();

    let token_class = declare("PocTokenV3").unwrap().contract_class();
    let (token_in_addr, _) = token_class.deploy(@array![]).unwrap();
    let (token_out_addr, _) = token_class.deploy(@array![]).unwrap();
    let token_in = IMockTokenV3Dispatcher { contract_address: token_in_addr };
    let token_in_admin = IMockTokenAdminV3Dispatcher { contract_address: token_in_addr };

    let action_target_class = declare("PocActionTargetV3").unwrap().contract_class();
    let (action_target_addr, _) = action_target_class.deploy(@array![]).unwrap();

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

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, 0xd301);
    stop_cheat_caller_address(pool.contract_address);

    let approval_amount: u256 = 0_u256;
    let calldata = array![0x77];
    let outer_hash = pool.preview_swap_action_hash(
        action_target_addr,
        selector!("mark"),
        calldata.span(),
        0.try_into().unwrap(),
        approval_amount,
        token_out_addr,
        0_u256,
    );
    let inner_hash = pool.preview_swap_action_hash(
        action_target_addr,
        selector!("mark"),
        calldata.span(),
        0.try_into().unwrap(),
        approval_amount,
        token_out_addr,
        0_u256,
    );
    let pool_felt: felt252 = pool.contract_address.into();
    let proof = array![1, root, 0xd302, outer_hash, recipient_felt, pool_felt, root, 0xd303, inner_hash, recipient_felt];

    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_swap(root, 0xd302, proof.span());
}

#[test]
#[should_panic(expected: "Reentrancy blocked")]
fn test_v3_blocks_execute_reentrancy() {
    let malicious_relayer_class = declare("PocMaliciousRelayerTargetV3").unwrap().contract_class();
    let (malicious_relayer_addr, _) = malicious_relayer_class.deploy(@array![]).unwrap();
    let malicious_relayer = IMaliciousRelayerTargetV3Dispatcher {
        contract_address: malicious_relayer_addr,
    };
    let (pool, token_in, token_out, _verifier, _admin, user, root) = setup_pool_v3(
        malicious_relayer.contract_address
    );
    let token_out_admin = IMockTokenAdminV3Dispatcher { contract_address: token_out.contract_address };

    let recipient: ContractAddress = 0x777.try_into().unwrap();
    let recipient_felt: felt252 = recipient.into();
    let approval_amount: u256 = 0_u256;
    let payout_amount: u256 = 10_u256;
    let min_payout: u256 = 10_u256;
    let pool_felt: felt252 = pool.contract_address.into();
    let payout_token_felt: felt252 = token_out.contract_address.into();
    let calldata = array![
        pool_felt,
        0xe002,
        0,
        approval_amount.low.into(),
        approval_amount.high.into(),
        payout_token_felt,
        min_payout.low.into(),
        min_payout.high.into(),
        payout_amount.low.into(),
        payout_amount.high.into()
    ];

    token_out_admin.mint(malicious_relayer.contract_address, 100_u256);

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, 0xe001);
    stop_cheat_caller_address(pool.contract_address);

    let action_hash = pool.preview_swap_action_hash(
        malicious_relayer.contract_address,
        selector!("attack"),
        calldata.span(),
        0.try_into().unwrap(),
        approval_amount,
        token_out.contract_address,
        min_payout,
    );

    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_swap(root, 0xe002, array![root, 0xe002, action_hash, recipient_felt].span());
    stop_cheat_caller_address(pool.contract_address);

    start_cheat_caller_address(pool.contract_address, malicious_relayer.contract_address);
    pool.execute_private_swap_with_payout(
        0xe002,
        malicious_relayer.contract_address,
        selector!("attack"),
        calldata.span(),
        0.try_into().unwrap(),
        approval_amount,
        token_out.contract_address,
        min_payout,
    );
}

#[test]
#[should_panic(expected: "Direct note withdrawal disabled")]
fn test_v3_direct_withdraw_remains_disabled() {
    let relayer: ContractAddress = 0x222.try_into().unwrap();
    let (pool, token_in, _token_out, _verifier, _admin, user, _root) = setup_pool_v3(relayer);

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed_v3(token_in.contract_address, 10, 0xf001);
    pool.withdraw_note_v3(0xf001);
}
