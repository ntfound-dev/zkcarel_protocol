use starknet::ContractAddress;

pub const MINTER_ROLE: felt252 = selector!("MINTER_ROLE");
pub const BURNER_ROLE: felt252 = selector!("BURNER_ROLE");
pub const PAUSER_ROLE: felt252 = selector!("PAUSER_ROLE");
pub const ORACLE_UPDATER_ROLE: felt252 = selector!("ORACLE_UPDATER_ROLE");
pub const BACKEND_SIGNER_ROLE: felt252 = selector!("BACKEND_SIGNER_ROLE");

#[starknet::interface]
pub trait IAccessControl<TContractState> {
    fn grant_role(ref self: TContractState, role: felt252, account: ContractAddress);
    fn revoke_role(ref self: TContractState, role: felt252, account: ContractAddress);
    fn has_role(self: @TContractState, role: felt252, account: ContractAddress) -> bool;
    fn renounce_role(ref self: TContractState, role: felt252, account: ContractAddress);
    fn set_role_admin(ref self: TContractState, role: felt252, admin_role: felt252);
    fn get_role_admin(self: @TContractState, role: felt252) -> felt252;
}

#[starknet::contract]
pub mod AccessControlContract {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use openzeppelin::access::accesscontrol::AccessControlComponent;
    use openzeppelin::access::accesscontrol::DEFAULT_ADMIN_ROLE;
    use openzeppelin::introspection::src5::SRC5Component;

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
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        AccessControlEvent: AccessControlComponent::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.accesscontrol.initializer();
        self.accesscontrol._grant_role(DEFAULT_ADMIN_ROLE, admin);
    }

    #[abi(embed_v0)]
    impl IAccessControlImpl of super::IAccessControl<ContractState> {
        fn grant_role(ref self: ContractState, role: felt252, account: ContractAddress) {
            self.accesscontrol.grant_role(role, account);
        }

        fn revoke_role(ref self: ContractState, role: felt252, account: ContractAddress) {
            self.accesscontrol.revoke_role(role, account);
        }

        fn has_role(self: @ContractState, role: felt252, account: ContractAddress) -> bool {
            self.accesscontrol.has_role(role, account)
        }

        fn renounce_role(ref self: ContractState, role: felt252, account: ContractAddress) {
            self.accesscontrol.renounce_role(role, account);
        }

        fn set_role_admin(ref self: ContractState, role: felt252, admin_role: felt252) {
            self.accesscontrol.assert_only_role(DEFAULT_ADMIN_ROLE);
            self.accesscontrol.set_role_admin(role, admin_role);
        }

        fn get_role_admin(self: @ContractState, role: felt252) -> felt252 {
            self.accesscontrol.get_role_admin(role)
        }
    }
}