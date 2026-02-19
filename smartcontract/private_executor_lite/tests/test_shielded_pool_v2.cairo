//! # ShieldedPoolV2 Unit Tests
//!
//! Focus:
//! - fixed-denom deposit notes
//! - private action submission (nullifier/commitment/action_hash binding)
//! - relayer execution (single + batch)

use private_executor_lite::shielded_pool_v2::{
    IShieldedPoolV2Dispatcher, IShieldedPoolV2DispatcherTrait,
};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;

#[starknet::interface]
pub trait IMockPoolVerifierAdmin<TContractState> {
    fn set_should_fail(ref self: TContractState, value: bool);
}

#[starknet::interface]
pub trait IMockTokenAdmin<TContractState> {
    fn mint(ref self: TContractState, to: ContractAddress, amount: u256);
}

#[starknet::interface]
pub trait IMockToken<TContractState> {
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
}

#[starknet::interface]
pub trait IMockSwapFiller<TContractState> {
    fn fill_payout(ref self: TContractState, payout_token: ContractAddress, amount: u256);
}

#[starknet::interface]
pub trait IMockActionTarget<TContractState> {
    fn mark(ref self: TContractState, value: felt252);
    fn get_mark(self: @TContractState) -> felt252;
}

#[starknet::contract]
pub mod MockPoolVerifier {
    use starknet::storage::*;

    #[storage]
    pub struct Storage {
        pub should_fail: bool,
    }

    #[abi(embed_v0)]
    impl VerifierImpl of private_executor_lite::shielded_pool_v2::IGroth16VerifierBlsOutput<
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
    impl AdminImpl of super::IMockPoolVerifierAdmin<ContractState> {
        fn set_should_fail(ref self: ContractState, value: bool) {
            self.should_fail.write(value);
        }
    }
}

#[starknet::contract]
pub mod MockToken {
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::*;
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    pub struct Storage {
        pub balances: Map<ContractAddress, u256>,
        pub allowances: Map<felt252, u256>,
    }

    #[abi(embed_v0)]
    impl TokenImpl of super::IMockToken<ContractState> {
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
    impl AdminImpl of super::IMockTokenAdmin<ContractState> {
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
pub mod MockSwapFiller {
    use starknet::storage::*;
    use starknet::{ContractAddress, get_caller_address};
    use super::IMockTokenDispatcherTrait;

    #[storage]
    pub struct Storage {}

    #[abi(embed_v0)]
    impl SwapImpl of super::IMockSwapFiller<ContractState> {
        fn fill_payout(ref self: ContractState, payout_token: ContractAddress, amount: u256) {
            let caller = get_caller_address();
            let token = super::IMockTokenDispatcher { contract_address: payout_token };
            let ok = token.transfer(caller, amount);
            assert!(ok, "fill transfer failed");
        }
    }
}

#[starknet::contract]
pub mod MockActionTarget {
    use starknet::storage::*;

    #[storage]
    pub struct Storage {
        pub mark: felt252,
    }

    #[abi(embed_v0)]
    impl ActionImpl of super::IMockActionTarget<ContractState> {
        fn mark(ref self: ContractState, value: felt252) {
            self.mark.write(value);
        }

