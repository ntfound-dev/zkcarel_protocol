use starknet::ContractAddress;
use crate::ai::ai_executor::ActionType;

/// @notice Plan approval status lifecycle.
/// @dev Active → Cancelled (by user or operator) or Active → Expired (on first expired execution).
#[derive(Copy, Drop, Serde, starknet::Store, PartialEq)]
pub enum PlanStatus {
    #[default]
    Active,
    Cancelled,
    Expired,
}

/// @notice Stores all metadata for an approved AI execution plan.
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

/// @title IAIPlanRouter
/// @notice Single-signature plan approval and bounded execution router for AI agents.
/// @dev A plan is approved once with a user signature, then executed N times by the operator
///      within the permitted action types and expiry window.
#[starknet::interface]
pub trait IAIPlanRouter<TContractState> {
    /// @notice Approves an execution plan with a single user signature and returns the plan ID.
    /// @dev The plan ID is the Poseidon hash of the message fields; it doubles as a replay-proof
    ///      nonce since `verify_and_consume` marks it as spent in the signature verifier.
    ///      Panics if the plan already exists and is Active.
    /// @param user Address of the user delegating execution.
    /// @param agent_id ERC-8004 identity ID of the target agent.
    /// @param plan_hash Application-level hash of the plan description (caller-defined).
    /// @param action_mask Bitmask of allowed `ActionType` values (see `action_mask_for_type`).
    /// @param max_actions Maximum number of actions the operator may execute under this plan.
    /// @param expires_at Unix timestamp after which the plan cannot be used.
    /// @param nonce User's current sequential nonce from the signature verifier contract.
    /// @param user_signature SRC-6 account signature over the computed plan message hash.
    /// @return plan_id Poseidon hash identifying this plan; used in subsequent calls.
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

    /// @notice Cancels an active plan.
    /// @dev Callable by either the plan's `user` or `operator`.
    /// @param plan_id The plan identifier to cancel.
    fn cancel_plan(ref self: TContractState, plan_id: felt252);

    /// @notice Submits an AI action bound to an approved plan without a per-action user signature.
    /// @dev Caller must be `plan.operator` (H-1 fix). Plan must be Active and non-expired.
    ///      If the plan has expired, its status is written to `Expired` before panicking (M-4 fix).
    ///      Delegates to `AIExecutor::submit_action_from_plan` which enforces rate limits and fees.
    /// @param plan_id The plan to execute against.
    /// @param action_type Must be permitted by `plan.action_mask`.
    /// @param params ABI-encoded action parameters forwarded to the executor.
    /// @return action_id The executor-assigned action identifier.
    fn submit_action_with_plan(
        ref self: TContractState,
        plan_id: felt252,
        action_type: ActionType,
        params: ByteArray
    ) -> u64;

    /// @notice Returns the full plan struct for a given plan ID.
    /// @param plan_id The plan identifier to query.
    /// @return The `Plan` struct (zero-value user address means not found).
    fn get_plan(self: @TContractState, plan_id: felt252) -> Plan;
}

/// @title IAIPlanRouterAdmin
/// @notice Owner-only configuration for the plan router's downstream contract addresses.
#[starknet::interface]
pub trait IAIPlanRouterAdmin<TContractState> {
    /// @notice Sets the executor contract that `submit_action_with_plan` delegates to.
    /// @param executor Address of the `AIExecutor` contract (must be non-zero).
    fn set_executor(ref self: TContractState, executor: ContractAddress);

    /// @notice Sets the signature verifier used in `approve_plan`.
    /// @param verifier Address of the `AISignatureVerifier` contract (must be non-zero).
    fn set_signature_verifier(ref self: TContractState, verifier: ContractAddress);

    /// @notice Sets the ERC-8004 identity registry used to look up agent operators.
    /// @param registry Address of the `ERC8004IdentityRegistry` contract (must be non-zero).
    fn set_identity_registry(ref self: TContractState, registry: ContractAddress);

    /// @notice Updates the chain ID embedded in plan message hashes.
    /// @param chain_id New chain ID (e.g. SN_MAIN = 0x534e5f4d41494e).
    fn set_chain_id(ref self: TContractState, chain_id: felt252);
}

