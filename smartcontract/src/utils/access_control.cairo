use starknet::ContractAddress;

pub const MINTER_ROLE: felt252 = selector!("MINTER_ROLE");
pub const BURNER_ROLE: felt252 = selector!("BURNER_ROLE");
pub const PAUSER_ROLE: felt252 = selector!("PAUSER_ROLE");
pub const ORACLE_UPDATER_ROLE: felt252 = selector!("ORACLE_UPDATER_ROLE");
pub const BACKEND_SIGNER_ROLE: felt252 = selector!("BACKEND_SIGNER_ROLE");

// Role-management API used across protocol contracts.
// Mirrors OpenZeppelin AccessControl semantics for tooling compatibility.
#[starknet::interface]
pub trait IAccessControl<TContractState> {
    // Grants a role to an account according to role admin rules.
    fn grant_role(ref self: TContractState, role: felt252, account: ContractAddress);
    // Revokes a role from an account according to role admin rules.
    fn revoke_role(ref self: TContractState, role: felt252, account: ContractAddress);
    // Returns whether an account currently has a given role.
    fn has_role(self: @TContractState, role: felt252, account: ContractAddress) -> bool;
    // Allows caller to renounce one of its own roles.
    fn renounce_role(ref self: TContractState, role: felt252, account: ContractAddress);
    // Sets the admin role that controls a target role.
    fn set_role_admin(ref self: TContractState, role: felt252, admin_role: felt252);
    // Returns admin role that controls a target role.
    fn get_role_admin(self: @TContractState, role: felt252) -> felt252;
}

// Hide Mode hooks for role administration actions.
#[starknet::interface]
pub trait IAccessControlPrivacy<TContractState> {
    // Sets privacy router used for Hide Mode actions.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Forwards private access-control payload to privacy router.
    fn submit_private_access_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

// Deployable role registry for protocol administration.
// Wraps OpenZeppelin AccessControl and SRC5 detection.
#[starknet::contract]
pub mod AccessControlContract {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use core::num::traits::Zero;
    use openzeppelin::access::accesscontrol::AccessControlComponent;
    use openzeppelin::access::accesscontrol::DEFAULT_ADMIN_ROLE;
    use openzeppelin::introspection::src5::SRC5Component;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_ACCESS;

    component!(path: AccessControlComponent, storage: accesscontrol, event: AccessControlEvent);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    impl AccessControlImpl = AccessControlComponent::AccessControlImpl<ContractState>;
    impl AccessControlInternalImpl = AccessControlComponent::InternalImpl<ContractState>;
    
    #[abi(embed_v0)]
    impl SRC5Impl = SRC5Component::SRC5Impl<ContractState>;

    #[storage]
    pub struct Storage {
        #[substorage(v0)]
        pub accesscontrol: AccessControlComponent::Storage,
        #[substorage(v0)]
        pub src5: SRC5Component::Storage,
        pub privacy_router: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        AccessControlEvent: AccessControlComponent::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    // Initializes access-control storage and grants DEFAULT_ADMIN_ROLE to `admin`.
    // The `admin` account becomes the initial role-management authority.
    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.accesscontrol.initializer();
        self.accesscontrol._grant_role(DEFAULT_ADMIN_ROLE, admin);
    }

    #[abi(embed_v0)]
    impl IAccessControlImpl of super::IAccessControl<ContractState> {
        // Grants a role to an account according to role admin rules.
        fn grant_role(ref self: ContractState, role: felt252, account: ContractAddress) {
            self.accesscontrol.grant_role(role, account);
        }

        // Revokes a role from an account according to role admin rules.
        fn revoke_role(ref self: ContractState, role: felt252, account: ContractAddress) {
            self.accesscontrol.revoke_role(role, account);
        }

        // Returns whether an account currently has a given role.
        fn has_role(self: @ContractState, role: felt252, account: ContractAddress) -> bool {
            self.accesscontrol.has_role(role, account)
        }

        // Allows caller to renounce one of its own roles.
        fn renounce_role(ref self: ContractState, role: felt252, account: ContractAddress) {
            self.accesscontrol.renounce_role(role, account);
        }

        // Sets the admin role that controls a target role.
        fn set_role_admin(ref self: ContractState, role: felt252, admin_role: felt252) {
            self.accesscontrol.assert_only_role(DEFAULT_ADMIN_ROLE);
            self.accesscontrol.set_role_admin(role, admin_role);
        }

        // Returns admin role that controls a target role.
        fn get_role_admin(self: @ContractState, role: felt252) -> felt252 {
            self.accesscontrol.get_role_admin(role)
        }
    }

    #[abi(embed_v0)]
    impl AccessControlPrivacyImpl of super::IAccessControlPrivacy<ContractState> {
        // Sets privacy router used for Hide Mode role-admin actions.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.accesscontrol.assert_only_role(DEFAULT_ADMIN_ROLE);
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Relays private access-control payload for proof verification and execution.
        // `nullifiers` prevent replay and `commitments` bind intended state transition.
        fn submit_private_access_action(
            ref self: ContractState,
            old_root: felt252,
            new_root: felt252,
            nullifiers: Span<felt252>,
            commitments: Span<felt252>,
            public_inputs: Span<felt252>,
            proof: Span<felt252>
        ) {
            let router = self.privacy_router.read();
            assert!(!router.is_zero(), "Privacy router not set");
            let dispatcher = IPrivacyRouterDispatcher { contract_address: router };
            dispatcher.submit_action(
                ACTION_ACCESS,
                old_root,
                new_root,
                nullifiers,
                commitments,
                public_inputs,
                proof
            );
        }
    }
}
