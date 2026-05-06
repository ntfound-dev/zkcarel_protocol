use starknet::ContractAddress;

/// @notice ShieldedPool V4 submit entrypoints used by the privacy router.
#[starknet::interface]
pub trait IShieldedPoolV4<TContractState> {
    fn submit_private_swap(
        ref self: TContractState,
        root: felt252,
        nullifier: felt252,
        proof: Array<felt252>,
        public_inputs: Array<felt252>
    );
    fn submit_private_limit(
        ref self: TContractState,
        root: felt252,
        nullifier: felt252,
        proof: Array<felt252>,
        public_inputs: Array<felt252>
    );
    fn submit_private_stake(
        ref self: TContractState,
        root: felt252,
        nullifier: felt252,
        proof: Array<felt252>,
        public_inputs: Array<felt252>
    );
}

/// @title IPrivacyRouterV4
/// @notice Admin API for the V4 privacy router.
#[starknet::interface]
pub trait IPrivacyRouterV4<TContractState> {
    /// @notice Updates the target shielded pool.
    /// @dev Callable only by the contract owner. Emits `ShieldedPoolUpdated`.
    /// @param pool New shielded pool address (must be non-zero).
    fn set_shielded_pool(ref self: TContractState, pool: ContractAddress);
}

/// @title PrivacyRouterV4
/// @notice Routes IPrivacyRouter `submit_action` calls to ShieldedPoolV4 submit entrypoints.
#[starknet::contract]
pub mod PrivacyRouterV4 {
    use super::{IPrivacyRouterV4, IShieldedPoolV4Dispatcher, IShieldedPoolV4DispatcherTrait};
    use crate::privacy_action_types::{
        ACTION_PRIVATE_SWAP, ACTION_SWAP, ACTION_SWAP_AGG, ACTION_STAKING
    };
    use starknet::ContractAddress;
    use starknet::storage::*;
    use openzeppelin::access::ownable::OwnableComponent;
    use core::num::traits::Zero;
    use core::traits::TryInto;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub shielded_pool: ContractAddress,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        ShieldedPoolUpdated: ShieldedPoolUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ShieldedPoolUpdated {
        pub pool: ContractAddress,
    }

    /// @notice Initializes the router with an owner and initial shielded pool.
    /// @param admin Initial contract owner (two-step transfer via OZ OwnableComponent).
    /// @param pool Initial shielded pool address.
    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, pool: ContractAddress) {
        self.ownable.initializer(admin);
        self.shielded_pool.write(pool);
    }

    fn span_to_array(span: Span<felt252>) -> Array<felt252> {
        let mut out = array![];
        let total: u64 = span.len().into();
        let mut i: u64 = 0;
        while i < total {
            let idx: u32 = i.try_into().unwrap();
            out.append(*span.at(idx));
            i += 1;
        };
        out
    }

    fn read_first(span: Span<felt252>) -> felt252 {
        assert!(span.len() > 0, "Nullifier required");
        let nf = *span.at(0);
        nf
    }

    #[abi(embed_v0)]
    impl PrivacyRouterImpl of crate::privacy_router::IPrivacyRouter<ContractState> {
        fn submit_action(
            ref self: ContractState,
            action_type: felt252,
            old_root: felt252,
            new_root: felt252,
            nullifiers: Span<felt252>,
            commitments: Span<felt252>,
            public_inputs: Span<felt252>,
            proof: Span<felt252>
        ) {
            let _ = new_root;
            let _ = commitments;
            let pool = self.shielded_pool.read();
            assert!(!pool.is_zero(), "Shielded pool not set");
            let dispatcher = IShieldedPoolV4Dispatcher { contract_address: pool };

            let root = old_root;
            let nullifier = read_first(nullifiers);
            let proof_arr = span_to_array(proof);
            let public_arr = span_to_array(public_inputs);

            if action_type == ACTION_SWAP || action_type == ACTION_SWAP_AGG || action_type == ACTION_PRIVATE_SWAP {
                dispatcher.submit_private_swap(root, nullifier, proof_arr, public_arr);
                return;
            }
            if action_type == ACTION_STAKING {
                dispatcher.submit_private_stake(root, nullifier, proof_arr, public_arr);
                return;
            }
            if action_type == 'LIMIT' {
                dispatcher.submit_private_limit(root, nullifier, proof_arr, public_arr);
                return;
            }
            assert!(false, "Unsupported privacy action");
        }
    }

    #[abi(embed_v0)]
    impl PrivacyRouterAdminImpl of IPrivacyRouterV4<ContractState> {
        fn set_shielded_pool(ref self: ContractState, pool: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!pool.is_zero(), "Pool required");
            self.shielded_pool.write(pool);
            self.emit(Event::ShieldedPoolUpdated(ShieldedPoolUpdated { pool }));
        }
    }
}
