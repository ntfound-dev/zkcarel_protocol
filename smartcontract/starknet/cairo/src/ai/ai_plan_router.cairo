use starknet::ContractAddress;
use crate::ai::ai_executor::ActionType;

// AI plan approval + execution router.
// Uses ERC-8004 identity + single user signature to approve a plan.
#[derive(Copy, Drop, Serde, starknet::Store, PartialEq)]
pub enum PlanStatus {
    #[default]
    Active,
    Cancelled,
    Expired,
}

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Plan {
    pub user: ContractAddress,
    pub agent_id: felt252,
    pub operator: ContractAddress,
    pub plan_hash: felt252,
    pub action_mask: u64,
    pub max_actions: u64,
    pub used_actions: u64,
    pub expires_at: u64,
    pub created_at: u64,
    pub status: PlanStatus,
}

#[starknet::interface]
pub trait IAIPlanRouter<TContractState> {
    // Approves a plan with a single user signature and returns plan_id.
    fn approve_plan(
        ref self: TContractState,
        user: ContractAddress,
        agent_id: felt252,
        plan_hash: felt252,
        action_mask: u64,
        max_actions: u64,
        expires_at: u64,
        nonce: felt252,
        user_signature: Span<felt252>
    ) -> felt252;
    // Cancels an active plan.
    fn cancel_plan(ref self: TContractState, plan_id: felt252);
    // Submits an AI action bound to an approved plan.
    fn submit_action_with_plan(
        ref self: TContractState,
        plan_id: felt252,
        action_type: ActionType,
        params: ByteArray
    ) -> u64;
    // Returns plan details for a plan id.
    fn get_plan(self: @TContractState, plan_id: felt252) -> Plan;
}

#[starknet::interface]
pub trait IAIPlanRouterAdmin<TContractState> {
    fn set_executor(ref self: TContractState, executor: ContractAddress);
    fn set_signature_verifier(ref self: TContractState, verifier: ContractAddress);
    fn set_identity_registry(ref self: TContractState, registry: ContractAddress);
    fn set_chain_id(ref self: TContractState, chain_id: felt252);
}