        fn get_mark(self: @ContractState) -> felt252 {
            self.mark.read()
        }
    }
}

fn deploy_action_target() -> IMockActionTargetDispatcher {
    let action_class = declare("MockActionTarget").unwrap().contract_class();
    let (action_addr, _) = action_class.deploy(@array![]).unwrap();
    IMockActionTargetDispatcher { contract_address: action_addr }
}

fn setup_pool() -> (
    IShieldedPoolV2Dispatcher,
    IMockTokenDispatcher,
    IMockTokenDispatcher,
    IMockSwapFillerDispatcher,
    ContractAddress,
    ContractAddress,
    ContractAddress,
) {
    let admin: ContractAddress = 0x111.try_into().unwrap();
    let relayer: ContractAddress = 0x222.try_into().unwrap();
    let user: ContractAddress = 0x333.try_into().unwrap();

    let verifier_class = declare("MockPoolVerifier").unwrap().contract_class();
    let (verifier_addr, _) = verifier_class.deploy(@array![]).unwrap();

    let token_class = declare("MockToken").unwrap().contract_class();
    let (token_in_addr, _) = token_class.deploy(@array![]).unwrap();
    let (token_out_addr, _) = token_class.deploy(@array![]).unwrap();
    let token_in = IMockTokenDispatcher { contract_address: token_in_addr };
    let token_out = IMockTokenDispatcher { contract_address: token_out_addr };
    let token_in_admin = IMockTokenAdminDispatcher { contract_address: token_in_addr };
    let token_out_admin = IMockTokenAdminDispatcher { contract_address: token_out_addr };

    let swap_class = declare("MockSwapFiller").unwrap().contract_class();
    let (swap_addr, _) = swap_class.deploy(@array![]).unwrap();
    let swap = IMockSwapFillerDispatcher { contract_address: swap_addr };

    let pool_class = declare("ShieldedPoolV2").unwrap().contract_class();
    let mut constructor_args = array![];
    admin.serialize(ref constructor_args);
    verifier_addr.serialize(ref constructor_args);
    relayer.serialize(ref constructor_args);
    let (pool_addr, _) = pool_class.deploy(@constructor_args).unwrap();
    let pool = IShieldedPoolV2Dispatcher { contract_address: pool_addr };

    // Setup fixed-denom rule and balances.
    let fixed_amount: u256 = 100_u256;
    start_cheat_caller_address(pool.contract_address, admin);
    pool.set_asset_rule(token_in_addr, fixed_amount);
    stop_cheat_caller_address(pool.contract_address);

    token_in_admin.mint(user, 1000_u256);
    token_out_admin.mint(swap_addr, 5000_u256);

    (pool, token_in, token_out, swap, admin, relayer, user)
}

#[test]
fn test_shielded_pool_single_private_swap_with_payout() {
    let (pool, token_in, token_out, swap, _admin, relayer, user) = setup_pool();
    let recipient: ContractAddress = 0x444.try_into().unwrap();
    let commitment: felt252 = 0xabc1;
    let nullifier: felt252 = 0xabc2;
    let selector = selector!("fill_payout");
    let payout_amount: u256 = 77_u256;
    let min_payout: u256 = 70_u256;
    let target = swap.contract_address;

    // User approves and deposits fixed amount for note commitment.
    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);
    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed(token_in.contract_address, commitment);
    stop_cheat_caller_address(pool.contract_address);

    let payout_token_felt: felt252 = token_out.contract_address.into();
    let calldata = array![payout_token_felt, payout_amount.low.into(), payout_amount.high.into()];
    let action_hash = pool
        .preview_swap_payout_action_hash(
            target,
            selector,
            calldata.span(),
            token_in.contract_address,
            token_out.contract_address,
            recipient,
            min_payout,
        );
    let proof = array![nullifier, commitment, action_hash];
    let public_inputs = array![nullifier, commitment, action_hash];

    start_cheat_caller_address(pool.contract_address, user);
    pool.submit_private_action(nullifier, commitment, proof.span(), public_inputs.span());
    stop_cheat_caller_address(pool.contract_address);

    start_cheat_caller_address(pool.contract_address, relayer);
    pool
        .execute_private_swap_with_payout(
            commitment,
            target,
            selector,
            calldata.span(),
            token_in.contract_address,
            token_out.contract_address,
            recipient,
            min_payout,
        );
    stop_cheat_caller_address(pool.contract_address);