/// @title AIPlanRouter
/// @notice Implements plan-based AI execution with a single up-front user signature.
/// @dev Uses OZ OwnableComponent for ownership management.
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
    impl OwnableImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
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

    /// @notice Initializes the plan router with all required downstream contract addresses.
    /// @param admin Initial owner address (receives OwnableTwoStep ownership).
    /// @param executor Address of the `AIExecutor` contract.
    /// @param identity_registry Address of the `ERC8004IdentityRegistry` contract.
    /// @param signature_verifier Address of the `AISignatureVerifier` contract.
    /// @param chain_id Starknet chain ID embedded in plan message hashes.
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

    /// @notice Returns the bitmask value for a given `ActionType`.
    /// @dev Swap=1, Bridge=2, Stake=4, ClaimReward=8, MintNFT=16, MultiStep=32, Basic=64.
    /// @param action_type The action type to convert.
    /// @return Single-bit u64 mask for the action type.
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

    /// @notice Computes the Poseidon plan message hash signed by the user in `approve_plan`.
    /// @dev Hash inputs: (chain_id, contract, user, agent_id, operator, plan_hash,
    ///                    action_mask, max_actions, expires_at, nonce).
    /// @param user User address delegating the plan.
    /// @param agent_id ERC-8004 agent identity.
    /// @param operator Agent operator address resolved from the identity registry.
    /// @param plan_hash Application-level plan descriptor hash.
    /// @param action_mask Bitmask of permitted action types.
    /// @param max_actions Cap on the number of executable actions.
    /// @param expires_at Plan expiry unix timestamp.
    /// @param nonce User's current sequential nonce.
    /// @return Poseidon hash over the ten-element field array.
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

    /// @notice Resolves the operator for `agent_id` from the identity registry and verifies the caller.
    /// @dev Panics if the agent is inactive, has no operator, or the caller is not the operator.
    /// @param agent_id ERC-8004 agent identity to look up.
    /// @return operator The verified operator address.
    fn assert_operator(self: @ContractState, agent_id: felt252) -> ContractAddress {
        let registry = IERC8004IdentityRegistryDispatcher { contract_address: self.identity_registry.read() };
        let (meta, _, _, _) = registry.get_agent(agent_id);
        assert!(meta.active, "Agent inactive");
        let operator = meta.operator;
        assert!(!operator.is_zero(), "Operator not set");
        assert!(get_caller_address() == operator, "Not operator");
        operator
    }

    /// @notice Converts an `ActionType` to its felt252 numeric representation for events.
    /// @param action_type The action type to convert.
    /// @return felt252 integer: Swap=0, Bridge=1, Stake=2, ClaimReward=3, MintNFT=4, MultiStep=5, Basic=6.
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

    #[abi(embed_v0)]
    impl AIPlanRouterImpl of IAIPlanRouter<ContractState> {
        /// @inheritdoc IAIPlanRouter
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

        /// @inheritdoc IAIPlanRouter
        fn cancel_plan(ref self: ContractState, plan_id: felt252) {
            let mut plan = self.plans.entry(plan_id).read();
            assert!(plan.user != 0.try_into().unwrap(), "Plan not found");
            let caller = get_caller_address();
            assert!(caller == plan.user || caller == plan.operator, "Not authorized");
            plan.status = PlanStatus::Cancelled;
            self.plans.entry(plan_id).write(plan);
            self.emit(Event::PlanCancelled(PlanCancelled { plan_id }));
        }

        /// @inheritdoc IAIPlanRouter
        fn submit_action_with_plan(
            ref self: ContractState,
            plan_id: felt252,
            action_type: ActionType,
            params: ByteArray
        ) -> u64 {
            let mut plan = self.plans.entry(plan_id).read();
            assert!(plan.user != 0.try_into().unwrap(), "Plan not found");
            assert!(plan.status == PlanStatus::Active, "Plan inactive");
            assert!(get_caller_address() == plan.operator, "Not plan operator");
            let now = get_block_timestamp();
            if now >= plan.expires_at {
                plan.status = PlanStatus::Expired;
                self.plans.entry(plan_id).write(plan);
                assert!(false, "Plan expired");
            }
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

        /// @inheritdoc IAIPlanRouter
        fn get_plan(self: @ContractState, plan_id: felt252) -> Plan {
            self.plans.entry(plan_id).read()
        }
    }

    #[abi(embed_v0)]
    impl AIPlanRouterAdminImpl of IAIPlanRouterAdmin<ContractState> {
        /// @inheritdoc IAIPlanRouterAdmin
        fn set_executor(ref self: ContractState, executor: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!executor.is_zero(), "Executor required");
            self.executor.write(executor);
        }

        /// @inheritdoc IAIPlanRouterAdmin
        fn set_signature_verifier(ref self: ContractState, verifier: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!verifier.is_zero(), "Verifier required");
            self.signature_verifier.write(verifier);
        }

        /// @inheritdoc IAIPlanRouterAdmin
        fn set_identity_registry(ref self: ContractState, registry: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!registry.is_zero(), "Registry required");
            self.identity_registry.write(registry);
        }

        /// @inheritdoc IAIPlanRouterAdmin
        fn set_chain_id(ref self: ContractState, chain_id: felt252) {
            self.ownable.assert_only_owner();
            self.chain_id.write(chain_id);
        }
    }
}
