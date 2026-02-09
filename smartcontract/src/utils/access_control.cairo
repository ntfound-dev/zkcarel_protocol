use starknet::ContractAddress;

pub const MINTER_ROLE: felt252 = selector!("MINTER_ROLE");
pub const BURNER_ROLE: felt252 = selector!("BURNER_ROLE");
pub const PAUSER_ROLE: felt252 = selector!("PAUSER_ROLE");
pub const ORACLE_UPDATER_ROLE: felt252 = selector!("ORACLE_UPDATER_ROLE");
pub const BACKEND_SIGNER_ROLE: felt252 = selector!("BACKEND_SIGNER_ROLE");

/// @title Access Control Interface
/// @author CAREL Team
/// @notice Defines role management entrypoints used across CAREL contracts.
/// @dev Mirrors OpenZeppelin AccessControl to keep tooling compatible.
#[starknet::interface]
pub trait IAccessControl<TContractState> {
    /// @notice Grants a role to an account.
    /// @dev Intended for role admins to manage permissions safely.
    /// @param role Role identifier.
    /// @param account Account to receive the role.
    fn grant_role(ref self: TContractState, role: felt252, account: ContractAddress);
    /// @notice Revokes a role from an account.
    /// @dev Used to remove privileges without changing role admin hierarchy.
    /// @param role Role identifier.
    /// @param account Account losing the role.
    fn revoke_role(ref self: TContractState, role: felt252, account: ContractAddress);
    /// @notice Checks whether an account has a role.
    /// @dev Read-only helper for UI and off-chain checks.
    /// @param role Role identifier.
    /// @param account Account to check.
    /// @return has True if the account has the role.
    fn has_role(self: @TContractState, role: felt252, account: ContractAddress) -> bool;
    /// @notice Renounces a role for the caller.
    /// @dev Allows self-removal to reduce privileges without admin action.
    /// @param role Role identifier.
    /// @param account Account renouncing the role.
    fn renounce_role(ref self: TContractState, role: felt252, account: ContractAddress);
    /// @notice Sets the admin role that can manage a given role.
    /// @dev Keeps role hierarchy explicit to avoid privilege escalation.
    /// @param role Role identifier.
    /// @param admin_role Admin role identifier.
    fn set_role_admin(ref self: TContractState, role: felt252, admin_role: felt252);
    /// @notice Returns the admin role for a given role.
    /// @dev Read-only helper for audits and tooling.
    /// @param role Role identifier.
    /// @return admin_role Role identifier that administers the role.
    fn get_role_admin(self: @TContractState, role: felt252) -> felt252;
}

/// @title Access Control Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy hooks for role administration.
#[starknet::interface]
pub trait IAccessControlPrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private access-control action proof.
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

/// @title Access Control Contract
/// @author CAREL Team
/// @notice Deployable role management contract for protocol administration.
/// @dev Wraps OpenZeppelin AccessControl with SRC5 interface detection.
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

    // PERBAIKAN: Hapus #[abi(embed_v0)] dari sini untuk menghindari duplikasi entry point
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

    /// @notice Initializes the access control contract.
    /// @dev Sets the DEFAULT_ADMIN_ROLE to the provided admin address.
    /// @param admin Initial admin with full role management privileges.
    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.accesscontrol.initializer();
        self.accesscontrol._grant_role(DEFAULT_ADMIN_ROLE, admin);
    }

    #[abi(embed_v0)]
    impl IAccessControlImpl of super::IAccessControl<ContractState> {
        /// @notice Grants a role to an account.
        /// @dev Uses AccessControlComponent for standardized checks.
        /// @param role Role identifier.
        /// @param account Account to receive the role.
        fn grant_role(ref self: ContractState, role: felt252, account: ContractAddress) {
            self.accesscontrol.grant_role(role, account);
        }

        /// @notice Revokes a role from an account.
        /// @dev Uses AccessControlComponent for standardized checks.
        /// @param role Role identifier.
        /// @param account Account losing the role.
        fn revoke_role(ref self: ContractState, role: felt252, account: ContractAddress) {
            self.accesscontrol.revoke_role(role, account);
        }

        /// @notice Checks whether an account has a role.
        /// @dev Read-only helper for UI and off-chain checks.
        /// @param role Role identifier.
        /// @param account Account to check.
        /// @return has True if the account has the role.
        fn has_role(self: @ContractState, role: felt252, account: ContractAddress) -> bool {
            self.accesscontrol.has_role(role, account)
        }

        /// @notice Renounces a role for the caller.
        /// @dev Allows self-removal to reduce privileges without admin action.
        /// @param role Role identifier.
        /// @param account Account renouncing the role.
        fn renounce_role(ref self: ContractState, role: felt252, account: ContractAddress) {
            self.accesscontrol.renounce_role(role, account);
        }

        /// @notice Sets the admin role that can manage a given role.
        /// @dev Restricted to DEFAULT_ADMIN_ROLE to avoid escalation.
        /// @param role Role identifier.
        /// @param admin_role Admin role identifier.
        fn set_role_admin(ref self: ContractState, role: felt252, admin_role: felt252) {
            self.accesscontrol.assert_only_role(DEFAULT_ADMIN_ROLE);
            self.accesscontrol.set_role_admin(role, admin_role);
        }

        /// @notice Returns the admin role for a given role.
        /// @dev Read-only helper for audits and tooling.
        /// @param role Role identifier.
        /// @return admin_role Role identifier that administers the role.
        fn get_role_admin(self: @ContractState, role: felt252) -> felt252 {
            self.accesscontrol.get_role_admin(role)
        }
    }

    #[abi(embed_v0)]
    impl AccessControlPrivacyImpl of super::IAccessControlPrivacy<ContractState> {
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.accesscontrol.assert_only_role(DEFAULT_ADMIN_ROLE);
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

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