    assert(pool.is_commitment_executed(commitment), 'COMMIT_EXEC');
    assert(!pool.is_action_pending(commitment), 'PENDING_FALSE');
    assert(!pool.is_note_registered(commitment), 'NOTE_SPENT');
    assert(token_out.balance_of(recipient) == payout_amount, 'RECIPIENT_PAID');
}

#[test]
fn test_shielded_pool_batch_private_swap_with_payout() {
    let (pool, token_in, token_out, swap, _admin, relayer, user) = setup_pool();
    let selector = selector!("fill_payout");
    let target = swap.contract_address;
    let commitment_1: felt252 = 0x7771;
    let commitment_2: felt252 = 0x7772;
    let nullifier_1: felt252 = 0x7781;
    let nullifier_2: felt252 = 0x7782;
    let recipient_1: ContractAddress = 0x551.try_into().unwrap();
    let recipient_2: ContractAddress = 0x552.try_into().unwrap();
    let payout_1: u256 = 33_u256;
    let payout_2: u256 = 44_u256;
    let min_1: u256 = 30_u256;
    let min_2: u256 = 40_u256;

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 200_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed(token_in.contract_address, commitment_1);
    pool.deposit_fixed(token_in.contract_address, commitment_2);
    stop_cheat_caller_address(pool.contract_address);

    let payout_token_felt: felt252 = token_out.contract_address.into();
    let calldata_1 = array![payout_token_felt, payout_1.low.into(), payout_1.high.into()];
    let calldata_2 = array![payout_token_felt, payout_2.low.into(), payout_2.high.into()];

    let hash_1 = pool
        .preview_swap_payout_action_hash(
            target,
            selector,
            calldata_1.span(),
            token_in.contract_address,
            token_out.contract_address,
            recipient_1,
            min_1,
        );
    let hash_2 = pool
        .preview_swap_payout_action_hash(
            target,
            selector,
            calldata_2.span(),
            token_in.contract_address,
            token_out.contract_address,
            recipient_2,
            min_2,
        );

    start_cheat_caller_address(pool.contract_address, user);
    pool
        .submit_private_action(
            nullifier_1,
            commitment_1,
            array![nullifier_1, commitment_1, hash_1].span(),
            array![nullifier_1, commitment_1, hash_1].span(),
        );
    pool
        .submit_private_action(
            nullifier_2,
            commitment_2,
            array![nullifier_2, commitment_2, hash_2].span(),
            array![nullifier_2, commitment_2, hash_2].span(),
        );
    stop_cheat_caller_address(pool.contract_address);

    let commitments = array![commitment_1, commitment_2];
    let calldata_lengths = array![3, 3];
    let flat_calldata = array![
        payout_token_felt,
        payout_1.low.into(),
        payout_1.high.into(),
        payout_token_felt,
        payout_2.low.into(),
        payout_2.high.into(),
    ];
    let recipients = array![recipient_1, recipient_2];
    let min_payouts = array![min_1, min_2];

    start_cheat_caller_address(pool.contract_address, relayer);
    pool
        .execute_private_swap_with_payout_batch(
            0xbeef,
            commitments.span(),
            target,
            selector,
            calldata_lengths.span(),
            flat_calldata.span(),
            token_in.contract_address,
            token_out.contract_address,
            recipients.span(),
            min_payouts.span(),
        );
    stop_cheat_caller_address(pool.contract_address);

    assert(pool.is_commitment_executed(commitment_1), 'B1_EXEC');
    assert(pool.is_commitment_executed(commitment_2), 'B2_EXEC');
    assert(token_out.balance_of(recipient_1) == payout_1, 'R1_PAID');
    assert(token_out.balance_of(recipient_2) == payout_2, 'R2_PAID');
}

#[test]
fn test_shielded_pool_user_signs_and_executes_limit_order_onchain() {
    let (pool, token_in, _token_out, _swap, _admin, _relayer, user) = setup_pool();
    let action_target = deploy_action_target();
    let commitment: felt252 = 0xaa11;
    let nullifier: felt252 = 0xaa12;
    let selector = selector!("mark");
    let calldata = array![0x1234];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed(token_in.contract_address, commitment);

    let action_hash = pool
        .preview_limit_action_hash(
            action_target.contract_address,
            selector,
            calldata.span(),
            token_in.contract_address,
        );
    let proof = array![nullifier, commitment, action_hash];
    let public_inputs = array![nullifier, commitment, action_hash];
    pool.submit_private_action(nullifier, commitment, proof.span(), public_inputs.span());

    // User executes directly (on-chain signature path), not relayer.
    pool
        .execute_private_limit_order(
            commitment,
            action_target.contract_address,
            selector,
            calldata.span(),
            token_in.contract_address,
        );
    stop_cheat_caller_address(pool.contract_address);

    assert(pool.is_commitment_executed(commitment), 'LIMIT_EXEC');
    assert(action_target.get_mark() == 0x1234, 'LIMIT_MARK');
}

#[test]
fn test_shielded_pool_user_signs_and_executes_stake_onchain() {
    let (pool, token_in, _token_out, _swap, _admin, _relayer, user) = setup_pool();
    let action_target = deploy_action_target();
    let commitment: felt252 = 0xbb11;
    let nullifier: felt252 = 0xbb12;
    let selector = selector!("mark");
    let calldata = array![0x8888];

    start_cheat_caller_address(token_in.contract_address, user);
    token_in.approve(pool.contract_address, 100_u256);
    stop_cheat_caller_address(token_in.contract_address);

    start_cheat_caller_address(pool.contract_address, user);
    pool.deposit_fixed(token_in.contract_address, commitment);

    let action_hash = pool
        .preview_stake_action_hash(
            action_target.contract_address,
            selector,
            calldata.span(),
            token_in.contract_address,
        );
    let proof = array![nullifier, commitment, action_hash];
    let public_inputs = array![nullifier, commitment, action_hash];
    pool.submit_private_action(nullifier, commitment, proof.span(), public_inputs.span());

    // User executes directly (on-chain signature path), not relayer.
    pool
        .execute_private_stake(
            commitment,
            action_target.contract_address,
            selector,
            calldata.span(),
            token_in.contract_address,
        );
    stop_cheat_caller_address(pool.contract_address);

    assert(pool.is_commitment_executed(commitment), 'STAKE_EXEC');
    assert(action_target.get_mark() == 0x8888, 'STAKE_MARK');
}