#[starknet::contract]
pub mod AIPlanRouter {
    use super::{IAIPlanRouter, IAIPlanRouterAdmin, Plan, PlanStatus};
    use crate::ai::ai_executor::{
        ActionType, IAIExecutorDispatcher, IAIExecutorDispatcherTrait
    };
    use crate::ai::ai_signature_verifier::{
        IAISignatureVerifierDispatcher, IAISignatureVerifierDispatcherTrait
    };
use crate::ai::erc8004_identity_registry::{
        IERC8004IdentityRegistryDispatcher, IERC8004IdentityRegistryDispatcherTrait
    };
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_block_timestamp, get_caller_address, get_contract_address};
    use openzeppelin::access::ownable::OwnableComponent;
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use core::traits::TryInto;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub executor: ContractAddress,
        pub signature_verifier: ContractAddress,
        pub identity_registry: ContractAddress,
        pub plans: Map<felt252, Plan>,
        pub chain_id: felt252,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PlanApproved: PlanApproved,
        PlanCancelled: PlanCancelled,
        PlanConsumed: PlanConsumed,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PlanApproved {
        pub plan_id: felt252,
        pub user: ContractAddress,
        pub operator: ContractAddress,
        pub agent_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PlanCancelled {
        pub plan_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PlanConsumed {
        pub plan_id: felt252,
        pub action_id: u64,
        pub action_type: felt252,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        executor: ContractAddress,
        identity_registry: ContractAddress,
        signature_verifier: ContractAddress,
        chain_id: felt252
    ) {
        self.ownable.initializer(admin);
        self.executor.write(executor);
        self.identity_registry.write(identity_registry);
        self.signature_verifier.write(signature_verifier);
        self.chain_id.write(chain_id);
    }

    fn action_mask_for_type(action_type: ActionType) -> u64 {
        match action_type {
            ActionType::Swap => 1,
            ActionType::Bridge => 2,
            ActionType::Stake => 4,
            ActionType::ClaimReward => 8,
            ActionType::MintNFT => 16,
            ActionType::MultiStep => 32,
            ActionType::Basic => 64,
        }
    }

    fn compute_plan_message_hash(
        self: @ContractState,
        user: ContractAddress,
        agent_id: felt252,
        operator: ContractAddress,
        plan_hash: felt252,
        action_mask: u64,
        max_actions: u64,
        expires_at: u64,
        nonce: felt252
    ) -> felt252 {
        let mut fields: Array<felt252> = array![];
        fields.append(self.chain_id.read());
        let contract_felt: felt252 = get_contract_address().into();
        fields.append(contract_felt);
        let user_felt: felt252 = user.into();
        fields.append(user_felt);
        fields.append(agent_id);
        let op_felt: felt252 = operator.into();
        fields.append(op_felt);
        fields.append(plan_hash);
        let action_mask_felt: felt252 = action_mask.try_into().unwrap();
        fields.append(action_mask_felt);
        let max_actions_felt: felt252 = max_actions.try_into().unwrap();
        fields.append(max_actions_felt);
        let expires_felt: felt252 = expires_at.try_into().unwrap();
        fields.append(expires_felt);
        fields.append(nonce);
        poseidon_hash_span(fields.span())
    }

    fn assert_operator(self: @ContractState, agent_id: felt252) -> ContractAddress {
        let registry = IERC8004IdentityRegistryDispatcher { contract_address: self.identity_registry.read() };
        let (meta, _, _, _) = registry.get_agent(agent_id);
        assert!(meta.active, "Agent inactive");
        let operator = meta.operator;
        assert!(!operator.is_zero(), "Operator not set");
        assert!(get_caller_address() == operator, "Not operator");
        operator
    }

    #[abi(embed_v0)]
    impl AIPlanRouterImpl of IAIPlanRouter<ContractState> {
        fn approve_plan(
            ref self: ContractState,
            user: ContractAddress,
            agent_id: felt252,
            plan_hash: felt252,
            action_mask: u64,
            max_actions: u64,
            expires_at: u64,
            nonce: felt252,
            user_signature: Span<felt252>
        ) -> felt252 {
            assert!(!user.is_zero(), "User required");
            assert!(plan_hash != 0, "Plan hash required");
            assert!(action_mask != 0, "Action mask required");
            assert!(max_actions > 0, "Max actions required");
            let now = get_block_timestamp();
            assert!(expires_at > now, "Plan expired");

            let operator = assert_operator(@self, agent_id);
            let verifier = self.signature_verifier.read();
            assert!(!verifier.is_zero(), "Signature verifier required");

            let msg_hash = compute_plan_message_hash(
                @self,
                user,
                agent_id,
                operator,
                plan_hash,
                action_mask,
                max_actions,
                expires_at,
                nonce
            );
            let dispatcher = IAISignatureVerifierDispatcher { contract_address: verifier };
            let ok = dispatcher.verify_and_consume(user, msg_hash, user_signature);
            assert!(ok, "Invalid user signature");

            let existing = self.plans.entry(msg_hash).read();
            if existing.user != 0.try_into().unwrap() {
                assert!(existing.status != PlanStatus::Active, "Plan already active");
            }

            let plan = Plan {
                user,
                agent_id,
                operator,
                plan_hash,
                action_mask,
                max_actions,
                used_actions: 0,
                expires_at,
                created_at: now,
                status: PlanStatus::Active,
            };
            self.plans.entry(msg_hash).write(plan);
            self.emit(Event::PlanApproved(PlanApproved { plan_id: msg_hash, user, operator, agent_id }));
            msg_hash
        }

        fn cancel_plan(ref self: ContractState, plan_id: felt252) {
            let mut plan = self.plans.entry(plan_id).read();
            assert!(plan.user != 0.try_into().unwrap(), "Plan not found");
            let caller = get_caller_address();
            assert!(caller == plan.user || caller == plan.operator, "Not authorized");
            plan.status = PlanStatus::Cancelled;
            self.plans.entry(plan_id).write(plan);
            self.emit(Event::PlanCancelled(PlanCancelled { plan_id }));
        }

        fn submit_action_with_plan(
            ref self: ContractState,
            plan_id: felt252,
            action_type: ActionType,
            params: ByteArray
        ) -> u64 {
            let mut plan = self.plans.entry(plan_id).read();
            assert!(plan.user != 0.try_into().unwrap(), "Plan not found");
            assert!(plan.status == PlanStatus::Active, "Plan inactive");
            let now = get_block_timestamp();
            assert!(now < plan.expires_at, "Plan expired");
            let mask = action_mask_for_type(action_type);
            assert!((plan.action_mask & mask) != 0, "Action not allowed");
            assert!(plan.used_actions < plan.max_actions, "Plan exhausted");
            plan.used_actions += 1;
            self.plans.entry(plan_id).write(plan);

            let executor = self.executor.read();
            assert!(!executor.is_zero(), "Executor required");
            let dispatcher = IAIExecutorDispatcher { contract_address: executor };
            let action_id = dispatcher.submit_action_from_plan(
                plan.user,
                action_type,
                params,
                plan_id
            );
            self.emit(Event::PlanConsumed(PlanConsumed {
                plan_id,
                action_id,
                action_type: action_type_to_felt(action_type),
            }));
            action_id
        }

        fn get_plan(self: @ContractState, plan_id: felt252) -> Plan {
            self.plans.entry(plan_id).read()
        }
    }

    #[abi(embed_v0)]
    impl AIPlanRouterAdminImpl of IAIPlanRouterAdmin<ContractState> {
        fn set_executor(ref self: ContractState, executor: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!executor.is_zero(), "Executor required");
            self.executor.write(executor);
        }

        fn set_signature_verifier(ref self: ContractState, verifier: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!verifier.is_zero(), "Verifier required");
            self.signature_verifier.write(verifier);
        }

        fn set_identity_registry(ref self: ContractState, registry: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!registry.is_zero(), "Registry required");
            self.identity_registry.write(registry);
        }

        fn set_chain_id(ref self: ContractState, chain_id: felt252) {
            self.ownable.assert_only_owner();
            self.chain_id.write(chain_id);
        }
    }

    fn action_type_to_felt(action_type: ActionType) -> felt252 {
        match action_type {
            ActionType::Swap => 0,
            ActionType::Bridge => 1,
            ActionType::Stake => 2,
            ActionType::ClaimReward => 3,
            ActionType::MintNFT => 4,
            ActionType::MultiStep => 5,
            ActionType::Basic => 6,
        }
    }
}
